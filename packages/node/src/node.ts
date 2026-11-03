/**
 * One node, with roles (WORKSHOP.md section 2, one peer). `admit` is being a door: the reference tracker's routes over
 * the store, and its pull of the peers' chains (QX-21). `work` is signing with the home's key: a Quilt and its page on
 * localhost, which the connector works through. `keep` is the keeper's loop over what the node holds (stage one), run
 * here where no page runs it. `host` is custody for people who cannot run one: the hosted on-ramp mounted beside the
 * door, with the owners' turn every hour. The store is one, the tracker's, which answers the client's `Chains`: what
 * the door admits is what the node serves and keeps, and a line on a node's chain is a line whether a door or a keep
 * wrote it. A tracker is a node with `admit`; a mirror a node with `keep`; a worker a node with `work`; the hosted
 * on-ramp a node with `admit` and `host`. The four binaries remain and are these four starts.
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { type Config, type Kept, KEEP_EVERY_MS, Quilt, Resolver, createPage, loadConfig, loadKey } from 'quilt';
import { type PeerPull, Store, type Tracker, type TrackerOptions, createTracker, schedulePeerPulls } from '@bitquilt/tracker';
import { type Hosted, type HostedOptions, createHosted } from '@bitquilt/hosted';

export type Role = 'admit' | 'work' | 'keep' | 'host';
export const ROLES: readonly Role[] = ['admit', 'work', 'keep', 'host'];

export interface StartOptions {
  /** The node's folder: its store (`node.db`), and for `work` the key, the config and the library a Quilt home holds. */
  home: string;
  roles: Iterable<Role>;
  /** The door (`admit`): where it listens, and what the tracker takes besides its store; its `url` is written into every receipt. */
  door?: { port: number; host?: string } & Omit<TrackerOptions, 'store' | 'custodySecret' | 'extra' | 'extraWellKnown'>;
  /** The person's page (`work`): its port on localhost, the home's config when none; trackers and relays that override the home's config. */
  page?: { port?: number; trackers?: string[]; relays?: string[] };
  /** The hosted on-ramp (`host`): what createHosted takes besides the store, the door's address and the custody secret; the members' homes under the node's home unless given. */
  host?: Omit<HostedOptions, 'store' | 'trackerUrl' | 'custodySecret' | 'home'> & { home?: string };
  /** The loops: the keep every half hour, the peers' pull every five minutes and the owners' turn every hour; false runs none, as the tests ask. */
  loops?: boolean;
  say?: (line: string) => void;
  fetchImpl?: typeof fetch;
}

export interface Node {
  home: string;
  roles: Set<Role>;
  store: Store;
  config: Config;
  resolver: Resolver;
  quilt: Quilt | null;
  tracker: Tracker | null;
  hosted: Hosted | null;
  door: Server | null;
  page: Server | null;
  /** One keep now: the node's loop over what it holds, and through a door, the peers' chains (QX-21). */
  keep(): Promise<{ kept: Kept; pulls: PeerPull[] }>;
  close(): Promise<void>;
}

/** Every hour, the owners' turn for the keys a host holds (hosted/bin.ts does the same for the hosted binary). */
const OWNERS_TURN_EVERY_MS = 3_600_000;

export async function start(options: StartOptions): Promise<Node> {
  const roles = new Set(options.roles);
  for (const r of roles) if (!ROLES.includes(r)) throw new Error(`${r} is not a role; the roles are ${ROLES.join(', ')}`);
  if (roles.has('host') && !roles.has('admit')) throw new Error('host is a role beside admit: custody is custody at a door');
  if (roles.has('admit') && !options.door) throw new Error('admit needs a door: its port and its url');
  mkdirSync(options.home, { recursive: true });
  const say = options.say ?? (() => {});
  const fetchImpl = options.fetchImpl ?? fetch;
  const store = new Store(join(options.home, 'node.db'));
  const config: Config = {
    ...loadConfig(options.home),
    ...(options.page?.trackers ? { trackers: options.page.trackers } : {}),
    ...(options.page?.relays ? { relays: options.page.relays } : {}),
  };
  // The one store: the resolver keeps in and serves from the door's store, so a node's chain is one chain.
  const resolver = new Resolver(config, options.home, fetchImpl, {}, store);

  let tracker: Tracker | null = null;
  let hosted: Hosted | null = null;
  let door: Server | null = null;
  if (roles.has('admit')) {
    const { port, host, ...rest } = options.door!;
    const custodySecret = randomBytes(32).toString('hex');
    if (roles.has('host')) {
      const { home: membersHome, ...hostRest } = options.host ?? ({} as NonNullable<StartOptions['host']>);
      hosted = createHosted({ ...hostRest, store, trackerUrl: rest.url, custodySecret, home: membersHome ?? join(options.home, 'hosted'), fetchImpl } as HostedOptions);
    }
    tracker = createTracker({ ...rest, store, custodySecret, ...(hosted ? { extra: hosted.routes, extraWellKnown: hosted.describe } : {}) });
    door = await tracker.listen(port, host ?? '127.0.0.1');
  }

  let quilt: Quilt | null = null;
  let page: Server | null = null;
  if (roles.has('work')) {
    const identity = loadKey(options.home);
    quilt = new Quilt(config, identity, resolver);
    page = await createPage({ quilt, person: Quilt.asPerson(config, identity, resolver), resolver }).listen(options.page?.port ?? config.port);
  }

  const timers: NodeJS.Timeout[] = [];
  const once = (run: () => Promise<void>): (() => void) => {
    let running = false;
    return () => {
      if (running) return;
      running = true;
      void run().catch((err: Error) => say(`${err.message}`)).finally(() => {
        running = false;
      });
    };
  };
  if (options.loops !== false) {
    // The page runs the keep while it is up (stage one); a node without one runs it here.
    if (roles.has('keep') && !page) {
      const keep = once(async () => {
        const k = await resolver.keep();
        say(`kept: ${k.problems} problems, ${k.added} lines, ${k.reads} reads${k.refused.length ? `; ${k.refused.length} refused` : ''}`);
      });
      timers.push(setTimeout(keep, 120_000).unref(), setInterval(keep, KEEP_EVERY_MS).unref());
    }
    if (tracker) schedulePeerPulls(tracker, options.door?.peers ?? [], say);
    if (hosted) {
      const turn = once(async () => {
        for (const t of await hosted!.turn()) if (t.said) say(`owners' turn, ${t.address}: ${t.said}`);
      });
      timers.push(setTimeout(turn, 60_000).unref(), setInterval(turn, OWNERS_TURN_EVERY_MS).unref());
    }
  }

  async function keep(): Promise<{ kept: Kept; pulls: PeerPull[] }> {
    const kept = await resolver.keep();
    const pulls = tracker ? await tracker.pullPeers() : [];
    return { kept, pulls };
  }

  const closeServer = (s: Server | null): Promise<void> => new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()));
  async function close(): Promise<void> {
    for (const t of timers) clearTimeout(t);
    await closeServer(page);
    await closeServer(door);
    store.close();
  }

  return { home: options.home, roles, store, config, resolver, quilt, tracker, hosted, door, page, keep, close };
}
