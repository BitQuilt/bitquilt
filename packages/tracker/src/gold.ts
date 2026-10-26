/**
 * Gold pieces, extension QX-16 (docs/ext/QX-16.md): the pure rules, with no HTTP in them. An owner commits by hash to
 * the agreed fields of some answers before the work, backed by a stake of standing; after a piece is accepted the owner
 * reveals; a set that agrees with the gold is verified, a set that differs is struck. The lifecycle is folded in
 * challenge.ts beside the challenge window, since a miss strikes as a held challenge does and a challenge can undo it;
 * this module holds what each rule says.
 */
import { type Address, type Hash, type PieceView, type Return, NONCE_RE, agreeFields, isHash, returnsAgree } from '@bitquilt/core';

export const GOLD = 'QX-16';
export const GOLD_EVENTS: ReadonlySet<string> = new Set(['gold', 'gold_reveal']);
export type GoldOutcome = 'pending' | 'match' | 'miss' | 'overruled' | 'lapsed' | 'dropped';
/** What a piece's gold is to a reader: nothing kept, or where it stands. */
export type GoldState = Exclude<GoldOutcome, 'dropped'> | null;

/** One commitment of a gold event, as the layer keeps it. */
export interface GoldCommitment {
  piece: Hash;
  name: string;
  h: Hash;
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const MACHINE: ReadonlySet<string> = new Set(['check', 'score']);

/** Why this is not a well-formed gold body, or nothing. Whether the pieces exist is the layer's question. */
export function goldBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  const c = body.commitments;
  if (!isRecord(c) || Object.keys(c).length === 0) out.push('body.commitments: piece hashes to commitment hashes, at least one');
  else for (const [k, v] of Object.entries(c)) if (!isHash(k) || !isHash(v)) out.push('body.commitments: piece hashes to commitment hashes');
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

/** A piece's share of the owner's stake: its stake under the rule in force, or 1 where none is asked. */
export function goldShare(asked: number): number {
  return Math.max(1, asked);
}

/** Whether every reveal of the piece's accepting set agrees with the projection on the agreed fields, as the core compares two returns. */
export function goldMatches(view: PieceView, projection: Return): boolean {
  const set = view.accepting;
  if (!set || set.kind !== 'agree' || !view.piece.schema) return false;
  const fields = agreeFields(view.piece.schema, view.piece.agree);
  return set.reveals.every((r) => returnsAgree(view.piece.schema!, fields, projection, r.return));
}

/** When the piece's first production event was received, or null with none: a commitment is kept only before it. */
export function firstProductionAt(view: PieceView): string | null {
  const times = [...view.claims, ...view.commits, ...view.reveals, ...view.runs].map((x) => x.at).sort();
  return times[0] ?? null;
}
