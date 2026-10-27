/**
 * Gold pieces, extension QX-16 (docs/ext/QX-16.md): the pure rules, with no HTTP in them. An owner commits by hash to
 * the agreed fields of some answers before the work, each commitment binding the piece and the answer together, so the
 * ledger shows how many commitments there are and not which pieces they are on; the stake is standing. After a piece
 * is accepted the owner reveals, naming the piece; a set that agrees with the gold is verified, a set that differs is
 * struck. This module holds what each rule says (the bodies, the shares, the match) and the lifecycle challengeLayer
 * runs over the record it folds into: when a problem has settled and a commitment is final (section 3), how long the
 * owner's stake stays locked (section 5), and whether a gold or a reveal would be kept (section 1). The strike a miss
 * makes, and the challenge that can undo it (section 4), are the challenge window's (challenge.ts).
 */
import { type Address, type Hash, type PieceView, type Return, NONCE_RE, agreeFields, commitHash, isHash, isRecord, plusHours, returnsAgree } from '@bitquilt/core';
import { ownerOf, rootFor, windowOf } from './verifiers.js';
import { ruleAt, stakeAsked } from './stake.js';
import type { Folding, ProblemEntry } from './standing.js';

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

// The lifecycle over the layer's record, in the order challengeLayer runs it.

/** When a problem's pieces are all final at `now` (section 3): complete, with every window closed; null until then. */
export function problemSettledAt(home: ProblemEntry, now: string): string | null {
  if (!home.fold.complete) return null;
  let latest: string | null = null;
  for (const v of home.fold.pieces) {
    if (v.windowEnd === null) continue;
    if (v.windowEnd > now) return null;
    if (latest === null || v.windowEnd > latest) latest = v.windowEnd;
  }
  return latest ?? now;
}

/** A commitment as a reader sees it at `now`: blind until revealed, and lapsed once the problem has settled (section 3). */
export function outcomeOf(home: ProblemEntry, c: GoldCommitment, now: string): GoldOutcome {
  if (c.outcome !== 'pending') return c.outcome;
  return problemSettledAt(home, now) !== null ? 'lapsed' : 'pending';
}

/** When a commitment is final (section 5), or null while the owner's stake is still exposed on it. */
export function commitmentFinalAt(home: ProblemEntry, c: GoldCommitment, now: string): string | null {
  const view = c.piece ? home.fold.byHash.get(c.piece) : undefined;
  switch (outcomeOf(home, c, now)) {
    case 'match':
      return view?.windowEnd !== null && view?.windowEnd !== undefined && view.windowEnd <= now ? view.windowEnd : null;
    case 'lapsed':
      return problemSettledAt(home, now);
    case 'miss': {
      const ch = home.challenges.find((x) => x.piece === c.piece && x.against === 'gold' && x.at >= c.revealedAt!);
      if (ch && ch.outcome === 'open') return null;
      if (ch?.decidedAt) return ch.decidedAt;
      const w = plusHours(c.revealedAt!, windowOf(home.fold));
      return w <= now ? w : null;
    }
    case 'overruled':
    case 'dropped':
      return c.revealedAt ?? now;
    default:
      return null;
  }
}

/** When a gold's stake is released (section 5): at its forfeit, or once every commitment is final; null while one is not. */
export function goldEnd(f: Folding, g: GoldView): string | null {
  if (g.forfeitedAt !== null) return g.forfeitedAt;
  const home = f.entries.get(g.problem);
  if (!home) return g.at;
  let latest = g.at;
  for (const c of g.commitments) {
    const final = commitmentFinalAt(home, c, f.now);
    if (final === null) return null;
    if (final > latest) latest = final;
  }
  return latest;
}

/** Whether a gold's stake is locked at `at` (section 5): from its receipt until it ends. */
export function goldLiveAt(f: Folding, g: GoldView, at: string): boolean {
  if (g.at > at) return false;
  const end = goldEnd(f, g);
  return end === null || end > at;
}

/** The commitment revealed on the piece, if one was and it was not dropped. */
export function goldOn(home: ProblemEntry, piece: Hash): GoldCommitment | null {
  for (const g of home.golds) for (const c of g.commitments) if (c.piece === piece && c.outcome !== 'dropped') return c;
  return null;
}

/** The unforfeited gold's miss on the piece, if the piece carries one. */
export function missOn(home: ProblemEntry, piece: Hash): { gold: GoldView; commitment: GoldCommitment } | null {
  for (const gold of home.golds) if (gold.forfeitedAt === null) for (const commitment of gold.commitments) if (commitment.piece === piece && commitment.outcome === 'miss') return { gold, commitment };
  return null;
}

export type GoldCheck = { ok: true; root: Address; kept: GoldCommitment[] } | { ok: false; why: string };

/**
 * Whether a gold would be kept if received at `at`, by section 1: the owner's; commitments not kept already; a stake
 * of at least the largest share among the pieces a gold can be on, for each commitment, since the ledger cannot tell
 * which piece a blind commitment names; and the owner's free standing covering the stake.
 */
export function checkGold(f: Folding, home: ProblemEntry, key: Address, body: Record<string, unknown>, at: string): GoldCheck {
  const shape = goldBodyProblems(body);
  if (shape.length) return { ok: false, why: shape[0]! };
  const root = rootFor(home.fold, key, 'gold', at);
  if (!root || root !== ownerOf(home.fold, at)) return { ok: false, why: 'the owner alone commits gold' };
  const hs = body.commitments as Hash[];
  for (const g of home.golds) for (const c of g.commitments) if (hs.includes(c.h)) return { ok: false, why: 'a commitment is kept already' };
  const rule = ruleAt(home, at);
  const share = goldShareMax(home.fold.pieces, (v) => stakeAsked(rule, v.piece));
  if (share === 0) return { ok: false, why: 'gold applies to a piece whose return has agreed fields' };
  const required = share * hs.length;
  const stake = body.stake as number;
  if (stake < required) return { ok: false, why: `the gold asks a stake of at least ${required}` };
  const free = f.free(root, at);
  if (free < stake) return { ok: false, why: `free standing ${free} is below the gold stake of ${stake}` };
  return { ok: true, root, kept: hs.map((h) => ({ h, piece: null, name: null, outcome: 'pending' as const, revealedAt: null, projection: null, struck: [], struckRoots: [] })) };
}

export type RevealCheck = { ok: true; gold: GoldView; commitment: GoldCommitment; view: PieceView } | { ok: false; why: string };

/**
 * Whether a gold reveal would count if received at `at`, by section 1: the owner's, naming a piece with no gold
 * revealed on it, matching a pending commitment of a gold kept before the piece was first worked, on a piece with an
 * accepting set inside its window.
 */
export function checkGoldReveal(home: ProblemEntry, piece: Hash, key: Address, body: Record<string, unknown>, at: string): RevealCheck {
  const view = home.fold.byHash.get(piece);
  if (!view) return { ok: false, why: 'names a piece this problem does not have' };
  const shape = goldRevealBodyProblems(body);
  if (shape.length) return { ok: false, why: shape[0]! };
  const root = rootFor(home.fold, key, 'gold_reveal', at);
  if (!root || root !== ownerOf(home.fold, at)) return { ok: false, why: 'the owner alone reveals gold' };
  if (goldOn(home, piece)) return { ok: false, why: 'the gold on this piece is revealed' };
  const h = goldCommitHash(piece, body.projection as Record<string, unknown>, body.nonce as string);
  let found: { gold: GoldView; commitment: GoldCommitment } | null = null;
  for (const gold of home.golds) if (gold.forfeitedAt === null) for (const commitment of gold.commitments) if (commitment.outcome === 'pending' && commitment.h === h) found = { gold, commitment };
  if (!found) return { ok: false, why: 'the reveal matches no commitment kept on this problem' };
  if (!hasAgreedFields(view)) return { ok: false, why: 'gold applies to a piece whose return has agreed fields' };
  const first = firstProductionAt(view);
  if (first !== null && first <= found.gold.at) return { ok: false, why: `gold names a piece already worked: ${view.piece.name}` };
  if (!view.accepting || view.accepting.completedAt > at) return { ok: false, why: 'nothing accepted on this piece yet' };
  if (view.windowEnd === null || at >= view.windowEnd) return { ok: false, why: 'the window has closed' };
  return { ok: true, gold: found.gold, commitment: found.commitment, view };
}
