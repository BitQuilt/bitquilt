/**
 * The house's first pass after a start (deploy/house.sh; docs/DEPLOY.md, "The house second opinion"). A deploy starts
 * the houses beside the tracker, and the first pass used to run before the tracker listened, fail with ECONNREFUSED,
 * and leave the next pass five minutes off. The loop now asks the tracker for GET /.well-known/quilt every two seconds
 * and runs the first pass once it answers, or once HOUSE_TRACKER_WAIT seconds have passed; a stop inside the wait runs
 * no pass. Each test runs house.sh itself, copied into a folder of its own beside a worker that writes down when it
 * ran, against a tracker that opens late, never opens, or is up from the start. The loop needs a POSIX sh, its signals
 * and process groups, so the tests skip on Windows.
 */
import { type ChildProcess, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tempHome } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** What stands in for examples/worker-claude.mjs: it writes the time it ran into ran.txt in the folder, and exits. */
const WORKER = `import { appendFileSync } from 'node:fs';
appendFileSync(new URL('../ran.txt', import.meta.url), Date.now() + '\\n');
`;

const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A port nothing listens on yet: one the system handed out and took back. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

/** A tracker's well-known on this port: it answers every GET with an empty document and keeps when each one came. */
async function tracker(port: number): Promise<{ server: Server; asked: number[]; opened: number }> {
  const asked: number[] = [];
  const server = createServer((req, res) => {
    if (req.url === '/.well-known/quilt') asked.push(Date.now());
    res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
  });
  await new Promise<void>((done) => server.listen(port, '127.0.0.1', done));
  return { server, asked, opened: Date.now() };
}

interface House {
  child: ChildProcess;
  started: number;
  /** What the loop printed, stdout and stderr together. */
  log: () => string;
  /** The times the worker ran, once it has run, or [] after `within` milliseconds. */
  ran: (within: number) => Promise<number[]>;
  /** The loop's exit code, or null when it has not exited within `within` milliseconds. */
  exited: (within: number) => Promise<number | null>;
  /** Ends the loop and whatever it left sleeping. */
  end: () => void;
}

/**
 * house.sh in a folder of its own, as the compose file runs it: its key already made, so the first run's init and
 * name are not part of it, and `quilt flush` as `true`. One pass and then an hour's sleep, which the test ends.
 */
function startHouse(trackerUrl: string, wait: number): House {
  const dir = tempHome('quilt-house-');
  for (const sub of ['deploy', 'examples', 'home']) mkdirSync(join(dir, sub));
  copyFileSync(join(root, 'deploy', 'house.sh'), join(dir, 'deploy', 'house.sh'));
  writeFileSync(join(dir, 'examples', 'worker-claude.mjs'), WORKER);
  writeFileSync(join(dir, 'home', 'key'), '');
  const env = {
    PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`,
    ANTHROPIC_API_KEY: 'test',
    HOUSE_VENDOR: 'anthropic',
    HOUSE_EVERY: '3600',
    HOUSE_TRACKER_WAIT: String(wait),
    QUILT_TRACKERS: trackerUrl,
    QUILT_HOME: join(dir, 'home'),
    QUILT_BIN: 'true',
  };
  const started = Date.now();
  const child = spawn('sh', [join(dir, 'deploy', 'house.sh')], {
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout!.on('data', (chunk) => (out += chunk));
  child.stderr!.on('data', (chunk) => (out += chunk));
  const exit = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
  const ranFile = join(dir, 'ran.txt');
  return {
    child,
    started,
    log: () => out,
    async ran(within) {
      for (const until = Date.now() + within; Date.now() < until && !existsSync(ranFile); ) await pause(100);
      return existsSync(ranFile) ? readFileSync(ranFile, 'utf8').trim().split('\n').map(Number) : [];
    },
    exited: (within) => Promise.race([exit, pause(within).then(() => null)]),
    end() {
      try {
        process.kill(-child.pid!, 'SIGKILL');
      } catch {
        // The group is already gone.
      }
    },
  };
}

describe.skipIf(process.platform === 'win32')("the house's first pass after a start", () => {
  it('waits for a tracker that opens late, and runs once it answers', async () => {
    const port = await freePort();
    const house = startHouse(`http://127.0.0.1:${port}/`, 60);
    try {
      await pause(3000);
      expect(await house.ran(0)).toEqual([]);
      const { server, asked, opened } = await tracker(port);
      const [ran] = await house.ran(30_000);
      expect(ran).toBeGreaterThanOrEqual(opened);
      expect(ran! - opened).toBeLessThan(20_000);
      expect(asked.length).toBeGreaterThan(0);
      expect(asked[0]).toBeLessThanOrEqual(ran!);
      expect(house.log()).not.toContain('has not answered');
      // A stop between passes reaches the loop as TERM, as docker sends it to the container's first process alone.
      process.kill(house.child.pid!, 'SIGTERM');
      expect(await house.exited(10_000)).toBe(0);
      server.close();
    } finally {
      house.end();
    }
  });

  it('runs the pass all the same once HOUSE_TRACKER_WAIT seconds pass with no answer', async () => {
    const port = await freePort();
    const house = startHouse(`http://127.0.0.1:${port}/`, 4);
    try {
      const [ran] = await house.ran(30_000);
      // The wait counts whole seconds of the clock, so four of them are more than three of real time.
      expect(ran! - house.started).toBeGreaterThan(3000);
      expect(house.log()).toMatch(
        new RegExp(
          `http://127\\.0\\.0\\.1:${port}/ has not answered in \\d+ seconds; the first pass runs all the same`,
        ),
      );
    } finally {
      house.end();
    }
  });

  it('runs at once where the tracker already answers', async () => {
    const port = await freePort();
    const { server, asked } = await tracker(port);
    const house = startHouse(`http://127.0.0.1:${port}/`, 60);
    try {
      const [ran] = await house.ran(30_000);
      expect(ran! - house.started).toBeLessThan(10_000);
      expect(asked).toHaveLength(1);
      expect(house.log()).not.toContain('has not answered');
    } finally {
      house.end();
      server.close();
    }
  });

  it('ends on a stop inside the wait, with no pass run', async () => {
    const port = await freePort();
    const house = startHouse(`http://127.0.0.1:${port}/`, 60);
    try {
      await pause(1500);
      process.kill(house.child.pid!, 'SIGTERM');
      expect(await house.exited(10_000)).toBe(0);
      expect(await house.ran(0)).toEqual([]);
      expect(house.log()).not.toContain('the first pass runs');
    } finally {
      house.end();
    }
  });
});
