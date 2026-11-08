/**
 * The client's node as keeper (NODE.md section 4; PROTOCOL.md, The mirror): a node that opened a problem holds its
 * chain, and `keep` pulls it again from where it is held, keeps the lines that came since, fetches the read a trace
 * names so the node serves it, and keeps the identity log; a second tracker's chain for the same problem, with other
 * events in another order, is read for the state it gives and not kept, since a node follows one place's chain per
 * problem; the identity log is one place's too, so a name the second tracker holds alone is not kept
 * (NODE.md section 4); a second keep adds nothing; and what waited in the queue while no tracker answered goes out at
 * the start of a keep (APP.md, the node). A trace whose reads are not a list, or hold a read that is not an object, is
 * written to a tracker's store directly, since the door refuses it; the node holds it on its chain, fetches only the
 * reads it names by a hash, and goes on to the problems after it and the identity log, as the section's step 3 says.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, type Receipt, eventId, hashBytes, signEvent } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { type Pattern, Quilt } from '../src/quilt.js';
import { baseOf, quiltOver, startTracker } from './helpers.js';

let one: Server, two: Server;
let base: string, other: string;
let owner: Quilt, a: Quilt, b: Quilt, node: Quilt;
let problem: Hash, piece: Hash;

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'paper-says',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: does the paper say so?',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict'],
        properties: { verdict: { enum: ['supports', 'contradicts'] } },
      },
      agree: ['verdict'],
    },
  },
};
const enc = new TextEncoder();
const PAGE = 'We define an electronic coin as a chain of digital signatures.';
const pageHash = hashBytes(enc.encode(PAGE));

beforeAll(async () => {
  ({ server: one, base } = await startTracker());
  ({ server: two, base: other } = await startTracker());
  const mk = quiltOver(base);
  owner = mk(9);
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  node = mk(5);
  problem = (await owner.publish(pattern)).hash;
  piece = (await node.open(problem)).state.pieces[0]!.piece.hash;
});
afterAll(async () => {
  await new Promise<void>((r) => one.close(() => r()));
  await new Promise<void>((r) => two.close(() => r()));
});

const linesAt = async (tracker: string): Promise<Receipt[]> =>
  (await (await fetch(`${tracker}p/${problem}/events`)).text())
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Receipt);

describe('the node keeps what it holds', () => {
  it('pulls the lines that came since it opened the problem, fetches the read a trace names, and serves both; a second keep adds nothing', async () => {
    // The publish put an announce and a version on the chain; the node holds those two from its open.
    expect(node.resolver.heldProblems().find((p) => p.problem === problem)!.lines).toBe(2);
    await a.return(problem, piece, { verdict: 'supports' });
    // A's trace, resting the verdict on a page the tracker holds; signed with A's key and posted by hand, since the
    // node under test is not A.
    expect((await fetch(`${base}b/${pageHash}`, { method: 'PUT', body: enc.encode(PAGE) })).status).toBe(202);
    const reveal = (await linesAt(base)).find(
      (l) => l.event.type === 'reveal' && l.event.key === a.identity!.address,
    )!.event;
    const trace = signEvent(
      {
        quilt: 1,
        type: 'trace',
        problem,
        piece,
        key: a.identity!.address,
        ts: new Date().toISOString(),
        body: {
          reveal: eventId(reveal),
          reads: [{ url: 'https://example.org/paper', hash: pageHash, at: new Date().toISOString() }],
          rests: [{ field: 'verdict', read: 0, span: [0, 24] }],
        },
      },
      a.identity!.secret,
    );
    expect(
      (
        await fetch(`${base}p/${problem}/events`, {
          method: 'POST',
          body: JSON.stringify(trace),
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(202);
    expect(node.resolver.cachedBlob(pageHash)).toBeNull();
    const kept = await node.resolver.keep();
    expect(kept).toMatchObject({ problems: 1, added: 3, reads: 1, refused: [] });
    expect(node.resolver.heldProblems().find((p) => p.problem === problem)!.lines).toBe(5);
    expect(node.resolver.cachedReceipts(problem).map((l) => l.event.type)).toEqual([
      'announce',
      'version',
      'commit',
      'reveal',
      'trace',
    ]);
    expect(new TextDecoder().decode(node.resolver.cachedBlob(pageHash)!)).toBe(PAGE);
    expect(await node.resolver.keep()).toMatchObject({ problems: 1, added: 0, reads: 0, refused: [] });
  });

  it("keeps the identity log too, and reads another tracker's chain for the same problem without keeping it, since it follows one place's chain", async () => {
    await owner.setName('Ada');
    const before = node.resolver.cachedIdentity().length;
    expect((await node.resolver.keep()).added).toBe(1);
    expect(node.resolver.cachedIdentity().length).toBe(before + 1);
    // The same problem on a second tracker, with B's reading there alone: its chain has other events in another order.
    const env = (await (await fetch(`${base}p/${problem}`)).json()) as unknown;
    expect(
      (
        await fetch(`${other}p`, {
          method: 'POST',
          body: JSON.stringify({ envelope: env }),
          headers: { 'content-type': 'application/json' },
        })
      ).status,
    ).toBe(201);
    const bOnTwo = quiltOver(other)(2, 'openai/gpt-5', 'ChatGPT');
    await bOnTwo.return(problem, piece, { verdict: 'supports' });
    const opened = await node.open(`quilt:${problem}?tr=${encodeURIComponent(other)}`);
    expect(opened.tracker).toBe(other);
    expect(opened.state.pieces[0]!.reveals.map((r) => r.root)).toEqual([b.identity!.address]);
    // Read, not kept: the cache still holds the first tracker's chain, and a keep pointed at the second says why.
    expect(node.resolver.cachedReceipts(problem).map((l) => l.event.type)).toEqual([
      'announce',
      'version',
      'commit',
      'reveal',
      'trace',
    ]);
    const notes: string[] = [];
    const read = await node.resolver.receipts(
      problem,
      { hash: problem, trackers: [other], mirrors: [] },
      problem,
      (line) => notes.push(line),
    );
    expect(read).toHaveLength(2);
    expect(notes).toEqual([expect.stringMatching(new RegExp(`^${problem}: chain from ${other} did not only grow: `))]);
    expect(node.resolver.cachedReceipts(problem)).toHaveLength(5);
    // The open put the second tracker first among the problem's places; a keep passes over its chain and its log, says
    // so, and grows from the first as before.
    const again = await node.resolver.keep();
    expect(again).toMatchObject({ problems: 1, added: 0, reads: 0 });
    expect(again.refused).toHaveLength(2);
    expect(again.refused.every((r) => r.includes(other) && r.includes('did not only grow'))).toBe(true);
    expect(node.resolver.cachedReceipts(problem)).toHaveLength(5);
  });

  it("keeps one place's identity log, the first whose log grows the one kept, and not a name another tracker holds alone", async () => {
    const names = (lines: Receipt[]) =>
      lines.filter((l) => l.event.type === 'name').map((l) => (l.event.body as { name: string }).name);
    const logAt = async (tracker: string): Promise<Receipt[]> =>
      (await (await fetch(`${tracker}k/events`)).text())
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Receipt);
    await quiltOver(other)(7).setName('Bea');
    expect(names(await logAt(other))).toContain('Bea');
    // The second tracker is first among the places for the identity log too, and its log does not grow the one kept.
    const kept = await node.resolver.keep();
    expect(kept.refused).toContainEqual(
      expect.stringMatching(new RegExp(`^identity: log from ${other} did not only grow: `)),
    );
    expect(names(node.resolver.cachedIdentity())).toEqual(names(await logAt(base)));
    expect(names(node.resolver.cachedIdentity())).not.toContain('Bea');
  });

  it('sends what waited in the queue before it pulls: an event posted while no tracker answered goes out on the next keep', async () => {
    // A door that is down when the name is posted, and up again at the same address when the node keeps.
    const door = () => createTracker({ store: new Store(':memory:'), url: 'http://tracker.test/', ipSalt: 's' });
    const down = await door().listen(0);
    const address = baseOf(down);
    await new Promise<void>((r) => down.close(() => r()));
    const q = quiltOver(address)(6);
    expect(await q.setName('Grace')).toMatchObject({ at: null, queued: true });
    expect(q.resolver.queued()).toBe(1);
    const up = await door().listen(Number(new URL(address).port));
    try {
      expect(await q.resolver.keep()).toMatchObject({ problems: 0, sent: 1 });
      expect(q.resolver.queued()).toBe(0);
      const names = (await (await fetch(`${address}k/events`)).text())
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Receipt);
      expect(names.map((l) => [l.event.type, (l.event.body as { name: string }).name])).toEqual([['name', 'Grace']]);
      expect(await q.resolver.keep()).toMatchObject({ sent: 0 });
    } finally {
      await new Promise<void>((r) => up.close(() => r()));
    }
  });
});

describe('the node keeps past a trace whose reads are not hashes', () => {
  const NODE = readFileSync(new URL('../../../docs/NODE.md', import.meta.url), 'utf8');
  const good = { url: 'https://example.org/paper', hash: pageHash, at: '2026-11-08T08:00:00Z' };

  it.each<[string, unknown, number]>([
    ['reads that are a number', 5, 0],
    ['a read that is null beside a good one', [null, good], 1],
    ['reads that are an object', { 0: good }, 0],
  ])(
    'holds a trace with %s, fetches its good reads alone, and keeps the problems after it and the identity log',
    async (_, reads, fetched) => {
      // A tracker whose store this test writes to directly, as a tracker serves a trace it took before its door held
      // the body to QX-19 section 1.
      const store = new Store(':memory:');
      const server = await createTracker({ store, url: 'http://tracker.test/', ipSalt: 's' }).listen(0);
      try {
        const there = baseOf(server);
        const mk = quiltOver(there);
        const owner = mk(9);
        const worker = mk(1, 'anthropic/claude');
        const node = mk(5);
        const one = (await owner.publish(pattern)).hash;
        const two = (await owner.publish({ ...pattern, title: 'Does the second paper say so?', slug: 'second' })).hash;
        // The node holds both; the trace goes on the one its keep reaches first, so the other comes after it.
        const [first, after] = [one, two].sort();
        await node.open(first!);
        const afterPiece = (await node.open(after!)).state.pieces[0]!.piece.hash;
        store.putBlob(pageHash, enc.encode(PAGE));
        const trace = signEvent(
          {
            quilt: 1,
            type: 'trace',
            problem: first!,
            key: owner.identity!.address,
            ts: new Date().toISOString(),
            body: { reads },
          },
          owner.identity!.secret,
        );
        store.appendReceipt(first!, trace, eventId(trace), 'http://tracker.test/', new Date().toISOString(), 'self');
        await worker.return(after!, afterPiece, { verdict: 'supports' });
        await owner.setName('Ada');
        const identity = node.resolver.cachedIdentity().length;
        const kept = await node.resolver.keep();
        expect(kept).toMatchObject({ problems: 2, added: 4, reads: fetched, refused: [] });
        expect(node.resolver.cachedReceipts(first!).map((l) => eventId(l.event))).toContain(eventId(trace));
        expect(node.resolver.cachedReceipts(after!).map((l) => l.event.type)).toEqual([
          'announce',
          'version',
          'commit',
          'reveal',
        ]);
        expect(node.resolver.cachedIdentity()).toHaveLength(identity + 1);
        expect(node.resolver.cachedBlob(pageHash) !== null).toBe(fetched === 1);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
  );

  it('says in NODE.md section 4 that a read named by anything but a hash is not fetched, and the loop goes on', () => {
    const section = NODE.slice(
      NODE.indexOf('## 4. The keeper in a Quilt'),
      NODE.indexOf('## 5. The keeper over a store'),
    );
    expect(section).toContain(
      "3. It fetches the reads the chain's traces name, under their hashes (QX-19). A read a trace names by anything but a hash, and reads that are not a list, are not fetched. A core client ignores a trace whatever its body (EXTENSIONS.md, What an extension may do), so the chain holds it, and the loop goes on to the problems after it and the identity log.",
    );
  });
});
