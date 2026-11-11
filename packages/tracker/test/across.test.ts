import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, commitHash, newNonce } from '@bitquilt/core';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * A challenge across a line: docs/v2/READING.md section 7, the fifth departure of its section 12, with
 * docs/ext/QX-1.md section 2 and docs/ext/QX-16.md section 4. "Since a piece has one record on its line, a challenge
 * open on a piece shows at every version that holds the piece, and a gold miss is challenged at any of them." So a
 * piece says `challenged` at each version of its line while a challenge on it is open at one, and names that one
 * challenge at each; the challenge is listed, and its verdicts are taken, at the version it was posted to. A miss is
 * challenged at a version other than the gold's, by a root of the struck set, inside the window of the version the
 * gold's reveal names; held there, the set stands again at every version and the gold is forfeited where it was
 * made, and failed there, the owner's stake is released at the decision. This file leaves one ledger that shows each.
 */
const owner = key(9),
  elsewhere = key(8),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  F = key(6),
  G = key(7),
  H = key(10),
  K = key(15),
  L = key(16);
/** Roots with accepted work on a problem of another line, who seat a panel (QX-1 section 3). */
const judges = [key(11), key(12), key(13), key(14)];
const secretOf = new Map<Address, Uint8Array>(judges.map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const PIECES = {
  one: { ...agree, brief: 'Is the first claim in the paper?' },
  two: { ...agree, brief: 'Is the second claim in the paper?' },
  three: { ...agree, brief: 'Is the third claim in the paper?' },
  four: { ...agree, brief: 'Is the fourth claim in the paper?' },
};
/** A version of one problem: the same pieces, so each keeps its hash, under a title of its own. */
const version = (n: string, prev?: Hash): Envelope =>
  envelope(owner, 'paper', PIECES, { title: `Version ${n} of what one paper says`, ...(prev ? { prev } : {}) });
/** A problem of another owner and another line, whose squares seat a panel. */
const ELSEWHERE = envelope(elsewhere, 'elsewhere', {
  'claim/*': { ...agree, count: 2, brief: 'Claim {n}: is it so?' },
});
const GROUND = 'The sentence quoted is not in the paper.';
const AGAINST_GOLD = 'The paper says the opposite of the gold.';

// The owner's founding standing covers the two golds.
const t = boot('2026-11-11T12:00:00.000Z', {
  limits: { keyPerHour: 1000, ipPerHour: 10000 },
  founding: { [addr(owner)]: 10 },
});
beforeAll(() => t.listen());
afterAll(() => t.close());

const layer = () => t.tracker.layer();
const shown = (problem: Hash, name: string) =>
  layer()
    .problems.get(problem)!
    .pieces.find((p) => p.name === name)!;
const stateOf = (problem: Hash, name: string): string => shown(problem, name).state;
const standing = (k: Uint8Array) => layer().standing(addr(k));
async function publish(e: Envelope): Promise<Hash> {
  const r = await t.post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
/** Two roots of different vendors agree on a piece, each reading posted to the version named. */
async function squared(problem: Hash, name: string, pair: Uint8Array[], verdict = 'supports') {
  const piece = shown(problem, name).hash;
  const ret = { verdict };
  for (const [i, k] of pair.entries()) {
    const nonce = newNonce();
    const model = i === 0 ? 'anthropic/claude' : 'openai/gpt';
    await t.accepted(`/p/${problem}/events`, t.ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
    await t.accepted(`/p/${problem}/events`, t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
  }
}
const challenge = (k: Uint8Array, problem: Hash, name: string, stake = 1, ground = GROUND) =>
  t.ev(k, 'challenge', { stake, ground }, problem, shown(problem, name).hash);
const challengeOf = (problem: Hash, id: Hash) =>
  layer()
    .problems.get(problem)!
    .challenges.find((c) => c.id === id)!;
/** QX-1 section 6: two verdicts for one side decide a challenge. The first two seats drawn give them. */
async function decided(problem: Hash, name: string, id: Hash, side: 'challenger' | 'author'): Promise<void> {
  const piece = shown(problem, name).hash;
  for (const seat of challengeOf(problem, id).seats.slice(0, 2))
    await t.accepted(
      `/p/${problem}/events`,
      t.ev(secretOf.get(seat.root)!, 'verdict', { challenge: id, for: side }, problem, piece),
    );
  expect(challengeOf(problem, id).outcome).toBe(side === 'challenger' ? 'held' : 'failed');
}
type StatePiece = { name: string; state: string; challenge: Hash | null; challenge_at: Hash | null };
const answered = async (problem: Hash, name: string) =>
  (await t.get<{ pieces: StatePiece[] }>(`/p/${problem}/state`)).pieces.find((p) => p.name === name)!;
const listed = async (problem: Hash) =>
  (await t.get<{ challenges: { id: Hash }[] }>(`/p/${problem}/challenges`)).challenges.map((c) => c.id);

describe('a challenge across a line (READING.md section 7)', () => {
  let V1: Hash, V2: Hash, SIDE: Hash;
  const golds = new Map<string, { projection: { verdict: string }; nonce: string }>();
  /** A gold of one commitment at the first version, kept before the piece is worked (QX-16 section 1). */
  async function gold(name: string): Promise<void> {
    const made = { projection: { verdict: 'supports' }, nonce: newNonce() };
    golds.set(name, made);
    const commitment = commitHash({ piece: shown(V1, name).hash, projection: made.projection }, made.nonce);
    await t.accepted(`/p/${V1}/events`, t.ev(owner, 'gold', { commitments: [commitment], stake: 2 }, V1));
  }
  const revealed = (name: string) =>
    t.accepted(`/p/${V1}/events`, t.ev(owner, 'gold_reveal', golds.get(name)!, V1, shown(V1, name).hash));

  beforeAll(async () => {
    const q = await publish(ELSEWHERE);
    await squared(q, 'claim/1', [judges[0]!, judges[1]!]);
    await squared(q, 'claim/2', [judges[2]!, judges[3]!]);
    V1 = await publish(version('1'));
    V2 = await publish(version('2', V1));
    SIDE = await publish(version('2 again', V1));
    await gold('three');
    await gold('four');
  });

  it('shows a challenge open at one version at every version that holds the piece', async () => {
    await squared(V1, 'one', [A, B]);
    const id = await t.accepted(`/p/${V2}/events`, challenge(C, V2, 'one'));
    for (const v of [V1, V2, SIDE]) {
      expect(stateOf(v, 'one')).toBe('challenged');
      // Each version names the one challenge and the version it was posted to.
      expect(await answered(v, 'one')).toMatchObject({ state: 'challenged', challenge: id, challenge_at: V2 });
    }
    // The challenge is listed where it was posted, and a verdict on it is taken there alone (QX-1 section 4).
    expect(await listed(V2)).toEqual([id]);
    expect(await listed(V1)).toEqual([]);
    const seat = challengeOf(V2, id).seats[0]!;
    const verdict = (v: Hash) =>
      t.ev(secretOf.get(seat.root)!, 'verdict', { challenge: id, for: 'challenger' }, v, shown(v, 'one').hash);
    expect(await t.refused(`/p/${V1}/events`, verdict(V1))).toBe('names no open challenge on this piece');
    await decided(V2, 'one', id, 'challenger');
    // Held: the set is struck from the fold of every version, and each still names the challenge the piece had.
    for (const v of [V1, V2, SIDE]) {
      expect(stateOf(v, 'one')).toBe('open');
      expect(await answered(v, 'one')).toMatchObject({ challenge: id, challenge_at: V2 });
    }
  });

  it('shows it between two versions made from the same one, and the set again once it fails', async () => {
    await squared(V2, 'two', [D, E]);
    const id = await t.accepted(`/p/${SIDE}/events`, challenge(F, SIDE, 'two'));
    for (const v of [V1, V2, SIDE]) expect(stateOf(v, 'two')).toBe('challenged');
    await decided(SIDE, 'two', id, 'author');
    for (const v of [V1, V2, SIDE]) expect(stateOf(v, 'two')).toBe('accepted_provisional');
    expect(standing(F)).toBe(0);
  });

  it('takes the challenge on a miss at a version other than the gold, and undoes the miss at each', async () => {
    await squared(SIDE, 'three', [G, H], 'contradicts');
    await revealed('three');
    for (const v of [V1, V2, SIDE]) expect(stateOf(v, 'three')).toBe('open');
    expect(standing(G)).toBe(0);
    // QX-16 section 4: "only a root of the struck set challenges a miss", at any version that holds the piece.
    expect(await t.refused(`/p/${V2}/events`, challenge(C, V2, 'three', 0, AGAINST_GOLD))).toBe(
      'only a root of the struck set challenges a miss',
    );
    const id = await t.accepted(`/p/${V2}/events`, challenge(G, V2, 'three', 0, AGAINST_GOLD));
    expect(challengeOf(V2, id).against).toBe('gold');
    for (const v of [V1, V2, SIDE]) expect(stateOf(v, 'three')).toBe('challenged');
    await decided(V2, 'three', id, 'challenger');
    // The gold was wrong: the set stands again at every version, and each root has its points back.
    for (const v of [V1, V2, SIDE]) {
      expect(stateOf(v, 'three')).toBe('accepted_provisional');
    }
    // A gold is shown at the version it was made at, and so is what became of it.
    expect(shown(V1, 'three').gold).toBe('overruled');
    expect(standing(G)).toBe(2);
    expect(standing(H)).toBe(2);
    // The owner's stake is forfeited whole where the gold was made: 1, the founding 10, less 2.
    expect(standing(owner)).toBe(9);
  });

  it('holds the stake of a gold whose miss is challenged at another version until the decision', async () => {
    await squared(V2, 'four', [K, L], 'contradicts');
    await revealed('four');
    const id = await t.accepted(`/p/${SIDE}/events`, challenge(K, SIDE, 'four', 0, AGAINST_GOLD));
    // QX-16 section 5: the stake is locked while the challenge on the miss is open.
    expect(layer().locked(addr(owner))).toBe(2);
    await decided(SIDE, 'four', id, 'author');
    // The miss stands, final at the decision and not at the window's end, so the owner's stake is free again.
    for (const v of [V1, V2, SIDE]) expect(stateOf(v, 'four')).toBe('open');
    expect(layer().locked(addr(owner))).toBe(0);
    expect(standing(owner)).toBe(9);
  });
});
