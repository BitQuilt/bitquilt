import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type Envelope,
  type Hash,
  IDENTITY_LOG,
  commitHash,
  eventId,
  hashBytes,
  newNonce,
  problemHash,
  reduce,
  signEvent,
} from '@bitquilt/core';
import type { Layer } from '../src/challenge.js';
import { foldsOf, turnsAt } from '../src/folds.js';
import { Store } from '../src/store.js';
import { VERDICT, addr, boot, envelope, key, layerOf } from './helpers.js';

/**
 * What a tracker keeps between layers (folds.ts, and the store's own keeping in store.ts): each problem's input and
 * the core's fold of it, kept while the chain, the lines and the blobs it was read from have not grown and the clock
 * has not reached the first time a state turns by it alone (`turnsAt`). The core's state at any time before that turn
 * is the state kept; a kept fold is the same object until a line, a version or the clock moves it, and a line on one
 * problem folds that problem again and no other. At every step of a run of claims, commits, reveals, a decline, a
 * version, a name and the clock passing a lease, an abandon and a window, the layer the tracker builds over what it
 * keeps is the layer built afresh. The store hands out each log's lines and each envelope frozen, and catches up with
 * a commit another connection makes to its database.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const q = { verifier: 'agree' as const, requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const START = '2026-11-09T12:00:00Z';
const HOUR = 3_600_000;

/** A layer as plain text: every problem's pieces as the layer and the core say them, and the core's fold. */
function said(layered: Layer): string {
  const plain = (_k: string, v: unknown) =>
    typeof v === 'function' ? undefined : v instanceof Map ? [...v] : v instanceof Set ? [...v] : v;
  const out: Record<string, unknown> = {};
  for (const [h, pl] of layered.problems)
    out[h] = {
      pieces: pl.pieces,
      core: pl.core.pieces,
      fold: pl.fold.pieces,
      complete: pl.core.complete,
      output: pl.core.output,
      weights: pl.core.weights,
      names: pl.core.names,
    };
  return JSON.stringify({ problems: out, standing: layered.standing, refused: layered.refused }, plain);
}

describe("a problem's state between the times the clock turns it", () => {
  it('is the state at the start, up to the turn, for claims, commits and an accepting set', () => {
    const E = envelope(owner, 'turns', { 'q/*': { ...q, count: 3, brief: 'Statement {n}.' } });
    const p = problemHash(E);
    const pieces = reduce({ envelopes: [E], blobs: new Map(), receipts: [], now: START }).pieces;
    let tick = Date.parse(START);
    const line = (k: Uint8Array, type: string, body: Record<string, unknown>, piece: Hash) => {
      tick += 1000;
      const at = new Date(tick).toISOString();
      const event = signEvent({ quilt: 1, type, key: addr(k), ts: at, problem: p, piece, body }, k);
      return { event, received: [{ by: 'http://tracker.test/', at }] };
    };
    const yes = { verdict: 'supports' };
    const [first, second, third] = pieces.map((v) => v.piece.hash);
    const [a, b, c] = [newNonce(), newNonce(), newNonce()];
    const receipts = [
      line(A, 'claim', { by: by('anthropic/claude'), lease_h: 2 }, first!),
      line(B, 'claim', { by: by('openai/gpt'), lease_h: 3 }, second!),
      line(B, 'commit', { h: commitHash(yes, b) }, second!),
      line(A, 'claim', { by: by('anthropic/claude'), lease_h: 2 }, third!),
      line(A, 'commit', { h: commitHash(yes, a) }, third!),
      line(A, 'reveal', { return: yes, nonce: a, by: by('anthropic/claude') }, third!),
      line(C, 'claim', { by: by('openai/gpt'), lease_h: 2 }, third!),
      line(C, 'commit', { h: commitHash(yes, c) }, third!),
      line(C, 'reveal', { return: yes, nonce: c, by: by('openai/gpt') }, third!),
    ];
    const at = (t: number) => new Date(t).toISOString();
    const fold = (t: string) =>
      JSON.stringify(reduce({ envelopes: [E], blobs: new Map(), receipts, now: t }), (_k, v) =>
        typeof v === 'function' ? undefined : v instanceof Map ? [...v] : v instanceof Set ? [...v] : v,
      );
    // Each turn in order: the claim's lease ends, the unrevealed commit is abandoned, then the window closes.
    let now = at(tick);
    const turns: string[] = [];
    for (let next = turnsAt(reduce({ envelopes: [E], blobs: new Map(), receipts, now }), now); next; ) {
      const before = fold(now);
      for (const t of [Date.parse(now) + 1, (Date.parse(now) + Date.parse(next)) / 2, Date.parse(next) - 1])
        expect(fold(at(Math.floor(t)))).toBe(before);
      expect(fold(next)).not.toBe(before);
      turns.push(next);
      now = next;
      next = turnsAt(reduce({ envelopes: [E], blobs: new Map(), receipts, now }), now);
    }
    // The first claim's lease ends first, the window over the third piece's set closes last, and the commit on the
    // second is abandoned in between, at twice the piece's lease.
    const received = (i: number) => Date.parse(receipts[i]!.received[0]!.at);
    expect(turns[0]).toBe(at(received(0) + 2 * HOUR));
    expect(turns).toContain(at(received(2) + 2 * 2 * HOUR));
    expect(turns.at(-1)).toBe(at(received(8) + 48 * HOUR));
    expect([...turns].sort()).toEqual(turns);
  });
});

describe('the folds a tracker keeps', () => {
  it('are the same object until a line, a version or the clock moves them, and a line on one problem moves no other', () => {
    const store = new Store(':memory:');
    const folds = foldsOf(store);
    const one = envelope(owner, 'kept-one', { 'q/*': { ...q, count: 2, brief: 'One {n}.' } });
    const two = envelope(owner, 'kept-two', { 'q/*': { ...q, count: 2, brief: 'Two {n}.' } });
    const [h1, h2] = [problemHash(one), problemHash(two)];
    store.putEnvelope(h1, one, START);
    store.putEnvelope(h2, two, START);
    const fold = (h: Hash, at: string) => folds.reduce(folds.inputAt(h, at)!);
    const s1 = fold(h1, START);
    const s2 = fold(h2, START);
    expect(fold(h1, '2026-11-09T13:00:00.000Z')).toBe(s1);
    expect(folds.inputAt(problemHash(envelope(owner, 'not-here', {})), START)).toBeNull();
    // A claim on the first: it folds again, the second does not.
    const piece = s1.pieces[0]!.piece.hash;
    const claim = signEvent(
      {
        quilt: 1,
        type: 'claim',
        key: addr(A),
        ts: START,
        problem: h1,
        piece,
        body: { by: by('anthropic/claude'), lease_h: 2 },
      },
      A,
    );
    store.appendReceipt(h1, claim, eventId(claim), 'http://tracker.test/', '2026-11-09T13:00:00.000Z', 'self');
    const claimed = fold(h1, '2026-11-09T13:00:01.000Z');
    expect(claimed).not.toBe(s1);
    expect(claimed.pieces[0]!.state).toBe('in_flight');
    expect(fold(h2, '2026-11-09T13:00:01.000Z')).toBe(s2);
    // The clock: kept until the lease ends, folded again at its end.
    expect(fold(h1, '2026-11-09T14:59:59.999Z')).toBe(claimed);
    const lapsed = fold(h1, '2026-11-09T15:00:00.000Z');
    expect(lapsed).not.toBe(claimed);
    expect(lapsed.pieces[0]!.state).toBe('open');
    // Asked at a time before the one it was folded at, a problem is folded at that time.
    expect(fold(h1, '2026-11-09T14:00:00.000Z').pieces[0]!.state).toBe('in_flight');
    // A version of the second folds the version, and leaves the second as it was.
    const v2 = envelope(owner, 'kept-two', { 'q/*': { ...q, count: 2, brief: 'Two, sharper {n}.' } }, { prev: h2 });
    store.putEnvelope(problemHash(v2), v2, START);
    expect(fold(problemHash(v2), '2026-11-09T15:00:00.000Z').chain).toHaveLength(2);
    expect(fold(h2, '2026-11-09T15:00:00.000Z')).toBe(s2);
    // A line on the identity log is read by every fold.
    const name = signEvent({ quilt: 1, type: 'name', key: addr(C), ts: START, body: { name: 'C' } }, C);
    store.appendReceipt(IDENTITY_LOG, name, eventId(name), 'http://tracker.test/', '2026-11-09T15:00:01.000Z', 'self');
    expect(fold(h2, '2026-11-09T15:00:02.000Z')).not.toBe(s2);
    expect(fold(h2, '2026-11-09T15:00:02.000Z').names.get(addr(C))?.name).toBe('C');
    // A fold the tracker keeps is frozen, so no reader can change what the next one reads.
    expect(Object.isFrozen(lapsed) && Object.isFrozen(lapsed.pieces[0])).toBe(true);
  });

  it('fold a version again once the version before it is held, as a keeper may take them in either order', () => {
    const store = new Store(':memory:');
    const folds = foldsOf(store);
    const P = envelope(owner, 'in-either-order', { 'q/*': { ...q, count: 2, brief: 'Statement {n}.' } });
    const V = envelope(
      owner,
      'in-either-order',
      { 'q/*': { ...q, count: 2, brief: 'Statement {n}, sharper.' } },
      {
        prev: problemHash(P),
      },
    );
    const v = problemHash(V);
    store.putEnvelope(v, V, START);
    const alone = folds.reduce(folds.inputAt(v, START)!);
    expect(alone.chain).toHaveLength(1);
    store.putEnvelope(problemHash(P), P, START);
    const both = folds.reduce(folds.inputAt(v, START)!);
    expect(both.chain).toHaveLength(2);
    expect(both.ancestral.size).toBe(2);
  });

  it('fold a problem again once a data blob it lacked is held', () => {
    const store = new Store(':memory:');
    const folds = foldsOf(store);
    const rows = new TextEncoder().encode(JSON.stringify([{ s: 'The sky is blue.' }]));
    const E = envelope(
      owner,
      'lacks-a-blob',
      { 'q/*': { ...q, count: 1, brief: 'Statement: {row.s}', data: { row: 'rows.json' } } },
      { data: { 'rows.json': hashBytes(rows) } },
    );
    const h = problemHash(E);
    store.putEnvelope(h, E, START);
    expect(() => folds.reduce(folds.inputAt(h, START)!)).toThrow(/not present/);
    store.putBlob(hashBytes(rows), rows);
    expect(folds.reduce(folds.inputAt(h, START)!).pieces[0]!.piece.brief).toBe('Statement: The sky is blue.');
  });
});

describe('the layer a tracker builds over what it keeps', () => {
  const t = boot(START, { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
  beforeAll(() => t.listen());
  afterAll(() => t.close());

  it('is the layer built afresh at every step: lines, a version, a name, and the clock past a lease, an abandon and a window', async () => {
    const same = () => {
      t.clock.tick += 6000;
      expect(said(t.tracker.layer())).toBe(said(layerOf(t)));
    };
    const publish = async (e: Envelope) => expect((await t.post('/p', { envelope: e })).status).toBe(201);
    const E = envelope(owner, 'steps', { 'q/*': { ...q, count: 3, brief: 'Statement {n}.' } });
    const p = problemHash(E);
    await publish(E);
    same();
    const pieces = reduce({ envelopes: [E], blobs: new Map(), receipts: [], now: START }).pieces.map(
      (v) => v.piece.hash,
    );
    const yes = { verdict: 'supports' };
    const read = async (k: Uint8Array, piece: Hash, model: string, nonce: string) => {
      await t.accepted(`/p/${p}/events`, t.ev(k, 'claim', { by: by(model), lease_h: 2 }, p, piece));
      same();
      await t.accepted(`/p/${p}/events`, t.ev(k, 'commit', { h: commitHash(yes, nonce) }, p, piece));
      same();
      await t.accepted(`/p/${p}/events`, t.ev(k, 'reveal', { return: yes, nonce, by: by(model) }, p, piece));
      same();
    };
    await read(A, pieces[0]!, 'anthropic/claude', newNonce());
    await read(B, pieces[0]!, 'openai/gpt', newNonce());
    await t.accepted(`/p/${p}/events`, t.ev(C, 'decline', { reason: 'unclear' }, p, pieces[1]!));
    same();
    await t.accepted(`/p/${p}/events`, t.ev(C, 'claim', { by: by('google/gemini'), lease_h: 2 }, p, pieces[2]!));
    await t.accepted(`/p/${p}/events`, t.ev(C, 'commit', { h: commitHash(yes, newNonce()) }, p, pieces[2]!));
    same();
    // The lease ends, then the commit is abandoned, then the window closes, each with nothing written.
    for (const hours of [2, 2, 48]) {
      t.clock.tick += hours * HOUR;
      same();
    }
    await t.accepted('/k/events', t.ev(A, 'name', { name: 'Reader A' }));
    same();
    const V = envelope(
      owner,
      'steps',
      { 'q/*': { ...q, count: 3, brief: 'Statement {n}, read closely.' } },
      { prev: p },
    );
    await publish(V);
    same();
    expect(
      t.tracker
        .layer()
        .problems.get(p)!
        .pieces.map((x) => x.state),
    ).toEqual(['accepted', 'open', 'open']);
  });
});

describe("the store's own keeping", () => {
  it('hands out lines and envelopes frozen, and catches up with what another connection commits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'quilt-store-'));
    try {
      const path = join(dir, 'store.db');
      const mine = new Store(path);
      const theirs = new Store(path);
      const E = envelope(owner, 'two-connections', { 'q/*': { ...q, count: 1, brief: 'One.' } });
      const h = problemHash(E);
      theirs.putEnvelope(h, E, START);
      await null;
      expect(mine.listEnvelopes().map((x) => x.hash)).toEqual([h]);
      expect(mine.lines(h)).toEqual([]);
      const name = signEvent({ quilt: 1, type: 'name', key: addr(A), ts: START, body: { name: 'A' } }, A);
      theirs.appendReceipt(h, name, eventId(name), 'http://tracker.test/', START, 'self');
      await null;
      const lines = mine.lines(h);
      expect(lines.map((l) => l.event.type)).toEqual(['name']);
      expect(() => {
        (lines[0]!.event.body as Record<string, unknown>).name = 'B';
      }).toThrow(TypeError);
      expect(() => {
        (mine.getEnvelope(h)!.envelope.problem as { title: string }).title = 'Changed';
      }).toThrow(TypeError);
      // Written through the store itself, a line is read at once.
      theirs.close();
      const again = signEvent({ quilt: 1, type: 'name', key: addr(A), ts: START, body: { name: 'A again' } }, A);
      mine.appendReceipt(h, again, eventId(again), 'http://tracker.test/', START, 'self');
      expect(mine.lines(h)).toHaveLength(2);
      mine.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
