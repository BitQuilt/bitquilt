import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, commitHash, newNonce, problemHash } from '@bitquilt/core';
import { PANEL } from '../src/challenge.js';
import { addr, boot, envelope as signed, key } from './helpers.js';

/**
 * The challenge window (QX-1) at the tracker's door and in its layer: a challenge needs standing, a window still open,
 * a piece with no challenge yet, and a panel that can be seated from roots with accepted work on another problem; a
 * verdict counts only from a seat that is live; two verdicts decide; a held challenge strikes the set and a failed one
 * costs the stake; seats lapse by the lease and pass to the next in the draw; a panel that runs out is void.
 */
const owner = key(9), A = key(1), B = key(2), C = key(3), D = key(4), E = key(5);
const judges = [key(11), key(12), key(13), key(14)];
const secretOf = new Map<Address, Uint8Array>([owner, A, B, C, D, E, ...judges].map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };

function envelope(slug: string, count: number): Envelope {
  return signed(owner, slug, { 'statement/*': { count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } });
}

const HOUR = 3_600_000;
const t = boot('2026-10-25T09:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { tracker, clock, ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

/** A commit and its reveal from one key, agreeing on `verdict`. */
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string, verdict = 'supports') {
  const ret = { verdict, quote: `as ${addr(k).slice(0, 6)} read it` };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
const stateOf = async (problem: Hash, piece: Hash) => {
  const s = (await get(`/p/${problem}/state`)) as { pieces: { hash: Hash; state: string; core: string; challenge: string | null }[] };
  return s.pieces.find((p) => p.hash === piece)!;
};
type Challenge = { id: Hash; piece: Hash; outcome: string; seats: { root: Address; lapsed_at: string | null; verdict: { for: string } | null }[]; struck: Hash[]; dropped: { why: string }[] };
const challengesOf = async (problem: Hash) => ((await get(`/p/${problem}/challenges`)) as { challenges: Challenge[] }).challenges;
const challenge = (k: Uint8Array, problem: Hash, piece: Hash, stake: number, ground = 'The sentence quoted is not in the paper.') => ev(k, 'challenge', { stake, ground }, problem, piece);
const verdict = (root: Address, problem: Hash, piece: Hash, of: Hash, side: 'challenger' | 'author', ret?: Record<string, unknown>) => ev(secretOf.get(root)!, 'verdict', { challenge: of, for: side, ...(ret ? { return: ret } : {}) }, problem, piece);

const P = envelope('paper', 3);
const Q = envelope('elsewhere', 2);
const p = problemHash(P);
const q = problemHash(Q);
let p1: Hash, p2: Hash, p3: Hash;

describe('the challenge window at the door', () => {
  it('advertises the seed and the panel, and seats no panel while nobody has accepted work elsewhere', async () => {
    const w = await get<{ sortition: string; challenge: unknown; routes: string[] }>('/.well-known/quilt');
    expect(w.sortition).toBe('challenge-receipt');
    expect(w.challenge).toEqual({ extension: 'QX-1', panel: 3, majority: 2, ground_max: 200 });
    expect(w.routes).toContain('/p/<hash>/challenges');
    expect((await post('/p', { envelope: P })).status).toBe(201);
    const s = (await get(`/p/${p}/state`)) as { pieces: { hash: Hash }[] };
    [p1, p2, p3] = s.pieces.map((x) => x.hash) as [Hash, Hash, Hash];
    expect(await refused(`/p/${p}/events`, challenge(C, p, p1, 1))).toBe('nothing accepted on this piece yet');
    await returnOn(p, p1, A, 'anthropic/claude');
    await returnOn(p, p1, B, 'openai/gpt');
    expect((await stateOf(p, p1)).state).toBe('accepted_provisional');
    expect(await refused(`/p/${p}/events`, challenge(C, p, p1, 1))).toBe('no panel can be seated: 0 roots with an accepted return on another problem, 3 needed');
  });
  it('refuses a challenge from a party, one over the gate, one with no stake, and one above the challenger\'s standing', async () => {
    expect((await post('/p', { envelope: Q })).status).toBe(201);
    const s = (await get(`/p/${q}/state`)) as { pieces: { hash: Hash }[] };
    const [q1, q2] = s.pieces.map((x) => x.hash) as [Hash, Hash];
    await returnOn(q, q1, judges[0]!, 'anthropic/claude');
    await returnOn(q, q1, judges[1]!, 'openai/gpt');
    await returnOn(q, q2, judges[2]!, 'google/gemini');
    await returnOn(q, q2, judges[3]!, 'meta/llama');
    expect(await refused(`/p/${p}/events`, challenge(A, p, p1, 1))).toBe('a party to the acceptance cannot challenge it');
    expect(await refused(`/p/${p}/events`, challenge(owner, p, p1, 1))).toBe('a party to the acceptance cannot challenge it');
    expect(await refused(`/p/${p}/events`, challenge(C, p, p1, 1, 'See https://example.org/proof'))).toMatch(/no links/);
    expect(await refused(`/p/${p}/events`, challenge(C, p, p1, 0))).toBe('a challenge on an acceptance stakes at least 1');
    expect(await refused(`/p/${p}/events`, challenge(C, p, p1, -1))).toBe('body.stake: a whole number from 0');
    expect(await refused(`/p/${p}/events`, challenge(C, p, p1, 2))).toBe('standing 1 is below the stake of 2');
    expect(await refused(`/p/${p}/events`, challenge(C, p, p2, 1))).toBe('nothing accepted on this piece yet');
  });
  it('seats a panel of three by the challenge\'s receipt, holds the piece as challenged, and takes verdicts only from live seats', async () => {
    const id = await accepted(`/p/${p}/events`, challenge(C, p, p1, 1));
    expect(await refused(`/p/${p}/events`, challenge(D, p, p1, 1))).toBe('a challenge is open on this piece');
    const view = await stateOf(p, p1);
    expect(view.state).toBe('challenged');
    expect(view.core).toBe('accepted_provisional');
    expect(view.challenge).toBe(id);
    const [c] = await challengesOf(p);
    expect(c!.id).toBe(id);
    expect(c!.outcome).toBe('open');
    expect(c!.seats).toHaveLength(PANEL);
    const drawn = c!.seats.map((s) => s.root);
    const pool = judges.map(addr);
    for (const d of drawn) expect(pool).toContain(d);
    const undrawn = pool.find((j) => !drawn.includes(j))!;
    expect(await refused(`/p/${p}/events`, verdict(undrawn, p, p1, id, 'challenger'))).toBe('not a judge drawn for this challenge');
    expect(await refused(`/p/${p}/events`, verdict(addr(E), p, p1, id, 'challenger'))).toBe('not a judge drawn for this challenge');
    expect(await refused(`/p/${p}/events`, verdict(drawn[0]!, p, p1, id, 'challenger', { verdict: 'maybe', quote: 'x' }))).toMatch(/return.verdict/);
    await accepted(`/p/${p}/events`, verdict(drawn[0]!, p, p1, id, 'challenger', { verdict: 'contradicts', quote: 'the paper says the opposite' }));
    expect(await refused(`/p/${p}/events`, verdict(drawn[0]!, p, p1, id, 'author'))).toBe('this judge has answered');
    expect((await stateOf(p, p1)).state).toBe('challenged');
    await accepted(`/p/${p}/events`, verdict(drawn[1]!, p, p1, id, 'challenger'));
    // Held: the set is struck, the piece is open again for the layer and still provisional for the core.
    const after = await stateOf(p, p1);
    expect(after.state).toBe('open');
    expect(after.core).toBe('accepted_provisional');
    const [held] = await challengesOf(p);
    expect(held!.outcome).toBe('held');
    expect(held!.struck).toHaveLength(4);
    expect(await refused(`/p/${p}/events`, verdict(drawn[2]!, p, p1, id, 'author'))).toBe('names no open challenge on this piece');
    expect(await refused(`/p/${p}/events`, challenge(D, p, p1, 1))).toBe('this piece has had its challenge');
    const layer = tracker.layer();
    expect(layer.standing(addr(C))).toBe(2);
    expect(layer.standing(addr(A))).toBe(0);
    expect(layer.standing(addr(B))).toBe(0);
    expect(layer.standing(addr(judges[0]!))).toBe(2);
    expect(layer.standing(addr(E))).toBe(1);
    const offered = (await get(`/p/${p}/next?key=${addr(E)}&can=web&model=meta/llama`)) as { piece: Hash | null };
    expect(offered.piece).not.toBeNull();
  });
  it('lapses a seat by the lease and offers the next in the draw; two verdicts for the author fail the challenge and cost the stake', async () => {
    await returnOn(p, p2, A, 'anthropic/claude');
    await returnOn(p, p2, B, 'openai/gpt');
    const id = await accepted(`/p/${p}/events`, challenge(C, p, p2, 1, 'Both quote a sentence that supposes, not states.'));
    let [, c] = await challengesOf(p);
    const first = c!.seats[0]!.root;
    clock.tick += 2 * HOUR + 1000;
    [, c] = await challengesOf(p);
    expect(c!.seats).toHaveLength(PANEL + 1);
    expect(c!.seats.slice(0, PANEL).every((s) => s.lapsed_at !== null)).toBe(true);
    const fourth = c!.seats[PANEL]!;
    expect(fourth.lapsed_at).toBeNull();
    expect(c!.seats.slice(0, PANEL).map((s) => s.root)).not.toContain(fourth.root);
    expect(await refused(`/p/${p}/events`, verdict(first, p, p2, id, 'author'))).toBe('this seat lapsed');
    expect((await stateOf(p, p2)).state).toBe('challenged');
    await accepted(`/p/${p}/events`, verdict(fourth.root, p, p2, id, 'author'));
    // The three that lapsed are done, the fourth has answered, and nobody else is in the pool: one verdict is no majority, so void.
    [, c] = await challengesOf(p);
    expect(c!.outcome).toBe('void');
    expect(c!.seats.filter((s) => s.verdict).map((s) => s.verdict!.for)).toEqual(['author']);
    expect((await stateOf(p, p2)).state).toBe('accepted_provisional');
    expect(tracker.layer().standing(addr(C))).toBe(2);
    // A fresh challenge on the same piece, inside the window, decided for the author by two seats.
    const id2 = await accepted(`/p/${p}/events`, challenge(C, p, p2, 2, 'Both quote a sentence that supposes, not states.'));
    const list = await challengesOf(p);
    const c2 = list.find((x) => x.id === id2)!;
    await accepted(`/p/${p}/events`, verdict(c2.seats[0]!.root, p, p2, id2, 'author'));
    await accepted(`/p/${p}/events`, verdict(c2.seats[1]!.root, p, p2, id2, 'author'));
    expect((await challengesOf(p)).find((x) => x.id === id2)!.outcome).toBe('failed');
    expect((await stateOf(p, p2)).state).toBe('accepted_provisional');
    expect(tracker.layer().standing(addr(C))).toBe(0);
    expect(await refused(`/p/${p}/events`, challenge(C, p, p2, 1))).toBe('standing 0 is below the stake of 1');
  });
  it('refuses a challenge once the window has closed, when the core calls the piece accepted', async () => {
    await returnOn(p, p3, A, 'anthropic/claude');
    await returnOn(p, p3, B, 'openai/gpt');
    clock.tick += 49 * HOUR;
    expect((await stateOf(p, p3)).state).toBe('accepted');
    expect(await refused(`/p/${p}/events`, challenge(D, p, p3, 1))).toBe('outside the window');
    expect((await stateOf(p, p2)).state).toBe('accepted');
  });
});
