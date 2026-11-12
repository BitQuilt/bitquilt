import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, eventId, hashCanonical, newNonce } from '@bitquilt/core';
import { VERDICT, VERDICT_QUOTE, addr, boot, envelope, key } from './helpers.js';

/**
 * A verdict received before its challenge and a rank received before its panel's candidates were in, read by
 * reading 2 (docs/v2/READING.md section 7). docs/ext/QX-1.md section 5 says: "A verdict counts only from a root whose
 * seat is live at the verdict's receipt: offered, not lapsed, not yet answered." docs/ext/verifiers.md section 2 says
 * the same of a rank, whose root "holds a live seat (offered, not lapsed, not yet answered) at the rank's receipt".
 * No seat is offered before the challenge's receipt, or before the receipt of the panel's last candidate, so a
 * verdict or a rank received before it is from no judge drawn, whoever is drawn after. This tracker's door refuses
 * each, so each is written into the store past the door, as a line pulled from a door that asked less would be.
 * The ledger this file leaves holds:
 * - a challenge with a verdict from every root of its pool received before it, each listed as from no judge drawn,
 *   and then two verdicts from its judges, which decide it;
 * - a panel with a rank from every root of its pool received before its second candidate, each listed as from no
 *   judge drawn and counted on the problem, and then two ranks from its judges, which decide it.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5);
const judges = [key(11), key(12), key(13), key(14)];
const secretOf = new Map<Address, Uint8Array>(judges.map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const pieces = {
  claim: {
    verifier: 'agree',
    requires: ['web' as const],
    schema: VERDICT,
    agree: ['verdict'],
    brief: 'Is the first claim in the paper?',
  },
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

const t = boot('2026-11-12T04:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Dropped = { id: Hash; why: string };
type State = { pieces: { name: string; hash: Hash; state: string }[]; dropped: (Dropped & { type: string })[] };
type Seats = { seats: { root: Address }[]; outcome: string; dropped: Dropped[] };

describe('a verdict and a rank received before a seat was offered (READING.md section 7)', () => {
  let P: Hash;
  const hashOf = new Map<string, Hash>();
  const events = () => `/p/${P}/events`;
  const publish = async (slug: string, of: Parameters<typeof envelope>[2]): Promise<Hash> => {
    const r = await post('/p', { envelope: envelope(owner, slug, of) });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { hash: Hash }).hash;
  };
  const commits = (problem: Hash, piece: Hash, k: Uint8Array, ret: Record<string, unknown>, nonce: string) =>
    accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  const reveals = (problem: Hash, piece: Hash, k: Uint8Array, model: string, ret: unknown, nonce: string) =>
    accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
  /** A commit and its reveal on a piece of a problem, through the door; the digest of the return. */
  async function reads(problem: Hash, piece: Hash, k: Uint8Array, model: string, ret: Record<string, unknown>) {
    const nonce = newNonce();
    await commits(problem, piece, k, ret, nonce);
    await reveals(problem, piece, k, model, ret, nonce);
    return hashCanonical(ret);
  }
  /** An event written into the store past the door, which takes no verdict and no rank before a seat is drawn. */
  async function past(k: Uint8Array, type: string, body: Record<string, unknown>, piece: string) {
    const event = ev(k, type, body, P, hashOf.get(piece)!);
    expect((await post(events(), event)).status).toBe(400);
    t.store.appendReceipt(P, event, eventId(event), 'http://tracker.test/', event.ts, 'self');
    return eventId(event);
  }
  const state = () => get<State>(`/p/${P}/state`);

  beforeAll(async () => {
    P = await publish('early', pieces);
    for (const p of (await state()).pieces) hashOf.set(p.name, p.hash);
    await reads(P, hashOf.get('claim')!, A, 'anthropic/claude', { verdict: 'supports' });
    await reads(P, hashOf.get('claim')!, B, 'openai/gpt', { verdict: 'supports' });
    const Q = await publish('elsewhere-early', elsewhere);
    const [q1, q2] = (await get<State>(`/p/${Q}/state`)).pieces.map((p) => p.hash) as [Hash, Hash];
    const models = ['anthropic/claude', 'openai/gpt', 'google/gemini', 'meta/llama'];
    for (const [i, k] of judges.entries())
      await reads(Q, i < 2 ? q1 : q2, k, models[i]!, {
        verdict: 'supports',
        quote: `as ${addr(k).slice(0, 6)} read it`,
      });
  });

  it('takes a verdict received before its challenge for nothing, whoever is drawn after', async () => {
    const claim = hashOf.get('claim')!;
    const challenge = ev(E, 'challenge', { stake: 1, ground: 'The paper says less.' }, P, claim);
    const verdict = { challenge: eventId(challenge), for: 'challenger' };
    const early: Hash[] = [];
    for (const k of judges) early.push(await past(k, 'verdict', verdict, 'claim'));
    await accepted(events(), challenge);
    const challengesOf = async () => (await get<{ challenges: Seats[] }>(`/p/${P}/challenges`)).challenges;
    const [open] = await challengesOf();
    expect(open!.outcome).toBe('open');
    expect(open!.dropped).toEqual(early.map((id) => ({ id, why: 'not a judge drawn for this challenge' })));
    const [j1, j2] = open!.seats.map((s) => secretOf.get(s.root)!) as [Uint8Array, Uint8Array];
    for (const k of [j1, j2])
      await accepted(events(), ev(k, 'verdict', { challenge: eventId(challenge), for: 'author' }, P, claim));
    const [c] = await challengesOf();
    expect(c!.outcome).toBe('failed');
    expect(c!.dropped).toHaveLength(4);
    // A verdict is on its challenge's list and not the problem's.
    expect((await state()).dropped).toEqual([]);
  });

  it('takes a rank received before the last candidate for nothing, and counts it on the problem', async () => {
    const summary = hashOf.get('summary')!;
    const first = await reads(P, summary, C, 'google/gemini', { text: 'The paper reports one trial.' });
    const ret = { text: 'The paper reports a trial and its limits.' };
    const nonce = newNonce();
    await commits(P, summary, D, ret, nonce);
    const second = hashCanonical(ret);
    const early: Hash[] = [];
    for (const k of judges) early.push(await past(k, 'rank', { ranking: [second, first] }, 'summary'));
    await reveals(P, summary, D, 'meta/llama', ret, nonce);
    const panelsOf = async () => (await get<{ panels: (Seats & { winner: Hash | null })[] }>(`/p/${P}/panels`)).panels;
    const [open] = await panelsOf();
    expect(open!.outcome).toBe('open');
    expect(open!.dropped).toEqual(early.map((id) => ({ id, why: 'not a judge drawn for this piece' })));
    const [j1, j2] = open!.seats.map((s) => secretOf.get(s.root)!) as [Uint8Array, Uint8Array];
    for (const k of [j1, j2]) await accepted(events(), ev(k, 'rank', { ranking: [first, second] }, P, summary));
    const [p] = await panelsOf();
    expect(p).toMatchObject({ outcome: 'decided', winner: first });
    expect(p!.dropped).toHaveLength(4);
    const s = await state();
    expect(s.dropped.map((d) => [d.id, d.type])).toEqual(early.map((id) => [id, 'rank']));
    expect(s.pieces.find((x) => x.name === 'summary')!.state).toBe('accepted_provisional');
  });
});
