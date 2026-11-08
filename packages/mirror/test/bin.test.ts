/**
 * NODE.md section 6, the binary and the repository's job, and PROTOCOL.md, The mirror: a run commits only where it
 * refused nothing. bitquilt-mirror exits 0 where it refused nothing and 1 where it refused anything, and the run that
 * exits 1 has written what it took to its folder all the same. A coin log with a credit on it and no chain to check it
 * against is no refusal of its own: the job sets none of the chain's variables, so the binary run without them over
 * balances that reproduce exits 0 with the problems and the coin log written and the balances left out, and prints
 * why. In `.github/workflows/mirror.yml` the step that commits comes after the step that runs the mirror, and nothing
 * in the file sets a condition on a step or lets a failed step pass. GitHub runs a step with no condition only where
 * every step before it succeeded, so what a run that refused anything took never reaches `main`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Unsigned, hashBytes, problemHash, signEvent, signObject } from '@bitquilt/core';
import { VERDICT, addr, key, startTracker } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bin = join(root, 'packages', 'mirror', 'src', 'bin.ts');
const read = (...path: string[]): string => readFileSync(join(root, ...path), 'utf8').replace(/\r\n/g, '\n');

const owner = key(9);
const reader = key(5);
const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }]));
const citesHash = hashBytes(cites);

/** The owner's problem, with one piece and the blob it reads. */
function envelope(): Envelope {
  const problem: Envelope['problem'] = {
    title: 'What the job commits',
    done_when: 'Done.',
    owner: addr(owner),
    slug: 'what-the-job-commits',
    prev: null,
    from: null,
    settings: { challenge_window_h: 0.001, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
    pieces: {
      'cite/*': {
        count: 1,
        verifier: 'agree',
        brief: 'Citation {n}: {cite.s}',
        data: { cite: 'cites.json' },
        schema: VERDICT,
        agree: ['verdict'],
      },
    },
    data: { 'cites.json': citesHash },
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

const env = envelope();
const P = problemHash(env);
/** A problem the second source lists at `/` and serves nowhere, so the mirror refuses its envelope. */
const unserved = hashBytes(new TextEncoder().encode('a problem nobody serves'));

const now = () => '2026-11-07T09:00:00.000Z';
/** The coin's parameters at a home whose coin log holds one credit from the reader they name. */
const coin = {
  genesis: '2026-11-01T00:00:00.000Z',
  epoch_h: 24,
  emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 },
  vesting_h: 48,
  infra_bp: 1000,
  treasury: addr(key(7)),
  unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 },
  burn_rate: 100,
  transfers_from: null,
  redeem_from: null,
  reader: addr(reader),
};
let good: { server: Server; base: string };
let bad: { server: Server; base: string };
let home: { server: Server; base: string };

/** The owner's problem published at `base`, with the blob it reads. */
async function publish(base: string): Promise<void> {
  const published = await fetch(`${base}p`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ envelope: env, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } }),
  });
  expect(published.status).toBe(201);
}

beforeAll(async () => {
  good = await startTracker(now);
  await publish(good.base);
  home = await startTracker(now, { coin });
  await publish(home.base);
  const credit: Unsigned = {
    quilt: 1,
    type: 'credit',
    key: addr(reader),
    ts: now(),
    body: { deposit: 1, root: addr(owner), amount: 100 },
  };
  const credited = await fetch(`${home.base}coin/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signEvent(credit, reader)),
  });
  expect(credited.status, await credited.clone().text()).toBe(202);
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ problems: [{ problem: unserved }] }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not here' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const a = server.address();
  bad = { server, base: typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '' };
});
afterAll(async () => {
  for (const s of [good, bad, home]) await new Promise<void>((r) => s.server.close(() => r()));
});

/**
 * The test's own environment without the QUILT_ and BITQUILT_ names, since a developer's BITQUILT_TRACKERS or
 * QUILT_CHAIN_RPC would change the run. Names are compared in capitals, since Windows reads them without case.
 */
function inherited(): NodeJS.ProcessEnv {
  const left = (name: string): boolean => name.startsWith('QUILT_') || name.startsWith('BITQUILT_');
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !left(k.toUpperCase())));
}

/** Runs the binary over the sources into a folder of its own, and answers its exit code, its stdout and the folder. */
function run(sources: string[]): Promise<{ code: number | null; stdout: string; out: string }> {
  const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-bin-'));
  return new Promise((done, fail) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', bin, '--trackers', sources.join(','), '--out', out, '--no-peers'],
      { cwd: root, env: inherited(), stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const limit = setTimeout(() => child.kill(), 60_000);
    let stdout = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(limit);
      done({ code, stdout, out });
    });
  });
}

describe('bitquilt-mirror', () => {
  it('is what the job runs: the mirror package starts this file', () => {
    const json = JSON.parse(read('packages', 'mirror', 'package.json')) as { scripts: Record<string, string> };
    expect(json.scripts.start).toBe('tsx src/bin.ts');
  });

  it('exits 0 where it refused nothing', async () => {
    const { code, stdout, out } = await run([good.base]);
    expect(stdout).toContain(`${P}: 0 lines, 0 new`);
    expect(stdout).not.toContain('refused:');
    expect(code).toBe(0);
    expect(existsSync(join(out, 'problems', `${P}.json`))).toBe(true);
  });

  it('exits 1 where it refused anything, with what it took written to its folder all the same', async () => {
    const { code, stdout, out } = await run([good.base, bad.base]);
    expect(stdout).toContain(`refused: ${unserved}: envelope from ${bad.base} does not check`);
    expect(code).toBe(1);
    expect(existsSync(join(out, 'problems', `${P}.json`))).toBe(true);
  });

  it('exits 0 where the coin log holds a credit and no chain is named, with the balances left out and why', async () => {
    const { code, stdout, out } = await run([home.base]);
    expect(stdout).toContain(
      `coin: the balances at head 1 from ${home.base} are not kept: 1 credit on the ledger and no chain to check it against\n`,
    );
    expect(stdout).not.toContain('refused:');
    expect(stdout).not.toContain('checked against the chain');
    expect(code).toBe(0);
    expect(existsSync(join(out, 'problems', `${P}.json`))).toBe(true);
    expect(existsSync(join(out, 'ledger', `${P}.jsonl`))).toBe(true);
    expect(readFileSync(join(out, 'ledger', 'coin.jsonl'), 'utf8')).toContain('"type":"credit"');
    expect(existsSync(join(out, 'coin', 'balances.json'))).toBe(false);
  });
});

describe("the repository's job (.github/workflows/mirror.yml)", () => {
  const yml = read('.github', 'workflows', 'mirror.yml');
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l.trim() === 'steps:');
  // A step begins where a line at the steps' own indent opens with a dash.
  const indent = lines[start + 1]!.indexOf('- ');
  const steps: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l.indexOf('- ') === indent && l.slice(0, indent).trim() === '') steps.push(l);
    else if (steps.length) steps[steps.length - 1] += `\n${l}`;
  }

  it('commits after the mirror runs, the folder the mirror wrote, as its last step', () => {
    const mirrorStep = steps.findIndex((s) => s.includes('pnpm --filter @bitquilt/mirror start'));
    const commitStep = steps.findIndex((s) => s.includes('name: commit what grew'));
    expect(mirrorStep).toBeGreaterThan(-1);
    expect(commitStep).toBe(mirrorStep + 1);
    expect(commitStep).toBe(steps.length - 1);
    expect(steps[mirrorStep]).toContain('--out "$GITHUB_WORKSPACE/mirror"');
    expect(steps[commitStep]).toContain('git add mirror');
  });

  it("sets none of the chain's variables, so the run is the binary's with no chain to ask", () => {
    for (const name of ['QUILT_CHAIN_RPC', 'QUILT_CHAIN_ID', 'QUILT_CONTRACTS']) expect(yml).not.toContain(name);
  });

  it('sets no condition on a step and lets no failed step pass, so a run that exits 1 commits nothing', () => {
    for (const s of steps) expect(s).not.toMatch(/^\s*(- )?if:/m);
    expect(yml).not.toContain('continue-on-error');
    // The job's one condition is the variable that names the sources.
    expect(lines.filter((l) => /^\s*if:/.test(l)).map((l) => l.trim())).toEqual([
      "if: ${{ vars.BITQUILT_TRACKERS != '' }}",
    ]);
  });
});
