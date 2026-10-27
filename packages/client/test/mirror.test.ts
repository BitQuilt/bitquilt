import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import { mirror } from '@bitquilt/mirror';
import { DEFAULT_CONFIG, createKey, loadKey } from '../src/config.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { hex, quiltOver, startTracker, tempHome } from './helpers.js';

/** A mirror as GitHub would serve it: the files, raw, over HTTP. */
function serveDir(dir: string): Promise<{ server: Server; base: string }> {
  const server = createServer((req, res) => {
    const file = join(dir, decodeURIComponent((req.url ?? '/').split('?')[0]!));
    if (!existsSync(file) || statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200);
    res.end(readFileSync(file));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const a = server.address();
    resolve({ server, base: typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '' });
  }));
}

let tracker: Server, files: Server, trackerBase: string, mirrorBase: string;
const out = tempHome('bitquilt-mirror-dir-');
const readerHome = tempHome('quilt-r-');
let hash: Hash;
let link: string;

beforeAll(async () => {
  ({ server: tracker, base: trackerBase } = await startTracker({ url: 'http://t.test/' }));
  const owner = quiltOver(trackerBase)(9);
  const pattern: Pattern = { title: 'Mirrored', done_when: 'Done.', slug: 'mirrored', pieces: { 'cite/*': { count: 2, verifier: 'agree', brief: 'Citation {n}: {cite.s}', data: { cite: 'cites' }, schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } } } }, data: { cites: [{ s: 'one' }, { s: 'two' }] } };
  const r = await owner.publish(pattern);
  hash = r.hash;
  link = r.link;
  await mirror({ trackers: [trackerBase], out });
  const f = await serveDir(out);
  files = f.server;
  mirrorBase = f.base;
});
afterAll(async () => {
  await new Promise<void>((r) => tracker.close(() => r()));
  await new Promise<void>((r) => files.close(() => r()));
});

describe('reading from a mirror alone', () => {
  it('resolves a problem by hash, and by name, with no tracker answering', async () => {
    const config = { ...DEFAULT_CONFIG, trackers: ['http://127.0.0.1:1/'], mirrors: [mirrorBase] };
    createKey(readerHome, { secretHex: hex(1) });
    const reader = new Quilt(config, loadKey(readerHome), new Resolver(config, readerHome), 'Claude Code');
    const opened = await reader.open(hash);
    expect(opened.tracker).toBeNull();
    expect(opened.state.envelope.problem.title).toBe('Mirrored');
    expect(opened.state.pieces.map((v) => v.state)).toEqual(['open', 'open']);
    const owner = JSON.parse(readFileSync(join(out, 'problems', `${hash}.json`), 'utf8')).problem.owner as string;
    const byName = await reader.open(`quilt:${owner}/mirrored`);
    expect(byName.hash).toBe(hash);
    void link;
  });
  it('works a piece from the mirror and queues the events for a tracker', async () => {
    const config = { ...DEFAULT_CONFIG, trackers: ['http://127.0.0.1:1/'], mirrors: [mirrorBase] };
    const reader = new Quilt(config, loadKey(readerHome), new Resolver(config, readerHome), 'Claude Code');
    const { pick, posted } = await reader.next(hash);
    expect(pick.piece.family).toBe('cite');
    expect(posted.queued).toBe(true);
    const r = await reader.return(hash, pick.piece.hash, { verdict: 'supports' });
    expect(r.commit.queued && r.reveal.queued).toBe(true);
    expect(reader.resolver.queued()).toBe(3);
  });
});
