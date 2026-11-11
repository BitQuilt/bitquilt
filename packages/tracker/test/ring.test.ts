import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, commitHash, newNonce } from '@bitquilt/core';
import { VERDICT, boot, envelope, key } from './helpers.js';

/**
 * A ring of `from`, with squares that wait on one another across it (docs/ext/QX-23.md section 3, and
 * docs/v2/READING.md section 8): "The pieces done elsewhere are counted over every problem that reaches something,
 * again until nothing moves, on a ring of `from` as off it." A problem and its fork each name the other, the problem
 * in a later version, and four pieces stand in a chain, each waiting on the one before. The first is answered at the
 * problem, the second at the fork, the third at the problem and the fourth at the fork, each once the square before
 * it is final. So each problem is read with what its own reach opened, and a square made on a piece so opened is
 * read by the other across the ring. The ledger this file leaves is the fixture a second implementation is held to,
 * since one that works a problem out once, and reads a problem met again on the ring with no inherited square, stops
 * at the second piece.
 */
const owner = key(9),
  forker = key(5),
  A = key(1),
  B = key(2);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const chain = {
  first: { ...agree, brief: 'Does the paper state its question?' },
  second: { ...agree, brief: 'Given the question, does the paper name its method? {first}', inputs: ['first'] },
  third: { ...agree, brief: 'Given the method, does the paper report a result? {second}', inputs: ['second'] },
  fourth: { ...agree, brief: 'Given the result, does the paper say what it means? {third}', inputs: ['third'] },
};
const NAMES = ['first', 'second', 'third', 'fourth'] as const;

const HOUR = 3_600_000;
const t = boot('2026-11-11T12:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

async function publish(e: Envelope): Promise<Hash> {
  const r = await post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
type Mark = { problem: Hash; state: string } | null;
type State = { pieces: { name: string; hash: Hash; state: string; inherited: Mark }[]; complete: boolean };
const stateOf = (problem: Hash) => get<State>(`/p/${problem}/state`);
/** Each piece's state on a problem in the chain's order, and beside an inherited one the problem its square is at. */
const shown = async (problem: Hash) => {
  const { pieces } = await stateOf(problem);
  return NAMES.map((name) => {
    const p = pieces.find((x) => x.name === name)!;
    return p.inherited ? `${p.state} ${p.inherited.state} at ${p.inherited.problem}` : p.state;
  });
};
/** Two readers of different vendors agree on a piece, and its window closes: a square that is final. */
async function squared(problem: Hash, name: string): Promise<void> {
  const piece = (await stateOf(problem)).pieces.find((p) => p.name === name)!.hash;
  for (const [k, model] of [
    [A, 'anthropic/claude'],
    [B, 'openai/gpt'],
  ] as const) {
    const ret = { verdict: 'supports' };
    const nonce = newNonce();
    await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
    await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
  }
  t.clock.tick += 49 * HOUR;
}

describe('a ring of from whose squares wait on one another (QX-23 section 3)', () => {
  let P1: Hash, F: Hash, P2: Hash;
  const from = (problem: Hash) => `inherited accepted at ${problem}`;

  it('opens the second piece at the fork once the first is final at the problem', async () => {
    P1 = await publish(envelope(owner, 'ring', chain));
    await squared(P1, 'first');
    F = await publish(envelope(forker, 'ring-forked', chain, { from: P1 }));
    expect(await shown(F)).toEqual([from(P1), 'open', 'locked', 'locked']);
  });

  it('closes the ring with a version of the problem that names the fork, and each reaches the other', async () => {
    await squared(F, 'second');
    P2 = await publish(envelope(owner, 'ring', chain, { prev: P1, from: F }));
    expect(await shown(P2)).toEqual(['accepted', from(F), 'open', 'locked']);
    expect(await shown(F)).toEqual([from(P1), 'accepted', 'open', 'locked']);
  });

  it('reads across the ring a square made on a piece the ring opened, at each turn of it', async () => {
    await squared(P2, 'third');
    // The fork reads the third square at the problem, which made it on a piece the fork's own square opened there.
    // The line's first version is named, the first in the fork's reach that shows the square (QX-23 section 1).
    expect(await shown(F)).toEqual([from(P1), 'accepted', from(P1), 'open']);
    await squared(F, 'fourth');
    expect((await shown(F))[3]).toBe('accepted');
    expect(await shown(P2)).toEqual(['accepted', from(F), 'accepted', from(F)]);
  });

  it('is complete in the layer on both sides, each by the squares of the other', async () => {
    expect((await stateOf(P2)).complete).toBe(true);
    expect((await stateOf(F)).complete).toBe(true);
    // The earlier version is of the problem's line, so it reads the fork's squares as the later one does.
    expect(await shown(P1)).toEqual(await shown(P2));
  });
});
