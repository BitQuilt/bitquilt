import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, commitHash, newNonce } from '@bitquilt/core';
import { linesFromLayer } from '../src/coin.js';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * A set carried across a version is one set: QX-1 sections 2, 3, 6 and 7 as amended 10 November 2026, with
 * QX-15 section 3 and QX-16 section 4. The core's fold of a version takes the events of the versions before it along
 * `prev`, so a set made at v1 on a piece v2 keeps stands in the fold of each, and a tracker that holds both counts it
 * once. A reveal earns its root one point, however many versions hold its set, and a reveal posted to v2 beside one
 * posted to v1 earns each its point. A version of a problem is not a problem other than it, so a tracker that holds
 * one problem in several versions has no pool, and two versions made from the same earlier one are of one line. A held
 * challenge at any version docks each root once and withdraws its point once, and forfeits a lock behind the set
 * whichever version the lock was made at; a gold miss struck and then overruled gives each root back the one point.
 * One challenge is open at a time across the line, and a piece that had its held challenge at one version is not
 * challenged at another. The coin, last: one gold at v1 verifies the carried square once, and an escrow at v1 pays the
 * set once; and what the reference does today with a gold at each version on the same piece, and with an escrow at
 * each version.
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
  treasury = key(30);
/** Roots with accepted work on a problem of another line, who seat a panel there (QX-1 section 3). */
const judges = [key(11), key(12), key(13), key(14)];
/** Roots with accepted work on the chain's own versions alone. */
const workers = [key(15), key(16), key(17), key(18)];
const everyone = [owner, elsewhere, A, B, C, D, E, F, G, H, ...judges, ...workers];
const secretOf = new Map<Address, Uint8Array>(everyone.map((k) => [addr(k), k]));
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

const T0 = '2026-11-10T12:00:00.000Z';
const HOUR = 3_600_000;
const GROUND = 'The sentence quoted is not in the paper.';

/** A tracker of its own for one case, listening for the case's posts, with what the case says to it. */
function scene(options: Parameters<typeof boot>[1] = {}, start = T0) {
  const t = boot(start, { limits: { keyPerHour: 1000, ipPerHour: 10000 }, ...options });
  beforeAll(() => t.listen());
  afterAll(() => t.close());
  const layer = () => t.tracker.layer();
  const nowIso = () => new Date(t.clock.tick).toISOString();
  async function publish(e: Envelope): Promise<Hash> {
    const r = await t.post('/p', { envelope: e });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { hash: Hash }).hash;
  }
  /** A piece's hash on a problem, by its name. */
  const hashOf = (problem: Hash, name: string): Hash =>
    layer()
      .problems.get(problem)!
      .pieces.find((p) => p.name === name)!.hash;
  /** A piece's state in the layer, by its name. */
  const stateOf = (problem: Hash, name: string): string =>
    layer()
      .problems.get(problem)!
      .pieces.find((p) => p.name === name)!.state;
  /** A commit and its reveal on a piece, posted to the problem named. */
  async function returned(problem: Hash, name: string, k: Uint8Array, model: string, verdict = 'supports') {
    const piece = hashOf(problem, name);
    const ret = { verdict };
    const nonce = newNonce();
    await t.accepted(`/p/${problem}/events`, t.ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
    await t.accepted(`/p/${problem}/events`, t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
  }
  /** Two roots of different vendors agree on a piece: a square, provisional while its window is open. */
  async function squared(problem: Hash, name: string, pair: Uint8Array[], verdict = 'supports') {
    await returned(problem, name, pair[0]!, 'anthropic/claude', verdict);
    await returned(problem, name, pair[1]!, 'openai/gpt', verdict);
  }
  /** The problem of another line, its two squares made by the four judges. */
  async function judged(): Promise<Hash> {
    const q = await publish(ELSEWHERE);
    await squared(q, 'claim/1', [judges[0]!, judges[1]!]);
    await squared(q, 'claim/2', [judges[2]!, judges[3]!]);
    return q;
  }
  const challenge = (k: Uint8Array, problem: Hash, name: string, stake = 1, ground = GROUND) =>
    t.ev(k, 'challenge', { stake, ground }, problem, hashOf(problem, name));
  const challengeOf = (problem: Hash, id: Hash) =>
    layer()
      .problems.get(problem)!
      .challenges.find((c) => c.id === id)!;
  /** QX-1 section 6: "Held: two verdicts `for: challenger`." The first two seats the challenge drew give them. */
  async function held(problem: Hash, name: string, id: Hash): Promise<void> {
    const piece = hashOf(problem, name);
    for (const seat of challengeOf(problem, id).seats.slice(0, 2))
      await t.accepted(
        `/p/${problem}/events`,
        t.ev(secretOf.get(seat.root)!, 'verdict', { challenge: id, for: 'challenger' }, problem, piece),
      );
    expect(challengeOf(problem, id).outcome).toBe('held');
  }
  const standing = (k: Uint8Array, at?: string) => layer().standing(addr(k), at);
  return {
    t,
    layer,
    nowIso,
    publish,
    hashOf,
    stateOf,
    returned,
    squared,
    judged,
    challenge,
    challengeOf,
    held,
    standing,
  };
}

/** The door's refusal where no panel can be seated: no root with accepted work on a problem of another line. */
const NO_PANEL = 'no panel can be seated: 0 roots with an accepted return on another problem, 3 needed';

describe('a reveal is counted once (QX-1 section 2 as amended 10 November 2026)', () => {
  const s = scene();
  let v1: Hash, v2: Hash;
  it('gives each root of a set made at v1, on a piece v2 keeps, one point with both versions held', async () => {
    v1 = await s.publish(version('1'));
    v2 = await s.publish(version('2', v1));
    await s.squared(v1, 'one', [A, B]);
    // The set stands in the fold of each version.
    expect(s.stateOf(v1, 'one')).toBe('accepted_provisional');
    expect(s.stateOf(v2, 'one')).toBe('accepted_provisional');
    // "plus 1 for every reveal of the root in an accepting set": one reveal each, so the 1 a root starts with and one.
    expect(s.standing(A)).toBe(2);
    expect(s.standing(B)).toBe(2);
  });
  it('and one point with three versions held', async () => {
    const v3 = await s.publish(version('3', v2));
    expect(s.stateOf(v3, 'one')).toBe('accepted_provisional');
    expect(s.standing(A)).toBe(2);
    expect(s.standing(B)).toBe(2);
  });
});

describe('a reveal posted to v2 beside one posted to v1 (QX-1 section 2 as amended 10 November 2026)', () => {
  const s = scene();
  let v2: Hash;
  it('gives each root one point, where the set stands in the fold of v2 alone', async () => {
    const v1 = await s.publish(version('1'));
    v2 = await s.publish(version('2', v1));
    await s.returned(v1, 'one', A, 'anthropic/claude');
    await s.returned(v2, 'one', B, 'openai/gpt');
    // v1's fold leaves out the reveal that names v2, so only v2 holds the pair.
    expect(s.stateOf(v1, 'one')).toBe('needs_verify');
    expect(s.stateOf(v2, 'one')).toBe('accepted_provisional');
    expect(s.standing(A)).toBe(2);
    expect(s.standing(B)).toBe(2);
  });
  it('and one point each with a third version that carries the set', async () => {
    const v3 = await s.publish(version('3', v2));
    expect(s.stateOf(v3, 'one')).toBe('accepted_provisional');
    expect(s.standing(A)).toBe(2);
    expect(s.standing(B)).toBe(2);
  });
});

describe('a held challenge at v2 on a set made at v1 (QX-1 section 6 as amended 10 November 2026)', () => {
  const s = scene();
  it('docks each root once and withdraws its point once, and the set is gone from the fold of each version', async () => {
    await s.judged();
    const v1 = await s.publish(version('1'));
    const v2 = await s.publish(version('2', v1));
    await s.squared(v1, 'one', [A, B]);
    const completed = s.nowIso();
    const id = await s.t.accepted(`/p/${v2}/events`, s.challenge(C, v2, 'one'));
    await s.held(v2, 'one', id);
    expect(s.challengeOf(v2, id).struck).toHaveLength(4);
    expect(s.stateOf(v1, 'one')).toBe('open');
    expect(s.stateOf(v2, 'one')).toBe('open');
    // "Each root of the set loses one and its point for the set, once": 1, plus the point, less both.
    for (const k of [A, B]) {
      expect(s.standing(k, completed)).toBe(2);
      expect(s.standing(k)).toBe(0);
    }
    expect(s.standing(C)).toBe(2);
  });
});

describe('a gold miss on a carried set, overruled (QX-16 section 4 and QX-1 section 2 as amended 10 November 2026)', () => {
  const s = scene({ founding: { [addr(owner)]: 10 } });
  it('gives each root back the one point it had for the set', async () => {
    await s.judged();
    const v1 = await s.publish(version('1'));
    const v2 = await s.publish(version('2', v1));
    const piece = s.hashOf(v1, 'one');
    const projection = { verdict: 'supports' };
    const nonce = newNonce();
    await s.t.accepted(
      `/p/${v1}/events`,
      s.t.ev(owner, 'gold', { commitments: [commitHash({ piece, projection }, nonce)], stake: 2 }, v1),
    );
    await s.squared(v1, 'one', [A, B], 'contradicts');
    await s.t.accepted(`/p/${v1}/events`, s.t.ev(owner, 'gold_reveal', { projection, nonce }, v1, piece));
    expect(s.stateOf(v1, 'one')).toBe('open');
    expect(s.stateOf(v2, 'one')).toBe('open');
    // The miss: one docked and the set's point withdrawn.
    expect(s.standing(A)).toBe(0);
    expect(s.standing(B)).toBe(0);
    const id = await s.t.accepted(
      `/p/${v1}/events`,
      s.challenge(A, v1, 'one', 0, 'The paper says the opposite of the gold.'),
    );
    await s.held(v1, 'one', id);
    expect(s.stateOf(v1, 'one')).toBe('accepted_provisional');
    expect(s.stateOf(v2, 'one')).toBe('accepted_provisional');
    // "the point docked and the set's point" come back, once: each root ends where the set left it, at 2.
    expect(s.standing(A)).toBe(2);
    expect(s.standing(B)).toBe(2);
  });
});

describe('a carried set struck, restored and struck again (QX-16 section 4 and QX-1 section 2 as amended 10 November 2026)', () => {
  const s = scene({ founding: { [addr(owner)]: 10 } });
  it('withdraws the point the restore gave back where a gold at v2 misses after the miss at v1 was overruled', async () => {
    await s.judged();
    const v1 = await s.publish(version('1'));
    const v2 = await s.publish(version('2', v1));
    const piece = s.hashOf(v1, 'one');
    const projection = { verdict: 'supports' };
    const nonces = [newNonce(), newNonce()];
    for (const [i, v] of [v1, v2].entries())
      await s.t.accepted(
        `/p/${v}/events`,
        s.t.ev(owner, 'gold', { commitments: [commitHash({ piece, projection }, nonces[i]!)], stake: 2 }, v),
      );
    await s.squared(v1, 'one', [A, B], 'contradicts');
    await s.t.accepted(`/p/${v1}/events`, s.t.ev(owner, 'gold_reveal', { projection, nonce: nonces[0] }, v1, piece));
    const id = await s.t.accepted(
      `/p/${v1}/events`,
      s.challenge(A, v1, 'one', 0, 'The paper says the opposite of the gold.'),
    );
    await s.held(v1, 'one', id);
    expect(s.standing(A)).toBe(2);
    // The gold at v2 is the owner's own, kept before the work, and its reveal strikes the restored set again.
    await s.t.accepted(`/p/${v2}/events`, s.t.ev(owner, 'gold_reveal', { projection, nonce: nonces[1] }, v2, piece));
    expect(s.stateOf(v1, 'one')).toBe('open');
    expect(s.stateOf(v2, 'one')).toBe('open');
    // One set struck: each root loses one and its point for the set, the point the restore gave back.
    expect(s.standing(A)).toBe(0);
    expect(s.standing(B)).toBe(0);
  });
});

describe('the pool of a problem held in several versions (QX-1 section 3 as amended 10 November 2026)', () => {
  describe('with nothing else held', () => {
    const s = scene();
    it("seats no challenge at either version, with the door's ordinary refusal", async () => {
      const v1 = await s.publish(version('1'));
      const v2 = await s.publish(version('2', v1));
      await s.squared(v1, 'one', [A, B]);
      await s.squared(v1, 'two', [workers[0]!, workers[1]!]);
      await s.squared(v2, 'three', [workers[2]!, workers[3]!]);
      // "With a single problem on a tracker the pool is empty", and a version of p is not a problem other than p.
      expect(await s.t.refused(`/p/${v2}/events`, s.challenge(C, v2, 'one'))).toBe(NO_PANEL);
      expect(await s.t.refused(`/p/${v1}/events`, s.challenge(C, v1, 'one'))).toBe(NO_PANEL);
    });
  });
  describe('with a problem of another line held', () => {
    const s = scene();
    it('seats the challenge from that problem alone, and draws no root credited only on the versions', async () => {
      await s.judged();
      const v1 = await s.publish(version('1'));
      const v2 = await s.publish(version('2', v1));
      await s.squared(v1, 'one', [A, B]);
      await s.squared(v1, 'two', [workers[0]!, workers[1]!]);
      await s.squared(v2, 'three', [workers[2]!, workers[3]!]);
      const id = await s.t.accepted(`/p/${v2}/events`, s.challenge(C, v2, 'one'));
      const c = s.challengeOf(v2, id);
      expect([...c.order].sort()).toEqual(judges.map(addr).sort());
      for (const w of workers) expect(c.order).not.toContain(addr(w));
    });
  });
});

describe('a lock behind a carried set (QX-15 section 3 and QX-1 section 6 as amended 10 November 2026)', () => {
  const s = scene({ founding: { [addr(A)]: 5, [addr(B)]: 5 } });
  it('is forfeited by a held challenge at v2 though made at v1, and moves standing by its amount once', async () => {
    await s.judged();
    const v1 = await s.publish(version('1'));
    await s.t.accepted(`/p/${v1}/events`, s.t.ev(owner, 'stake_rule', { min: 1 }, v1));
    const v2 = await s.publish(version('2', v1));
    for (const k of [A, B])
      await s.t.accepted(
        `/p/${v1}/events`,
        s.t.ev(k, 'lock', { kind: 'standing', amount: 1 }, v1, s.hashOf(v1, 'one')),
      );
    await s.squared(v1, 'one', [A, B]);
    const id = await s.t.accepted(`/p/${v2}/events`, s.challenge(C, v2, 'one'));
    await s.held(v2, 'one', id);
    const decided = s.challengeOf(v2, id).decidedAt!;
    const before = new Date(Date.parse(decided) - 1).toISOString();
    const locks = s.layer().problems.get(v1)!.locks;
    expect(locks).toHaveLength(2);
    // "Forfeited at the decision of a held challenge on an accepting set the root is in".
    for (const l of locks) expect(l.forfeitedAt).toBe(decided);
    for (const k of [A, B]) {
      // 1 and the founding 5, and the point for the set: 7, with 1 locked.
      expect(s.standing(k, before)).toBe(7);
      // Less one docked, the point withdrawn and the lock of one forfeited, each once.
      expect(s.standing(k)).toBe(4);
      expect(s.layer().locked(addr(k))).toBe(0);
    }
  });
});

describe('challenged once across the line (QX-1 sections 1 and 7 as amended 10 November 2026)', () => {
  describe('a challenge open at v1', () => {
    const s = scene();
    it('refuses a second at v2 while it sits', async () => {
      await s.judged();
      const v1 = await s.publish(version('1'));
      const v2 = await s.publish(version('2', v1));
      await s.squared(v1, 'one', [A, B]);
      await s.t.accepted(`/p/${v1}/events`, s.challenge(C, v1, 'one'));
      expect(s.stateOf(v1, 'one')).toBe('challenged');
      expect(await s.t.refused(`/p/${v2}/events`, s.challenge(D, v2, 'one'))).toBe('a challenge is open on this piece');
    });
  });
  describe('a challenge held at v1', () => {
    const s = scene();
    it('leaves an acceptance reached again at v2 unchallenged', async () => {
      await s.judged();
      const v1 = await s.publish(version('1'));
      const v2 = await s.publish(version('2', v1));
      await s.squared(v1, 'one', [A, B]);
      const id = await s.t.accepted(`/p/${v1}/events`, s.challenge(C, v1, 'one'));
      await s.held(v1, 'one', id);
      expect(s.stateOf(v2, 'one')).toBe('open');
      // The piece is worked again at v2, by roots of their own, and accepted there.
      await s.squared(v2, 'one', [D, E]);
      expect(s.stateOf(v2, 'one')).toBe('accepted_provisional');
      // The challenger won its stake, so its standing covers another.
      expect(s.standing(C)).toBe(2);
      expect(await s.t.refused(`/p/${v2}/events`, s.challenge(C, v2, 'one'))).toBe('this piece has had its challenge');
    });
  });
});

describe('versions made from the same earlier one (QX-1 sections 2 and 3 as amended 10 November 2026)', () => {
  const s = scene();
  it('give each root of a set carried to both one point, and a credit on one sibling seats no panel at the other', async () => {
    const v1 = await s.publish(version('1'));
    const left = await s.publish(version('2a', v1));
    const right = await s.publish(version('2b', v1));
    await s.squared(v1, 'one', [A, B]);
    expect(s.stateOf(left, 'one')).toBe('accepted_provisional');
    expect(s.stateOf(right, 'one')).toBe('accepted_provisional');
    expect(s.standing(A)).toBe(2);
    expect(s.standing(B)).toBe(2);
    // Squares posted to one sibling alone, which the other's fold does not hold.
    await s.squared(left, 'two', [workers[0]!, workers[1]!]);
    await s.squared(left, 'three', [workers[2]!, workers[3]!]);
    expect(s.stateOf(right, 'two')).toBe('open');
    // "another version made from the same earlier one" is of the line, so its credits are no pool.
    expect(await s.t.refused(`/p/${right}/events`, s.challenge(C, right, 'one'))).toBe(NO_PANEL);
  });
});

describe('the coin across a version (QX-17 section 3 and QX-1 section 2 as amended 10 November 2026)', () => {
  /** The coin's parameters at this tracker, its home: an epoch a day from T0, no cap, the treasury's tenth. */
  const COIN = {
    genesis: T0,
    epoch_h: 24,
    emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 },
    vesting_h: 48,
    infra_bp: 1000,
    treasury: addr(treasury),
    unit: 1000,
    weights: { cross_vendor: 2, same_vendor: 1, attest: 0 },
    burn_rate: 100,
    transfers_from: T0,
    redeem_from: T0,
  };
  const s = scene({ coin: COIN, founding: { [addr(owner)]: 20 } }, new Date(Date.parse(T0) + HOUR).toISOString());
  let v1: Hash, v2: Hash;
  const golden = new Map<string, { projection: Record<string, unknown>; nonce: string }>();
  /** The owner's blind commitment on a piece, kept by the version it is posted to and the piece. */
  function commitment(problem: Hash, piece: Hash): Hash {
    const projection = { verdict: 'supports' };
    const nonce = newNonce();
    golden.set(`${problem}:${piece}`, { projection, nonce });
    return commitHash({ piece, projection }, nonce);
  }
  const reveal = (problem: Hash, piece: Hash) =>
    s.t.ev(owner, 'gold_reveal', golden.get(`${problem}:${piece}`)!, problem, piece);
  const verifiedOn = (piece: Hash) =>
    linesFromLayer(s.layer(), COIN, s.nowIso())
      .verified.filter((l) => l.piece === piece)
      .map((l) => [l.problem, l.root]);
  type Balance = { minted: number; received: number };
  const balanceOf = (k: Uint8Array) => s.t.get<Balance>(`/coin/balance/${addr(k)}`);

  it('verifies a carried square once on one gold at v1', async () => {
    v1 = await s.publish(version('1'));
    v2 = await s.publish(version('2', v1));
    const [one, two] = [s.hashOf(v1, 'one'), s.hashOf(v1, 'two')];
    await s.t.accepted(
      `/p/${v1}/events`,
      s.t.ev(owner, 'gold', { commitments: [commitment(v1, one), commitment(v1, two)].sort(), stake: 4 }, v1),
    );
    await s.t.accepted(`/p/${v2}/events`, s.t.ev(owner, 'gold', { commitments: [commitment(v2, two)], stake: 2 }, v2));
    await s.squared(v1, 'one', [A, B]);
    await s.squared(v1, 'two', [C, D]);
    await s.t.accepted(`/p/${v1}/events`, reveal(v1, one));
    expect(verifiedOn(one)).toEqual([
      [v1, addr(A)],
      [v1, addr(B)],
    ]);
  });

  it('verifies a square once for each version whose gold matched it, as the reference does today', async () => {
    const two = s.hashOf(v1, 'two');
    await s.t.accepted(`/p/${v1}/events`, reveal(v1, two));
    await s.t.accepted(`/p/${v2}/events`, reveal(v2, two));
    // This is what the reference does: a gold at each version on the same piece verifies the one square twice.
    expect(verifiedOn(two)).toEqual([
      [v1, addr(C)],
      [v1, addr(D)],
      [v2, addr(C)],
      [v2, addr(D)],
    ]);
    // So the epoch mints C and D twice what it mints A and B for one square each: weight 12, not 8.
    s.t.clock.tick = Date.parse(T0) + 24 * HOUR + 1000;
    const epochs = await s.t.get<{ epochs: { epoch: number; weight: number }[] }>('/coin/epochs');
    expect(epochs.epochs[0]).toMatchObject({ epoch: 0, weight: 12 });
    expect((await balanceOf(A)).minted).toBe(150);
    expect((await balanceOf(C)).minted).toBe(300);
  });

  it('pays a carried set once from an escrow at v1', async () => {
    await s.t.accepted('/coin/events', s.t.ev(A, 'pay', { problem: v1, amount: 50, per_square: 50 }));
    await s.squared(v1, 'three', [E, F]);
    expect(s.stateOf(v2, 'three')).toBe('accepted_provisional');
    expect((await balanceOf(E)).received).toBe(25);
    expect((await balanceOf(F)).received).toBe(25);
  });

  it('pays a carried set once from the escrow of each version, as the reference does today', async () => {
    await s.t.accepted('/coin/events', s.t.ev(A, 'pay', { problem: v1, amount: 50, per_square: 50 }));
    await s.t.accepted('/coin/events', s.t.ev(A, 'pay', { problem: v2, amount: 50, per_square: 50 }));
    await s.squared(v1, 'four', [G, H]);
    // This is what the reference does: the accepted line of each version draws on that version's own escrow.
    expect((await balanceOf(G)).received).toBe(50);
    expect((await balanceOf(H)).received).toBe(50);
  });
});
