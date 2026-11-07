/**
 * The lines `quilt init` prints (bin.ts), which two programs read by position. deploy/house.sh keeps the first line of
 * the output, stdout and stderr together, and drops the rest, so the address reaches the docker log and the twelve
 * words do not. apps/mac's Node.swift takes the line after the one starting "Phrase" as the words, and says the key is
 * home when a line starts "The key came home". The command runs here as a person runs it, into a temporary home.
 */
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addressOf, isPhrase, secretFromHex, secretKeyFromPhrase } from '@bitquilt/core';
import { hex, tempHome } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** `quilt init` with these arguments into a fresh home: its exit code and its output, stdout and stderr in one file as `2>&1` writes them. */
async function init(args: string[]): Promise<{ code: number | null; lines: string[] }> {
  const home = tempHome('quilt-init-');
  const file = join(home, 'out.txt');
  const fd = openSync(file, 'w');
  try {
    const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'packages', 'client', 'src', 'bin.ts'), 'init', ...args], { cwd: root, env: { ...process.env, QUILT_HOME: home }, stdio: ['ignore', fd, fd] });
    const code = await new Promise<number | null>((done, fail) => child.on('error', fail).on('exit', done));
    return { code, lines: readFileSync(file, 'utf8').split('\n') };
  } finally {
    closeSync(fd);
  }
}

describe('quilt init', () => {
  it('prints the address on the first line, then a line starting "Phrase" and the twelve words of that key on the next', async () => {
    const { code, lines } = await init([]);
    expect(code).toBe(0);
    const address = /^Address: (0x[0-9a-fA-F]{40})$/.exec(lines[0] ?? '')?.[1];
    expect(address).toBeDefined();
    expect(lines[1]).toMatch(/^Phrase/);
    const words = lines[2]!.trim();
    expect(words.split(' ')).toHaveLength(12);
    expect(isPhrase(words)).toBe(true);
    expect(addressOf(secretKeyFromPhrase(words))).toBe(address);
    expect(lines.some((l) => l.startsWith('The key came home'))).toBe(false);
  });

  it('with --from, prints the address of the key brought home first, no phrase, and a line starting "The key came home"', async () => {
    // A tracker's hosted address as the on-ramp answers it (/join): its key, handed over once at <address>/key.
    const secret = hex(7);
    const server = createServer((req, res) => {
      res.writeHead(req.url === '/a/0xabc/key' ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(req.url === '/a/0xabc/key' ? { secret } : { error: 'no such address' }));
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      const { code, lines } = await init(['--from', `http://127.0.0.1:${port}/a/0xabc/`]);
      expect(code).toBe(0);
      expect(lines[0]).toBe(`Address: ${addressOf(secretFromHex(secret))}`);
      expect(lines.some((l) => l.startsWith('Phrase'))).toBe(false);
      expect(lines.some((l) => l.startsWith('The key came home'))).toBe(true);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });
});
