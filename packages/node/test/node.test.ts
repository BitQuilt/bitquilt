import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import { createKey } from 'quilt';
import { type Node, start } from '../src/node.js';
import { freePort, hex, json, lines, pattern, readerOver, tempHome } from './helpers.js';

/**
 * WORKSHOP.md section 2, one peer, stage three: one node with roles over one store. A node with admit, work and keep
 * publishes through its own door and serves the same lines from its page, since the door's store is the store the
 * node keeps in and serves from; a second node with admit and keep, naming the first as its peer, takes the problem
 * by its envelope and folds the first's readings through its own door (QX-21); a node with work alone has no door and
 * keeps what it opens in its own store; host is a role beside admit, and a role that is not one is refused at start.
 */
let a: Node, b: Node, c: Node;
let urlA: string, urlB: string, pageA: number, pageC: number;
let problem: Hash;
const limits = { keyPerHour: 1000, ipPerHour: 10_000 };

beforeAll(async () => {
  const [pA, pB, pgA, pgC] = await Promise.all([freePort(), freePort(), freePort(), freePort()]);
  urlA = `http://127.0.0.1:${pA}/`;
  urlB = `http://127.0.0.1:${pB}/`;
  pageA = pgA!;
  pageC = pgC!;
  const homeA = tempHome('quilt-node-a-');
  createKey(homeA, { secretHex: hex(1) });
  a = await start({ home: homeA, roles: ['admit', 'work', 'keep'], door: { port: pA!, url: urlA, limits }, page: { port: pageA, trackers: [urlA] }, loops: false });
  b = await start({ home: tempHome('quilt-node-b-'), roles: ['admit', 'keep'], door: { port: pB!, url: urlB, peers: [urlA], limits }, loops: false });
  const homeC = tempHome('quilt-node-c-');
  createKey(homeC, { secretHex: hex(3) });
  c = await start({ home: homeC, roles: ['work'], page: { port: pageC, trackers: [urlA] }, loops: false });
});
afterAll(async () => {
  await Promise.all([a.close(), b.close(), c.close()]);
});

describe('one node with roles (WORKSHOP.md section 2, stage three)', () => {
  it('with admit, work and keep: publishes through its own door, and the page serves the same lines from the same store', async () => {
    expect(a.tracker).not.toBeNull();
    expect(a.quilt).not.toBeNull();
    expect(existsSync(join(a.home, 'node.db'))).toBe(true);
    const published = await a.quilt!.publish(pattern);
    problem = published.hash;
    expect(published.posted).toEqual([urlA]);
    const atDoor = await lines(`${urlA}p/${problem}/events`);
    expect(atDoor.map((l) => l.event.type)).toEqual(['announce', 'version']);
    expect(await lines(`http://127.0.0.1:${pageA}/p/${problem}/events`)).toEqual(atDoor);
    expect(a.resolver.cachedReceipts(problem)).toHaveLength(2);
    expect(a.store.held()).toMatchObject({ problems: 1, ledgers: 1, blobs: 1 });
    const held = await json<{ node: boolean; problems: { problem: Hash; lines: number }[] }>(`http://127.0.0.1:${pageA}/held`);
    expect(held).toMatchObject({ node: true, problems: [{ problem, lines: 2 }] });
    // Opening its own problem reads the door's chain, which is the chain kept: nothing is added and nothing refused.
    const opened = await a.quilt!.open(problem);
    expect(opened.state.pieces).toHaveLength(2);
    const kept = await a.keep();
    expect(kept.kept).toMatchObject({ problems: 1, added: 0, refused: [] });
    expect(kept.pulls).toEqual([]);
    expect(await lines(`${urlA}p/${problem}/events`)).toHaveLength(2);
  });
  it('with admit and keep, naming the first as its peer: takes the problem by its envelope and folds the readings on the first through its own door', async () => {
    expect(b.quilt).toBeNull();
    expect(b.page).toBeNull();
    const envelope = await json<{ problem: { data: Record<string, Hash> } }>(`${urlA}p/${problem}`);
    const blobs: Record<string, string> = {};
    for (const h of Object.values(envelope.problem.data)) blobs[h] = Buffer.from(await (await fetch(`${urlA}b/${h}`)).arrayBuffer()).toString('base64');
    expect((await fetch(`${urlB}p`, { method: 'POST', body: JSON.stringify({ envelope, blobs }), headers: { 'content-type': 'application/json' } })).status).toBe(201);
    const reader = readerOver(urlA, 2);
    const piece = (await reader.open(problem)).state.pieces[0]!.piece.hash;
    await reader.return(problem, piece, { verdict: 'supports', quote: 'q' });
    const { pulls } = await b.keep();
    expect(pulls).toHaveLength(1);
    expect(pulls[0]).toMatchObject({ peer: urlA, refused: [], errors: [] });
    expect(pulls[0]!.added).toBeGreaterThanOrEqual(4);
    const mine = await lines(`${urlB}p/${problem}/events`);
    const theirs = await lines(`${urlA}p/${problem}/events`);
    expect(mine.map((l) => l.event.sig)).toEqual(theirs.map((l) => l.event.sig));
    for (const l of mine) expect(l.received.map((w) => w.by)).toEqual([urlA, urlB]);
    expect(b.store.held().problems).toBe(1);
    expect(b.resolver.heldProblems()).toMatchObject([{ problem, lines: mine.length }]);
  });
  it("with keep alone: the mirror's pull over its own store, from the sources given, the lines carrying the source's wrapper and this node's; a second keep adds nothing", async () => {
    const k = await start({ home: tempHome('quilt-node-k-'), roles: ['keep'], sources: [urlA], by: 'keeper', loops: false });
    try {
      expect(k.tracker).toBeNull();
      expect(k.page).toBeNull();
      const first = await k.keep();
      expect(first.pulls).toEqual([]);
      expect(first.swarm).not.toBeNull();
      expect(first.swarm!.sources).toEqual([urlA]);
      expect(first.swarm!.problems.map((p) => p.hash)).toEqual([problem]);
      expect(first.swarm!.refused).toEqual([]);
      const theirs = await lines(`${urlA}p/${problem}/events`);
      expect(first.swarm!.problems[0]!.added).toBe(theirs.length);
      const mine = k.store.lines(problem);
      expect(mine.map((l) => l.event.sig)).toEqual(theirs.map((l) => l.event.sig));
      for (const l of mine) expect(l.received.map((w) => w.by)).toEqual([urlA, 'keeper']);
      expect(k.store.held().problems).toBe(1);
      expect(k.resolver.heldProblems()).toMatchObject([{ problem, lines: theirs.length }]);
      const again = await k.keep();
      expect(again.swarm!.problems[0]).toMatchObject({ hash: problem, added: 0 });
    } finally {
      await k.close();
    }
  });
  it('with work alone: no door, a page that says it is a node, and what it opens kept in its own store', async () => {
    expect(c.tracker).toBeNull();
    expect(c.door).toBeNull();
    expect(await json(`http://127.0.0.1:${pageC}/.well-known/quilt`)).toMatchObject({ quilt: 1, node: true });
    expect(await json(`http://127.0.0.1:${pageC}/held`)).toMatchObject({ problems: [] });
    await c.quilt!.open(problem);
    expect(c.store.held().problems).toBe(1);
    expect(await lines(`http://127.0.0.1:${pageC}/p/${problem}/events`)).toEqual(await lines(`${urlA}p/${problem}/events`));
  });
  it('host is a role beside admit, and a word that is not a role is refused at start', async () => {
    await expect(start({ home: tempHome('quilt-node-x-'), roles: ['host'], loops: false })).rejects.toThrow('host is a role beside admit');
    await expect(start({ home: tempHome('quilt-node-y-'), roles: ['admit'], loops: false })).rejects.toThrow('admit needs a door');
    await expect(start({ home: tempHome('quilt-node-z-'), roles: ['mirror' as 'keep'], loops: false })).rejects.toThrow('mirror is not a role');
    const port = await freePort();
    const h = await start({ home: tempHome('quilt-node-h-'), roles: ['admit', 'host'], door: { port, url: `http://127.0.0.1:${port}/`, limits }, host: { keySecret: 'test-secret' }, loops: false });
    try {
      expect(h.hosted).not.toBeNull();
      expect(await json(`http://127.0.0.1:${port}/.well-known/quilt`)).toMatchObject({ hosted: true });
      expect((await fetch(`http://127.0.0.1:${port}/join`)).status).toBe(200);
    } finally {
      await h.close();
    }
  });
});
