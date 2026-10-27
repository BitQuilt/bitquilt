import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { type Address, type Envelope, type Hash, type Unsigned, addressOf, commitHash, newNonce, problemHash, signEvent, signObject } from '@bitquilt/core';
import { Store } from '../src/store.js';
import { createTracker } from '../src/tracker.js';

/**
 * Gold pieces (QX-16) at the tracker's door and in its layer: the owner commits by hash before the work and nobody
 * else can; the stake covers each piece's share, one for each root a miss would dock at the stake the rule asks and so
 * two a piece where no stake is asked, and the owner's free standing covers the stake, which is then locked; a reveal
 * is refused before acceptance, after the window, twice, and when it does not match; a match marks the square verified;
 * a miss strikes the set, docks its roots, forfeits their locks and sends the piece back; a struck root's challenge on
 * the miss stakes nothing, and one that holds restores the set and forfeits the owner's stake; a new root the miss left
 * at zero can still challenge it; a commitment left unrevealed lapses.
 */
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const ownerP = key(9), ownerQ = key(8), A = key(1), B = key(2), F = key(6), N = key(21), M = key(22);
const judges = [key(11), key(12), key(13), key(14)];
const addr = addressOf;
const secretOf = new Map<Address, Uint8Array>([ownerP, ownerQ, A, B, F, N, M, ...judges].map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };

function envelope(owner: Uint8Array, slug: string, count: number): Envelope {
  const problem: Envelope['problem'] = {
    title: `Statements (${slug})`, done_when: 'Every statement has a verdict.', owner: addr(owner), slug, prev: null, from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 100, patch_max: 10000 },
    pieces: { 'statement/*': { count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } },
    data: {},
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

let server: Server;
let base: string;
const store = new Store(':memory:');
let tick = Date.parse('2026-10-26T12:00:00Z');
const HOUR = 3_600_000;
const tracker = createTracker({ store, url: 'http://tracker.test/', now: () => new Date(tick).toISOString(), ipSalt: 's', limits: { keyPerHour: 1000, ipPerHour: 10000 } });

beforeAll(async () => {
  server = await tracker.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const get = async (path: string) => (await fetch(base + path)).json();
function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  tick += 1000;
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: new Date(tick).toISOString(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}
async function refused(path: string, event: unknown): Promise<string> {
  const r = await post(path, event);
  expect(r.status, await r.clone().text()).toBe(400);
  return ((await r.json()) as { error: string }).error;
}
async function accepted(path: string, event: unknown): Promise<Hash> {
  const r = await post(path, event);
  expect(r.status, await r.clone().text()).toBe(202);
  return ((await r.json()) as { id: Hash }).id;
}
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string, verdict = 'supports') {
  const ret = { verdict, quote: `as ${addr(k).slice(0, 6)} read it` };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
/** A lock of one, then a commit and its reveal, on a staked piece. */
async function stakedReturn(problem: Hash, piece: Hash, k: Uint8Array, model: string, verdict = 'supports') {
  await accepted(`/p/${problem}/events`, ev(k, 'lock', { kind: 'standing', amount: 1 }, problem, piece));
  await returnOn(problem, piece, k, model, verdict);
}
type Standing = { standing: number; locked: number; free: number };
const standingOf = async (k: Uint8Array) => (await get(`/k/${addr(k)}/standing`)) as Standing;
type PieceState = { hash: Hash; name: string; state: string; core: string; gold: string | null; verified: boolean };
const pieceOf = async (problem: Hash, piece: Hash) => ((await get(`/p/${problem}/state`)) as { pieces: PieceState[] }).pieces.find((x) => x.hash === piece)!;
type Challenge = { id: Hash; against: string; outcome: string; seats: { root: Address }[] };
const challengesOf = async (problem: Hash) => ((await get(`/p/${problem}/challenges`)) as { challenges: Challenge[] }).challenges;

/** The owner's gold: the projection of each answer to the agreed fields, a nonce each, the commitments. */
const golden = new Map<Hash, { projection: Record<string, unknown>; nonce: string }>();
function commitments(pieces: Hash[], verdict = 'supports'): Record<string, Hash> {
  const out: Record<string, Hash> = {};
  for (const p of pieces) {
    const projection = { verdict };
    const nonce = newNonce();
    golden.set(p, { projection, nonce });
    out[p] = commitHash(projection, nonce);
  }
  return out;
}
const reveal = (k: Uint8Array, problem: Hash, piece: Hash, nonce = golden.get(piece)!.nonce) => ev(k, 'gold_reveal', { projection: golden.get(piece)!.projection, nonce }, problem, piece);

const P = envelope(ownerP, 'golden', 5);
const Q = envelope(ownerQ, 'elsewhere', 8);
const R = envelope(ownerQ, 'anew', 1);
const p = problemHash(P);
const q = problemHash(Q);
const r = problemHash(R);
let p1: Hash, p2: Hash, p3: Hash, p4: Hash, p5: Hash;

describe('gold pieces', () => {
  it('takes gold from the owner alone, with a stake that covers the shares and that the owner\'s free standing covers, and locks the stake', async () => {
    const w = await get('/.well-known/quilt');
    expect(w.gold).toEqual({ extension: 'QX-16' });
    expect((await post('/p', { envelope: P })).status).toBe(201);
    expect((await post('/p', { envelope: Q })).status).toBe(201);
    const s = (await get(`/p/${p}/state`)) as { pieces: PieceState[] };
    [p1, p2, p3, p4, p5] = s.pieces.map((x) => x.hash) as [Hash, Hash, Hash, Hash, Hash];
    expect(s.pieces.every((x) => x.gold === null && x.verified === false)).toBe(true);
    await accepted(`/p/${p}/events`, ev(ownerP, 'stake_rule', { min: 1 }, p));
    // Under a rule of 1 an agree piece's share is two: one for each root a miss would dock, at the stake the rule asks.
    const first = commitments([p1, p2]);
    expect(await refused(`/p/${p}/events`, ev(A, 'gold', { commitments: first, stake: 4 }, p))).toBe('the owner alone commits gold');
    expect(await refused(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: { ['sha256:' + 'ab'.repeat(32)]: first[p1] }, stake: 2 }, p))).toBe('gold names a piece this problem does not have');
    expect(await refused(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: first, stake: 2 }, p))).toBe('the gold asks a stake of at least 4');
    expect(await refused(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: first, stake: 4 }, p))).toBe('free standing 1 is below the gold stake of 4');
    // The owner earns standing elsewhere, as do the roots that will work and judge.
    const qs = ((await get(`/p/${q}/state`)) as { pieces: PieceState[] }).pieces.map((x) => x.hash) as Hash[];
    await returnOn(q, qs[0]!, ownerP, 'anthropic/claude');
    await returnOn(q, qs[0]!, judges[0]!, 'openai/gpt');
    await returnOn(q, qs[1]!, ownerP, 'anthropic/claude');
    await returnOn(q, qs[1]!, judges[1]!, 'google/gemini');
    await returnOn(q, qs[2]!, A, 'anthropic/claude');
    await returnOn(q, qs[2]!, B, 'openai/gpt');
    await returnOn(q, qs[3]!, A, 'anthropic/claude');
    await returnOn(q, qs[3]!, B, 'openai/gpt');
    await returnOn(q, qs[4]!, judges[2]!, 'google/gemini');
    await returnOn(q, qs[4]!, judges[3]!, 'meta/llama');
    await returnOn(q, qs[5]!, ownerP, 'anthropic/claude');
    await returnOn(q, qs[5]!, judges[2]!, 'google/gemini');
    await returnOn(q, qs[6]!, ownerP, 'anthropic/claude');
    await returnOn(q, qs[6]!, judges[3]!, 'meta/llama');
    await returnOn(q, qs[7]!, ownerP, 'anthropic/claude');
    await returnOn(q, qs[7]!, F, 'meta/llama');
    expect(await standingOf(ownerP)).toMatchObject({ standing: 6, locked: 0, free: 6 });
    await accepted(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: first, stake: 4 }, p));
    expect(await standingOf(ownerP)).toMatchObject({ standing: 6, locked: 4, free: 2 });
    expect(await refused(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: { [p1]: commitHash({ verdict: 'supports' }, newNonce()) }, stake: 2 }, p))).toBe('this piece has its gold');
    await accepted(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: commitments([p3]), stake: 2 }, p));
    expect(await standingOf(ownerP)).toMatchObject({ standing: 6, locked: 6, free: 0 });
    for (const h of [p1, p2, p3]) expect(await pieceOf(p, h)).toMatchObject({ gold: 'pending', verified: false });
    for (const h of [p4, p5]) expect(await pieceOf(p, h)).toMatchObject({ gold: null });
    // A piece already worked takes no gold, and nothing is revealed before an acceptance.
    await accepted(`/p/${p}/events`, ev(F, 'lock', { kind: 'standing', amount: 1 }, p, p4));
    await accepted(`/p/${p}/events`, ev(F, 'claim', { by: by('meta/llama') }, p, p4));
    expect(await refused(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: commitments([p4]), stake: 2 }, p))).toBe('gold names a piece already worked: statement/4');
    expect(await refused(`/p/${p}/events`, reveal(ownerP, p, p1))).toBe('nothing accepted on this piece yet');
    // A plain piece beside the gold, worked by the other owner, who earns the point a later gold of theirs is backed by.
    await stakedReturn(p, p5, ownerQ, 'anthropic/claude');
    await stakedReturn(p, p5, judges[0]!, 'openai/gpt');
    expect(await standingOf(ownerQ)).toMatchObject({ standing: 2, locked: 1, free: 1 });
  }, 30_000);

  it('marks a square verified on a match, and refuses a reveal that does not match, a second one, and one from anyone but the owner', async () => {
    await stakedReturn(p, p1, A, 'anthropic/claude');
    await stakedReturn(p, p1, B, 'openai/gpt');
    expect((await pieceOf(p, p1)).state).toBe('accepted_provisional');
    expect(await refused(`/p/${p}/events`, reveal(A, p, p1))).toBe('the owner alone reveals gold');
    expect(await refused(`/p/${p}/events`, reveal(ownerP, p, p1, newNonce()))).toBe('the reveal does not match the commitment');
    await accepted(`/p/${p}/events`, reveal(ownerP, p, p1));
    expect(await pieceOf(p, p1)).toMatchObject({ state: 'accepted_provisional', gold: 'match', verified: true });
    expect(await refused(`/p/${p}/events`, reveal(ownerP, p, p1))).toBe('the gold on this piece is revealed');
    expect(await standingOf(A)).toMatchObject({ standing: 4, locked: 1, free: 3 });
  });

  it('strikes the set on a miss, docking its roots and forfeiting their locks, and sends the piece back', async () => {
    await stakedReturn(p, p2, A, 'anthropic/claude', 'contradicts');
    await stakedReturn(p, p2, B, 'openai/gpt', 'contradicts');
    expect((await pieceOf(p, p2)).state).toBe('accepted_provisional');
    expect(await standingOf(A)).toMatchObject({ standing: 5, locked: 2, free: 3 });
    await accepted(`/p/${p}/events`, reveal(ownerP, p, p2));
    expect(await pieceOf(p, p2)).toMatchObject({ state: 'open', core: 'accepted_provisional', gold: 'miss', verified: false });
    // Five points: one docked, the square's withdrawn, the lock of one forfeited; the lock on the verified square still holds.
    expect(await standingOf(A)).toMatchObject({ standing: 2, locked: 1, free: 1 });
    expect(await standingOf(B)).toMatchObject({ standing: 2, locked: 1, free: 1 });
    const offered = (await get(`/p/${p}/next?key=${addr(judges[3]!)}&can=web&model=meta/llama`)) as { piece: Hash | null };
    expect(offered.piece).not.toBeNull();
  });

  it('takes a challenge on the miss from a struck root alone, staking nothing, and a held one restores the set, forfeits the owner\'s stake and drops the rest of the gold', async () => {
    // Against an acceptance a stake of 0 is refused; against a miss it is allowed, and only to a root the miss struck.
    expect(await refused(`/p/${p}/events`, ev(judges[1]!, 'challenge', { stake: 0, ground: 'For nothing.' }, p, p1))).toBe('a challenge on an acceptance stakes at least 1');
    expect(await refused(`/p/${p}/events`, ev(F, 'challenge', { stake: 0, ground: 'The gold is wrong.' }, p, p2))).toBe('only a root of the struck set challenges a miss');
    const id = await accepted(`/p/${p}/events`, ev(A, 'challenge', { stake: 0, ground: 'The paper says the opposite of the gold.' }, p, p2));
    expect(await pieceOf(p, p2)).toMatchObject({ state: 'challenged', gold: 'miss' });
    const c = (await challengesOf(p)).find((x) => x.id === id)!;
    expect(c.against).toBe('gold');
    expect(c.seats).toHaveLength(3);
    const drawn = c.seats.map((s) => s.root);
    expect(drawn).not.toContain(addr(B));
    expect(drawn).not.toContain(addr(A));
    for (const s of c.seats.slice(0, 2)) await accepted(`/p/${p}/events`, ev(secretOf.get(s.root)!, 'verdict', { challenge: id, for: 'challenger' }, p, p2));
    expect((await challengesOf(p)).find((x) => x.id === id)!.outcome).toBe('held');
    expect(await pieceOf(p, p2)).toMatchObject({ state: 'accepted_provisional', gold: 'overruled', verified: false });
    // The point docked, the square's point and the lock come back; nothing was staked, so nothing more is won: five, with two locked.
    expect(await standingOf(A)).toMatchObject({ standing: 5, locked: 2, free: 3 });
    expect(await standingOf(B)).toMatchObject({ standing: 5, locked: 2, free: 3 });
    // The owner's first gold is forfeited whole; the second still locks its two.
    expect(await standingOf(ownerP)).toMatchObject({ standing: 2, locked: 2, free: 0 });
    expect(await pieceOf(p, p3)).toMatchObject({ gold: 'pending' });
  });

  it('lets a commitment lapse when the window closes with no reveal, and releases the owner\'s stake', async () => {
    await stakedReturn(p, p3, A, 'anthropic/claude');
    await stakedReturn(p, p3, B, 'openai/gpt');
    tick += 49 * HOUR;
    expect(await pieceOf(p, p3)).toMatchObject({ state: 'accepted', gold: 'lapsed', verified: false });
    expect(await refused(`/p/${p}/events`, reveal(ownerP, p, p3))).toBe('the window has closed');
    expect(await standingOf(ownerP)).toMatchObject({ standing: 2, locked: 0, free: 2 });
    expect(await pieceOf(p, p1)).toMatchObject({ state: 'accepted', gold: 'match', verified: true });
    expect(await standingOf(A)).toMatchObject({ locked: 0 });
  });

  it('asks two a piece where no stake is asked, and lets a new root the miss left at zero challenge it for nothing', async () => {
    expect(await standingOf(ownerQ)).toMatchObject({ standing: 2, locked: 0, free: 2 });
    expect((await post('/p', { envelope: R })).status).toBe(201);
    const r1 = ((await get(`/p/${r}/state`)) as { pieces: PieceState[] }).pieces[0]!.hash;
    const gold = commitments([r1]);
    expect(await refused(`/p/${r}/events`, ev(ownerQ, 'gold', { commitments: gold, stake: 1 }, r))).toBe('the gold asks a stake of at least 2');
    await accepted(`/p/${r}/events`, ev(ownerQ, 'gold', { commitments: gold, stake: 2 }, r));
    expect(await standingOf(ownerQ)).toMatchObject({ standing: 2, locked: 2, free: 0 });
    // Two new keys, a point each, do the piece and differ from the gold.
    await returnOn(r, r1, N, 'anthropic/claude', 'contradicts');
    await returnOn(r, r1, M, 'openai/gpt', 'contradicts');
    expect(await pieceOf(r, r1)).toMatchObject({ state: 'accepted_provisional', gold: 'pending' });
    expect(await standingOf(N)).toMatchObject({ standing: 2, locked: 0, free: 2 });
    await accepted(`/p/${r}/events`, reveal(ownerQ, r, r1));
    expect(await pieceOf(r, r1)).toMatchObject({ state: 'open', gold: 'miss' });
    // The set's point withdrawn and one docked: a new root struck by a miss is at zero, and a stake of 1 is beyond it.
    expect(await standingOf(N)).toMatchObject({ standing: 0, locked: 0, free: 0 });
    expect(await standingOf(M)).toMatchObject({ standing: 0 });
    expect(await refused(`/p/${r}/events`, ev(N, 'challenge', { stake: 1, ground: 'The gold is wrong.' }, r, r1))).toBe('standing 0 is below the stake of 1');
    const id = await accepted(`/p/${r}/events`, ev(N, 'challenge', { stake: 0, ground: 'The paper contradicts the gold on its first page.' }, r, r1));
    const c = (await challengesOf(r)).find((x) => x.id === id)!;
    expect(c.against).toBe('gold');
    expect(c.seats).toHaveLength(3);
    for (const s of c.seats.slice(0, 2)) await accepted(`/p/${r}/events`, ev(secretOf.get(s.root)!, 'verdict', { challenge: id, for: 'challenger' }, r, r1));
    expect((await challengesOf(r)).find((x) => x.id === id)!.outcome).toBe('held');
    expect(await pieceOf(r, r1)).toMatchObject({ state: 'accepted_provisional', gold: 'overruled' });
    expect(await standingOf(N)).toMatchObject({ standing: 2, locked: 0, free: 2 });
    expect(await standingOf(M)).toMatchObject({ standing: 2 });
    expect(await standingOf(ownerQ)).toMatchObject({ standing: 0, locked: 0, free: 0 });
  }, 30_000);
});
