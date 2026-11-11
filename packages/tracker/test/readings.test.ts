import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, WHY, commitHash, hashBytes, newNonce } from '@bitquilt/core';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * A reading that counts for nothing: docs/v2/READING.md section 3, the sixth departure of its section 12. The record
 * says of each reading "how it counts, one of: `counted`, in a set or toward one; `kept`, valid and counting for
 * nothing, with the reason, such as a root related to the owner or a second reading from one vendor; `aside`, set
 * aside under section 4; `struck`, with the decision that struck it. Nothing valid is left off the record, and a
 * reading that does not count says why." This file leaves one ledger that shows each: the owner's own reading, a
 * second from one vendor, one that differs from the set, one from a root of the set, one after the set, one set
 * aside, a set a held challenge struck and one the owner's gold missed, and on a record piece the readings that stand
 * and the two that do not. The state route answers each piece's readings in receipt order.
 */
const owner = key(9),
  elsewhere = key(8),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  F = key(6),
  G = key(7);
/** Roots with accepted work on a problem of another line, who seat a panel (QX-1 section 3). */
const judges = [key(11), key(12), key(13), key(14)];
const secretOf = new Map<Address, Uint8Array>(judges.map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const PAPER: Envelope = envelope(owner, 'paper', {
  pair: { ...agree, brief: 'Is the first claim in the paper?' },
  alone: { ...agree, brief: 'Is the second claim in the paper?' },
  grounded: { ...agree, brief: 'Is the third claim in the paper?' },
  challenged: { ...agree, brief: 'Is the fourth claim in the paper?' },
  golden: { ...agree, brief: 'Is the fifth claim in the paper?' },
  question: { ...agree, verifier: 'record:2', brief: 'Does the paper ground its claim? Read it your way.' },
});
/** A problem of another owner and another line, whose squares seat a panel. */
const ELSEWHERE = envelope(elsewhere, 'elsewhere', {
  'claim/*': { ...agree, count: 2, brief: 'Claim {n}: is it so?' },
});

// The owner's founding standing covers the gold.
const t = boot('2026-11-11T12:00:00.000Z', {
  limits: { keyPerHour: 1000, ipPerHour: 10000 },
  founding: { [addr(owner)]: 10 },
});
beforeAll(() => t.listen());
afterAll(() => t.close());

const enc = new TextEncoder();
const PAGE = 'The paper makes its third claim in so many words, and gives the trial it rests on.';
const page = hashBytes(enc.encode(PAGE));

type Reading = { id: Hash; key: Address; root: Address; vendor: string; counts: string; why: string | null; by: Hash };
type StatePiece = { name: string; hash: Hash; state: string; readings: Reading[] };
let P: Hash;
const answered = async (name: string) =>
  (await t.get<{ pieces: StatePiece[] }>(`/p/${P}/state`)).pieces.find((p) => p.name === name)!;
/** A piece's readings as the state route answers them: who, how each counts, and why. */
const readings = async (name: string) => (await answered(name)).readings.map((r) => [r.key, r.vendor, r.counts, r.why]);
async function publish(e: Envelope): Promise<Hash> {
  const r = await t.post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
/** A commit and its reveal on a piece; the reveal's id, which names the reading. */
async function read(problem: Hash, piece: Hash, k: Uint8Array, model: string, verdict = 'supports'): Promise<Hash> {
  const ret = { verdict };
  const nonce = newNonce();
  await t.accepted(`/p/${problem}/events`, t.ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  return t.accepted(`/p/${problem}/events`, t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
const reads = async (name: string, k: Uint8Array, model: string, verdict = 'supports') =>
  read(P, (await answered(name)).hash, k, model, verdict);
const row = (k: Uint8Array, vendor: string, counts: string, why: string | null = null) => [
  addr(k),
  vendor,
  counts,
  why,
];

describe('how each reading counts (READING.md section 3)', () => {
  beforeAll(async () => {
    const q = await publish(ELSEWHERE);
    const claims = (await t.get<{ pieces: StatePiece[] }>(`/p/${q}/state`)).pieces;
    for (const [i, pair] of [judges.slice(0, 2), judges.slice(2)].entries())
      for (const [j, k] of pair.entries()) await read(q, claims[i]!.hash, k, j ? 'openai/gpt' : 'anthropic/claude');
    P = await publish(PAPER);
    expect((await fetch(`${t.base}/b/${page}`, { method: 'PUT', body: enc.encode(PAGE) })).ok).toBe(true);
  });

  it('counts a reading toward a set, and keeps a second from one vendor with the reason', async () => {
    await reads('alone', A, 'anthropic/claude');
    await reads('alone', C, 'anthropic/claude-opus');
    expect((await answered('alone')).state).toBe('needs_verify');
    expect(await readings('alone')).toEqual([row(A, 'anthropic', 'counted'), row(C, 'anthropic', 'kept', WHY.vendor)]);
  });

  it("says why each reading a set passed over counts for nothing: the owner's, one vendor's second, one that differs, one of a root in the set, one after it", async () => {
    await reads('pair', owner, 'google/gemini');
    await reads('pair', A, 'anthropic/claude');
    await reads('pair', C, 'anthropic/claude-opus');
    await reads('pair', A, 'google/gemini');
    await reads('pair', D, 'mistral/large', 'contradicts');
    // No set yet: each reading that could still make one counts toward it.
    expect(await readings('pair')).toEqual([
      row(owner, 'google', 'kept', WHY.owner),
      row(A, 'anthropic', 'counted'),
      row(C, 'anthropic', 'kept', WHY.vendor),
      row(A, 'google', 'counted'),
      row(D, 'mistral', 'counted'),
    ]);
    await reads('pair', B, 'openai/gpt');
    await reads('pair', E, 'xai/grok');
    expect((await answered('pair')).state).toBe('accepted_provisional');
    expect(await readings('pair')).toEqual([
      row(owner, 'google', 'kept', WHY.owner),
      row(A, 'anthropic', 'counted'),
      row(C, 'anthropic', 'kept', WHY.vendorInSet),
      row(A, 'google', 'kept', WHY.member),
      row(D, 'mistral', 'kept', WHY.differs),
      row(B, 'openai', 'counted'),
      row(E, 'xai', 'kept', WHY.late),
    ]);
    // Each reading is named by its reveal's id, and none here was struck.
    const said = (await answered('pair')).readings;
    expect(new Set(said.map((r) => r.id)).size).toBe(7);
    expect(said.every((r) => r.by === null)).toBe(true);
  });

  it('says a reading set aside is aside, and why (READING.md section 4)', async () => {
    const piece = (await answered('grounded')).hash;
    const reveal = await reads('grounded', A, 'anthropic/claude');
    await reads('grounded', B, 'openai/gpt', 'contradicts');
    const span: [number, number] = [0, enc.encode('The paper makes its third claim').length];
    const reads0 = [{ url: 'https://example.org/paper', hash: page, at: '2026-11-11T11:00:00Z', media: 'text/plain' }];
    const trace = { reveal, reads: reads0, rests: [{ field: 'verdict', read: 0, span }] };
    await t.accepted(`/p/${P}/events`, t.ev(A, 'trace', trace, P, piece));
    expect(await readings('grounded')).toEqual([row(A, 'anthropic', 'counted'), row(B, 'openai', 'aside', WHY.aside)]);
  });

  it('names the challenge that struck a set on each of its readings (QX-1 section 6)', async () => {
    const piece = (await answered('challenged')).hash;
    const first = await reads('challenged', A, 'anthropic/claude');
    const second = await reads('challenged', B, 'openai/gpt');
    const stake = { stake: 1, ground: 'The sentence quoted is not in the paper.' };
    const id = await t.accepted(`/p/${P}/events`, t.ev(C, 'challenge', stake, P, piece));
    const open = t.tracker
      .layer()
      .problems.get(P)!
      .challenges.find((c) => c.id === id)!;
    for (const seat of open.seats.slice(0, 2)) {
      const verdict = { challenge: id, for: 'challenger' };
      await t.accepted(`/p/${P}/events`, t.ev(secretOf.get(seat.root)!, 'verdict', verdict, P, piece));
    }
    const said = await answered('challenged');
    expect(said.state).toBe('open');
    expect(said.readings.map((r) => [r.id, r.counts, r.why, r.by])).toEqual([
      [first, 'struck', WHY.challenge, id],
      [second, 'struck', WHY.challenge, id],
    ]);
  });

  it("names the owner's gold reveal that missed a set on each of its readings (QX-16 section 3)", async () => {
    const piece = (await answered('golden')).hash;
    const gold = { projection: { verdict: 'supports' }, nonce: newNonce() };
    const commitment = commitHash({ piece, projection: gold.projection }, gold.nonce);
    await t.accepted(`/p/${P}/events`, t.ev(owner, 'gold', { commitments: [commitment], stake: 2 }, P));
    const first = await reads('golden', F, 'anthropic/claude', 'contradicts');
    const second = await reads('golden', G, 'openai/gpt', 'contradicts');
    const id = await t.accepted(`/p/${P}/events`, t.ev(owner, 'gold_reveal', gold, P, piece));
    expect((await answered('golden')).readings.map((r) => [r.id, r.counts, r.why, r.by])).toEqual([
      [first, 'struck', WHY.gold, id],
      [second, 'struck', WHY.gold, id],
    ]);
  });

  it('counts the readings a record piece asks for, and keeps the rest with the reason (QX-20 section 2)', async () => {
    await reads('question', owner, 'google/gemini');
    await reads('question', A, 'anthropic/claude');
    await reads('question', A, 'google/gemini', 'contradicts');
    await reads('question', B, 'anthropic/claude-opus', 'contradicts');
    // The door takes no reading past those the piece asks for, so none here is kept as one too many.
    const piece = (await answered('question')).hash;
    const late = t.ev(C, 'commit', { h: commitHash({ verdict: 'supports' }, newNonce()) }, P, piece);
    expect(await t.refused(`/p/${P}/events`, late)).toBe('the readings for this piece are in');
    expect((await answered('question')).state).toBe('recorded');
    expect(await readings('question')).toEqual([
      row(owner, 'google', 'kept', WHY.owner),
      row(A, 'anthropic', 'counted'),
      row(A, 'google', 'kept', WHY.earlier),
      row(B, 'anthropic', 'counted'),
    ]);
  });
});
