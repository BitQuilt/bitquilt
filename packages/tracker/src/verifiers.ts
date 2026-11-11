/**
 * QX-2's admission, what the door asks the layer before it takes a rank (docs/ext/verifiers.md section 2, `judge:n`):
 * `judgeAdmissions`, which challengeLayer binds into the one Layer, and the types QX-2 adds to a problem's log. The
 * kinds themselves, decided over the fold, and the three checks a rank is held to there and here, moved into the core
 * as docs/history/V2-PLAN.md, phase 3, says: they are `kinds.ts` there.
 */
import {
  type Address,
  type Admission,
  type Folding,
  type Hash,
  panelSeatProblem,
  rankBodyProblems,
  rankingProblem,
  rootFor,
} from '@bitquilt/core';
import type { Layer } from './challenge.js';

/**
 * The types QX-2 adds to a problem's log. The door admits each through its own row of `problemDoor` in admit.ts,
 * and admit.test.ts holds those rows to this set.
 */
export const RANK_EVENTS: ReadonlySet<string> = new Set(['rank']);

/**
 * QX-2's part of the layer (verifiers.md section 2, `judge:n`), over the record `f` challengeLayer folded at `now`:
 * whether a rank by this key on this judge piece would count if received now, and why not.
 */
export function judgeAdmissions(f: Folding, now: string): Pick<Layer, 'admitRank'> {
  const admitRank = (problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    if (!home.fold.byHash.has(piece)) return { ok: false, why: 'names a piece this problem does not have' };
    const shape = rankBodyProblems(body);
    if (shape.length) return { ok: false, why: shape[0]! };
    const panel = home.decided.byPiece.get(piece);
    if (!panel)
      return {
        ok: false,
        why:
          home.decided.kinds.get(piece)?.kind === 'judge'
            ? 'the candidates for this piece are not in yet'
            : 'no panel sits on this piece',
      };
    if (panel.outcome === 'decided') return { ok: false, why: 'the panel has decided' };
    if (panel.outcome === 'void') return { ok: false, why: 'the panel ran out' };
    if (panel.seats.length === 0) return { ok: false, why: 'no seats drawn yet' };
    const root = rootFor(home.fold, key, 'rank', now);
    if (!root) return { ok: false, why: 'the key may not sign a rank' };
    const why = panelSeatProblem(panel, root);
    if (why) return { ok: false, why };
    const rp = rankingProblem(panel, body.ranking);
    return rp ? { ok: false, why: rp } : { ok: true };
  };
  return { admitRank };
}
