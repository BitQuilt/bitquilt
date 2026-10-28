import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, commitHash, newNonce, problemHash } from '@bitquilt/core';
import { epochAmount } from '../src/coin.js';
import { addr, boot, envelope as signed, key } from './helpers.js';

/**
 * The emission schedule's shape (QX-17 section 4, amended 28 October 2026): the curve's tail; the cap on what a unit
 * of verified weight earns in an epoch, the rest of the curve unminted; the burn rate indexed to what a reveal earned
 * in the latest ended epoch with the parameter as its floor, published in force under `stake` and with each lock; and
 * the home admitting no problem whose challenge window is longer than it says.
 */
const ownerP = key(9), ownerQ = key(8), A = key(1), B = key(2), judge = key(11), treasury = key(7);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };
const pieces = (count: number) => ({ 'statement/*': { count, verifier: 'agree' as const, requires: ['web' as const], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } });

const T0 = '2026-10-27T00:00:00.000Z';
const HOUR = 3_600_000;
const params = {
  genesis: T0, epoch_h: 24, emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 1, floor_per_epoch: 400, max_per_weight: 50 }, vesting_h: 48, infra_bp: 1000, treasury: addr(treasury), unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 }, burn_rate: 10, burn_indexed: true, window_max_h: 48, transfers_from: T0, redeem_from: null,
};
const t = boot(new Date(Date.parse(T0) + HOUR).toISOString(), { limits: { keyPerHour: 1000, ipPerHour: 10000 }, coin: params });
const { clock, ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string) {
  const ret = { verdict: 'supports', quote: `as ${addr(k).slice(0, 6)} read it` };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
async function stakedReturn(problem: Hash, piece: Hash, k: Uint8Array, model: string) {
  await accepted(`/p/${problem}/events`, ev(k, 'lock', { kind: 'standing', amount: 1 }, problem, piece));
  await returnOn(problem, piece, k, model);
}
const rateNow = async () => ((await get('/.well-known/quilt')) as { stake: { burn_rate: number } }).stake.burn_rate;
const standingOf = async (k: Uint8Array) => ((await get(`/k/${addr(k)}/standing`)) as { standing: number }).standing;

const P = signed(ownerP, 'capped', pieces(2));
const Q = signed(ownerQ, 'elsewhere', pieces(1));
const p = problemHash(P);
const q = problemHash(Q);
let p1: Hash, p2: Hash, q1: Hash;
const gold = { projection: { verdict: 'supports' }, nonce: newNonce() };

describe('the emission schedule', () => {
  it('never falls below the tail', () => {
    expect([0, 1, 2, 5].map((n) => epochAmount(params, n))).toEqual([1000, 500, 400, 400]);
  });

  it('publishes the new parameters, the floor as the rate in force before any epoch has ended, and the window it admits', async () => {
    const w = (await get('/.well-known/quilt')) as { coin: Record<string, unknown>; stake: unknown };
    expect(w.coin).toMatchObject({ emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 1, floor_per_epoch: 400, max_per_weight: 50 }, burn_rate: 10, burn_indexed: true, window_max_h: 48 });
    expect(w.stake).toEqual({ extension: 'QX-15', coin: 'here', burn_rate: 10 });
  });

  it('admits a problem within the window it says and refuses one beyond it, with the reason', async () => {
    const patient = signed(ownerP, 'patient', pieces(1), { settings: { challenge_window_h: 72 } });
    expect(await (await post('/p', { envelope: patient })).json()).toEqual({ error: 'the challenge window of 72 hours is beyond the 48 this home admits (QX-17)' });
    expect((await post('/p', { envelope: P })).status).toBe(201);
    expect((await post('/p', { envelope: Q })).status).toBe(201);
    [p1, p2] = ((await get(`/p/${p}/state`)) as { pieces: { hash: Hash }[] }).pieces.map((x) => x.hash) as [Hash, Hash];
    [q1] = ((await get(`/p/${q}/state`)) as { pieces: { hash: Hash }[] }).pieces.map((x) => x.hash) as [Hash];
  });

  it('caps what an epoch mints at the rate a unit of weight, and leaves the rest of the curve unminted', async () => {
    await accepted(`/p/${p}/events`, ev(ownerP, 'stake_rule', { min: 1 }, p));
    await returnOn(q, q1, ownerP, 'anthropic/claude');
    await returnOn(q, q1, judge, 'openai/gpt');
    await accepted(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: [commitHash({ piece: p1, projection: gold.projection }, gold.nonce)], stake: 2 }, p));
    await stakedReturn(p, p1, A, 'anthropic/claude');
    await stakedReturn(p, p1, B, 'openai/gpt');
    await accepted(`/p/${p}/events`, ev(ownerP, 'gold_reveal', gold, p, p1));
    // Before the epoch ends, the balance says what is owed: the share the mint will give, and when.
    const end0 = new Date(Date.parse(T0) + 24 * HOUR).toISOString();
    expect(await get(`/coin/balance/${addr(A)}`)).toMatchObject({ balance: 0, pending: { amount: 90, pays_at: end0, epoch: 0 } });
    expect(await get(`/coin/balance/${addr(treasury)}`)).toMatchObject({ pending: { amount: 20, pays_at: end0 } });
    clock.tick = Date.parse(T0) + 24 * HOUR + 1000;
    const { epochs } = (await get('/coin/epochs')) as { epochs: unknown[] };
    // Four units of weight at 50 each: 200 of the curve's 1000, a tenth to the treasury, 90 to each reveal.
    expect(epochs).toEqual([{ epoch: 0, start: T0, end: new Date(Date.parse(T0) + 24 * HOUR).toISOString(), ceiling: 1000, amount: 200, treasury: 20, weight: 4, minted: 200 }]);
    expect(await get(`/coin/balance/${addr(A)}`)).toMatchObject({ balance: 90, minted: 90, free: 90, pending: { amount: 0, epoch: 1 } });
    expect(await get(`/coin/balance/${addr(B)}`)).toMatchObject({ balance: 90 });
    expect(await get(`/coin/balance/${addr(treasury)}`)).toMatchObject({ balance: 20 });
  });

  it('prices a point of standing at what a reveal earned in the latest ended epoch, floored at the parameter, and says so with each lock', async () => {
    // 180 units over four units of weight is 45 a unit; a cross-vendor reveal weighs 2, so a point costs 90.
    expect(await rateNow()).toBe(90);
    const lock = await accepted('/coin/events', ev(A, 'lock', { problem: p, piece: p2, amount: 90 }));
    expect(await get(`/coin/lock/${lock}`)).toMatchObject({ units: 90, rate: 90, state: 'live', bound: null });
    expect(await refused(`/p/${p}/events`, ev(A, 'lock', { kind: 'coin', amount: 2, id: lock }, p, p2))).toBe('the lock holds 90 units, a stake of 1 at 90 a point');
    await accepted(`/p/${p}/events`, ev(A, 'lock', { kind: 'coin', amount: 1, id: lock }, p, p2));
    expect(await get(`/coin/lock/${lock}`)).toMatchObject({ bound: expect.any(String) });
    expect(await refused('/coin/events', ev(B, 'burn', { amount: 100 }))).toBe('free coin 90 is below the burn of 100');
    expect(await standingOf(B)).toBe(2);
    await accepted('/coin/events', ev(B, 'burn', { amount: 90 }));
    expect(await standingOf(B)).toBe(3);
    // After a quiet epoch the rate is the floor again.
    clock.tick = Date.parse(T0) + 48 * HOUR + 1000;
    expect(await rateNow()).toBe(10);
  });
});
