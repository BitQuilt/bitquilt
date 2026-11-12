import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, PANEL, commitHash, hashCanonical, newNonce } from '@bitquilt/core';
import { VERDICT_QUOTE, addr, boot, envelope, key } from './helpers.js';

/**
 * A held challenge on a set of runs, through a booted tracker, read by reading 2 (docs/v2/READING.md section 7): "A
 * strike is one strike: each root docked once, the set's events struck on the line's record, and every lock behind
 * the set forfeited." A challenge's `struck` holds, "for a set of runs the patch's, its commit's and then each
 * run's". Who is docked is who was credited (docs/v2/READING.md section 6): "A `check` or a `score` set credits its
 * patch and not its runs." So the root that revealed the patch loses its point for the set and one more, and a root
 * that ran it loses nothing. The challenge window is QX-1's (docs/ext/QX-1.md).
 * The ledger this file leaves is the fixture of reading 2 with a set of runs struck: a check piece whose patch, its
 * commit and both runs a held challenge struck, with a run that failed left at the struck patch's digest, and a score
 * piece beside it whose set stands.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  F = key(6);
const judges = [key(11), key(12), key(13), key(14)];
const secretOf = new Map<Address, Uint8Array>(judges.map((k) => [addr(k), k]));
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
/** Where the judges' own work stands: the pool is the roots with an accepted return on another problem. */
const elsewhere = {
  'statement/*': {
    count: 2,
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Statement {n}: does the paper say so?',
    schema: VERDICT_QUOTE,
    agree: ['verdict'],
  },
};

const t = boot('2026-11-11T15:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

async function publish(e: Envelope): Promise<Hash> {
  const r = await post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
type Piece = { name: string; hash: Hash; state: string; challenge: Hash | null };
const piecesOf = async (problem: Hash) => (await get<{ pieces: Piece[] }>(`/p/${problem}/state`)).pieces;
const pieceOf = async (problem: Hash, name: string) => (await piecesOf(problem)).find((p) => p.name === name)!;
const standingOf = async (k: Uint8Array) =>
  (await get<{ root: Address; standing: number }>(`/k/${addr(k)}/standing`)).standing;
type Challenge = { id: Hash; outcome: string; seats: { root: Address }[]; struck: Hash[] };
const challengesOf = async (problem: Hash) =>
  (await get<{ challenges: Challenge[] }>(`/p/${problem}/challenges`)).challenges;

describe('a held challenge on a set of runs, read by reading 2 (READING.md sections 6 and 7)', () => {
  let P: Hash, lint: Hash, bench: Hash;
  const events = () => `/p/${P}/events`;
  /** A patch revealed on a piece by its author: the reveal's id, its commit's, and the digest a run of it names. */
  async function patched(k: Uint8Array, piece: Hash, patch: string) {
    const ret = { patch };
    const nonce = newNonce();
    const commit = await accepted(events(), ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
    const reveal = await accepted(
      events(),
      ev(k, 'reveal', { return: ret, nonce, by: by('anthropic/claude') }, P, piece),
    );
    return { commit, reveal, digest: hashCanonical(ret) };
  }
  const run = (k: Uint8Array, piece: Hash, body: Record<string, unknown>) =>
    accepted(events(), ev(k, 'run', { host: 'linux/x64', by: by('openai/gpt'), ...body }, P, piece));
  const challenge = (k: Uint8Array, piece: Hash) =>
    ev(k, 'challenge', { stake: 1, ground: 'The lint fails on a clean checkout.' }, P, piece);
  let patch: { commit: Hash; reveal: Hash; digest: Hash };
  let ran: Hash[];

  it('makes a set of runs on each piece, and gives the judges work on another problem', async () => {
    P = await publish(envelope(owner, 'runs-challenged', pieces));
    lint = (await pieceOf(P, 'lint')).hash;
    bench = (await pieceOf(P, 'bench')).hash;
    patch = await patched(A, lint, 'a change to the lint');
    // A run that failed is on the record at the patch's digest and is no part of the set.
    await run(F, lint, { digest: patch.digest, exit: 1 });
    ran = [
      await run(C, lint, { digest: patch.digest, exit: 0 }),
      await run(D, lint, { digest: patch.digest, exit: 0 }),
    ];
    const scored = await patched(B, bench, 'a change to the bench');
    await run(C, bench, { digest: scored.digest, exit: 0, score: 10 });
    await run(D, bench, { digest: scored.digest, exit: 0, score: 10.4 });
    expect((await piecesOf(P)).map((p) => p.state)).toEqual(['accepted_provisional', 'accepted_provisional']);
    // One point every root starts at, and one for the patch of a set: a root that ran it has its one alone.
    expect(await standingOf(A)).toBe(2);
    expect(await standingOf(B)).toBe(2);
    for (const k of [C, D, F]) expect(await standingOf(k)).toBe(1);

    const Q = await publish(envelope(owner, 'elsewhere', elsewhere));
    const [q1, q2] = (await piecesOf(Q)).map((p) => p.hash) as [Hash, Hash];
    const models = ['anthropic/claude', 'openai/gpt', 'google/gemini', 'meta/llama'];
    for (const [i, k] of judges.entries()) {
      const ret = { verdict: 'supports', quote: `as ${addr(k).slice(0, 6)} read it` };
      const nonce = newNonce();
      const piece = i < 2 ? q1 : q2;
      await accepted(`/p/${Q}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, Q, piece));
      await accepted(`/p/${Q}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(models[i]!) }, Q, piece));
    }
  });

  it('takes no challenge from a root that ran the patch, and seats a panel on one from a root apart', async () => {
    expect(await refused(events(), challenge(C, lint))).toBe('a party to the acceptance cannot challenge it');
    expect(await refused(events(), challenge(A, lint))).toBe('a party to the acceptance cannot challenge it');
    const id = await accepted(events(), challenge(E, lint));
    const view = await pieceOf(P, 'lint');
    expect(view.state).toBe('challenged');
    expect(view.challenge).toBe(id);
    const [c] = await challengesOf(P);
    expect(c!.outcome).toBe('open');
    expect(c!.seats).toHaveLength(PANEL);
  });

  it('strikes the patch, its commit and both runs where two seats hold the challenge', async () => {
    const [open] = await challengesOf(P);
    for (const seat of open!.seats.slice(0, 2))
      await accepted(
        events(),
        ev(secretOf.get(seat.root)!, 'verdict', { challenge: open!.id, for: 'challenger' }, P, lint),
      );
    const [held] = await challengesOf(P);
    expect(held!.outcome).toBe('held');
    // "For a set of runs the patch's, its commit's and then each run's."
    expect(held!.struck).toEqual([patch.reveal, patch.commit, ...ran]);
    // The piece has no patch on its record that counts, so it needs one again; the set beside it stands.
    const after = await piecesOf(P);
    expect(after.map((p) => p.state)).toEqual(['open', 'accepted_provisional']);
    expect(await refused(events(), challenge(E, lint))).toBe('this piece has had its challenge');
  });

  it("docks the patch's root its point for the set and one more, and no root that ran it", async () => {
    // A started at 1 and had 1 for the patch: both are gone. B's patch on the piece beside it keeps its point.
    expect(await standingOf(A)).toBe(0);
    expect(await standingOf(B)).toBe(2);
    for (const k of [C, D, F]) expect(await standingOf(k)).toBe(1);
    // The stake comes back to the challenger with one more (QX-1 section 6).
    expect(await standingOf(E)).toBe(2);
  });
});
