/**
 * The one Layer a tracker's door reads (docs/ext/QX-1.md): the core's `read` of every problem held, with each
 * extension's admissions bound beside the views, what the door asks before it takes an event. The pass itself, the
 * challenge window with the verifier kinds, the readings set aside, the stakes, the golds and the inherited squares
 * folded in its seven phases, is the core's `read.ts` now, moved as docs/history/V2-PLAN.md, phase 3, says, and it
 * answers with the record it wrote into. challengeLayer asks each extension's admissions over that record, each built
 * in the file of the checks it makes: QX-1's here (challengeAdmissions), QX-2's in verifiers.ts, QX-15's in stake.ts
 * and QX-16's in gold.ts. The types QX-1 adds to a problem's log are here too, and what the door says of a problem
 * the core refuses.
 */
import {
  type Address,
  type Admission,
  type CoinLockWord,
  type Folding,
  type Hash,
  type LockView,
  PANEL,
  type ReadInput,
  type Reading,
  checkChallenge,
  read,
  rootFor,
  seatProblem,
  verdictReturnProblem,
} from '@bitquilt/core';
import { judgeAdmissions } from './verifiers.js';
import { stakeAdmissions } from './stake.js';
import { goldAdmissions } from './gold.js';

/**
 * The types QX-1 adds to a problem's log. The door admits each through its own row of `problemDoor` in admit.ts,
 * and admit.test.ts holds those rows to this set.
 */
export const CHALLENGE_EVENTS: ReadonlySet<string> = new Set(['challenge', 'verdict']);

/**
 * What a reader is handed: the views, standing over them, and the admissions the door asks before it takes an event.
 * challengeLayer builds it whole, each extension's part in the file of the checks it makes (the header names the
 * files).
 */
export interface Layer extends Reading {
  /** Whether a challenge by this key for this stake would count if received now, and why not. */
  admitChallenge(problem: Hash, piece: Hash, key: Address, stake: number): Admission;
  /** Whether a verdict by this key on this challenge would count if received now, and why not. */
  admitVerdict(problem: Hash, piece: Hash, key: Address, challenge: Hash, body: Record<string, unknown>): Admission;
  /** Whether a rank by this key on this judge piece would count if received now, and why not. */
  admitRank(problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission;
  /** QX-15: the sum of a root's live standing locks at a time, `now` when none is given. */
  locked(root: Address, at?: string): number;
  /** QX-15: standing less locked, never below zero. */
  free(root: Address, at?: string): number;
  /** QX-15: a root's locks live at now. */
  liveLocks(root: Address): LockView[];
  /** Whether a stake rule by this key would count if received now, and why not. */
  admitStakeRule(problem: Hash, key: Address, body: Record<string, unknown>): Admission;
  /**
   * Whether a lock by this key on this piece would count if received now, and why not; a coin-kind lock comes with the
   * word the door read of the coin lock (QX-17).
   */
  admitLock(
    problem: Hash,
    piece: Hash,
    key: Address,
    body: Record<string, unknown>,
    word?: CoinLockWord | null,
  ): Admission;
  /** QX-15: when the fold releases a lock, or null while it would be live; forfeits are not judged here. */
  lockEndsAt(lock: LockView): string | null;
  /**
   * Whether a claim, commit, reveal or run by this key on this piece is backed as the piece's stake asks, and why not.
   */
  admitProduction(problem: Hash, piece: Hash, key: Address): Admission;
  /** The undone pieces of a problem whose stake the key's free standing cannot cover and on which it holds no lock. */
  unaffordable(problem: Hash, key: Address): Set<Hash>;
  /** Whether a gold by this key would be kept whole if received now, and why not (QX-16). */
  admitGold(problem: Hash, key: Address, body: Record<string, unknown>): Admission;
  /** Whether a gold reveal by this key on this piece would count if received now, and why not. */
  admitGoldReveal(problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission;
}

/**
 * What a refusal of a problem held here whose input the core refuses says, with the core's reason (CORE.md section 6).
 */
export function refusedHere(why: string): string {
  return `the core refuses this problem as held here: ${why}`;
}

/**
 * The layer over every problem a reader holds, at `now`: the core's `read` of them, with each extension's admissions
 * bound beside its views, each asked over the record the fold wrote into.
 */
export function challengeLayer(input: ReadInput): Layer {
  const reading = read(input);
  const { record: f, now, problems } = reading;
  return {
    ...reading,
    ...challengeAdmissions(f, now),
    ...judgeAdmissions(f, now),
    ...stakeAdmissions(f, problems, now),
    ...goldAdmissions(f, now),
  };
}

/**
 * QX-1's part of the layer (QX-1 section 1), over the record `f` challengeLayer folded at `now`: whether a challenge or
 * a verdict by this key would count if received now, and why not.
 */
function challengeAdmissions(f: Folding, now: string): Pick<Layer, 'admitChallenge' | 'admitVerdict'> {
  const admitChallenge = (problem: Hash, piece: Hash, key: Address, stake: number): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkChallenge(f, home, piece, key, stake, now);
    if (!r.ok) return r;
    if (r.pool.length < PANEL)
      return {
        ok: false,
        why: `no panel can be seated: ${r.pool.length} root${r.pool.length === 1 ? '' : 's'} with an accepted return on another problem, ${PANEL} needed`,
      };
    return { ok: true };
  };
  const admitVerdict = (
    problem: Hash,
    piece: Hash,
    key: Address,
    id: Hash,
    body: Record<string, unknown>,
  ): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const challenge = home.challenges.find((c) => c.id === id && c.piece === piece);
    if (!challenge || challenge.outcome !== 'open') return { ok: false, why: 'names no open challenge on this piece' };
    const root = rootFor(home.fold, key, 'verdict', now);
    if (!root) return { ok: false, why: 'the key may not sign a verdict' };
    const why = seatProblem(challenge, root);
    if (why) return { ok: false, why };
    const view = home.fold.byHash.get(piece)!;
    const rp = verdictReturnProblem(view, body.return);
    return rp ? { ok: false, why: rp } : { ok: true };
  };
  return { admitChallenge, admitVerdict };
}
