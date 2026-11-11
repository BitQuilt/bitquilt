/**
 * The line, and its record (docs/v2/READING.md sections 2 and 3). "A line is the versions of one problem under one
 * owner: two problems are of one line where their chains along `prev` share a version", and "A line has one expansion,
 * every piece any of its versions holds". "For each line and each piece of it, the record is every event that names
 * the piece and a version of the line", so an older version's map shows work posted to a later version on a piece it
 * keeps, and two versions made from the same one share a record. Version 1's reducer reads a version with the
 * versions before it; `linesOf` finds what the rest of the line adds to that, and `reduceLine` is the reducer's three
 * steps over it: the version's own chain checked, the line's record folded onto the line's pieces, and the version's
 * pieces settled.
 *
 * "The lease and the window an event is held to are those of the version it names" (READING.md section 3): a claim
 * and a commit are held to the lease of the version each names, a patch to that version's size, and a set's window is
 * that of the version the event that completed it names, so a claim, a commit and a set end at one time at every
 * version of the line. Version 1 holds each to the settings of the version read. A version whose line holds nothing
 * beside its own chain, every version of it with one lease, one window and one size of patch, is reduced as version 1
 * reduces it.
 */
import { type Blobs, type Envelope, type Settings, expandPieces } from './envelope.js';
import type { Receipt } from './events.js';
import type { Hash } from './hash.js';
import { type PieceView, type ReduceInput, type State, checkChain, emptyView, fold, reduce, settle } from './reduce.js';

/** A version a reader holds: what the reducer takes for it, and version 1's fold of its own chain. */
export interface Held {
  input: ReduceInput;
  own: State;
}

/** A version with the rest of its line, as far as the reader holds it. */
export interface Line {
  /** The version read: its envelopes, its blobs and the time. */
  input: ReduceInput;
  /** The inputs of the other versions that add a version this one's chain lacks, in the order of their hashes. */
  others: ReduceInput[];
  /** Each version of the line this one's chain does not hold, with the blobs its pieces are read from. */
  beside: { hash: Hash; envelope: Envelope; blobs: Blobs }[];
  /** Every version of the line: this one's chain, and those beside it. */
  versions: ReadonlySet<Hash>;
  /** Each version's settings, which an event that names the version is held to. */
  settings: ReadonlyMap<Hash, Settings>;
  /**
   * Whether version 1's fold of the version's own chain is its fold over the line: nothing beside the chain, and one
   * lease, one window and one size of patch across it.
   */
  plain: boolean;
  /** The line's record: this version's receipts, and of each other version's those that name a version beside. */
  receipts: Receipt[];
}

/**
 * The versions of a fold's chain, its own first, each with its envelope. The last envelope's own `prev` is left out:
 * the chain stopped there, at an envelope the reader does not hold or one by another owner, and that is no version of
 * this line.
 */
function versionsOf(own: State): { hash: Hash; envelope: Envelope }[] {
  return own.chain.map((envelope, i) => ({ hash: i === 0 ? own.problem : own.chain[i - 1]!.problem.prev!, envelope }));
}

/** Whether two versions hold an event alike: one lease, one window and one size of patch. */
function heldAlike(a: Settings, b: Settings): boolean {
  return a.lease_h === b.lease_h && a.challenge_window_h === b.challenge_window_h && a.patch_max === b.patch_max;
}

/**
 * Each held version's line. READING.md section 2: "two problems are of one line where their chains along `prev` share
 * a version". A fork names its source in `from` and holds no version of it in its chain, so it begins a line of its
 * own. The other versions are taken in the order of their hashes, and each adds the versions no version before it
 * had, with the events that name them, so every event of the line is in the record once.
 */
export function linesOf(held: Held[]): Map<Hash, Line> {
  const chains = new Map<Held, { hash: Hash; envelope: Envelope }[]>();
  const holders = new Map<Hash, Held[]>();
  for (const h of held) {
    const chain = versionsOf(h.own);
    chains.set(h, chain);
    for (const v of chain) holders.set(v.hash, [...(holders.get(v.hash) ?? []), h]);
  }
  const lines = new Map<Hash, Line>();
  for (const h of held) {
    const chain = chains.get(h)!;
    const versions = new Set(chain.map((v) => v.hash));
    const settings = new Map(chain.map((v) => [v.hash, v.envelope.problem.settings] as const));
    const mates = new Set<Held>();
    for (const v of chain) for (const m of holders.get(v.hash)!) if (m !== h) mates.add(m);
    const others: ReduceInput[] = [];
    const beside: Line['beside'] = [];
    let receipts = h.input.receipts;
    for (const m of [...mates].sort((a, b) => (a.own.problem < b.own.problem ? -1 : 1))) {
      const fresh = chains.get(m)!.filter((v) => !versions.has(v.hash));
      if (fresh.length === 0) continue;
      const names = new Set(fresh.map((v) => v.hash));
      others.push(m.input);
      for (const v of fresh) {
        versions.add(v.hash);
        settings.set(v.hash, v.envelope.problem.settings);
        beside.push({ ...v, blobs: m.input.blobs });
      }
      if (receipts === h.input.receipts) receipts = [...receipts];
      for (const r of m.input.receipts) if (r.event.problem && names.has(r.event.problem)) receipts.push(r);
    }
    const head = chain[0]!.envelope.problem.settings;
    const plain = beside.length === 0 && chain.every((v) => heldAlike(v.envelope.problem.settings, head));
    lines.set(h.own.problem, { input: h.input, others, beside, versions, settings, plain, receipts });
  }
  return lines;
}

/**
 * The reducer over a line (READING.md section 3): the version's own chain checked as CORE.md section 6 checks it, the
 * line's record folded in that section's order onto every piece the line holds, and the version's own pieces settled,
 * "each with the line's record of it" (READING.md section 2). A piece only another version holds is kept apart as an
 * ancestor's dropped piece is: no piece of this version, its events folded and counted toward weights. Each event is
 * held to the settings of the version it names. `receipts` is the line's record, or what is left of it once a strike
 * took events out.
 */
export function reduceLine(line: Line, receipts: Receipt[] = line.receipts): State {
  const p = line.input;
  if (line.plain) return reduce({ ...p, receipts });
  const checked = checkChain(p.envelopes, p.blobs);
  const pieces = expandPieces(checked.envelope.problem, p.blobs);
  const views = new Map<Hash, PieceView>();
  for (const piece of pieces) views.set(piece.hash, emptyView(piece));
  const apart = new Map<Hash, PieceView>();
  const keepApart = (envelope: Envelope, blobs: Blobs): void => {
    for (const piece of expandPieces(envelope.problem, blobs))
      if (!views.has(piece.hash) && !apart.has(piece.hash)) apart.set(piece.hash, emptyView(piece));
  };
  for (const env of checked.chain.slice(1)) keepApart(env, p.blobs);
  for (const b of line.beside) keepApart(b.envelope, b.blobs);
  // Every event folded names a version of the line, so each has its settings.
  const settingsOf = (problem: Hash): Settings => line.settings.get(problem) ?? checked.envelope.problem.settings;
  const folded = fold(receipts, views, apart, new Set(line.versions), settingsOf);
  return settle(checked, pieces, views, apart, folded, p.now, settingsOf);
}
