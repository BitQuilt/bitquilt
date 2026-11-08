/**
 * The door a Quilt hands its coin (coin.ts), its gold (gold.ts), its stake (stake.ts), its sharpening (sharpen.ts) and
 * its trace (trace.ts): the key, the config and the library; the way to sign and to post, which stays the Quilt's own;
 * the trackers to ask and how to ask them; what the Quilt has read; and three acts of the Quilt's own those files build
 * on: the core's pick held to one piece, a problem resolved, and an envelope published as `publish` publishes it, its
 * announce and its version signed with the home's key. A Quilt builds one from its private methods when it is made
 * (quilt.ts), so signing and posting reach those five files and no caller of the Quilt.
 */
import type { Envelope, Event, Hash, Pick, Problem, State, Unsigned } from '@bitquilt/core';
import type { Config, Identity } from './config.js';
import type { Link } from './link.js';
import type { LayerPiece } from './listings.js';
import type { Published } from './quilt.js';
import type { Library } from './library.js';
import type { Posted, Resolved } from './resolver.js';

export interface Door {
  readonly config: Config;
  readonly identity: Identity | null;
  /** The home's library, as the Quilt reads it: the same object the resolver holds, so a write here is the Quilt's. */
  readonly library: Library;
  /** The key, or a thrown "no key yet". */
  needKey(): Identity;
  /** Now, or a millisecond or two later, so events posted together fold in the order written. */
  stamp(after?: number): string;
  /** An event signed with the home's key. */
  sign(unsigned: Unsigned): Event;
  /** A signed event posted as it is, the refusal in `posted` and not thrown. */
  post(event: Event, log: Hash | null | 'coin', trackers: string[]): Promise<Posted>;
  /** Signs and posts; a refusal throws with the tracker's reason under `what`. */
  postSigned(
    unsigned: Unsigned,
    log: Hash | null | 'coin',
    trackers: string[],
    what: string,
  ): Promise<{ event: Event; posted: Posted }>;
  /** Where posts about a problem go, each once. */
  trackersFor(problem: Hash, first?: string[]): string[];
  /**
   * A tracker's JSON through the Quilt's own way to the network (the guarded fetch where the connector is shared), or
   * null.
   */
  ask<T>(url: string): Promise<T | null>;
  /** The first tracker that answers `ask` with something, or null. */
  firstAnswer<T>(trackers: string[], ask: (tracker: string) => Promise<T | null>): Promise<T | null>;
  /** A tracker's well-known document, read once per Quilt. */
  wellKnown(tracker: string): Promise<Record<string, unknown> | null>;
  /** The tracker's layer over a problem (QX-15, QX-16): per piece, the stake asked and the gold's outcome. */
  layerOf(hash: Hash, tracker: string): Promise<LayerPiece[] | null>;
  /** A problem opened: its state, the layer of the tracker that answered, and the version that replaced it, if any. */
  open(input: string): Promise<{ state: State; layer: LayerPiece[] | null; superseded: Hash | null }>;
  /** The library saved. */
  save(): void;
  /** The core's `next` held to one piece, so the pick is that piece's, or null where this key cannot take it. */
  pickOnly(state: State, piece: Hash, now: string): Pick | null;
  /** The problem behind a link, resolved, with no library written; null where no resolver answered. */
  resolve(link: Link): Promise<Resolved | null>;
  /**
   * A signed envelope posted to every tracker with its blobs, then its announce and its version where it went, as
   * `publish` posts them; the home's library notes the problem.
   */
  publishEnvelope(
    envelope: Envelope,
    blobs: Map<Hash, Uint8Array>,
    problem: Problem,
    topics: string[],
  ): Promise<Published>;
}
