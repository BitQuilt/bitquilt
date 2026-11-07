/**
 * The wire shapes listings.ts declares again, held to the tracker's own types. The client may not import the tracker,
 * so it writes these out a second time (AGENTS.md, the arrows); a test may, so this file does. Each line assigns what
 * the tracker sends to the client's copy, and the client's typecheck fails where a copy no longer takes it. Where the
 * tracker builds a row in its own code (tracker.ts: summary() for `scrape`, and the `state`, `challenges` and `panels`
 * routes), the row is built here with the route's own expressions over the same inputs: the problem's layer, its fold,
 * the traces and the names. A field the route takes from the layer's piece, its kind, the fold's piece view or the
 * traces is taken from the same place here, so a type that moves under the route moves under this file too. Nothing
 * here runs: the name ends in .test-d.ts, which vitest leaves out and the client's tsconfig takes in. Each copy is
 * exported, so the typecheck's rule against unused names reads it as used.
 */
import type { Address, Hash } from '@bitquilt/core';
import {
  type Hidden,
  type LayerState as TrackerLayerState,
  type PieceTraces,
  type ProblemLayer,
  type RecordGrade as TrackerRecordGrade,
  type Seam as TrackerSeam,
  type SeamSide as TrackerSeamSide,
  type SeedInfo,
  type Side as TrackerSide,
  windowOpen,
} from '@bitquilt/tracker';
import type {
  ChallengeListing,
  GoldCount,
  LayerPiece,
  LayerState,
  PanelListing,
  RecordGrade,
  Scrape,
  Seam,
  SeamSide,
  Side,
  Takedown,
} from '../src/listings.js';

// What the routes read: the problem's layer, the tracker's now, the takedowns by problem, the problem's seeding, its
// traces by piece, and the name a root chose as the fold has it (nameIn in tracker.ts).
const hash = {} as Hash;
const pl = {} as ProblemLayer;
const at = {} as string;
const hidden = {} as Map<string, Hidden>;
const seed = {} as SeedInfo;
const traced = {} as Map<Hash, PieceTraces>;
const name = (a: string): string | null => pl.fold.names.get(a as Address)?.name ?? null;

// The types the client copies whole.
export const side: Side = {} as TrackerSide;
export const trackerSide: TrackerSide = {} as Side;
export const layerState: LayerState = {} as TrackerLayerState;
export const seam: Seam = {} as TrackerSeam;
export const seamSide: SeamSide = {} as TrackerSeamSide;
export const recordGrade: RecordGrade = {} as TrackerRecordGrade;
export const goldCount: GoldCount = pl.goldCount;
export const takedown: Takedown | null = hidden.get(hash) ?? null;

// The scrape of `/p/<hash>/scrape`, as summary() builds it from the takedown and the seeding.
export const scrape: Scrape = {
  hidden: hidden.get(hash) ?? null,
  seeders: seed.seeders.size,
  last_seeded: seed.last_seeded,
};

// The pieces of `/p/<hash>/state`, as the route builds them: the name, hash and verifier from the fold's piece view,
// the state and the kind's words from the layer's piece, the window from the gold's rule at now (QX-16), the grade and
// the seams from the traces.
export const pieces: LayerPiece[] = pl.fold.pieces.map((v) => {
  const l = pl.byHash.get(v.piece.hash)!;
  const t = traced.get(v.piece.hash)!;
  return {
    name: v.piece.name,
    hash: v.piece.hash,
    verifier: v.piece.verifier,
    state: l.state,
    core: l.core,
    challenge: l.challenge?.id ?? null,
    kind: l.kind.kind,
    extension: l.kind.extension,
    strength: l.kind.strength,
    says: l.kind.says,
    weakest: l.kind.weakest,
    attested: l.attested,
    panel: l.panel?.outcome ?? null,
    stake: l.stake,
    gold: l.gold,
    verified: l.verified,
    window_open: windowOpen(v, at),
    traces: t.traces.length,
    traced: t.traced,
    seams: t.seams,
    aside: l.aside,
    record: t.record,
  };
});

// The challenges of `/p/<hash>/challenges`, as the route builds them from the layer's challenges, the piece named by the layer.
export const challenges: ChallengeListing[] = pl.challenges.map((c) => ({
  id: c.id,
  piece: c.piece,
  name: pl.byHash.get(c.piece)?.name ?? null,
  root: c.root,
  at: c.at,
  stake: c.stake,
  ground: c.ground,
  seats: c.seats.map((s) => ({
    root: s.root,
    offered_at: s.offeredAt,
    lapsed_at: s.lapsedAt,
    verdict: s.verdict ? { at: s.verdict.at, for: s.verdict.for, return: s.verdict.return } : null,
  })),
  outcome: c.outcome,
  decided_at: c.decidedAt,
}));

// The panels of `/p/<hash>/panels`, as the route builds them from the layer's panels: the verifier from the layer's
// piece's kind, and the candidates' signers named once the panel has decided.
export const panels: PanelListing[] = pl.panels.map((p) => ({
  piece: p.piece,
  name: p.name,
  verifier: pl.byHash.get(p.piece)?.kind.verifier ?? null,
  panel: p.panel,
  majority: p.majority,
  candidates: p.candidates.map((x) =>
    p.outcome === 'decided'
      ? { digest: x.digest, return: x.return, root: x.root, signer: name(x.root) }
      : { digest: x.digest, return: x.return },
  ),
  seats: p.seats.map((s) => ({
    root: s.root,
    offered_at: s.offeredAt,
    lapsed_at: s.lapsedAt,
    rank: s.rank ? { at: s.rank.at, ranking: s.rank.ranking } : null,
  })),
  outcome: p.outcome,
  winner: p.winner,
  decided_at: p.decidedAt,
}));
