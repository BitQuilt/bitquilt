import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, commitHash, newNonce } from '@bitquilt/core';
import { VERDICT, boot, envelope, key } from './helpers.js';

/**
 * The order of a reach, through a booted tracker, read by reading 2 (docs/v2/READING.md section 8).
 * docs/ext/QX-23.md section 1 walks a fork's sources in order, its own envelope's `from` first and then each
 * ancestor's along `prev`, and takes each source whole before the next: the source's line, then what that line
 * reaches, then the fork's next source. docs/ext/QX-23.md section 2 names, of several squares in reach as far along
 * as one another, the first in that order. So the order decides which problem an inherited square names, and a walk
 * that took every source before what any of them reaches would name another. The ledger this file leaves holds:
 * - a fork in two versions, the first from one source and the second from another, whose own source is a third
 *   problem;
 * - one piece squared on the far problem and on the first version's source, and one squared on that source alone;
 * - the second version naming the far problem, reached through its own source, before its ancestor's source, and
 *   the first version naming its own source, which comes first in its walk.
 */
const far = key(9),
  near = key(10),
  through = key(13),
  forker = key(5),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const pieces = {
  first: { ...agree, brief: 'Is the first claim in the paper?' },
  second: { ...agree, brief: 'Is the second claim in the paper?' },
};

const t = boot('2026-11-11T23:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Mark = { problem: Hash; state: string } | null;
type State = { pieces: { name: string; hash: Hash; state: string; inherited: Mark }[] };

describe('the order of a reach decides the square an inherited piece names (QX-23 sections 1 and 2)', () => {
  let T: Hash, S1: Hash, S2: Hash, F1: Hash, F2: Hash;
  const hashOf = new Map<string, Hash>();
  const publish = async (e: Envelope): Promise<Hash> => {
    const r = await post('/p', { envelope: e });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { hash: Hash }).hash;
  };
  const shown = async (problem: Hash, name: string) => {
    const { state, inherited } = (await get<State>(`/p/${problem}/state`)).pieces.find((p) => p.name === name)!;
    return { state, inherited };
  };
  /** Two readers of different vendors agree on a piece: a square, provisional until its window closes. */
  async function squared(problem: Hash, name: string, pair: [Uint8Array, Uint8Array]) {
    const ret = { verdict: 'supports' };
    for (const [i, k] of pair.entries()) {
      const nonce = newNonce();
      const piece = hashOf.get(name)!;
      const model = i === 0 ? 'anthropic/claude' : 'openai/gpt';
      await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
      await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
    }
  }

  beforeAll(async () => {
    T = await publish(envelope(far, 'order-far', pieces));
    S1 = await publish(envelope(near, 'order-near', pieces));
    S2 = await publish(envelope(through, 'order-through', pieces, { from: T }));
    F1 = await publish(envelope(forker, 'order-fork', pieces, { from: S1 }));
    F2 = await publish(envelope(forker, 'order-fork', pieces, { prev: F1, from: S2 }));
    for (const p of (await get<State>(`/p/${T}/state`)).pieces) hashOf.set(p.name, p.hash);
    await squared(T, 'first', [A, B]);
    await squared(S1, 'first', [C, D]);
    await squared(S1, 'second', [C, D]);
  });

  it('names the square reached through the version’s own source before its ancestor’s source', async () => {
    expect(await shown(F2, 'first')).toEqual({
      state: 'inherited',
      inherited: { problem: T, state: 'accepted_provisional' },
    });
  });

  it('names the first version’s own source, which its walk takes first', async () => {
    expect(await shown(F1, 'first')).toEqual({
      state: 'inherited',
      inherited: { problem: S1, state: 'accepted_provisional' },
    });
  });

  it('names the one square in reach wherever the walk comes to it, and shows a source its own', async () => {
    for (const fork of [F1, F2])
      expect(await shown(fork, 'second')).toEqual({
        state: 'inherited',
        inherited: { problem: S1, state: 'accepted_provisional' },
      });
    expect(await shown(S2, 'first')).toEqual({
      state: 'inherited',
      inherited: { problem: T, state: 'accepted_provisional' },
    });
    expect(await shown(S1, 'first')).toEqual({ state: 'accepted_provisional', inherited: null });
  });
});
