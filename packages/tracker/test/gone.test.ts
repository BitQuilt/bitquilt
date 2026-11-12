import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, hashBytes, newNonce } from '@bitquilt/core';
import { VERDICT_QUOTE, addr, boot, envelope, key } from './helpers.js';

/**
 * A reading the fold without the struck events does not hold, through a booted tracker, read by reading 2.
 * docs/v2/READING.md section 3: "a reveal is matched to its key's first unrevealed commit, so the record with nothing
 * struck can hold a reveal that the fold without the struck events lacks." A reading set aside leaves its commit
 * unrevealed in the fold without it (docs/ext/QX-19.md section 4). Once that commit is abandoned, its key commits to
 * the same hash again, reveals, and rests the reveal on the read. The record with nothing struck matches the reveal
 * to the second commit and holds it, and nothing sets it aside. The fold without the struck events matches it to the
 * first commit, which was abandoned, and drops it.
 * The ledger this file leaves holds, on one piece that still needs a second reading:
 * - a reading that rests on a kept read, counted;
 * - a reading that differs and rests on nothing, set aside;
 * - a third reading, from the key of the second, the same return on a second commit of the same hash, which rests on
 *   the read, kept with the reason "the fold without the struck events does not hold it", and its reveal dropped.
 */
const owner = key(9),
  A = key(1),
  B = key(2);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const GONE = envelope(owner, 'gone', {
  statement: {
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Does the paper say the effect holds?',
    schema: VERDICT_QUOTE,
    agree: ['verdict'],
  },
});

const t = boot('2026-11-12T02:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

const enc = new TextEncoder();
const PAGE = 'The paper says the effect holds in every trial. A later section says it does not hold at scale.';
const HOLDS = 'the effect holds in every trial';
const page = hashBytes(enc.encode(PAGE));
const NOT = 'it does not hold at scale';
const spanOf = (passage: string): [number, number] => {
  const start = enc.encode(PAGE.slice(0, PAGE.indexOf(passage))).length;
  return [start, start + enc.encode(passage).length];
};

type Reading = { key: Address; counts: string; why: string | null; by: Hash | null };
type Piece = { name: string; hash: Hash; state: string; aside: Address[]; readings: Reading[] };
type State = { pieces: Piece[]; dropped: { id: Hash; type: string; why: string }[] };

describe('a reading the fold without the struck events does not hold (READING.md section 3)', () => {
  let P: Hash, statement: Hash;
  const events = () => `/p/${P}/events`;
  const state = () => get<State>(`/p/${P}/state`);
  const nonces = new Map<Uint8Array, string>([A, B].map((k) => [k, newNonce()]));
  /** A commit and its reveal, the key's nonce the same each time, so its second commit has the hash of its first. */
  async function returned(k: Uint8Array, model: string, verdict: string) {
    const ret = { verdict, quote: `as ${addr(k).slice(0, 6)} read it, ${verdict}` };
    const nonce = nonces.get(k)!;
    await accepted(events(), ev(k, 'commit', { h: commitHash(ret, nonce) }, P, statement));
    return accepted(events(), ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, statement));
  }

  beforeAll(async () => {
    const r = await post('/p', { envelope: GONE });
    expect(r.status, await r.clone().text()).toBe(201);
    P = ((await r.json()) as { hash: Hash }).hash;
    expect((await fetch(`${t.base}/b/${page}`, { method: 'PUT', body: enc.encode(PAGE) })).ok).toBe(true);
    statement = (await state()).pieces[0]!.hash;
  });

  it('sets a reading aside, and keeps for nothing the same return from its key on a second commit', async () => {
    const reads = [{ url: 'https://example.org/paper', hash: page, at: '2026-11-12T01:00:00Z', media: 'text/plain' }];
    const rested = (k: Uint8Array, reveal: Hash, passage: string) =>
      ev(k, 'trace', { reveal, reads, rests: [{ field: 'verdict', read: 0, span: spanOf(passage) }] }, P, statement);
    const first = await returned(A, 'anthropic/claude', 'supports');
    await returned(B, 'openai/gpt', 'contradicts');
    await accepted(events(), rested(A, first, HOLDS));
    expect((await state()).pieces[0]).toMatchObject({ state: 'needs_verify', aside: [addr(B)] });
    // The lease is two hours, so a commit is abandoned four hours after its receipt.
    t.clock.tick += 4 * 3600_000 + 60_000;
    const again = await returned(B, 'openai/gpt', 'contradicts');
    await accepted(events(), rested(B, again, NOT));
    const s = await state();
    expect(s.pieces[0]).toMatchObject({ state: 'needs_verify', aside: [addr(B)] });
    expect(s.pieces[0]!.readings.map(({ key, counts, why, by }) => ({ key, counts, why, by }))).toEqual([
      { key: addr(A), counts: 'counted', why: null, by: null },
      {
        key: addr(B),
        counts: 'aside',
        why: 'it rests on nothing where another reading rests on the record',
        by: null,
      },
      { key: addr(B), counts: 'kept', why: 'the fold without the struck events does not hold it', by: null },
    ]);
    expect(s.dropped).toEqual([{ id: again, type: 'reveal', why: 'the commit was abandoned before the reveal' }]);
  });
});
