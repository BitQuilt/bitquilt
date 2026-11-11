/**
 * QX-15's part of the one Layer (docs/ext/QX-15.md), `stakeAdmissions`, which challengeLayer binds in: locked and free
 * standing, the live locks and when each ends, the pieces a key cannot afford, and the admissions the door asks before
 * it takes a stake rule, a lock or work on a staked piece, with the types QX-15 adds to a problem's log. The rules
 * themselves, the bodies, what a piece asks and when a lock is live or released, are the core's now, moved
 * as docs/history/V2-PLAN.md, phase 3, says: they are `stake.ts` there.
 */
import {
  type Address,
  type CoinLockWord,
  type Folding,
  type Hash,
  type LockView,
  checkLock,
  hasLock,
  liveAt,
  lockEnd,
  ruleAt,
  ruleProblem,
  stakeAsked,
} from '@bitquilt/core';
import type { Admission, Layer, ProblemLayer } from './challenge.js';

/**
 * The types QX-15 adds to a problem's log. The door admits each through its own row of `problemDoor` in admit.ts,
 * and admit.test.ts holds those rows to this set.
 */
export const STAKE_EVENTS: ReadonlySet<string> = new Set(['stake_rule', 'lock']);
/** The events a lock backs on a staked piece. */
export const PRODUCTION_EVENTS: ReadonlySet<string> = new Set(['claim', 'commit', 'reveal', 'run']);

/**
 * The states a piece still takes work in (QX-15 section 2): what `unaffordable` measures a key's free standing against.
 */
const UNDONE: ReadonlySet<string> = new Set(['open', 'in_flight', 'sealed', 'needs_verify', 'disputed', 'recording']);

/**
 * QX-15's part of the layer (QX-15 sections 1 to 3), over the record `f` challengeLayer folded at `now` and the
 * problems' views. Its reads are locked and free standing, a root's live locks, when the fold releases a lock, and the
 * undone pieces a key cannot afford. Its admissions say whether a stake rule, a lock, or a claim, commit, reveal or run
 * on a staked piece would count if received now, and why not.
 */
export function stakeAdmissions(
  f: Folding,
  problems: Map<Hash, ProblemLayer>,
  now: string,
): Pick<
  Layer,
  'locked' | 'free' | 'liveLocks' | 'admitStakeRule' | 'admitLock' | 'lockEndsAt' | 'admitProduction' | 'unaffordable'
> {
  const admitStakeRule = (problem: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const why = ruleProblem(home, key, body, now);
    return why ? { ok: false, why } : { ok: true };
  };
  const admitLock = (
    problem: Hash,
    piece: Hash,
    key: Address,
    body: Record<string, unknown>,
    word: CoinLockWord | null = null,
  ): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkLock(f, home, piece, key, body, now, word);
    return r.ok ? { ok: true } : r;
  };
  const admitProduction = (problem: Hash, piece: Hash, key: Address): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const view = home.fold.byHash.get(piece);
    if (!view) return { ok: false, why: 'names a piece this problem does not have' };
    const asked = stakeAsked(ruleAt(home, now), view.piece);
    if (asked === 0 || hasLock(f, home, piece, home.fold.rootOf(key, now), now)) return { ok: true };
    return { ok: false, why: `this piece asks for a stake of ${asked}; lock first` };
  };
  const unaffordable = (problem: Hash, key: Address): Set<Hash> => {
    const out = new Set<Hash>();
    const home = f.entries.get(problem);
    const pl = problems.get(problem);
    if (!home || !pl) return out;
    const root = home.fold.rootOf(key, now);
    const free = f.free(root, now);
    for (const p of pl.pieces)
      if (UNDONE.has(p.state) && p.stake > free && !hasLock(f, home, p.hash, root, now)) out.add(p.hash);
    return out;
  };
  const liveLocks = (root: Address): LockView[] => f.locks.filter((l) => l.root === root && liveAt(f, l, now));
  return {
    locked: f.locked,
    free: f.free,
    liveLocks,
    admitStakeRule,
    admitLock,
    lockEndsAt: (l) => lockEnd(f, l),
    admitProduction,
    unaffordable,
  };
}
