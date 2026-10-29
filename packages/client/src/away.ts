/**
 * `quilt away`: one piece an hour while nobody is at the keyboard, and the menu bar's switch for it (page.ts,
 * /api/away). A person's AI works Quilt when they ask and approve each write; this runs the same work unattended
 * through an agent CLI the person already has on a subscription (Claude Code on a Claude plan, Codex on a ChatGPT
 * plan), with no API key. The CLI starts the connector over stdio as a chat client would, declares the vendor it is
 * (anthropic/claude, or openai/<model>, so a person with both gives the room two vendors), and is handed the tools
 * that read, take a piece, hand a return back and give one back, and no other: the connector itself offers only those
 * when QUILT_AWAY is set (mcp.ts), and Claude Code is told the same list. The daily cap lives in a file under the home
 * (away.json) that the connector reads and writes, so a run that got past the driver still stops at the cap, and the
 * claim's `can` leaves out `person` (config.ts), so a piece that wants a person is not offered. The schedule is a
 * launchd user agent on a Mac and a crontab line elsewhere. Every run is appended to away.log beside the record.
 */
import { execFileSync, spawn } from 'node:child_process';
import { accessSync, appendFileSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { isHash } from '@bitquilt/core';
import type { ServerEntry } from './install.js';
import { parseLink } from './link.js';
import { say } from './phrases.js';
import type { Quilt } from './quilt.js';
import { layerByHash } from './render.js';
import type { ToolName } from './tools.js';

/** The tools a run while away may call: the ones that read, take a piece, hand a return back and give one back. */
export const AWAY_TOOLS = ['quilt_me', 'quilt_open', 'quilt_search', 'quilt_next', 'quilt_return', 'quilt_decline', 'quilt_read'] as const satisfies readonly ToolName[];

export type AgentName = 'claude' | 'codex';

/** The agent CLIs looked for, in order; gemini would be a third once its headless flags are known. */
export const AGENTS: readonly AgentName[] = ['claude', 'codex'];

export const DEFAULT_CAP = 5;
export const AWAY_FILE = 'away.json';
export const AWAY_LOG = 'away.log';
export const LAUNCHD_LABEL = 'org.bitquilt.quilt.away';
/** How long one run may take before it is stopped. */
export const RUN_TIMEOUT_MS = 10 * 60_000;
export const NEEDS_AGENT = 'Needs Claude Code or Codex on this machine.';
/** What the run declares when Claude Code is the agent; a Codex run declares openai/<the model its config names>. */
export const CLAUDE_MODEL = 'anthropic/claude';
/** The states in which a returned piece counts as accepted so far. */
export const ACCEPTED_STATES: readonly string[] = ['accepted_provisional', 'accepted'];

/** One day of the record: how many runs, how many pieces returned, and which, so the summary can ask what became of them. */
export interface AwayDay { runs: number; returned: number; pieces: { problem: string; piece: string }[] }

/** The record at QUILT_HOME/away.json: the cap, today's counts, the last run, and the last seven days by day. */
export interface AwayRecord {
  cap: number;
  /** Today, as YYYY-MM-DD in local time. */
  day: string;
  returned: number;
  runs: number;
  /** When the last run started, ISO; null before the first. */
  last: string | null;
  lastAgent: AgentName | null;
  days: Record<string, AwayDay>;
}

/** The day a time falls on, by the local clock, as YYYY-MM-DD. */
export function localDay(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** How many days from one YYYY-MM-DD to another, by the calendar. */
function daysBetween(from: string, to: string): number {
  const at = (d: string) => {
    const [y, m, dd] = d.split('-').map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, dd ?? 1);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/** What was read, as the record for the day given: another day's counts go to zero, days older than a week are dropped, the cap and the last run are kept. */
export function rolledOver(read: Partial<AwayRecord> | null, day: string): AwayRecord {
  const cap = typeof read?.cap === 'number' && Number.isInteger(read.cap) && read.cap > 0 ? read.cap : DEFAULT_CAP;
  const days: Record<string, AwayDay> = {};
  for (const [d, v] of Object.entries(read?.days ?? {})) {
    const ago = daysBetween(d, day);
    if (ago >= 0 && ago < 7) days[d] = { runs: v.runs ?? 0, returned: v.returned ?? 0, pieces: Array.isArray(v.pieces) ? v.pieces : [] };
  }
  const same = read?.day === day;
  return { cap, day, returned: same ? read.returned ?? 0 : 0, runs: same ? read.runs ?? 0 : 0, last: read?.last ?? null, lastAgent: read?.lastAgent ?? null, days };
}

/** The record from its file, rolled over to today; a missing or unreadable file is a fresh record. */
export function readAway(file: string, now = new Date()): AwayRecord {
  let read: Partial<AwayRecord> | null = null;
  try {
    read = JSON.parse(readFileSync(file, 'utf8')) as Partial<AwayRecord>;
  } catch {
    read = null;
  }
  return rolledOver(read, localDay(now));
}

export function writeAway(file: string, record: AwayRecord): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
}

export function capReached(record: AwayRecord): boolean {
  return record.returned >= record.cap;
}

/** What quilt_next and quilt_return answer once the cap is reached: a statement, as every tool's text is. */
export function capText(record: AwayRecord): string {
  return `Today's allowance while away is used up: ${record.returned} of ${record.cap}.`;
}

function today(record: AwayRecord): AwayDay {
  return (record.days[record.day] ??= { runs: 0, returned: 0, pieces: [] });
}

/** A return handed back during a run, recorded by the connector (mcp.ts) against the day. */
export function recordReturn(file: string, problem: string, piece: string, now = new Date()): AwayRecord {
  const record = readAway(file, now);
  record.returned += 1;
  const d = today(record);
  d.returned += 1;
  d.pieces.push({ problem, piece });
  writeAway(file, record);
  return record;
}

/** A run started, recorded by the driver before the agent is spawned, so the two writers of the file take turns. */
export function recordRun(file: string, agent: AgentName, now = new Date()): AwayRecord {
  const record = readAway(file, now);
  record.runs += 1;
  record.last = now.toISOString();
  record.lastAgent = agent;
  today(record).runs += 1;
  writeAway(file, record);
  return record;
}

/** The cap set and kept in the file: a whole number of pieces a day, at least one. */
export function setCap(file: string, cap: number, now = new Date()): AwayRecord {
  if (!Number.isInteger(cap) || cap < 1) throw new Error('the cap is a whole number of pieces a day, at least 1');
  const record = readAway(file, now);
  record.cap = cap;
  writeAway(file, record);
  return record;
}

// The agent CLI

export interface Agent { name: AgentName; path: string }

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where an agent CLI is looked for: the PATH, then the places the installers put one, since launchd and an app started
 * from the Finder carry a short PATH with none of them. The nvm versions come newest first.
 */
export function searchDirs(env: NodeJS.ProcessEnv, home = homedir(), list: (dir: string) => string[] = listDir): string[] {
  const fromPath = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const usual = [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', join(home, '.npm-global', 'bin'), join(home, '.claude', 'local')];
  const nvm = join(home, '.nvm', 'versions', 'node');
  const nodes = list(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })).map((v) => join(nvm, v, 'bin'));
  return [...new Set([...fromPath, ...usual, ...nodes])];
}

/** The first agent CLI found: claude in any of the directories, then codex. */
export function findAgent(dirs: string[], exists: (path: string) => boolean = isExecutable): Agent | null {
  for (const name of AGENTS) for (const dir of dirs) {
    const path = join(dir, name);
    if (exists(path)) return { name, path };
  }
  return null;
}

/** What the run says to the agent: the phrase a person says, and that nobody is here. Fixed text, with nothing anyone else wrote in it. */
export function awayPrompt(): string {
  return `${say('find_something_to_do')} Nobody is at the keyboard right now, so decline any piece that needs a person (reason: cannot). One piece is enough for this run.`;
}

/** An agent CLI's headless invocation, and the model the connector declares under it. */
export interface Invocation { command: string; args: string[]; model: string }

/** The connector entry an agent starts: the installer's (install.ts), with the vendor the run declares and the record the connector keeps the cap in. */
export function awayEntry(entry: ServerEntry, model: string, awayFile: string): ServerEntry {
  return { command: entry.command, args: entry.args, env: { ...entry.env, QUILT_MODEL: model, QUILT_AWAY: awayFile } };
}

/**
 * Claude Code, headless: `-p` prints one answer and exits, and cannot answer a permission prompt, so a tool outside
 * --allowedTools is refused, which is the point; --strict-mcp-config keeps the person's other servers out of the run.
 * The MCP config is given inline, as the CLI takes it (2.1.x).
 */
export function claudeInvocation(claude: string, entry: ServerEntry, awayFile: string): Invocation {
  const config = JSON.stringify({ mcpServers: { quilt: awayEntry(entry, CLAUDE_MODEL, awayFile) } });
  const allowed = AWAY_TOOLS.map((t) => `mcp__quilt__${t}`).join(',');
  return { command: claude, model: CLAUDE_MODEL, args: ['-p', awayPrompt(), '--output-format', 'json', '--max-turns', '40', '--strict-mcp-config', '--mcp-config', config, '--allowedTools', allowed] };
}

/** The model Codex's config names (~/.codex/config.toml, `model = "..."`), or `codex` where it names none. */
export function codexModel(toml: string | null): string {
  const m = toml ? /^\s*model\s*=\s*"([^"\n]+)"/m.exec(toml) : null;
  return m?.[1] ?? 'codex';
}

/**
 * Codex, headless: `exec` takes the prompt and exits; the connector is given as config overrides, each value JSON as
 * the CLI parses it; the sandbox is read-only and no approval is asked for. Flags as codex-cli 0.20 has them.
 */
export function codexInvocation(codex: string, entry: ServerEntry, awayFile: string, model = 'codex', lastMessage?: string): Invocation {
  const declared = `openai/${model}`;
  const server = awayEntry(entry, declared, awayFile);
  const set = (key: string, value: unknown) => ['-c', `mcp_servers.quilt.${key}=${JSON.stringify(value)}`];
  return {
    command: codex, model: declared,
    args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy="never"', ...set('command', server.command), ...set('args', server.args), ...set('env', server.env), ...(lastMessage ? ['--output-last-message', lastMessage] : []), awayPrompt()],
  };
}

/** What `claude -p --output-format json` printed, as the final text, or null where it printed something else. */
export function saidByClaude(stdout: string): string | null {
  for (const line of [stdout.trim(), ...stdout.trim().split('\n').reverse()]) {
    try {
      const j = JSON.parse(line) as { result?: unknown };
      if (typeof j.result === 'string') return j.result;
    } catch {
      /* not this line */
    }
  }
  return null;
}

/** The agent run with the timeout: SIGTERM at the deadline, SIGKILL ten seconds later. */
export function runAgent(inv: Invocation, options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<{ code: number | null; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(inv.command, inv.args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, options.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stdout, stderr });
    });
  });
}

function readIfThere(file: string | null): string | null {
  try {
    return file ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

export interface TurnOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  /** The connector entry for this very program (install.ts, entryHere). */
  entry: ServerEntry;
  /** Where the agent CLIs are looked for; the PATH and the usual places when left out. */
  dirs?: string[];
  exists?: (path: string) => boolean;
  /** Codex's config file, for the model it names; ~/.codex/config.toml when left out. */
  codexConfig?: string;
  timeoutMs?: number;
  now?: () => Date;
}

/** One turn: whether an agent ran, which, how it ended, how many pieces the record gained, what the agent said last, and the line appended to the log. */
export interface Turn {
  ran: boolean;
  agent: Agent | null;
  model: string | null;
  code: number | null;
  timedOut: boolean;
  returned: number;
  said: string | null;
  line: string;
  record: AwayRecord;
}

/**
 * One turn: nothing when today's cap is reached or no agent CLI is here; else the run recorded, the agent run with
 * the connector under the cap, and a line in away.log saying how it went.
 */
export async function awayTurn(o: TurnOptions): Promise<Turn> {
  const now = o.now ?? (() => new Date());
  const file = join(o.home, AWAY_FILE);
  const before = readAway(file, now());
  const none = (line: string): Turn => ({ ran: false, agent: null, model: null, code: null, timedOut: false, returned: 0, said: null, line, record: before });
  if (capReached(before)) return none(capText(before));
  const dirs = o.dirs ?? searchDirs(o.env);
  const agent = findAgent(dirs, o.exists);
  if (!agent) return none(NEEDS_AGENT);
  const lastMessage = join(o.home, 'away.last');
  const inv = agent.name === 'claude'
    ? claudeInvocation(agent.path, o.entry, file)
    : codexInvocation(agent.path, o.entry, file, codexModel(readIfThere(o.codexConfig ?? join(homedir(), '.codex', 'config.toml'))), lastMessage);
  const started = now();
  recordRun(file, agent.name, started);
  const run = await runAgent(inv, { cwd: o.home, env: { ...o.env, PATH: dirs.join(delimiter) }, timeoutMs: o.timeoutMs ?? RUN_TIMEOUT_MS });
  const after = readAway(file, now());
  const said = agent.name === 'claude' ? saidByClaude(run.stdout) : readIfThere(lastMessage);
  if (existsSync(lastMessage)) unlinkSync(lastMessage);
  const returned = Math.max(0, after.returned - before.returned);
  const seconds = Math.round((now().getTime() - started.getTime()) / 1000);
  const ended = run.timedOut ? `stopped after ${seconds}s` : `exit ${run.code} in ${seconds}s`;
  const line = `${started.toISOString()} ${agent.name} (${inv.model}) ${ended}; returned ${returned} (${after.returned} of ${after.cap} today)${said ? `; said: ${oneLine(said, 300)}` : ''}`;
  const failed = run.timedOut || run.code !== 0;
  appendFileSync(join(o.home, AWAY_LOG), [line, ...(failed ? [oneLine(run.stderr || run.stdout, 2000)] : [])].join('\n') + '\n');
  return { ran: true, agent, model: inv.model, code: run.code, timedOut: run.timedOut, returned, said, line, record: after };
}

// The schedule

/** The command the schedule runs: this program with `away`, from the connector's entry (the executable, or the development command). */
export function awayCommand(entry: ServerEntry): { command: string; args: string[] } {
  return { command: entry.command, args: [...entry.args.slice(0, -1), 'away'] };
}

/** The environment the schedule runs under: the connector entry's quilt variables but the model, which the run declares itself, the home, and a PATH with the places an agent CLI is looked for. */
export function scheduleEnv(entry: ServerEntry, dirs: string[], home: string): Record<string, string> {
  const env = { ...entry.env };
  delete env.QUILT_MODEL;
  return { ...env, QUILT_HOME: home, PATH: dirs.join(delimiter) };
}

/** The launchd user agent: this program's `away` every hour, not at load, with the home in its environment and its output under the home. */
export function plistText(o: { label: string; command: string; args: string[]; home: string; env: Record<string, string> }): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const strings = (xs: string[]) => xs.map((x) => `    <string>${esc(x)}</string>`).join('\n');
  const env = Object.entries(o.env).map(([k, v]) => `    <key>${esc(k)}</key>\n    <string>${esc(v)}</string>`).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key>\n  <string>${esc(o.label)}</string>`,
    `  <key>ProgramArguments</key>\n  <array>\n${strings([o.command, ...o.args])}\n  </array>`,
    '  <key>StartInterval</key>\n  <integer>3600</integer>',
    '  <key>RunAtLoad</key>\n  <false/>',
    `  <key>EnvironmentVariables</key>\n  <dict>\n${env}\n  </dict>`,
    `  <key>StandardOutPath</key>\n  <string>${esc(join(o.home, 'away.out'))}</string>`,
    `  <key>StandardErrorPath</key>\n  <string>${esc(join(o.home, 'away.err'))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** Where the launchd user agent is written. */
export function launchAgentFile(home = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

/** The crontab line for a machine without launchd: the same command at the top of every hour. */
export function crontabLine(command: string, args: string[], home: string): string {
  const q = (s: string) => (/^[\w./:=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return `0 * * * * QUILT_HOME=${q(home)} ${[command, ...args].map(q).join(' ')} >> ${q(join(home, 'away.out'))} 2>> ${q(join(home, 'away.err'))}`;
}

/** Runs launchctl with the arguments; true when it exited 0. */
export type Launchctl = (args: string[]) => boolean;

function launchctl(args: string[]): boolean {
  try {
    execFileSync('launchctl', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const uidHere = () => process.getuid?.() ?? 0;

export interface ScheduleOptions {
  platform?: NodeJS.Platform;
  /** The plist's path; ~/Library/LaunchAgents/<label>.plist when left out. */
  file?: string;
  uid?: number;
  ctl?: Launchctl;
}

export interface Schedule {
  kind: 'launchd' | 'crontab';
  installed: boolean;
  /** Whether launchd has it loaded now; false where there is no launchd. */
  loaded: boolean;
  file: string | null;
  /** The line to add by hand where there is no launchd. */
  crontab: string | null;
}

/** Whether the schedule is in place: on a Mac, the plist and whether launchd has it; elsewhere, the crontab line to add. */
export function scheduleOf(o: ScheduleOptions & { command: string; args: string[]; home: string }): Schedule {
  const platform = o.platform ?? process.platform;
  if (platform !== 'darwin') return { kind: 'crontab', installed: false, loaded: false, file: null, crontab: crontabLine(o.command, o.args, o.home) };
  const file = o.file ?? launchAgentFile();
  const installed = existsSync(file);
  const loaded = installed && (o.ctl ?? launchctl)(['print', `gui/${o.uid ?? uidHere()}/${LAUNCHD_LABEL}`]);
  return { kind: 'launchd', installed, loaded, file, crontab: null };
}

/** The plist written and loaded; one already loaded is unloaded first so launchd reads the new text. */
export function installSchedule(o: { file: string; text: string; uid?: number; ctl?: Launchctl }): { file: string; loaded: boolean } {
  const ctl = o.ctl ?? launchctl;
  const uid = o.uid ?? uidHere();
  mkdirSync(dirname(o.file), { recursive: true });
  writeFileSync(o.file, o.text);
  ctl(['bootout', `gui/${uid}/${LAUNCHD_LABEL}`]);
  return { file: o.file, loaded: ctl(['bootstrap', `gui/${uid}`, o.file]) };
}

/** The agent unloaded and its plist removed. */
export function uninstallSchedule(o: { file: string; uid?: number; ctl?: Launchctl }): { file: string; removed: boolean } {
  (o.ctl ?? launchctl)(['bootout', `gui/${o.uid ?? uidHere()}/${LAUNCHD_LABEL}`]);
  const removed = existsSync(o.file);
  if (removed) unlinkSync(o.file);
  return { file: o.file, removed };
}

// Status and summary

export interface StatusOptions extends ScheduleOptions {
  home: string;
  env: NodeJS.ProcessEnv;
  entry: ServerEntry;
  dirs?: string[];
  exists?: (path: string) => boolean;
  now?: () => Date;
}

export interface AwayStatus extends Schedule {
  agent: Agent | null;
  cap: number;
  day: string;
  today: { runs: number; returned: number };
  last: string | null;
  lastAgent: AgentName | null;
}

/** Whether the schedule is in place, which agent CLI is here, the cap, and today's counts. */
export function awayStatus(o: StatusOptions): AwayStatus {
  const record = readAway(join(o.home, AWAY_FILE), (o.now ?? (() => new Date()))());
  const dirs = o.dirs ?? searchDirs(o.env);
  const { command, args } = awayCommand(o.entry);
  const schedule = scheduleOf({ ...o, command, args });
  return { ...schedule, agent: findAgent(dirs, o.exists), cap: record.cap, day: record.day, today: { runs: record.runs, returned: record.returned }, last: record.last, lastAgent: record.lastAgent };
}

export interface Count { runs: number; returned: number; accepted: number }

export interface AwaySummary {
  today: Count;
  /** The last seven days, today included. */
  week: Count;
  days: ({ day: string } & Count)[];
}

/** A problem's pieces by hash, each with its state: the tracker's where one answered, the core's otherwise. Null where no resolver answered. Nothing is written. */
export async function pieceStates(quilt: Quilt, problem: string): Promise<Map<string, string> | null> {
  if (!isHash(problem)) return null;
  let resolved: Awaited<ReturnType<Quilt['resolver']['resolve']>>;
  try {
    resolved = await quilt.resolver.resolve(parseLink(problem));
  } catch {
    return null;
  }
  if (!resolved) return null;
  const state = quilt.resolver.state(resolved);
  const over = layerByHash(resolved.tracker ? await quilt.layerOf(problem, resolved.tracker) : null);
  return new Map(state.pieces.map((v) => [v.piece.hash, over.get(v.piece.hash)?.state ?? v.state]));
}

/** What the runs did: by day, today, and over the week, with how many of the pieces returned are accepted so far, each problem asked once. */
export async function awaySummary(record: AwayRecord, states: (problem: string) => Promise<Map<string, string> | null>): Promise<AwaySummary> {
  const asked = new Map<string, Map<string, string> | null>();
  const acceptedOf = async (pieces: AwayDay['pieces']) => {
    let n = 0;
    for (const p of pieces) {
      if (!asked.has(p.problem)) asked.set(p.problem, await states(p.problem));
      const st = asked.get(p.problem)?.get(p.piece);
      if (st && ACCEPTED_STATES.includes(st)) n += 1;
    }
    return n;
  };
  const days: AwaySummary['days'] = [];
  for (const [day, d] of Object.entries(record.days).sort(([a], [b]) => a.localeCompare(b))) days.push({ day, runs: d.runs, returned: d.returned, accepted: await acceptedOf(d.pieces) });
  const sum = (xs: Count[]): Count => xs.reduce((a, x) => ({ runs: a.runs + x.runs, returned: a.returned + x.returned, accepted: a.accepted + x.accepted }), { runs: 0, returned: 0, accepted: 0 });
  const todayCount = days.find((d) => d.day === record.day);
  return { today: todayCount ? { runs: todayCount.runs, returned: todayCount.returned, accepted: todayCount.accepted } : { runs: record.runs, returned: record.returned, accepted: 0 }, week: sum(days), days };
}

const pieces = (n: number) => `${n} piece${n === 1 ? '' : 's'}`;
const runs = (n: number) => `${n} run${n === 1 ? '' : 's'}`;

export function summaryText(s: AwaySummary): string {
  return [`Today: ${runs(s.today.runs)}, ${pieces(s.today.returned)} returned, ${s.today.accepted} accepted so far.`, `Last 7 days: ${runs(s.week.runs)}, ${pieces(s.week.returned)} returned, ${s.week.accepted} accepted so far.`].join('\n');
}

export function statusText(s: AwayStatus): string {
  const where = s.kind === 'launchd' ? (s.installed ? `installed (launchd, ${s.file}${s.loaded ? '' : ', not loaded now'})` : 'not installed') : `no launchd here; the crontab line to add:\n  ${s.crontab}`;
  return [
    `Work while away: ${where}`,
    `Agent: ${s.agent ? `${s.agent.name} at ${s.agent.path}` : `none found (${NEEDS_AGENT.toLowerCase().replace(/\.$/, '')})`}`,
    `Cap: ${pieces(s.cap)} a day; today: ${pieces(s.today.returned)} returned in ${runs(s.today.runs)}${s.last ? `; last run ${s.last} by ${s.lastAgent}` : ''}`,
  ].join('\n');
}

// The switch, for the page's /api/away (the menu bar) and the command line alike

/** The status with the summary, as the page answers GET /api/away. */
export interface AwayState extends AwayStatus {
  summary: AwaySummary;
  /** What a switch did, or why it did not; null when nothing was asked. */
  note: string | null;
}

export interface StateOptions extends StatusOptions {
  /** The Quilt the summary reads the problems through. */
  quilt: Quilt;
}

export async function awayState(o: StateOptions, note: string | null = null): Promise<AwayState> {
  const status = awayStatus(o);
  const summary = await awaySummary(readAway(join(o.home, AWAY_FILE), (o.now ?? (() => new Date()))()), (p) => pieceStates(o.quilt, p));
  return { ...status, summary, note };
}

/** The switch: the cap set where one is given, the schedule put in place or taken away where `on` says, and the state after. */
export async function awaySwitch(o: StateOptions & { on?: boolean | undefined; cap?: number | undefined }): Promise<AwayState> {
  let note: string | null = null;
  if (typeof o.cap === 'number') setCap(join(o.home, AWAY_FILE), o.cap);
  if (o.on === true) {
    const dirs = o.dirs ?? searchDirs(o.env);
    const agent = findAgent(dirs, o.exists);
    const { command, args } = awayCommand(o.entry);
    if (!agent) note = NEEDS_AGENT;
    else if ((o.platform ?? process.platform) !== 'darwin') note = `No launchd here. The crontab line to add:\n${crontabLine(command, args, o.home)}`;
    else {
      const file = o.file ?? launchAgentFile();
      const r = installSchedule({ file, text: plistText({ label: LAUNCHD_LABEL, command, args, home: o.home, env: scheduleEnv(o.entry, dirs, o.home) }), ...(o.uid !== undefined ? { uid: o.uid } : {}), ...(o.ctl ? { ctl: o.ctl } : {}) });
      note = r.loaded ? `Installed: ${agent.name} runs one piece an hour, up to ${readAway(join(o.home, AWAY_FILE)).cap} a day. The agent is at ${file}.` : `Written to ${file}, but launchctl did not load it; it loads at the next login.`;
    }
  } else if (o.on === false && (o.platform ?? process.platform) === 'darwin') {
    const r = uninstallSchedule({ file: o.file ?? launchAgentFile(), ...(o.uid !== undefined ? { uid: o.uid } : {}), ...(o.ctl ? { ctl: o.ctl } : {}) });
    note = r.removed ? 'Uninstalled: nothing runs while you are away.' : 'Nothing was installed.';
  }
  return awayState(o, note);
}

/**
 * The command line: `quilt away` runs a turn; `--cap N` sets the cap; `--install` and `--uninstall` are the switch;
 * `--status` and `--summary` say where it stands; `--json` gives any of them as JSON.
 */
export async function awayCli(args: string[], o: Omit<StateOptions, 'quilt'> & { quilt: () => Quilt }): Promise<{ out: string; code: number }> {
  const json = args.includes('--json');
  const file = join(o.home, AWAY_FILE);
  const capAt = args.indexOf('--cap');
  if (capAt >= 0) setCap(file, Number(args[capAt + 1]));
  if (args.includes('--install') || args.includes('--uninstall')) {
    const r = await awaySwitch({ ...o, quilt: o.quilt(), on: args.includes('--install') });
    return { out: json ? JSON.stringify(r, null, 2) : `${r.note ?? ''}\n${statusText(r)}`.trim(), code: 0 };
  }
  if (args.includes('--status')) {
    const s = awayStatus(o);
    return { out: json ? JSON.stringify(s, null, 2) : statusText(s), code: 0 };
  }
  if (args.includes('--summary')) {
    const quilt = o.quilt();
    const s = await awaySummary(readAway(file), (p) => pieceStates(quilt, p));
    return { out: json ? JSON.stringify(s, null, 2) : summaryText(s), code: 0 };
  }
  if (capAt >= 0) {
    const r = readAway(file);
    return { out: json ? JSON.stringify(r, null, 2) : `Cap: ${pieces(r.cap)} a day while away.`, code: 0 };
  }
  const t = await awayTurn(o);
  const failed = t.ran ? t.timedOut || t.code !== 0 : t.line === NEEDS_AGENT;
  return { out: json ? JSON.stringify(t, null, 2) : t.line, code: failed ? 1 : 0 };
}
