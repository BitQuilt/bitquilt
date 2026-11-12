import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, commitHash, hashCanonical, newNonce } from '@bitquilt/core';
import { addr, boot, envelope, key } from './helpers.js';

/**
 * A run through a booted tracker, read by reading 2 (docs/v2/READING.md section 6): "A `check` or a `score` set
 * credits its patch and not its runs." Standing is QX-1's (docs/ext/QX-1.md section 2): "a new root starts at 1", and
 * "plus 1 for every reveal of the root in an accepting set". The rule of the set is version 1's
 * (docs/CORE.md section 6): for check, a revealed patch and "two run events with exit 0 at that patch's digest",
 * "from roots unrelated to each other and to the root that revealed the patch"; for score, "two run events whose
 * score values are within the check's tolerance of each other". Version 1's fixtures 14 to 17 hold the rule, and no
 * tracker's test posted a run before this one.
 * The ledger this file leaves is the fixture of reading 2 with a run in it: a check piece and a score piece, each
 * with a patch and its runs, a run that failed, a run by the patch's author, a score outside the tolerance, and the
 * standing a set of runs gives.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const, 'shell' as const] });
const workspace = { repo: 'https://example.org/r', base: 'abc' };
const pieces = {
  lint: {
    verifier: 'check',
    requires: ['shell' as const],
    brief: 'Run the lint.',
    workspace,
    check: { file: 'lint.sh' },
  },
  bench: {
    verifier: 'score',
    requires: ['shell' as const],
    brief: 'Run the bench.',
    workspace,
    check: { file: 'bench.sh', tolerance: 0.5, better: 'lower' as const },
  },
};

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
type State = { pieces: { name: string; hash: Hash; state: string }[]; complete: boolean };
const stateOf = (problem: Hash) => get<State>(`/p/${problem}/state`);
const pieceOf = async (problem: Hash, name: string) => (await stateOf(problem)).pieces.find((p) => p.name === name)!;
const standingOf = async (k: Uint8Array) =>
  (await get<{ root: Address; standing: number }>(`/k/${addr(k)}/standing`)).standing;

describe('a run through the door, read by reading 2 (READING.md section 6)', () => {
  let P: Hash, lint: Hash, bench: Hash;
  const events = () => `/p/${P}/events`;
  /** A patch revealed on a piece by its author, and the digest a run of it names. */
  async function patched(k: Uint8Array, piece: Hash, patch: string): Promise<Hash> {
    const ret = { patch };
    const nonce = newNonce();
    await accepted(events(), ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
    await accepted(events(), ev(k, 'reveal', { return: ret, nonce, by: by('anthropic/claude') }, P, piece));
    return hashCanonical(ret);
  }
  const run = (k: Uint8Array, piece: Hash, body: Record<string, unknown>, model = 'openai/gpt') =>
    accepted(events(), ev(k, 'run', { host: 'linux/x64', by: by(model), ...body }, P, piece));

  it('accepts a check piece on two runs with exit 0 from roots unrelated to each other and to the author', async () => {
    P = await publish(envelope(owner, 'runs', pieces));
    lint = (await pieceOf(P, 'lint')).hash;
    bench = (await pieceOf(P, 'bench')).hash;
    const digest = await patched(A, lint, 'a change to the lint');
    // The author's own run is taken at the door and counts for nothing, and a run that failed makes no pair.
    await run(A, lint, { digest, exit: 0 });
    await run(B, lint, { digest, exit: 1 });
    await run(C, lint, { digest, exit: 0 });
    expect((await pieceOf(P, 'lint')).state).not.toBe('accepted_provisional');
    await run(D, lint, { digest, exit: 0 });
    expect((await pieceOf(P, 'lint')).state).toBe('accepted_provisional');
  });

  it('accepts a score piece on the first two runs whose scores are within the tolerance', async () => {
    const digest = await patched(A, bench, 'a change to the bench');
    await run(B, bench, { digest, exit: 0, score: 10 });
    // A score of 11 is further than 0.5 from 10, so the two make no set.
    await run(C, bench, { digest, exit: 0, score: 11 });
    expect((await pieceOf(P, 'bench')).state).not.toBe('accepted_provisional');
    await run(D, bench, { digest, exit: 0, score: 10.4 });
    expect((await pieceOf(P, 'bench')).state).toBe('accepted_provisional');
  });

  it('credits the patch of each set and not its runs, once the window closes', async () => {
    t.clock.tick += 49 * HOUR;
    const state = await stateOf(P);
    expect(state.pieces.map((p) => p.state)).toEqual(['accepted', 'accepted']);
    expect(state.complete).toBe(true);
    // The one point every root starts at, and one for each patch: the roots that ran them have their one alone.
    expect(await standingOf(A)).toBe(3);
    for (const k of [B, C, D]) expect(await standingOf(k)).toBe(1);
  });
});
