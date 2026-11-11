/**
 * The challenge window, extension QX-1 (docs/ext/QX-1.md), as reading 2 shows it: the states a piece has over the
 * fold, the two sides of a verdict, and a challenge as kept, with its panel's seats and its outcome. The record the
 * fold writes into (standing.ts) keeps challenges of this shape. The pass that folds them is `read`, in
 * `read.ts`, moved here from the tracker's layer as docs/history/V2-PLAN.md, phase 3, says.
 */
import type { PieceState } from './reduce.js';
import type { Address } from './keys.js';
import type { Hash } from './hash.js';
import type { Return } from './schema.js';

export const SIDES = ['challenger', 'author'] as const;
export type Side = (typeof SIDES)[number];
export type Outcome = 'open' | 'held' | 'failed' | 'void';
export type LayerState = PieceState | 'challenged' | 'judging' | 'recording' | 'recorded' | 'inherited';
/** Whether a piece in this layered state counts as accepted: its set stands, provisionally or not, unchallenged. */
export function countsAsAccepted(state: string): boolean {
  return state === 'accepted' || state === 'accepted_provisional';
}
/** Whether a piece in this layered state still carries its accepting set. */
export function carriesSet(state: string): boolean {
  return state === 'accepted' || state === 'accepted_provisional' || state === 'challenged';
}

export interface VerdictView {
  id: Hash;
  key: Address;
  root: Address;
  at: string;
  for: Side;
  return: Return | null;
}
export interface Seat {
  root: Address;
  offeredAt: string;
  lapsedAt: string | null;
  verdict: VerdictView | null;
}
export interface ChallengeView {
  id: Hash;
  problem: Hash;
  piece: Hash;
  key: Address;
  root: Address;
  at: string;
  stake: number;
  ground: string;
  /** What is challenged: a piece's acceptance (QX-1), or the gold reveal that struck it (QX-16). */
  against: 'acceptance' | 'gold';
  /** The roots of the accepting set, then the owner; against gold, the owner alone. */
  parties: Address[];
  seed: string | null;
  /** The pool in draw order. */
  order: Address[];
  seats: Seat[];
  outcome: Outcome;
  decidedAt: string | null;
  /** The ids of the accepting set's events, left out of the fold once the challenge held. */
  struck: Hash[];
  /** Verdicts that did not count, with why. */
  dropped: { id: Hash; why: string }[];
}
