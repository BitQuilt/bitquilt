/**
 * What a tracker lists, as this client reads it: a piece in the tracker's layer, a challenge, a judge panel, the gold
 * summed, a takedown, a scrape; and what `open` gathers of a problem for the render module. Types alone: the reading is
 * in quilt.ts and the saying in render.ts, and neither imports the other for one of these.
 */
import type { Hash, PieceState, State } from '@bitquilt/core';

/** The two sides of a challenge (QX-1): the key that challenged, and the author of the return it challenges. A verdict is for one of them. */
export const SIDES = ['challenger', 'author'] as const;
export type Side = (typeof SIDES)[number];

/**
 * A verifier kind in words, as `kindWords` in render.ts says it and as a tracker's layer carries it on each piece: the
 * kind, its registry number (null for the core's), how strongly a square of it is earned, what earns it, and whether
 * it is the weakest kind.
 */
export interface KindWords {
  kind: string;
  extension: string | null;
  strength: string;
  says: string;
  weakest: boolean;
}

/** A piece's state as the layer shows it: the core's, or one the layer adds: challenged (QX-1), judging (QX-2), recording and recorded (QX-20). */
export type LayerState = PieceState | 'challenged' | 'judging' | 'recording' | 'recorded';

/** QX-20 section 3: a record piece's grade as the tracker gives it: the readings wanted and standing, how many rest on kept reads, from how many roots and vendors, and the keys whose readings stand. */
export interface RecordGrade {
  wanted: number;
  standing: number;
  grounded: number;
  roots: number;
  vendors: number;
  keys: string[];
}

/**
 * A piece as the tracker that answered holds it in its layer (QX-1, QX-2, QX-3, QX-10): its state beside the core's,
 * and the kind's words as the tracker fills them, with the kind and its strength null where the tracker does not
 * implement the kind.
 */
export interface LayerPiece extends Omit<KindWords, 'kind' | 'strength'> {
  hash: Hash;
  name: string;
  verifier: string;
  state: LayerState;
  core: PieceState;
  kind: string | null;
  strength: string | null;
  attested: boolean;
  panel: string | null;
  challenge: Hash | null;
  /** The stake of standing the problem asks of a claim on this piece (QX-15); 0 or absent where none. */
  stake?: number;
  /** The piece's gold (QX-16): null or absent while no commitment has been revealed on it, else match, miss or overruled. */
  gold?: string | null;
  /** A square whose accepting set agreed with the owner's gold. */
  verified?: boolean;
  /**
   * QX-16: whether an accepting set stands on the piece with its window open at the tracker's now, where a reveal of the
   * gold is taken, a challenge open on it or not. Absent from a tracker older than 7 November 2026.
   */
  window_open?: boolean;
  /** QX-19: how many traces the tracker keeps on the piece. */
  traces?: number;
  /** QX-19: whether both reveals of the accepting set rest on kept reads, one, or neither; null where no two reveals accept it. */
  traced?: 'both' | 'one' | 'none' | null;
  /** QX-19: where the two readings of a disputed piece differ, and why. */
  seams?: Seam[];
  /** QX-19 section 4: the keys whose reading of this piece the layer set aside. */
  aside?: string[];
  /** QX-20: on a record piece, its grade; null or absent on every other kind. */
  record?: RecordGrade | null;
}

/** QX-19: one side of a seam: the key, what it returned for the field, and the read, span and passage it rests on, where it rests on anything. */
export interface SeamSide {
  key: string;
  name?: string;
  value: unknown;
  read: { url: string; hash: Hash; at: string; media?: string } | null;
  span: [number, number] | null;
  passage:
    | string
    | null /** QX-19 section 4: the layer folds the piece without this reading, since it rests on nothing where the other rests on the record. */;
  aside?: boolean;
}

/** QX-19: a field on which the two readings of a disputed piece differ, and why, read from what each rests on: different reads, the same read at different places, the same words read two ways, or nothing kept on a side. */
export interface Seam {
  field: string;
  why: 'source' | 'span' | 'reading' | 'unknown';
  sides: [SeamSide, SeamSide];
}

/** A problem's gold summed by the tracker (QX-16): how many blind commitments, and how each stands. */
export interface GoldCount {
  committed: number;
  pending: number;
  verified: number;
  missed: number;
  overruled: number;
  lapsed: number;
}

/** A challenge as a tracker lists it at /p/<hash>/challenges (QX-1): the seats drawn, each verdict, the outcome. */
export interface ChallengeListing {
  id: Hash;
  piece: Hash;
  name: string | null;
  root: string;
  at: string;
  stake: number;
  ground: string;
  seats: {
    root: string;
    offered_at: string;
    lapsed_at: string | null;
    verdict: { at: string; for: Side; return: Record<string, unknown> | null } | null;
  }[];
  outcome: 'open' | 'held' | 'failed' | 'void';
  decided_at: string | null;
}

/** A judge panel as a tracker lists it at /p/<hash>/panels (QX-2): the candidates by digest, their signers named once it has decided, the seats, each rank, the outcome. */
export interface PanelListing {
  piece: Hash;
  name: string;
  verifier: string | null;
  panel: number;
  majority: number;
  candidates: { digest: Hash; return: Record<string, unknown>; root?: string; signer?: string | null }[];
  seats: { root: string; offered_at: string; lapsed_at: string | null; rank: { at: string; ranking: Hash[] } | null }[];
  outcome: 'open' | 'decided' | 'void';
  winner: Hash | null;
  decided_at: string | null;
}

/**
 * QX-18: what a tracker writes beside `custody: hosted` on an event its hosted on-ramp posted through a token: the
 * product whose OAuth callback the token's code was sent to (`claude.ai`, `chatgpt.com`), or `other` with the name the
 * client gave itself, which is the client's own word. The tracker's word, as custody is.
 */
export interface Witness {
  via: string;
  client: string | null;
  /** How a product's mark was bound to the product: the token exchange came from its published addresses, or was signed with its published key. Absent on `other`, and on a mark from before the binding. */
  by?: 'address' | 'key' | null;
}

/** A maintainer's takedown as a tracker reports it (QX-6). */
export interface Takedown {
  id: string;
  by: string;
  why: string;
  at: string;
}

/** A problem's scrape as a tracker answers it at /p/<hash>/scrape: whether it is taken down (QX-6), and who keeps it (QX-4). */
export interface Scrape {
  hidden: Takedown | null;
  seeders: number;
  last_seeded: string | null;
}

/**
 * A problem as `open` reads it: the reduced state, the tracker that answered, and, where one did, its layer, its
 * takedown and the gold summed. What the render module's `summary` takes.
 */
export interface Opened {
  hash: Hash;
  state: State;
  tracker: string | null;
  layer?: LayerPiece[] | null;
  hidden?: Takedown | null;
  gold?: GoldCount | null;
}
