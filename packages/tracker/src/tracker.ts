/**
 * The reference tracker (PROTOCOL.md, The tracker): a resolver that answers a hash, accepts a signed event after
 * checking it, stamps receipts strictly increasing on each problem, keeps the chain, serves an index, and forges
 * nothing. Everything it serves is checkable from hashes and signatures; what it may do beyond serving is stamp,
 * refuse, omit and hide. Admission (the gate, rate limits, the stamp) lives here and not in the reducer.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  type Envelope, type Event, type Hash, type Receipt, type ReduceInput, type Client, type Capability,
  blobProblems, envelopeProblems, eventId, eventProblems, eventSignedByKey, expandPieces, hashBytes, isAddress, isHash,
  next, plainTextProblems, problemHash, reduce, returnProblems, returnStrings, signedBy, stampOk, textIssues, verifyChain, CAPABILITIES, IDENTITY_LOG,
} from '@bitquilt/core';
import { createHash } from 'node:crypto';
import { type Layer, type ProblemLayer, CHALLENGE_EVENTS, EXTENSION, GROUND_MAX, MAJORITY, PANEL, SEED, challengeBodyProblems, challengeLayer, verdictBodyProblems } from './challenge.js';
import { RECIPROCITY, SEEDING, offerOrder, seedBodyProblems, seedInfo, watchExclusions } from './seeding.js';
import { type PanelView, EXTENSIONS, JUDGE_SEED, RANK_EVENTS, kindOf, rankBodyProblems } from './verifiers.js';
import type { Store } from './store.js';

export const IDENTITY: Hash = IDENTITY_LOG;
const PIECE_EVENTS: ReadonlySet<string> = new Set(['claim', 'commit', 'reveal', 'decline', 'run']);
const IDENTITY_EVENTS: ReadonlySet<string> = new Set(['name', 'delegate', 'revoke', 'rotate']);
const PROBLEM_EVENTS: ReadonlySet<string> = new Set(['version', 'output', 'announce', 'seed']);
const MAX_BODY = 4 * 1024 * 1024;
const HOLD_SECONDS = 60;

export interface TrackerOptions {
  store: Store;
  /** This tracker's own address, written into every receipt. */
  url: string;
  name?: string;
  peers?: string[];
  limits?: { keyPerHour: number; ipPerHour: number };
  stamp?: { name: number };
  ipSalt?: string;
  now?: () => string;
  /** A secret only this process knows: a post carrying it in x-quilt-custody was made by the connector mounted beside the tracker, for a key it holds. */
  custodySecret?: string;
  /** Routes mounted beside the tracker, such as the hosted on-ramp. Answers true when it handled the request. */
  extra?: (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<boolean>;
}

export interface Tracker {
  handle(req: IncomingMessage, res: ServerResponse): Promise<void>;
  listen(port: number, host?: string): Promise<Server>;
  /** The core's fold of a problem this tracker holds. */
  reduceProblem(hash: Hash): ReturnType<typeof reduce> | null;
  /** The layer over every problem this tracker holds, at now: the challenge window (QX-1) and the verifier kinds (QX-2, QX-3, QX-10). */
  layer(): Layer;
  /** One problem's view in that layer. */
  view(hash: Hash): ProblemLayer | null;
}

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

export function createTracker(options: TrackerOptions): Tracker {
  const { store } = options;
  const url = options.url.endsWith('/') ? options.url : `${options.url}/`;
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

  /** The challenge layer over every problem here: standing and the pool are functions of the whole store. */
  function layer(): Layer {
    const problems: ReduceInput[] = [];
    for (const e of store.listEnvelopes()) {
      const input = inputFor(e.hash);
      if (input) problems.push(input);
    }
    return challengeLayer({ problems, now: now() });
  }

  function view(hash: Hash): ProblemLayer | null {
    return layer().problems.get(hash) ?? null;
  }

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
    };
  }

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

  async function postEvent(req: IncomingMessage, res: ServerResponse, under: Hash | null): Promise<void> {
    limit(ipBucket(req), limits.ipPerHour);
    const event = parseJson(await readBody(req)) as Event;
    const shape = eventProblems(event);
    if (shape.length) throw new Refusal(400, shape[0]!);
    if (!eventSignedByKey(event)) throw new Refusal(400, 'signature is not the key\'s');
    limit(`key:${event.key}`, limits.keyPerHour);
    const id = eventId(event);
    const type = event.type;
    let chainKey: Hash;
    if (under === null) {
      if (!IDENTITY_EVENTS.has(type)) throw new Refusal(400, 'the identity log takes name, delegate, revoke and rotate');
      if (event.problem !== undefined || event.piece !== undefined) throw new Refusal(400, 'an identity event names no problem');
      if (type === 'name' && stampNeeded > 0 && !stampOk(event, stampNeeded)) throw new Refusal(400, `a name event here carries a stamp of ${stampNeeded} bits`);
      chainKey = IDENTITY;
    } else {
      if (IDENTITY_EVENTS.has(type)) throw new Refusal(400, 'identity events go to the identity log');
      if (!PIECE_EVENTS.has(type) && !PROBLEM_EVENTS.has(type) && !CHALLENGE_EVENTS.has(type) && !RANK_EVENTS.has(type)) throw new Refusal(400, `this tracker does not carry ${type} events`);
      if (event.problem !== under) throw new Refusal(400, 'post an event under the problem it names');
      const state = reduceProblem(under);
      if (!state) throw new Refusal(404, 'no such problem here');
      if (CHALLENGE_EVENTS.has(type)) checkChallengeEvent(event, under);
      if (type === 'seed') {
        const sp = seedBodyProblems(event.body);
        if (sp.length) throw new Refusal(400, sp[0]!);
      }
      if (RANK_EVENTS.has(type)) checkRankEvent(event, under);
      if (PIECE_EVENTS.has(type)) {
        const view = event.piece ? state.byHash.get(event.piece) : undefined;
        if (!view) throw new Refusal(400, 'names a piece this problem does not have');
        if (type === 'reveal') {
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
          checkRevealKind(event, under, view.piece.verifier, hostedPost(req));
        }
        if (type === 'run' && !view.reveals.some((r) => r.digest === (event.body as { digest: Hash }).digest)) throw new Refusal(400, 'the digest is no revealed return of the piece');
      }
      if (type === 'announce') checkAnnouncement(event, state.envelope);
      chainKey = under;
    }
    if (store.hasEvent(chainKey, id)) throw new Refusal(409, 'already here');
    const hosted = hostedPost(req);
    const line = hosted ? store.appendReceipt(chainKey, event, id, url, now(), 'hosted', 'ai') : store.appendReceipt(chainKey, event, id, url, now(), 'self');
    if ((type === 'reveal' || type === 'decline') && under && event.piece) store.releaseHold(under, event.piece, event.key);
    if (type === 'version') store.putName(event.key, (event.body as { slug: string }).slug, (event.body as { hash: Hash }).hash, line.received[0]!.at);
    if (type === 'announce' && under) store.putAnnouncement(under, event.key, event, line.received[0]!.at);
    json(res, 202, { id, seq: line.seq, hash: line.hash, at: line.received[0]!.at });
  }

  /** Whether a post was made by the connector mounted beside this tracker, for a key it holds: a seat this tracker opened for a person. */
  function hostedPost(req: IncomingMessage): boolean {
    return options.custodySecret !== undefined && req.headers['x-quilt-custody'] === options.custodySecret;
  }

  /**
   * The door for the verifier kinds' reveals: a human piece takes a return only from a person's seat (QX-3), which here is
   * the connector's custody or a client declaring the model `human`; a judge piece takes no more candidates once its
   * panel sits (QX-2). The layer would count neither; the door says why.
   */
  function checkRevealKind(event: Event, under: Hash, verifier: string, hosted: boolean): void {
    const kind = kindOf(verifier)?.kind;
    if (kind === 'human') {
      const by = (event.body as { by: { model: string } }).by;
      if (by.model !== 'human' && !hosted) throw new Refusal(400, 'a human piece takes a return from a person\'s seat');
    }
    if (kind === 'judge' && event.piece && view(under)?.panels.some((p) => p.piece === event.piece)) throw new Refusal(400, 'the candidates for this piece are in');
  }

  /** The door for QX-2's rank: from a judge drawn to the piece's panel, naming every candidate once. */
  function checkRankEvent(event: Event, under: Hash): void {
    if (!event.piece) throw new Refusal(400, 'a rank names a problem and a piece');
    const shape = rankBodyProblems(event.body);
    if (shape.length) throw new Refusal(400, shape[0]!);
    const a = layer().admitRank(under, event.piece, event.key, event.body);
    if (!a.ok) throw new Refusal(400, a.why);
  }

  /** A problem's judge panels as the tracker computes them at now: the candidates by digest (their signers named once the panel has decided), the seats, each rank, the outcome. */
  function panels(pl: ProblemLayer) {
    const name = (a: string) => pl.fold.names.get(a as `0x${string}`)?.name ?? null;
    return pl.panels.map((p: PanelView) => ({
      piece: p.piece, name: p.name, verifier: pl.byHash.get(p.piece)?.kind.verifier ?? null, panel: p.panel, majority: p.majority, wanted: p.wanted, seed: p.seed, completed_at: p.completedAt,
      candidates: p.candidates.map((c) => (p.outcome === 'decided' ? { digest: c.digest, return: c.return, root: c.root, signer: name(c.root) } : { digest: c.digest, return: c.return })),
      seats: p.seats.map((s) => ({ root: s.root, judge: name(s.root), offered_at: s.offeredAt, lapsed_at: s.lapsedAt, rank: s.rank ? { id: s.rank.id, at: s.rank.at, ranking: s.rank.ranking } : null })),
      outcome: p.outcome, winner: p.winner, decided_at: p.decidedAt, dropped: p.dropped,
    }));
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

  /** A problem's challenges as the tracker computes them at now: the seats, each verdict with its judge, the outcome. */
  function challenges(pl: ProblemLayer) {
    const name = (a: string) => pl.fold.names.get(a as `0x${string}`)?.name ?? null;
    return pl.challenges.map((c) => ({
      id: c.id, piece: c.piece, name: pl.byHash.get(c.piece)?.name ?? null, key: c.key, root: c.root, challenger: name(c.root), at: c.at, stake: c.stake, ground: c.ground,
      parties: c.parties, seed: c.seed, panel: PANEL, majority: MAJORITY,
      seats: c.seats.map((s) => ({ root: s.root, judge: name(s.root), offered_at: s.offeredAt, lapsed_at: s.lapsedAt, verdict: s.verdict ? { id: s.verdict.id, at: s.verdict.at, for: s.verdict.for, return: s.verdict.return } : null })),
      outcome: c.outcome, decided_at: c.decidedAt, struck: c.struck, dropped: c.dropped,
    }));
  }

  function checkAnnouncement(event: Event, envelope: Envelope): void {
    const b = event.body as Record<string, unknown>;
    if (b.title !== envelope.problem.title || b.slug !== envelope.problem.slug || b.done_when !== envelope.problem.done_when) throw new Refusal(400, 'announce: title, slug and done_when are the envelope\'s');
    if (!Array.isArray(b.topics) || b.topics.length > 8 || !b.topics.every((t) => typeof t === 'string' && t.length <= 40 && textIssues(t).length === 0)) throw new Refusal(400, 'announce: at most eight short topics through the gate');
  }

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

  function assisted(res: ServerResponse, hash: Hash, query: URLSearchParams): void {
    const key = query.get('key');
    if (!isAddress(key)) throw new Refusal(400, 'key: an address with its checksum');
    const can = (query.get('can') ?? '').split(',').filter(Boolean);
    if (!can.every((c) => (CAPABILITIES as readonly string[]).includes(c))) throw new Refusal(400, `can: from ${CAPABILITIES.join(', ')}`);
    const model = query.get('model') ?? 'unknown/unknown';
    // The layer's fold: a struck piece is open again, a challenged one is not offered while its panel sits, a judge piece
    // not while its candidates are judged, and a human piece only to a client that declared a person.
    const pl = view(hash);
    if (!pl) throw new Refusal(404, 'no such problem here');
    const state = pl.fold;
    const at = now();
    const client: Client = { can: can as Capability[], model };
    // QX-4: a watch piece goes to the seeders first, and a seeder is handed it before anything else.
    const input = inputFor(hash)!;
    const exclude = new Set<Hash>([...store.heldByOthers(hash, key, at), ...pl.unoffered]);
    if (!can.includes('person')) for (const p of pl.pieces) if (p.kind.kind === 'human') exclude.add(p.hash);
    for (const h of watchExclusions(pl, input, key, seedInfo(input, state, at).seeders, at)) exclude.add(h);
    const pick = next(state, key, client, at, { exclude });
    if (!pick) {
      json(res, 200, { piece: null });
      return;
    }
    const kind = pl.byHash.get(pick.piece.hash)!.kind;
    store.hold(hash, pick.piece.hash, key, new Date(Date.parse(at) + HOLD_SECONDS * 1000).toISOString());
    json(res, 200, {
      piece: pick.piece.hash, name: pick.piece.name, state: pick.state, brief: pick.brief, schema: pick.schema ?? null, agree: pick.agree, requires: pick.requires, lease_h: pick.lease_h,
      verifier: pick.piece.verifier, kind: kind.kind, extension: kind.extension, strength: kind.strength, says: kind.says, weakest: kind.weakest, workspace: pick.piece.workspace ?? null, check: pick.piece.check ?? null,
    });
  }

  /** QX-5: the problems here with a piece for the key, in the order they are offered; the first is held as assisted next holds. */
  function offer(res: ServerResponse, query: URLSearchParams): void {
    const key = query.get('key');
    if (!isAddress(key)) throw new Refusal(400, 'key: an address with its checksum');
    const can = (query.get('can') ?? '').split(',').filter(Boolean);
    if (!can.every((c) => (CAPABILITIES as readonly string[]).includes(c))) throw new Refusal(400, `can: from ${CAPABILITIES.join(', ')}`);
    const model = query.get('model') ?? 'unknown/unknown';
    const at = now();
    const layered = layer();
    const inputs = new Map<Hash, ReduceInput>();
    for (const h of layered.problems.keys()) {
      const input = inputFor(h);
      if (input) inputs.set(h, input);
    }
    const count = store.nextOfferCount(key);
    const list = offerOrder(layered, inputs, key, { can: can as Capability[], model }, at, count, (h, pl, input) => {
      const exclude = store.heldByOthers(h, key, at);
      for (const x of watchExclusions(pl, input, key, seedInfo(input, pl.fold, at).seeders, at)) exclude.add(x);
      return exclude;
    });
    const first = list[0];
    if (first) store.hold(first.problem, first.pick.piece.hash, key, new Date(Date.parse(at) + HOLD_SECONDS * 1000).toISOString());
    json(res, 200, { offer: count, offers: list.map((o) => ({ problem: o.problem, title: o.title, slug: o.slug, owner: o.owner, reason: o.reason, piece: o.pick.piece.hash, name: o.pick.piece.name, state: o.pick.state, verifier: o.pick.piece.verifier, requires: o.pick.requires, lease_h: o.pick.lease_h })) });
  }

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
    for (const e of store.listEnvelopes()) {
      const topics = [...(topicsByProblem.get(e.hash) ?? [])];
      const hay = `${e.envelope.problem.title} ${e.envelope.problem.slug} ${e.envelope.problem.done_when} ${topics.join(' ')}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const s = summary(e.hash, layered);
      if (s) out.push({ ...s, topics });
    }
    return out;
  }

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
        json(res, 200, {
          quilt: 1, tracker: options.name ?? url, url, peers: options.peers ?? [], limits, stamp: { name: stampNeeded }, sortition: SEED,
          challenge: { extension: EXTENSION, panel: PANEL, majority: MAJORITY, ground_max: GROUND_MAX },
          verifiers: { human: EXTENSIONS.human, 'judge:n': EXTENSIONS.judge, attest: EXTENSIONS.attest, judge_seed: JUDGE_SEED },
          chain: 'QX-11', seeding: SEEDING, reciprocity: RECIPROCITY, identity: IDENTITY, hosted: options.extra !== undefined,
          routes: ['/p', '/p/<hash>', '/p/<hash>/events', '/p/<hash>/state', '/p/<hash>/scrape', '/p/<hash>/next', '/p/<hash>/challenges', '/p/<hash>/panels', '/k/events', '/b/<hash>', '/n/<owner>/<slug>', '/search', '/offer'],
        });
        return;
      }
      if (path === '/' && method === 'GET') {
        json(res, 200, { quilt: 1, tracker: url, problems: index(u.searchParams) });
        return;
      }
      if (path === '/offer' && method === 'GET') {
        offer(res, u.searchParams);
        return;
      }
      if (path === '/search' && method === 'GET') {
        json(res, 200, { problems: index(u.searchParams) });
        return;
      }
      if (path === '/p' && method === 'POST') {
        await publish(req, res);
        return;
      }
      if (path === '/k/events') {
        if (method === 'POST') {
          await postEvent(req, res, null);
          return;
        }
        events(res, IDENTITY, Number(u.searchParams.get('since') ?? 0));
        return;
      }
      let m: RegExpExecArray | null;
      if ((m = /^\/p\/(sha256:[0-9a-f]{64})(?:\/(events|state|scrape|next|challenges|panels))?$/.exec(path))) {
        const hash = m[1] as Hash;
        const sub = m[2];
        if (!store.getEnvelope(hash)) throw new Refusal(404, 'no such problem here');
        if (sub === 'events' && method === 'POST') {
          await postEvent(req, res, hash);
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
          // The layer's states, with the core's beside each: a core client reads `core`, one with the extensions reads `state`,
          // and the kind says how the square is earned and how strongly.
          const pl = view(hash)!;
          const s = pl.fold;
          json(res, 200, { problem: hash, now: now(), pieces: s.pieces.map((v) => {
            const l = pl.byHash.get(v.piece.hash)!;
            return {
              name: v.piece.name, hash: v.piece.hash, verifier: v.piece.verifier, state: l.state, core: l.core, challenge: l.challenge?.id ?? null,
              kind: l.kind.kind, extension: l.kind.extension, strength: l.kind.strength, says: l.kind.says, weakest: l.kind.weakest, attested: l.attested, panel: l.panel?.outcome ?? null,
              availability: v.availability, dependents: v.dependents, reveals: v.reveals.length, claims: v.claims.length,
            };
          }), complete: s.complete, output: s.output?.hash ?? null, dropped: [...s.dropped, ...pl.dropped] });
          return;
        }
        if (sub === 'challenges') {
          json(res, 200, { problem: hash, now: now(), challenges: challenges(view(hash)!) });
          return;
        }
        if (sub === 'panels') {
          json(res, 200, { problem: hash, now: now(), panels: panels(view(hash)!) });
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
      }
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

  return { handle, listen, reduceProblem, layer, view };
}
