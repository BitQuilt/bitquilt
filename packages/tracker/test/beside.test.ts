import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, PANEL, commitHash, eventId, hashCanonical, newNonce } from '@bitquilt/core';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * What stands beside a set of runs, through a booted tracker, read by reading 2: a lock, a pool and a gold.
 * docs/v2/READING.md section 6: "A `check` or a `score` set credits its patch and not its runs." So the root that
 * revealed the patch is credited where the set stands and a root that ran it is not, and a pool, which is the roots
 * credited on another problem, seats the first and never the second. docs/ext/QX-15.md section 2 asks a lock of each
 * root that writes on a staked piece, a run among its events, and a lock behind a set is released when its window
 * closes. docs/ext/QX-16.md section 1 keeps gold to a piece "whose return has agreed fields", which a `check` piece
 * has none of, so a commitment that names one is kept blind, its reveal is taken for nothing and it lapses.
 * The ledger this file leaves holds:
 * - a staked check piece with a lock behind its patch and behind each run, live while the window is open;
 * - a challenge on another problem whose pool is the patch's root and two roots with a set of reveals, with neither
 *   root that ran the patch in it;
 * - the owner's gold with one commitment, on the check piece, and its reveal, written into the store past the door,
 *   which refuses it, dropped and counted on the problem.
 */
const owner = key(9),
  other = key(10),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  F = key(6),
  J1 = key(11),
  J2 = key(12);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const, 'shell' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const RUNS = envelope(owner, 'runs-beside', {
  lint: {
    verifier: 'check',
    requires: ['shell' as const],
    brief: 'Run the lint.',
    workspace: { repo: 'https://example.org/r', base: 'abc' },
    check: { file: 'lint.sh' },
  },
  noted: { ...agree, brief: 'Is the first claim in the paper?' },
});
const CLAIMS = envelope(other, 'claims-beside', {
  first: { ...agree, brief: 'Is the second claim in the paper?' },
  second: { ...agree, brief: 'Is the third claim in the paper?' },
});

const t = boot('2026-11-11T22:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Gold = { committed: number; pending: number; verified: number; missed: number; overruled: number; lapsed: number };
type Piece = { name: string; hash: Hash; state: string; gold: string | null };
type State = { pieces: Piece[]; gold: Gold; dropped: { id: Hash; type: string; why: string }[] };
const standingOf = (k: Uint8Array) =>
  get<{ standing: number; locked: number; free: number; locks: { piece: Hash; amount: number }[] }>(
    `/k/${addr(k)}/standing`,
  );

describe('beside a set of runs: a lock, a pool and a gold (READING.md sections 6 and 7)', () => {
  let R: Hash, S: Hash, lint: Hash;
  const hashOf = new Map<string, Hash>();
  const eventsOf = (p: Hash) => `/p/${p}/events`;
  const stateOf = (p: Hash) => get<State>(`/p/${p}/state`);
  /** A commit and its reveal on a piece of a problem; the digest of the return. */
  async function reads(p: Hash, name: string, k: Uint8Array, model: string, ret: Record<string, unknown>) {
    const piece = hashOf.get(name)!;
    const nonce = newNonce();
    await accepted(eventsOf(p), ev(k, 'commit', { h: commitHash(ret, nonce) }, p, piece));
    await accepted(eventsOf(p), ev(k, 'reveal', { return: ret, nonce, by: by(model) }, p, piece));
    return hashCanonical(ret);
  }
  const locks = (k: Uint8Array) => accepted(eventsOf(R), ev(k, 'lock', { kind: 'standing', amount: 1 }, R, lint));
  const projection = { patch: 'a change to the lint' };
  const nonce = newNonce();

  beforeAll(async () => {
    for (const e of [RUNS, CLAIMS]) {
      const r = await post('/p', { envelope: e });
      expect(r.status, await r.clone().text()).toBe(201);
      const hash = ((await r.json()) as { hash: Hash }).hash;
      if (e === RUNS) R = hash;
      else S = hash;
      for (const p of (await stateOf(hash)).pieces) hashOf.set(p.name, p.hash);
    }
    lint = hashOf.get('lint')!;
  });

  it('keeps a gold commitment that names a check piece, blind, against standing the owner earned elsewhere', async () => {
    await accepted(eventsOf(R), ev(owner, 'stake_rule', { min: 1, pieces: ['lint'] }, R));
    await reads(S, 'second', owner, 'anthropic/claude', { verdict: 'supports' });
    await reads(S, 'second', E, 'openai/gpt', { verdict: 'supports' });
    // A commitment costs the largest share among the pieces a gold can be on: two, for the agree piece.
    const commitment = commitHash({ piece: lint, projection }, nonce);
    await accepted(eventsOf(R), ev(owner, 'gold', { commitments: [commitment], stake: 2 }, R));
    expect(await standingOf(owner)).toMatchObject({ standing: 2, locked: 2, free: 0 });
    expect((await stateOf(R)).gold).toMatchObject({ committed: 1, pending: 1 });
  });

  it('asks a lock of the patch’s root and of each root that runs it, and credits the patch alone', async () => {
    const run = (k: Uint8Array, digest: Hash) =>
      ev(k, 'run', { host: 'linux/x64', by: by('openai/gpt'), digest, exit: 0 }, R, lint);
    await locks(A);
    const digest = await reads(R, 'lint', A, 'anthropic/claude', projection);
    expect(await refused(eventsOf(R), run(C, digest))).toBe('this piece asks for a stake of 1; lock first');
    for (const k of [C, D]) {
      await locks(k);
      await accepted(eventsOf(R), run(k, digest));
    }
    expect((await stateOf(R)).pieces.find((p) => p.name === 'lint')!.state).toBe('accepted_provisional');
    expect(await standingOf(A)).toMatchObject({ standing: 2, locked: 1, free: 1, locks: [{ piece: lint, amount: 1 }] });
    for (const k of [C, D])
      expect(await standingOf(k)).toMatchObject({
        standing: 1,
        locked: 1,
        free: 0,
        locks: [{ piece: lint, amount: 1 }],
      });
  });

  it('takes a gold reveal on the check piece for nothing, and counts it on the problem', async () => {
    const reveal = ev(owner, 'gold_reveal', { projection, nonce }, R, lint);
    expect(await refused(eventsOf(R), reveal)).toBe('gold applies to a piece whose return has agreed fields');
    t.store.appendReceipt(R, reveal, eventId(reveal), 'http://tracker.test/', reveal.ts, 'self');
    const s = await stateOf(R);
    expect(s.dropped).toEqual([
      { id: eventId(reveal), type: 'gold_reveal', why: 'gold applies to a piece whose return has agreed fields' },
    ]);
    expect(s.pieces.find((p) => p.name === 'lint')).toMatchObject({ state: 'accepted_provisional', gold: null });
    expect(s.gold).toMatchObject({ committed: 1, pending: 1, verified: 0, missed: 0 });
  });

  it('seats the patch’s root in a pool on another problem, and neither root that ran it', async () => {
    await reads(R, 'noted', J1, 'google/gemini', { verdict: 'supports' });
    await reads(R, 'noted', J2, 'meta/llama', { verdict: 'supports' });
    await reads(S, 'first', B, 'anthropic/claude', { verdict: 'supports' });
    await reads(S, 'first', F, 'openai/gpt', { verdict: 'supports' });
    const ground = { stake: 1, ground: 'The paper says the opposite.' };
    await accepted(eventsOf(S), ev(E, 'challenge', ground, S, hashOf.get('first')!));
    const { challenges } = await get<{ challenges: { seats: { root: Address }[] }[] }>(`/p/${S}/challenges`);
    const pool = [A, J1, J2].map(addr).sort();
    expect(challenges[0]!.seats.map((s) => s.root).sort()).toEqual(pool);
    expect(pool).toHaveLength(PANEL);
  });
});
