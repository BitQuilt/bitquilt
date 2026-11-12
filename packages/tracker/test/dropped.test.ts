import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, eventId, hashCanonical, newNonce } from '@bitquilt/core';
import { VERDICT, VERDICT_QUOTE, addr, boot, envelope, key } from './helpers.js';

/**
 * The events the pass takes for nothing, read by reading 2 (docs/v2/READING.md section 7): the locks, the golds and
 * the challenges are kept or dropped once each, in receipt order, and a verdict is read under its challenge, as a rank
 * is under its panel. This tracker's door refuses what the pass would drop, so each such event here is written into
 * the store past the door, as a line pulled from a door that asked less would be, and the reading reads a ledger
 * whatever door it came through. The ledger this file leaves holds:
 * - a challenge from a party to the acceptance, a lock no free standing covers and a gold from a key that is not the
 *   owner's, each dropped and counted on its problem;
 * - under a challenge that failed, a verdict from a root with no seat, a second verdict from a judge who answered,
 *   and a verdict after the two that decided, each on the challenge's own list with why;
 * - under a panel that decided, a rank from a root with no seat and a rank after the majority's, each on the panel's
 *   own list with why and counted on the problem.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  F = key(6);
const judges = [key(11), key(12), key(13), key(14)];
const secretOf = new Map<Address, Uint8Array>(judges.map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const pieces = {
  claim: { ...agree, brief: 'Is the first claim in the paper?' },
  seat: { ...agree, brief: 'Is the second claim in the paper?' },
  summary: {
    verifier: 'judge:3',
    candidates: 2,
    requires: ['web' as const],
    brief: 'Summarise the paper in a sentence.',
    schema: {
      type: 'object' as const,
      additionalProperties: false as const,
      required: ['text'],
      properties: { text: { type: 'string' as const, maxLength: 200 } },
    },
  },
};
/** Where the judges' own work stands: the pool is the roots with an accepted return on another problem. */
const elsewhere = {
  'statement/*': {
    count: 2,
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Statement {n}: does the paper say so?',
    schema: VERDICT_QUOTE,
    agree: ['verdict'],
  },
};

const t = boot('2026-11-11T20:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Dropped = { id: Hash; why: string };
type State = { pieces: { name: string; hash: Hash; state: string }[]; dropped: (Dropped & { type: string })[] };
type Seats = { seats: { root: Address }[]; outcome: string; dropped: Dropped[] };

describe('the events the pass takes for nothing (READING.md section 7)', () => {
  let P: Hash;
  const hashOf = new Map<string, Hash>();
  const events = () => `/p/${P}/events`;
  const publish = async (slug: string, of: Parameters<typeof envelope>[2]): Promise<Hash> => {
    const r = await post('/p', { envelope: envelope(owner, slug, of) });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { hash: Hash }).hash;
  };
  /** A commit and its reveal on a piece of a problem, through the door; the digest of the return. */
  async function reads(problem: Hash, piece: Hash, k: Uint8Array, model: string, ret: Record<string, unknown>) {
    const nonce = newNonce();
    await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
    await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
    return hashCanonical(ret);
  }
  /** An event written into the store past the door, after the door has said why it would not take it. */
  async function past(k: Uint8Array, type: string, body: Record<string, unknown>, piece?: string, why?: string) {
    const event = ev(k, type, body, P, piece === undefined ? undefined : hashOf.get(piece)!);
    if (why !== undefined) expect(await refused(events(), event)).toBe(why);
    t.store.appendReceipt(P, event, eventId(event), 'http://tracker.test/', event.ts, 'self');
    return eventId(event);
  }
  const state = () => get<State>(`/p/${P}/state`);
  const whys = (list: Dropped[]) => list.map((d) => d.why);

  it('drops a challenge from a party, a lock no free standing covers and a gold that is not the owner’s', async () => {
    P = await publish('dropped', pieces);
    for (const p of (await state()).pieces) hashOf.set(p.name, p.hash);
    await reads(P, hashOf.get('claim')!, A, 'anthropic/claude', { verdict: 'supports' });
    await reads(P, hashOf.get('claim')!, B, 'openai/gpt', { verdict: 'supports' });
    const Q = await publish('elsewhere', elsewhere);
    const [q1, q2] = (await get<State>(`/p/${Q}/state`)).pieces.map((p) => p.hash) as [Hash, Hash];
    const models = ['anthropic/claude', 'openai/gpt', 'google/gemini', 'meta/llama'];
    for (const [i, k] of judges.entries())
      await reads(Q, i < 2 ? q1 : q2, k, models[i]!, {
        verdict: 'supports',
        quote: `as ${addr(k).slice(0, 6)} read it`,
      });
    await accepted(events(), ev(owner, 'stake_rule', { min: 2, pieces: ['seat'] }, P));

    const ground = { stake: 1, ground: 'The paper says the opposite.' };
    const ids = [
      await past(A, 'challenge', ground, 'claim', 'a party to the acceptance cannot challenge it'),
      await past(F, 'lock', { kind: 'standing', amount: 2 }, 'seat', 'free standing 1 is below the lock of 2'),
      await past(
        A,
        'gold',
        { commitments: [hashCanonical({ a: 1 })], stake: 2 },
        undefined,
        'the owner alone commits gold',
      ),
    ];
    const s = await state();
    expect(s.dropped.map((d) => [d.id, d.type, d.why])).toEqual([
      [ids[0], 'challenge', 'a party to the acceptance cannot challenge it'],
      [ids[1], 'lock', 'free standing 1 is below the lock of 2'],
      [ids[2], 'gold', 'the owner alone commits gold'],
    ]);
    expect(s.pieces.find((p) => p.name === 'claim')!.state).toBe('accepted_provisional');
  });

  it('lists under a challenge the verdicts it takes for nothing, each with why', async () => {
    const challengesOf = async () => (await get<{ challenges: Seats[] }>(`/p/${P}/challenges`)).challenges;
    const id = await accepted(
      events(),
      ev(E, 'challenge', { stake: 1, ground: 'The paper says less.' }, P, hashOf.get('claim')!),
    );
    const [open] = await challengesOf();
    const [j1, j2, j3] = open!.seats.map((s) => secretOf.get(s.root)!) as [Uint8Array, Uint8Array, Uint8Array];
    const verdict = { challenge: id, for: 'author' };
    await past(F, 'verdict', verdict, 'claim', 'not a judge drawn for this challenge');
    await accepted(events(), ev(j1, 'verdict', verdict, P, hashOf.get('claim')!));
    await past(j1, 'verdict', verdict, 'claim', 'this judge has answered');
    await accepted(events(), ev(j2, 'verdict', verdict, P, hashOf.get('claim')!));
    await past(j3, 'verdict', { challenge: id, for: 'challenger' }, 'claim');
    const [c] = await challengesOf();
    expect(c!.outcome).toBe('failed');
    expect(whys(c!.dropped)).toEqual([
      'not a judge drawn for this challenge',
      'this judge has answered',
      'the challenge was decided',
    ]);
    // A verdict is on its challenge's list and not the problem's.
    expect((await state()).dropped.length).toBe(3);
  });

  it('lists under a panel the ranks it takes for nothing, and counts each on the problem', async () => {
    const summary = hashOf.get('summary')!;
    const first = await reads(P, summary, C, 'google/gemini', { text: 'The paper reports one trial.' });
    const second = await reads(P, summary, D, 'meta/llama', { text: 'The paper reports a trial and its limits.' });
    const panelsOf = async () => (await get<{ panels: Seats[] }>(`/p/${P}/panels`)).panels;
    const [open] = await panelsOf();
    const [j1, j2, j3] = open!.seats.map((s) => secretOf.get(s.root)!) as [Uint8Array, Uint8Array, Uint8Array];
    const rank = { ranking: [first, second] };
    const ids = [await past(F, 'rank', rank, 'summary', 'not a judge drawn for this piece')];
    await accepted(events(), ev(j1, 'rank', rank, P, summary));
    await accepted(events(), ev(j2, 'rank', rank, P, summary));
    ids.push(await past(j3, 'rank', { ranking: [second, first] }, 'summary'));
    const [p] = await panelsOf();
    expect(p!.outcome).toBe('decided');
    expect(p!.dropped).toEqual([
      { id: ids[0], why: 'not a judge drawn for this piece' },
      { id: ids[1], why: 'the panel has decided' },
    ]);
    const s = await state();
    expect(s.dropped.length).toBe(5);
    expect(s.dropped.slice(3).map((d) => d.type)).toEqual(['rank', 'rank']);
    expect(s.pieces.find((x) => x.name === 'summary')!.state).toBe('accepted_provisional');
  });
});
