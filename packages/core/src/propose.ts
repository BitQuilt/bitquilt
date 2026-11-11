/**
 * QX-22, proposed pieces: a pattern is written before the work, and the work finds what the pattern missed, so any key
 * may put one piece beside a problem with a signed `propose` event on the problem's log. This file holds the body's
 * shape, the hash a proposed piece has in any envelope that takes it under its name, the proposals that stand on a
 * chain, and what the tracker says of each: whether its proposer's work stands on the problem, the version that took
 * it, and the forks that pursue it. Proposals stand as a record: nothing here accepts one or strikes one, and the
 * reducer never sees the event. The door's check is `checkProposeEvent` in the tracker's admit.ts, and the read is
 * `proposalsOf` in its views.ts. Moved here from the tracker's layer as docs/history/V2-PLAN.md, phase 3, says.
 */
import { canonicalBytes } from './canonical.js';
import { type PieceDef, type Problem, SLUG_RULE, expandPieces, isSlug } from './envelope.js';
import { type Receipt, eventSignedByKey } from './events.js';
import { plainTextProblems } from './gate.js';
import type { Hash } from './hash.js';
import type { Address } from './keys.js';
import { isRecord } from './plain.js';
import { orderReceipts } from './reduce.js';
import { acceptingRoots } from './standing.js';
import type { LayerViews, ProblemLayer } from './layer.js';

export const PROPOSE = 'QX-22';

/**
 * The types QX-22 adds to a problem's log. The tracker's door admits each through its own row of `problemDoor`, and
 * its admit.test.ts holds those rows to this set.
 */
export const PROPOSE_EVENTS: ReadonlySet<string> = new Set(['propose']);

/** QX-22 section 1: "`why` is the proposer's reason, text of at most 500 characters through the plain-text gate." */
export const PROPOSE_WHY_MAX = 500;

/** QX-22 section 1: "`piece` is at most 16,384 bytes as canonical JSON." */
export const PROPOSED_MAX = 16_384;

/**
 * Why this is not a well-formed propose body, or nothing (QX-22 section 1). The piece's own rules are the envelope's,
 * which the door asks of the version that would take it; here are the rules a proposal adds: one piece under a slug,
 * no family and no data, of a bounded size, with a reason, and the gate on the two texts a person reads. "A proposed
 * piece does not wait on itself": no piece of the version waits on a name the version does not have, so that is the
 * one cycle a proposal could make, and the core keeps a cycle of inputs locked.
 */
export function proposeBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!isSlug(body.name)) out.push(`body.name: ${SLUG_RULE}`);
  const piece = body.piece;
  if (!isRecord(piece)) out.push('body.piece: an object');
  else {
    if (piece.count !== undefined) out.push('body.piece.count: a proposal is one piece and has no count');
    if (piece.data !== undefined) out.push('body.piece.data: a proposed piece draws on no data');
    if (sizeOf(piece) > PROPOSED_MAX) out.push(`body.piece: at most ${PROPOSED_MAX} bytes as canonical JSON`);
    if (Array.isArray(piece.inputs) && piece.inputs.includes(body.name))
      out.push('body.piece.inputs: a proposed piece does not wait on itself');
    if (typeof piece.brief === 'string') out.push(...plainTextProblems(piece.brief, 'body.piece.brief'));
  }
  if (typeof body.why !== 'string' || !body.why.trim() || body.why.length > PROPOSE_WHY_MAX)
    out.push(`body.why: text of at most ${PROPOSE_WHY_MAX} characters`);
  else out.push(...plainTextProblems(body.why, 'body.why'));
  for (const k of Object.keys(body))
    if (!['name', 'piece', 'why'].includes(k)) out.push(`body.${k}: not a field of a proposal`);
  return out;
}

/** A value's size as canonical JSON, and past any bound where it has no canonical form. */
function sizeOf(value: unknown): number {
  try {
    return canonicalBytes(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * QX-22 section 1: "A proposed piece is named by the hash it has in any envelope that takes it under its name." A
 * single piece's hash reads its name and its own fields and nothing of the problem around it (CORE.md section 3), so
 * it is had from the body alone; null where the piece cannot be expanded.
 */
export function proposedHash(name: string, piece: PieceDef): Hash | null {
  try {
    const alone = { pieces: { [name]: piece }, data: {} } as unknown as Problem;
    return expandPieces(alone, new Map())[0]?.hash ?? null;
  } catch {
    return null;
  }
}

/** A proposal that stands on a problem's chain. */
export interface Proposal {
  /** The propose event's id. */
  id: Hash;
  /** The version of the problem the event names. */
  under: Hash;
  name: string;
  /** The hash the piece has in any envelope that takes it under this name. */
  hash: Hash;
  piece: PieceDef;
  why: string;
  key: Address;
  /** The root the key counted for when the proposal was received. */
  root: Address;
  at: string;
}

/**
 * QX-22 section 2: "The proposals that stand on a problem are the well-formed `propose` events on its chain, in
 * receipt order. Of several proposals of one piece by one root, the first stands and the rest are passed over." Two
 * roots that propose one piece are two proposals, and two pieces under one name stand side by side. Well-formed is
 * the body's shape and the signature of the event's own key, so a reader of a chain it did not admit, a clone or a
 * peer's lines, counts the same proposals as the door that took them.
 */
export function standingProposals(
  receipts: Receipt[],
  rootOf: (key: Address, at: string) => Address,
  now: string,
): Proposal[] {
  const out: Proposal[] = [];
  const seen = new Set<string>();
  const received = receipts.filter((r) => r.event.type === 'propose' && r.received.length > 0);
  for (const { receipt, at, id } of orderReceipts(received)) {
    const e = receipt.event;
    if (at > now || !e.problem || e.piece !== undefined || proposeBodyProblems(e.body).length) continue;
    if (!eventSignedByKey(e)) continue;
    const { name, piece, why } = e.body as { name: string; piece: PieceDef; why: string };
    const hash = proposedHash(name, piece);
    if (!hash) continue;
    const root = rootOf(e.key, at);
    const once = `${root.toLowerCase()} ${hash}`;
    if (seen.has(once)) continue;
    seen.add(once);
    out.push({ id, under: e.problem, name, hash, piece, why, key: e.key, root, at });
  }
  return out;
}

/** A standing proposal as the tracker lists it (QX-22 section 3). */
export interface ProposalView extends Proposal {
  /** The name the proposer's root chose, as the problem's fold has it, or null. */
  proposer: string | null;
  /** Whether the proposer's root has work standing on the problem at the version read. */
  worked: boolean;
  /** The first version after the one the proposal names, up to the version read, that holds the piece; else null. */
  taken: Hash | null;
  /** The forks of this line, as this tracker lists them, that hold the piece. */
  pursued: Hash[];
}

/**
 * QX-22 section 3: what the tracker says of each standing proposal at the version read. `worked`: "a root of an
 * accepting set on a piece of the problem or of an ancestor, or of a reading that stands on a record piece". `taken`:
 * "the first version after the one the proposal names, up to the version read, whose envelope holds a piece of that
 * hash". `pursued`: "the forks of a version of the line, as this tracker lists them, whose envelopes hold a piece of
 * that hash". "A fork of the line is a problem another owner published with `from` naming a version of the line, and
 * each later version of that fork", so a fork is found over its own chain and its head is the one listed. Each of
 * the three is the tracker's reading of what it holds, and the proposal itself is the signed event.
 */
export function proposalsIn(
  pl: ProblemLayer,
  layered: LayerViews,
  listed: (problem: Hash) => boolean,
  nameOf: (root: string) => string | null,
): ProposalView[] {
  const standing = standingProposals(pl.receipts, pl.fold.rootOf, layered.now);
  if (!standing.length) return [];

  // The line from its root to the version read: this version's hash, each `prev` behind it, then turned around.
  const line: Hash[] = [pl.problem];
  for (const e of pl.fold.chain) if (e.problem.prev) line.push(e.problem.prev);
  line.reverse();
  const holds = (version: Hash, piece: Hash): boolean => layered.problems.get(version)?.fold.byHash.has(piece) ?? false;

  const workers = new Set<string>();
  for (const v of [...pl.fold.byHash.values(), ...pl.fold.ancestral.values()])
    for (const root of acceptingRoots(v)) workers.add(root.toLowerCase());
  for (const l of pl.pieces) for (const r of l.record?.standing ?? []) workers.add(r.root.toLowerCase());

  const versions = new Set(line);
  const forks: ProblemLayer[] = [];
  for (const f of layered.problems.values()) {
    if (versions.has(f.problem)) continue;
    const forked = f.fold.chain.some((e) => e.problem.from !== null && versions.has(e.problem.from));
    if (forked && listed(f.problem)) forks.push(f);
  }

  // A proposal names a version of the line, since the receipts read are the line's record. One that names a version
  // this one's chain does not hold is shown with no take: a take is read along the chain, up to the version read.
  const after = (under: Hash): Hash[] => (line.includes(under) ? line.slice(line.indexOf(under) + 1) : []);

  return standing.map((p) => ({
    ...p,
    proposer: nameOf(p.root),
    worked: workers.has(p.root.toLowerCase()),
    taken: after(p.under).find((v) => holds(v, p.hash)) ?? null,
    pursued: forks
      .filter((f) => f.fold.byHash.has(p.hash))
      .map((f) => f.problem)
      .sort(),
  }));
}
