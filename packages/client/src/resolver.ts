/**
 * The resolver: given a link or a hash, fetch the envelope, its ancestors, their blobs, their receipts and the identity
 * log from the places that answer, in the link's order, then the config's, then the cache; check every hash; keep a
 * copy; reduce. Posting goes to every tracker known; an event no tracker takes waits in the queue.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Envelope, type Event, type Hash, type Receipt, type State, IDENTITY_LOG, blobProblems, envelopeProblems, eventId, hashBytes, problemHash, reduce, verifyChain } from '@bitquilt/core';
import { type Config, ensureHome } from './config.js';
import { type Link, withSlash } from './link.js';

export interface Resolved {
  hash: Hash;
  envelopes: Envelope[];
  blobs: Map<Hash, Uint8Array>;
  receipts: Receipt[];
  /** The tracker that answered first for this problem, which is where posts go first. */
  tracker: string | null;
}

export class Resolver {
  readonly home: string;
  private readonly fetchImpl: typeof fetch;

  constructor(readonly config: Config, home: string, fetchImpl: typeof fetch = fetch) {
    this.home = ensureHome(home);
    this.fetchImpl = fetchImpl;
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

  private async getJson(url: string): Promise<unknown | null> {
    try {
      const r = await this.fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      return await r.json();
    } catch {
      return null;
    }
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
      const lines = p.kind === 'mirror' ? await this.getFileLines(`${p.url}ledger/${hash}.jsonl`) : await this.getLines(`${p.url}p/${hash}/events`, p.url);
      if (lines && verifyChain(lines, genesis).ok) {
        writeFileSync(this.cachePath('ledger', hash), lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
        return lines;
      }
    }
    const cached = this.cachePath('ledger', hash);
    if (existsSync(cached)) return readFileSync(cached, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
    return [];
  }

  private async getLines(url: string, base: string): Promise<Receipt[] | null> {
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
    void base;
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
      const lines = p.kind === 'mirror' ? await this.getFileLines(`${p.url}ledger/identity.jsonl`) : await this.getLines(`${p.url}k/events`, p.url);
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

  /** Posts an event to the trackers in order until one takes it; otherwise queues it. Returns where it went. */
  async post(event: Event, problem: Hash | null, trackers: string[]): Promise<{ at: string | null; queued: boolean; error?: string }> {
    let lastError = '';
    for (const t of trackers.map(withSlash)) {
      try {
        const r = await this.fetchImpl(problem ? `${t}p/${problem}/events` : `${t}k/events`, { method: 'POST', body: JSON.stringify(event), headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (r.status === 202 || r.status === 409) return { at: t, queued: false };
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        lastError = body.error ?? `${r.status}`;
        if (r.status >= 400 && r.status < 500 && r.status !== 429) return { at: null, queued: false, error: lastError };
      } catch (err) {
        lastError = (err as Error).message;
      }
    }
    appendFileSync(join(this.home, 'queue.jsonl'), JSON.stringify({ problem, event, trackers }) + '\n');
    return { at: null, queued: true, ...(lastError ? { error: lastError } : {}) };
  }

  /** Tries the queue again; what a tracker takes leaves it. */
  async flush(): Promise<{ sent: number; left: number }> {
    const file = join(this.home, 'queue.jsonl');
    if (!existsSync(file)) return { sent: 0, left: 0 };
    const items = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { problem: Hash | null; event: Event; trackers: string[] });
    const left: typeof items = [];
    let sent = 0;
    for (const it of items) {
      let ok = false;
      for (const t of it.trackers.map(withSlash)) {
        try {
          const r = await this.fetchImpl(it.problem ? `${t}p/${it.problem}/events` : `${t}k/events`, { method: 'POST', body: JSON.stringify(it.event), headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8000) });
          if (r.status === 202 || r.status === 409 || (r.status >= 400 && r.status < 500 && r.status !== 429)) {
            ok = true;
            break;
          }
        } catch {
          /* still down */
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

  static eventId(e: Event): Hash {
    return eventId(e);
  }
}
