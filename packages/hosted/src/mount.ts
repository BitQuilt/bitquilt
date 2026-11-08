/**
 * The hosted on-ramp mounted beside a tracker's door (APP.md, Three things in one process), wired here once for every
 * program that holds custody at a door: bitquilt-hosted, bitquilt-node with host, and the tests. The custody secret is
 * made here, one for each start, and handed to both sides. The on-ramp writes it on every post it makes for a member
 * (`custodyHeaders`, the tracker's witness.ts), and the door reads it there (`hostedPost`), so the receipt says
 * custody: hosted (QX-18 section 3). The door answers the on-ramp's routes beside its own, and its well-known document
 * says what the on-ramp says of itself. Beside it, the owners' turn every hour (QX-19 section 4, QX-16), scheduled
 * here for both binaries.
 */
import { randomBytes } from 'node:crypto';
import { type Store, type Tracker, type TrackerOptions, createTracker } from '@bitquilt/tracker';
import { type Hosted, type HostedOptions, createHosted } from './hosted.js';

/** Every hour, the owners' turn for the keys a door holds. */
const OWNERS_TURN_EVERY_MS = 3_600_000;

/**
 * The two sides of one door, each with what it takes besides the store and the custody secret. The on-ramp's
 * `trackerUrl` is the door's own address, a function where it is known only once the door listens, so neither side's
 * options are read from the other's.
 */
export interface HostedDoorOptions {
  store: Store;
  tracker: Omit<TrackerOptions, 'store' | 'custodySecret' | 'extra' | 'extraWellKnown'>;
  hosted: Omit<HostedOptions, 'store' | 'custodySecret'>;
}

/** The on-ramp, then the tracker with the on-ramp mounted beside it, over one store and one custody secret. */
export function hostedDoor({ store, tracker, hosted }: HostedDoorOptions): { tracker: Tracker; hosted: Hosted } {
  const custodySecret = randomBytes(32).toString('hex');
  const onramp = createHosted({ ...hosted, store, custodySecret });
  const door = createTracker({
    ...tracker,
    store,
    custodySecret,
    extra: onramp.routes,
    extraWellKnown: onramp.describe,
  });
  return { tracker: door, hosted: onramp };
}

/**
 * The owners' turn every hour for the members whose homes hold a problem or a gold, the first a minute after the start:
 * each line a member's turn said, and why a turn was not run. The timers are returned, so a node that stops clears
 * them.
 */
export function scheduleOwnersTurn(hosted: Pick<Hosted, 'turn'>, say: (line: string) => void): NodeJS.Timeout[] {
  // The owners' turn, hourly, one at a time: a turn still running when the hour comes round is left to finish.
  let running = false;
  const ownersTurn = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const t of await hosted.turn()) if (t.said) say(`owners' turn, ${t.address}: ${t.said}`);
    } catch (err) {
      say(`owners' turn: not run (${(err as Error).message})`);
    } finally {
      running = false;
    }
  };
  return [
    setTimeout(() => void ownersTurn(), 60_000).unref(),
    setInterval(() => void ownersTurn(), OWNERS_TURN_EVERY_MS).unref(),
  ];
}
