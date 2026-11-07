/**
 * The wire shapes listings.ts declares again, held to the tracker's own types. The client may not import the tracker,
 * so it writes these out a second time (AGENTS.md, the arrows); a test may, so this file does. Each line assigns what
 * the tracker sends to the client's copy, and the client's typecheck fails where a copy no longer takes it. Where the
 * tracker builds a row inside a route (tracker.ts: `state`, `challenges`, `panels`), the row is built here the way the
 * route builds it, from the views it reads, so each field is held to the type it comes from. Nothing here runs: the
 * name ends in .test-d.ts, which vitest leaves out and the client's tsconfig takes in.
 */
import type {
  ChallengeView, Hidden, KindInfo, LayerState as TrackerLayerState, PanelView, PieceLayer, PieceTraces, ProblemLayer,
  RecordGrade as TrackerRecordGrade, Seam as TrackerSeam, SeamSide as TrackerSeamSide, Side as TrackerSide,
} from '@bitquilt/tracker';
import type { ChallengeListing, GoldCount, LayerPiece, LayerState, PanelListing, RecordGrade, Scrape, Seam, SeamSide, Side, Takedown } from '../src/listings.js';

// The types the client copies whole.
const side: Side = {} as TrackerSide;
const trackerSide: TrackerSide = {} as Side;
const layerState: LayerState = {} as TrackerLayerState;
const seam: Seam = {} as TrackerSeam;
const seamSide: SeamSide = {} as TrackerSeamSide;
const recordGrade: RecordGrade = {} as TrackerRecordGrade;
const goldCount: GoldCount = {} as ProblemLayer['goldCount'];
const takedown: Takedown = {} as Hidden;
const hidden: Scrape['hidden'] = {} as Hidden | null;

// A piece of `/p/<hash>/state`, as the route builds it from the layer's piece, its kind and its traces.
const l = {} as PieceLayer;
const k = {} as KindInfo;
const t = {} as PieceTraces;
const piece: LayerPiece = {
  name: l.name, hash: l.hash, verifier: k.verifier, state: l.state, core: l.core, challenge: l.challenge?.id ?? null,
  kind: k.kind, extension: k.extension, strength: k.strength, says: k.says, weakest: k.weakest, attested: l.attested, panel: l.panel?.outcome ?? null,
  stake: l.stake, gold: l.gold, verified: l.verified, traces: t.traces.length, traced: t.traced, seams: t.seams, aside: l.aside, record: t.record,
};

// A challenge of `/p/<hash>/challenges`, as the route builds it from the layer's challenge.
const c = {} as ChallengeView;
const challenge: ChallengeListing = {
  id: c.id, piece: c.piece, name: {} as string | null, root: c.root, at: c.at, stake: c.stake, ground: c.ground,
  seats: c.seats.map((s) => ({ root: s.root, offered_at: s.offeredAt, lapsed_at: s.lapsedAt, verdict: s.verdict ? { at: s.verdict.at, for: s.verdict.for, return: s.verdict.return } : null })),
  outcome: c.outcome, decided_at: c.decidedAt,
};

// A panel of `/p/<hash>/panels`, as the route builds it from the layer's panel, its candidates named once it decided.
const p = {} as PanelView;
const panel: PanelListing = {
  piece: p.piece, name: p.name, verifier: {} as KindInfo['verifier'] | null, panel: p.panel, majority: p.majority,
  candidates: p.candidates.map((x) => (p.outcome === 'decided' ? { digest: x.digest, return: x.return, root: x.root, signer: {} as string | null } : { digest: x.digest, return: x.return })),
  seats: p.seats.map((s) => ({ root: s.root, offered_at: s.offeredAt, lapsed_at: s.lapsedAt, rank: s.rank ? { at: s.rank.at, ranking: s.rank.ranking } : null })),
  outcome: p.outcome, winner: p.winner, decided_at: p.decidedAt,
};
