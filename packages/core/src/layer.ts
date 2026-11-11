/**
 * What reading 2 shows of a problem, over the fold: a piece's view and a problem's, with each extension's word on
 * them, and a layer's answer to the door. The pass that builds them is `read`, in `read.ts`,
 * and the rules here that read them, the trace's, the proposals' and the inherited squares', take them as these
 * shapes. They moved here from the tracker's layer as docs/history/V2-PLAN.md, phase 3, says.
 */
import type { ChallengeView, LayerState } from './challenge.js';
import type { Receipt } from './events.js';
import type { GoldCount, GoldState, GoldView } from './gold.js';
import type { Hash } from './hash.js';
import type { Inherited } from './inherit.js';
import type { Address } from './keys.js';
import type { KindInfo, PanelView, RecordView } from './kinds.js';
import type { PieceState, State } from './reduce.js';
import type { LockView } from './stake.js';
import type { Dropped } from './standing.js';

export interface PieceLayer {
  hash: Hash;
  name: string;
  core: PieceState;
  state: LayerState;
  challenge: ChallengeView | null;
  /** The verifier in words: kind, registry number, strength. */
  kind: KindInfo;
  /** An attest piece accepted on the actor's own record: the square says so. */
  attested: boolean;
  /** The panel sitting or having sat on a judge piece. */
  panel: PanelView | null;
  /** The stake the rule in force asks of this piece at now (QX-15); 0 where none. */
  stake: number;
  /** The piece's gold (QX-16): nothing kept, or where it stands. */
  gold: GoldState;
  /** A square whose accepting set agreed with the owner's gold. */
  verified: boolean;
  /**
   * QX-19 section 4: the keys whose reading of this piece the layer set aside, since it rests on nothing where the
   * other rests on the record.
   */
  aside: Address[];
  /** QX-20: on a record piece, its standing readings; null on every other kind. */
  record: RecordView | null;
  /**
   * QX-23 section 2: where the state is `inherited`, the problem where the square stands and the piece's state there;
   * null elsewhere.
   */
  inherited: Inherited | null;
}

export interface ProblemLayer {
  problem: Hash;
  /** The core's fold, untouched. */
  core: State;
  /**
   * The core's fold with struck events left out and the verifier kinds decided: the same as `core` where nothing was
   * struck and every kind is the core's.
   */
  fold: State;
  /**
   * QX-23 section 4: every piece is `accepted`, `unreachable` or `recorded`, or is `inherited` from a square that is
   * one of those three. The fold's own `complete` counts the problem's own squares alone.
   */
  complete: boolean;
  pieces: PieceLayer[];
  byHash: Map<Hash, PieceLayer>;
  challenges: ChallengeView[];
  panels: PanelView[];
  /** Pieces `next` is not to offer here: a judge piece whose panel sits or ran out. */
  unoffered: Set<Hash>;
  dropped: Dropped[];
  /** The stake rule in force at now (QX-15), or null. */
  stake: { min: number; pieces: string[] | null } | null;
  /** Every standing lock on this problem the layer kept, live or not. */
  locks: LockView[];
  /** The owner's golds on this problem (QX-16), as kept. */
  golds: GoldView[];
  /**
   * The gold summed for a reader: how many commitments, and how each stands; which pieces they are on is known only at
   * the reveal.
   */
  goldCount: GoldCount;
  /**
   * Every receipt the fold was computed from, the line's record (READING.md section 3): the chain's, the identity
   * log's, and those of the line's other versions, so a reader of the layer (the traces, the seeds, the proposed
   * pieces, the directory row) need not read the store again.
   */
  receipts: Receipt[];
}

/** A layer's answer before the door admits an event: yes, or no with the sentence that says why. */
export type Admission = { ok: true } | { ok: false; why: string };

/**
 * The views a reader of many problems is handed: the tracker's `Layer` is these with standing and the admissions
 * beside them, and a rule here that reads across problems, a proposal's forks or an inherited input's source, takes
 * this much.
 */
export interface LayerViews {
  /**
   * The time the layer is read at; lapses, windows and liveness are judged against it and every `at` below defaults
   * to it. Roots are resolved at `now`; moves carry the receipt that made them, so standing at an earlier time is
   * unchanged by what is kept later.
   */
  now: string;
  /** Every problem the reader holds and the core folds, by hash. */
  problems: Map<Hash, ProblemLayer>;
}
