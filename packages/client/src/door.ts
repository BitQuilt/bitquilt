/**
 * The door a Quilt hands its coin (coin.ts) and its gold (gold.ts): the key, the config and the library; the way to
 * sign and to post, which stays the Quilt's own; the trackers to ask and how to ask them; and what the Quilt has read.
 * A Quilt builds one from its private methods when it is made (quilt.ts), so signing and posting reach those two files
 * and no caller of the Quilt.
 */
import type { Event, Hash, State, Unsigned } from '@bitquilt/core';
import type { Config, Identity } from './config.js';
import type { LayerPiece } from './listings.js';
import type { Library, Posted } from './resolver.js';

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
  postSigned(unsigned: Unsigned, log: Hash | null | 'coin', trackers: string[], what: string): Promise<{ event: Event; posted: Posted }>;
  /** Where posts about a problem go, each once. */
  trackersFor(problem: Hash, first?: string[]): string[];
  /** The first tracker that answers `ask` with something, or null. */
  firstAnswer<T>(trackers: string[], ask: (tracker: string) => Promise<T | null>): Promise<T | null>;
  /** A tracker's well-known document, read once per Quilt. */
  wellKnown(tracker: string): Promise<Record<string, unknown> | null>;
  /** The tracker's layer over a problem (QX-15, QX-16): per piece, the stake asked and the gold's outcome. */
  layerOf(hash: Hash, tracker: string): Promise<LayerPiece[] | null>;
  /** A problem opened: its state and the layer of the tracker that answered. */
  open(input: string): Promise<{ state: State; layer: LayerPiece[] | null }>;
  /** The library saved. */
  save(): void;
}
