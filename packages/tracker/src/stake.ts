/**
 * Stake at the door, extension QX-15 (docs/ext/QX-15.md): the pure rules, with no HTTP in them. A problem's owner
 * may ask that work on its pieces be backed by a stake; a root backs its work by locking standing before it claims;
 * the lock is released when the work is over without a strike and forfeited with the set a held challenge strikes.
 * The lifecycle is folded in challenge.ts beside standing, since locked and free standing are functions of the whole
 * store and a strike there is a forfeit here; this module holds what each rule says.
 */
import type { Address, Hash, Piece, PieceView } from '@bitquilt/core';

export const STAKE = 'QX-15';
export const STAKE_EVENTS: ReadonlySet<string> = new Set(['stake_rule', 'lock']);
/** The events a lock backs on a staked piece. */
export const PRODUCTION_EVENTS: ReadonlySet<string> = new Set(['claim', 'commit', 'reveal', 'run']);
export const LOCK_KINDS = ['standing', 'coin'] as const;
export type LockKind = (typeof LOCK_KINDS)[number];

/** A stake rule as the layer keeps it: the latest valid one at a time is the rule in force. */
export interface StakeRule { id: Hash; root: Address; at: string; min: number; pieces: string[] | null }

/**
 * A lock as the layer keeps it: of standing, or of coin on the coin log (QX-17) that the door vouched for. Its release
 * is computed from the fold; a strike sets `forfeitedAt`, and a held challenge on a gold miss (QX-16) sets `restoredAt`.
 */
export interface LockView {
  id: Hash;
  problem: Hash;
  piece: Hash;
  name: string;
  key: Address;
  root: Address;
  at: string;
  kind: LockKind;
  /** The stake in standing; for a coin lock, what the coin backs. */
  amount: number;
  /** The coin-log lock a coin-kind lock names, or null. */
  coinId: Hash | null;
  forfeitedAt: string | null;
  restoredAt: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const plusHours = (t: string, h: number): string => new Date(Date.parse(t) + h * 3_600_000).toISOString();

/** Why this is not a well-formed stake_rule body, or nothing. Whether the names exist is the layer's question. */
export function stakeRuleBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!Number.isInteger(body.min) || (body.min as number) < 0) out.push('body.min: a whole number from 0');
  if (body.pieces !== undefined) {
    const p = body.pieces;
    if (!Array.isArray(p) || p.length === 0 || !p.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 64)) out.push('body.pieces: a list of family or piece names');
    else if (new Set(p).size !== p.length) out.push('body.pieces: each name once');
  }
  for (const k of Object.keys(body)) if (k !== 'min' && k !== 'pieces') out.push(`body.${k}: not a field of a stake rule`);
  return out;
}

/** Why this is not a well-formed lock body, or nothing. */
export function lockBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!(LOCK_KINDS as readonly string[]).includes(body.kind as string)) out.push(`body.kind: one of ${LOCK_KINDS.join(', ')}`);
  if (!Number.isInteger(body.amount) || (body.amount as number) < 1) out.push('body.amount: a whole number of at least 1');
  const allowed = body.kind === 'coin' ? ['kind', 'amount', 'id'] : ['kind', 'amount'];
  if (body.kind === 'coin' && typeof body.id !== 'string') out.push('body.id: the id of the lock on the coin log');
  for (const k of Object.keys(body)) if (!allowed.includes(k)) out.push(`body.${k}: not a field of a lock`);
  return out;
}

/** The names a rule's `pieces` may use: every family and every piece name of the problem. */
export function ruleNames(pieces: Piece[]): Set<string> {
  const names = new Set<string>();
  for (const p of pieces) {
    names.add(p.family);
    names.add(p.name);
  }
  return names;
}

/** What a piece asks under a rule: the rule's `min` where it covers the piece, 0 otherwise or with no rule. */
export function stakeAsked(rule: StakeRule | null, piece: Piece): number {
  if (!rule) return 0;
  if (rule.pieces === null) return rule.min;
  return rule.pieces.includes(piece.family) || rule.pieces.includes(piece.name) ? rule.min : 0;
}

/**
 * When a lock is released, read from the fold at the time of asking, or null while it is live: the lock's receipt plus
 * the lease when the root produced nothing on the piece by then; else when the piece's window has closed, the root's
 * claim ran out with no commit by it, or the root's commit was abandoned unrevealed. A forfeit is not decided here.
 */
export function lockReleasedAt(lock: LockView, view: PieceView, leaseH: number, related: (a: Address, b: Address, at: string) => boolean, now: string): string | null {
  const mine = (root: Address, at: string) => related(root, lock.root, at);
  const claims = view.claims.filter((c) => c.at >= lock.at && mine(c.root, c.at));
  const commits = view.commits.filter((c) => c.at >= lock.at && mine(c.root, c.at));
  const reveals = view.reveals.filter((r) => r.at >= lock.at && mine(r.root, r.at));
  const runs = view.runs.filter((r) => r.at >= lock.at && mine(r.root, r.at));
  const idle = plusHours(lock.at, leaseH);
  const firstAt = [...claims, ...commits, ...reveals, ...runs].map((x) => x.at).sort()[0];
  if (firstAt === undefined || firstAt >= idle) return idle <= now ? idle : null;
  // The piece is final: whoever is in the set, nothing on it can be struck any more.
  if (view.accepting && view.windowEnd !== null && view.windowEnd <= now) return view.windowEnd;
  if (reveals.length || runs.length) return null;
  if (commits.length) {
    const abandoned = commits.every((c) => !c.revealed && c.abandonAt <= now);
    return abandoned ? commits.map((c) => c.abandonAt).sort().reverse()[0]! : null;
  }
  const ranOut = claims.every((c) => c.until <= now);
  return ranOut ? claims.map((c) => c.until).sort().reverse()[0]! : null;
}
