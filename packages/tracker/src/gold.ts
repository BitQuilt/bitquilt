/**
 * Gold pieces, extension QX-16 (docs/ext/QX-16.md): the pure rules, with no HTTP in them. An owner commits by hash to
 * the agreed fields of some answers before the work, each commitment binding the piece and the answer together, so the
 * ledger shows how many commitments there are and not which pieces they are on; the stake is standing. After a piece
 * is accepted the owner reveals, naming the piece; a set that agrees with the gold is verified, a set that differs is
 * struck. The lifecycle is folded in challenge.ts beside the challenge window, since a miss strikes as a held challenge
 * does and a challenge can undo it; this module holds what each rule says.
 */
import { type Address, type Hash, type PieceView, type Return, NONCE_RE, agreeFields, commitHash, isHash, returnsAgree } from '@bitquilt/core';

export const GOLD = 'QX-16';
export const GOLD_EVENTS: ReadonlySet<string> = new Set(['gold', 'gold_reveal']);
export type GoldOutcome = 'pending' | 'match' | 'miss' | 'overruled' | 'lapsed' | 'dropped';
/** What a piece's gold is to a reader: nothing revealed on it, or where it stands. */
export type GoldState = Exclude<GoldOutcome, 'dropped' | 'pending'> | null;

/** One commitment of a gold event, as the layer keeps it: blind until the reveal names the piece. */
export interface GoldCommitment {
  h: Hash;
  /** The piece, known from the reveal; null while the commitment is pending. */
  piece: Hash | null;
  name: string | null;
  outcome: GoldOutcome;
  revealedAt: string | null;
  projection: Return | null;
  /** The ids of the set's events a miss struck. */
  struck: Hash[];
  /** The roots of the set a miss struck. */
  struckRoots: Address[];
}

export interface GoldView {
  id: Hash;
  problem: Hash;
  key: Address;
  root: Address;
  at: string;
  stake: number;
  commitments: GoldCommitment[];
  forfeitedAt: string | null;
}

/** A problem's gold as a reader sums it: how many commitments, and how each stands. */
export interface GoldCount { committed: number; pending: number; verified: number; missed: number; overruled: number; lapsed: number }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const MACHINE: ReadonlySet<string> = new Set(['check', 'score']);

/** The commitment: the core's commit recipe over the piece's hash and the projection together, with the nonce. */
export function goldCommitHash(piece: Hash, projection: Return, nonce: string): Hash {
  return commitHash({ piece, projection }, nonce);
}

/** Why this is not a well-formed gold body, or nothing. Whether the stake covers the shares is the layer's question. */
export function goldBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  const c = body.commitments;
  if (!Array.isArray(c) || c.length === 0) out.push('body.commitments: a list of commitment hashes, at least one');
  else if (!c.every((h) => isHash(h))) out.push('body.commitments: a list of commitment hashes');
  else if (new Set(c).size !== c.length) out.push('body.commitments: each once');
  if (!Number.isInteger(body.stake) || (body.stake as number) < 1) out.push('body.stake: a whole number of at least 1');
  for (const k of Object.keys(body)) if (k !== 'commitments' && k !== 'stake') out.push(`body.${k}: not a field of a gold`);
  return out;
}

/** Why this is not a well-formed gold_reveal body, or nothing. */
export function goldRevealBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!isRecord(body.projection)) out.push('body.projection: an object');
  if (typeof body.nonce !== 'string' || !NONCE_RE.test(body.nonce)) out.push('body.nonce: 32 hex characters');
  for (const k of Object.keys(body)) if (k !== 'projection' && k !== 'nonce') out.push(`body.${k}: not a field of a gold reveal`);
  return out;
}

/** Whether a piece's return has agreed fields: a schema, and a verifier that is not a machine. */
export function hasAgreedFields(view: PieceView): boolean {
  return view.piece.schema !== undefined && !MACHINE.has(view.piece.verifier);
}

/**
 * The roots a strike of the piece's accepting set would dock: two for a piece whose set is two reveals (agree, human,
 * judge), counted as one for an attest piece, whose set is the actor's own word and credits nobody.
 */
export function goldDocked(verifier: string): number {
  return verifier === 'attest' ? 1 : 2;
}

/**
 * A piece's share of the owner's stake: for each root a strike would dock, its stake under the rule in force, or 1 where
 * none is asked. Where no stake is asked an agree piece's share is 2, what a miss takes from the two roots it docks
 * (amended 27 October 2026; it was 1 a piece).
 */
export function goldShare(view: PieceView, asked: number): number {
  return goldDocked(view.piece.verifier) * Math.max(1, asked);
}

/**
 * What one blind commitment costs the owner: the largest share among the pieces a gold can be on, since the ledger
 * cannot tell which piece a commitment names until the reveal; 0 where the problem has no such piece.
 */
export function goldShareMax(views: PieceView[], asked: (view: PieceView) => number): number {
  let max = 0;
  for (const v of views) if (hasAgreedFields(v)) max = Math.max(max, goldShare(v, asked(v)));
  return max;
}

/** Whether every reveal of the piece's accepting set agrees with the projection on the agreed fields, as the core compares two returns. */
export function goldMatches(view: PieceView, projection: Return): boolean {
  const set = view.accepting;
  if (!set || set.kind !== 'agree' || !view.piece.schema) return false;
  const fields = agreeFields(view.piece.schema, view.piece.agree);
  return set.reveals.every((r) => returnsAgree(view.piece.schema!, fields, projection, r.return));
}

/** When the piece's first production event was received, or null with none: a commitment counts only on a piece worked after it. */
export function firstProductionAt(view: PieceView): string | null {
  const times = [...view.claims, ...view.commits, ...view.reveals, ...view.runs].map((x) => x.at).sort();
  return times[0] ?? null;
}

/** A problem's gold summed for a reader: every commitment of every gold not dropped, by outcome as `outcomeOf` reads it. */
export function goldCount(golds: GoldView[], outcomeOf: (g: GoldView, c: GoldCommitment) => GoldOutcome): GoldCount {
  const n: GoldCount = { committed: 0, pending: 0, verified: 0, missed: 0, overruled: 0, lapsed: 0 };
  for (const g of golds) for (const c of g.commitments) {
    const o = outcomeOf(g, c);
    if (o === 'dropped') continue;
    n.committed++;
    if (o === 'pending') n.pending++;
    else if (o === 'match') n.verified++;
    else if (o === 'miss') n.missed++;
    else if (o === 'overruled') n.overruled++;
    else if (o === 'lapsed') n.lapsed++;
  }
  return n;
}
