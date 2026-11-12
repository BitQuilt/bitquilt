/**
 * A problem read where no tracker's state answered. docs/v2/READING.md section 1 gives the read a ledger, and here
 * the ledger is the one problem as this home resolved it: its envelopes along prev, their blobs, each version's lines
 * and the identity log's. The core's `read` reads it as a ledger of its own, as the verify script reads a clone, and
 * the answer has the shape of a tracker's state, so a problem is said the same way whoever read it.
 * What rests on another problem's chain is not read here: the standing a key earned elsewhere, so the pool behind a
 * challenge or a panel, and a square a fork inherits. A read whose bytes this home does not hold is measured as not
 * here, so a trace that names it is not kept.
 */
import { type Hash, passageIn, problemTraces, read, windowOpen } from '@bitquilt/core';
import type { GoldCount, LayerPiece } from './listings.js';
import type { Resolved } from './resolver.js';

/** What a tracker's state gives the Quilt of a problem, from this home's own read. */
export interface ReadAlone {
  pieces: LayerPiece[];
  gold: GoldCount | null;
  /** The version that replaced this one is a tracker's word, and none answered. */
  superseded: null;
}

/**
 * The one problem read at `now` by reading 2, each piece with the one state the reading gives it, or null where the
 * core refuses the problem. `blobOf` answers a read this home keeps beside the blobs the envelopes name.
 */
export function readAlone(
  resolved: Resolved,
  now: string,
  blobOf: (hash: Hash) => Uint8Array | null,
): ReadAlone | null {
  const { envelopes, blobs, receipts } = resolved;
  const held = (h: Hash) => blobs.get(h) ?? blobOf(h);
  const blobLength = (h: Hash) => held(h)?.length ?? null;
  const reading = read({ problems: [{ envelopes, blobs, receipts, now }], now, blobLength });
  const pl = reading.problems.get(resolved.hash);
  if (!pl) return null;
  const traced = problemTraces(pl, blobLength, (h, span) => passageIn(held(h), span));
  return {
    pieces: pl.fold.pieces.map((v) => {
      const l = pl.byHash.get(v.piece.hash)!;
      const t = traced.get(v.piece.hash)!;
      return {
        name: v.piece.name,
        hash: v.piece.hash,
        verifier: v.piece.verifier,
        state: l.state,
        challenge: l.challenge?.id ?? null,
        challenge_at: l.challenge?.problem ?? null,
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
        window_open: windowOpen(v, now),
        traces: t.traces.length,
        traced: t.traced,
        seams: t.seams,
        aside: l.aside,
        readings: l.readings,
        record: t.record,
        inherited: l.inherited,
      };
    }),
    gold: pl.goldCount,
    superseded: null,
  };
}
