/**
 * Stake at the door, extension QX-15 (docs/ext/QX-15.md): the pure rules, with no HTTP in them. A problem's owner
 * may ask that work on its pieces be backed by a stake; a root backs its work by locking standing before it claims;
 * the lock is released when the work is over without a strike and forfeited with the set a held challenge strikes.
 * This module holds what each rule says (the bodies, the names a rule may use, what a piece asks, when a lock is
 * released) and the lifecycle challengeLayer runs over the record it folds into: the rules kept in receipt order
 * (section 1), whether a lock is live at a time (section 3), and whether a lock would be kept (section 1). Locked and
 * free standing are read from that record (standing.ts), since they are functions of the whole store, and a strike
 * (challenge.ts) is a forfeit here.
 */
import { type Address, type Hash, type Piece, type PieceView, eventSignedByKey, isRecord, orderReceipts, plusHours } from '@bitquilt/core';
import { leaseOf, ownerOf, rootFor } from './verifiers.js';
import type { Folding, ProblemEntry } from './standing.js';

export const STAKE = 'QX-15';
export const STAKE_EVENTS: ReadonlySet<string> = new Set(['stake_rule', 'lock']);
/** The events a lock backs on a staked piece. */
export const PRODUCTION_EVENTS: ReadonlySet<string> = new Set(['claim', 'commit', 'reveal', 'run']);
export const LOCK_KINDS = ['standing', 'coin'] as const;
export type LockKind = (typeof LOCK_KINDS)[number];

/** A stake rule as the layer keeps it: the latest valid one at a time is the rule in force. */
export interface StakeRule { id: Hash; root: Address; at: string; min: number; pieces: string[] | null }

/** What the door wrote into a coin-kind lock's receipt (QX-17 section 5): the coin lock it read, and where. */
export interface CoinLockWord { kind: 'coin'; amount: number; id: Hash; units: number; home: string }

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

// The lifecycle over the layer's record, in the order challengeLayer runs it.

/** Why a stake rule would not be kept at `at` (section 1): malformed, not the owner's, or naming a piece the problem does not have; null when it would. */
export function ruleProblem(home: ProblemEntry, key: Address, body: Record<string, unknown>, at: string): string | null {
  const shape = stakeRuleBodyProblems(body);
  if (shape.length) return shape[0]!;
  const root = rootFor(home.fold, key, 'stake_rule', at);
  if (!root || root !== ownerOf(home.fold, at)) return 'the owner alone sets a stake rule';
  const names = ruleNames(home.fold.pieces.map((v) => v.piece));
  const pieces = body.pieces as string[] | undefined;
  if (pieces && !pieces.every((n) => names.has(n))) return 'names a piece or family this problem does not have';
  return null;
}

/** Keeps each problem's stake rules in receipt order (section 1), dropping the rest with the reason; the latest kept at a time is the rule in force. */
export function keepStakeRules(f: Folding): void {
  for (const e of f.entries.values()) for (const { receipt, at, id } of orderReceipts(e.input.receipts)) {
    const ev = receipt.event;
    if (ev.type !== 'stake_rule' || ev.problem !== e.hash) continue;
    if (e.rules.some((r) => r.id === id)) continue;
    if (!eventSignedByKey(ev)) {
      e.dropped.push({ id, type: 'stake_rule', why: 'signature is not the key\'s' });
      continue;
    }
    const why = ruleProblem(e, ev.key, ev.body, at);
    if (why) {
      e.dropped.push({ id, type: 'stake_rule', why });
      continue;
    }
    e.rules.push({ id, root: ev.key, at, min: ev.body.min as number, pieces: (ev.body.pieces as string[] | undefined) ?? null });
  }
}

/** The rule in force at a time: the latest kept at or before it, or null. */
export function ruleAt(home: ProblemEntry, at: string): StakeRule | null {
  let found: StakeRule | null = null;
  for (const r of home.rules) if (r.at <= at) found = r;
  return found;
}

/** When the fold releases a lock, read at `f.now`, or null while it would be live; a forfeit and its undoing are judged in `liveAt`. */
export function lockEnd(f: Folding, l: LockView): string | null {
  const home = f.entries.get(l.problem);
  const view = home?.fold.byHash.get(l.piece);
  if (!home || !view) return l.at;
  return lockReleasedAt(l, view, leaseOf(home.fold, view), home.fold.related, f.now);
}

/** Whether a lock is live at `at` (section 3): received by then, not forfeited then unless restored since, and not yet released. */
export function liveAt(f: Folding, l: LockView, at: string): boolean {
  if (l.at > at) return false;
  if (l.forfeitedAt !== null && at >= l.forfeitedAt && (l.restoredAt === null || at < l.restoredAt)) return false;
  const end = lockEnd(f, l);
  return end === null || end > at;
}

/** Whether the root holds a live lock on the piece at `at`. */
export function hasLock(f: Folding, home: ProblemEntry, piece: Hash, root: Address, at: string): boolean {
  return f.locks.some((l) => l.problem === home.hash && l.piece === piece && l.root === root && liveAt(f, l, at));
}

export type LockCheck = { ok: true; root: Address; view: PieceView } | { ok: false; why: string };

/**
 * Whether a lock would be kept if received at `at`, by section 1, and why not. A coin-kind lock is kept on the door's
 * word in its receipt (QX-17 section 5), and its coin is checked there, not here.
 */
export function checkLock(f: Folding, home: ProblemEntry, piece: Hash, key: Address, body: Record<string, unknown>, at: string, word: CoinLockWord | null): LockCheck {
  const view = home.fold.byHash.get(piece);
  if (!view) return { ok: false, why: 'names a piece this problem does not have' };
  const shape = lockBodyProblems(body);
  if (shape.length) return { ok: false, why: shape[0]! };
  const coin = body.kind === 'coin';
  if (coin && (!word || word.kind !== 'coin' || word.id !== body.id)) return { ok: false, why: 'this tracker honours no coin lock' };
  const root = rootFor(home.fold, key, 'lock', at);
  if (!root) return { ok: false, why: 'the key may not sign a lock' };
  const asked = stakeAsked(ruleAt(home, at), view.piece);
  if (asked === 0) return { ok: false, why: 'this piece asks no stake' };
  const amount = body.amount as number;
  if (amount < asked) return { ok: false, why: `this piece asks for a stake of ${asked}` };
  if (hasLock(f, home, piece, root, at)) return { ok: false, why: 'a lock already stands on this piece' };
  if (!coin) {
    const free = f.free(root, at);
    if (free < amount) return { ok: false, why: `free standing ${free} is below the lock of ${amount}` };
  }
  return { ok: true, root, view };
}
