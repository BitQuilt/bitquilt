/**
 * The tracker as a library: what the package exports, which hosted, the mirror and the node import in their sources
 * and Quilt in its tests. Each export is listed below with the file that holds it, and the map of the code
 * (AGENTS.md, The shape of it) says what each file holds and which extension it carries out. The tracker's own tests
 * import its files themselves.
 */
export {
  Store,
  reduceInputOf,
  type ChainReader,
  type OAuthClientRow,
  type OAuthCodeRow,
  type GrantRow,
} from './store.js';
export { createTracker, IDENTITY, type Tracker, type TrackerOptions } from './tracker.js';
export { schedulePeerPulls, PEER_PULL, PEER_PULL_EVERY_MS, type PeerPull } from './peers.js';
export { json } from './http.js';
export { WITNESS_VIA, WITNESS_BOUND_BY, CLIENT_NAME_MAX, custodyHeaders } from './witness.js';
export { PRIVATE_RANGES, clientAddress, clientAddressOf, inRanges, plainAddress, rangesOf } from './address.js';
export { trackerOptionsFromEnv, quietSqliteWarning, type TrackerEnv } from './env.js';
export {
  CHALLENGE,
  CHALLENGE_EVENTS,
  CHALLENGE_SEED,
  GROUND_MAX,
  type Layer,
  MAJORITY,
  PANEL,
  challengeBodyProblems,
  challengeLayer,
  inputRefused,
  verdictBodyProblems,
} from './challenge.js';
export { type Admission, type PieceLayer, type ProblemLayer } from '@bitquilt/core';
export {
  type ChallengeView,
  type LayerState,
  type Outcome,
  SIDES,
  type Seat,
  type Side,
  type VerdictView,
  acceptingRoots,
  carriesSet,
  countsAsAccepted,
  rootFor,
} from '@bitquilt/core';
export {
  applyVerifiers,
  settleKinds,
  describeKind,
  kindOf,
  viaOf,
  leaseOf,
  ownerOf,
  windowOf,
  fromPersonSeat,
  EXTENSIONS,
  DEFAULT_CANDIDATES,
  JUDGE_SEED,
  STRENGTHS,
  type Kind,
  type Via,
  type Strength,
  type KindInfo,
  type KindsDecided,
  type PanelView,
  type PanelSeat,
  type PanelOutcome,
  type Candidate,
  type RankView,
  type ExtAccepting,
  type VerifierOptions,
  type RecordView,
} from '@bitquilt/core';
export { RANK_EVENTS } from './verifiers.js';
export { drawOrder, offerSeats, type Seated } from '@bitquilt/core';
export { PRODUCTION_EVENTS, STAKE_EVENTS } from './stake.js';
export {
  type CoinLockWord,
  LOCK_KINDS,
  type LockKind,
  type LockView,
  STAKE,
  type StakeRule,
  lockBodyProblems,
  lockReleasedAt,
  ruleNames,
  stakeAsked,
  stakeRuleBodyProblems,
} from '@bitquilt/core';
export { GOLD_EVENTS } from './gold.js';
export {
  GOLD,
  type GoldCommitment,
  type GoldOutcome,
  type GoldState,
  type GoldView,
  firstProductionAt,
  goldBodyProblems,
  goldMatches,
  goldRevealBodyProblems,
  goldShare,
  hasAgreedFields,
  matchedCommitments,
  windowOpen,
} from '@bitquilt/core';
export {
  COIN,
  COIN_LOG,
  COIN_EVENTS,
  coinLayer,
  coinParamsProblems,
  coinEventRefusal,
  coinBodyProblems,
  epochAmount,
  type CoinParams,
  type CoinLayer,
  type CoinFolded,
  type LogHead,
  type CoinLockView,
  type BalanceView,
  type EpochView,
  type CoinWord,
  type BurnWord,
  type RedeemLine,
  type CreditLine,
} from './coin.js';
export { type Credit, type Move, creditedRoots } from '@bitquilt/core';
export { HIDE, WHY_MAX, hideBodyProblems, hiddenNow, type Hidden } from './hide.js';
export {
  SEEDING,
  RECIPROCITY,
  TENTH,
  WATCH,
  seedInfo,
  seedBodyProblems,
  watchExclusions,
  offerOrder,
  type SeedInfo,
  type Reason,
  type Offer,
} from './seeding.js';
export {
  BLOB_MAX,
  type PieceTraces,
  READS_MAX,
  RECORD,
  RESTS_MAX,
  type Read,
  type RecordGrade,
  type Rest,
  type RestedOn,
  SPAN_MAX,
  type Seam,
  type SeamSide,
  type SeamWhy,
  TRACE,
  TRACE_EVENTS,
  type TraceBody,
  type TraceView,
  type Traced,
  admitTrace,
  passageIn,
  pieceTraces,
  problemTraces,
  readsNamed,
  recordDocument,
  recordGraded,
  recordOutput,
  recordSeams,
  restsOf,
  traceBodyProblems,
  tracesStated,
} from '@bitquilt/core';
export {
  PROPOSE,
  PROPOSED_MAX,
  PROPOSE_EVENTS,
  PROPOSE_WHY_MAX,
  type Proposal,
  type ProposalView,
  proposalsIn,
  proposeBodyProblems,
  proposedHash,
  standingProposals,
} from '@bitquilt/core';
export { INHERIT, type Inherited, briefOver, completeInLayer, inheritSquares } from '@bitquilt/core';
