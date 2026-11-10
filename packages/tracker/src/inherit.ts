/**
 * QX-23, a fork inherits squares (docs/ext/QX-23.md): a piece is named by the hash of its brief, schema and verifier,
 * so a piece a fork keeps unchanged is the same question, and the square it has on the problem the fork came from
 * already answers it. This file holds what a fork reaches (QX-23 section 1), the layer's last pass, which counts the
 * pieces done elsewhere, settles what waits on them and marks the inherited squares (QX-23 sections 2 and 3), when a
 * fork is complete in the layer (QX-23 section 4), and the brief of a piece that waits on an inherited input
 * (QX-23 section 3). An inherited square is a reading of the record and moves nothing: the pass runs after every
 * credit, lock, gold and challenge is folded, adds no event, and writes a state and a mark and nothing else. No HTTP
 * in it. It loads the core alone and takes the layer's types as types, with a piece's own state and the settling
 * handed in, so challenge.ts loads it with no cycle.
 */
import { type Hash, type PieceState, type PieceView, renderInputs } from '@bitquilt/core';
import type { Layer, LayerState, ProblemLayer } from './challenge.js';
import type { Folding, ProblemEntry } from './standing.js';

export const INHERIT = 'QX-23';

/** The inherited square's mark: the problem where the square stands, and the piece's state there. */
export type Inherited = { problem: Hash; state: LayerState };

/** QX-23 section 3: a square that is final, "`accepted`, `unreachable` or `recorded` there". */
const DONE: ReadonlySet<string> = new Set(['accepted', 'unreachable', 'recorded']);
/**
 * QX-23 section 2: "A square stands on a piece, at a problem, where the piece's state there is the problem's own and
 * is one of `accepted_provisional`, `accepted`, `unreachable`, `challenged` or `recorded`."
 */
const SQUARE: ReadonlySet<string> = new Set([...DONE, 'accepted_provisional', 'challenged']);
/**
 * QX-23 section 2: a piece is inherited where "its own state on F is none of those five and is not `locked`", so a
 * piece in one of these six keeps its own state.
 */
const KEEP: ReadonlySet<string> = new Set([...SQUARE, 'locked']);

/**
 * QX-23 section 2: "Of several squares in reach, the one named is the furthest along, a final one (`accepted`,
 * `unreachable`, `recorded`) over `accepted_provisional` over `challenged`". Nothing where no square stands.
 */
function rankOf(state: string): number {
  if (DONE.has(state)) return 3;
  if (state === 'accepted_provisional') return 2;
  return state === 'challenged' ? 1 : 0;
}

/**
 * The hashes of an entry's chain, nearest first: its own, then each ancestor's along `prev` that the core's chain
 * holds. The last envelope's own `prev` is left out: the core's chain stopped there, at an envelope the reader does
 * not hold or one by another owner, and that is no version of this line.
 */
function chainOf(e: ProblemEntry): Hash[] {
  const out: Hash[] = [e.hash];
  for (const env of e.fold.chain.slice(0, -1)) if (env.problem.prev) out.push(env.problem.prev);
  return out;
}

/** QX-23 section 1: each `from` an envelope of the entry's chain names, its own envelope first, then an ancestor's. */
function sourcesOf(e: ProblemEntry): Hash[] {
  const out: Hash[] = [];
  for (const env of e.fold.chain) if (env.problem.from) out.push(env.problem.from);
  return out;
}

/**
 * QX-23 section 1, what each problem reaches, for the problems that reach something: "For a source S the tracker
 * holds, F reaches the line of S: S, and every later version of S the tracker holds, the earlier first", and "what
 * S's own chain reaches by the same rule". A later version of equal length is ordered by its hash. "A problem never
 * reaches a version of itself, and a ring of `from` is walked once." Nothing is built where no envelope names a
 * `from`, so a tracker that holds no fork does no more here than look.
 */
function reaches(entries: ReadonlyMap<Hash, ProblemEntry>): Map<ProblemEntry, ProblemEntry[]> {
  const out = new Map<ProblemEntry, ProblemEntry[]>();
  const forks = [...entries.values()].filter((e) => sourcesOf(e).length > 0);
  if (forks.length === 0) return out;

  // The line of each held problem: the entries whose chain holds it, itself first, then the later versions.
  const chains = new Map<ProblemEntry, Hash[]>();
  const lines = new Map<Hash, ProblemEntry[]>();
  for (const e of entries.values()) {
    const chain = chainOf(e);
    chains.set(e, chain);
    for (const h of chain) lines.set(h, [...(lines.get(h) ?? []), e]);
  }
  for (const line of lines.values())
    line.sort(
      (a, b) => chains.get(a)!.length - chains.get(b)!.length || (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0),
    );

  for (const fork of forks) {
    // The fork's own line: the versions in its chain, and each later version of it.
    const own = new Set<Hash>(chains.get(fork)!);
    for (const later of lines.get(fork.hash) ?? []) own.add(later.hash);
    const reach: ProblemEntry[] = [];
    const reached = new Set<Hash>();
    const walked = new Set<Hash>();
    const walk = (sources: Hash[]): void => {
      for (const s of sources) {
        if (walked.has(s)) continue;
        walked.add(s);
        const source = entries.get(s);
        if (!source) continue;
        for (const e of lines.get(s) ?? []) {
          if (own.has(e.hash) || reached.has(e.hash)) continue;
          reached.add(e.hash);
          reach.push(e);
        }
        walk(sourcesOf(source));
      }
    };
    walk(sourcesOf(fork));
    if (reach.length) out.set(fork, reach);
  }
  return out;
}

/**
 * The layer's last pass, QX-23 section 5: "It finds each problem's reach, counts the pieces done elsewhere, and
 * settles the states of the problems that reach something again until nothing moves; then it marks the inherited
 * pieces." `own` is the layer's own state of a piece on an entry, and `settle` settles an entry's states again over
 * its `elsewhere`, deciding nothing again. Every credit, lock, gold and challenge is folded before this runs and none
 * is read again after it, so an inherited square moves none of them.
 *
 * The pass. QX-23 section 3: "A piece is done elsewhere, for a fork, where a piece of the same hash at a problem the
 * fork reaches has a square that is final". A piece done elsewhere can open a dependent whose own set then stands,
 * which a fork of that fork reads in turn, so the pass repeats; `elsewhere` only grows, so it ends.
 *
 * The sweep. QX-23 section 2: a piece is inherited where its own state is no square's and is not `locked`, and "a
 * square stands on a piece of the same hash at a problem F reaches". The mark is kept on the entry and the state
 * written into the fold's view, so the core's `next` over the layer's fold never hands an inherited piece. Only a
 * problem's own square is read from a source, and a piece with one keeps its own state, so the order of the sweep
 * does not matter.
 */
export function inheritSquares(
  f: Folding,
  own: (e: ProblemEntry, v: PieceView) => LayerState,
  settle: (e: ProblemEntry) => void,
): void {
  const reach = reaches(f.entries);
  if (reach.size === 0) return;

  for (let moved = true; moved; ) {
    moved = false;
    for (const [e, sources] of reach) {
      let grew = false;
      for (const v of e.fold.pieces) {
        const hash = v.piece.hash;
        if (e.elsewhere.has(hash)) continue;
        const final = sources.some((s) => {
          const there = s.fold.byHash.get(hash);
          return there !== undefined && DONE.has(own(s, there));
        });
        if (!final) continue;
        e.elsewhere.add(hash);
        grew = true;
      }
      if (!grew) continue;
      settle(e);
      moved = true;
    }
  }

  for (const [e, sources] of reach)
    for (const v of e.fold.pieces) {
      if (KEEP.has(own(e, v))) continue;
      let mark: Inherited | null = null;
      for (const s of sources) {
        const there = s.fold.byHash.get(v.piece.hash);
        if (!there) continue;
        const state = own(s, there);
        if (rankOf(state) > rankOf(mark?.state ?? '')) mark = { problem: s.hash, state };
      }
      if (!mark) continue;
      e.inherited.set(v.piece.hash, mark);
      v.state = 'inherited' as PieceState;
    }
}

/**
 * QX-23 section 4: "A fork is complete, in the tracker's layer, where every piece is `accepted`, `unreachable` or
 * `recorded`, or is `inherited` from a square that is one of those three." The fold's own `complete` stays the
 * problem's own, which the coin and the owner's gold settle on.
 */
export function completeInLayer(pieces: readonly { state: LayerState; inherited: Inherited | null }[]): boolean {
  return (
    pieces.length > 0 &&
    pieces.every(
      (p) => DONE.has(p.state) || (p.state === 'inherited' && p.inherited !== null && DONE.has(p.inherited.state)),
    )
  );
}

/**
 * QX-23 section 3: the brief of a piece next hands over "fills the slot of an inherited input with the returns of the
 * accepting set at the problem named, each as quoted text with its signer's address, as the core renders its own". An
 * inherited input with a set of the fork's own is not inherited, and "An input recorded elsewhere renders nothing,
 * since there is no agreed return to render", so the source's view is taken only where it has an accepting set. Where
 * the problem inherits nothing this is the core's own render.
 */
export function briefOver(layer: Layer, pl: ProblemLayer, v: PieceView): string {
  if (!pl.pieces.some((p) => p.inherited)) return renderInputs(v, pl.fold);
  const byHash = new Map(pl.fold.byHash);
  for (const p of pl.pieces) {
    if (!p.inherited || byHash.get(p.hash)?.accepting) continue;
    const there = layer.problems.get(p.inherited.problem)?.fold.byHash.get(p.hash);
    if (there?.accepting) byHash.set(p.hash, there);
  }
  return renderInputs(v, { ...pl.fold, byHash });
}
