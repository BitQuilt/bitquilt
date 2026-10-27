/**
 * The mirror (PROTOCOL.md, The mirror): the one automated writer to a repository's main. It pulls from the trackers it
 * is given, checks every envelope against its hash, every blob against its hash and every chain from its problem's hash,
 * refuses a chain that did anything but grow since the file it holds, and writes the layout a client reads raw. A chain is a
 * resolver's own, so a mirror follows one tracker's chains; a second tracker's chain for the same problem is refused unless it
 * is a growth of the first's:
 *
 *   problems/<hash>.json   blobs/<hash>   ledger/<hash>.jsonl   ledger/identity.jsonl   ledger/coin.jsonl (QX-17)
 *   names/<owner>/<slug>   outputs/<hash>/output.json   keys.json   index.json   coin/balances.json   anchors/<problem>/<seq>.ots (QX-12, when asked)
 *
 * No `.head` file is written: the head is the ledger file's last line, stamped under `anchors/`. The mirror reads no
 * chain itself; the bin hands it one when the environment names it.
 *
 * The coin (QX-17) is held to the same rule as a chain: the mirror recomputes every balance from the receipts it holds
 * and the parameters the tracker publishes, with the tracker's own layer code, so what it checks is the receipts and
 * the head, not the arithmetic; a second implementation of coin.ts would check that. The tracker's balances are kept
 * only where the mirror's own agree.
 *
 * A run is `mirror()`: one context carries what every step shares, and each step is a function below that says what
 * it refuses.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type Envelope, type Hash, type Receipt, type ReduceInput, IDENTITY_LOG, blobProblems, envelopeProblems, hashBytes, onlyAppends, problemHash, reduce, signedBy, verifyChain, withSlash,
} from '@bitquilt/core';
import { type BalanceView, type CoinParams, type CreditLine, COIN_LOG, challengeLayer, coinLayer } from '@bitquilt/tracker';
import { type AnchorReport, type ChainHead, anchorHeads } from './anchor.js';
import { hiddenFromIdentity, keysFromIdentity } from './identity.js';

export interface MirrorOptions {
  trackers: string[];
  out: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  /** QX-12: stamp every chain's head through OpenTimestamps; true for the default calendars, or the calendars to ask. */
  anchor?: boolean | { calendars?: string[] };
  /** QX-17: pull the coin log of a tracker that is the coin's home and reproduce its balances; on unless false. */
  coin?: boolean;
  /**
   * The way back: what the chain holds at a deposit number, for checking every credit line the ledger kept. Absent,
   * a ledger with credits on it is refused, since nothing here can check them.
   */
  chain?: DepositReader | null;
}

/** What the chain holds at a deposit number: `depositAt` of @bitquilt/coin bound to a connection; the mirror's only read of the chain. */
export interface DepositReader {
  depositAt(n: number): Promise<{ root: string; amount: bigint | number; made: boolean }>;
}

export interface MirrorReport {
  problems: { hash: Hash; lines: number; added: number; complete: boolean }[];
  identity: { lines: number; added: number };
  /** QX-17: the coin log held, whether the tracker's balances at its head reproduced here (null where the head moved between reads), and how many credits were checked against the chain. */
  coin?: { lines: number; added: number; head: number | null; reproduced: boolean | null; credits?: number };
  refused: string[];
  errors: string[];
  anchors?: AnchorReport;
}

/** A guard against a tracker whose paging has no end: a chain not read whole within it is refused like any other that cannot be read whole. */
const MAX_PAGES = 10_000;

/** What `/coin/state` answers: the head the balances are of, the time they were computed at, and the balances. */
interface CoinState {
  head: { seq: number; hash: string } | null;
  at: string;
  balances: Record<string, BalanceView>;
}

/** What every step of a run shares: where the files go, how to fetch, the clock, the report being built, and the problems taken so far with the tracker each came from. */
interface Context {
  out: string;
  fetchImpl: typeof fetch;
  now: () => string;
  report: MirrorReport;
  index: Map<Hash, { envelope: Envelope; tracker: string }>;
}

export async function mirror(options: MirrorOptions): Promise<MirrorReport> {
  for (const d of ['problems', 'blobs', 'ledger', 'names', 'outputs']) mkdirSync(join(options.out, d), { recursive: true });
  const ctx: Context = {
    out: options.out,
    fetchImpl: options.fetchImpl ?? fetch,
    now: options.now ?? (() => new Date().toISOString()),
    report: { problems: [], identity: { lines: 0, added: 0 }, refused: [], errors: [] },
    index: new Map(),
  };
  for (const tracker of options.trackers.map(withSlash)) {
    const home = (await getJson(ctx, tracker)) as { problems?: { problem: Hash }[] } | null;
    if (!home?.problems) {
      ctx.report.errors.push(`${tracker}: no index`);
      continue;
    }
    for (const entry of home.problems) await takeProblem(ctx, tracker, entry.problem);
    await takeIdentity(ctx, tracker);
    if (options.coin !== false) await takeCoin(ctx, tracker, options.chain ?? null);
  }
  const at = ctx.now();
  writeKeys(ctx, at);
  writeIndex(ctx, at);
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

/** A chain read whole from a tracker, page by page along `x-quilt-next-since`; null where a page could not be read or the pages did not end within `MAX_PAGES`. */
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
    lines.push(...(await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt));
    const next = r.headers.get('x-quilt-next-since');
    if (!next) return lines;
    since = Number(next);
  }
  return null;
}

const readLines = (file: string): Receipt[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt) : []);

function writeLines(file: string, lines: Receipt[]): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
}

/** What the reducer takes for a problem held here: its envelope chain along prev, the blobs, every receipt along the chain and the identity log. */
function inputFor(ctx: Context, envelope: Envelope, at: string): ReduceInput {
  const chainEnvelopes: Envelope[] = [envelope];
  const guard = new Set<Hash>([problemHash(envelope)]);
  for (let cur = envelope.problem.prev; cur && !guard.has(cur); ) {
    guard.add(cur);
    const file = join(ctx.out, 'problems', `${cur}.json`);
    if (!existsSync(file)) break;
    const prev = JSON.parse(readFileSync(file, 'utf8')) as Envelope;
    chainEnvelopes.push(prev);
    cur = prev.problem.prev;
  }
  const blobs = new Map<Hash, Uint8Array>();
  for (const e of chainEnvelopes) for (const h of Object.values(e.problem.data)) if (!blobs.has(h) && existsSync(join(ctx.out, 'blobs', h))) blobs.set(h, new Uint8Array(readFileSync(join(ctx.out, 'blobs', h))));
  const receipts: Receipt[] = [];
  for (const e of chainEnvelopes) receipts.push(...readLines(join(ctx.out, 'ledger', `${problemHash(e)}.jsonl`)));
  receipts.push(...readLines(join(ctx.out, 'ledger', 'identity.jsonl')));
  return { envelopes: chainEnvelopes, blobs, receipts, now: at };
}

/** A chain from a tracker, taken only if it verifies and only adds to what the mirror holds; refuses one that does not verify or did not only grow, and passes over one it could not read whole. */
async function takeChain(ctx: Context, url: string, genesis: Hash, file: string, label: string): Promise<{ lines: Receipt[]; added: number } | null> {
  const lines = await getLines(ctx, url);
  if (!lines) return null;
  const check = verifyChain(lines, genesis);
  if (!check.ok) {
    ctx.report.refused.push(`${label}: chain from ${url} does not verify: ${check.problems[0]}`);
    return null;
  }
  const held = readLines(file);
  const growth = onlyAppends(held, lines);
  if (!growth.ok) {
    ctx.report.refused.push(`${label}: chain from ${url} did not only grow: ${growth.problem}`);
    return null;
  }
  if (growth.added > 0 || !existsSync(file)) writeLines(file, lines);
  return { lines, added: growth.added };
}

/** The envelope's blobs, each from the file held here where it hashes right and from the tracker otherwise; null where one does not check. */
async function takeBlobs(ctx: Context, tracker: string, envelope: Envelope): Promise<Map<Hash, Uint8Array> | null> {
  const blobs = new Map<Hash, Uint8Array>();
  for (const h of Object.values(envelope.problem.data)) {
    const file = join(ctx.out, 'blobs', h);
    let bytes: Uint8Array | null = existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
    if (!bytes || hashBytes(bytes) !== h) bytes = await getBytes(ctx, `${tracker}b/${h}`);
    if (!bytes || hashBytes(bytes) !== h) return null;
    blobs.set(h, bytes);
  }
  return blobProblems(envelope.problem, blobs).length ? null : blobs;
}

/** A problem from a tracker, taken once: refuses an envelope that does not check or is not its owner's, a blob that does not check, and a chain that does not verify or did not only grow; a problem taken from an earlier tracker is left as it is. */
async function takeProblem(ctx: Context, tracker: string, hash: Hash): Promise<void> {
  if (ctx.index.has(hash)) return;
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
  const chain = await takeChain(ctx, `${tracker}p/${hash}/events`, hash, join(ctx.out, 'ledger', `${hash}.jsonl`), hash);
  if (!chain) return;
  writeFileSync(join(ctx.out, 'problems', `${hash}.json`), JSON.stringify(envelope, null, 2) + '\n');
  for (const [h, bytes] of blobs) writeFileSync(join(ctx.out, 'blobs', h), bytes);
  ctx.index.set(hash, { envelope, tracker });
  // Names and the output come from the events, not the tracker's word.
  for (const line of chain.lines) if (line.event.type === 'version' && line.event.key === envelope.problem.owner) {
    const { slug, hash: target } = line.event.body as { slug: string; hash: Hash };
    const file = join(ctx.out, 'names', envelope.problem.owner, slug);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${target}\n`);
  }
  let complete = false;
  try {
    const state = reduce(inputFor(ctx, envelope, ctx.now()));
    complete = state.complete;
    if (state.output) {
      mkdirSync(join(ctx.out, 'outputs', hash), { recursive: true });
      writeFileSync(join(ctx.out, 'outputs', hash, 'output.json'), JSON.stringify(state.output.document, null, 2) + '\n');
      writeFileSync(join(ctx.out, 'outputs', hash, 'hash'), `${state.output.hash}\n`);
    }
  } catch (err) {
    ctx.report.errors.push(`${hash}: ${(err as Error).message}`);
  }
  ctx.report.problems.push({ hash, lines: chain.lines.length, added: chain.added, complete });
}

/** The identity log from a tracker, taken like a chain. Every tracker serves the one log, so with several the report's `lines` is the last one's count and `added` the most any one of them added over what was held when it was read. */
async function takeIdentity(ctx: Context, tracker: string): Promise<void> {
  const identity = await takeChain(ctx, `${tracker}k/events`, IDENTITY_LOG, join(ctx.out, 'ledger', 'identity.jsonl'), 'identity');
  if (identity) ctx.report.identity = { lines: identity.lines.length, added: Math.max(ctx.report.identity.added, identity.added) };
}

/**
 * QX-17: the coin log of the tracker that is the coin's home, taken like a chain, and the balances it says it computed.
 * The tracker's balances are its word. They are kept only where the mirror computes the same from the receipts it
 * holds and the parameters the tracker publishes, and, since the ledger admits a credit on the reader's signature
 * alone, only where every credit is what the chain holds at that deposit; with no chain to ask, a ledger with credits
 * is refused rather than trusted. A head that moved between the two reads is left for the next run (`reproduced: null`).
 */
async function takeCoin(ctx: Context, tracker: string, chain: DepositReader | null): Promise<void> {
  const wellKnown = (await getJson(ctx, `${tracker}.well-known/quilt`)) as { coin?: (CoinParams & { home?: string | null; extension?: string }) | null } | null;
  const published = wellKnown?.coin ?? null;
  if (!published || !(published.home === 'here' || published.home === undefined || published.home === null)) return;
  const log = await takeChain(ctx, `${tracker}coin/events`, COIN_LOG, join(ctx.out, 'ledger', 'coin.jsonl'), 'coin');
  if (!log) return;
  const held = log.lines[log.lines.length - 1];
  const coin: NonNullable<MirrorReport['coin']> = { lines: log.lines.length, added: log.added, head: held?.seq ?? null, reproduced: null };
  ctx.report.coin = coin;
  const state = (await getJson(ctx, `${tracker}coin/state`)) as CoinState | null;
  const same = state && ((state.head === null && !held) || (state.head !== null && held !== undefined && state.head.seq === held.seq && state.head.hash === held.hash));
  if (!state || !same) return;
  const { home: _home, extension: _extension, ...params } = published;
  try {
    const { differs, credits } = reproduceBalances(ctx, params as CoinParams, log.lines, state);
    const wrongCredit = await checkCredits(chain, credits);
    coin.credits = credits.length;
    if (wrongCredit !== null) {
      ctx.report.refused.push(`coin: ${wrongCredit}, at head ${state.head?.seq ?? 0} from ${tracker}`);
      coin.reproduced = false;
    } else if (differs === undefined) {
      mkdirSync(join(ctx.out, 'coin'), { recursive: true });
      writeFileSync(join(ctx.out, 'coin', 'balances.json'), JSON.stringify({ head: state.head, at: state.at, params: published, balances: state.balances }, null, 2) + '\n');
      coin.reproduced = true;
    } else {
      ctx.report.refused.push(`coin: the balances at head ${state.head?.seq ?? 0} from ${tracker} do not reproduce here (${differs})`);
      coin.reproduced = false;
    }
  } catch (err) {
    ctx.report.errors.push(`coin: ${(err as Error).message}`);
  }
}

/** The balances recomputed here from the receipts held and the parameters published, with the tracker's own layer code: the first root whose balance is not the tracker's, and the credits the ledger kept. */
function reproduceBalances(ctx: Context, params: CoinParams, lines: Receipt[], state: CoinState): { differs: string | undefined; credits: CreditLine[] } {
  const inputs: ReduceInput[] = [];
  for (const { envelope } of ctx.index.values()) inputs.push(inputFor(ctx, envelope, state.at));
  const layer = challengeLayer({ problems: inputs, now: state.at, coin: lines });
  const folded = coinLayer({ layer, params, receipts: lines, now: state.at });
  const mine = Object.fromEntries(folded.balances());
  const roots = [...new Set([...Object.keys(mine), ...Object.keys(state.balances)])].sort();
  const differs = roots.find((r) => JSON.stringify(mine[r] ?? null) !== JSON.stringify(state.balances[r] ?? null));
  return { differs, credits: folded.credits() };
}

/** Every credit the ledger kept, against the deposit the chain holds at its number: why the first wrong one is refused, or null; with no chain to ask, any credit at all is refused. */
async function checkCredits(chain: DepositReader | null, credits: CreditLine[]): Promise<string | null> {
  if (!chain) return credits.length ? `${credits.length} credit${credits.length === 1 ? '' : 's'} on the ledger and no chain to check them against` : null;
  for (const c of credits) {
    const d = await chain.depositAt(c.deposit);
    if (!d.made || d.root.toLowerCase() !== c.root.toLowerCase() || BigInt(d.amount) !== BigInt(c.amount)) return `the credit for deposit ${c.deposit} (${c.amount} to ${c.root}) is not what the chain holds`;
  }
  return null;
}

/** keys.json: each address's latest name and the delegations in force at `at`, folded from the identity log alone. */
function writeKeys(ctx: Context, at: string): void {
  writeFileSync(join(ctx.out, 'keys.json'), JSON.stringify(keysFromIdentity(readLines(join(ctx.out, 'ledger', 'identity.jsonl')), at), null, 2) + '\n');
}

/** index.json: every problem taken, with its title, slug, owner, the tracker it came from and the hides on it (QX-6). */
function writeIndex(ctx: Context, at: string): void {
  const hiddenBy = hiddenFromIdentity(readLines(join(ctx.out, 'ledger', 'identity.jsonl')));
  const problems = [...ctx.index].map(([hash, { envelope, tracker }]) => ({ hash, title: envelope.problem.title, slug: envelope.problem.slug, owner: envelope.problem.owner, tracker, hidden: hiddenBy.get(hash) ?? [] }));
  writeFileSync(join(ctx.out, 'index.json'), JSON.stringify({ quilt: 1, mirrored: at, problems }, null, 2) + '\n');
}

/** QX-12: the head of every chain held here (each problem's, the identity log's and the coin log's), stamped outside the ledger when asked; a head already stamped is kept. */
async function anchorAll(ctx: Context, anchor: true | { calendars?: string[] }): Promise<void> {
  const heads: ChainHead[] = [];
  const headOf = (file: string, problem: string) => {
    const lines = readLines(file);
    const last = lines[lines.length - 1];
    if (last && typeof last.hash === 'string' && typeof last.seq === 'number') heads.push({ problem, seq: last.seq, hash: last.hash });
  };
  for (const p of ctx.report.problems) headOf(join(ctx.out, 'ledger', `${p.hash}.jsonl`), p.hash);
  headOf(join(ctx.out, 'ledger', 'identity.jsonl'), 'identity');
  headOf(join(ctx.out, 'ledger', 'coin.jsonl'), 'coin');
  ctx.report.anchors = await anchorHeads({ out: ctx.out, heads, ...(typeof anchor === 'object' && anchor.calendars ? { calendars: anchor.calendars } : {}), fetchImpl: ctx.fetchImpl, now: ctx.now });
}
