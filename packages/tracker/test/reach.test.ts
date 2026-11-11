import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, commitHash, newNonce } from '@bitquilt/core';
import { VERDICT, boot, envelope, key } from './helpers.js';

/**
 * A whole line reached: docs/v2/READING.md section 8, the fourth departure of its section 12, and
 * docs/ext/QX-23.md section 1. "A fork reaches the line of each problem its line's envelopes name in `from`", and "a
 * square is read where it was made". So a fork of one version inherits the square a piece has on an earlier version
 * of its source, or on a version made beside it, where the source itself does not keep the piece; the source is named
 * first where it shows the square, then a shorter chain before a longer; an older version of the fork reads the
 * `from` a later version of its line names; and a fork reaches no version of its own line, whose squares are its own
 * by the line's record. This file leaves one ledger that shows each.
 */

const owner = key(9),
  elsewhere = key(8),
  forker = key(7),
  A = key(1),
  B = key(2);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const asked = (what: string) => ({ ...agree, brief: `Does the study name its ${what}?` });
const alpha = asked('sample'),
  beta = asked('funder'),
  gamma = asked('method'),
  delta = asked('limits'),
  eta = asked('dates'),
  zeta = asked('place'),
  theta = asked('authors');

const t = boot('2026-11-11T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Mark = { problem: Hash; state: string } | null;
type Shown = { name: string; hash: Hash; state: string; inherited: Mark };
type State = { pieces: Shown[]; complete: boolean };
const stateOf = (problem: Hash) => get<State>(`/p/${problem}/state`);
const shown = async (problem: Hash, name: string) => {
  const { state, inherited } = (await stateOf(problem)).pieces.find((p) => p.name === name)!;
  return { state, inherited };
};
const from = (problem: Hash, state: string) => ({ state: 'inherited', inherited: { problem, state } });

async function publish(e: ReturnType<typeof envelope>): Promise<Hash> {
  const r = await post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
/** A commit and its reveal on a piece, posted to the version named. */
async function returned(problem: Hash, name: string, k: Uint8Array, model: string): Promise<void> {
  const piece = (await stateOf(problem)).pieces.find((p) => p.name === name)!.hash;
  const ret = { verdict: 'supports' };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
/** Two readers of two vendors agree on a piece, one at each version named: a square, provisional for its window. */
async function squared(first: Hash, second: Hash, name: string): Promise<void> {
  await returned(first, name, A, 'anthropic/claude');
  await returned(second, name, B, 'openai/gpt');
}

describe('a whole line reached', () => {
  let W1: Hash, W2: Hash, SIDE: Hash, Z: Hash, FW: Hash, FW2: Hash;

  beforeAll(async () => {
    W1 = await publish(envelope(owner, 'study', { alpha, beta, eta }));
    W2 = await publish(envelope(owner, 'study', { alpha, gamma }, { prev: W1, title: 'The second' }));
    SIDE = await publish(envelope(owner, 'study', { alpha, delta, eta }, { prev: W1, title: 'Beside the second' }));
    Z = await publish(envelope(elsewhere, 'aside', { zeta }));
    FW = await publish(
      envelope(forker, 'study-pursued', { alpha, beta, gamma, delta, eta, zeta, theta }, { from: W2 }),
    );
  });

  it('inherits a square made on an earlier version of the source, on a piece the source dropped', async () => {
    expect(await shown(FW, 'beta')).toEqual({ state: 'open', inherited: null });
    await squared(W1, W1, 'beta');
    expect(await shown(FW, 'beta')).toEqual(from(W1, 'accepted_provisional'));
  });

  it('inherits a square made on a version beside the source, on a piece only that version holds', async () => {
    await squared(SIDE, SIDE, 'delta');
    expect(await shown(FW, 'delta')).toEqual(from(SIDE, 'accepted_provisional'));
  });

  it('names the source first where the source shows the square, wherever the readings were posted', async () => {
    await squared(W1, SIDE, 'alpha');
    await squared(W2, W2, 'gamma');
    expect(await shown(FW, 'alpha')).toEqual(from(W2, 'accepted_provisional'));
    expect(await shown(FW, 'gamma')).toEqual(from(W2, 'accepted_provisional'));
  });

  it('names the earlier version before the one beside the source, where both show the square', async () => {
    await squared(SIDE, W1, 'eta');
    expect((await shown(SIDE, 'eta')).state).toBe('accepted_provisional');
    expect(await shown(FW, 'eta')).toEqual(from(W1, 'accepted_provisional'));
  });

  it('reads on an older version of the fork the from a later version of its line names', async () => {
    await squared(Z, Z, 'zeta');
    expect(await shown(FW, 'zeta')).toEqual({ state: 'open', inherited: null });
    FW2 = await publish(envelope(forker, 'study-pursued', { alpha, zeta, theta }, { prev: FW, from: Z }));
    expect(await shown(FW2, 'zeta')).toEqual(from(Z, 'accepted_provisional'));
    expect(await shown(FW, 'zeta')).toEqual(from(Z, 'accepted_provisional'));
    // The later version's own envelope names the other problem, and its chain still reaches the first source's line.
    expect(await shown(FW2, 'alpha')).toEqual(from(W2, 'accepted_provisional'));
  });

  it('reaches no version of its own line, whose square is its own by the record', async () => {
    await squared(FW2, FW2, 'theta');
    expect(await shown(FW2, 'theta')).toEqual({ state: 'accepted_provisional', inherited: null });
    expect(await shown(FW, 'theta')).toEqual({ state: 'accepted_provisional', inherited: null });
  });

  it('is complete by the squares of the whole line once their windows close, and moves nothing there', async () => {
    t.clock.tick += 49 * 3600 * 1000;
    expect(await shown(FW, 'beta')).toEqual(from(W1, 'accepted'));
    expect(await shown(FW, 'delta')).toEqual(from(SIDE, 'accepted'));
    expect((await stateOf(FW)).complete).toBe(true);
    expect((await stateOf(FW2)).complete).toBe(true);
    // The source keeps neither piece, and says nothing of them.
    expect((await stateOf(W2)).pieces.map((p) => p.name).sort()).toEqual(['alpha', 'gamma']);
    for (const v of [W1, W2, SIDE, Z])
      for (const p of (await stateOf(v)).pieces) expect(p.inherited, `${p.name}`).toBeNull();
  });
});
