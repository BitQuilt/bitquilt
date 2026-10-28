/**
 * The reference tracker (PROTOCOL.md, The tracker): a resolver that answers a hash, accepts a signed event after
 * checking it, stamps receipts strictly increasing on each problem, keeps the chain, serves an index, and forges
 * nothing. Everything it serves is checkable from hashes and signatures; what it may do beyond serving is stamp,
 * refuse, omit and hide. Admission (the gate, rate limits, the stamp) lives here and not in the reducer.
 *
 * The file runs in the order a request does: the options and the shared readers, publishing, the door (what is checked
 * before an event is appended), the views (what is served), then the routes that tie the two to paths.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  type Address, type Envelope, type Event, type Hash, type Receipt, type ReduceInput, type Client, type Capability,
  blobProblems, envelopeProblems, eventId, eventProblems, eventSignedByKey, expandPieces, hashBytes, isAddress, isHash,
  next, plainTextProblems, problemHash, reduce, returnProblems, returnStrings, signedBy, stampOk, textIssues, verifyChain, withSlash, CAPABILITIES, IDENTITY_LOG,
} from '@bitquilt/core';
import { createHash } from 'node:crypto';
import { type Layer, type ProblemLayer, CHALLENGE_EVENTS, EXTENSION, GROUND_MAX, MAJORITY, PANEL, SEED, challengeBodyProblems, challengeLayer, verdictBodyProblems } from './challenge.js';
import { HIDE, type Hidden, hideBodyProblems, hiddenNow } from './hide.js';
import { RECIPROCITY, SEEDING, offerOrder, seedBodyProblems, seedInfo, watchExclusions } from './seeding.js';
import { EXTENSIONS, JUDGE_SEED, RANK_EVENTS, kindOf, rankBodyProblems } from './verifiers.js';
import { type CoinLockWord, PRODUCTION_EVENTS, STAKE, STAKE_EVENTS, lockBodyProblems, stakeRuleBodyProblems } from './stake.js';
import { GOLD, GOLD_EVENTS, goldBodyProblems, goldRevealBodyProblems } from './gold.js';
import { type CoinLayer, type CoinLockView, type CoinParams, type CoinWord, COIN, COIN_EVENTS, COIN_LOG, coinLayer } from './coin.js';
import type { Store } from './store.js';

/** The identity log (CORE.md): the pseudo-problem that name, delegate, revoke, rotate and hide events are chained under. */
export const IDENTITY: Hash = IDENTITY_LOG;
const PIECE_EVENTS: ReadonlySet<string> = new Set(['claim', 'commit', 'reveal', 'decline', 'run']);
const IDENTITY_EVENTS: ReadonlySet<string> = new Set(['name', 'delegate', 'revoke', 'rotate', 'hide']);
const PROBLEM_EVENTS: ReadonlySet<string> = new Set(['version', 'output', 'announce', 'seed']);
/** What the problem log takes: the core's piece and problem events, then one set per extension in registry order. */
const PROBLEM_LOG_EVENTS: ReadonlySet<string> = new Set([...PIECE_EVENTS, ...PROBLEM_EVENTS, ...CHALLENGE_EVENTS, ...RANK_EVENTS, ...STAKE_EVENTS, ...GOLD_EVENTS]);
/** The most a post may carry, 4 MB: room for an envelope with its blobs. */
const MAX_BODY = 4 * 1024 * 1024;
/** How long a piece handed out by next or the offer is held for that key, so two clients here are not handed the same piece in the same minute. */
const HOLD_SECONDS = 60;

export interface TrackerOptions {
  store: Store;
  /** This tracker's own address, written into every receipt. */
  url: string;
  /** The name the well-known document gives this tracker; its address when none. */
  name?: string;
  /** Other trackers' addresses, published at the well-known document for a client to try next. */
  peers?: string[];
  /** Posts an hour from one key and from one network address (120 and 600 when none are given). */
  limits?: { keyPerHour: number; ipPerHour: number };
  /** The bits of proof of work a name event carries here (CORE.md, the stamp); 0, the default, asks none. */
  stamp?: { name: number };
  /** What a network address is hashed with before it names a rate-limit bucket; random at each start when none is given, so a bucket is not read back to an address. */
  ipSalt?: string;
  /** The clock, for the tests; the system's when none is given. */
  now?: () => string;
  /** The keys whose hide events this tracker honours (QX-6); published at the well-known document. */
  maintainers?: Address[];
  /** A secret only this process knows: a post carrying it in x-quilt-custody was made by the connector mounted beside the tracker, for a key it holds. */
  custodySecret?: string;
  /** Routes mounted beside the tracker, such as the hosted on-ramp. Answers true when it handled the request. */
  extra?: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;
  /** QX-17: the coin this tracker carries, or reads from a home; absent, it has no coin log and honours no coin lock. */
  coin?: CoinParams;
  /** How the tracker reaches another tracker: the coin's home for a coin lock, and its parameters. */
  fetchImpl?: typeof fetch;
}

export interface Tracker {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  listen(port: number, host?: string): Promise<Server>;
  /** The core's fold of a problem this tracker holds. */
  reduceProblem(hash: Hash): ReturnType<typeof reduce> | null;
  /** The layer over every problem this tracker holds, at now: the challenge window (QX-1), the verifier kinds (QX-2, QX-3, QX-10), the stakes and locks (QX-15) and the owner's gold (QX-16). */
  layer(): Layer;
  /** One problem's view in that layer. */
  view(hash: Hash): ProblemLayer | null;
  /** QX-17: the coin as this tracker computes it at now, or null where it carries none. */
  coin(): CoinLayer | null;
}

/** What the door answers a request with when it refuses: a status and one sentence saying why, which `handle` writes as `{ error }`. */
class Refusal extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...headers });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Refusal(413, 'body over 4 MB');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Refusal(400, 'not JSON');
  }
}

/** Which log a post goes to: a problem's, the identity log, or the coin log (QX-17). */
type Log = { kind: 'problem'; hash: Hash } | { kind: 'identity' } | { kind: 'coin' };
/** What the door read of an event it admits: the chain it is appended to, and the word it vouches for in the receipt's wrapper (QX-17). */
interface Admitted { chain: Hash; word?: Record<string, unknown> }
/** A coin lock as the door read it (QX-17 section 5), with the rate it is read at and the coin log's head the reading stood under. */
interface CoinLockRead { lock: CoinLockView | null; rate: number; head: { seq: number; hash: string } | null }

export function createTracker(options: TrackerOptions): Tracker {
  const { store } = options;
  const url = withSlash(options.url);
  const now = options.now ?? (() => new Date().toISOString());
  const limits = options.limits ?? { keyPerHour: 120, ipPerHour: 600 };
  const stampNeeded = options.stamp?.name ?? 0;
  const ipSalt = options.ipSalt ?? createHash('sha256').update(String(Math.random())).digest('hex');

  const ipOf = (req: IncomingMessage): string => {
    const fwd = req.headers['x-forwarded-for'];
    const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0];
    return (first ?? req.socket.remoteAddress ?? 'unknown').trim();
  };
  const ipBucket = (req: IncomingMessage): string => `ip:${createHash('sha256').update(ipSalt + ipOf(req)).digest('hex').slice(0, 16)}`;
  const limit = (bucket: string, max: number): void => {
    if (store.hit(bucket, now().slice(0, 13), max)) throw new Refusal(429, 'over the hour\'s limit');
  };

  /** What the reducer takes for a problem: its chain, the blobs, every receipt along the chain and the identity log. */
  function inputFor(hash: Hash): ReduceInput | null {
    const chain = store.chain(hash);
    if (chain.length === 0) return null;
    const hashes = chain.map(problemHash);
    const receipts: Receipt[] = [];
    for (const h of hashes) receipts.push(...store.receipts(h));
    receipts.push(...store.receipts(IDENTITY));
    return { envelopes: chain, blobs: store.blobsFor(chain), receipts, now: now() };
  }

  function reduceProblem(hash: Hash) {
    const input = inputFor(hash);
    return input ? reduce(input) : null;
  }

  const maintainers: Address[] = options.maintainers ?? [];
  const maintainerSet = new Set(maintainers.map((a) => a.toLowerCase()));
  /** QX-6: what the maintainers have taken down here, read from the identity log each time. */
  function hidden(): Map<string, Hidden> {
    return maintainers.length ? hiddenNow(store.receipts(IDENTITY), maintainers) : new Map();
  }

  /** The challenge layer over every problem here: standing and the pool are functions of the whole store. */
  function layer(): Layer {
    const problems: ReduceInput[] = [];
    for (const e of store.listEnvelopes()) {
      const input = inputFor(e.hash);
      if (input) problems.push(input);
    }
    return challengeLayer({ problems, now: now(), ...(options.coin ? { coin: store.receipts(COIN_LOG) } : {}) });
  }

  /** QX-17: the coin over the layer, from the coin log and the parameters; null where this tracker carries none. */
  function coin(layered: Layer = layer()): CoinLayer | null {
    return options.coin ? coinLayer({ layer: layered, params: options.coin, receipts: store.receipts(COIN_LOG), now: now() }) : null;
  }
  const coinHome = (): string | null => (options.coin ? options.coin.home ?? 'here' : null);
  const fetchImpl = options.fetchImpl ?? fetch;
  let homeRate: number | null = null;

  function view(hash: Hash): ProblemLayer | null {
    return layer().problems.get(hash) ?? null;
  }

  // Publishing

  async function publish(req: IncomingMessage, res: ServerResponse): Promise<void> {
    limit(ipBucket(req), limits.ipPerHour);
    const body = parseJson(await readBody(req)) as { envelope?: unknown; blobs?: Record<string, string> };
    const envelope = body.envelope;
    const problems = envelopeProblems(envelope);
    if (problems.length) throw new Refusal(400, problems[0]!);
    const e = envelope as Envelope;
    if (!signedBy(e as unknown as Record<string, unknown>, e.problem.owner)) throw new Refusal(400, 'envelope: not signed by its owner');
    const blobs = new Map<Hash, Uint8Array>();
    for (const [h, b64] of Object.entries(body.blobs ?? {})) {
      if (!isHash(h)) throw new Refusal(400, `blob ${h}: not a hash`);
      const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
      if (hashBytes(bytes) !== h) throw new Refusal(400, `blob ${h}: does not match its hash`);
      blobs.set(h, bytes);
    }
    for (const h of Object.values(e.problem.data)) if (!blobs.has(h)) {
      const stored = store.getBlob(h);
      if (stored) blobs.set(h, stored);
    }
    const bp = blobProblems(e.problem, blobs);
    if (bp.length) throw new Refusal(400, bp[0]!);
    // Admission: the gate on what a thousand AIs will read.
    for (const [label, text] of [['title', e.problem.title], ['done_when', e.problem.done_when]] as const) {
      const issues = plainTextProblems(text, label);
      if (issues.length) throw new Refusal(400, issues[0]!);
    }
    for (const [name, d] of Object.entries(e.problem.pieces)) {
      const issues = plainTextProblems(d.brief, `pieces.${name}.brief`);
      if (issues.length) throw new Refusal(400, issues[0]!);
    }
    // QX-17: at the coin's home, a window longer than the home admits would leave a fake's coin vested before a late challenge decides.
    const windowMax = options.coin?.window_max_h;
    if (windowMax !== undefined && coinHome() === 'here' && e.problem.settings.challenge_window_h > windowMax) {
      throw new Refusal(400, `the challenge window of ${e.problem.settings.challenge_window_h} hours is beyond the ${windowMax} this home admits (QX-17)`);
    }
    if (e.problem.prev) {
      const prev = store.getEnvelope(e.problem.prev);
      if (!prev) throw new Refusal(400, 'prev: not a problem this tracker holds');
      if (prev.envelope.problem.owner !== e.problem.owner) throw new Refusal(400, 'prev: by another owner');
    }
    try {
      expandPieces(e.problem, blobs);
    } catch (err) {
      throw new Refusal(400, `data: ${(err as Error).message}`);
    }
    const hash = problemHash(e);
    const at = now();
    store.putEnvelope(hash, e, at);
    for (const [h, bytes] of blobs) store.putBlob(h, bytes);
    json(res, 201, { hash });
  }

  // The door

  /**
   * Takes an event for a log: the network address's limit, the parse, the shape, the signature, the key's limit, then
   * the log's own admission, the dedupe, the append, and what the append changes beside the chain.
   */
  async function postEvent(req: IncomingMessage, res: ServerResponse, log: Log): Promise<void> {
    limit(ipBucket(req), limits.ipPerHour);
    const event = parseJson(await readBody(req)) as Event;
    const shape = eventProblems(event);
    if (shape.length) throw new Refusal(400, shape[0]!);
    if (!eventSignedByKey(event)) throw new Refusal(400, 'signature is not the key\'s');
    limit(`key:${event.key}`, limits.keyPerHour);
    const id = eventId(event);
    const hosted = hostedPost(req);
    const { chain, word } = log.kind === 'coin' ? admitCoinEvent(event) : log.kind === 'identity' ? admitIdentityEvent(event) : await admitProblemEvent(event, log.hash, hosted);
    if (store.hasEvent(chain, id)) throw new Refusal(409, 'already here');
    const line = hosted ? store.appendReceipt(chain, event, id, url, now(), 'hosted', 'ai', word) : store.appendReceipt(chain, event, id, url, now(), 'self', undefined, word);
    const at = line.received[0]!.at;
    const type = event.type;
    if (log.kind === 'problem') {
      if ((type === 'reveal' || type === 'decline') && event.piece) store.releaseHold(log.hash, event.piece, event.key);
      if (type === 'announce') store.putAnnouncement(log.hash, event.key, event, at);
    }
    if (type === 'version') store.putName(event.key, (event.body as { slug: string }).slug, (event.body as { hash: Hash }).hash, at);
    json(res, 202, { id, seq: line.seq, hash: line.hash, at });
  }

  /** Whether a post was made by the connector mounted beside this tracker, for a key it holds: a seat this tracker opened for a person. */
  function hostedPost(req: IncomingMessage): boolean {
    return options.custodySecret !== undefined && req.headers['x-quilt-custody'] === options.custodySecret;
  }

  /** QX-17: the coin log, admitted against the layer's balances at now; a burn's word is the standing it credits. */
  function admitCoinEvent(event: Event): Admitted {
    if (!options.coin) throw new Refusal(404, 'this tracker carries no coin');
    if (!COIN_EVENTS.has(event.type)) throw new Refusal(400, 'the coin log takes lock, pay, burn, transfer, redeem and credit');
    if (event.problem !== undefined || event.piece !== undefined) throw new Refusal(400, 'a coin event names no problem in its fields');
    const a = coin()!.admit(event);
    if (!a.ok) throw new Refusal(400, a.why);
    return event.type === 'burn' ? { chain: COIN_LOG, word: { stake: { kind: 'burn', amount: event.body.amount, standing: a.standing ?? 0 } } } : { chain: COIN_LOG };
  }

  /** The identity log: its five kinds and no problem named; a name carries the stamp asked here; a hide (QX-6) is a maintainer's and well formed. */
  function admitIdentityEvent(event: Event): Admitted {
    const type = event.type;
    if (!IDENTITY_EVENTS.has(type)) throw new Refusal(400, 'the identity log takes name, delegate, revoke, rotate and hide');
    if (event.problem !== undefined || event.piece !== undefined) throw new Refusal(400, 'an identity event names no problem');
    if (type === 'name' && stampNeeded > 0 && !stampOk(event, stampNeeded)) throw new Refusal(400, `a name event here carries a stamp of ${stampNeeded} bits`);
    if (type === 'hide') {
      const hp = hideBodyProblems(event.body);
      if (hp.length) throw new Refusal(400, hp[0]!);
      if (!maintainerSet.has(event.key.toLowerCase())) throw new Refusal(403, 'a hide is signed by one of this tracker\'s maintainers');
    }
    return { chain: IDENTITY };
  }

  /** A problem's log: what the allow-list takes, under the problem it names, not taken down, then each kind's own check in the order the list reads. */
  async function admitProblemEvent(event: Event, under: Hash, hosted: boolean): Promise<Admitted> {
    const type = event.type;
    if (IDENTITY_EVENTS.has(type)) throw new Refusal(400, 'identity events go to the identity log');
    if (!PROBLEM_LOG_EVENTS.has(type)) throw new Refusal(400, `this tracker does not carry ${type} events`);
    if (event.problem !== under) throw new Refusal(400, 'post an event under the problem it names');
    if (hidden().has(under)) throw new Refusal(410, 'this problem is taken down here');
    const state = reduceProblem(under);
    if (!state) throw new Refusal(404, 'no such problem here');
    if (PIECE_EVENTS.has(type)) checkPieceEvent(event, under, state, hosted);
    if (type === 'seed') {
      const sp = seedBodyProblems(event.body);
      if (sp.length) throw new Refusal(400, sp[0]!);
    }
    if (type === 'announce') checkAnnounceEvent(event, state.envelope);
    if (CHALLENGE_EVENTS.has(type)) checkChallengeEvent(event, under);
    if (RANK_EVENTS.has(type)) checkRankEvent(event, under);
    let word: Record<string, unknown> | undefined;
    if (STAKE_EVENTS.has(type)) {
      const w = await checkStakeEvent(event, under, state);
      if (w) word = { stake: w };
    }
    if (GOLD_EVENTS.has(type)) checkGoldEvent(event, under);
    return word ? { chain: under, word } : { chain: under };
  }

  /** The door for the core's piece events: a piece the problem has; on a staked piece, a root with a live lock (QX-15); a reveal's return through the schema and the gate, on an unrevealed commit; a run on a revealed digest. */
  function checkPieceEvent(event: Event, under: Hash, state: ReturnType<typeof reduce>, hosted: boolean): void {
    const view = event.piece ? state.byHash.get(event.piece) : undefined;
    if (!view) throw new Refusal(400, 'names a piece this problem does not have');
    if (PRODUCTION_EVENTS.has(event.type)) {
      // QX-15: on a staked piece, work is admitted only from a root with a live lock.
      const a = layer().admitProduction(under, event.piece!, event.key);
      if (!a.ok) throw new Refusal(400, a.why);
    }
    if (event.type === 'reveal') {
      const ret = (event.body as { return: Record<string, unknown> }).return;
      if (view.piece.schema) {
        const rp = returnProblems(view.piece.schema, ret);
        if (rp.length) throw new Refusal(400, rp[0]!);
      }
      for (const s of returnStrings(ret)) {
        const issues = plainTextProblems(s, 'return');
        if (issues.length) throw new Refusal(400, issues[0]!);
      }
      if (!view.commits.some((c) => c.key === event.key && !c.revealed)) throw new Refusal(400, 'no unrevealed commit by this key on the piece');
      checkRevealEvent(event, under, view.piece.verifier, hosted);
    }
    if (event.type === 'run' && !view.reveals.some((r) => r.digest === (event.body as { digest: Hash }).digest)) throw new Refusal(400, 'the digest is no revealed return of the piece');
  }

  /**
   * The door for the verifier kinds' reveals: a human piece takes a return only from a person's seat (QX-3), which here is
   * the connector's custody or a client declaring the model `human`; a judge piece takes no more candidates once its
   * panel sits (QX-2). The layer would count neither; the door says why.
   */
  function checkRevealEvent(event: Event, under: Hash, verifier: string, hosted: boolean): void {
    const kind = kindOf(verifier)?.kind;
    if (kind === 'human') {
      const by = (event.body as { by: { model: string } }).by;
      if (by.model !== 'human' && !hosted) throw new Refusal(400, 'a human piece takes a return from a person\'s seat');
    }
    if (kind === 'judge' && event.piece && view(under)?.panels.some((p) => p.piece === event.piece)) throw new Refusal(400, 'the candidates for this piece are in');
  }

  /** The door for QX-13's announce: the title, slug and done_when are the envelope's, and the topics are few, short and through the gate. */
  function checkAnnounceEvent(event: Event, envelope: Envelope): void {
    const b = event.body as Record<string, unknown>;
    if (b.title !== envelope.problem.title || b.slug !== envelope.problem.slug || b.done_when !== envelope.problem.done_when) throw new Refusal(400, 'announce: title, slug and done_when are the envelope\'s');
    if (!Array.isArray(b.topics) || b.topics.length > 8 || !b.topics.every((t) => typeof t === 'string' && t.length <= 40 && textIssues(t).length === 0)) throw new Refusal(400, 'announce: at most eight short topics through the gate');
  }

  /** The door for QX-1: a challenge from a root with standing, inside the window, with a panel to seat; a verdict from a judge drawn. */
  function checkChallengeEvent(event: Event, under: Hash): void {
    if (!event.piece) throw new Refusal(400, `a ${event.type} names a problem and a piece`);
    const layered = layer();
    const body = event.body;
    if (event.type === 'challenge') {
      const shape = challengeBodyProblems(body);
      if (shape.length) throw new Refusal(400, shape[0]!);
      const issues = plainTextProblems(body.ground as string, 'ground');
      if (issues.length) throw new Refusal(400, issues[0]!);
      const a = layered.admitChallenge(under, event.piece, event.key, body.stake as number);
      if (!a.ok) throw new Refusal(400, a.why);
      return;
    }
    const shape = verdictBodyProblems(body);
    if (shape.length) throw new Refusal(400, shape[0]!);
    if (body.return !== undefined) for (const s of returnStrings(body.return as Record<string, unknown>)) {
      const issues = plainTextProblems(s, 'return');
      if (issues.length) throw new Refusal(400, issues[0]!);
    }
    const a = layered.admitVerdict(under, event.piece, event.key, body.challenge as Hash, body);
    if (!a.ok) throw new Refusal(400, a.why);
  }

  /** The door for QX-2's rank: from a judge drawn to the piece's panel, naming every candidate once. */
  function checkRankEvent(event: Event, under: Hash): void {
    if (!event.piece) throw new Refusal(400, 'a rank names a problem and a piece');
    const shape = rankBodyProblems(event.body);
    if (shape.length) throw new Refusal(400, shape[0]!);
    const a = layer().admitRank(under, event.piece, event.key, event.body);
    if (!a.ok) throw new Refusal(400, a.why);
  }

  /**
   * The door for QX-15: a stake rule from the owner naming pieces the problem has; a lock a root can cover, on a piece
   * that asks one. A coin-kind lock is checked against the coin log (QX-17), and what the door read is its word for the receipt.
   */
  async function checkStakeEvent(event: Event, under: Hash, state: ReturnType<typeof reduce>): Promise<CoinLockWord | null> {
    if (event.type === 'stake_rule') {
      if (event.piece !== undefined) throw new Refusal(400, 'a stake rule names a problem and no piece');
      const shape = stakeRuleBodyProblems(event.body);
      if (shape.length) throw new Refusal(400, shape[0]!);
      const a = layer().admitStakeRule(under, event.key, event.body);
      if (!a.ok) throw new Refusal(400, a.why);
      return null;
    }
    if (!event.piece) throw new Refusal(400, 'a lock names a problem and a piece');
    const shape = lockBodyProblems(event.body);
    if (shape.length) throw new Refusal(400, shape[0]!);
    let word: CoinWord | null = null;
    if (event.body.kind === 'coin') {
      if (!state.byHash.has(event.piece)) throw new Refusal(400, 'names a piece this problem does not have');
      word = await coinWord(under, event, state.rootOf(event.key, now()));
    }
    const a = layer().admitLock(under, event.piece, event.key, event.body, word);
    if (!a.ok) throw new Refusal(400, a.why);
    return word;
  }

  /** The door for QX-16: the owner's gold, kept whole or refused naming the piece; the owner's reveal on an accepted piece inside its window. */
  function checkGoldEvent(event: Event, under: Hash): void {
    if (event.type === 'gold') {
      if (event.piece !== undefined) throw new Refusal(400, 'a gold names a problem and no piece');
      const shape = goldBodyProblems(event.body);
      if (shape.length) throw new Refusal(400, shape[0]!);
      const a = layer().admitGold(under, event.key, event.body);
      if (!a.ok) throw new Refusal(400, a.why);
      return;
    }
    if (!event.piece) throw new Refusal(400, 'a gold reveal names a problem and a piece');
    const shape = goldRevealBodyProblems(event.body);
    if (shape.length) throw new Refusal(400, shape[0]!);
    const a = layer().admitGoldReveal(under, event.piece, event.key, event.body);
    if (!a.ok) throw new Refusal(400, a.why);
  }

  /**
   * A coin lock as the door reads it (QX-17 section 5): from this tracker's own coin layer at the home, from the home's
   * route elsewhere, with the burn rate the home publishes. `head` is the coin log's head the reading stood under, null
   * where there was none to read.
   */
  async function readCoinLock(home: string, id: Hash): Promise<CoinLockRead> {
    let head: { seq: number; hash: string } | null = null;
    if (home === 'here') {
      const c = coin()!;
      return { lock: c.lock(id), rate: c.burnRateAt(c.now), head: c.head };
    }
    let lock: CoinLockView | null = null;
    let rate: number | null = null;
    try {
      const r = await fetchImpl(`${home}coin/lock/${id}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const { head: h, rate: read, ...rest } = (await r.json()) as CoinLockView & { head: { seq: number; hash: string } | null; at: string; rate?: number };
        lock = rest;
        head = h;
        // The rate in force at the home when it answered; an indexed one moves with the epochs.
        if (typeof read === 'number') rate = read;
      } else if (r.status !== 404) throw new Error(`${r.status}`);
      if (rate === null) {
        // An older home answers no rate with the lock; the one its well-known publishes is read once.
        if (homeRate === null) {
          const w = (await (await fetchImpl(`${home}.well-known/quilt`, { signal: AbortSignal.timeout(8000) })).json()) as { stake?: { burn_rate?: number }; coin?: { burn_rate?: number } };
          const published = w.stake?.burn_rate ?? w.coin?.burn_rate;
          if (typeof published !== 'number') throw new Error('no coin');
          homeRate = published;
        }
        rate = homeRate;
      }
    } catch {
      throw new Refusal(400, 'the home did not answer');
    }
    return { lock, rate, head };
  }

  /**
   * Why the door does not admit a coin-kind lock on the coin lock it read, in the order QX-17 section 5 gives: the lock
   * is the root's, names this problem and piece, is live, is unbound, and backs at least the amount at the burn rate;
   * null when it does.
   */
  function coinLockProblem(lock: CoinLockView, rate: number, root: Address, under: Hash, event: Event): string | null {
    if (lock.root !== root) return 'the lock is another root\'s';
    if (lock.problem !== under || lock.piece !== event.piece) return 'the lock names another piece';
    if (lock.state !== 'live') return 'the lock has ended';
    if (lock.bound !== null) return 'the lock is bound';
    const amount = event.body.amount as number;
    if (Math.floor(lock.units / rate) < amount) return `the lock holds ${lock.units} units, a stake of ${Math.floor(lock.units / rate)} at ${rate} a point`;
    return null;
  }

  /** QX-17 section 5: what the door reads of a coin lock before it admits a coin-kind QX-15 lock, and writes into the receipt as its word. */
  async function coinWord(under: Hash, event: Event, root: Address): Promise<CoinWord> {
    const home = coinHome();
    if (home === null) throw new Refusal(400, 'this tracker honours no coin lock');
    const id = event.body.id as Hash;
    const { lock, rate, head } = await readCoinLock(home, id);
    if (!lock) throw new Refusal(400, 'no such lock on the coin log');
    const why = coinLockProblem(lock, rate, root, under, event);
    if (why) throw new Refusal(400, why);
    return { kind: 'coin', amount: event.body.amount as number, id, units: lock.units, home, head };
  }

  // The views

  /** What this tracker says of itself: its name, limits, the extensions it carries with their constants, and its routes. */
  function wellKnown() {
    return {
      quilt: 1, tracker: options.name ?? url, url, peers: options.peers ?? [], limits, stamp: { name: stampNeeded }, sortition: SEED,
      challenge: { extension: EXTENSION, panel: PANEL, majority: MAJORITY, ground_max: GROUND_MAX },
      verifiers: { human: EXTENSIONS.human, 'judge:n': EXTENSIONS.judge, attest: EXTENSIONS.attest, judge_seed: JUDGE_SEED },
      chain: 'QX-11', seeding: SEEDING, reciprocity: RECIPROCITY, hide: HIDE, maintainers, identity: IDENTITY, hosted: options.extra !== undefined,
      // `stake.burn_rate` is the rate in force now, which with `burn_indexed` moves with the epochs; `coin.burn_rate` is the parameter, its floor.
      stake: { extension: STAKE, coin: coinHome(), ...(options.coin ? { burn_rate: coin()!.burnRateAt(now()) } : {}) }, gold: { extension: GOLD },
      coin: options.coin ? { extension: COIN, ...options.coin, home: coinHome() } : null,
      // The list a client reads; the dispatcher in `handle` is kept in this order by hand.
      routes: [
        '/p', '/p/<hash>', '/p/<hash>/events', '/p/<hash>/state', '/p/<hash>/scrape', '/p/<hash>/next', '/p/<hash>/challenges', '/p/<hash>/panels', '/k/events', '/k/<address>/standing', '/b/<hash>', '/n/<owner>/<slug>', '/search', '/offer', '/hidden',
        ...(options.coin ? ['/coin/events', '/coin/lock/<id>', '/coin/balance/<root>', '/coin/epochs', '/coin/redeems', '/coin/credits', '/coin/state'] : []),
      ],
    };
  }

  /** A problem in one line for the index and the scrape: its title, counts, head, and what the extensions add. */
  function summary(hash: Hash, layered: Layer = layer()) {
    const pl = layered.problems.get(hash);
    if (!pl) return null;
    const s = pl.fold;
    const counts: Record<string, number> = {};
    for (const v of pl.pieces) counts[v.state] = (counts[v.state] ?? 0) + 1;
    const head = store.head(hash);
    const seed = seedInfo(inputFor(hash)!, pl.fold, layered.now);
    return {
      problem: hash,
      title: s.envelope.problem.title,
      slug: s.envelope.problem.slug,
      owner: s.envelope.problem.owner,
      done_when: s.envelope.problem.done_when,
      pieces: s.pieces.length,
      counts,
      complete: s.complete,
      output: s.output?.hash ?? null,
      last: head?.at ?? null,
      head: head ? { seq: head.seq, hash: head.hash, short: `${head.hash.slice(0, 8)}:${head.hash.slice(8, 16)}` } : null,
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
   * extensions reads `state`, and the kind says how the square is earned and how strongly.
   */
  function state(hash: Hash, pl: ProblemLayer) {
    const s = pl.fold;
    return {
      problem: hash, now: now(), hidden: hidden().get(hash) ?? null, stake_rule: pl.stake,
      pieces: s.pieces.map((v) => {
        const l = pl.byHash.get(v.piece.hash)!;
        return {
          name: v.piece.name, hash: v.piece.hash, verifier: v.piece.verifier, state: l.state, core: l.core, challenge: l.challenge?.id ?? null,
          kind: l.kind.kind, extension: l.kind.extension, strength: l.kind.strength, says: l.kind.says, weakest: l.kind.weakest, attested: l.attested, panel: l.panel?.outcome ?? null,
          availability: v.availability, dependents: v.dependents, reveals: v.reveals.length, claims: v.claims.length, stake: l.stake, gold: l.gold, verified: l.verified,
        };
      }),
      gold: pl.goldCount, complete: s.complete, output: s.output?.hash ?? null, dropped: [...s.dropped, ...pl.dropped],
    };
  }

  /** The name a root chose, as the problem's fold has it, or null. */
  function nameIn(pl: ProblemLayer): (a: string) => string | null {
    return (a) => pl.fold.names.get(a as Address)?.name ?? null;
  }

  /** A problem's challenges as the tracker computes them at now: the seats, each verdict with its judge, the outcome. */
  function challenges(pl: ProblemLayer, name: (a: string) => string | null) {
    return pl.challenges.map((c) => ({
      id: c.id, piece: c.piece, name: pl.byHash.get(c.piece)?.name ?? null, key: c.key, root: c.root, challenger: name(c.root), at: c.at, stake: c.stake, ground: c.ground, against: c.against,
      parties: c.parties, seed: c.seed, panel: PANEL, majority: MAJORITY,
      seats: c.seats.map((s) => ({ root: s.root, judge: name(s.root), offered_at: s.offeredAt, lapsed_at: s.lapsedAt, verdict: s.verdict ? { id: s.verdict.id, at: s.verdict.at, for: s.verdict.for, return: s.verdict.return } : null })),
      outcome: c.outcome, decided_at: c.decidedAt, struck: c.struck, dropped: c.dropped,
    }));
  }

  /** A problem's judge panels as the tracker computes them at now: the candidates by digest (their signers named once the panel has decided), the seats, each rank, the outcome. */
  function panels(pl: ProblemLayer, name: (a: string) => string | null) {
    return pl.panels.map((p) => ({
      piece: p.piece, name: p.name, verifier: pl.byHash.get(p.piece)?.kind.verifier ?? null, panel: p.panel, majority: p.majority, wanted: p.wanted, seed: p.seed, completed_at: p.completedAt,
      candidates: p.candidates.map((c) => (p.outcome === 'decided' ? { digest: c.digest, return: c.return, root: c.root, signer: name(c.root) } : { digest: c.digest, return: c.return })),
      seats: p.seats.map((s) => ({ root: s.root, judge: name(s.root), offered_at: s.offeredAt, lapsed_at: s.lapsedAt, rank: s.rank ? { id: s.rank.id, at: s.rank.at, ranking: s.rank.ranking } : null })),
      outcome: p.outcome, winner: p.winner, decided_at: p.decidedAt, dropped: p.dropped,
    }));
  }

  /** The problems here, each in summary with its topics (QX-13), those matching `q` when one is given; hidden ones left out. */
  function index(query: URLSearchParams) {
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const topicsByProblem = new Map<Hash, Set<string>>();
    for (const a of store.announcements()) {
      const set = topicsByProblem.get(a.problem) ?? new Set<string>();
      for (const t of ((a.event.body as { topics?: string[] }).topics ?? [])) set.add(t.toLowerCase());
      topicsByProblem.set(a.problem, set);
    }
    const out: unknown[] = [];
    const layered = layer();
    const hid = hidden();
    for (const e of store.listEnvelopes()) {
      if (hid.has(e.hash)) continue;
      const topics = [...(topicsByProblem.get(e.hash) ?? [])];
      const hay = `${e.envelope.problem.title} ${e.envelope.problem.slug} ${e.envelope.problem.done_when} ${topics.join(' ')}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const s = summary(e.hash, layered);
      if (s) out.push({ ...s, topics });
    }
    return out;
  }

  /** A chain's lines after `since`, a page at a time, as newline-delimited JSON; the header names the next page. */
  function events(res: ServerResponse, hash: Hash, since: number): void {
    const page = 500;
    const lines = store.receipts(hash, since, page + 1);
    const more = lines.length > page;
    const out = more ? lines.slice(0, page) : lines;
    const headers: Record<string, string> = { 'content-type': 'application/x-ndjson; charset=utf-8', 'access-control-allow-origin': '*' };
    if (more) headers['x-quilt-next-since'] = String(out[out.length - 1]!.seq);
    res.writeHead(200, headers);
    res.end(out.map((l) => JSON.stringify(l)).join('\n') + (out.length ? '\n' : ''));
  }

  /** A chain's head at a sequence: that line's seq and hash, or null where the chain is shorter. */
  function headAt(hash: Hash, seq: number): { seq: number; hash: string } | null {
    const line = store.receipts(hash, Math.max(0, seq - 1), 1)[0];
    return line && line.seq === seq && typeof line.hash === 'string' ? { seq: line.seq, hash: line.hash } : null;
  }

  /** The coin log's head a listing stands under: the head itself, or the line at the query's `upto` when that is earlier. */
  function headUpto(c: CoinLayer, query: URLSearchParams): { head: { seq: number; hash: string } | null; upto: number | undefined } {
    const asked = query.get('upto');
    const n = asked === null ? null : Number(asked);
    if (n !== null && (!Number.isInteger(n) || n < 0)) throw new Refusal(400, 'upto: a whole number');
    const head = n === null || c.head === null || n >= c.head.seq ? c.head : headAt(COIN_LOG, n);
    return { head, upto: n ?? undefined };
  }

  /** The key and the client a next or an offer is asked for: `key` with its checksum, `can` from the capabilities, `model` as declared. */
  function clientFrom(query: URLSearchParams): { key: Address; client: Client } {
    const key = query.get('key');
    if (!isAddress(key)) throw new Refusal(400, 'key: an address with its checksum');
    const can = (query.get('can') ?? '').split(',').filter(Boolean);
    if (!can.every((c) => (CAPABILITIES as readonly string[]).includes(c))) throw new Refusal(400, `can: from ${CAPABILITIES.join(', ')}`);
    return { key, client: { can: can as Capability[], model: query.get('model') ?? 'unknown/unknown' } };
  }

  /** Holds a piece for the key it was handed to, for HOLD_SECONDS from `at`. */
  function holdFor(problem: Hash, piece: Hash, key: Address, at: string): void {
    store.hold(problem, piece, key, new Date(Date.parse(at) + HOLD_SECONDS * 1000).toISOString());
  }

  /** Assisted next (CORE.md): the piece this tracker hands the key on one problem, held for it a minute. */
  function assisted(res: ServerResponse, hash: Hash, query: URLSearchParams): void {
    const { key, client } = clientFrom(query);
    // The layer's fold: a struck piece is open again, a challenged one is not offered while its panel sits, a judge piece
    // not while its candidates are judged, and a human piece only to a client that declared a person.
    const layered = layer();
    const pl = layered.problems.get(hash);
    if (!pl) throw new Refusal(404, 'no such problem here');
    if (hidden().has(hash)) throw new Refusal(410, 'this problem is taken down here');
    const state = pl.fold;
    const at = now();
    // QX-4: a watch piece goes to the seeders first, and a seeder is handed it before anything else.
    const input = inputFor(hash)!;
    const exclude = new Set<Hash>([...store.heldByOthers(hash, key, at), ...pl.unoffered]);
    if (!client.can.includes('person')) for (const p of pl.pieces) if (p.kind.kind === 'human') exclude.add(p.hash);
    for (const h of watchExclusions(pl, input, key, seedInfo(input, state, at).seeders, at)) exclude.add(h);
    // QX-15: a staked piece the key's free standing cannot cover, and on which it holds no lock, is not offered.
    const unaffordable = [...layered.unaffordable(hash, key)];
    for (const h of unaffordable) exclude.add(h);
    const pick = next(state, key, client, at, { exclude });
    if (!pick) {
      json(res, 200, { piece: null, unaffordable });
      return;
    }
    const { kind, stake } = pl.byHash.get(pick.piece.hash)!;
    holdFor(hash, pick.piece.hash, key, at);
    json(res, 200, {
      piece: pick.piece.hash, name: pick.piece.name, state: pick.state, brief: pick.brief, schema: pick.schema ?? null, agree: pick.agree, requires: pick.requires, lease_h: pick.lease_h,
      verifier: pick.piece.verifier, kind: kind.kind, extension: kind.extension, strength: kind.strength, says: kind.says, weakest: kind.weakest, workspace: pick.piece.workspace ?? null, check: pick.piece.check ?? null,
      stake, unaffordable,
    });
  }

  /** QX-5: the problems here with a piece for the key, in the order they are offered; the first is held as assisted next holds. */
  function offer(res: ServerResponse, query: URLSearchParams): void {
    const { key, client } = clientFrom(query);
    const at = now();
    const layered = layer();
    const inputs = new Map<Hash, ReduceInput>();
    const hid = hidden();
    for (const h of layered.problems.keys()) {
      if (hid.has(h)) continue;
      const input = inputFor(h);
      if (input) inputs.set(h, input);
    }
    const count = store.nextOfferCount(key);
    const list = offerOrder(layered, inputs, key, client, at, count, (h, pl, input) => {
      const exclude = store.heldByOthers(h, key, at);
      for (const x of watchExclusions(pl, input, key, seedInfo(input, pl.fold, at).seeders, at)) exclude.add(x);
      for (const x of layered.unaffordable(h, key)) exclude.add(x);
      return exclude;
    });
    const first = list[0];
    if (first) holdFor(first.problem, first.pick.piece.hash, key, at);
    json(res, 200, { offer: count, offers: list.map((o) => ({ problem: o.problem, title: o.title, slug: o.slug, owner: o.owner, reason: o.reason, piece: o.pick.piece.hash, name: o.pick.piece.name, state: o.pick.state, verifier: o.pick.piece.verifier, requires: o.pick.requires, lease_h: o.pick.lease_h })) });
  }

  // The routes, in the order the well-known document lists them.

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const u = new URL(req.url ?? '/', url);
      const path = u.pathname.replace(/\/+$/, '') || '/';
      const method = req.method ?? 'GET';
      if (method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' });
        res.end();
        return;
      }
      if (path === '/.well-known/quilt' && method === 'GET') {
        json(res, 200, wellKnown());
        return;
      }
      // The problems: published, served by hash, their events, states and what the extensions compute.
      if (path === '/p' && method === 'POST') {
        await publish(req, res);
        return;
      }
      let m: RegExpExecArray | null;
      if ((m = /^\/p\/(sha256:[0-9a-f]{64})(?:\/(events|state|scrape|next|challenges|panels))?$/.exec(path))) {
        const hash = m[1] as Hash;
        const sub = m[2];
        if (!store.getEnvelope(hash)) throw new Refusal(404, 'no such problem here');
        if (sub === 'events' && method === 'POST') {
          await postEvent(req, res, { kind: 'problem', hash });
          return;
        }
        if (method !== 'GET') throw new Refusal(405, 'GET');
        if (sub === undefined) {
          json(res, 200, store.getEnvelope(hash)!.envelope);
          return;
        }
        if (sub === 'events') {
          events(res, hash, Number(u.searchParams.get('since') ?? 0));
          return;
        }
        if (sub === 'state') {
          json(res, 200, state(hash, view(hash)!));
          return;
        }
        if (sub === 'scrape') {
          const lines = store.receipts(hash);
          const chain = verifyChain(lines, hash);
          json(res, 200, { ...summary(hash), chain_ok: chain.ok });
          return;
        }
        if (sub === 'next') {
          assisted(res, hash, u.searchParams);
          return;
        }
        if (sub === 'challenges') {
          const pl = view(hash)!;
          json(res, 200, { problem: hash, now: now(), challenges: challenges(pl, nameIn(pl)) });
          return;
        }
        if (sub === 'panels') {
          const pl = view(hash)!;
          json(res, 200, { problem: hash, now: now(), panels: panels(pl, nameIn(pl)) });
          return;
        }
      }
      // The identity log, and a key's standing.
      if (path === '/k/events') {
        if (method === 'POST') {
          await postEvent(req, res, { kind: 'identity' });
          return;
        }
        events(res, IDENTITY, Number(u.searchParams.get('since') ?? 0));
        return;
      }
      if ((m = /^\/k\/(0x[0-9a-fA-F]{40})\/standing$/.exec(path)) && method === 'GET') {
        // QX-15: a key's standing, what is locked behind its claims, what is free, and the locks themselves.
        const address = m[1]!;
        if (!isAddress(address)) throw new Refusal(400, 'an address with its checksum');
        const layered = layer();
        const root = layered.rootOf(address);
        json(res, 200, {
          address, root, standing: layered.standing(root), locked: layered.locked(root), free: layered.free(root),
          locks: layered.liveLocks(root).map((l) => ({ problem: l.problem, piece: l.piece, amount: l.amount, at: l.at })), at: layered.now,
        });
        return;
      }
      // Blobs and names.
      if ((m = /^\/b\/(sha256:[0-9a-f]{64})$/.exec(path)) && method === 'GET') {
        const bytes = store.getBlob(m[1] as Hash);
        if (!bytes) throw new Refusal(404, 'no such blob here');
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'access-control-allow-origin': '*' });
        res.end(Buffer.from(bytes));
        return;
      }
      if ((m = /^\/n\/(0x[0-9a-fA-F]{40})\/([a-z0-9-]{1,64})$/.exec(path)) && method === 'GET') {
        const hash = store.getName(m[1]!, m[2]!);
        if (!hash) throw new Refusal(404, 'no such name here');
        json(res, 200, { hash });
        return;
      }
      // The index: the front page and the search, the offer, and what is taken down.
      if (path === '/' && method === 'GET') {
        json(res, 200, { quilt: 1, tracker: url, problems: index(u.searchParams) });
        return;
      }
      if (path === '/search' && method === 'GET') {
        json(res, 200, { problems: index(u.searchParams) });
        return;
      }
      if (path === '/offer' && method === 'GET') {
        offer(res, u.searchParams);
        return;
      }
      if (path === '/hidden' && method === 'GET') {
        json(res, 200, { hidden: [...hidden().values()] });
        return;
      }
      // The coin (QX-17): its log, and what the layer computes from it.
      if (path.startsWith('/coin')) {
        if (!options.coin) throw new Refusal(404, 'this tracker carries no coin');
        if (path === '/coin/events') {
          if (method === 'POST') {
            await postEvent(req, res, { kind: 'coin' });
            return;
          }
          events(res, COIN_LOG, Number(u.searchParams.get('since') ?? 0));
          return;
        }
        if (method !== 'GET') throw new Refusal(405, 'GET');
        let cm: RegExpExecArray | null;
        if ((cm = /^\/coin\/lock\/(sha256:[0-9a-f]{64})$/.exec(path))) {
          const c = coin()!;
          const lock = c.lock(cm[1] as Hash);
          if (!lock) throw new Refusal(404, 'no such lock on the coin log');
          json(res, 200, { ...lock, head: c.head, at: c.now, rate: c.burnRateAt(c.now) });
          return;
        }
        if ((cm = /^\/coin\/balance\/(0x[0-9a-fA-F]{40})$/.exec(path))) {
          if (!isAddress(cm[1])) throw new Refusal(400, 'an address with its checksum');
          const layered = layer();
          const c = coin(layered)!;
          const root = layered.rootOf(cm[1], c.now);
          json(res, 200, { ...c.balance(root), pending: c.pending(root), at: c.now, head: c.head });
          return;
        }
        if (path === '/coin/epochs') {
          const since = Number(u.searchParams.get('since') ?? 0);
          const c = coin()!;
          json(res, 200, { epochs: c.epochs().filter((e) => e.epoch >= since), at: c.now, head: c.head });
          return;
        }
        if (path === '/coin/redeems') {
          // The door out: the redeem lines the layer kept, each the chain line's hash the ERC-20 mints against once, under the head they stand under.
          const c = coin()!;
          const { head, upto } = headUpto(c, u.searchParams);
          json(res, 200, { head, at: c.now, redeems: c.redeems(upto) });
          return;
        }
        if (path === '/coin/credits') {
          // The way back: the credit lines the layer kept, each a deposit burned on the chain, under the head they stand under; what the mirror checks against the chain.
          const c = coin()!;
          const { head, upto } = headUpto(c, u.searchParams);
          json(res, 200, { head, at: c.now, reader: options.coin?.reader ?? null, credits: c.credits(upto) });
          return;
        }
        if (path === '/coin/state') {
          const c = coin()!;
          json(res, 200, { head: c.head, at: c.now, params: { extension: COIN, ...options.coin, home: coinHome() }, balances: Object.fromEntries(c.balances()), dropped: c.dropped });
          return;
        }
        throw new Refusal(404, 'no such route');
      }
      if (options.extra && (await options.extra(req, res, u))) return;
      throw new Refusal(404, 'no such route');
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

  return { handle, listen, reduceProblem, layer, view, coin: () => coin() };
}
