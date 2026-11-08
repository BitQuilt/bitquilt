/**
 * The reference tracker (PROTOCOL.md, The tracker): a resolver that answers a hash, accepts a signed event after
 * checking it, stamps receipts strictly increasing on each problem, keeps the chain, serves an index, and forges
 * nothing. Everything it serves is checkable from hashes and signatures; what it may do beyond serving is stamp,
 * refuse, omit and hide. Admission (the gate, rate limits, the stamp) lives at its door and not in the reducer.
 *
 * This file holds what a tracker is made with (`TrackerOptions`) and what it is (`Tracker`); the context its jobs
 * share, built once (`contextOf`); and `createTracker`, whose table of routes ties each job to its paths, one row each
 * (routes.ts says what a row holds), and whose `handle` finds a request's row. Each job is a file of its own: admit.ts
 * takes a post (the door: what every event is asked, then, for the identity log and a problem's, a map from each event
 * type to the one check that admits it), views.ts answers a read, and hand.ts hands a key a piece.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { type Address, type Hash, type ReduceInput, reduce, withSlash, IDENTITY_LOG } from '@bitquilt/core';
import { keepBlob, limit, postEvent, publish, pullDoorOf } from './admit.js';
import { PRIVATE_RANGES, clientAddress, rangesOf } from './address.js';
import { type Layer, type ProblemLayer, challengeLayer } from './challenge.js';
import { type CoinLayer, type CoinParams, COIN_LOG, coinLayer } from './coin.js';
import { assisted, offer } from './hand.js';
import { type Hidden, hiddenNow } from './hide.js';
import { Refusal, json } from './http.js';
import { type PeerPull, pullPeers } from './peers.js';
import { type Handler, type Route, handlerOf, routeOf } from './routes.js';
import { type Store, reduceInputOf } from './store.js';
import { type PieceTraces, passageIn, problemTraces } from './trace.js';
import {
  blob,
  cannotFold,
  challengesOf,
  coinBalance,
  coinCredits,
  coinEpochs,
  coinLock,
  coinRedeems,
  coinState,
  countsOf,
  events,
  index,
  named,
  panelsOf,
  recordOf,
  scrape,
  standingOf,
  state,
  viewIn,
  wellKnown,
  workBy,
} from './views.js';

/**
 * The identity log (CORE.md section 4): the pseudo-problem that name, delegate, revoke, rotate and hide events are
 * chained under. It is the core's IDENTITY_LOG under the name this package exports, which tracker.test.ts reads; the
 * door itself says IDENTITY_LOG.
 */
export const IDENTITY: Hash = IDENTITY_LOG;
export interface TrackerOptions {
  store: Store;
  /** This tracker's own address, written into every receipt. */
  url: string;
  /** The name the well-known document gives this tracker; its address when none. */
  name?: string;
  /**
   * QX-5 section 2: the one key whose seeded problems a key with no accepted work here is offered first
   * (`QUILT_FIRST_SEEDER`); none when left out.
   */
  firstSeeder?: Address;
  /** Other trackers' addresses, published at the well-known document for a client to try next. */
  peers?: string[];
  /** Posts an hour from one key and from one network address (120 and 600 when none are given). */
  limits?: { keyPerHour: number; ipPerHour: number };
  /** The bits of proof of work a name event carries here (CORE.md, the stamp); 0, the default, asks none. */
  stamp?: { name: number };
  /**
   * What a network address is hashed with before it names a rate-limit bucket; random at each start when none is given,
   * so a bucket is not read back to an address.
   */
  ipSalt?: string;
  /** The clock, for the tests; the system's when none is given. */
  now?: () => string;
  /** The keys whose hide events this tracker honours (QX-6); published at the well-known document. */
  maintainers?: Address[];
  /**
   * QX-1 section 2 as amended 29 October 2026: a founding standing declared per root, published at the well-known
   * document and counted into that root's standing from the ledger's beginning.
   */
  founding?: Record<string, number>;
  /**
   * A secret only this process knows: a post carrying it in x-quilt-custody was made by the connector mounted beside
   * the tracker, for a key it holds.
   */
  custodySecret?: string;
  /** Routes mounted beside the tracker, such as the hosted on-ramp. Answers true when it handled the request. */
  extra?: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;
  /**
   * What the routes mounted beside the tracker say of themselves at the well-known document, such as the witness the
   * hosted on-ramp binds (QX-18).
   */
  extraWellKnown?: () => Record<string, unknown>;
  /**
   * The proxies whose X-Forwarded-For is believed (address.ts), as ranges; the private networks and the machine itself
   * when none are given, and none at all for an empty list.
   */
  trustedProxies?: readonly string[];
  /**
   * QX-17: the coin this tracker carries, or reads from a home; absent, it has no coin log and honours no coin lock.
   */
  coin?: CoinParams;
  /** How the tracker reaches another tracker: the coin's home for a coin lock, and its parameters. */
  fetchImpl?: typeof fetch;
}

export interface Tracker {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  listen(port: number, host?: string): Promise<Server>;
  /** The door's routes, one row each, in the order `handle` tries them; the well-known document lists their paths. */
  routes: readonly Route[];
  /** The core's fold of a problem this tracker holds. */
  reduceProblem(hash: Hash): ReturnType<typeof reduce> | null;
  /**
   * The layer over every problem this tracker holds, at now: the challenge window (QX-1), the verifier kinds (QX-2,
   * QX-3, QX-10), the stakes and locks (QX-15) and the owner's gold (QX-16).
   */
  layer(): Layer;
  /** One problem's view in that layer. */
  view(hash: Hash): ProblemLayer | null;
  /** QX-17: the coin as this tracker computes it at now, or null where it carries none. */
  coin(): CoinLayer | null;
  /**
   * QX-21: every peer's chains for the logs this tracker keeps, pulled and folded through this door; what each pull
   * did.
   */
  pullPeers(): Promise<PeerPull[]>;
}

/**
 * What `createTracker` builds once and hands the jobs of its door: admit.ts takes a post, views.ts answers a read, and
 * hand.ts hands a key a piece. It holds the store, the options with their defaults filled, and the layer as it is kept
 * between writes, with what is read over it. Each of those files says in its own `Reads` the part of this it takes, and
 * each function there names in its signature or its first line what it reads of that. What a tracker keeps from one
 * request to the next (the kept layer, the traces read over it, the burn rate a coin's home published) is here and
 * nowhere else, so two trackers in one process share nothing.
 */
export interface Context {
  /** The chains, the blobs, the holds and the hourly counts. */
  readonly store: Store;
  /** The options as the tracker was made with them. */
  readonly options: TrackerOptions;
  /** This tracker's own address, ending in a slash, as every receipt names it. */
  readonly url: string;
  /** The clock: the options', or the system's. */
  readonly now: () => string;
  /** Posts an hour from one key and from one network address: the options', or 120 and 600. */
  readonly limits: { keyPerHour: number; ipPerHour: number };
  /** The bits of proof of work a name event carries here (CORE.md, the stamp): the options', or 0, which asks none. */
  readonly stampNeeded: number;
  /** The keys whose hide events this tracker honours (QX-6), in lower case. */
  readonly maintainerSet: ReadonlySet<string>;
  /** The founding standing by root in lower case, as the layer counts it (QX-1 section 2). */
  readonly founding: ReadonlyMap<string, number>;
  /** How the tracker reaches another tracker: the options', or the global fetch. */
  readonly fetchImpl: typeof fetch;
  /**
   * The challenge layer over every problem here at now, kept by the store's version and the five-second span of the
   * clock it was built in, and built afresh inside `exactly`.
   */
  readonly layer: () => Layer;
  /** Runs an admission with every layer it reads built afresh at now. */
  readonly exactly: <T>(admit: () => T | Promise<T>) => Promise<T>;
  /** What the reducer takes for a problem held here at now, or null. */
  readonly inputFor: (hash: Hash) => ReduceInput | null;
  /** The core's fold of a problem held here, or null. */
  readonly reduceProblem: (hash: Hash) => ReturnType<typeof reduce> | null;
  /** One problem's view in the layer, or null. */
  readonly view: (hash: Hash) => ProblemLayer | null;
  /** QX-6: what the maintainers have taken down here. */
  readonly hidden: () => Map<string, Hidden>;
  /**
   * QX-17: the coin over the layer given, or over the layer at now, computed at the time given or at now; null where
   * this tracker carries none.
   */
  readonly coin: (layered?: Layer, at?: string) => CoinLayer | null;
  /** QX-17: where the coin's log is kept: `here`, another tracker's address, or null where there is no coin. */
  readonly coinHome: () => string | null;
  /** QX-19: each piece's traces, grade and seams on a problem, read once per layer. */
  readonly tracesOf: (pl: ProblemLayer) => Map<Hash, PieceTraces>;
  /** QX-17 section 5: the burn rate the coin's home publishes, read once where its answer for a lock gives none. */
  homeRate: number | null;
}

/**
 * A request's target read as a URL against this tracker's address, or null where the URL reader cannot read it, as
 * `new URL` cannot read `//`, `//[` or `/\`.
 */
function readUrl(target: string, base: string): URL | null {
  try {
    return new URL(target, base);
  } catch {
    return null;
  }
}

/** The context a tracker's jobs share, built once from its options. */
function contextOf(options: TrackerOptions): Context {
  const { store } = options;
  const now = options.now ?? (() => new Date().toISOString());

  /**
   * What the reducer takes for a problem held here at now (`reduceInputOf`): its chain, the blobs, every line along the
   * chain and the identity log, each read whole; null where this store holds no such problem.
   */
  function inputFor(hash: Hash): ReduceInput | null {
    const envelope = store.envelopeOf(hash);
    return envelope ? reduceInputOf(store, envelope, now()) : null;
  }

  /** The core's state of a problem held here, or null; one whose input the core refuses is refused with its reason. */
  function reduceProblem(hash: Hash) {
    const input = inputFor(hash);
    if (!input) return null;
    try {
      return reduce(input);
    } catch (err) {
      throw cannotFold((err as Error).message);
    }
  }

  const maintainers: Address[] = options.maintainers ?? [];
  /** The founding standing by root in lower case, as the layer counts it. */
  const founding = new Map(Object.entries(options.founding ?? {}).map(([a, n]) => [a.toLowerCase(), n]));
  /** QX-6: what the maintainers have taken down here, read from the identity log each time. */
  function hidden(): Map<string, Hidden> {
    return maintainers.length ? hiddenNow(store.lines(IDENTITY_LOG), maintainers) : new Map();
  }

  /**
   * The layer as last built, by the store's version and the five-second span of the tracker's clock it was built in. A
   * read is answered from it while nothing has been written and the clock has not moved past that span: building it
   * reduces every problem here, which costs as much as the whole store. While an event is being admitted (`exact`
   * above zero), and for a coin lock another tracker admits against, the layer is built afresh at now.
   */
  let kept: { version: number; span: number; layer: Layer } | null = null;
  let exact = 0;
  const SPAN_MS = 5000;

  /** The challenge layer over every problem here: standing and the pool are functions of the whole store. */
  function layer(): Layer {
    if (exact > 0) return buildLayer();
    const span = Math.floor(Date.parse(now()) / SPAN_MS);
    if (kept && kept.version === store.version && kept.span === span) return kept.layer;
    const version = store.version;
    const built = buildLayer();
    kept = { version, span, layer: built };
    return built;
  }

  /**
   * The clock is read once, so every problem is reduced at the time the layer is folded at, and a reader given that
   * time and the chains the coin's state names folds the same (QX-17 section 6).
   */
  function buildLayer(): Layer {
    const at = now();
    const problems: ReduceInput[] = store.listEnvelopes().map((e) => reduceInputOf(store, e.envelope, at));
    return challengeLayer({
      problems,
      now: at,
      blobLength: (h) => store.blobLength(h),
      ...(options.coin ? { coin: store.lines(COIN_LOG) } : {}),
      ...(founding.size ? { founding } : {}),
    });
  }

  /** Runs an admission with `exact` above zero, so every layer it reads is built afresh at now. */
  async function exactly<T>(admit: () => T | Promise<T>): Promise<T> {
    exact += 1;
    try {
      return await admit();
    } finally {
      exact -= 1;
    }
  }

  /**
   * QX-17: the coin over the layer, from the coin log and the parameters, at the time given or at now; null where this
   * tracker carries none.
   */
  function coin(layered: Layer = layer(), at: string = now()): CoinLayer | null {
    return options.coin
      ? coinLayer({ layer: layered, params: options.coin, receipts: store.lines(COIN_LOG), now: at })
      : null;
  }
  const coinHome = (): string | null => (options.coin ? (options.coin.home ?? 'here') : null);

  function view(hash: Hash): ProblemLayer | null {
    return viewIn(layer(), hash);
  }

  /** QX-19: how long a blob here is, or null. */
  const blobLength = (h: Hash): number | null => store.blobLength(h);

  /** QX-19: a span of a blob here as text, or null where the blob is not here. */
  function passageOf(h: Hash, span: [number, number]): string | null {
    return passageIn(store.getBlob(h), span);
  }

  /**
   * QX-19: each piece's traces, grade and seams as trace.ts reads them for a problem (`problemTraces`), the passages
   * from this store's blobs.
   */
  // Computed once per layer object: the kept layer is one object until the store is written or five seconds pass,
  // and the index, the state and the directory row all read it, so the trace scan runs once for them and not per
  // request.
  const tracesMemo = new WeakMap<ProblemLayer, Map<Hash, PieceTraces>>();
  function tracesOf(pl: ProblemLayer): Map<Hash, PieceTraces> {
    const hit = tracesMemo.get(pl);
    if (hit) return hit;
    const out = problemTraces(pl, blobLength, passageOf);
    tracesMemo.set(pl, out);
    return out;
  }

  return {
    store,
    options,
    url: withSlash(options.url),
    now,
    limits: options.limits ?? { keyPerHour: 120, ipPerHour: 600 },
    stampNeeded: options.stamp?.name ?? 0,
    maintainerSet: new Set(maintainers.map((a) => a.toLowerCase())),
    founding,
    fetchImpl: options.fetchImpl ?? fetch,
    layer,
    exactly,
    inputFor,
    reduceProblem,
    view,
    hidden,
    coin,
    coinHome,
    tracesOf,
    homeRate: null,
  };
}

export function createTracker(options: TrackerOptions): Tracker {
  const cx = contextOf(options);
  const { store, url, limits, layer, reduceProblem, view, hidden, coin } = cx;
  const ipSalt = options.ipSalt ?? createHash('sha256').update(String(Math.random())).digest('hex');
  const pullDoor = pullDoorOf(cx);

  const trustedProxies = rangesOf(options.trustedProxies ?? PRIVATE_RANGES);
  const ipOf = (req: IncomingMessage): string => clientAddress(req, trustedProxies);
  const ipBucket = (req: IncomingMessage): string =>
    `ip:${createHash('sha256')
      .update(ipSalt + ipOf(req))
      .digest('hex')
      .slice(0, 16)}`;

  // The routes

  /**
   * A write held to its network address's hourly limit before it runs, after the row's guard and before the body is
   * read. Each row's own POST and PUT is one, and routes.test.ts holds that.
   */
  const limited =
    (run: Handler): Handler =>
    (asked) => {
      limit(cx, ipBucket(asked.req), limits.ipPerHour);
      return run(asked);
    };
  const noRoute = (): never => {
    throw new Refusal(404, 'no such route');
  };

  /**
   * The door's routes, one row each, in the order `handle` tries them; the well-known document lists their paths in the
   * same order. What a row holds is in routes.ts.
   */
  const routes: Route[] = [
    { path: '/.well-known/quilt', listed: false, GET: ({ res }) => json(res, 200, wellKnown(cx, routes)) },
    // The problems: published, served by hash, their events, states and what the extensions compute. A path naming a
    // problem not held here is 404 whatever the method; under one held here, a method the row does not take is 405.
    { path: '/p', POST: limited(({ req, res }) => publish(cx, req, res)) },
    {
      path: '/p/<hash>',
      guard: 'problem',
      GET: ({ res, hash }) => json(res, 200, store.getEnvelope(hash!)!.envelope),
      otherwise: 405,
    },
    {
      path: '/p/<hash>/events',
      guard: 'problem',
      GET: ({ res, query, hash }) => events(store, res, hash!, Number(query.get('since') ?? 0)),
      POST: limited(({ req, res, hash }) => postEvent(cx, req, res, { kind: 'problem', hash: hash! })),
      otherwise: 405,
    },
    {
      path: '/p/<hash>/state',
      guard: 'problem',
      GET: ({ res, hash }) => json(res, 200, state(cx, hash!, view(hash!)!)),
      otherwise: 405,
    },
    {
      path: '/p/<hash>/scrape',
      guard: 'problem',
      GET: ({ res, hash }) => json(res, 200, scrape(cx, hash!)),
      otherwise: 405,
    },
    {
      path: '/p/<hash>/next',
      guard: 'problem',
      GET: ({ res, query, hash }) => assisted(cx, res, hash!, query),
      otherwise: 405,
    },
    {
      path: '/p/<hash>/challenges',
      guard: 'problem',
      GET: ({ res, hash }) => json(res, 200, challengesOf(cx, hash!)),
      otherwise: 405,
    },
    {
      path: '/p/<hash>/panels',
      guard: 'problem',
      GET: ({ res, hash }) => json(res, 200, panelsOf(cx, hash!)),
      otherwise: 405,
    },
    {
      path: '/p/<hash>/record',
      guard: 'problem',
      GET: ({ res, hash }) => json(res, 200, recordOf(cx, hash!)),
      otherwise: 405,
    },
    // The identity log, which any method but POST lists, and a key's standing and work.
    {
      path: '/k/events',
      GET: ({ res, query }) => events(store, res, IDENTITY_LOG, Number(query.get('since') ?? 0)),
      POST: limited(({ req, res }) => postEvent(cx, req, res, { kind: 'identity' })),
      otherwise: 'GET',
    },
    { path: '/k/<address>/standing', GET: ({ res, address }) => json(res, 200, standingOf(cx, address!)) },
    { path: '/k/<address>/work', GET: ({ res, query, address }) => json(res, 200, workBy(cx, address!, query)) },
    // Blobs and names.
    {
      path: '/b/<hash>',
      PUT: limited(({ req, res, hash }) => keepBlob(store, req, res, hash!)),
      GET: ({ res, hash }) => blob(store, res, hash!),
    },
    { path: '/n/<owner>/<slug>', GET: ({ res, owner, slug }) => json(res, 200, named(store, owner!, slug!)) },
    // The index: the front page and the search, the offer, what is taken down, and the launch funnel.
    {
      path: '/',
      listed: false,
      GET: ({ res, query }) => json(res, 200, { quilt: 1, tracker: url, problems: index(cx, query) }),
    },
    { path: '/search', GET: ({ res, query }) => json(res, 200, { problems: index(cx, query) }) },
    { path: '/offer', GET: ({ res, query }) => offer(cx, res, query) },
    { path: '/hidden', GET: ({ res }) => json(res, 200, { hidden: [...hidden().values()] }) },
    { path: '/counts', GET: ({ res, query }) => json(res, 200, countsOf(cx, query)) },
    // The coin (QX-17): its log, which any method but POST lists, and what the layer computes from it. Every path under
    // /coin is the coin's, 404 on a tracker that carries none; on one that does, a method a row does not take is 405.
    {
      path: '/coin/events',
      guard: 'coin',
      GET: ({ res, query }) => events(store, res, COIN_LOG, Number(query.get('since') ?? 0)),
      POST: limited(({ req, res }) => postEvent(cx, req, res, { kind: 'coin' })),
      otherwise: 'GET',
    },
    {
      path: '/coin/lock/<id>',
      guard: 'coin',
      GET: ({ res, id }) => json(res, 200, coinLock(cx, id!)),
      otherwise: 405,
    },
    {
      path: '/coin/balance/<root>',
      guard: 'coin',
      GET: ({ res, root }) => json(res, 200, coinBalance(cx, root!)),
      otherwise: 405,
    },
    {
      path: '/coin/epochs',
      guard: 'coin',
      GET: ({ res, query }) => json(res, 200, coinEpochs(cx, query)),
      otherwise: 405,
    },
    {
      path: '/coin/redeems',
      guard: 'coin',
      GET: ({ res, query }) => json(res, 200, coinRedeems(cx, query)),
      otherwise: 405,
    },
    {
      path: '/coin/credits',
      guard: 'coin',
      GET: ({ res, query }) => json(res, 200, coinCredits(cx, query)),
      otherwise: 405,
    },
    { path: '/coin/state', guard: 'coin', GET: ({ res }) => json(res, 200, coinState(cx)), otherwise: 405 },
    // Any other path under /coin: a GET finds no route, and any other method is told GET.
    { path: '/coin/*', listed: false, guard: 'coin', GET: noRoute, otherwise: 405 },
  ];

  /**
   * Answers a request: OPTIONS on every path; then the first row whose path takes the request's, its guard asked
   * before its method; then the routes mounted beside the tracker; then 404. A path the URL reader cannot read, such
   * as `//`, is a route the door does not have: no row and no route beside it can read it either, so it is 404 as an
   * unknown path is. A refusal is written as `{ error }` with its status, and anything else that fails as 500.
   */
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const method = req.method ?? 'GET';
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
        });
        res.end();
        return;
      }
      const u = readUrl(req.url ?? '/', url);
      if (!u) return noRoute();
      const path = u.pathname.replace(/\/+$/, '') || '/';
      const found = routeOf(routes, path);
      if (found) {
        const { route, segments } = found;
        if (route.guard === 'problem' && !store.getEnvelope(segments.hash!))
          throw new Refusal(404, 'no such problem here');
        if (route.guard === 'coin' && !options.coin) throw new Refusal(404, 'this tracker carries no coin');
        const run = handlerOf(route, method);
        if (run) return await run({ req, res, query: u.searchParams, ...segments });
        if (route.otherwise === 405) throw new Refusal(405, 'GET');
      }
      if (options.extra && (await options.extra(req, res, u))) return;
      noRoute();
    } catch (err) {
      if (err instanceof Refusal) json(res, err.status, { error: err.message });
      else {
        json(res, 500, { error: 'the tracker failed' });
        console.error(err);
      }
    }
  }

  function listen(port: number, host = '127.0.0.1'): Promise<Server> {
    const server = createServer((req, res) => void handle(req, res));
    return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
  }

  return {
    handle,
    listen,
    routes,
    reduceProblem,
    layer,
    view,
    coin: () => coin(),
    pullPeers: () => pullPeers(pullDoor),
  };
}
