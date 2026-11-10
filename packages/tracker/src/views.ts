/**
 * What the tracker's door answers a read with (PROTOCOL.md, The tracker): what it says of itself at the well-known
 * document; a problem's state, the layer's beside the core's, with the square a fork's piece inherits (QX-23); its
 * summary as the index and the scrape show it, and the search; its challenges (QX-1), panels (QX-2), record document
 * (QX-20) and proposed pieces (QX-22); a key's standing (QX-15) and its latest readings; the launch funnel; a chain's
 * lines a page at a time (QX-11); a blob and a name; and the coin as the layer computes it (QX-17). Each writes
 * nothing, and the table of routes in tracker.ts ties each to its path. A view takes what it reads: the store alone, a
 * problem's layer alone, or the views' part of the tracker's context, `Reads`, which leaves out `exactly`, so a read
 * cannot ask for the layer built afresh, and what only the door reads.
 */
import type { ServerResponse } from 'node:http';
import { type Address, type Hash, isAddress, shortHead, verifyChain, IDENTITY_LOG } from '@bitquilt/core';
import {
  type Layer,
  type ProblemLayer,
  CHALLENGE,
  CHALLENGE_SEED,
  GROUND_MAX,
  MAJORITY,
  PANEL,
  countsAsAccepted,
  refusedHere,
} from './challenge.js';
import { type CoinFolded, type CoinLayer, type LogHead, COIN, COIN_LOG } from './coin.js';
import { DAYS_MAX, daysFrom, funnel } from './counts.js';
import { GOLD, windowOpen } from './gold.js';
import { HIDE } from './hide.js';
import { Refusal } from './http.js';
import { INHERIT } from './inherit.js';
import { PEER_PULL, PEER_PULL_EVERY_MS } from './peers.js';
import { PROPOSE, PROPOSED_MAX, PROPOSE_WHY_MAX, proposalsIn } from './propose.js';
import type { Route } from './routes.js';
import { RECIPROCITY, SEEDING, seedInfo } from './seeding.js';
import { STAKE } from './stake.js';
import type { Store } from './store.js';
import { BLOB_MAX, RECORD, TRACE, recordOutput } from './trace.js';
import type { Context } from './tracker.js';
import { EXTENSIONS, JUDGE_SEED } from './verifiers.js';
import { witnessedReveals } from './witness.js';

/** What the views read of the tracker's context (tracker.ts). */
type Reads = Pick<
  Context,
  | 'store'
  | 'options'
  | 'url'
  | 'now'
  | 'limits'
  | 'stampNeeded'
  | 'founding'
  | 'layer'
  | 'view'
  | 'hidden'
  | 'coin'
  | 'coinHome'
  | 'tracesOf'
>;

/**
 * What this tracker says of itself: its name, limits, the extensions it carries with their constants, and its routes.
 */
export function wellKnown({ options, url, limits, stampNeeded, coinHome, coin, now }: Reads, routes: readonly Route[]) {
  return {
    quilt: 1,
    tracker: options.name ?? url,
    url,
    peers: options.peers ?? [],
    limits,
    stamp: { name: stampNeeded },
    sortition: CHALLENGE_SEED,
    challenge: { extension: CHALLENGE, panel: PANEL, majority: MAJORITY, ground_max: GROUND_MAX },
    verifiers: {
      human: EXTENSIONS.human,
      'judge:n': EXTENSIONS.judge,
      attest: EXTENSIONS.attest,
      'record:n': EXTENSIONS.record,
      judge_seed: JUDGE_SEED,
    },
    chain: 'QX-11',
    pull: options.peers?.length ? { extension: PEER_PULL, every_ms: PEER_PULL_EVERY_MS } : null,
    seeding: SEEDING,
    reciprocity: RECIPROCITY,
    hide: HIDE,
    maintainers: options.maintainers ?? [],
    founding: options.founding ?? {},
    identity: IDENTITY_LOG,
    hosted: options.extra !== undefined,
    ...(options.extraWellKnown?.() ?? {}),
    // `stake.burn_rate` is the rate in force now, which with `burn_indexed` moves with the epochs; `coin.burn_rate`
    // is the parameter, its floor.
    stake: { extension: STAKE, coin: coinHome(), ...(options.coin ? { burn_rate: coin()!.burnRateAt(now()) } : {}) },
    gold: { extension: GOLD },
    trace: { extension: TRACE, blob_max: BLOB_MAX },
    record: { extension: RECORD },
    propose: { extension: PROPOSE, piece_max: PROPOSED_MAX, why_max: PROPOSE_WHY_MAX },
    inherit: { extension: INHERIT },
    coin: options.coin ? { extension: COIN, ...options.coin, home: coinHome() } : null,
    // The paths a client reads: the listed rows of the door's table, in the order `handle` tries them, and the coin's
    // only where this tracker carries the coin.
    routes: routes
      .filter((r) => r.listed !== false && (r.guard !== 'coin' || Boolean(options.coin)))
      .map((r) => r.path),
  };
}

/**
 * The work on a problem in numbers (APP.md, Search): what the directory shows beside the counts, so a reader can tell
 * how much is done and of what quality without the state. `returned` counts pieces with a kept reveal or run over the
 * layer's fold, `accepted` and `disputed` the layer's states, `verified` the squares the owner's gold matched
 * (QX-16), `traced` the accepted squares by their grade (QX-19 section 3; a square accepted by runs or attest is in
 * none of the three), `readers` the distinct roots that revealed or ran, `vendors` the distinct vendors among them,
 * and `last` the receipt time of the latest reveal or run. `declined` counts the roots that declined a piece, a
 * model's refusal among them, so a piece nobody would read is seen beside the work. `found` is what the accepted
 * squares say: for each agreed field whose schema is a list of choices, how many accepted squares agreed on each
 * choice ("status: 3 proved, 6 open"), a count and nothing more.
 */
function workOf(
  { tracesOf }: Reads,
  pl: ProblemLayer,
): {
  returned: number;
  accepted: number;
  verified: number;
  disputed: number;
  traced: { both: number; one: number; none: number };
  readers: number;
  vendors: number;
  last: string | null;
  recorded: number;
  declined: number;
  found: Record<string, Record<string, number>>;
} {
  const traced = { both: 0, one: 0, none: 0 };
  const found: Record<string, Record<string, number>> = Object.create(null);
  let declined = 0;
  let returned = 0;
  let accepted = 0;
  let verified = 0;
  let disputed = 0;
  let recorded = 0;
  const roots = new Set<string>();
  const vendors = new Set<string>();
  let last: string | null = null;
  const grades = tracesOf(pl);
  for (const v of pl.fold.pieces) {
    const l = pl.byHash.get(v.piece.hash);
    if (!l) continue;
    if (v.reveals.length || v.runs.length) returned += 1;
    declined += v.declined.size;
    if (countsAsAccepted(l.state)) {
      accepted += 1;
      const g = grades.get(v.piece.hash)?.traced;
      if (g) traced[g] += 1;
      if (v.accepting?.kind === 'agree') {
        for (const field of v.piece.agree ?? []) {
          const choices = (v.piece.schema?.properties?.[field] as { enum?: unknown[] } | undefined)?.enum;
          const value = (v.accepting.reveals[0].return as Record<string, unknown>)[field];
          if (!Array.isArray(choices) || typeof value !== 'string' || !choices.includes(value)) continue;
          const byValue = (found[field] ??= Object.create(null) as Record<string, number>);
          byValue[value] = (byValue[value] ?? 0) + 1;
        }
      }
    }
    if (l.state === 'disputed' || l.state === 'challenged') disputed += 1;
    if (l.state === 'recorded') recorded += 1;
    if (l.verified) verified += 1;
    for (const r of v.reveals) {
      roots.add(r.root);
      vendors.add(r.vendor);
      if (last === null || r.at > last) last = r.at;
    }
    for (const r of v.runs) {
      roots.add(r.root);
      if (last === null || r.at > last) last = r.at;
    }
  }
  return {
    returned,
    accepted,
    verified,
    disputed,
    traced,
    readers: roots.size,
    vendors: vendors.size,
    last,
    recorded,
    declined,
    found,
  };
}

/**
 * A problem's view in a layer, or null where the store holds no such problem. A problem the store holds whose input the
 * core refuses has no state (CORE.md section 6), so a read that needs its view is refused with the core's reason.
 */
export function viewIn(layered: Layer, hash: Hash): ProblemLayer | null {
  const pl = layered.problems.get(hash);
  if (pl) return pl;
  const why = layered.refused.get(hash);
  if (why !== undefined) throw cannotFold(why);
  return null;
}

/** The refusal of a problem held here whose input the core refuses (CORE.md section 6), with the core's reason. */
export function cannotFold(why: string): Refusal {
  return new Refusal(503, refusedHere(why));
}

/**
 * A problem in one line for the index and the scrape: its title, counts, head, the work on it, and what the
 * extensions add.
 */
function summary(cx: Reads, hash: Hash, layered: Layer = cx.layer()) {
  const { store, hidden } = cx;
  const pl = layered.problems.get(hash);
  if (!pl) return null;
  const s = pl.fold;
  const counts: Record<string, number> = {};
  for (const v of pl.pieces) counts[v.state] = (counts[v.state] ?? 0) + 1;
  const kinds: Record<string, number> = Object.create(null);
  for (const v of s.pieces) kinds[v.piece.verifier] = (kinds[v.piece.verifier] ?? 0) + 1;
  const head = store.head(hash);
  const seed = seedInfo(pl.receipts, pl.fold, layered.now);
  return {
    problem: hash,
    title: s.envelope.problem.title,
    slug: s.envelope.problem.slug,
    owner: s.envelope.problem.owner,
    owner_name: nameIn(pl)(s.envelope.problem.owner),
    from: s.envelope.problem.from ?? null,
    done_when: s.envelope.problem.done_when,
    pieces: s.pieces.length,
    counts,
    kinds,
    work: workOf(cx, pl),
    // QX-23 section 4: complete is the layer's, which counts a square inherited from a final one; the output is the
    // core's, so a fork complete by inheritance has none.
    complete: pl.complete,
    output: s.output?.hash ?? null,
    last: head?.at ?? null,
    // QX-11 section 4: the head and its short form, the core's.
    head: head ? { seq: head.seq, hash: head.hash, short: shortHead(head.hash) } : null,
    versions: s.chain.length,
    challenges: pl.challenges.length,
    seeders: seed.seeders.size,
    last_seeded: seed.last_seeded,
    panels: pl.panels.length,
    hidden: hidden().get(hash) ?? null,
  };
}

/**
 * A problem's state as the layer has it, with the core's beside each piece: a core client reads `core`, one with the
 * extensions reads `state`, and the kind says how the square is earned and how strongly. `window_open` says whether a
 * reveal of the owner's gold is taken on the piece at `now`, which `state` does not say under an open challenge
 * (QX-16).
 */
export function state({ store, now, hidden, tracesOf }: Reads, hash: Hash, layered: Layer) {
  const pl = viewIn(layered, hash)!;
  const s = pl.fold;
  const at = now();
  const witnessed = witnessedReveals(store, hash);
  const traced = tracesOf(pl);
  return {
    problem: hash,
    now: at,
    hidden: hidden().get(hash) ?? null,
    stake_rule: pl.stake,
    pieces: s.pieces.map((v) => {
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
        availability: v.availability,
        dependents: v.dependents,
        reveals: v.reveals.length,
        claims: v.claims.length,
        stake: l.stake,
        gold: l.gold,
        verified: l.verified,
        window_open: windowOpen(v, at),
        witnessed: witnessed.get(v.piece.hash) ?? [],
        traces: t.traces.length,
        traced: t.traced,
        seams: t.seams,
        aside: l.aside,
        record: t.record,
        // QX-23 section 2: where the state is `inherited`, the problem where the square stands and its state there.
        inherited: l.inherited,
      };
    }),
    gold: pl.goldCount,
    complete: pl.complete,
    output: s.output?.hash ?? null,
    record_output: recordOutput(pl)?.hash ?? null,
    dropped: [...s.dropped, ...pl.dropped],
    superseded: supersededBy(store, hash, layered),
  };
}

/**
 * A problem in one line with its chain checked, and with the topics every announce gave it, as the index shows them,
 * so the owner's turn can announce again with the same (QX-13 section 3).
 */
export function scrape(cx: Reads, hash: Hash) {
  const { store } = cx;
  const layered = cx.layer();
  viewIn(layered, hash);
  const chain = verifyChain(store.lines(hash), hash);
  const topics = [
    ...new Set(
      store
        .announcements(hash)
        .flatMap((a) => ((a.event.body as { topics?: string[] }).topics ?? []).map((x) => x.toLowerCase())),
    ),
  ];
  return { ...summary(cx, hash, layered), topics, chain_ok: chain.ok };
}

/**
 * QX-20 section 4: the record document, once the layer calls the problem complete; its hash is the state's
 * `record_output`.
 */
export function recordOf({ view }: Reads, hash: Hash) {
  const pl = view(hash);
  const doc = pl ? recordOutput(pl) : null;
  if (!doc) throw new Refusal(404, 'no record document yet: the problem is not complete, or has no record piece');
  return { hash: doc.hash, ...(doc.document as Record<string, unknown>) };
}

/**
 * The newest envelope here by the same owner whose `prev` is this problem: the version that replaced it, or null. The
 * state says so, and `next` hands nothing on a replaced problem. A version the core refuses has no state
 * (CORE.md section 6), so it replaces nothing: the work stays on the version before it.
 */
export function supersededBy(store: Store, hash: Hash, layered: Layer): Hash | null {
  const owner = store.getEnvelope(hash)?.envelope.problem.owner;
  if (!owner) return null;
  return (
    store
      .listEnvelopes()
      .find(
        (e) => e.envelope.problem.prev === hash && e.envelope.problem.owner === owner && !layered.refused.has(e.hash),
      )?.hash ?? null
  );
}

/**
 * The problems here their owners have replaced with a newer version, left out of the index and the offer: the work is
 * on the versions that replaced them. A version the core refuses replaces nothing, as `supersededBy` says.
 */
export function replaced(store: Store, layered: Layer): Set<Hash> {
  const out = new Set<Hash>();
  const byHash = new Map(store.listEnvelopes().map((e) => [e.hash, e] as const));
  for (const e of byHash.values()) {
    const prev = e.envelope.problem.prev;
    if (layered.refused.has(e.hash)) continue;
    if (prev && byHash.get(prev)?.envelope.problem.owner === e.envelope.problem.owner) out.add(prev);
  }
  return out;
}

/** The name a root chose, as the problem's fold has it, or null. */
function nameIn(pl: ProblemLayer): (a: string) => string | null {
  return (a) => pl.fold.names.get(a as Address)?.name ?? null;
}

/**
 * A problem's challenges as the tracker computes them at now: the seats, each verdict with its judge, the outcome.
 */
function challenges(pl: ProblemLayer, name: (a: string) => string | null) {
  return pl.challenges.map((c) => ({
    id: c.id,
    piece: c.piece,
    name: pl.byHash.get(c.piece)?.name ?? null,
    key: c.key,
    root: c.root,
    challenger: name(c.root),
    at: c.at,
    stake: c.stake,
    ground: c.ground,
    against: c.against,
    parties: c.parties,
    seed: c.seed,
    panel: PANEL,
    majority: MAJORITY,
    seats: c.seats.map((s) => ({
      root: s.root,
      judge: name(s.root),
      offered_at: s.offeredAt,
      lapsed_at: s.lapsedAt,
      verdict: s.verdict ? { id: s.verdict.id, at: s.verdict.at, for: s.verdict.for, return: s.verdict.return } : null,
    })),
    outcome: c.outcome,
    decided_at: c.decidedAt,
    struck: c.struck,
    dropped: c.dropped,
  }));
}

/**
 * A problem's judge panels as the tracker computes them at now: the candidates by digest (their signers named once
 * the panel has decided), the seats, each rank, the outcome.
 */
function panels(pl: ProblemLayer, name: (a: string) => string | null) {
  return pl.panels.map((p) => ({
    piece: p.piece,
    name: p.name,
    verifier: pl.byHash.get(p.piece)?.kind.verifier ?? null,
    panel: p.panel,
    majority: p.majority,
    wanted: p.wanted,
    seed: p.seed,
    completed_at: p.completedAt,
    candidates: p.candidates.map((c) =>
      p.outcome === 'decided'
        ? { digest: c.digest, return: c.return, root: c.root, signer: name(c.root) }
        : { digest: c.digest, return: c.return },
    ),
    seats: p.seats.map((s) => ({
      root: s.root,
      judge: name(s.root),
      offered_at: s.offeredAt,
      lapsed_at: s.lapsedAt,
      rank: s.rank ? { id: s.rank.id, at: s.rank.at, ranking: s.rank.ranking } : null,
    })),
    outcome: p.outcome,
    winner: p.winner,
    decided_at: p.decidedAt,
    dropped: p.dropped,
  }));
}

/** A problem's challenges at now, with the problem and the time. */
export function challengesOf({ view, now }: Reads, hash: Hash) {
  const pl = view(hash)!;
  return { problem: hash, now: now(), challenges: challenges(pl, nameIn(pl)) };
}

/** A problem's judge panels at now, with the problem and the time. */
export function panelsOf({ view, now }: Reads, hash: Hash) {
  const pl = view(hash)!;
  return { problem: hash, now: now(), panels: panels(pl, nameIn(pl)) };
}

/**
 * A problem's proposed pieces at now, with the problem and the time (QX-22 section 5). A fork is listed as pursuing a
 * piece only where this tracker lists the fork: not replaced by its owner, and not taken down here (QX-6). Which
 * versions are replaced is read from every envelope held, so it is asked only once a fork is weighed.
 */
export function proposalsOf({ store, layer, view, hidden, now }: Reads, hash: Hash) {
  const pl = view(hash)!;
  const layered = layer();
  const hid = hidden();
  let gone: Set<Hash> | null = null;
  const listed = (problem: Hash): boolean => {
    if (hid.has(problem)) return false;
    gone ??= replaced(store, layered);
    return !gone.has(problem);
  };
  return { problem: hash, now: now(), proposals: proposalsIn(pl, layered, listed, nameIn(pl)) };
}

/**
 * The problems here, each in summary with its topics (QX-13), those matching `q` when one is given; hidden ones left
 * out.
 */
export function index(cx: Reads, query: URLSearchParams) {
  const { store, layer, hidden } = cx;
  const q = (query.get('q') ?? '').trim().toLowerCase();
  const topicsByProblem = new Map<Hash, Set<string>>();
  for (const a of store.announcements()) {
    const set = topicsByProblem.get(a.problem) ?? new Set<string>();
    for (const t of (a.event.body as { topics?: string[] }).topics ?? []) set.add(t.toLowerCase());
    topicsByProblem.set(a.problem, set);
  }
  const out: unknown[] = [];
  const layered = layer();
  const hid = hidden();
  const gone = replaced(store, layered);
  for (const e of store.listEnvelopes()) {
    if (hid.has(e.hash) || gone.has(e.hash)) continue;
    const topics = [...(topicsByProblem.get(e.hash) ?? [])];
    const hay =
      `${e.envelope.problem.title} ${e.envelope.problem.slug} ${e.envelope.problem.done_when} ${topics.join(' ')}`.toLowerCase();
    if (q && !hay.includes(q)) continue;
    const s = summary(cx, e.hash, layered);
    if (s) out.push({ ...s, topics });
  }
  return out;
}

/** QX-15: a key's standing, what is locked behind its claims, what is free, and the locks themselves. */
export function standingOf({ layer, founding }: Reads, address: string) {
  if (!isAddress(address)) throw new Refusal(400, 'an address with its checksum');
  const layered = layer();
  const root = layered.rootOf(address);
  return {
    address,
    root,
    standing: layered.standing(root),
    locked: layered.locked(root),
    free: layered.free(root),
    founding: founding.get(root.toLowerCase()) ?? 0,
    locks: layered.liveLocks(root).map((l) => ({ problem: l.problem, piece: l.piece, amount: l.amount, at: l.at })),
    at: layered.now,
  };
}

/**
 * The directory's hot list (APP.md, "The window"): a key's latest readings, newest first, each with its state and
 * grade as this tracker holds them, and `aside` where the layer set this key's reading aside (QX-19 section 4).
 * Receipts are by key, so a delegate's readings sit under the delegate's address; the root is said beside it.
 */
export function workBy({ store, layer, tracesOf }: Reads, address: string, query: URLSearchParams) {
  if (!isAddress(address)) throw new Refusal(400, 'an address with its checksum');
  const asked = Number(query.get('limit') ?? 20);
  const limit = Math.min(50, Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 20));
  const layered = layer();
  const root = layered.rootOf(address);
  const readings = store.revealsBy(address, limit).flatMap((r) => {
    const pl = layered.problems.get(r.problem);
    const l = pl?.byHash.get(r.piece);
    if (!pl || !l) return [];
    return [
      {
        problem: r.problem,
        title: pl.fold.envelope.problem.title,
        piece: r.piece,
        name: l.name,
        at: r.at,
        state: l.state,
        aside: l.aside.includes(address),
        verified: l.verified,
        traced: tracesOf(pl).get(r.piece)?.traced ?? null,
      },
    ];
  });
  const first = layered.problems.values().next().value as ProblemLayer | undefined;
  return {
    address,
    root,
    name: first ? nameIn(first)(root) : null,
    standing: layered.standing(root),
    readings,
    at: layered.now,
  };
}

/** A blob's bytes as this store keeps them. */
export function blob(store: Store, res: ServerResponse, hash: Hash): void {
  const bytes = store.getBlob(hash);
  if (!bytes) throw new Refusal(404, 'no such blob here');
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' });
  res.end(Buffer.from(bytes));
}

/** The problem an owner's slug names here, as the owner's version events set it. */
export function named(store: Store, owner: string, slug: string) {
  const hash = store.getName(owner, slug);
  if (!hash) throw new Refusal(404, 'no such name here');
  return { hash };
}

/**
 * The launch funnel by the UTC day (docs/DEPLOY.md, "Keeping it"): counts with nobody in them, so the route is public.
 */
export function countsOf({ store, layer, now }: Reads, query: URLSearchParams) {
  const days = daysFrom(query.get('days'));
  if (days === null) throw new Refusal(400, `days: a whole number from 1 to ${DAYS_MAX}`);
  return funnel({
    members: store.memberTimes(),
    logs: store.listEnvelopes().map((e) => store.lines(e.hash)),
    layer: layer(),
    now: now(),
    days,
  });
}

/** A chain's lines after `since`, a page at a time, as newline-delimited JSON; the header names the next page. */
export function events(store: Store, res: ServerResponse, hash: Hash, since: number): void {
  const page = 500;
  const lines = store.receipts(hash, since, page + 1);
  const more = lines.length > page;
  const out = more ? lines.slice(0, page) : lines;
  const headers: Record<string, string> = {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'access-control-allow-origin': '*',
  };
  if (more) headers['x-quilt-next-since'] = String(out[out.length - 1]!.seq);
  res.writeHead(200, headers);
  res.end(out.map((l) => JSON.stringify(l)).join('\n') + (out.length ? '\n' : ''));
}

/** A chain's head at a sequence: that line's seq and hash, or null where the chain is shorter. */
function headAt(store: Store, hash: Hash, seq: number): { seq: number; hash: string } | null {
  const line = store.receipts(hash, Math.max(0, seq - 1), 1)[0];
  return line && line.seq === seq && typeof line.hash === 'string' ? { seq: line.seq, hash: line.hash } : null;
}

/**
 * The coin log's head a listing stands under: the head itself, or the line at the query's `upto` when that is
 * earlier.
 */
function headUpto(
  store: Store,
  c: CoinLayer,
  query: URLSearchParams,
): { head: { seq: number; hash: string } | null; upto: number | undefined } {
  const asked = query.get('upto');
  const n = asked === null ? null : Number(asked);
  if (n !== null && (!Number.isInteger(n) || n < 0)) throw new Refusal(400, 'upto: a whole number');
  const head = n === null || c.head === null || n >= c.head.seq ? c.head : headAt(store, COIN_LOG, n);
  return { head, upto: n ?? undefined };
}

/** QX-17 section 5: a lock on the coin log, under the head it stands under, with the burn rate in force. */
export function coinLock({ coin }: Reads, id: Hash) {
  const c = coin()!;
  const lock = c.lock(id);
  if (!lock) throw new Refusal(404, 'no such lock on the coin log');
  return { ...lock, head: c.head, at: c.now, rate: c.burnRateAt(c.now) };
}

/** QX-17: a root's balance and what is pending for it, under the coin log's head. */
export function coinBalance({ layer, coin }: Reads, address: string) {
  if (!isAddress(address)) throw new Refusal(400, 'an address with its checksum');
  const layered = layer();
  const c = coin(layered)!;
  const root = layered.rootOf(address, c.now);
  return { ...c.balance(root), pending: c.pending(root), at: c.now, head: c.head };
}

/** QX-17: the epochs from `since` on, under the coin log's head. */
export function coinEpochs({ coin }: Reads, query: URLSearchParams) {
  const since = Number(query.get('since') ?? 0);
  const c = coin()!;
  return { epochs: c.epochs().filter((e) => e.epoch >= since), at: c.now, head: c.head };
}

/**
 * The door out: the redeem lines the layer kept, each the chain line's hash the ERC-20 mints against once, under the
 * head they stand under.
 */
export function coinRedeems({ store, coin }: Reads, query: URLSearchParams) {
  const c = coin()!;
  const { head, upto } = headUpto(store, c, query);
  return { head, at: c.now, redeems: c.redeems(upto) };
}

/**
 * The way back: the credit lines the layer kept, each a deposit burned on the chain, under the head they stand under;
 * what the mirror checks against the chain.
 */
export function coinCredits({ store, options, coin }: Reads, query: URLSearchParams) {
  const c = coin()!;
  const { head, upto } = headUpto(store, c, query);
  return { head, at: c.now, reader: options.coin?.reader ?? null, credits: c.credits(upto) };
}

/**
 * QX-17 section 6: the coin as this tracker computes it (`coinAt`), the parameters, every balance and what was dropped,
 * with what the balances were folded over (`foldedOver`), for the mirror.
 */
export function coinState({ store, options, layer, coin, coinHome, now }: Reads) {
  const layered = layer();
  const c = coin(layered, coinAt(layered.now, now()))!;
  return {
    head: c.head,
    at: c.now,
    params: { extension: COIN, ...options.coin, home: coinHome() },
    balances: Object.fromEntries(c.balances()),
    dropped: c.dropped,
    folded: foldedOver(store, layered),
  };
}

/** How long after the layer's time the coin's state can be computed at (QX-17 section 6). */
const FOLDED_WITHIN_MS = 5000;

/**
 * QX-17 section 6: the state's `at`, where folded `at` "is the state's own `at` or up to five seconds before it". The
 * coin is computed at the clock's time, held to that span after the time the layer was folded at: a layer kept from
 * the start of its five seconds and read as they turn, or one built for this answer by a fold that took longer than
 * five seconds, gives the time five seconds after the layer's, and a clock set back gives the layer's own. Nothing is
 * written between building the layer and computing the coin, so the coin reads the coin log the layer folded.
 */
function coinAt(folded: string, clock: string): string {
  const from = Date.parse(folded);
  const at = Date.parse(clock);
  if (at < from) return folded;
  return at - from <= FOLDED_WITHIN_MS ? clock : new Date(from + FOLDED_WITHIN_MS).toISOString();
}

/**
 * What the coin's balances were folded over (QX-17 section 6): the time the layer was folded at, each problem it
 * folded in its order with its chain's head, and the identity log's head. The layer is the one `layer()` gives, kept
 * from an earlier read or built for this answer, at the store's version now; nothing is written between reading it
 * and reading the heads, so they are the heads it folded, and the coin is computed no later than five seconds after
 * its time (`coinAt`). Every problem here is named, hidden and replaced ones too, and each is still served by hash,
 * a hidden one as QX-6 section 3 says: those the layer folded among the problems, and those whose input the core
 * refuses, which have no state (CORE.md section 6), among the refused, since a later version's fold reads their
 * chains.
 */
function foldedOver(store: Store, layered: Layer): CoinFolded {
  const headOf = (log: Hash): LogHead => {
    const h = store.head(log);
    return h ? { seq: h.seq, hash: h.hash } : null;
  };
  return {
    at: layered.now,
    problems: [...layered.problems.keys()].map((problem) => ({ problem, head: headOf(problem) })),
    refused: [...layered.refused.keys()].map((problem) => ({ problem, head: headOf(problem) })),
    identity: headOf(IDENTITY_LOG),
  };
}
