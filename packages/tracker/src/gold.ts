/**
 * QX-16's part of the one Layer (docs/ext/QX-16.md), `goldAdmissions`, which challengeLayer binds in: the admissions
 * the door asks before it takes a gold or a gold reveal, with the types QX-16 adds to a problem's log. The rules
 * themselves, the bodies, the shares, the match and when a commitment is final, are the core's now, moved
 * as docs/history/V2-PLAN.md, phase 3, says: they are `gold.ts` there.
 */
import {
  type Address,
  type Admission,
  type Folding,
  type Hash,
  checkGold,
  checkGoldReveal,
  lineOf,
} from '@bitquilt/core';
import type { Layer } from './challenge.js';

/**
 * The types QX-16 adds to a problem's log. The door admits each through its own row of `problemDoor` in admit.ts,
 * and admit.test.ts holds those rows to this set.
 */
export const GOLD_EVENTS: ReadonlySet<string> = new Set(['gold', 'gold_reveal']);

/**
 * QX-16's part of the layer (QX-16 sections 1 and 3), over the record `f` challengeLayer folded at `now`: whether a
 * gold or a gold reveal by this key would count if received now, and why not.
 */
export function goldAdmissions(f: Folding, now: string): Pick<Layer, 'admitGold' | 'admitGoldReveal'> {
  const admitGold = (problem: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkGold(f, home, key, body, now);
    return r.ok ? { ok: true } : r;
  };
  const admitGoldReveal = (problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkGoldReveal(home, lineOf(f, problem), piece, key, body, now);
    return r.ok ? { ok: true } : r;
  };
  return { admitGold, admitGoldReveal };
}
