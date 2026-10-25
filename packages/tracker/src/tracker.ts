/**
 * The reference tracker (PROTOCOL.md, The tracker): a resolver that answers a hash, accepts a signed event after
 * checking it, stamps receipts strictly increasing on each problem, keeps the chain, serves an index, and forges
 * nothing. Everything it serves is checkable from hashes and signatures; what it may do beyond serving is stamp,
 * refuse, omit and hide. Admission (the gate, rate limits, the stamp) lives here and not in the reducer.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  type Envelope, type Event, type Hash, type Receipt, type Client, type Capability,
  blobProblems, envelopeProblems, eventId, eventProblems, eventSignedByKey, expandPieces, hashBytes, isAddress, isHash,
  next, plainTextProblems, problemHash, reduce, returnProblems, returnStrings, signedBy, stampOk, textIssues, verifyChain, CAPABILITIES, IDENTITY_LOG,
} from '@bitquilt/core';
import { createHash } from 'node:crypto';
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
  reduceProblem(hash: Hash): ReturnType<typeof reduce> | null;
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

  function reduceProblem(hash: Hash) {
    const chain = store.chain(hash);
    if (chain.length === 0) return null;
    const hashes = chain.map(problemHash);
    const receipts: Receipt[] = [];
    for (const h of hashes) receipts.push(...store.receipts(h));
    receipts.push(...store.receipts(IDENTITY));
    return reduce({ envelopes: chain, blobs: store.blobsFor(chain), receipts, now: now() });
  }

  function summary(hash: Hash) {
    const s = reduceProblem(hash);
    if (!s) return null;
    const counts: Record<string, number> = {};
    for (const v of s.pieces) counts[v.state] = (counts[v.state] ?? 0) + 1;
    const head = store.head(hash);
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
      if (!PIECE_EVENTS.has(type) && !PROBLEM_EVENTS.has(type)) throw new Refusal(400, `this tracker does not carry ${type} events`);
      if (event.problem !== under) throw new Refusal(400, 'post an event under the problem it names');
      const state = reduceProblem(under);
      if (!state) throw new Refusal(404, 'no such problem here');
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
        }
        if (type === 'run' && !view.reveals.some((r) => r.digest === (event.body as { digest: Hash }).digest)) throw new Refusal(400, 'the digest is no revealed return of the piece');
      }
      if (type === 'announce') checkAnnouncement(event, state.envelope);
      chainKey = under;
    }
    if (store.hasEvent(chainKey, id)) throw new Refusal(409, 'already here');
    const hosted = options.custodySecret !== undefined && req.headers['x-quilt-custody'] === options.custodySecret;
    const line = hosted ? store.appendReceipt(chainKey, event, id, url, now(), 'hosted', 'ai') : store.appendReceipt(chainKey, event, id, url, now(), 'self');
    if (type === 'version') store.putName(event.key, (event.body as { slug: string }).slug, (event.body as { hash: Hash }).hash, line.received[0]!.at);
    if (type === 'announce' && under) store.putAnnouncement(under, event.key, event, line.received[0]!.at);
    json(res, 202, { id, seq: line.seq, hash: line.hash, at: line.received[0]!.at });
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
    const state = reduceProblem(hash);
    if (!state) throw new Refusal(404, 'no such problem here');
    const at = now();
    const client: Client = { can: can as Capability[], model };
    const pick = next(state, key, client, at, { exclude: store.heldByOthers(hash, key, at) });
    if (!pick) {
      json(res, 200, { piece: null });
      return;
    }
    store.hold(hash, pick.piece.hash, key, new Date(Date.parse(at) + HOLD_SECONDS * 1000).toISOString());
    json(res, 200, { piece: pick.piece.hash, name: pick.piece.name, state: pick.state, brief: pick.brief, schema: pick.schema ?? null, agree: pick.agree, requires: pick.requires, lease_h: pick.lease_h, verifier: pick.piece.verifier, workspace: pick.piece.workspace ?? null, check: pick.piece.check ?? null });
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
    for (const e of store.listEnvelopes()) {
      const topics = [...(topicsByProblem.get(e.hash) ?? [])];
      const hay = `${e.envelope.problem.title} ${e.envelope.problem.slug} ${e.envelope.problem.done_when} ${topics.join(' ')}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const s = summary(e.hash);
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
        json(res, 200, { quilt: 1, tracker: options.name ?? url, url, peers: options.peers ?? [], limits, stamp: { name: stampNeeded }, sortition: 'receipts', chain: 'QX-11', identity: IDENTITY, hosted: options.extra !== undefined, routes: ['/p', '/p/<hash>', '/p/<hash>/events', '/p/<hash>/state', '/p/<hash>/scrape', '/p/<hash>/next', '/k/events', '/b/<hash>', '/n/<owner>/<slug>', '/search'] });
        return;
      }
      if (path === '/' && method === 'GET') {
        json(res, 200, { quilt: 1, tracker: url, problems: index(u.searchParams) });
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
      if ((m = /^\/p\/(sha256:[0-9a-f]{64})(?:\/(events|state|scrape|next))?$/.exec(path))) {
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
          const s = reduceProblem(hash)!;
          json(res, 200, { problem: hash, now: now(), pieces: s.pieces.map((v) => ({ name: v.piece.name, hash: v.piece.hash, verifier: v.piece.verifier, state: v.state, availability: v.availability, dependents: v.dependents, reveals: v.reveals.length, claims: v.claims.length })), complete: s.complete, output: s.output?.hash ?? null, dropped: s.dropped });
          return;
        }
        if (sub === 'scrape') {
          const lines = store.receipts(hash);
          const chain = verifyChain(lines, hash);
          json(res, 200, { ...summary(hash), chain_ok: chain.ok, seeders: 0 });
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

  return { handle, listen, reduceProblem };
}
