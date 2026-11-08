/**
 * bitquilt-hosted, the door with the on-ramp from the environment (packages/hosted/src/bin.ts). Its first imports are
 * the tracker's env.ts and the on-ramp's, which load no store, so Node's notice that its SQLite module is experimental
 * is silenced before the store loads, as the binary's header says. The test starts the binary, reads its three start
 * lines and what it wrote to stderr, and starts it once more without the key secret, which it refuses in its own words.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bin = join(root, 'packages', 'hosted', 'src', 'bin.ts');

/** A port nothing listens on, from the system. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => done(port));
    });
  });
}

/**
 * Runs the binary until it has written `lines` lines on stdout or has exited, or for a minute at most, then stops it;
 * what it wrote to each stream, and its exit code where it exited by itself.
 */
function run(env: NodeJS.ProcessEnv, lines: number): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', bin], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const limit = setTimeout(() => child.kill(), 60_000);
    let stdout = '';
    let stderr = '';
    let stopped = false;
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.split('\n').length > lines) {
        stopped = true;
        child.kill();
      }
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(limit);
      done({ stdout, stderr, code: stopped ? null : code });
    });
  });
}

/**
 * The test's own environment without the QUILT_ names, the vendor keys and the two that can hide a warning, so a
 * developer's settings change no line; the rest stays, since Windows needs SystemRoot to open a socket.
 */
function inherited(): NodeJS.ProcessEnv {
  const left = (name: string): boolean =>
    name.startsWith('QUILT_') ||
    ['NODE_OPTIONS', 'NODE_NO_WARNINGS', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].includes(name);
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !left(k.toUpperCase())));
}

describe('bitquilt-hosted', () => {
  it('starts the door and the on-ramp with nothing on stderr, and says what it runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hosted-bin-'));
    const port = await freePort();
    const { stdout, stderr } = await run(
      {
        ...inherited(),
        HOME: dir,
        QUILT_KEY_SECRET: 'test-secret',
        QUILT_PORT: String(port),
        QUILT_HOST: '127.0.0.1',
        QUILT_DB: join(dir, 'tracker.db'),
        QUILT_HOSTED_HOME: join(dir, 'hosted'),
      },
      3,
    );
    const url = `http://localhost:${port}/`;
    expect(stdout.split('\n').slice(0, 3)).toEqual([
      `bitquilt tracker with the hosted on-ramp at ${url} (db ${join(dir, 'tracker.db')}; addresses at ${url}join)`,
      'QUILT_OAUTH_SECRET is unset: no OAuth, and an address is its own credential',
      "the owners' turn runs every hour: the gold due revealed; no vendor key is set, so no brief is sharpened",
    ]);
    expect(stderr).toBe('');
  });

  it('refuses to start without the key secret', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hosted-bin-'));
    const { stdout, stderr, code } = await run({ ...inherited(), HOME: dir, QUILT_DB: join(dir, 'tracker.db') }, 1);
    expect(code).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toBe('QUILT_KEY_SECRET is required: the keys this tracker holds are encrypted with it\n');
  });
});
