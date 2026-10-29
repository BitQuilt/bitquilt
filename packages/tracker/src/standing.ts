/**
 * Standing, QX-1 section 2, as the layer keeps it while it folds: the credits every accepting set earns its roots,
 * the moves a strike, a stake, a forfeit, a restore or a burn makes, and the three readers over them, standing, locked
 * and free. The record every phase of challengeLayer writes into is defined here too, since standing is a function of
 * all of them: what the folds credit, what a lock holds (QX-15), what a gold locks (QX-16), what a burn bought (QX-17).
 */
import { type Address, type Hash, type PieceView, type Receipt, type ReduceInput, type State, isRecord } from '@bitquilt/core';
import { type Layered, viaOf } from './verifiers.js';
import { type LockView, type StakeRule, liveAt } from './stake.js';
import { type GoldView, goldLiveAt } from './gold.js';
import type { ChallengeView } from './challenge.js';

/** A point a root earned: a reveal in an accepting set, counted from the set's completion `at`, and withdrawn at `until` by the strike that struck the set. */
export interface Credit { root: Address; problem: Hash; at: string; until: string | null }
/** A move on a root's standing, dated at the receipt that made it. */
export interface Move { root: Address; at: string; delta: number }
/** An event the layer did not keep, with why. */
export interface Dropped { id: Hash; type: string; why: string }

/** One problem as the layer holds it while it folds. */
export interface ProblemEntry {
  hash: Hash;
  input: ReduceInput;
  /** The core's reduce of everything, kept for the core's states. */
  core: State;
  /** The core's reduce without the struck events. */
  base: State;
  /** `base` with the verifier kinds decided: the fold the layer reads. */
  fold: State;
  /** The kinds decided over `base`: the panels, each piece's kind, what is not offered. */
  layered: Layered;
  /** The ids of the events struck out of this problem's fold. */
  struck: Set<Hash>;
  challenges: ChallengeView[];
  dropped: Dropped[];
  /** The stake rules kept (QX-15), in receipt order. */
  rules: StakeRule[];
  /** The golds kept on this problem (QX-16). */
  golds: GoldView[];
}

/**
 * What the layer carries between its phases: every problem's entry, and the credits, moves, locks and golds that
 * standing, locked and free are read from. The three readers are the record's own, so a check in stake.ts or gold.ts
 * asks the record and not this module.
 */
export interface Folding {
  /** The time the layer is read at: roots are resolved at it, lapses, windows and liveness are judged against it. */
  now: string;
  /** QX-1 section 2 as amended 29 October 2026: the founding standing this tracker declares, by root in lower case, counted from the ledger's beginning. */
  founding: Map<string, number>;
  entries: Map<Hash, ProblemEntry>;
  /** The credits as the folds stand now, refreshed after every refold. */
  credits: Credit[];
  /** The credits a strike withdrew, kept with the time they were withdrawn, so a panel drawn before the strike keeps its pool. */
  struckCredits: Credit[];
  moves: Move[];
  /** Every standing or coin lock kept (QX-15), live or not. */
  locks: LockView[];
  /** Every gold kept (QX-16), live or not. */
  golds: GoldView[];
  /** A root's standing at a time, `now` when none is given. */
  standing(root: Address, at?: string): number;
  /** QX-15 section 3: the sum of a root's live standing locks and the stakes of its live golds (QX-16 section 5), at a time. */
  locked(root: Address, at?: string): number;
  /** QX-15 section 3: standing less locked, never below zero. */
  free(root: Address, at?: string): number;
}

/** An empty record at `now`, its readers bound to it. */
export function newFolding(now: string, founding: Map<string, number> = new Map()): Folding {
  const f: Folding = {
    now, founding, entries: new Map(), credits: [], struckCredits: [], moves: [], locks: [], golds: [],
    standing: (root, at = now) => standingAt(f, root, at),
    locked: (root, at = now) => lockedAt(f, root, at),
    free: (root, at = now) => Math.max(0, f.standing(root, at) - f.locked(root, at)),
  };
  return f;
}

/** The roots of a piece's accepting set: both reveals of an agree set; the patch's root and the two runners of a check or score set. */
export function acceptingRoots(v: PieceView): Address[] {
  if (!v.accepting) return [];
  if (v.accepting.kind === 'agree') return v.accepting.reveals.map((r) => r.root);
  return [v.accepting.patch.root, ...v.accepting.runs.map((r) => r.root)];
}

/** The roots whose standing a set credits: the reveals, not the runs; an attested acceptance credits nobody, being the actor's own word. */
export function creditedRoots(v: PieceView): Address[] {
  if (!v.accepting) return [];
  if (viaOf(v.accepting) === 'attest') return [];
  return v.accepting.kind === 'agree' ? v.accepting.reveals.map((r) => r.root) : [v.accepting.patch.root];
}

/**
 * The credits as the folds stand: one per credited root of every accepting set, from the set's completion. A set that
 * was struck keeps its withdrawn point in `struckCredits`, and one struck and restored (QX-16 section 4) regains its
 * point as a move from the decision, so neither is credited twice here.
 */
export function refreshCredits(f: Folding): void {
  f.credits = [];
  for (const e of f.entries.values()) for (const v of e.fold.pieces) if (v.accepting) for (const r of creditedRoots(v)) {
    const root = e.fold.rootOf(r, f.now);
    const at = v.accepting.completedAt;
    if (f.struckCredits.some((s) => s.root === root && s.problem === e.hash && s.at === at)) continue;
    f.credits.push({ root, problem: e.hash, at, until: null });
  }
}

/**
 * The roots credited on a problem other than `problem` at `at`. A credit counts from the set's completion until the
 * strike that withdrew it, so a panel drawn before a strike keeps its pool (verifiers.md section 6). The challenge
 * window's pool (QX-1 section 3) and a judge panel's (verifiers.md) each apply their own relatedness filter on top.
 */
export function creditedElsewhere(f: Folding, problem: Hash, at: string): Set<Address> {
  const roots = new Set<Address>();
  for (const c of [...f.credits, ...f.struckCredits]) if (c.problem !== problem && c.at <= at && (c.until === null || c.until > at)) roots.add(c.root);
  return roots;
}

/**
 * Every problem's input carries the identity log, so any fold resolves a key; with no problem held, the key is its own
 * root.
 */
export function rootOf(f: Folding, key: Address, at: string): Address {
  const first = f.entries.values().next().value;
  return first ? first.fold.rootOf(key, at) : key;
}

/** QX-17 section 4: a burn on the coin log is credited as standing on the door's word in its wrapper, as a reader takes custody. */
export function creditBurns(f: Folding, coin: Receipt[]): void {
  for (const r of coin) {
    const at = r.received[0]?.at;
    const word = (r.received[0] as { stake?: unknown } | undefined)?.stake;
    if (!at || at > f.now || r.event.type !== 'burn' || !isRecord(word) || word.kind !== 'burn' || typeof word.standing !== 'number' || word.standing <= 0) continue;
    f.moves.push({ root: rootOf(f, r.event.key, at), at, delta: word.standing });
  }
}

/**
 * A root's standing at a time: 1 to start, then every move in time order, each counting from its instant, and never
 * below zero (QX-1 section 2). The moves, and where each is made:
 *
 *   QX-1 section 2    +1 for each credited reveal, from the set's completion (`credits`); +stake when the root's
 *                     challenge held, -stake when it failed; -1 when a set the root was in was struck, and the set's
 *                     point withdrawn from the same time (`struckCredits`).
 *   QX-15 section 3   -amount when the root's lock was forfeited with a struck set; +amount when it was restored.
 *   QX-16 section 4   +2 when a held challenge on a miss gave back the point docked and the set's point; the owner's
 *                     -stake, forfeited whole.
 *   QX-17 section 4   +floor(amount / burn_rate) for a burn on the coin log, on the door's word.
 *   QX-1 section 2    +the founding standing the tracker declares for the root (amended 29 October 2026), from the
 *   (amended)         beginning, before the 1 every root starts with.
 */
function standingAt(f: Folding, root: Address, at: string): number {
  const moves: { at: string; delta: number }[] = [];
  for (const c of [...f.credits, ...f.struckCredits]) if (c.root === root) {
    moves.push({ at: c.at, delta: 1 });
    if (c.until !== null) moves.push({ at: c.until, delta: -1 });
  }
  for (const m of f.moves) if (m.root === root) moves.push({ at: m.at, delta: m.delta });
  moves.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let s = 1 + (f.founding.get(root.toLowerCase()) ?? 0);
  for (const m of moves) if (m.at <= at) s = Math.max(0, s + m.delta);
  return s;
}

/** What a root has locked at a time: its live standing locks (QX-15 section 3) and the stakes of its live golds (QX-16 section 5). */
function lockedAt(f: Folding, root: Address, at: string): number {
  return f.locks.reduce((sum, l) => (l.root === root && l.kind === 'standing' && liveAt(f, l, at) ? sum + l.amount : sum), 0)
    + f.golds.reduce((sum, g) => (g.root === root && goldLiveAt(f, g, at) ? sum + g.stake : sum), 0);
}
