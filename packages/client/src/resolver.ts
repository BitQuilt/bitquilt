/**
 * The resolver: given a link or a hash, fetch the envelope, its ancestors, their blobs, their receipts and the identity
 * log from the places that answer, in the link's order, then the config's, then the cache; check every hash; keep a
 * copy; reduce. Posting goes to every tracker known; an event no tracker takes waits in the queue. This is the
 * client's side of PROTOCOL.md's resolvers: it asks them and keeps what they answer; the node in page.ts is the part
 * of Quilt that is a resolver.
 */
import { appendFileSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Envelope, type Event, type Hash, type Receipt, type State, IDENTITY_LOG, blobProblems, envelopeProblems, hashBytes, problemHash, reduce, verifyChain, withSlash } from '@bitquilt/core';
import { type Config, ensureHome } from './config.js';
import type { Link } from './link.js';

/**
 * Fetches JSON with a timeout: null where the place does not answer in time, answers with an error, or answers with
 * something that is not JSON. Eight seconds is the wait for every read of a tracker, the time a slow one takes to
 * answer for a problem with a thousand pieces; the small reads (a key's standing, a well-known document, a scrape)
 * wait the same, since the wait is for the tracker and not for the answer's size. The receipts pages and a publish
 * carry a whole log or a whole envelope with its blobs, and get fifteen.
 */
export async function askJson<T>(url: string, ms = 8000, fetchImpl: typeof fetch = fetch): Promise<T | null> {
  try {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(ms) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

/** Where a post went: the tracker that took it, or none and the event queued, with the last error heard where there was one. */
export type Posted = { at: string | null; queued: boolean; error?: string };

/** One tracker's answer to one event: taken (202, or 409 since it has it already), refused (any other 4xx but 429, with the tracker's reason), or down (no answer, a 5xx or a 429, so the next tracker is tried and the event queued when none takes it). */
type Offer = { status: 'taken' } | { status: 'refused' | 'down'; error: string };

export interface Resolved {
  hash: Hash;
  envelopes: Envelope[];
  blobs: Map<Hash, Uint8Array>;
  receipts: Receipt[];
  /** The tracker that answered first for this problem, which is where posts go first. */
  tracker: string | null;
}

/**
 * What a home has touched: the problems opened, the pieces claimed and returned, and the standing list (QX-4). Written
 * by Quilt after each act it records (opening, claiming, returning, seeding, committing gold) and never by the resolver
 * on its own; `pieces` is this key's own claims and returns.
 */
export interface Library {
  problems: Record<string, { title: string; slug: string; trackers: string[]; first: string; last: string }>;
  pieces: Record<string, { problem: Hash; name: string; when: string; what: 'claimed' | 'returned'; verifier?: string }>;
  /** The standing list (QX-4): the problems this key seeds, by the time it said so. */
  seeding: Record<string, string>;
  /** The owner's gold (QX-16), by problem then piece: the projection and nonce behind each commitment, which never leave the home, and when it was revealed. */
  gold?: Record<string, Record<string, { name: string; projection: Record<string, unknown>; nonce: string; revealed?: string }>>;
  /** The AI that connected through the connector: its host's name, the first time and the latest. Its presence is what moves the menu bar from install instructions to the phrases (phrases.ts). */
  connector?: { host: string | null; first: string; last: string };
}

const EMPTY_LIBRARY = (): Library => ({ problems: {}, pieces: {}, seeding: {} });

export class Resolver {
  readonly home: string;
  private readonly fetchImpl: typeof fetch;

  private readonly postHeaders: Record<string, string>;
  private readonly libraryFile: string;
  private held: Library | null = null;
  /** The file's size and time when it was last read or written, so another process's write is seen before this one's next. */
  private stamp = '';

  constructor(readonly config: Config, home: string, fetchImpl: typeof fetch = fetch, postHeaders: Record<string, string> = {}) {
    this.home = ensureHome(home);
    this.fetchImpl = fetchImpl;
    this.postHeaders = postHeaders;
    this.libraryFile = join(this.home, 'library.json');
  }

  private fileStamp(): string {
    try {
      const s = statSync(this.libraryFile);
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return '';
    }
  }

  /**
   * The home's library, one for every Quilt over this resolver. It is read from disk when first asked for and again
   * whenever the file has changed since, so a second copy of quilt on the same home (a one-shot command, say) is seen
   * rather than written over.
   */
  get library(): Library {
    const now = this.fileStamp();
    if (this.held === null || now !== this.stamp) {
      this.held = now === '' ? EMPTY_LIBRARY() : (JSON.parse(readFileSync(this.libraryFile, 'utf8')) as Library);
      if (!this.held.seeding) this.held.seeding = {};
      this.stamp = now;
    }
    return this.held;
  }

  /** Records that an AI connected through the connector, under the host's name, and saves: the first time is kept, the latest moves. */
  sawConnector(host: string | null, now = new Date().toISOString()): void {
    const was = this.library.connector;
    this.library.connector = { host: host ?? was?.host ?? null, first: was?.first ?? now, last: now };
    this.saveLibrary();
  }

  /** Whether the key's twelve words, kept at first use, are still waiting to be written down: what the sheet calls a backup due. */
  wordsDue(): boolean {
    return existsSync(join(this.home, 'words'));
  }

  /** The twelve words, once: read and removed, so they are shown one time; null when none wait. */
  takeWords(): string | null {
    const file = join(this.home, 'words');
    if (!existsSync(file)) return null;
    const words = readFileSync(file, 'utf8').trim();
    unlinkSync(file);
    return words;
  }

  saveLibrary(): void {
    writeFileSync(this.libraryFile, JSON.stringify(this.library, null, 2) + '\n');
    this.stamp = this.fileStamp();
  }

  /** The places to ask, in order: the link's trackers, the config's, then mirrors. */
  places(link: Link): { url: string; kind: 'tracker' | 'mirror' }[] {
    const out: { url: string; kind: 'tracker' | 'mirror' }[] = [];
    const seen = new Set<string>();
    const add = (url: string, kind: 'tracker' | 'mirror') => {
      const u = withSlash(url);
      if (!seen.has(u)) {
        seen.add(u);
        out.push({ url: u, kind });
      }
    };
    for (const t of link.trackers) add(t, 'tracker');
    for (const t of this.config.trackers) add(t, 'tracker');
    for (const m of link.mirrors) add(m, 'mirror');
    for (const m of this.config.mirrors) add(m, 'mirror');
    return out;
  }

  private getJson(url: string): Promise<unknown | null> {
    return askJson<unknown>(url, 8000, this.fetchImpl);
  }

  private async getText(url: string): Promise<string | null> {
    try {
      const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      return await r.text();
    } catch {
      return null;
    }
  }

  private async getBytes(url: string): Promise<Uint8Array | null> {
    try {
      const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      return new Uint8Array(await r.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** The hash a mutable name points at, from the first place that knows it. */
  async resolveName(owner: string, slug: string, link: Link): Promise<Hash | null> {
    for (const p of this.places(link)) {
      if (p.kind === 'mirror') {
        const text = (await this.getText(`${p.url}names/${owner}/${slug}`))?.trim();
        if (text && /^sha256:[0-9a-f]{64}$/.test(text)) return text as Hash;
        continue;
      }
      const j = (await this.getJson(`${p.url}n/${owner}/${slug}`)) as { hash?: Hash } | null;
      if (j?.hash) return j.hash;
    }
    return null;
  }

  cachePath(kind: 'envelope' | 'blob' | 'ledger', hash: string): string {
    return kind === 'envelope' ? join(this.home, 'cache', `${hash}.json`) : kind === 'blob' ? join(this.home, 'cache', 'blobs', hash) : join(this.home, 'cache', 'ledger', `${hash}.jsonl`);
  }

  async envelope(hash: Hash, link: Link): Promise<{ envelope: Envelope; from: string | null } | null> {
    for (const p of this.places(link)) {
      const j = await this.getJson(p.kind === 'mirror' ? `${p.url}problems/${hash}.json` : `${p.url}p/${hash}`);
      if (j && envelopeProblems(j).length === 0 && problemHash(j as Envelope) === hash) {
        writeFileSync(this.cachePath('envelope', hash), JSON.stringify(j));
        return { envelope: j as Envelope, from: p.kind === 'tracker' ? p.url : null };
      }
    }
    const cached = this.cachePath('envelope', hash);
    if (existsSync(cached)) {
      const j = JSON.parse(readFileSync(cached, 'utf8')) as Envelope;
      if (problemHash(j) === hash) return { envelope: j, from: null };
    }
    return null;
  }

  async blob(hash: Hash, link: Link): Promise<Uint8Array | null> {
    const cached = this.cachePath('blob', hash);
    if (existsSync(cached)) {
      const b = new Uint8Array(readFileSync(cached));
      if (hashBytes(b) === hash) return b;
    }
    for (const p of this.places(link)) {
      const b = await this.getBytes(p.kind === 'mirror' ? `${p.url}blobs/${hash}` : `${p.url}b/${hash}`);
      if (b && hashBytes(b) === hash) {
        writeFileSync(cached, b);
        return b;
      }
    }
    return null;
  }

  /** A problem's chained receipts from the first place that serves a chain that verifies, else the cache. */
  async receipts(hash: Hash, link: Link, genesis: Hash = hash): Promise<Receipt[]> {
    for (const p of this.places(link)) {
      const lines = p.kind === 'mirror' ? await this.getFileLines(`${p.url}ledger/${hash}.jsonl`) : await this.getLines(`${p.url}p/${hash}/events`);
      if (lines && verifyChain(lines, genesis).ok) {
        writeFileSync(this.cachePath('ledger', hash), lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
        return lines;
      }
    }
    const cached = this.cachePath('ledger', hash);
    if (existsSync(cached)) return readFileSync(cached, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
    return [];
  }

  /** A tracker's receipts for a log, page by page as the x-quilt-next-since header leads; null where it does not answer. */
  private async getLines(url: string): Promise<Receipt[] | null> {
    const out: Receipt[] = [];
    let since = 0;
    for (let page = 0; page < 1000; page++) {
      let r: Response;
      try {
        r = await this.fetchImpl(`${url}?since=${since}`, { signal: AbortSignal.timeout(15000) });
      } catch {
        return null;
      }
      if (!r.ok) return null;
      const text = await r.text();
      const lines = text.split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
      out.push(...lines);
      const next = r.headers.get('x-quilt-next-since');
      if (!next) break;
      since = Number(next);
    }
    return out;
  }

  /** A mirror's ledger file, whole. An absent file is an empty log, not a failure. */
  private async getFileLines(url: string): Promise<Receipt[] | null> {
    try {
      const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (r.status === 404) return [];
      if (!r.ok) return null;
      return (await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
    } catch {
      return null;
    }
  }

  async identity(link: Link): Promise<Receipt[]> {
    for (const p of this.places(link)) {
      const lines = p.kind === 'mirror' ? await this.getFileLines(`${p.url}ledger/identity.jsonl`) : await this.getLines(`${p.url}k/events`);
      if (lines && verifyChain(lines, IDENTITY_LOG).ok) {
        writeFileSync(join(this.home, 'cache', 'identity.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
        return lines;
      }
    }
    const cached = join(this.home, 'cache', 'identity.jsonl');
    if (existsSync(cached)) return readFileSync(cached, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
    return [];
  }

  /** Everything the reducer needs for a problem, from the places that answer, checked, and kept. */
  async resolve(link: Link): Promise<Resolved | null> {
    let hash = link.hash ?? null;
    if (!hash && link.owner && link.slug) hash = await this.resolveName(link.owner, link.slug, link);
    if (!hash) return null;
    const envelopes: Envelope[] = [];
    const blobs = new Map<Hash, Uint8Array>();
    const receipts: Receipt[] = [];
    let tracker: string | null = null;
    const seen = new Set<string>();
    let cur: Hash | null = hash;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const got = await this.envelope(cur, link);
      if (!got) break;
      if (tracker === null && got.from) tracker = got.from;
      envelopes.push(got.envelope);
      for (const h of Object.values(got.envelope.problem.data)) if (!blobs.has(h)) {
        const b = await this.blob(h, link);
        if (b) blobs.set(h, b);
      }
      receipts.push(...(await this.receipts(cur, link)));
      cur = got.envelope.problem.prev;
    }
    if (envelopes.length === 0) return null;
    receipts.push(...(await this.identity(link)));
    const bp = blobProblems(envelopes[0]!.problem, blobs);
    if (bp.length) throw new Error(bp[0]);
    return { hash, envelopes, blobs, receipts, tracker };
  }

  state(resolved: Resolved, now = new Date().toISOString()): State {
    return reduce({ envelopes: resolved.envelopes, blobs: resolved.blobs, receipts: resolved.receipts, now });
  }

  /** Where an event goes on a tracker: a problem's log, the identity log, or the coin log (QX-17). */
  private logUrl(t: string, problem: Hash | null | 'coin'): string {
    return problem === 'coin' ? `${t}coin/events` : problem ? `${t}p/${problem}/events` : `${t}k/events`;
  }

  /** One event offered to one tracker's log, and what the tracker said of it (see `Offer`). */
  private async offer(t: string, log: Hash | null | 'coin', event: Event): Promise<Offer> {
    let r: Response;
    try {
      r = await this.fetchImpl(this.logUrl(t, log), { method: 'POST', body: JSON.stringify(event), headers: { 'content-type': 'application/json', ...this.postHeaders }, signal: AbortSignal.timeout(8000) });
    } catch (err) {
      return { status: 'down', error: (err as Error).message };
    }
    if (r.status === 202 || r.status === 409) return { status: 'taken' };
    const error = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `${r.status}`;
    return { status: r.status >= 400 && r.status < 500 && r.status !== 429 ? 'refused' : 'down', error };
  }

  /** Posts an event to the trackers in order until one takes it or one refuses it; none answering, queues it. Returns where it went. */
  async post(event: Event, problem: Hash | null | 'coin', trackers: string[]): Promise<Posted> {
    let lastError = '';
    for (const t of trackers.map(withSlash)) {
      const o = await this.offer(t, problem, event);
      if (o.status === 'taken') return { at: t, queued: false };
      if (o.status === 'refused') return { at: null, queued: false, error: o.error };
      lastError = o.error;
    }
    appendFileSync(join(this.home, 'queue.jsonl'), JSON.stringify({ problem, event, trackers }) + '\n');
    return { at: null, queued: true, ...(lastError ? { error: lastError } : {}) };
  }

  /** Tries the queue again; what a tracker takes, or refuses, leaves it. */
  async flush(): Promise<{ sent: number; left: number }> {
    const file = join(this.home, 'queue.jsonl');
    if (!existsSync(file)) return { sent: 0, left: 0 };
    const items = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { problem: Hash | null | 'coin'; event: Event; trackers: string[] });
    const left: typeof items = [];
    let sent = 0;
    for (const it of items) {
      let ok = false;
      for (const t of it.trackers.map(withSlash)) {
        if ((await this.offer(t, it.problem, it.event)).status !== 'down') {
          ok = true;
          break;
        }
      }
      if (ok) sent++;
      else left.push(it);
    }
    writeFileSync(file, left.map((l) => JSON.stringify(l)).join('\n') + (left.length ? '\n' : ''));
    return { sent, left: left.length };
  }

  queued(): number {
    const file = join(this.home, 'queue.jsonl');
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
  }

  /** What this node has in its cache, to serve to others. */
  cachedEnvelope(hash: Hash): Envelope | null {
    const f = this.cachePath('envelope', hash);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Envelope) : null;
  }

  cachedReceipts(hash: Hash): Receipt[] {
    const f = this.cachePath('ledger', hash);
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt) : [];
  }

  cachedBlob(hash: Hash): Uint8Array | null {
    const f = this.cachePath('blob', hash);
    return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
  }
}
