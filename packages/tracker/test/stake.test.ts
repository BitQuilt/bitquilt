import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, commitHash, newNonce, problemHash } from '@bitquilt/core';
import { addr, boot, envelope as signed, key } from './helpers.js';

/**
 * Stake at the door (QX-15), standing only: the owner sets the rule and nobody else; a claim, a commit, a reveal or a
 * run on a staked piece is admitted only from a root with a live lock; a lock is refused over free standing, below the
 * stake, on an unstaked piece and twice on one piece; locked standing cannot be staked again on a challenge; a lock is
 * released when the window closes or when nothing was produced in the lease, and forfeited with the set a held
 * challenge strikes; the offers leave out what a key cannot cover; a coin lock is refused by a tracker with no coin.
 */
const owner = key(9), A = key(1), B = key(2), C = key(3), D = key(4), E = key(5), F = key(6);
const judges = [key(11), key(12), key(13), key(14)];
const secretOf = new Map<Address, Uint8Array>([owner, A, B, C, D, E, F, ...judges].map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } };

function envelope(slug: string, count: number, seat = false): Envelope {
  const pieces: Envelope['problem']['pieces'] = { 'statement/*': { count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } };
  if (seat) pieces['seat/*'] = { count: 1, verifier: 'agree', requires: [], brief: 'A second reading of statement {n}.', schema, agree: ['verdict'] };
  return signed(owner, slug, pieces);
}

const HOUR = 3_600_000;
const t = boot('2026-10-26T09:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { clock, ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

/** A commit and its reveal from one key. */
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string, verdict = 'supports') {
  const ret = { verdict };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
const claim = (k: Uint8Array, problem: Hash, piece: Hash, model: string) => ev(k, 'claim', { by: by(model) }, problem, piece);
const lock = (k: Uint8Array, problem: Hash, piece: Hash, amount: number, kind = 'standing') => ev(k, 'lock', kind === 'standing' ? { kind, amount } : { kind, amount, id: 'sha256:' + '0'.repeat(64) }, problem, piece);
const rule = (k: Uint8Array, problem: Hash, body: Record<string, unknown>) => ev(k, 'stake_rule', body, problem);
type Standing = { address: Address; root: Address; standing: number; locked: number; free: number; locks: { problem: Hash; piece: Hash; amount: number; at: string }[] };
const standingOf = async (k: Uint8Array) => (await get(`/k/${addr(k)}/standing`)) as Standing;
type StateView = { stake_rule: { min: number; pieces: string[] | null } | null; pieces: { hash: Hash; name: string; state: string; stake: number }[] };
const stateOf = async (problem: Hash) => (await get(`/p/${problem}/state`)) as StateView;
const nextFor = async (problem: Hash, k: Uint8Array, model = 'meta/llama') => (await get(`/p/${problem}/next?key=${addr(k)}&can=web&model=${model}`)) as { piece: Hash | null; stake?: number; unaffordable?: Hash[] };

const P = envelope('staked', 3, true);
const Q = envelope('elsewhere', 5);
const p = problemHash(P);
const q = problemHash(Q);
let p1: Hash, p2: Hash, p3: Hash, seat: Hash;
let q1: Hash, q2: Hash, q3: Hash, q4: Hash;

describe('stake at the door', () => {
  it('advertises the extension, takes a rule from the owner alone, and shows the stake on every piece', async () => {
    const w = await get<{ stake: unknown; routes: string[] }>('/.well-known/quilt');
    expect(w.stake).toEqual({ extension: 'QX-15', coin: null });
    expect(w.routes).toContain('/k/<address>/standing');
    expect((await post('/p', { envelope: P })).status).toBe(201);
    const s = await stateOf(p);
    [p1, p2, p3, seat] = s.pieces.map((x) => x.hash) as [Hash, Hash, Hash, Hash];
    expect(s.stake_rule).toBeNull();
    expect(s.pieces.every((x) => x.stake === 0)).toBe(true);
    expect(await refused(`/p/${p}/events`, rule(A, p, { min: 2 }))).toBe('the owner alone sets a stake rule');
    expect(await refused(`/p/${p}/events`, rule(owner, p, { min: -1 }))).toBe('body.min: a whole number from 0');
    expect(await refused(`/p/${p}/events`, rule(owner, p, { min: 2, pieces: ['nothing'] }))).toBe('names a piece or family this problem does not have');
    await accepted(`/p/${p}/events`, rule(owner, p, { min: 2 }));
    const after = await stateOf(p);
    expect(after.stake_rule).toEqual({ min: 2, pieces: null });
    expect(after.pieces.every((x) => x.stake === 2)).toBe(true);
  });

  it('refuses a fresh root\'s claim, commit and lock on a staked piece, and leaves the pieces out of its offer', async () => {
    const offered = await nextFor(p, C);
    expect(offered.piece).toBeNull();
    expect(offered.unaffordable).toHaveLength(4);
    expect(await refused(`/p/${p}/events`, lock(C, p, p1, 2))).toBe('free standing 1 is below the lock of 2');
    expect(await refused(`/p/${p}/events`, lock(C, p, p1, 1))).toBe('this piece asks for a stake of 2');
    expect(await refused(`/p/${p}/events`, lock(C, p, p1, 0))).toBe('body.amount: a whole number of at least 1');
    expect(await refused(`/p/${p}/events`, lock(C, p, p1, 2, 'coin'))).toBe('this tracker honours no coin lock');
    expect(await refused(`/p/${p}/events`, claim(C, p, p1, 'meta/llama'))).toBe('this piece asks for a stake of 2; lock first');
    expect(await refused(`/p/${p}/events`, ev(C, 'commit', { h: commitHash({ verdict: 'supports' }, newNonce()) }, p, p1))).toBe('this piece asks for a stake of 2; lock first');
    const s = await standingOf(C);
    expect(s).toMatchObject({ address: addr(C), root: addr(C), standing: 1, locked: 0, free: 1, locks: [] });
  });

  it('admits a lock from a root with standing, then its claim and return; a second lock on the piece and one over free standing are refused', async () => {
    expect((await post('/p', { envelope: Q })).status).toBe(201);
    const s = await stateOf(q);
    [q1, q2, q3, q4] = s.pieces.map((x) => x.hash) as [Hash, Hash, Hash, Hash];
    await returnOn(q, q1, A, 'anthropic/claude');
    await returnOn(q, q1, B, 'openai/gpt');
    await returnOn(q, q2, judges[0]!, 'anthropic/claude');
    await returnOn(q, q2, judges[1]!, 'openai/gpt');
    await returnOn(q, q3, judges[2]!, 'google/gemini');
    await returnOn(q, q3, judges[3]!, 'meta/llama');
    await returnOn(q, q4, D, 'anthropic/claude');
    await returnOn(q, q4, E, 'openai/gpt');
    expect(await standingOf(A)).toMatchObject({ standing: 2, locked: 0, free: 2 });
    expect(await refused(`/p/${q}/events`, lock(A, q, q2, 1))).toBe('this piece asks no stake');
    const offered = await nextFor(p, A, 'anthropic/claude');
    expect(offered.piece).not.toBeNull();
    expect(offered.stake).toBe(2);
    const lockId = await accepted(`/p/${p}/events`, lock(A, p, p1, 2));
    const locked = await standingOf(A);
    expect(locked).toMatchObject({ standing: 2, locked: 2, free: 0 });
    expect(locked.locks).toEqual([{ problem: p, piece: p1, amount: 2, at: expect.any(String) }]);
    expect(await refused(`/p/${p}/events`, lock(A, p, p1, 2))).toBe('a lock already stands on this piece');
    expect(await refused(`/p/${p}/events`, lock(A, p, p2, 2))).toBe('free standing 0 is below the lock of 2');
    await accepted(`/p/${p}/events`, claim(A, p, p1, 'anthropic/claude'));
    await returnOn(p, p1, A, 'anthropic/claude');
    const lines = (await (await fetch(`${t.base}/p/${p}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as { event: { type: string; key: string } });
    const types = lines.filter((l) => l.event.key === addr(A)).map((l) => l.event.type);
    expect(types).toEqual(['lock', 'claim', 'commit', 'reveal']);
    expect(lockId).toMatch(/^sha256:/);
    // Everything else on the problem is now beyond A's free standing, so nothing is offered.
    expect((await nextFor(p, A, 'anthropic/claude')).piece).toBeNull();
    await accepted(`/p/${p}/events`, lock(B, p, p1, 2));
    await returnOn(p, p1, B, 'openai/gpt');
    expect((await stateOf(p)).pieces.find((x) => x.hash === p1)!.state).toBe('accepted_provisional');
    // The accepted square credits a point; the lock still holds two.
    expect(await standingOf(A)).toMatchObject({ standing: 3, locked: 2, free: 1 });
  });

  it('holds locked standing back from a challenge\'s stake', async () => {
    expect(await refused(`/p/${q}/events`, ev(A, 'challenge', { stake: 2, ground: 'They quote the wrong page.' }, q, q2))).toBe('free standing 1 is below the stake of 2');
  });

  it('releases a lock when the window closes, and a lock that backed no production when the lease passes', async () => {
    await accepted(`/p/${p}/events`, lock(D, p, p2, 2));
    expect(await standingOf(D)).toMatchObject({ standing: 2, locked: 2, free: 0 });
    clock.tick += 2 * HOUR + 1000;
    expect(await standingOf(D)).toMatchObject({ standing: 2, locked: 0, free: 2 });
    expect(await refused(`/p/${p}/events`, claim(D, p, p2, 'anthropic/claude'))).toBe('this piece asks for a stake of 2; lock first');
    clock.tick += 47 * HOUR;
    expect((await stateOf(p)).pieces.find((x) => x.hash === p1)!.state).toBe('accepted');
    expect(await standingOf(A)).toMatchObject({ standing: 3, locked: 0, free: 3 });
    expect(await standingOf(B)).toMatchObject({ standing: 3, locked: 0, free: 3 });
  });

  it('forfeits the locks of a set a held challenge strikes, beside the point QX-1 docks', async () => {
    await accepted(`/p/${p}/events`, lock(A, p, p2, 2));
    await accepted(`/p/${p}/events`, lock(B, p, p2, 2));
    await returnOn(p, p2, A, 'anthropic/claude');
    await returnOn(p, p2, B, 'openai/gpt');
    expect(await standingOf(A)).toMatchObject({ standing: 4, locked: 2, free: 2 });
    const id = await accepted(`/p/${p}/events`, ev(C, 'challenge', { stake: 1, ground: 'The paper says the opposite.' }, p, p2));
    const [c] = ((await get(`/p/${p}/challenges`)) as { challenges: { id: Hash; seats: { root: Address }[] }[] }).challenges.filter((x) => x.id === id);
    expect(c!.seats).toHaveLength(3);
    for (const s of c!.seats.slice(0, 2)) await accepted(`/p/${p}/events`, ev(secretOf.get(s.root)!, 'verdict', { challenge: id, for: 'challenger' }, p, p2));
    expect((await stateOf(p)).pieces.find((x) => x.hash === p2)!.state).toBe('open');
    // Four points gained, one docked, the square's point withdrawn, and the lock of two forfeited: nothing left.
    expect(await standingOf(A)).toMatchObject({ standing: 0, locked: 0, free: 0, locks: [] });
    expect(await standingOf(B)).toMatchObject({ standing: 0, locked: 0, free: 0, locks: [] });
    expect(await standingOf(C)).toMatchObject({ standing: 2, locked: 0, free: 2 });
  });

  it('narrows a rule to a family, replaces it, and the offers follow the free standing of the key', async () => {
    await accepted(`/p/${p}/events`, rule(owner, p, { min: 1, pieces: ['seat'] }));
    const s = await stateOf(p);
    expect(s.stake_rule).toEqual({ min: 1, pieces: ['seat'] });
    expect(s.pieces.find((x) => x.hash === p3)!.stake).toBe(0);
    expect(s.pieces.find((x) => x.hash === seat)!.stake).toBe(1);
    const fresh = await nextFor(p, F);
    expect(fresh.piece).not.toBeNull();
    expect(fresh.unaffordable).toEqual([]);
    await accepted(`/p/${p}/events`, rule(owner, p, { min: 3 }));
    const none = await nextFor(p, F);
    expect(none.piece).toBeNull();
    expect(none.unaffordable).toHaveLength(3);
    expect(await refused(`/p/${p}/events`, claim(F, p, p3, 'meta/llama'))).toBe('this piece asks for a stake of 3; lock first');
    const offers = ((await get(`/offer?key=${addr(F)}&can=web&model=meta/llama`)) as { offers: { problem: Hash }[] }).offers.map((o) => o.problem);
    expect(offers).toContain(q);
    expect(offers).not.toContain(p);
  });
});
