/**
 * Each problem's input and the core's fold of it, kept from one layer to the next, so a read or an admission folds
 * again only the problems whose lines, chain or blobs changed, or whose state the clock has turned since
 * (CORE.md section 6). A problem's input is kept under a key made from what the reducer reads of the store: how many
 * versions its chain along `prev` holds, how many lines their logs and the identity log hold, and how many of their
 * blobs are not held. A chain only grows, a log is only appended to, and a blob once held stays, so each of those
 * counts only moves one way when what it counts changes, and an input whose key is unchanged is the input as it would
 * be read again. A fold is kept with the time it was made at and the first time after it at which the clock alone
 * turns a state (`turnsAt`); a fold asked for in between is the fold kept.
 */
import { type Hash, type ReduceInput, type State, IDENTITY_LOG, fixedBytes, reduce } from '@bitquilt/core';
import { type ChainReader, type Store, reduceInputOf } from './store.js';

/** What a version and every version before it hold: versions, lines on their logs, and blobs not held. */
interface Counts {
  versions: number;
  lines: number;
  missing: number;
}

/** A problem's input as kept, its key, and the fold over it with the times it holds for. */
interface Kept {
  key: string;
  input: ReduceInput;
  fold: { state: State; from: string; until: string | null } | null;
}

/** What a tracker keeps of each problem's fold, over its store. */
export interface Folds {
  /** What the reducer takes for a problem held here at `at`, its parts kept while its key holds; null where none is. */
  inputAt(hash: Hash, at: string): ReduceInput | null;
  /**
   * The core's fold of an input `inputAt` made, kept while its key holds and its time is within the fold's; any other
   * input, such as one with events struck from it, is reduced as it is.
   */
  reduce(input: ReduceInput): State;
}

/**
 * The first time after `now` at which the clock alone changes the core's state of a problem, or null where nothing
 * waits on the clock. CORE.md section 6 decides a piece at now from its live claims, its unabandoned commits and its
 * accepting set's window, and nothing else in a state reads the clock: a claim is live until its lease ends, an
 * unrevealed commit until it is abandoned, and a set is provisional until its window closes. Between `now` and the
 * time returned, each of those reads as it did at `now`, so the state does too.
 */
export function turnsAt(state: State, now: string): string | null {
  let next: string | null = null;
  const at = (t: string | null): void => {
    if (t !== null && t > now && (next === null || t < next)) next = t;
  };
  for (const v of state.pieces) {
    for (const c of v.claims) at(c.until);
    for (const c of v.commits) if (!c.revealed) at(c.abandonAt);
    at(v.windowEnd);
  }
  return next;
}

/**
 * A fold made read-only where a reader could write to it in place: the state, its lists and every piece's view with
 * its lists, since every layer built while it holds reads the one object.
 */
function frozenFold(state: State): State {
  for (const v of [...state.pieces, ...state.ancestral.values()]) {
    for (const list of [v.claims, v.commits, v.reveals, v.runs]) Object.freeze(list);
    Object.freeze(v);
  }
  for (const list of [state.pieces, state.chain, state.dropped]) Object.freeze(list);
  return Object.freeze(state);
}

export function foldsOf(store: Store): Folds {
  const kept = new Map<Hash, Kept>();
  /** The kept entry each input `inputAt` handed out was made from. */
  const madeFrom = new WeakMap<ReduceInput, Kept>();

  /** Each version's counts while the store stands where it did when they were counted. */
  const counted = { stamp: '', of: new Map<Hash, Counts>() };

  /**
   * The key of a problem's input, from what `reduceInputOf` reads of the store: the versions of the chain, their lines,
   * their blobs not held, and the identity log's lines. A version's counts are its own added to those of the version
   * before it, so each version is counted once however many versions are built on it.
   */
  function keyOf(hash: Hash): string | null {
    const stamp = store.stamp();
    if (counted.stamp !== stamp) counted.of.clear();
    counted.stamp = stamp;
    // Down the chain to the first version already counted, then up again adding each version's own.
    const path: Hash[] = [];
    const seen = new Set<Hash>();
    let below: Counts = { versions: 0, lines: 0, missing: 0 };
    for (let cur: Hash | null = hash; cur && !seen.has(cur); ) {
      const known = counted.of.get(cur);
      if (known) {
        below = known;
        break;
      }
      seen.add(cur);
      const stored = store.getEnvelope(cur);
      if (!stored) break;
      path.push(cur);
      cur = stored.envelope.problem.prev;
    }
    if (path.length === 0 && !counted.of.has(hash)) return null;
    for (const h of path.reverse()) {
      const data = Object.values(store.getEnvelope(h)!.envelope.problem.data);
      below = {
        versions: below.versions + 1,
        lines: below.lines + store.lineCount(h),
        missing: below.missing + data.filter((b) => !store.hasBlob(b)).length,
      };
      counted.of.set(h, below);
    }
    return `${below.versions}:${below.lines}:${below.missing}:${store.lineCount(IDENTITY_LOG)}`;
  }

  /**
   * The data blobs the inputs read, each the same bytes for every version that names it and fixed (`fixedBytes`), so
   * the core checks a blob's hash once. Nothing writes to them, a data blob is never taken out of a store, and every
   * kept input holds its blobs already.
   */
  const bytes = new Map<Hash, Uint8Array>();
  const reader: ChainReader = {
    envelopeOf: (h) => store.envelopeOf(h),
    lines: (log) => store.lines(log),
    getBlob(h) {
      const known = bytes.get(h);
      if (known) return known;
      const read = store.getBlob(h);
      if (read) bytes.set(h, fixedBytes(read));
      return read;
    },
  };

  function inputAt(hash: Hash, at: string): ReduceInput | null {
    const key = keyOf(hash);
    if (key === null) return null;
    let entry = kept.get(hash);
    if (!entry || entry.key !== key) {
      const read = reduceInputOf(reader, store.getEnvelope(hash)!.envelope, at);
      Object.freeze(read.envelopes);
      Object.freeze(read.receipts);
      entry = { key, input: read, fold: null };
      kept.set(hash, entry);
    }
    const input = { ...entry.input, now: at };
    madeFrom.set(input, entry);
    return input;
  }

  function reduceKept(input: ReduceInput): State {
    const entry = madeFrom.get(input);
    if (!entry) return reduce(input);
    const f = entry.fold;
    if (f && f.from <= input.now && (f.until === null || input.now < f.until)) return f.state;
    const state = frozenFold(reduce(input));
    entry.fold = { state, from: input.now, until: turnsAt(state, input.now) };
    return state;
  }

  return { inputAt, reduce: reduceKept };
}
