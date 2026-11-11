import { describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Hash,
  type Receipt,
  IDENTITY_LOG,
  eventId,
  hashBytes,
  problemHash,
  reduce,
  signEvent,
} from '@bitquilt/core';
import { type ChainReader, reduceInputOf } from '@bitquilt/core';
import { Store } from '../src/store.js';
import { VERDICT, addr, envelope, key } from './helpers.js';

/**
 * The reducer's input (CORE.md section 6) as `reduceInputOf` reads it from a store, the one reading the door and the
 * mirror share: the envelope and every earlier version along prev the store holds, nearest first, stopping at one it
 * lacks; the blobs those versions name that it holds, each once; every line of each version's log in that order, then
 * the identity log, each whole. The tracker's store and a store of plain maps with the same contents, as the mirror's
 * files are, give the same input, and the core folds it.
 */
const owner = key(9),
  A = key(1);
const at = (m: number) => new Date(Date.parse('2026-11-07T08:00:00Z') + m * 60_000).toISOString();
const enc = new TextEncoder();
const cites = enc.encode(JSON.stringify([{ s: 'one' }]));
const notes = enc.encode('Notes on the second version.');
const family = (brief: string) => ({
  count: 1,
  verifier: 'agree',
  requires: ['web' as const],
  brief,
  schema: VERDICT,
  agree: ['verdict'],
});
const first: Envelope = envelope(
  owner,
  'input',
  { 'claim/*': family('Claim {n}: does the paper say so?') },
  { data: { 'cites.json': hashBytes(cites) } },
);
const p1 = problemHash(first);
const second: Envelope = envelope(
  owner,
  'input',
  { 'claim/*': family('Claim {n}: is it read from the section that reports it?') },
  { prev: p1, data: { 'cites.json': hashBytes(cites), 'notes.txt': hashBytes(notes) } },
);
const p2 = problemHash(second);

/** The first version's piece, which both versions' logs may name. */
const piece = reduce({ envelopes: [first], blobs: new Map([[hashBytes(cites), cites]]), receipts: [], now: at(0) })
  .pieces[0]!.piece.hash;
/** A claim by A on the piece under a version, signed. */
const claimOn = (problem: Hash, minute: number) =>
  signEvent(
    {
      quilt: 1,
      type: 'claim',
      problem,
      piece,
      key: addr(A),
      ts: at(minute),
      body: { by: { model: 'anthropic/claude', client: 'test/0', can: ['web'] } },
    },
    A,
  );
/** A name on the identity log. */
const named = signEvent({ quilt: 1, type: 'name', key: addr(A), ts: at(3), body: { name: 'Ada' } }, A);

/** The tracker's store holding both versions, both blobs, a line on each version's log and a name. */
function stored(): Store {
  const store = new Store(':memory:');
  store.putEnvelope(p1, first, at(0));
  store.putEnvelope(p2, second, at(1));
  store.putBlob(hashBytes(cites), cites);
  store.putBlob(hashBytes(notes), notes);
  for (const [log, e] of [
    [p1, claimOn(p1, 2)],
    [p2, claimOn(p2, 4)],
    [IDENTITY_LOG, named],
  ] as const)
    store.appendReceipt(log, e, eventId(e), 'https://t.example/', e.ts, 'self');
  return store;
}

/** The same contents as plain maps, read through the three methods alone, as the mirror's files answer them. */
function plain(from: Store, without: Hash[] = []): ChainReader {
  const envelopes = new Map<Hash, Envelope>();
  for (const h of [p1, p2]) if (!without.includes(h)) envelopes.set(h, from.envelopeOf(h)!);
  const blobs = new Map<Hash, Uint8Array>([
    [hashBytes(cites), cites],
    [hashBytes(notes), notes],
  ]);
  const logs = new Map<Hash, Receipt[]>([p1, p2, IDENTITY_LOG].map((h) => [h, from.lines(h)]));
  return {
    envelopeOf: (h) => envelopes.get(h) ?? null,
    getBlob: (h) => blobs.get(h) ?? null,
    lines: (log) => logs.get(log) ?? [],
  };
}

describe('the reduce input', () => {
  const store = stored();

  it('reads the chain nearest first, the blobs it names once each, and every line of each version and of the identity log', () => {
    const input = reduceInputOf(store, second, at(10));
    expect(input.envelopes.map(problemHash)).toEqual([p2, p1]);
    expect([...input.blobs.keys()]).toEqual([hashBytes(cites), hashBytes(notes)]);
    expect(input.receipts).toEqual([...store.lines(p2), ...store.lines(p1), ...store.lines(IDENTITY_LOG)]);
    expect(input.receipts.map((r) => r.event.type)).toEqual(['claim', 'claim', 'name']);
    expect(input.now).toBe(at(10));
    expect(reduce(input).chain.map(problemHash)).toEqual([p2, p1]);
  });

  it('gives the same input from the tracker store and from plain maps with the same contents', () => {
    expect(reduceInputOf(plain(store), second, at(10))).toEqual(reduceInputOf(store, second, at(10)));
  });

  it('stops at a version the store lacks and reads no line of it', () => {
    const input = reduceInputOf(plain(store, [p1]), second, at(10));
    expect(input.envelopes.map(problemHash)).toEqual([p2]);
    expect(input.receipts).toEqual([...store.lines(p2), ...store.lines(IDENTITY_LOG)]);
  });

  it('reads a first version alone, with no prev to follow', () => {
    const input = reduceInputOf(store, first, at(10));
    expect(input.envelopes.map(problemHash)).toEqual([p1]);
    expect([...input.blobs.keys()]).toEqual([hashBytes(cites)]);
    expect(input.receipts).toEqual([...store.lines(p1), ...store.lines(IDENTITY_LOG)]);
  });
});
