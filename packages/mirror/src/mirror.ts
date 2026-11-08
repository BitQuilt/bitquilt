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
 * The coin (QX-17) is held to the same rule as a chain: the mirror recomputes every balance from the receipts it holds
 * and the parameters the tracker publishes, with the tracker's own layer code, so what it checks is the receipts and
 * the head, not the arithmetic; a second implementation of coin.ts would check that. The tracker's balances are kept
 * only where the mirror's own agree, and only where every credit is what the chain holds; with no chain to ask, a
 * ledger with credits keeps no balances, and nothing is refused for it.
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
  type CoinParams,
  type CreditLine,
  type Layer,
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
   * the balances of a ledger with credits on it are not kept, since nothing here can check them, and the report says
   * why in `coin.notKept`.
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
   * QX-17: the coin log held, whether the tracker's balances at its head reproduced here (null where the head moved
   * between reads, or where the ledger has credits and there is no chain to check them against), how many credits were
   * checked against the chain, and, where the balances were not kept and nothing was refused for it, why.
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

/** What `/coin/state` answers: the head the balances are of, the time they were computed at, and the balances. */
interface CoinState {
  head: { seq: number; hash: string } | null;
  at: string;
  balances: Record<string, BalanceView>;
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
    if (options.coin !== false) await takeCoin(ctx, source, options.chain ?? null);
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
 * not serve is passed over, since a trace is admitted at a door that held the read and a node may not.
 */
async function takeReads(ctx: Context, source: string, lines: Receipt[], label: string): Promise<void> {
  const wanted = new Set<Hash>();
  for (const l of lines)
    for (const h of readsNamed(l.event)) if (h && !ctx.store.getBlob(h as Hash)) wanted.add(h as Hash);
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
    let bytes = ctx.store.getBlob(h);
    if (!bytes || hashBytes(bytes) !== h) bytes = await getBytes(ctx, `${tracker}b/${h}`);
    if (!bytes || hashBytes(bytes) !== h) return null;
    blobs.set(h, bytes);
  }
  return blobProblems(envelope.problem, blobs).length ? null : blobs;
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
      if (line.event.type === 'version' && line.event.key === envelope.problem.owner) {
        const { slug, hash: target } = line.event.body as { slug: string; hash: Hash };
        const file = join(ctx.out, 'names', envelope.problem.owner, slug);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${target}\n`);
      }
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
 * The tracker's balances are its word. They are kept only where the mirror computes the same from the receipts it
 * holds and the parameters the tracker publishes, and, since the ledger admits a credit on the reader's signature
 * alone, only where every credit is what the chain holds at that deposit: "the mirror checks every credit against the
 * chain and keeps no balances where one differs or where it has no chain to ask" (AGENTS.md, rule 10). A credit that
 * is not what the chain holds is refused, and so are balances that do not reproduce, which needs no chain to say. With
 * no chain to ask, a ledger with credits is kept and its balances are not, and nothing is refused for it, so the run
 * keeps the problems, the coin log and the rest (NODE.md section 6); `notKept` says why. A head that moved between the
 * two reads is left for the next run (`reproduced: null`).
 */
async function takeCoin(ctx: Context, tracker: string, chain: DepositReader | null): Promise<void> {
  const wellKnown = (await getJson(ctx, `${tracker}.well-known/quilt`)) as {
    coin?: (CoinParams & { home?: string | null; extension?: string }) | null;
  } | null;
  const published = wellKnown?.coin ?? null;
  if (!published || !(published.home === 'here' || published.home === undefined || published.home === null)) return;
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
  const state = (await getJson(ctx, `${tracker}coin/state`)) as CoinState | null;
  const same =
    state &&
    ((state.head === null && !held) ||
      (state.head !== null && held !== undefined && state.head.seq === held.seq && state.head.hash === held.hash));
  if (!state || !same) return;
  const { home: _home, extension: _extension, ...params } = published;
  try {
    const { differs, credits } = reproduceBalances(ctx, params as CoinParams, log.lines, state);
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

/**
 * The balances recomputed here from the receipts held and the parameters published, with the tracker's own layer code:
 * the first root whose balance is not the tracker's, and the credits the ledger kept.
 */
function reproduceBalances(
  ctx: Context,
  params: CoinParams,
  lines: Receipt[],
  state: CoinState,
): { differs: string | undefined; credits: CreditLine[] } {
  const inputs: ReduceInput[] = [];
  for (const { envelope } of ctx.index.values()) inputs.push(reduceInputOf(ctx.store, envelope, state.at));
  const layer = challengeLayer({ problems: inputs, now: state.at, coin: lines });
  const folded = coinLayer({ layer, params, receipts: lines, now: state.at });
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
