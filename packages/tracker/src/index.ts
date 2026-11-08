/**
 * The tracker as a library: Quilt and the mirror import the store and `createTracker` to run one in their tests, and
 * the mirror imports `reduceInputOf`, `challengeLayer`, `coinLayer` and `COIN_LOG` to fold a tracker's chains as the
 * tracker does and recompute its balances from them.
 * The files, by extension: tracker.ts (the options, the context the door's jobs share, and the table of its routes),
 * admit.ts (the door as it takes a post, with a map for the identity log and one for a problem's log from each event
 * type to the check that admits it), views.ts (the answers to a read), hand.ts (assisted next and the offer),
 * routes.ts (what a row of the table holds, and how a request's path finds its row), http.ts (the refusal and the JSON
 * writer, which the hosted on-ramp writes its own routes' JSON answers with too), store.ts, challenge.ts (QX-1, with
 * standing.ts and sortition.ts), verifiers.ts (QX-2, QX-3, QX-10, QX-20), trace.ts (QX-19, and QX-20's grade and
 * document), seeding.ts (QX-4, QX-5), hide.ts (QX-6), stake.ts (QX-15), gold.ts (QX-16), coin.ts (QX-17), witness.ts
 * (QX-18's door side), peers.ts (QX-21), env.ts (the binaries' environment). The body checks, the constants and the
 * view types are exported for the tests, which enter through `createTracker` and `challengeLayer`.
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
  challengeLayer,
  challengeBodyProblems,
  verdictBodyProblems,
  countsAsAccepted,
  carriesSet,
  acceptingRoots,
  rootFor,
  CHALLENGE,
  PANEL,
  MAJORITY,
  GROUND_MAX,
  CHALLENGE_SEED,
  SIDES,
  CHALLENGE_EVENTS,
  type Layer,
  type ProblemLayer,
  type PieceLayer,
  type ChallengeView,
  type Seat,
  type VerdictView,
  type Side,
  type Outcome,
  type LayerState,
  type Admission,
} from './challenge.js';
export {
  applyVerifiers,
  describeKind,
  kindOf,
  viaOf,
  leaseOf,
  ownerOf,
  windowOf,
  rankBodyProblems,
  rankingProblem,
  panelSeatProblem,
  fromPersonSeat,
  EXTENSIONS,
  RANK_EVENTS,
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
} from './verifiers.js';
export { drawOrder, offerSeats, type Seated } from './sortition.js';
export {
  STAKE,
  STAKE_EVENTS,
  PRODUCTION_EVENTS,
  LOCK_KINDS,
  stakeRuleBodyProblems,
  lockBodyProblems,
  stakeAsked,
  ruleNames,
  lockReleasedAt,
  type StakeRule,
  type LockView,
  type LockKind,
  type CoinLockWord,
} from './stake.js';
export {
  GOLD,
  GOLD_EVENTS,
  goldBodyProblems,
  goldRevealBodyProblems,
  goldMatches,
  matchedCommitments,
  goldShare,
  hasAgreedFields,
  firstProductionAt,
  windowOpen,
  type GoldView,
  type GoldCommitment,
  type GoldOutcome,
  type GoldState,
} from './gold.js';
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
  type CoinLockView,
  type BalanceView,
  type EpochView,
  type CoinWord,
  type BurnWord,
  type RedeemLine,
  type CreditLine,
} from './coin.js';
export { creditedRoots, type Credit, type Move } from './standing.js';
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
  TRACE,
  RECORD,
  TRACE_EVENTS,
  BLOB_MAX,
  SPAN_MAX,
  READS_MAX,
  RESTS_MAX,
  traceBodyProblems,
  readsNamed,
  admitTrace,
  pieceTraces,
  problemTraces,
  recordGraded,
  recordSeams,
  recordDocument,
  recordOutput,
  tracesStated,
  restsOf,
  passageIn,
  type Read,
  type Rest,
  type TraceBody,
  type TraceView,
  type Traced,
  type Seam,
  type SeamSide,
  type SeamWhy,
  type PieceTraces,
  type RecordGrade,
  type RestedOn,
} from './trace.js';
