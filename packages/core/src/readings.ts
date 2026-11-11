/**
 * The readings of a piece, and how each counts. docs/v2/READING.md section 3: the record says of each reading "how it
 * counts, one of: `counted`, in a set or toward one; `kept`, valid and counting for nothing, with the reason, such as
 * a root related to the owner or a second reading from one vendor; `aside`, set aside under section 4; `struck`, with
 * the decision that struck it. Nothing valid is left off the record, and a reading that does not count says why."
 *
 * Nothing is decided here. Each kind's rule made its set in `reduce.ts` and `kinds.ts`, and this file reads the fold
 * they left and says, of each reading the rule passed over, which sentence of the rule passed over it. A reading the
 * fold no longer holds is one the read set aside or struck, and the entry says which and by what decision. The
 * reasons are a closed list, `WHY`, so a second implementation says the same words.
 */
import type { Hash } from './hash.js';
import type { Address } from './keys.js';
import { DEFAULT_CANDIDATES } from './kinds.js';
import { byAtThenId } from './plain.js';
import type { PieceView, Reveal } from './reduce.js';
import { agreeFields, returnsAgree } from './schema.js';
import type { ProblemEntry } from './standing.js';

/** How a reading counts (READING.md section 3). */
export type HowCounts = 'counted' | 'kept' | 'aside' | 'struck';

/** Why a reading counts for nothing: each reason once, in the words the record says. */
export const WHY = {
  owner: 'its root is related to the owner',
  earlier: 'its root is related to the root of an earlier reading',
  member: 'its root is related to the root of a reading in the set',
  vendor: 'an earlier reading from its vendor says the same',
  vendorInSet: 'the set holds a reading from its vendor',
  differs: 'it differs from the set on an agree field',
  late: 'the set was made before it',
  without: 'the set was made without it',
  patch: 'the set was made on another patch',
  seat: "it is not from a person's seat",
  full: 'the readings the piece asks for stood before it',
  same: 'an earlier candidate gave the same return',
  candidates: 'the candidates were in before it',
  ranked: 'the panel ranked another first',
  void: 'its panel is void',
  verifier: 'its piece asks a verifier this reading does not implement',
  aside: 'it rests on nothing where another reading rests on the record',
  challenge: 'a challenge held against its set',
  gold: "the owner's gold missed its set",
  gone: 'the fold without the struck events does not hold it',
} as const;

/** One reading as the record says it. */
export interface ReadingView {
  /** The reveal's id, which names the reading. */
  id: Hash;
  /** The version the reveal names. */
  problem: Hash | null;
  key: Address;
  root: Address;
  vendor: string;
  at: string;
  counts: HowCounts;
  /** Why it counts for nothing, one of `WHY`; null where it is counted. */
  why: string | null;
  /** Where it is struck, the id of the decision that struck it: the challenge, or the owner's gold reveal. */
  by: Hash | null;
}

/**
 * A piece's readings in receipt order: every reveal the line's record holds on it, struck or not, each with how it
 * counts. The record with nothing struck and the fold without the struck events may each hold a reveal the other
 * lacks, since a reveal is matched to its key's first unrevealed commit, so the readings are both folds' by id.
 */
export function readingsOf(e: ProblemEntry, piece: Hash): ReadingView[] {
  const v = e.fold.byHash.get(piece);
  if (!v) return [];
  const all = new Map<Hash, Reveal>();
  for (const r of e.core.byHash.get(piece)?.reveals ?? []) all.set(r.id, r);
  const held = new Set<Hash>();
  for (const r of v.reveals) {
    all.set(r.id, r);
    held.add(r.id);
  }
  const whys = whyKept(e, v);
  return [...all.values()].sort(byAtThenId).map((r): ReadingView => {
    const view = { id: r.id, problem: r.problem ?? null, key: r.key, root: r.root, vendor: r.vendor, at: r.at };
    if (held.has(r.id)) {
      const why = whys.get(r.id) ?? null;
      return { ...view, counts: why === null ? 'counted' : 'kept', why, by: null };
    }
    if (e.aside.has(r.id)) return { ...view, counts: 'aside', why: WHY.aside, by: null };
    const decision = e.struckBy.get(r.id);
    if (decision) return { ...view, counts: 'struck', why: WHY[decision.kind], by: decision.id };
    return { ...view, counts: 'kept', why: WHY.gone, by: null };
  });
}

/** Of the readings the fold holds on a piece, each that counts for nothing, with why; the rest are counted. */
function whyKept(e: ProblemEntry, v: PieceView): Map<Hash, string> {
  const fold = e.fold;
  const owner = fold.envelope.problem.owner as Address;
  const ofOwner = (r: Reveal) => fold.related(r.root, owner, r.at);
  const out = new Map<Hash, string>();
  const kind = e.decided.kinds.get(v.piece.hash)?.kind ?? null;
  const set = v.accepting;

  if (kind === null) {
    for (const r of v.reveals) out.set(r.id, WHY.verifier);
  } else if (kind === 'check' || kind === 'score') {
    // A patch counts toward a set until one is made, and then the set's patch alone (CORE.md section 6).
    if (set && set.kind !== 'agree') for (const r of v.reveals) if (r.id !== set.patch.id) out.set(r.id, WHY.patch);
  } else if (kind === 'record') {
    // QX-20 section 2: the readings that stand, in receipt order, until those the piece asks for stand.
    const standing = e.decided.records.get(v.piece.hash)?.standing ?? [];
    const stands = new Set(standing.map((r) => r.id));
    const before: Reveal[] = [];
    for (const r of v.reveals) {
      if (stands.has(r.id)) before.push(r);
      else if (ofOwner(r)) out.set(r.id, WHY.owner);
      else if (before.some((s) => fold.related(s.root, r.root, r.at))) out.set(r.id, WHY.earlier);
      else out.set(r.id, WHY.full);
    }
  } else if (kind === 'attest') {
    // QX-10: the first reading from a root unrelated to the owner makes the set.
    const member = set?.kind === 'agree' ? set.reveals[0].id : null;
    for (const r of v.reveals) {
      if (r.id === member) continue;
      if (ofOwner(r)) out.set(r.id, WHY.owner);
      else if (member !== null) out.set(r.id, WHY.late);
    }
  } else if (kind === 'judge') {
    judged(e, v, ofOwner, out);
  } else {
    // agree (CORE.md section 6) and human (QX-3), which asks a person's seat where agree asks a second vendor.
    const seated = kind === 'human' ? new Set((e.decided.counted.get(v.piece.hash) ?? []).map((r) => r.id)) : null;
    const schema = v.piece.schema;
    const fields = schema ? agreeFields(schema, v.piece.agree) : [];
    const agrees = (a: Reveal, b: Reveal) => schema !== undefined && returnsAgree(schema, fields, a.return, b.return);
    const members: Reveal[] = set?.kind === 'agree' ? [...set.reveals] : [];
    const last = members.length ? v.reveals.findIndex((r) => r.id === members[members.length - 1]!.id) : -1;
    v.reveals.forEach((r, at) => {
      if (members.some((m) => m.id === r.id)) return;
      if (ofOwner(r)) out.set(r.id, WHY.owner);
      else if (seated && !seated.has(r.id)) out.set(r.id, WHY.seat);
      else if (members.length) {
        if (at > last) out.set(r.id, WHY.late);
        else if (!agrees(r, members[0]!)) out.set(r.id, WHY.differs);
        else if (!seated && members.some((m) => m.vendor === r.vendor)) out.set(r.id, WHY.vendorInSet);
        else if (members.some((m) => fold.related(m.root, r.root, r.at))) out.set(r.id, WHY.member);
        else out.set(r.id, WHY.without);
      } else if (!seated) {
        // "Two that agree but share a vendor are not one; the second is kept as evidence" (CORE.md section 6).
        const earlier = v.reveals.slice(0, at).filter((a) => !ofOwner(a));
        if (earlier.some((a) => a.vendor === r.vendor && agrees(a, r))) out.set(r.id, WHY.vendor);
      }
    });
  }
  return out;
}

/**
 * A judge piece (QX-2): the candidates are the first the piece asks for from roots unrelated to the owner and to
 * each other, with distinct returns, and a panel's majority ranks one of them first.
 */
function judged(e: ProblemEntry, v: PieceView, ofOwner: (r: Reveal) => boolean, out: Map<Hash, string>): void {
  const fold = e.fold;
  const panel = e.decided.byPiece.get(v.piece.hash) ?? null;
  const wanted = panel?.wanted ?? v.piece.candidates ?? DEFAULT_CANDIDATES;
  const chosen: Reveal[] = [];
  for (const r of v.reveals) {
    if (ofOwner(r)) out.set(r.id, WHY.owner);
    else if (chosen.length >= wanted) out.set(r.id, WHY.candidates);
    else if (chosen.some((c) => c.digest === r.digest)) out.set(r.id, WHY.same);
    else if (chosen.some((c) => fold.related(c.root, r.root, r.at))) out.set(r.id, WHY.earlier);
    else chosen.push(r);
  }
  if (!panel || panel.outcome === 'open') return;
  for (const c of chosen) {
    if (panel.outcome === 'void') out.set(c.id, WHY.void);
    else if (c.digest !== panel.winner) out.set(c.id, WHY.ranked);
  }
}
