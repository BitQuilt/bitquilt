/**
 * The mirror (PROTOCOL.md, The mirror): the one automated writer to a repository's main, and the keeper. It pulls from
 * the sources it is given, a tracker by its index or a node by its held list (`node: true` in the well-known), and from
 * each configured source's peers one hop behind it; checks every envelope against its hash, every blob against its hash
 * and every chain from its problem's hash; and writes the layout a client reads raw. A problem it already holds files
 * for is taken by hash whether or not the source still lists it, so a problem hidden or replaced at its source stays
 * in the index and its chain keeps growing here; and the reads the chain's traces name (QX-19) are fetched under their
 * hashes beside the data blobs. A chain is a resolver's own, and the mirror's is its own (NODE.md section 5): each
 * source's chain is verified whole, and every event the mirror lacks, by id, whose shape and signature hold, is
 * appended in the source's order with the source's wrappers kept and the mirror's added, so the mirror's chain is the
 * union of its sources' events and only grows; the coin log alone is copied whole, one sequence, and refused where it
 * did anything but grow:
 *
 *   problems/<hash>.json   blobs/<hash>   ledger/<hash>.jsonl   ledger/identity.jsonl   ledger/coin.jsonl (QX-17)
 *   names/<owner>/<slug>   outputs/<hash>/output.json   outputs/<hash>/record.json (QX-20)   keys.json   index.json
 *   coin/balances.json   anchors/<problem>/<seq>.ots (QX-12, when asked)
 *
 * No `.head` file is written: the head is the ledger file's last line, stamped under `anchors/`. The mirror reads no
 * chain itself; the bin hands it one when the environment names it.
 *
 * The coin (QX-17) is held to the same rule as a chain: the mirror recomputes every balance with the tracker's own
 * layer code, so what it checks is the receipts and the heads, not the arithmetic; a second implementation of coin.ts
 * would check that. It folds what the home's `/coin/state` says its balances were folded over, the home's own chains as
 * the home serves them, cut at the heads the state names, with the parameters and the founding standing the home
 * publishes, and not the mirror's own chains, whose lines carry the mirror's hashes and so draw other panels
 * (QX-1 section 4). A state is refused where it is not what the run already had from the home (a problem the home
 * listed or served left out, a chain named below the lines read or off them, a fold outside the five seconds before its
 * time), or where a chain, an envelope, a data blob or a read it rests on is not served as named; a read the home
 * answers it does not hold, which no line the home wrote names, is left out of the fold, as the home's own fold leaves
 * it out. The tracker's balances are kept only where the mirror's own agree, and only where every credit is what the
 * chain holds; with no chain to ask, a ledger with credits keeps no balances, and the credits alone refuse nothing.
 *
 * The keeping is over a store (files.ts: envelopes, blobs and the lines of each log), the mirror's layout under its
 * folder here and a tracker's store in a node (NODE.md section 5): `keep()` is the pull alone, which a node with `keep`
 * and no door runs over its own store, and `mirror()` is the same pull over the files with the publication after it,
 * the names, the outputs, the index, the keys, the balances and the anchors. A node with a door keeps by the door's
 * pull of its peers instead (NODE.md section 1).
 *
 * A run is one context carrying what every step shares, and each step is a function below that says what it refuses.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type Envelope,
  type Hash,
  type Receipt,
  type ReduceInput,
  IDENTITY_LOG,
  blobProblems,
  envelopeProblems,
  eventId,
  eventProblems,
  eventSignedByKey,
  hashBytes,
  isHash,
  isRecord,
  isSlug,
  nextLine,
  onlyAppends,
  problemHash,
  reduce,
  signedBy,
  verifyChain,
  withSlash,
} from '@bitquilt/core';
import {
  type BalanceView,
  type ChainReader,
  type CoinFolded,
  type CoinParams,
  type CreditLine,
  type Layer,
  type LogHead,
  COIN_LOG,
  challengeLayer,
  coinLayer,
  readsNamed,
  recordOutput,
  reduceInputOf,
} from '@bitquilt/tracker';
import { type AnchorReport, type ChainHead, anchorHeads } from './anchor.js';
import { type KeptStore, MirrorFiles } from './files.js';
import { hiddenFromIdentity, keysFromIdentity } from './identity.js';

export interface MirrorOptions {
  /** The sources: trackers, or nodes, each read by what its well-known says it is. */
  trackers: string[];
  out: string;
  /**
   * What the mirror's own wrapper on every line it appends says received the event: its name or address; `mirror`
   * unless set.
   */
  by?: string;
  /**
   * Follow each configured source's peers (its well-known `peers`) one hop, as sources of their own; on unless false.
   */
  peers?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => string;
  /**
   * QX-12: stamp every chain's head through OpenTimestamps; true for the default calendars, or the calendars to ask.
   */
  anchor?: boolean | { calendars?: string[] };
  /** QX-17: pull the coin log of a tracker that is the coin's home and reproduce its balances; on unless false. */
  coin?: boolean;
  /**
   * The way back: what the chain holds at a deposit number, for checking every credit line the ledger kept. Absent,
   * the balances of a ledger with credits on it are not kept, since nothing here can check them; where they reproduce,
   * the report says why in `coin.notKept`.
   */
  chain?: DepositReader | null;
}

/**
 * What the chain holds at a deposit number: `depositAt` of @bitquilt/coin bound to a connection; the mirror's only read
 * of the chain.
 */
export interface DepositReader {
  depositAt(n: number): Promise<{ root: string; amount: bigint | number; made: boolean }>;
}

/** The pull alone, over a store given: what a node with `keep` and no door runs (NODE.md section 5). */
export interface KeepOptions {
  /** The store kept in: the mirror's files, or a node's store, each answering files.ts's methods. */
  store: KeptStore;
  /** The sources: trackers, or nodes, each read by what its well-known says it is. */
  sources: string[];
  /**
   * The folder the publication goes to (the names, the outputs, the coin's balances); none for a node that keeps and
   * serves from its store.
   */
  out?: string | null;
  /**
   * What the keeper's own wrapper on every line it appends says received the event: its name or address; `mirror`
   * unless set.
   */
  by?: string;
  /**
   * Follow each configured source's peers (its well-known `peers`) one hop, as sources of their own; on unless false.
   */
  peers?: boolean;
  fetchImpl?: typeof fetch;
  now?: () => string;
  /** QX-17: pull the coin log of a tracker that is the coin's home and reproduce its balances; on unless false. */
  coin?: boolean;
  chain?: DepositReader | null;
}

export interface MirrorReport {
  /** Every source read this run: the configured ones, then the peers followed. */
  sources: string[];
  problems: { hash: Hash; lines: number; added: number; complete: boolean }[];
  /**
   * The problems held here that no source listed this run, kept as they were: hidden or replaced at their source, or
   * the source gone.
   */
  kept: Hash[];
  identity: { lines: number; added: number };
  /**
   * QX-17: the coin log held, whether the tracker's balances reproduced here (null where its state could not be read
   * or did not say what they were folded over, and where they reproduce but the ledger has credits and no chain to
   * check them against), how many credits were checked against the chain, and, in that last case, why the balances
   * were not kept.
   */
  coin?: {
    lines: number;
    added: number;
    head: number | null;
    reproduced: boolean | null;
    credits?: number;
    notKept?: string;
  };
  refused: string[];
  errors: string[];
  anchors?: AnchorReport;
}

/**
 * A guard against a tracker whose paging has no end: a chain not read whole within it is refused like any other that
 * cannot be read whole.
 */
const MAX_PAGES = 10_000;

/**
 * What `/coin/state` answers (QX-17 section 6): the coin log's head the balances are of, the time they were computed
 * at, the balances, and what they were folded over.
 */
interface CoinState {
  head: LogHead;
  at: string;
  balances: Record<string, BalanceView>;
  folded: CoinFolded;
}

/** A head as a state names one: null, or a line's sequence from 1 and its hash. */
const isHead = (h: unknown): h is LogHead =>
  h === null || (isRecord(h) && Number.isInteger(h.seq) && (h.seq as number) >= 1 && typeof h.hash === 'string');

/**
 * A `/coin/state` answer read as one, or null where it is not: where it does not say what its balances were folded
 * over, as a home that does not name it.
 */
function stateOf(answer: unknown): CoinState | null {
  if (!isRecord(answer) || !isHead(answer.head) || typeof answer.at !== 'string' || !isRecord(answer.balances))
    return null;
  const f = answer.folded;
  if (!isRecord(f) || typeof f.at !== 'string' || !isHead(f.identity) || !Array.isArray(f.problems)) return null;
  if (!f.problems.every((p) => isRecord(p) && isHash(p.problem) && isHead(p.head))) return null;
  return answer as unknown as CoinState;
}

/**
 * What every step of a run shares: the store kept in, where the publication goes if anywhere, how to fetch, the clock,
 * the report being built, and the problems taken so far with the tracker each came from.
 */
interface Context {
  store: KeptStore;
  /** The publication's folder (names, outputs, balances, keys, index, anchors), or null for a node that only keeps. */
  out: string | null;
  fetchImpl: typeof fetch;
  now: () => string;
  report: MirrorReport;
  /** Every problem in this run's index with the source it came from, null for one kept from the store alone. */
  index: Map<Hash, { envelope: Envelope; tracker: string | null }>;
  /** Every problem a source was asked for this run, taken or refused, so a refusal is said once. */
  tried: Set<Hash>;
  /** What this keeper's own wrapper says. */
  by: string;
  /**
   * Each chain this run read and verified, by the address it was read at and as that place served it, for the coin's
   * check, which folds the home's chains as served and holds the heads its state names to these lines (`servedTo`);
   * null where the coin is not asked for.
   */
  served: Map<string, Receipt[]> | null;
}

function contextFor(options: KeepOptions): Context {
  if (options.out) for (const d of ['names', 'outputs']) mkdirSync(join(options.out, d), { recursive: true });
  return {
    store: options.store,
    out: options.out ?? null,
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => new Date().toISOString()),
    report: { sources: [], problems: [], kept: [], identity: { lines: 0, added: 0 }, refused: [], errors: [] },
    index: new Map(),
    tried: new Set(),
    by: options.by ?? 'mirror',
    served: options.coin === false ? null : new Map(),
  };
}

/**
 * The pull: every source, and each configured one's peers one hop behind it, so a keeper pointed at one tracker keeps
 * the swarm it names; then what no source listed, kept as it was.
 */
async function pull(ctx: Context, options: KeepOptions): Promise<void> {
  const configured = [...new Set(options.sources.map(withSlash))];
  const sources = [...configured];
  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i]!;
    const known = await describeSource(ctx, source);
    if (options.peers !== false && configured.includes(source))
      for (const peer of known.peers.map(withSlash)) if (!sources.includes(peer)) sources.push(peer);
    const listed = await listedAt(ctx, source, known.node);
    if (!listed) {
      ctx.report.errors.push(`${source}: no index`);
      continue;
    }
    for (const hash of listed) await takeProblem(ctx, source, hash);
    await takeHeld(ctx, source);
    await takeIdentity(ctx, source);
    if (options.coin !== false) await takeCoin(ctx, source, options.chain ?? null, listed);
  }
  ctx.report.sources = sources;
  keepTheRest(ctx);
}

/** The keeper's pull over a store given, and nothing written beside it: what a node with `keep` and no door runs. */
export async function keep(options: KeepOptions): Promise<MirrorReport> {
  const ctx = contextFor(options);
  await pull(ctx, options);
  return ctx.report;
}

/** The mirror: the same pull over its files, then the publication a client reads raw, and the anchors when asked. */
export async function mirror(options: MirrorOptions): Promise<MirrorReport> {
  const store = new MirrorFiles(options.out);
  const keeping: KeepOptions = { ...options, store, sources: options.trackers, out: options.out };
  const ctx = contextFor(keeping);
  await pull(ctx, keeping);
  const at = ctx.now();
  writeKeys(ctx, at);
  writeIndex(ctx, at);
  writeRecords(ctx, at);
  if (options.anchor) await anchorAll(ctx, options.anchor);
  return ctx.report;
}

async function getJson(ctx: Context, url: string): Promise<unknown | null> {
  try {
    const r = await ctx.fetchImpl(url, { signal: AbortSignal.timeout(15000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function getBytes(ctx: Context, url: string): Promise<Uint8Array | null> {
  try {
    const r = await ctx.fetchImpl(url, { signal: AbortSignal.timeout(30000) });
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

/**
 * What a source's well-known says of it: whether it is a node, and the peers it names; a source with no well-known is
 * read as a tracker with none.
 */
async function describeSource(ctx: Context, source: string): Promise<{ node: boolean; peers: string[] }> {
  const known = (await getJson(ctx, `${source}.well-known/quilt`)) as { node?: boolean; peers?: unknown } | null;
  const peers = Array.isArray(known?.peers)
    ? known.peers.filter((p): p is string => typeof p === 'string' && /^https?:\/\//.test(p))
    : [];
  return { node: known?.node === true, peers };
}

/** The problems a source lists: a node's `/held`, else a tracker's index at `/`; null where it lists nothing. */
async function listedAt(ctx: Context, source: string, node: boolean): Promise<Hash[] | null> {
  const home = (await getJson(ctx, node ? `${source}held` : source)) as { problems?: { problem: Hash }[] } | null;
  return home?.problems ? home.problems.map((p) => p.problem) : null;
}

/** The hashes of every problem whose envelope is held here. */
function heldHere(ctx: Context): Hash[] {
  return ctx.store.listEnvelopes().map((e) => e.hash);
}

/**
 * The problems held here that the source did not list, taken from it by hash where it still serves them: a problem
 * hidden or replaced at its source leaves its index and not its door, so its chain keeps growing here. One the source
 * does not serve is left for `keepTheRest`.
 */
async function takeHeld(ctx: Context, source: string): Promise<void> {
  for (const hash of heldHere(ctx)) {
    if (ctx.index.has(hash) || ctx.tried.has(hash)) continue;
    if (await getJson(ctx, `${source}p/${hash}`)) await takeProblem(ctx, source, hash);
  }
}

/** Every problem held here that no source listed or served this run stays in the index as the store has it. */
function keepTheRest(ctx: Context): void {
  for (const { hash, envelope } of ctx.store.listEnvelopes()) {
    if (ctx.index.has(hash)) continue;
    ctx.index.set(hash, { envelope, tracker: null });
    ctx.report.kept.push(hash);
  }
}

/**
 * QX-19: the reads a chain's traces name, each fetched from the source under its hash where it is not held here and
 * written beside the data blobs; one that does not hash right is refused and not written, and one the source does
 * not serve is passed over, since a trace is admitted at a door that held the read and a node may not. As
 * NODE.md section 5, the reads, says: "A read a trace names by anything but a hash, and reads that are not a list, are
 * not fetched, and are no refusal" (`readsNamed`), so no file's path or store's query is made of a body's words.
 */
async function takeReads(ctx: Context, source: string, lines: Receipt[], label: string): Promise<void> {
  const wanted = new Set<Hash>();
  for (const l of lines) for (const h of readsNamed(l.event)) if (!ctx.store.getBlob(h)) wanted.add(h);
  for (const h of wanted) {
    const bytes = await getBytes(ctx, `${source}b/${h}`);
    if (!bytes) continue;
    if (hashBytes(bytes) !== h) {
      ctx.report.refused.push(`${label}: read ${h} from ${source} does not check`);
      continue;
    }
    ctx.store.putBlob(h, bytes);
  }
}

/**
 * A chain read whole from a tracker, page by page along `x-quilt-next-since`; null where a page could not be read or
 * the pages did not end within `MAX_PAGES`.
 */
async function getLines(ctx: Context, url: string): Promise<Receipt[] | null> {
  const lines: Receipt[] = [];
  let since = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let r: Response;
    try {
      r = await ctx.fetchImpl(`${url}?since=${since}`, { signal: AbortSignal.timeout(30000) });
    } catch {
      return null;
    }
    if (!r.ok) return null;
    lines.push(
      ...(await r.text())
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Receipt),
    );
    const next = r.headers.get('x-quilt-next-since');
    if (!next) return lines;
    since = Number(next);
  }
  return null;
}

/**
 * A log pulled from a source. The source's chain is read whole and verified from its genesis; one that does not
 * verify is left whole, and one that could not be read whole is passed over. Then, as the union: every event the mirror
 * lacks, by id, whose shape and signature hold, is appended to the mirror's own chain in the source's order, with the
 * source's wrappers kept and the mirror's added (CORE.md section 5: the union of `received`, the earliest deciding the
 * time), so the chain here is the union of every source's events and only grows; a file written by an earlier run from
 * one source's chain verbatim is a prefix of it. As a whole (the coin log, QX-17): the source's chain is taken as it
 * is, and refused where it did anything but grow, since a coin log is one sequence and a union of two is neither.
 */
async function takeChain(
  ctx: Context,
  url: string,
  genesis: Hash,
  log: Hash,
  label: string,
  mode: 'union' | 'whole' = 'union',
): Promise<{ lines: Receipt[]; added: number } | null> {
  const lines = await getLines(ctx, url);
  if (!lines) return null;
  const check = verifyChain(lines, genesis);
  if (!check.ok) {
    ctx.report.refused.push(`${label}: chain from ${url} does not verify: ${check.problems[0]}`);
    return null;
  }
  ctx.served?.set(url, lines);
  const held = ctx.store.lines(log);
  const before = held.length;
  if (mode === 'whole') {
    const growth = onlyAppends(held, lines);
    if (!growth.ok) {
      ctx.report.refused.push(`${label}: chain from ${url} did not only grow: ${growth.problem}`);
      return null;
    }
    if (growth.added > 0 || before === 0) ctx.store.appendLines(log, lines.slice(before));
    return { lines, added: growth.added };
  }
  const have = new Set(held.map((l) => eventId(l.event)));
  let added = 0;
  for (const l of lines) {
    const id = eventId(l.event);
    if (have.has(id)) continue;
    if (eventProblems(l.event).length || !eventSignedByKey(l.event)) {
      ctx.report.refused.push(`${label}: event ${id} from ${url} does not check`);
      continue;
    }
    held.push(nextLine(held, genesis, { event: l.event, received: [...l.received, { by: ctx.by, at: ctx.now() }] }));
    have.add(id);
    added += 1;
  }
  if (added > 0 || before === 0) ctx.store.appendLines(log, held.slice(before));
  return { lines: held, added };
}

/**
 * The envelope's blobs, each from the file held here where it hashes right and from the tracker otherwise; null where
 * one does not check.
 */
async function takeBlobs(ctx: Context, tracker: string, envelope: Envelope): Promise<Map<Hash, Uint8Array> | null> {
  const blobs = new Map<Hash, Uint8Array>();
  for (const h of Object.values(envelope.problem.data)) {
    const bytes = await blobAt(ctx, tracker, h);
    if (!bytes) return null;
    blobs.set(h, bytes);
  }
  return blobProblems(envelope.problem, blobs).length ? null : blobs;
}

/** A blob by its hash: the file held here where it hashes right, else the tracker's where it does; null otherwise. */
async function blobAt(ctx: Context, tracker: string, h: Hash): Promise<Uint8Array | null> {
  const held = ctx.store.getBlob(h);
  if (held && hashBytes(held) === h) return held;
  const bytes = await getBytes(ctx, `${tracker}b/${h}`);
  return bytes && hashBytes(bytes) === h ? bytes : null;
}

/**
 * A problem from a tracker, taken once: refuses an envelope that does not check or is not its owner's, a blob that does
 * not check, and a chain that does not verify or did not only grow; a problem taken from an earlier tracker is left as
 * it is.
 */
async function takeProblem(ctx: Context, tracker: string, hash: Hash): Promise<void> {
  if (ctx.index.has(hash)) return;
  ctx.tried.add(hash);
  const answer = await getJson(ctx, `${tracker}p/${hash}`);
  if (!answer || envelopeProblems(answer).length || problemHash(answer as Envelope) !== hash) {
    ctx.report.refused.push(`${hash}: envelope from ${tracker} does not check`);
    return;
  }
  const envelope = answer as Envelope;
  if (!signedBy(envelope as unknown as Record<string, unknown>, envelope.problem.owner)) {
    ctx.report.refused.push(`${hash}: envelope from ${tracker} is not signed by its owner`);
    return;
  }
  const blobs = await takeBlobs(ctx, tracker, envelope);
  if (!blobs) {
    ctx.report.refused.push(`${hash}: a blob from ${tracker} does not check`);
    return;
  }
  const chain = await takeChain(ctx, `${tracker}p/${hash}/events`, hash, hash, hash);
  if (!chain) return;
  if (!ctx.store.envelopeOf(hash)) ctx.store.putEnvelope(hash, envelope, ctx.now());
  for (const [h, bytes] of blobs) if (!ctx.store.getBlob(h)) ctx.store.putBlob(h, bytes);
  await takeReads(ctx, tracker, chain.lines, hash);
  ctx.index.set(hash, { envelope, tracker });
  // Names and the output come from the events, not the tracker's word; both are the publication's, written where there
  // is one.
  if (ctx.out)
    for (const line of chain.lines)
      if (line.event.type === 'version' && line.event.key === envelope.problem.owner)
        writeName(ctx.out, envelope.problem.owner, line.event.body);
  let complete = false;
  try {
    const state = reduce(reduceInputOf(ctx.store, envelope, ctx.now()));
    complete = state.complete;
    if (state.output && ctx.out) {
      mkdirSync(join(ctx.out, 'outputs', hash), { recursive: true });
      writeFileSync(
        join(ctx.out, 'outputs', hash, 'output.json'),
        JSON.stringify(state.output.document, null, 2) + '\n',
      );
      writeFileSync(join(ctx.out, 'outputs', hash, 'hash'), `${state.output.hash}\n`);
    }
  } catch (err) {
    ctx.report.errors.push(`${hash}: ${(err as Error).message}`);
  }
  ctx.report.problems.push({ hash, lines: chain.lines.length, added: chain.added, complete });
}

/**
 * NODE.md section 6: an owner's name, `names/<owner>/<slug>`, from a version the owner signed. It is written only for a
 * slug by the envelope's rule, "problem.slug: lower-case letters, digits and hyphens, at most 64" (`isSlug`), and only
 * at a path inside names/<owner>/. A version with any other slug is passed over, and is no refusal. CORE.md section 4
 * gives a version `{ slug, hash }` and no form for the slug, and the core's shape (`eventProblems`) asks only that it
 * is a string, so a core client holds it, and a refusal would fail every run and stop main growing.
 */
function writeName(out: string, owner: string, body: Record<string, unknown>): void {
  const { slug, hash } = body;
  if (!isSlug(slug)) return;
  const dir = join(out, 'names', owner);
  const file = join(dir, slug);
  if (dirname(file) !== dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${hash as Hash}\n`);
}

/**
 * The identity log from a tracker, taken like a chain. Every tracker serves the one log, so with several the report's
 * `lines` is the last one's count and `added` the most any one of them added over what was held when it was read.
 */
async function takeIdentity(ctx: Context, tracker: string): Promise<void> {
  const identity = await takeChain(ctx, `${tracker}k/events`, IDENTITY_LOG, IDENTITY_LOG, 'identity');
  if (identity)
    ctx.report.identity = { lines: identity.lines.length, added: Math.max(ctx.report.identity.added, identity.added) };
}

/**
 * QX-17: the coin log of the tracker that is the coin's home, taken like a chain, and the balances it says it computed.
 * The tracker's balances are its word. They are kept only where the mirror computes the same over what the home's state
 * says they were folded over, as the home serves it (`servedOver`), with the parameters and the founding standing the
 * home publishes, and, since the ledger admits a credit on the reader's signature alone, only where every credit is
 * what the chain holds at that deposit: "the mirror checks every credit against the chain and keeps no balances where
 * one differs or where it has no chain to ask" (AGENTS.md, rule 10). A state that is not what this run already had from
 * the home, or that rests on what the home does not serve as named, is refused (`servedOver` says each way), since the
 * balances then rest on receipts the home does not serve as it says; a credit that is not what the chain holds is
 * refused, and so are balances that do not reproduce, which needs no chain to say. With no chain to ask, a ledger with
 * credits is kept and its balances are not, and the credits alone refuse nothing, so a run that refuses nothing else
 * keeps the problems, the coin log and the rest (NODE.md section 6); where the balances reproduce, `notKept` says why.
 * The state is read after the home's list, its problems' chains and its identity log (`readBefore`), and before the
 * coin log, so the log taken after it holds every line the state names. A state that cannot be read, or does not say
 * what it was folded over, is left for the next run (`reproduced: null`), with no reason given.
 */
async function takeCoin(ctx: Context, tracker: string, chain: DepositReader | null, listed: Hash[]): Promise<void> {
  const before = readBefore(ctx, tracker, listed);
  const wellKnown = (await getJson(ctx, `${tracker}.well-known/quilt`)) as {
    coin?: (CoinParams & { home?: string | null; extension?: string }) | null;
    founding?: unknown;
    url?: unknown;
  } | null;
  const published = wellKnown?.coin ?? null;
  if (!published || !(published.home === 'here' || published.home === undefined || published.home === null)) return;
  const state = stateOf(await getJson(ctx, `${tracker}coin/state`));
  const log = await takeChain(ctx, `${tracker}coin/events`, COIN_LOG, COIN_LOG, 'coin', 'whole');
  if (!log) return;
  const held = log.lines[log.lines.length - 1];
  const coin: NonNullable<MirrorReport['coin']> = {
    lines: log.lines.length,
    added: log.added,
    head: held?.seq ?? null,
    reproduced: null,
  };
  ctx.report.coin = coin;
  if (!state) return;
  const { home: _home, extension: _extension, ...params } = published;
  try {
    const homeUrl = typeof wellKnown?.url === 'string' ? wellKnown.url : null;
    const served = await servedOver(ctx, tracker, state, before, homeUrl);
    if (typeof served === 'string') {
      ctx.report.refused.push(`coin: ${served}`);
      coin.reproduced = false;
      return;
    }
    const founding = foundingOf(wellKnown?.founding);
    const { differs, credits } = reproduceBalances(served, params as CoinParams, founding, state);
    const wrongCredit = chain ? await checkCredits(chain, credits) : null;
    coin.credits = chain ? credits.length : 0;
    if (wrongCredit !== null) {
      ctx.report.refused.push(`coin: ${wrongCredit}, at head ${state.head?.seq ?? 0} from ${tracker}`);
      coin.reproduced = false;
    } else if (differs === undefined && !chain && credits.length) {
      const n = credits.length;
      coin.notKept =
        `the balances at head ${state.head?.seq ?? 0} from ${tracker} are not kept: ${n} credit${n === 1 ? '' : 's'}` +
        ` on the ledger and no chain to check ${n === 1 ? 'it' : 'them'} against`;
    } else if (differs === undefined) {
      if (ctx.out) {
        mkdirSync(join(ctx.out, 'coin'), { recursive: true });
        writeFileSync(
          join(ctx.out, 'coin', 'balances.json'),
          JSON.stringify({ head: state.head, at: state.at, params: published, balances: state.balances }, null, 2) +
            '\n',
        );
      }
      coin.reproduced = true;
    } else {
      ctx.report.refused.push(
        `coin: the balances at head ${state.head?.seq ?? 0} from ${tracker} do not reproduce here (${differs})`,
      );
      coin.reproduced = false;
    }
  } catch (err) {
    ctx.report.errors.push(`coin: ${(err as Error).message}`);
  }
}

/** What the coin's balances are recomputed over: the home's own chains as it serves them, cut where its state says. */
interface Served {
  /** Each problem the state names, in its order, as the reducer takes it at the time the state says it was folded. */
  problems: ReduceInput[];
  /** The coin log to the state's head. */
  coin: Receipt[];
  /** Each read a trace on those chains names, measured by its bytes (QX-19 section 2). */
  blobLength: (hash: Hash) => number | null;
}

/**
 * What this run had from the home before it read the home's state: each problem the home listed or whose chain it
 * served, with how many lines of that chain this run read (none where it read none), and how many of the identity
 * log's it read, or null where it read none.
 */
interface ReadBefore {
  problems: Map<Hash, number>;
  identity: number | null;
}

/** What this run had from the home so far, from its list and from the chains it served (`Context.served`). */
function readBefore(ctx: Context, tracker: string, listed: Hash[]): ReadBefore {
  const problems = new Map<Hash, number>(listed.map((h) => [h, 0]));
  const prefix = `${tracker}p/`;
  for (const [url, lines] of ctx.served ?? []) {
    if (!url.startsWith(prefix) || !url.endsWith('/events')) continue;
    const hash = url.slice(prefix.length, -'/events'.length);
    if (isHash(hash)) problems.set(hash, lines.length);
  }
  return { problems, identity: ctx.served?.get(`${tracker}k/events`)?.length ?? null };
}

/**
 * QX-17 section 6: "`at`, the time the layer under them was folded at, which is the state's own `at` or up to five
 * seconds before it, since the tracker keeps its layer that long while nothing is written".
 */
const FOLDED_BEFORE_MS = 5000;

/**
 * What the home's state says its balances were folded over (QX-17 section 6), as the home serves it. The state is held
 * first to what this run already had from the home (`readBefore`): its fold's time is its own `at` or up to five
 * seconds before it; it names every problem the home listed or served this run, "every one the tracker holds"; and it
 * names each chain this run read from the home at a head no earlier than the lines read, since a chain only grows.
 * Then each chain the state names, each problem's, the identity log and the coin log, is the home's as served, cut at
 * the named head, whose line must carry the named hash: cut from the lines this run read of it where they reach the
 * head, and otherwise read whole, verified from its log's hash and held to extend what this run read (`servedTo`), so
 * a head off the chain the run read does not pass.
 * Each envelope is the one held here or the home's, by its hash. Each data blob and each read a trace on those chains
 * names is the home's as it serves it (`servedAtHome`), and each read is measured by its bytes, as the home measures
 * the reads it holds (QX-19 section 2); a read the home answers it does not hold is left out, as the home's fold leaves
 * it out, where no line the home wrote names it, and where the home's well-known document publishes no `url` no read is
 * left out. The wrapper is not signed, and the check holds a home's chains to what this run read: so it binds a home
 * that serves its lines as it wrote them, under the `url` it publishes now, as QX-11 section 6 says a chain proves what
 * a reader saw; and a home with `work` beside `admit` that keeps from elsewhere a line whose wrapper carries its `url`
 * is refused until it holds the read that line names. The problems are the home's, hidden and replaced ones among them,
 * since the home serves every problem it holds by hash, a hidden one too (QX-6 section 3), whatever this run took from
 * other sources. Why not, where the state is not what this run had from the home, or a chain, an envelope, a data blob
 * or a read it rests on is not served as named.
 */
async function servedOver(
  ctx: Context,
  tracker: string,
  state: CoinState,
  before: ReadBefore,
  homeUrl: string | null,
): Promise<Served | string> {
  const { folded } = state;
  const lag = Date.parse(state.at) - Date.parse(folded.at);
  if (!(lag >= 0 && lag <= FOLDED_BEFORE_MS))
    return `the coin state from ${tracker} was folded at ${folded.at}, not at its time ${state.at} or in the five seconds before it`;
  const named = new Map(folded.problems.map(({ problem, head }) => [problem, head]));
  for (const [problem, read] of before.problems) {
    if (!named.has(problem)) return `the coin state from ${tracker} does not name ${problem}, which it served this run`;
    const short = belowRead(named.get(problem)!, read);
    if (short) return `the chain of ${problem} from ${tracker} ${short}`;
  }
  const shortIdentity = before.identity === null ? null : belowRead(folded.identity, before.identity);
  if (shortIdentity) return `the identity log from ${tracker} ${shortIdentity}`;
  const coin = await servedTo(ctx, `${tracker}coin/events`, COIN_LOG, state.head, `the coin log from ${tracker}`);
  if (typeof coin === 'string') return coin;
  const identity = await servedTo(
    ctx,
    `${tracker}k/events`,
    IDENTITY_LOG,
    folded.identity,
    `the identity log from ${tracker}`,
  );
  if (typeof identity === 'string') return identity;
  const envelopes = new Map<Hash, Envelope>();
  const chains = new Map<Hash, Receipt[]>();
  for (const { problem, head } of folded.problems) {
    const envelope = ctx.store.envelopeOf(problem) ?? (await envelopeAt(ctx, tracker, problem));
    if (!envelope) return `the envelope of ${problem} from ${tracker} does not check`;
    envelopes.set(problem, envelope);
    const lines = await servedTo(
      ctx,
      `${tracker}p/${problem}/events`,
      problem,
      head,
      `the chain of ${problem} from ${tracker}`,
    );
    if (typeof lines === 'string') return lines;
    chains.set(problem, lines);
  }
  const blobs = new Map<Hash, Uint8Array | null>();
  for (const [problem, e] of envelopes)
    for (const h of Object.values(e.problem.data))
      if (!blobs.has(h)) {
        const bytes = await servedAtHome(ctx, tracker, h, `the data blob ${h} of ${problem} from ${tracker}`, false);
        if (typeof bytes === 'string') return bytes;
        blobs.set(h, bytes);
      }
  // Each read a trace names, with where it is first named and whether a line the home wrote names it: the home's own
  // wrapper, `by` its well-known `url`, says the home took that line, and with it the read.
  const reads = new Map<Hash, { problem: Hash; tookIt: boolean }>();
  for (const [problem, lines] of chains)
    for (const l of lines) {
      const tookIt = homeUrl === null || l.received.some((w) => w.by === homeUrl);
      for (const h of readsNamed(l.event)) {
        // A read the home took is named by a problem whose line the home wrote, so a refusal names that problem.
        const named = reads.get(h);
        if (!named || (tookIt && !named.tookIt)) reads.set(h, { problem, tookIt });
      }
    }
  const lengths = new Map<Hash, number | null>();
  for (const [h, { problem, tookIt }] of reads) {
    const bytes = await servedAtHome(
      ctx,
      tracker,
      h,
      `the read ${h} of a trace on ${problem} from ${tracker}`,
      !tookIt,
    );
    if (typeof bytes === 'string') return bytes;
    lengths.set(h, bytes && bytes.length);
  }
  const reader: ChainReader = {
    envelopeOf: (h) => envelopes.get(h) ?? null,
    getBlob: (h) => blobs.get(h) ?? null,
    lines: (log) => (log === IDENTITY_LOG ? identity : (chains.get(log) ?? [])),
  };
  return {
    problems: folded.problems.map(({ problem }) => reduceInputOf(reader, envelopes.get(problem)!, folded.at)),
    coin,
    blobLength: (h) => lengths.get(h) ?? null,
  };
}

/**
 * A data blob or a read the home's fold reads, as the home serves it at `/b/<hash>`: its bytes, which must hash to the
 * name, whatever is held here, since the balances rest on what the home serves. Null, for a read the home's fold
 * measured as absent, only where `mayLack` and the home answers that it holds none (`404`): a node with `work` beside
 * `admit` keeps in the door's store chains its door did not take (NODE.md section 2), and can lack a read a trace on
 * them names. A data blob is never absent, since the core refuses a problem without one and a home that lacks one
 * cannot fold; nor is a read a line the home wrote names, since its door takes no trace whose read it lacks and a
 * store keeps a blob for good. Why not, where the home cannot be asked, does not serve it, or serves other bytes.
 */
async function servedAtHome(
  ctx: Context,
  tracker: string,
  h: Hash,
  label: string,
  mayLack: boolean,
): Promise<Uint8Array | null | string> {
  let r: Response;
  try {
    r = await ctx.fetchImpl(`${tracker}b/${h}`, { signal: AbortSignal.timeout(30000) });
  } catch {
    return `${label} cannot be read`;
  }
  if (!r.ok) {
    await r.body?.cancel().catch(() => undefined);
    if (r.status !== 404) return `${label} cannot be read`;
    return mayLack ? null : `${label} is not served, and the home's fold rests on it`;
  }
  try {
    const bytes = new Uint8Array(await r.arrayBuffer());
    return hashBytes(bytes) === h ? bytes : `${label} does not check`;
  } catch {
    return `${label} cannot be read`;
  }
}

/**
 * A chain the coin's state names, as its home serves it, to the named head. Where this run already read the chain from
 * that address, the head lies on the lines it read or past them, on a chain that extends them: a head within them is
 * cut from them with no second read, and for a head past them the chain is read again whole, verified from its log's
 * hash, and must hold every line this run read as it was read, since a chain only grows. Where this run read none of
 * it, the chain is read whole and verified. Why not, where it cannot be read whole, does not verify, does not extend
 * what this run read, or has no line at the head's sequence with the head's hash.
 */
async function servedTo(
  ctx: Context,
  url: string,
  genesis: Hash,
  head: LogHead,
  label: string,
): Promise<Receipt[] | string> {
  const noLine = () => `${label} has no line ${head!.seq} with the hash the coin state names`;
  const cached = ctx.served?.get(url);
  if (cached && (head?.seq ?? 0) <= cached.length) return cutAt(cached, head) ?? noLine();
  const lines = await getLines(ctx, url);
  if (!lines) return `${label} cannot be read whole`;
  const check = verifyChain(lines, genesis);
  if (!check.ok) return `${label} does not verify: ${check.problems[0]}`;
  const growth = cached ? onlyAppends(cached, lines) : null;
  if (growth && !growth.ok) return `${label} served to the check does not extend what this run read: ${growth.problem}`;
  return cutAt(lines, head) ?? noLine();
}

/**
 * Why a head a state names is earlier than the lines this run read of that chain before the state, or null where it is
 * not: a chain only grows, so a head below what was read is not the chain's.
 */
function belowRead(head: LogHead, read: number): string | null {
  return (head?.seq ?? 0) < read
    ? `was read to line ${read} this run, and the coin state names ${head ? `line ${head.seq}` : 'no line'}`
    : null;
}

/** A verified chain's lines to a head, or null where its line at the head's sequence is not the head. */
function cutAt(lines: Receipt[], head: LogHead): Receipt[] | null {
  if (head === null) return [];
  const line = lines[head.seq - 1];
  return line && line.seq === head.seq && line.hash === head.hash ? lines.slice(0, head.seq) : null;
}

/** An envelope the tracker serves by hash, where it checks, hashes to the hash and is its owner's; null otherwise. */
async function envelopeAt(ctx: Context, tracker: string, hash: Hash): Promise<Envelope | null> {
  const answer = await getJson(ctx, `${tracker}p/${hash}`);
  if (!answer || envelopeProblems(answer).length || problemHash(answer as Envelope) !== hash) return null;
  const envelope = answer as Envelope;
  return signedBy(envelope as unknown as Record<string, unknown>, envelope.problem.owner) ? envelope : null;
}

/**
 * The founding standing a tracker's well-known document publishes, by root in lower case as its layer counts it
 * (QX-1 section 2); none where it publishes none.
 */
function foundingOf(published: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (isRecord(published))
    for (const [root, n] of Object.entries(published)) if (typeof n === 'number') out.set(root.toLowerCase(), n);
  return out;
}

/**
 * The balances recomputed here with the tracker's own layer code over what the home's state says they were folded
 * over, as the home serves it, with the parameters and the founding standing it publishes: the layer at the time the
 * state says it was folded at, and the coin at the state's own time. The first root whose balance is not the home's,
 * and the credits the ledger kept.
 */
function reproduceBalances(
  served: Served,
  params: CoinParams,
  founding: Map<string, number>,
  state: CoinState,
): { differs: string | undefined; credits: CreditLine[] } {
  const layer = challengeLayer({
    problems: served.problems,
    now: state.folded.at,
    coin: served.coin,
    founding,
    blobLength: served.blobLength,
  });
  const folded = coinLayer({ layer, params, receipts: served.coin, now: state.at });
  const mine = Object.fromEntries(folded.balances());
  const roots = [...new Set([...Object.keys(mine), ...Object.keys(state.balances)])].sort();
  const differs = roots.find((r) => JSON.stringify(mine[r] ?? null) !== JSON.stringify(state.balances[r] ?? null));
  return { differs, credits: folded.credits() };
}

/**
 * Every credit the ledger kept, against the deposit the chain holds at its number: why the first wrong one is refused,
 * or null.
 */
async function checkCredits(chain: DepositReader, credits: CreditLine[]): Promise<string | null> {
  for (const c of credits) {
    const d = await chain.depositAt(c.deposit);
    if (!d.made || d.root.toLowerCase() !== c.root.toLowerCase() || BigInt(d.amount) !== BigInt(c.amount))
      return `the credit for deposit ${c.deposit} (${c.amount} to ${c.root}) is not what the chain holds`;
  }
  return null;
}

/**
 * QX-20 section 4: `outputs/<hash>/record.json` and its hash beside it, for every problem with a record piece that the
 * tracker's own layer calls complete over the chains held here. The core writes no output for such a problem, since it
 * holds a record piece as unknown; the layer's document is a function of the envelope and the receipts alone, and
 * `recordOutput` is what the tracker's state reads its `record_output` from, so the hash here is the tracker's where
 * the chains are the same.
 */
function writeRecords(ctx: Context, at: string): void {
  const inputs: ReduceInput[] = [];
  for (const { envelope } of ctx.index.values()) inputs.push(reduceInputOf(ctx.store, envelope, at));
  if (inputs.length === 0) return;
  let layer: Layer;
  try {
    layer = challengeLayer({ problems: inputs, now: at });
  } catch (err) {
    ctx.report.errors.push(`records: ${(err as Error).message}`);
    return;
  }
  for (const [hash, pl] of layer.problems) {
    const doc = recordOutput(pl);
    if (!doc) continue;
    mkdirSync(join(ctx.out!, 'outputs', hash), { recursive: true });
    writeFileSync(join(ctx.out!, 'outputs', hash, 'record.json'), JSON.stringify(doc.document, null, 2) + '\n');
    writeFileSync(join(ctx.out!, 'outputs', hash, 'record_hash'), `${doc.hash}\n`);
  }
}

/** keys.json: each address's latest name and the delegations in force at `at`, folded from the identity log alone. */
function writeKeys(ctx: Context, at: string): void {
  writeFileSync(
    join(ctx.out!, 'keys.json'),
    JSON.stringify(keysFromIdentity(ctx.store.lines(IDENTITY_LOG), at), null, 2) + '\n',
  );
}

/**
 * index.json: every problem taken, with its title, slug, owner, the tracker it came from and the hides on it (QX-6).
 */
function writeIndex(ctx: Context, at: string): void {
  const hiddenBy = hiddenFromIdentity(ctx.store.lines(IDENTITY_LOG));
  const problems = [...ctx.index].map(([hash, { envelope, tracker }]) => ({
    hash,
    title: envelope.problem.title,
    slug: envelope.problem.slug,
    owner: envelope.problem.owner,
    tracker,
    hidden: hiddenBy.get(hash) ?? [],
  }));
  writeFileSync(join(ctx.out!, 'index.json'), JSON.stringify({ quilt: 1, mirrored: at, problems }, null, 2) + '\n');
}

/**
 * QX-12: the head of every chain held here (each problem's, the identity log's and the coin log's), stamped outside the
 * ledger when asked; a head already stamped is kept.
 */
async function anchorAll(ctx: Context, anchor: true | { calendars?: string[] }): Promise<void> {
  const heads: ChainHead[] = [];
  const headOf = (log: Hash, problem: string) => {
    const lines = ctx.store.lines(log);
    const last = lines[lines.length - 1];
    if (last && typeof last.hash === 'string' && typeof last.seq === 'number')
      heads.push({ problem, seq: last.seq, hash: last.hash });
  };
  for (const p of ctx.report.problems) headOf(p.hash, p.hash);
  headOf(IDENTITY_LOG, 'identity');
  headOf(COIN_LOG, 'coin');
  ctx.report.anchors = await anchorHeads({
    out: ctx.out!,
    heads,
    ...(typeof anchor === 'object' && anchor.calendars ? { calendars: anchor.calendars } : {}),
    fetchImpl: ctx.fetchImpl,
    now: ctx.now,
  });
}
