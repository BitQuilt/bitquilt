import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import {
  AWAY_FILE, AWAY_LOG, AWAY_TOOLS, LAUNCHD_LABEL, NEEDS_AGENT, awayCommand, awayPrompt, awayStatus, awaySummary, awaySwitch, awayTurn, capText, claudeInvocation, codexInvocation, codexModel,
  crontabLine, findAgent, installSchedule, localDay, plistText, readAway, recordReturn, recordRun, rolledOver, scheduleEnv, scheduleOf, searchDirs, setCap, uninstallSchedule, writeAway,
} from '../src/away.js';
import { DEFAULT_CONFIG, loadConfig } from '../src/config.js';
import { awayInstructions } from '../src/mcp.js';
import type { Pattern, Quilt } from '../src/quilt.js';
import { instructs, json, mcpPair, quiltOver, startTracker, tempHome } from './helpers.js';

/**
 * `quilt away` (away.ts): one piece an hour while nobody is at the keyboard, through an agent CLI on the person's own
 * plan. The agent is found on a PATH and the usual places, claude before codex; each gets its headless invocation with
 * the connector, the vendor it declares and the record under QUILT_AWAY; the record rolls over by the local day and
 * keeps a week; the connector itself offers only the tools a run may call and stops quilt_next and quilt_return at the
 * cap, in words that describe; the driver refuses to start at the cap, and otherwise runs the agent and records the
 * run; the launchd plist runs this program's `away` every hour; the switch writes and removes it.
 */
// The run while away is for a Mac or Linux: launchd or cron, a shell, posix paths. The tests that lean on those are skipped on Windows.
const posix = it.skipIf(process.platform === 'win32');
const entry = { command: '/opt/quilt', args: ['mcp'], env: { QUILT_HOME: '/h', QUILT_MODEL: 'anthropic/claude', QUILT_TRACKERS: 'http://t/' } };
const day = '2026-10-29';
const at = (d: string, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`);

describe('finding the agent CLI and building its invocation', () => {
  posix('looks on the PATH first and then in the usual places, nvm newest first, and finds claude before codex', () => {
    const dirs = searchDirs({ PATH: '/bin:/usr/bin' }, '/Users/x', (d) => (d.endsWith('node') ? ['v20.19.4', 'v22.15.0'] : []));
    expect(dirs.slice(0, 3)).toEqual(['/bin', '/usr/bin', '/Users/x/.local/bin']);
    expect(dirs).toContain('/opt/homebrew/bin');
    expect(dirs.slice(-2)).toEqual(['/Users/x/.nvm/versions/node/v22.15.0/bin', '/Users/x/.nvm/versions/node/v20.19.4/bin']);
    const have = new Set(['/Users/x/.nvm/versions/node/v22.15.0/bin/codex', '/Users/x/.local/bin/claude']);
    expect(findAgent(dirs, (p) => have.has(p))).toEqual({ name: 'claude', path: '/Users/x/.local/bin/claude' });
    have.delete('/Users/x/.local/bin/claude');
    expect(findAgent(dirs, (p) => have.has(p))).toEqual({ name: 'codex', path: '/Users/x/.nvm/versions/node/v22.15.0/bin/codex' });
    expect(findAgent(dirs, () => false)).toBeNull();
  });
  it('says the phrase and that nobody is here, and gives Claude Code the connector inline with only the safe tools allowed', () => {
    expect(awayPrompt()).toMatch(/^Find me something to do on Quilt\. Nobody is at the keyboard/);
    const inv = claudeInvocation('/Users/x/.local/bin/claude', entry, '/h/away.json');
    expect(inv.command).toBe('/Users/x/.local/bin/claude');
    expect(inv.model).toBe('anthropic/claude');
    expect(inv.args.slice(0, 2)).toEqual(['-p', awayPrompt()]);
    expect(inv.args).toContain('--strict-mcp-config');
    expect(inv.args.slice(inv.args.indexOf('--output-format'), inv.args.indexOf('--output-format') + 2)).toEqual(['--output-format', 'json']);
    expect(inv.args.slice(inv.args.indexOf('--max-turns'), inv.args.indexOf('--max-turns') + 2)).toEqual(['--max-turns', '40']);
    const config = JSON.parse(inv.args[inv.args.indexOf('--mcp-config') + 1]!) as { mcpServers: { quilt: typeof entry } };
    expect(config.mcpServers.quilt).toEqual({ command: '/opt/quilt', args: ['mcp'], env: { QUILT_HOME: '/h', QUILT_MODEL: 'anthropic/claude', QUILT_TRACKERS: 'http://t/', QUILT_AWAY: '/h/away.json' } });
    const allowed = inv.args[inv.args.indexOf('--allowedTools') + 1]!.split(',');
    expect(allowed).toEqual(AWAY_TOOLS.map((t) => `mcp__quilt__${t}`));
    for (const t of ['quilt_pay', 'quilt_publish', 'quilt_challenge', 'quilt_transfer', 'quilt_redeem', 'quilt_rank', 'quilt_verdict', 'quilt_seed', 'quilt_name', 'quilt_reveal_gold']) expect(allowed).not.toContain(`mcp__quilt__${t}`);
  });
  it('gives Codex the connector as config overrides, declares openai and the model its config names, and asks no approval', () => {
    expect(codexModel('personality = "x"\nmodel = "gpt-5.6-sol"\n')).toBe('gpt-5.6-sol');
    expect(codexModel(null)).toBe('codex');
    const inv = codexInvocation('/usr/local/bin/codex', entry, '/h/away.json', 'gpt-5.6-sol', '/h/away.last');
    expect(inv.model).toBe('openai/gpt-5.6-sol');
    expect(inv.args.slice(0, 4)).toEqual(['exec', '--skip-git-repo-check', '--sandbox', 'read-only']);
    expect(inv.args).toContain('approval_policy="never"');
    expect(inv.args[inv.args.length - 1]).toBe(awayPrompt());
    const overrides = inv.args.filter((_, i) => inv.args[i - 1] === '-c');
    expect(overrides).toContain('mcp_servers.quilt.command="/opt/quilt"');
    expect(overrides).toContain('mcp_servers.quilt.args=["mcp"]');
    expect(overrides).toContain(`mcp_servers.quilt.env=${JSON.stringify({ QUILT_HOME: '/h', QUILT_MODEL: 'openai/gpt-5.6-sol', QUILT_TRACKERS: 'http://t/', QUILT_AWAY: '/h/away.json' })}`);
    expect(inv.args.slice(inv.args.indexOf('--output-last-message'), inv.args.indexOf('--output-last-message') + 2)).toEqual(['--output-last-message', '/h/away.last']);
  });
});

describe('the record and its day', () => {
  it('is fresh with the default cap, rolls another day\'s counts to zero, keeps the cap and a week of days, and drops older ones', () => {
    expect(localDay(at(day))).toBe(day);
    const fresh = rolledOver(null, day);
    expect(fresh).toEqual({ cap: 5, day, returned: 0, runs: 0, last: null, lastAgent: null, days: {} });
    const old = { cap: 10, day: '2026-10-28', returned: 4, runs: 6, last: '2026-10-28T20:00:00.000Z', lastAgent: 'codex' as const, days: { '2026-10-28': { runs: 6, returned: 4, pieces: [] }, '2026-10-23': { runs: 1, returned: 1, pieces: [] }, '2026-10-22': { runs: 2, returned: 2, pieces: [] } } };
    const rolled = rolledOver(old, day);
    expect(rolled.cap).toBe(10);
    expect([rolled.returned, rolled.runs]).toEqual([0, 0]);
    expect(rolled.lastAgent).toBe('codex');
    expect(Object.keys(rolled.days).sort()).toEqual(['2026-10-23', '2026-10-28']);
    expect(rolledOver(old, '2026-10-28').returned).toBe(4);
  });
  it('counts a run and a return against the day in the file, and the cap set is kept across the rollover', () => {
    const home = tempHome('quilt-away-');
    const file = join(home, AWAY_FILE);
    expect(readAway(file, at(day)).cap).toBe(5);
    setCap(file, 3, at(day));
    recordRun(file, 'claude', at(day, 9));
    recordReturn(file, 'sha256:aa', 'sha256:bb', at(day, 9));
    const r = readAway(file, at(day, 10));
    expect([r.cap, r.runs, r.returned, r.lastAgent]).toEqual([3, 1, 1, 'claude']);
    expect(r.days[day]).toEqual({ runs: 1, returned: 1, pieces: [{ problem: 'sha256:aa', piece: 'sha256:bb' }] });
    const next = readAway(file, at('2026-10-30'));
    expect([next.cap, next.runs, next.returned]).toEqual([3, 0, 0]);
    expect(next.days[day]?.returned).toBe(1);
    expect(() => setCap(file, 0)).toThrow(/at least 1/);
    expect(capText({ ...r, returned: 5, cap: 5 })).toBe('Today\'s allowance while away is used up: 5 of 5.');
    expect(capText(r)).not.toMatch(instructs);
  });
  it('leaves the person capability out of the config while away', () => {
    const home = tempHome('quilt-away-can-');
    writeFileSync(join(home, 'config.json'), JSON.stringify({ ...DEFAULT_CONFIG, can: ['person', 'web', 'files'] }));
    expect(loadConfig(home).can).toEqual(['person', 'web', 'files']);
    process.env.QUILT_AWAY = join(home, AWAY_FILE);
    try {
      expect(loadConfig(home).can).toEqual(['web', 'files']);
    } finally {
      delete process.env.QUILT_AWAY;
    }
  });
});

describe('the connector under the cap', () => {
  let server: Server;
  let base: string;
  let owner: Quilt, a: Quilt;
  let problem: Hash;
  const pattern: Pattern = {
    title: 'Does the label say what the sheet says?', done_when: 'Every label has a verdict.', slug: 'labels', topics: ['herbarium'], settings: { endgame_at: 1 },
    pieces: {
      'label/*': {
        count: 2, verifier: 'agree', requires: ['web'], brief: 'Label {n}: {row.text} Return the verdict.', data: { row: 'rows' },
        schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } }, agree: ['verdict'],
      },
    },
    data: { rows: [{ text: 'Collected in May.' }, { text: 'Collected in June.' }] },
  };
  beforeAll(async () => {
    ({ server, base } = await startTracker());
    const mk = quiltOver(base);
    owner = mk(9);
    a = mk(1);
    problem = (await owner.publish(pattern)).hash;
  });
  afterAll(() => {
    delete process.env.QUILT_AWAY;
    return new Promise<void>((r) => server.close(() => r()));
  });
  const states = async () => (await json<{ pieces: { state: string }[] }>(`${base}p/${problem}/state`)).pieces.map((p) => p.state);

  it('offers only the tools a run may call, says so in words that describe, and refuses a claim and a return once the day\'s cap is reached, writing nothing', async () => {
    const file = join(tempHome('quilt-away-mcp-'), AWAY_FILE);
    writeAway(file, { ...rolledOver(null, localDay()), cap: 5, returned: 5 });
    process.env.QUILT_AWAY = file;
    const { client, close } = await mcpPair(a);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([...AWAY_TOOLS].sort());
    expect(client.getInstructions() ?? '').toContain('nobody is at the keyboard');
    expect(client.getInstructions() ?? '').not.toMatch(instructs);
    expect(awayInstructions(readAway(file))).not.toMatch(instructs);
    const next = await client.callTool({ name: 'quilt_next', arguments: { problem } });
    expect((next.structuredContent as { text: string }).text).toBe('Today\'s allowance while away is used up: 5 of 5.');
    expect((next.content as { text: string }[])[0]!.text).toBe('Today\'s allowance while away is used up: 5 of 5.');
    const ret = await client.callTool({ name: 'quilt_return', arguments: { problem, piece: 'sha256:' + 'ab'.repeat(32), return: { verdict: 'supports' } } });
    expect((ret.structuredContent as { text: string }).text).toContain('used up: 5 of 5');
    expect(await states()).toEqual(['open', 'open']);
    const me = await client.callTool({ name: 'quilt_me', arguments: {} });
    expect((me.structuredContent as { text: string }).text).toContain(a.identity!.address);
    await close();
  });
  it('under the cap, hands the piece out and counts the return against the day, with the piece named in the record', async () => {
    const file = join(tempHome('quilt-away-mcp-'), AWAY_FILE);
    writeAway(file, { ...rolledOver(null, localDay()), cap: 2 });
    process.env.QUILT_AWAY = file;
    const { client, close } = await mcpPair(a);
    const next = await client.callTool({ name: 'quilt_next', arguments: { problem } });
    const handles = (next.structuredContent as { handles: { problem: string; piece: string } }).handles;
    expect(handles.problem).toBe(problem);
    expect(await states()).toContain('in_flight');
    const ret = await client.callTool({ name: 'quilt_return', arguments: { problem, piece: handles.piece, return: { verdict: 'supports' } } });
    expect((ret.structuredContent as { text: string }).text).toContain('Commit posted');
    const r = readAway(file);
    expect(r.returned).toBe(1);
    expect(r.days[r.day]?.pieces).toEqual([{ problem, piece: handles.piece }]);
    await close();
  });
});

describe('the schedule', () => {
  posix('writes a plist that runs this program\'s away every hour, not at load, with the home in its environment and its output under the home', () => {
    const { command, args } = awayCommand(entry);
    expect([command, args]).toEqual(['/opt/quilt', ['away']]);
    expect(awayCommand({ ...entry, args: ['--filter', 'quilt', '--dir', '/r', 'start', 'mcp'] }).args).toEqual(['--filter', 'quilt', '--dir', '/r', 'start', 'away']);
    const env = scheduleEnv(entry, ['/Users/x/.local/bin', '/usr/bin'], '/Users/x/.config/quilt');
    expect(env).toEqual({ QUILT_HOME: '/Users/x/.config/quilt', QUILT_TRACKERS: 'http://t/', PATH: '/Users/x/.local/bin:/usr/bin' });
    const text = plistText({ label: LAUNCHD_LABEL, command, args, home: '/Users/x/.config/quilt', env });
    expect(text).toContain('<key>Label</key>\n  <string>org.bitquilt.quilt.away</string>');
    expect(text).toContain('<key>ProgramArguments</key>\n  <array>\n    <string>/opt/quilt</string>\n    <string>away</string>\n  </array>');
    expect(text).toContain('<key>StartInterval</key>\n  <integer>3600</integer>');
    expect(text).toContain('<key>RunAtLoad</key>\n  <false/>');
    expect(text).toContain('<key>QUILT_HOME</key>\n    <string>/Users/x/.config/quilt</string>');
    expect(text).toContain('<key>StandardOutPath</key>\n  <string>/Users/x/.config/quilt/away.out</string>');
    expect(text).toContain('<key>StandardErrorPath</key>\n  <string>/Users/x/.config/quilt/away.err</string>');
    expect(plistText({ label: 'l', command: 'a&b', args: [], home: '/h', env: {} })).toContain('<string>a&amp;b</string>');
    expect(crontabLine('/opt/quilt', ['away'], '/Users/x/.config/quilt')).toBe('0 * * * * QUILT_HOME=/Users/x/.config/quilt /opt/quilt away >> /Users/x/.config/quilt/away.out 2>> /Users/x/.config/quilt/away.err');
    expect(crontabLine('/opt/q', ['away'], "/Users/o'b/h")).toContain(`'/Users/o'\\''b/h'`);
  });
  it('installs by writing the plist and loading it, says whether launchd has it, and uninstalls by unloading and removing it', () => {
    const calls: string[][] = [];
    const ctl = (args: string[]) => {
      calls.push(args);
      return args[0] !== 'bootout';
    };
    const file = join(tempHome('quilt-away-plist-'), 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
    const common = { platform: 'darwin' as const, file, uid: 501, ctl, command: '/opt/quilt', args: ['away'], home: '/h' };
    expect(scheduleOf(common)).toEqual({ kind: 'launchd', installed: false, loaded: false, file, crontab: null });
    expect(installSchedule({ file, text: 'plist', uid: 501, ctl })).toEqual({ file, loaded: true });
    expect(readFileSync(file, 'utf8')).toBe('plist');
    expect(calls).toEqual([['bootout', 'gui/501/org.bitquilt.quilt.away'], ['bootstrap', 'gui/501', file]]);
    expect(scheduleOf(common)).toEqual({ kind: 'launchd', installed: true, loaded: true, file, crontab: null });
    expect(uninstallSchedule({ file, uid: 501, ctl })).toEqual({ file, removed: true });
    expect(existsSync(file)).toBe(false);
    expect(calls[calls.length - 1]).toEqual(['bootout', 'gui/501/org.bitquilt.quilt.away']);
    const elsewhere = scheduleOf({ ...common, platform: 'linux' });
    expect(elsewhere.kind).toBe('crontab');
    expect(elsewhere.crontab).toContain('0 * * * * QUILT_HOME=/h /opt/quilt away');
  });
});

describe('a turn', () => {
  /** A fake agent CLI: a shell script that records its arguments, one a line, and prints what Claude Code prints. */
  function fakeAgent(name: string, exit = 0): { dir: string; argv: string } {
    const dir = tempHome('quilt-away-bin-');
    const argv = join(dir, 'argv.txt');
    writeFileSync(join(dir, name), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> '${argv}'; done\nprintf '%s' '{"type":"result","result":"Nothing to do right now."}'\nexit ${exit}\n`);
    chmodSync(join(dir, name), 0o755);
    return { dir, argv };
  }
  posix('refuses to start at the cap and when no agent is here, and otherwise runs the agent with its invocation and records the run', async () => {
    const home = tempHome('quilt-away-turn-');
    const file = join(home, AWAY_FILE);
    const env = { PATH: '/nonexistent' };
    const nobody = await awayTurn({ home, env, entry, dirs: ['/nonexistent'] });
    expect(nobody).toMatchObject({ ran: false, agent: null, line: NEEDS_AGENT });
    expect(readAway(file).runs).toBe(0);
    const { dir, argv } = fakeAgent('claude');
    writeAway(file, { ...rolledOver(null, day), cap: 2, returned: 2 });
    const full = await awayTurn({ home, env, entry, dirs: [dir], now: () => at(day, 14) });
    expect(full).toMatchObject({ ran: false, line: 'Today\'s allowance while away is used up: 2 of 2.' });
    expect(existsSync(argv)).toBe(false);
    writeAway(file, { ...rolledOver(null, day), cap: 5 });
    const turn = await awayTurn({ home, env, entry, dirs: [dir], now: () => at(day, 15) });
    expect(turn).toMatchObject({ ran: true, agent: { name: 'claude', path: join(dir, 'claude') }, model: 'anthropic/claude', code: 0, timedOut: false, returned: 0, said: 'Nothing to do right now.' });
    expect(turn.record).toMatchObject({ cap: 5, day, runs: 1, returned: 0, last: at(day, 15).toISOString(), lastAgent: 'claude' });
    expect(turn.record.days[day]).toEqual({ runs: 1, returned: 0, pieces: [] });
    expect(readFileSync(argv, 'utf8').split('\n').filter(Boolean)).toEqual(claudeInvocation(join(dir, 'claude'), entry, file).args);
    expect(readFileSync(join(home, AWAY_LOG), 'utf8')).toContain(`${at(day, 15).toISOString()} claude (anthropic/claude) exit 0 in 0s; returned 0 (0 of 5 today); said: Nothing to do right now.`);
    const failing = fakeAgent('codex', 3);
    const bad = await awayTurn({ home, env, entry, dirs: [failing.dir], codexConfig: join(home, 'none.toml'), now: () => at(day, 16) });
    expect(bad).toMatchObject({ ran: true, agent: { name: 'codex' }, model: 'openai/codex', code: 3 });
    expect(readFileSync(failing.argv, 'utf8')).toContain('mcp_servers.quilt.command="/opt/quilt"');
    expect(readAway(file, at(day, 17)).runs).toBe(2);
  });
  posix('stops an agent that runs past the timeout', async () => {
    const home = tempHome('quilt-away-slow-');
    const dir = tempHome('quilt-away-bin-');
    writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexec /bin/sleep 30\n');
    chmodSync(join(dir, 'claude'), 0o755);
    const turn = await awayTurn({ home, env: {}, entry, dirs: [dir], timeoutMs: 300 });
    expect(turn.timedOut).toBe(true);
    expect(turn.line).toMatch(/stopped after \ds/);
  });
});

describe('the status, the summary and the switch', () => {
  it('says whether the schedule is in place, which agent is here, the cap and today, and sums the week with what is accepted so far', async () => {
    const home = tempHome('quilt-away-status-');
    const file = join(home, AWAY_FILE);
    const plist = join(home, 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
    const { dir } = (() => {
      const d = tempHome('quilt-away-bin-');
      writeFileSync(join(d, 'claude'), '#!/bin/sh\n');
      chmodSync(join(d, 'claude'), 0o755);
      return { dir: d };
    })();
    const ctl = () => true;
    const s = awayStatus({ home, env: {}, entry, dirs: [dir], platform: 'darwin', file: plist, uid: 501, ctl, now: () => at(day) });
    expect(s).toMatchObject({ kind: 'launchd', installed: false, agent: { name: 'claude' }, cap: 5, day, today: { runs: 0, returned: 0 }, last: null });
    writeAway(file, { cap: 5, day, returned: 1, runs: 2, last: null, lastAgent: 'claude', days: { [day]: { runs: 2, returned: 1, pieces: [{ problem: 'sha256:p1', piece: 'sha256:a' }] }, '2026-10-27': { runs: 3, returned: 2, pieces: [{ problem: 'sha256:p1', piece: 'sha256:b' }, { problem: 'sha256:p2', piece: 'sha256:c' }] } } });
    const asked: string[] = [];
    const states = async (problem: string) => {
      asked.push(problem);
      return problem === 'sha256:p1' ? new Map([['sha256:a', 'accepted_provisional'], ['sha256:b', 'disputed']]) : null;
    };
    const sum = await awaySummary(readAway(file, at(day)), states);
    expect(sum.today).toEqual({ runs: 2, returned: 1, accepted: 1 });
    expect(sum.week).toEqual({ runs: 5, returned: 3, accepted: 1 });
    expect(sum.days.map((d) => d.day)).toEqual(['2026-10-27', day]);
    expect(asked).toEqual(['sha256:p1', 'sha256:p2']);
  });
  it('turns on by installing for the agent found and off by removing, and sets the cap given, through the one function the page and the command line share', async () => {
    const home = tempHome('quilt-away-switch-');
    const plist = join(home, 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
    const dir = tempHome('quilt-away-bin-');
    writeFileSync(join(dir, 'claude'), '#!/bin/sh\n');
    chmodSync(join(dir, 'claude'), 0o755);
    const calls: string[][] = [];
    const ctl = (args: string[]) => {
      calls.push(args);
      return true;
    };
    const quilt = {} as Quilt;
    const o = { home, env: {}, entry, dirs: [dir], platform: 'darwin' as const, file: plist, uid: 501, ctl, quilt, now: () => at(day) };
    const off = await awaySwitch({ ...o, dirs: ['/nonexistent'], on: true });
    expect(off.installed).toBe(false);
    expect(off.note).toBe(NEEDS_AGENT);
    const on = await awaySwitch({ ...o, on: true, cap: 10 });
    expect(on).toMatchObject({ installed: true, loaded: true, cap: 10, agent: { name: 'claude' } });
    expect(on.note).toContain('runs one piece an hour, up to 10 a day');
    expect(readFileSync(plist, 'utf8')).toContain(`<string>${home}</string>`);
    expect(readFileSync(plist, 'utf8')).toContain(`<key>PATH</key>\n    <string>${dir}</string>`);
    expect(calls.map((c) => c[0])).toEqual(['bootout', 'bootstrap', 'print']);
    const done = await awaySwitch({ ...o, on: false });
    expect(done.installed).toBe(false);
    expect(done.note).toContain('Uninstalled');
    expect(existsSync(plist)).toBe(false);
    const elsewhere = await awaySwitch({ ...o, platform: 'linux', on: true });
    expect(elsewhere.note).toContain('0 * * * * QUILT_HOME=');
  });
  it('is wired as `quilt away`: --status --json from the command line', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const home = tempHome('quilt-away-cli-');
    const out = execFileSync(process.execPath, ['--import', 'tsx', join(root, 'packages', 'client', 'src', 'bin.ts'), 'away', '--status', '--json', '--cap', '3'], { cwd: root, encoding: 'utf8', env: { ...process.env, QUILT_HOME: home, PATH: '/nonexistent', HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
    const status = JSON.parse(out) as { cap: number; agent: unknown; today: { runs: number } };
    expect(status.cap).toBe(3);
    expect(status.agent).toBeNull();
    expect(status.today.runs).toBe(0);
    expect(readAway(join(home, AWAY_FILE)).cap).toBe(3);
  }, 60_000);
});
