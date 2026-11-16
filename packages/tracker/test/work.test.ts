import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, commitHash, hashBytes, newNonce } from '@bitquilt/core';
import { VERDICT_QUOTE, addr, boot, envelope, key } from './helpers.js';

/**
 * A key's work as the record holds it (docs/PROTOCOL.md, Routes: `/k/<address>/work`): what a person's own client
 * shows them of what their AI did. The route answers the pieces the key holds and has not returned, and its readings,
 * each with its return, what it rests on (QX-19 section 1), how it counts and why (READING.md section 3), and the
 * readings beside it. This file walks one piece from a claim to an agreement and a second to a difference, and reads
 * the route at each step.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  root = key(3),
  hand = key(4);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT_QUOTE, agree: ['verdict'] };
const PAPER: Envelope = envelope(owner, 'work', {
  first: { ...agree, brief: 'Is the first claim in the paper?' },
  second: { ...agree, brief: 'Is the second claim in the paper?' },
  third: { ...agree, brief: 'Is the third claim in the paper?' },
});

const t = boot('2026-11-15T12:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
beforeAll(() => t.listen());
afterAll(() => t.close());

const enc = new TextEncoder();
const PAGE = 'The paper makes its first claim in so many words, and gives the trial it rests on.';
const page = hashBytes(enc.encode(PAGE));
const QUOTE = 'makes its first claim in so many words';

interface Work {
  address: Address;
  root: Address;
  working: { problem: Hash; title: string; piece: Hash; name: string; at: string; until: string }[];
  readings: {
    piece: Hash;
    name: string;
    state: string;
    id: Hash | null;
    vendor: string | null;
    counts: string | null;
    why: string | null;
    return: Record<string, unknown> | null;
    rests: { field: string; url: string; passage: string | null }[];
    beside: { vendor: string; counts: string; why: string | null }[];
  }[];
}
let P: Hash;
const pieces = new Map<string, Hash>();
const work = (k: Uint8Array) => t.get<Work>(`/k/${addr(k)}/work`);
const post = (e: unknown) => t.accepted(`/p/${P}/events`, e);
/** A commit and its reveal on a piece, then, where a quote is given, the trace that rests the quote on the page. */
async function read(name: string, k: Uint8Array, model: string, verdict: string, quote = ''): Promise<Hash> {
  const piece = pieces.get(name)!;
  const ret = { verdict, quote };
  const nonce = newNonce();
  await post(t.ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
  const reveal = await post(t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, piece));
  if (quote) {
    const at = PAGE.indexOf(quote);
    const reads = [{ url: 'https://paper.example/one', hash: page, at: new Date(t.clock.tick).toISOString() }];
    const rests = [{ field: 'quote', read: 0, span: [at, at + quote.length] }];
    await post(t.ev(k, 'trace', { reveal, reads, rests }, P, piece));
  }
  return reveal;
}

describe("a key's work, read from the record", () => {
  beforeAll(async () => {
    const r = await t.post('/p', { envelope: PAPER });
    expect(r.status, await r.clone().text()).toBe(201);
    P = ((await r.json()) as { hash: Hash }).hash;
    for (const p of (await t.get<{ pieces: { name: string; hash: Hash }[] }>(`/p/${P}/state`)).pieces)
      pieces.set(p.name, p.hash);
    expect((await fetch(`${t.base}/b/${page}`, { method: 'PUT', body: enc.encode(PAGE) })).ok).toBe(true);
  });

  it('names a piece the key holds from its claim until its return', async () => {
    expect((await work(A)).working).toEqual([]);
    await post(t.ev(A, 'claim', { by: by('anthropic/claude') }, P, pieces.get('first')));
    const held = (await work(A)).working;
    expect(held.map((w) => [w.problem, w.name, w.title])).toEqual([[P, 'first', 'Statements (work)']]);
    expect(Date.parse(held[0]!.until)).toBeGreaterThan(t.clock.tick);
    expect((await work(A)).readings).toEqual([]);
  });

  it('says the return, what it rests on and that it counts, and holds the piece no longer', async () => {
    const id = await read('first', A, 'anthropic/claude', 'supports', QUOTE);
    const w = await work(A);
    expect(w.working).toEqual([]);
    expect(w.readings).toHaveLength(1);
    const r = w.readings[0]!;
    expect([r.name, r.state, r.id, r.vendor, r.counts, r.why]).toEqual([
      'first',
      'needs_verify',
      id,
      'anthropic',
      'counted',
      null,
    ]);
    expect(r.return).toEqual({ verdict: 'supports', quote: QUOTE });
    expect(r.rests).toEqual([{ field: 'quote', url: 'https://paper.example/one', passage: QUOTE }]);
    expect(r.beside).toEqual([]);
  });

  it("names the reading beside it once another vendor's agrees, and each key sees the other's", async () => {
    await read('first', B, 'openai/gpt', 'supports');
    const mine = (await work(A)).readings[0]!;
    expect(mine.state).toBe('accepted_provisional');
    expect(mine.beside).toEqual([{ vendor: 'openai', counts: 'counted', why: null }]);
    const theirs = (await work(B)).readings[0]!;
    expect([theirs.counts, theirs.beside]).toEqual([
      'counted',
      [{ vendor: 'anthropic', counts: 'counted', why: null }],
    ]);
  });

  it('says of a reading that differs that the piece is disputed, with both kept', async () => {
    await read('second', A, 'anthropic/claude', 'supports');
    await read('second', B, 'openai/gpt', 'contradicts');
    const w = await work(A);
    expect(w.readings.map((r) => r.name)).toEqual(['second', 'first']);
    const r = w.readings[0]!;
    expect([r.state, r.counts]).toEqual(['disputed', 'counted']);
    expect(r.beside).toEqual([{ vendor: 'openai', counts: 'counted', why: null }]);
  });

  it('holds a piece no longer once the key declines it', async () => {
    await post(t.ev(A, 'claim', { by: by('anthropic/claude') }, P, pieces.get('third')));
    expect((await work(A)).working.map((x) => x.name)).toEqual(['third']);
    await post(t.ev(A, 'decline', { reason: 'no_time' }, P, pieces.get('third')));
    expect((await work(A)).working).toEqual([]);
  });

  it("answers a delegate's readings under its own address, with the root said beside it", async () => {
    const expires = new Date(t.clock.tick + 86400000).toISOString();
    const scope = ['claim', 'commit', 'reveal', 'trace'];
    await t.accepted('/k/events', t.ev(root, 'delegate', { to: addr(hand), scope, expires }));
    await read('third', hand, 'anthropic/claude', 'supports');
    // The root's own reading on the piece is no reading beside its delegate's: the two are one root's.
    await read('third', root, 'google/gemini', 'supports');
    const w = await work(hand);
    expect([w.address, w.root]).toEqual([addr(hand), addr(root)]);
    expect(w.readings.map((r) => [r.name, r.counts, r.beside])).toEqual([['third', 'counted', []]]);
    expect((await work(root)).readings.map((r) => [r.name, r.beside])).toEqual([['third', []]]);
  });
});
