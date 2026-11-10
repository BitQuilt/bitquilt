/**
 * NODE.md section 7: bitquilt-node, the node from the environment. Its first imports are the tracker's env.ts and the
 * on-ramp's, which load no store, so Node's notice that its SQLite module is experimental is silenced before the store
 * loads, as the binary's header says. The test starts the binary with the admit role, and with admit and host, waits
 * for its first line, and reads what it wrote to stderr.
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freePort, tempHome } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bin = join(root, 'packages', 'node', 'src', 'bin.ts');

/**
 * Runs the binary until its first `count` lines on stdout, or for a minute at most, then stops it; what it wrote to
 * each stream.
 */
function firstLines(env: NodeJS.ProcessEnv, count = 1): Promise<{ stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', bin], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const limit = setTimeout(() => child.kill(), 60_000);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.split('\n').length > count) child.kill();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', fail);
    child.on('close', () => {
      clearTimeout(limit);
      done({ stdout, stderr });
    });
  });
}

/**
 * The test's own environment without the QUILT_ names, the vendor keys and the two that can hide a warning. The rest
 * stays: Windows needs SystemRoot to open a socket. A developer's QUILT_URL or QUILT_PEERS, or a vendor key, would
 * change a start line, and NODE_OPTIONS or NODE_NO_WARNINGS could keep the warning off stderr whatever the binary
 * imports first. Names are compared in capitals, since Windows reads them without case.
 */
function inherited(): NodeJS.ProcessEnv {
  const left = (name: string): boolean =>
    name.startsWith('QUILT_') ||
    ['NODE_OPTIONS', 'NODE_NO_WARNINGS', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY'].includes(name);
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !left(k.toUpperCase())));
}

describe('bitquilt-node', () => {
  it('starts a door with nothing on stderr: the SQLite notice is silenced before the store loads', async () => {
    const home = tempHome('quilt-node-bin-');
    const port = await freePort();
    const { stdout, stderr } = await firstLines({
      ...inherited(),
      HOME: home,
      QUILT_HOME: home,
      QUILT_ROLES: 'admit',
      QUILT_PORT: String(port),
      QUILT_HOST: '127.0.0.1',
    });
    expect(stdout).toContain(`bitquilt node, roles admit; door at http://localhost:${port}/`);
    expect(stderr).toBe('');
  });

  it("starts a door with the on-ramp the same way, and says the on-ramp's two lines after its own", async () => {
    const home = tempHome('quilt-node-bin-host-');
    const port = await freePort();
    const { stdout, stderr } = await firstLines(
      {
        ...inherited(),
        HOME: home,
        QUILT_HOME: home,
        QUILT_ROLES: 'admit,host',
        QUILT_KEY_SECRET: 'test-secret',
        QUILT_PORT: String(port),
        QUILT_HOST: '127.0.0.1',
      },
      3,
    );
    const url = `http://localhost:${port}/`;
    expect(stdout.split('\n').slice(0, 3)).toEqual([
      `bitquilt node, roles admit, host; door at ${url}; store ${home}/node.db`,
      `addresses at ${url}join; QUILT_OAUTH_SECRET is unset: no OAuth, and an address is its own credential`,
      "the owners' turn runs every hour: the gold due revealed and the proposed pieces taken; no vendor key is set, so no brief is sharpened",
    ]);
    expect(stderr).toBe('');
  });
});
