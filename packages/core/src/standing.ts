/**
 * Standing, QX-1 section 2, as reading 2 keeps it while it folds: the credits every accepting set earns its roots,
 * the moves a strike, a stake, a forfeit, a restore or a burn makes, and the three readers over them, standing, locked
 * and free. The record every phase of the fold writes into is defined here too, since standing is a function of all of
 * them: what the folds credit, what a lock holds (QX-15), what a gold locks (QX-16), what a burn bought (QX-17). Moved
 * here from the tracker's layer as docs/history/V2-PLAN.md, phase 3, says.
 */
import type { Receipt } from './events.js';
import { type Hash, hashCanonical } from './hash.js';
import type { Address } from './keys.js';
import { type KindsDecided, viaOf } from './kinds.js';
import { isRecord } from './plain.js';
import type { Line } from './line.js';
import type { AcceptingSet, PieceView, Reveal, State } from './reduce.js';
import { type LockView, type StakeRule, liveAt } from './stake.js';
import { type GoldView, goldLiveAt } from './gold.js';
import type { ChallengeView, LayerState } from './challenge.js';

/**
 * A point a root earned: a reveal in an accepting set, counted from the set's completion `at`, and withdrawn at `until`
 * by the strike that struck the set. One for each reveal, by its event's id, on the problem the reveal was posted to,
 * however many versions hold its set (QX-1 section 2 as amended 10 November 2026).
 */
export interface Credit {
  root: Address;
  problem: Hash;
  /** The id of the reveal event the point is for. */
  reveal: Hash;
  at: string;
  until: string | null;
}
/** A move on a root's standing, dated at the receipt that made it. */
export interface Move {
  root: Address;
  at: string;
  delta: number;
}
/** An event the layer did not keep, with why. */
export interface Dropped {
  id: Hash;
  type: string;
  why: string;
}

/** One problem as the layer holds it while it folds. */
export interface ProblemEntry {
  hash: Hash;
  /** The version with the rest of its line, and the line's record (READING.md sections 2 and 3). */
  line: Line;
  /** The reduce of the line's record with nothing struck, every reading in it. */
  core: State;
  /** The reduce of the line's record without the struck events. */
  base: State;
  /** `base` with the verifier kinds decided: the fold the layer reads. */
  fold: State;
  /** The kinds decided over `base`: the panels, each piece's kind, what is not offered. */
  decided: KindsDecided;
  /** The ids of the events struck out of this problem's fold. */
  struck: Set<Hash>;
  /**
   * QX-19 section 4: the reveals set aside, by event id, each also in `struck`: a reading that rests on nothing where
   * the other rests on the record.
   */
  aside: Set<Hash>;
  /**
   * The decision that struck each reveal still struck here, by the reveal's id: a held challenge (QX-1 section 6), or
   * the owner's gold reveal that missed (QX-16 section 3). READING.md section 3: a struck reading is on the record
   * "with the decision that struck it".
   */
  struckBy: Map<Hash, { kind: 'challenge' | 'gold'; id: Hash }>;
  challenges: ChallengeView[];
  dropped: Dropped[];
  /** The stake rules kept (QX-15), in receipt order. */
  rules: StakeRule[];
  /** The golds kept on this problem (QX-16). */
  golds: GoldView[];
  /**
   * QX-23 section 3: the pieces done elsewhere, each with a final square at a problem this one reaches. Empty until
   * the layer's last pass, and it only grows there.
   */
  elsewhere: Set<Hash>;
  /**
   * QX-23 section 2: each inherited piece's square, the problem where it stands and the piece's state there. Empty
   * until the layer's last pass.
   */
  inherited: Map<Hash, { problem: Hash; state: LayerState }>;
}

/**
 * What the read carries between its steps: every problem's entry, and the credits, moves, locks and golds that
 * standing, locked and free are read from. The three readers are the record's own, so a check in stake.ts or gold.ts
 * asks the record and not this module.
 */
export interface Folding {
  /** The time the layer is read at: roots are resolved at it, lapses, windows and liveness are judged against it. */
  now: string;
  /**
   * QX-1 section 2 as amended 29 October 2026: the founding standing this tracker declares, by root in lower case,
   * counted from the ledger's beginning.
   */
  founding: Map<string, number>;
  entries: Map<Hash, ProblemEntry>;
  /** The credits as the folds stand now, refreshed after every refold. */
  credits: Credit[];
  /**
   * The credits a strike withdrew, kept with the time they were withdrawn, so a panel drawn before the strike keeps its
   * pool.
   */
  struckCredits: Credit[];
  moves: Move[];
  /** Every standing or coin lock kept (QX-15), live or not. */
  locks: LockView[];
  /** Every gold kept (QX-16), live or not. */
  golds: GoldView[];
  /** A root's standing at a time, `now` when none is given. */
  standing(root: Address, at?: string): number;
  /**
   * QX-15 section 3: the sum of a root's live standing locks and the stakes of its live golds (QX-16 section 5), at a
   * time.
   */
  locked(root: Address, at?: string): number;
  /** QX-15 section 3: standing less locked, never below zero. */
  free(root: Address, at?: string): number;
}

/** An empty record at `now`, its readers bound to it. */
export function newFolding(now: string, founding: Map<string, number> = new Map()): Folding {
  const f: Folding = {
    now,
    founding,
    entries: new Map(),
    credits: [],
    struckCredits: [],
    moves: [],
    locks: [],
    golds: [],
    standing: (root, at = now) => standingAt(f, root, at),
    locked: (root, at = now) => lockedAt(f, root, at),
    free: (root, at = now) => Math.max(0, f.standing(root, at) - f.locked(root, at)),
  };
  return f;
}

/**
 * The roots of a piece's accepting set: both reveals of an agree set; the patch's root and the two runners of a check
 * or score set.
 */
export function acceptingRoots(v: PieceView): Address[] {
  if (!v.accepting) return [];
  if (v.accepting.kind === 'agree') return v.accepting.reveals.map((r) => r.root);
  return [v.accepting.patch.root, ...v.accepting.runs.map((r) => r.root)];
}

/**
 * The reveals whose roots a set credits: both reveals of an agree set, the patch of a check or score set, not the runs;
 * an attested acceptance credits nobody, being the actor's own word.
 */
export function creditedReveals(v: PieceView): Reveal[] {
  if (!v.accepting) return [];
  if (viaOf(v.accepting) === 'attest') return [];
  return v.accepting.kind === 'agree' ? v.accepting.reveals : [v.accepting.patch];
}

/** The roots whose standing a set credits: the roots of its credited reveals. */
export function creditedRoots(v: PieceView): Address[] {
  return creditedReveals(v).map((r) => r.root);
}

/**
 * The ids of the events a set's rule took: the reveals of an agree set, or the patch and the two runs of a check or
 * score set (docs/v2/READING.md section 5).
 */
export function setEvents(set: AcceptingSet): Hash[] {
  return set.kind === 'agree' ? set.reveals.map((r) => r.id) : [set.patch.id, ...set.runs.map((r) => r.id)];
}

/**
 * A set's name. docs/v2/READING.md section 5: "A set is named by the hash of the canonical JSON of its events' ids,
 * sorted." The events are the fold's, each with the id of the line it was read from, so a set carried by several
 * versions has one name at every one of them.
 */
export function setName(set: AcceptingSet): Hash {
  return hashCanonical([...setEvents(set)].sort());
}

/**
 * The credits as the folds stand. QX-1 section 2 as amended 10 November 2026: "A reveal earns its root one point, by
 * the reveal's event: from the earliest completion of a set that holds it, on the problem the reveal was posted to,
 * however many versions the reader holds." So one credit for each reveal id across every entry, at the earliest
 * completion, on the problem the event names where it is held here, else the entry it was found in. A reveal whose set
 * was struck keeps its withdrawn point in `struckCredits`, and one struck and restored (QX-16 section 4) regains its
 * point as a move from the decision, so neither is credited here.
 */
export function refreshCredits(f: Folding): void {
  const struck = new Set(f.struckCredits.map((c) => c.reveal));
  const live = new Map<Hash, Credit>();
  for (const e of f.entries.values())
    for (const v of e.fold.pieces) {
      if (!v.accepting) continue;
      const at = v.accepting.completedAt;
      for (const r of creditedReveals(v)) {
        if (struck.has(r.id)) continue;
        const known = live.get(r.id);
        if (known && known.at <= at) continue;
        const problem = f.entries.has(r.problem) ? r.problem : e.hash;
        live.set(r.id, { root: e.fold.rootOf(r.root, f.now), problem, reveal: r.id, at, until: null });
      }
    }
  f.credits = [...live.values()];
}

/** Each entry's chain as hashes, kept for the layer the entry was made in. */
const chains = new WeakMap<ProblemEntry, ReadonlySet<Hash>>();

/**
 * The hashes of an entry's chain along `prev`, its own first, from the core's checked chain (`fold.chain`, nearest
 * first). The last envelope's own `prev` is left out: the core's chain stopped there, at an envelope the reader does
 * not hold or one by another owner, and that is no version of this line.
 */
function chainOf(e: ProblemEntry): ReadonlySet<Hash> {
  let chain = chains.get(e);
  if (!chain) {
    const out = new Set<Hash>([e.hash]);
    for (const env of e.fold.chain.slice(0, -1)) if (env.problem.prev) out.add(env.problem.prev);
    chain = out;
    chains.set(e, chain);
  }
  return chain;
}

/**
 * The entries of `problem`'s line, its own among them, or none where it is not held. QX-1 section 2 as amended
 * 10 November 2026: "Two problems are of one line where their chains along `prev` share a version: an earlier version
 * of `p`, a later one, and another version made from the same earlier one are each of `p`'s line. A fork is not". A
 * fork names its source by `from` and holds no version of it in its chain, so it stays outside.
 */
export function lineOf(f: Folding, problem: Hash): ProblemEntry[] {
  const home = f.entries.get(problem);
  if (!home) return [];
  const own = chainOf(home);
  return [...f.entries.values()].filter((e) => [...chainOf(e)].some((h) => own.has(h)));
}

/**
 * A line's name. docs/v2/READING.md section 2: "A line is named by the hash of its first version, the one whose `prev`
 * is null. A reader that holds a line part of the way names it by the oldest version its chain reaches." Every version
 * of a line ends its chain along `prev` at one version, so each names the line alike.
 */
export function lineName(e: ProblemEntry): Hash {
  const chain = e.fold.chain;
  return chain.length > 1 ? (chain[chain.length - 2]!.problem.prev as Hash) : e.hash;
}

/**
 * The roots credited on a problem other than `problem` at `at`. QX-1 section 2 as amended 10 November 2026: "A problem
 * of `p`'s line is not a problem other than `p`, so a tracker that holds one problem in several versions has no pool."
 * A credit counts from the set's completion until the strike that withdrew it, so a panel drawn before a strike keeps
 * its pool (verifiers.md section 6). The challenge window's pool (QX-1 section 3) and a judge panel's (verifiers.md)
 * each apply their own relatedness filter on top.
 */
export function creditedElsewhere(f: Folding, problem: Hash, at: string): Set<Address> {
  const line = new Set(lineOf(f, problem).map((e) => e.hash));
  const roots = new Set<Address>();
  for (const c of [...f.credits, ...f.struckCredits])
    if (!line.has(c.problem) && c.at <= at && (c.until === null || c.until > at)) roots.add(c.root);
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

/**
 * QX-17 section 4: a burn on the coin log is credited as standing on the door's word in its wrapper, as a reader takes
 * custody.
 */
export function creditBurns(f: Folding, coin: Receipt[]): void {
  for (const r of coin) {
    const at = r.received[0]?.at;
    const word = (r.received[0] as { stake?: unknown } | undefined)?.stake;
    if (
      !at ||
      at > f.now ||
      r.event.type !== 'burn' ||
      !isRecord(word) ||
      word.kind !== 'burn' ||
      typeof word.standing !== 'number' ||
      word.standing <= 0
    )
      continue;
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
  for (const c of [...f.credits, ...f.struckCredits])
    if (c.root === root) {
      moves.push({ at: c.at, delta: 1 });
      if (c.until !== null) moves.push({ at: c.until, delta: -1 });
    }
  for (const m of f.moves) if (m.root === root) moves.push({ at: m.at, delta: m.delta });
  moves.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  let s = 1 + (f.founding.get(root.toLowerCase()) ?? 0);
  for (const m of moves) if (m.at <= at) s = Math.max(0, s + m.delta);
  return s;
}

/**
 * What a root has locked at a time: its live standing locks (QX-15 section 3) and the stakes of its live golds
 * (QX-16 section 5).
 */
function lockedAt(f: Folding, root: Address, at: string): number {
  return (
    f.locks.reduce(
      (sum, l) => (l.root === root && l.kind === 'standing' && liveAt(f, l, at) ? sum + l.amount : sum),
      0,
    ) + f.golds.reduce((sum, g) => (g.root === root && goldLiveAt(f, g, at) ? sum + g.stake : sum), 0)
  );
}
