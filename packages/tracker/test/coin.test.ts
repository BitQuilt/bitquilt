import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { type Address, type Envelope, type Hash, type Unsigned, addressOf, commitHash, newNonce, problemHash, signEvent, signObject } from '@bitquilt/core';
import { Store } from '../src/store.js';
import { createTracker } from '../src/tracker.js';

/**
 * The coin as a layer (QX-17) at its home tracker: the parameters published; an epoch's amount minted to the verified
 * squares by weight after the treasury's share, nothing in an empty epoch, vesting over time; a coin lock on the coin
 * log bound to a stake at the problem's door with the receipt carrying the word; a pay escrowed from free coin, vested or not,
 * and paid per square to the credited roots; a burn credited as standing; a forfeit taking the lock and as much again
 * from the unvested, and a held challenge restoring both; a transfer and a redeem from vested free coin, the redeem listed under the head for the bridge, and a credit from the reader for a deposit burned on the chain; every balance
 * under the head.
 */
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const ownerP = key(9), ownerQ = key(8), A = key(1), B = key(2), C = key(3), D = key(4), treasury = key(7);
const reader = key(40);
const judges = [key(11), key(12)];
const addr = addressOf;
const secretOf = new Map<Address, Uint8Array>([ownerP, ownerQ, A, B, C, D, treasury, ...judges].map((k) => [addr(k), k]));
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

const T0 = '2026-10-27T00:00:00.000Z';
const HOUR = 3_600_000;
let tick = Date.parse(T0) + HOUR;
const coin = {
  genesis: T0, epoch_h: 24, emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 }, vesting_h: 48, infra_bp: 1000, treasury: addr(treasury), unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 }, burn_rate: 100, transfers_from: T0, redeem_from: T0, reader: addr(reader),
};
let server: Server;
let base: string;
const store = new Store(':memory:');
const tracker = createTracker({ store, url: 'http://tracker.test/', now: () => new Date(tick).toISOString(), ipSalt: 's', limits: { keyPerHour: 1000, ipPerHour: 10000 }, coin });

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
async function stakedReturn(problem: Hash, piece: Hash, k: Uint8Array, model: string, verdict = 'supports') {
  await accepted(`/p/${problem}/events`, ev(k, 'lock', { kind: 'standing', amount: 1 }, problem, piece));
  await returnOn(problem, piece, k, model, verdict);
}
type Balance = { root: Address; balance: number; vested: number; unvested: number; locked: number; escrowed: number; free: number };
const balanceOf = async (k: Uint8Array) => (await get(`/coin/balance/${addr(k)}`)) as Balance;
type Standing = { standing: number; locked: number; free: number };
const standingOf = async (k: Uint8Array) => (await get(`/k/${addr(k)}/standing`)) as Standing;
type PieceState = { hash: Hash; state: string; gold: string | null; verified: boolean };
const pieceOf = async (problem: Hash, piece: Hash) => ((await get(`/p/${problem}/state`)) as { pieces: PieceState[] }).pieces.find((x) => x.hash === piece)!;
type CoinLock = { id: Hash; root: Address; problem: Hash; piece: Hash; units: number; bound: Hash | null; state: string };
const coinLock = async (id: Hash) => (await get(`/coin/lock/${id}`)) as CoinLock;

const golden = new Map<Hash, { projection: Record<string, unknown>; nonce: string }>();
function commitments(pieces: Hash[], verdict = 'supports'): Hash[] {
  const out: Hash[] = [];
  for (const p of pieces) {
    const projection = { verdict };
    const nonce = newNonce();
    golden.set(p, { projection, nonce });
    out.push(commitHash({ piece: p, projection }, nonce));
  }
  return out.sort();
}
const reveal = (problem: Hash, piece: Hash) => ev(ownerP, 'gold_reveal', { projection: golden.get(piece)!.projection, nonce: golden.get(piece)!.nonce }, problem, piece);

const P = envelope(ownerP, 'golden', 4);
const Q = envelope(ownerQ, 'elsewhere', 6);
const p = problemHash(P);
const q = problemHash(Q);
let p1: Hash, p2: Hash, p3: Hash, p4: Hash;
let q1: Hash, q2: Hash, q3: Hash, q4: Hash, q5: Hash, q6: Hash;
let coinLockId: Hash;

describe('the coin as a layer', () => {
  it('publishes the parameters, names itself the home, and answers empty balances', async () => {
    const w = await get('/.well-known/quilt');
    expect(w.coin).toMatchObject({ extension: 'QX-17', home: 'here', genesis: T0, epoch_h: 24, vesting_h: 48, infra_bp: 1000, treasury: addr(treasury), unit: 1000, burn_rate: 100, transfers_from: T0, redeem_from: T0 });
    expect(w.stake).toEqual({ extension: 'QX-15', coin: 'here', burn_rate: 100 });
    for (const r of ['/coin/events', '/coin/lock/<id>', '/coin/balance/<root>', '/coin/epochs', '/coin/redeems', '/coin/credits', '/coin/state']) expect(w.routes).toContain(r);
    expect(await balanceOf(A)).toEqual({ root: addr(A), balance: 0, vested: 0, unvested: 0, locked: 0, escrowed: 0, free: 0, free_vested: 0, minted: 0, received: 0, burned: 0, forfeited: 0, redeemed: 0, credited: 0, at: expect.any(String), head: null });
    expect((await post('/p', { envelope: P })).status).toBe(201);
    expect((await post('/p', { envelope: Q })).status).toBe(201);
    [p1, p2, p3, p4] = ((await get(`/p/${p}/state`)) as { pieces: PieceState[] }).pieces.map((x) => x.hash) as [Hash, Hash, Hash, Hash];
    [q1, q2, q3, q4, q5, q6] = ((await get(`/p/${q}/state`)) as { pieces: PieceState[] }).pieces.map((x) => x.hash) as [Hash, Hash, Hash, Hash, Hash, Hash];
    await accepted(`/p/${p}/events`, ev(ownerP, 'stake_rule', { min: 1 }, p));
    await returnOn(q, q1, ownerP, 'anthropic/claude');
    await returnOn(q, q1, judges[0]!, 'openai/gpt');
    await returnOn(q, q2, ownerP, 'anthropic/claude');
    await returnOn(q, q2, judges[1]!, 'google/gemini');
    await returnOn(q, q4, ownerP, 'anthropic/claude');
    await returnOn(q, q4, judges[0]!, 'openai/gpt');
    await returnOn(q, q5, ownerP, 'anthropic/claude');
    await returnOn(q, q5, judges[1]!, 'google/gemini');
    await returnOn(q, q6, ownerP, 'anthropic/claude');
    await returnOn(q, q6, C, 'openai/gpt');
    // Six points of standing for three gold pieces: a share of two each under a rule of 1, one for each root a miss would dock.
    expect(await standingOf(ownerP)).toMatchObject({ standing: 6, free: 6 });
    await accepted(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: commitments([p1, p2, p3]), stake: 6 }, p));
  });

  it('mints an epoch\'s amount to the verified squares by weight after the treasury\'s share, nothing in an empty epoch, and vests it over time', async () => {
    await stakedReturn(p, p1, A, 'anthropic/claude');
    await stakedReturn(p, p1, B, 'openai/gpt');
    await accepted(`/p/${p}/events`, reveal(p, p1));
    await stakedReturn(p, p2, A, 'anthropic/claude');
    await stakedReturn(p, p2, B, 'openai/gpt');
    await accepted(`/p/${p}/events`, reveal(p, p2));
    expect(await pieceOf(p, p1)).toMatchObject({ verified: true });
    expect((await balanceOf(A)).balance).toBe(0);
    tick = Date.parse(T0) + 24 * HOUR + 1000;
    const epochs = (await get('/coin/epochs')) as { epochs: { epoch: number; amount: number; treasury: number; weight: number; minted: number }[] };
    expect(epochs.epochs).toEqual([{ epoch: 0, start: T0, end: new Date(Date.parse(T0) + 24 * HOUR).toISOString(), amount: 1000, treasury: 100, weight: 8, minted: 1000 }]);
    expect(await balanceOf(A)).toMatchObject({ balance: 450, vested: 0, unvested: 450, locked: 0, escrowed: 0, free: 450, minted: 450 });
    expect(await balanceOf(B)).toMatchObject({ balance: 450 });
    expect(await balanceOf(treasury)).toMatchObject({ balance: 100 });
    tick = Date.parse(T0) + 48 * HOUR + 1000;
    expect(await balanceOf(A)).toMatchObject({ balance: 450, vested: 225, unvested: 225, free: 450, free_vested: 225 });
    const later = (await get('/coin/epochs')) as { epochs: { epoch: number; minted: number; weight: number }[] };
    expect(later.epochs).toHaveLength(2);
    expect(later.epochs[1]).toMatchObject({ epoch: 1, minted: 0, weight: 0, amount: 1000 });
  });

  it('takes a coin lock the root\'s free coin covers, binds it to a stake at the door with the receipt carrying the word, and refuses what it cannot bind', async () => {
    expect(await refused('/coin/events', ev(B, 'lock', { problem: p, piece: p3, amount: 500 }))).toBe('free coin 450 is below the lock of 500');
    expect(await refused('/coin/events', ev(A, 'lock', { problem: p, piece: 'sha256:' + 'ab'.repeat(32), amount: 100 }))).toBe('names a piece this problem does not have');
    coinLockId = await accepted('/coin/events', ev(A, 'lock', { problem: p, piece: p3, amount: 100 }));
    expect(await coinLock(coinLockId)).toMatchObject({ id: coinLockId, root: addr(A), problem: p, piece: p3, units: 100, bound: null, state: 'live' });
    expect(await balanceOf(A)).toMatchObject({ balance: 450, locked: 100, free: 350 });
    expect(await refused(`/p/${p}/events`, ev(A, 'lock', { kind: 'coin', amount: 2, id: coinLockId }, p, p3))).toBe('the lock holds 100 units, a stake of 1 at 100 a point');
    expect(await refused(`/p/${p}/events`, ev(B, 'lock', { kind: 'coin', amount: 1, id: coinLockId }, p, p3))).toBe('the lock is another root\'s');
    expect(await refused(`/p/${p}/events`, ev(A, 'lock', { kind: 'coin', amount: 1, id: 'sha256:' + 'cd'.repeat(32) }, p, p3))).toBe('no such lock on the coin log');
    expect(await refused(`/p/${p}/events`, ev(A, 'lock', { kind: 'coin', amount: 1, id: coinLockId }, p, p4))).toBe('the lock names another piece');
    const bound = await accepted(`/p/${p}/events`, ev(A, 'lock', { kind: 'coin', amount: 1, id: coinLockId }, p, p3));
    const lines = (await (await fetch(`${base}/p/${p}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as { event: { type: string; key: string }; received: { stake?: Record<string, unknown> }[] });
    const last = lines[lines.length - 1]!;
    expect(last.event.type).toBe('lock');
    expect(last.received[0]!.stake).toMatchObject({ kind: 'coin', amount: 1, id: coinLockId, units: 100, home: 'here' });
    expect(await coinLock(coinLockId)).toMatchObject({ bound, state: 'live' });
    await accepted(`/p/${p}/events`, ev(A, 'claim', { by: by('anthropic/claude') }, p, p3));
    // A coin lock holds no standing: the two standing locks on the verified squares are all that is locked.
    expect(await standingOf(A)).toMatchObject({ standing: 3, locked: 2, free: 1 });
  });

  it('escrows a pay from free coin, vested or not, pays each accepted square to its credited roots, and holds the rest', async () => {
    expect(await refused('/coin/events', ev(A, 'pay', { problem: q, amount: 400, per_square: 50 }))).toBe('free coin 350 is below the pay of 400');
    await accepted('/coin/events', ev(A, 'pay', { problem: q, amount: 200, per_square: 50 }));
    expect(await balanceOf(A)).toMatchObject({ balance: 450, locked: 100, escrowed: 200, free: 150, free_vested: 150 });
    await returnOn(q, q3, C, 'anthropic/claude');
    await returnOn(q, q3, D, 'openai/gpt');
    expect(await balanceOf(C)).toMatchObject({ balance: 25, vested: 25, received: 25 });
    expect(await balanceOf(D)).toMatchObject({ balance: 25 });
    // The square paid left the payer's balance, from the unvested part first; the rest of the escrow waits for the next.
    expect(await balanceOf(A)).toMatchObject({ balance: 400, escrowed: 150, free: 150, vested: 225, unvested: 175 });
  });

  it('forfeits a bound coin lock with the set a miss strikes, taking as much again from the unvested, and a held challenge restores both', async () => {
    await accepted(`/p/${p}/events`, ev(B, 'lock', { kind: 'standing', amount: 1 }, p, p3));
    await returnOn(p, p3, A, 'anthropic/claude', 'contradicts');
    await returnOn(p, p3, B, 'openai/gpt', 'contradicts');
    await accepted(`/p/${p}/events`, reveal(p, p3));
    // Struck: the set is gone from the layer's fold (the claim A still holds keeps the piece in flight), and the core still says accepted.
    expect(await pieceOf(p, p3)).toMatchObject({ state: 'in_flight', core: 'accepted_provisional', gold: 'miss', verified: false });
    expect(await coinLock(coinLockId)).toMatchObject({ state: 'forfeited' });
    // The lock of 100 from the unvested, and as much again from what was left of it: 75.
    expect(await balanceOf(A)).toMatchObject({ balance: 225, locked: 0, forfeited: 175, unvested: 0 });
    const id = await accepted(`/p/${p}/events`, ev(A, 'challenge', { stake: 0, ground: 'The paper says the opposite of the gold.' }, p, p3));
    const c = ((await get(`/p/${p}/challenges`)) as { challenges: { id: Hash; seats: { root: Address }[] }[] }).challenges.find((x) => x.id === id)!;
    for (const s of c.seats.slice(0, 2)) await accepted(`/p/${p}/events`, ev(secretOf.get(s.root)!, 'verdict', { challenge: id, for: 'challenger' }, p, p3));
    expect(await pieceOf(p, p3)).toMatchObject({ state: 'accepted_provisional', gold: 'overruled' });
    expect(await coinLock(coinLockId)).toMatchObject({ state: 'live', bound: expect.any(String) });
    expect(await balanceOf(A)).toMatchObject({ balance: 400, locked: 100, forfeited: 0, unvested: 175 });
  });

  it('burns coin for standing within what is free, from the unvested part first', async () => {
    expect(await refused('/coin/events', ev(A, 'burn', { amount: 300 }))).toBe('free coin 150 is below the burn of 300');
    await accepted('/coin/events', ev(A, 'burn', { amount: 100 }));
    expect(await balanceOf(A)).toMatchObject({ balance: 300, burned: 100, locked: 100, escrowed: 150, free: 50, vested: 225, unvested: 75 });
    // Four after the held challenge gave back the two the miss took, and one more for the burn.
    expect(await standingOf(A)).toMatchObject({ standing: 5, locked: 2, free: 3 });
  });

  it('moves vested free coin by transfer, takes it off the ledger by redeem, and lists the redeem under the head', async () => {
    expect(await refused('/coin/events', ev(A, 'transfer', { to: addr(B), amount: 100 }))).toBe('free vested coin 50 is below the transfer of 100');
    await accepted('/coin/events', ev(A, 'transfer', { to: addr(B), amount: 10 }));
    expect(await balanceOf(A)).toMatchObject({ balance: 290, free: 40, free_vested: 40 });
    expect(await balanceOf(B)).toMatchObject({ balance: 460, received: 10 });
    expect(await refused('/coin/events', ev(A, 'redeem', { amount: 100 }))).toBe('free vested coin 40 is below the redeem of 100');
    await accepted('/coin/events', ev(A, 'redeem', { amount: 20, to: addr(C) }));
    expect(await balanceOf(A)).toMatchObject({ balance: 270, free: 20, redeemed: 20 });
    const r = (await get('/coin/redeems')) as { head: { seq: number; hash: string }; redeems: { id: string; seq: number; root: Address; to: Address; amount: number; at: string }[] };
    expect(r.head.seq).toBe(5);
    expect(r.redeems).toEqual([{ id: r.head.hash, seq: 5, root: addr(A), to: addr(C), amount: 20, at: expect.any(String) }]);
    expect(r.redeems[0]!.id).toMatch(/^[0-9a-f]{64}$/);
    const before = (await get('/coin/redeems?upto=4')) as { head: { seq: number }; redeems: unknown[] };
    expect(before.head.seq).toBe(4);
    expect(before.redeems).toEqual([]);
    expect(await refused('/coin/events', ev(A, 'name', { name: 'x' }))).toBe('the coin log takes lock, pay, burn, transfer, redeem and credit');
    expect(await refused('/coin/events', ev(A, 'burn', { amount: 1 }, p))).toBe('a coin event names no problem in its fields');
  });

  it('credits a deposit burned on the chain from the reader alone, once per deposit, and lists the credits under the head', async () => {
    expect(await refused('/coin/events', ev(A, 'credit', { deposit: 1, root: addr(B), amount: 100 }))).toBe('the reader alone credits a deposit');
    expect(await refused('/coin/events', ev(reader, 'credit', { deposit: 0, root: addr(B), amount: 100 }))).toBe('body.deposit: a whole number of at least 1, the deposit\'s number on the chain');
    await accepted('/coin/events', ev(reader, 'credit', { deposit: 1, root: addr(B), amount: 100 }));
    // Credited coin is vested, as received coin is; what B was minted is still vesting.
    expect(await balanceOf(B)).toMatchObject({ balance: 560, received: 110, credited: 100, vested: 335, free: 560 });
    expect(await refused('/coin/events', ev(reader, 'credit', { deposit: 1, root: addr(C), amount: 5 }))).toBe('deposit 1 is credited already');
    const r = (await get('/coin/credits')) as { head: { seq: number; hash: string }; reader: Address; credits: { id: string; seq: number; deposit: number; root: Address; amount: number; at: string }[] };
    expect(r.head.seq).toBe(6);
    expect(r.reader).toBe(addr(reader));
    expect(r.credits).toEqual([{ id: r.head.hash, seq: 6, deposit: 1, root: addr(B), amount: 100, at: expect.any(String) }]);
    expect(((await get('/coin/credits?upto=5')) as { credits: unknown[] }).credits).toEqual([]);
  });

  it('lists every balance under the head', async () => {
    const s = (await get('/coin/state')) as { head: { seq: number; hash: string }; balances: Record<string, Balance> };
    expect(s.head.seq).toBe(6);
    expect(Object.keys(s.balances).sort()).toEqual([addr(A), addr(B), addr(C), addr(D), addr(treasury)].sort());
    expect(s.balances[addr(A)]).toMatchObject({ balance: 270, redeemed: 20 });
    expect(s.balances[addr(B)]).toMatchObject({ balance: 560, credited: 100 });
    const lines = (await (await fetch(`${base}/coin/events`)).text()).trim().split('\n');
    expect(lines).toHaveLength(6);
  });
});
