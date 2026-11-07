/**
 * WORKSHOP.md section 2, one peer: bitquilt-node, the node from the environment. Its first import is the tracker's
 * env.ts, which loads no store, so Node's notice that its SQLite module is experimental is silenced before the store
 * loads, as the binary's header says. The test starts the binary with the admit role, waits for its first line, and
 * reads what it wrote to stderr.
 */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { freePort, tempHome } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const bin = join(root, 'packages', 'node', 'src', 'bin.ts');

/** Runs the binary until its first line on stdout, or for a minute at most, then stops it; what it wrote to each stream. */
function firstLine(env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ['--import', 'tsx', bin], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const limit = setTimeout(() => child.kill(), 60_000);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      if (stdout.includes('\n')) child.kill();
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

describe('bitquilt-node', () => {
  it('starts a door with nothing on stderr: the SQLite notice is silenced before the store loads', async () => {
    const home = tempHome('quilt-node-bin-');
    const port = await freePort();
    const { stdout, stderr } = await firstLine({ PATH: process.env.PATH, HOME: home, QUILT_HOME: home, QUILT_ROLES: 'admit', QUILT_PORT: String(port), QUILT_HOST: '127.0.0.1' });
    expect(stdout).toContain(`bitquilt node, roles admit; door at http://localhost:${port}/`);
    expect(stderr).toBe('');
  });
});
