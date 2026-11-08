/**
 * The resolver: given a link or a hash, fetch the envelope, its ancestors, their blobs, their receipts and the identity
 * log from the places that answer, in the link's order, then the config's, then the cache; check every hash; keep a
 * copy; reduce. Posting tries the trackers in order and stops at the first that takes the event or refuses it; an
 * event no tracker answers waits in the queue. This is the client's side of PROTOCOL.md's resolvers: it asks them and
 * keeps what they answer; the node in page.ts is the part of Quilt that is a resolver.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Envelope,
  type Event,
  type Hash,
  type Receipt,
  type State,
  IDENTITY_LOG,
  blobProblems,
  envelopeProblems,
  eventId,
  hashBytes,
  isHash,
  isRecord,
  onlyAppends,
  problemHash,
  reduce,
  signedBy,
  verifyChain,
  withSlash,
} from '@bitquilt/core';
import { findOnRelays } from './relay.js';
import { type Config, ensureHome } from './config.js';
import { type Chains, FileChains, type Held } from './chains.js';
import { type Library, LibraryFile } from './library.js';
import type { Link } from './link.js';

export type { Held } from './chains.js';

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

/**
 * Where a post went: the tracker that took it, or none and the event queued, with the last error heard where there was
 * one.
 */
export type Posted = { at: string | null; queued: boolean; error?: string };

/**
 * One tracker's answer to one event: taken (202, or 409 since it has it already), refused (any other 4xx but 429, with
 * the tracker's reason), or down (no answer, a 5xx or a 429, so the next tracker is tried and the event queued when
 * none takes it).
 */
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
 * What the keeper's loop did (NODE.md section 4): the problems held, the lines added to their chains and the identity
 * log, the reads fetched, the events sent from the queue, and the chains refused for not only growing.
 */
export interface KeepReport {
  problems: number;
  added: number;
  reads: number;
  sent: number;
  refused: string[];
}

/** How often a node that serves its page keeps: every half hour, the first two minutes after start. */
export const KEEP_EVERY_MS = 30 * 60_000;

/**
 * Headers a post carries to one tracker alone: the hosted on-ramp's custody secret and its witness (QX-18) go to its
 * own door, and a post to any other tracker, one a link named included, carries neither.
 */
export interface PostHeaders {
  to: string;
  headers: Record<string, string>;
}

export class Resolver {
  readonly home: string;
  /**
   * How this resolver reaches the network, and every request of the Quilt over it: the guarded fetch where the
   * connector is shared.
   */
  readonly fetchImpl: typeof fetch;

  private readonly postHeaders: PostHeaders | null;
  /** The home's library (library.ts). */
  private readonly homeLibrary: LibraryFile;

  /**
   * The store this node keeps in and serves from (NODE.md section 2): the home's cache folder unless a store is given,
   * as a node with a door gives the door's.
   */
  readonly chains: Chains;

  constructor(
    readonly config: Config,
    home: string,
    fetchImpl: typeof fetch = fetch,
    postHeaders: PostHeaders | null = null,
    chains?: Chains,
  ) {
    this.home = ensureHome(home);
    this.fetchImpl = fetchImpl;
    this.postHeaders = postHeaders;
    this.homeLibrary = new LibraryFile(this.home);
    this.chains = chains ?? new FileChains(this.home);
  }

  /**
   * The home's library, one for every Quilt over this resolver: read again whenever its file has changed (library.ts).
   */
  get library(): Library {
    return this.homeLibrary.library;
  }

  /** Records that an AI connected through the connector, and saves (library.ts, `sawConnector`). */
  sawConnector(host: string | null, now?: string): void {
    this.homeLibrary.sawConnector(host, now);
  }

  saveLibrary(): void {
    this.homeLibrary.saveLibrary();
  }

  /**
   * What this node holds and serves by hash (`/p/<hash>`, `/p/<hash>/events`, `/b/<hash>`): a count of each and the
   * bytes.
   */
  serving(): Held {
    return this.chains.held();
  }

  /**
   * QX-14 section 3: the places the relays' announcements named for a hash, learned when no place this resolver knew
   * answered for it, and kept for the rest of the session; an empty entry says the relays were asked and knew nothing.
   */
  private readonly hinted = new Map<Hash, { trackers: string[]; mirrors: string[] }>();

  /**
   * The places to ask, in order: the link's trackers, the config's, the ones the relays named for this hash and then
   * for any, then mirrors the same way.
   */
  places(link: Link, hash: Hash | null = link.hash ?? null): { url: string; kind: 'tracker' | 'mirror' }[] {
    const out: { url: string; kind: 'tracker' | 'mirror' }[] = [];
    const seen = new Set<string>();
    const add = (url: string, kind: 'tracker' | 'mirror') => {
      const u = withSlash(url);
      if (!seen.has(u)) {
        seen.add(u);
        out.push({ url: u, kind });
      }
    };
    const own = hash ? this.hinted.get(hash) : undefined;
    const others = [...this.hinted.values()].filter((h) => h !== own);
    for (const t of link.trackers) add(t, 'tracker');
    for (const t of this.config.trackers) add(t, 'tracker');
    for (const t of own?.trackers ?? []) add(t, 'tracker');
    for (const h of others) for (const t of h.trackers) add(t, 'tracker');
    for (const m of link.mirrors) add(m, 'mirror');
    for (const m of this.config.mirrors) add(m, 'mirror');
    for (const m of own?.mirrors ?? []) add(m, 'mirror');
    for (const h of others) for (const m of h.mirrors) add(m, 'mirror');
    return out;
  }

  /**
   * QX-14 section 3: asked once per hash when no place this resolver knows answers for it and the cache has nothing,
   * the relays are asked for the problem's announcements by its hash, and the trackers and mirrors they name are kept
   * as places. True when any was learned. With no relay configured there is nothing to ask.
   */
  private async learnFromRelays(hash: Hash): Promise<boolean> {
    if (this.hinted.has(hash) || this.config.relays.length === 0) return false;
    const found = await findOnRelays(this.config.relays, hash);
    const trackers = [...new Set(found.flatMap((a) => a.trackers))];
    const mirrors = [...new Set(found.flatMap((a) => a.mirrors))];
    this.hinted.set(hash, { trackers, mirrors });
    return trackers.length + mirrors.length > 0;
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

  async envelope(hash: Hash, link: Link): Promise<{ envelope: Envelope; from: string | null } | null> {
    const asked = async (): Promise<{ envelope: Envelope; from: string | null } | null> => {
      for (const p of this.places(link, hash)) {
        const j = await this.getJson(p.kind === 'mirror' ? `${p.url}problems/${hash}.json` : `${p.url}p/${hash}`);
        if (j && envelopeProblems(j).length === 0 && problemHash(j as Envelope) === hash) {
          await this.keepEnvelope(hash, j as Envelope, link);
          return { envelope: j as Envelope, from: p.kind === 'tracker' ? p.url : null };
        }
      }
      return null;
    };
    const got = await asked();
    if (got) return got;
    const cached = this.chains.envelopeOf(hash);
    if (cached && problemHash(cached) === hash) return { envelope: cached, from: null };
    // QX-14 section 3: no place known and nothing kept; the relays may say where the problem is held, and then those
    // places are asked.
    if (await this.learnFromRelays(hash)) return asked();
    return null;
  }

  /**
   * An envelope kept once the core would fold it, as CORE.md section 6 checks one: "Each is checked against its hash and
   * its owner's signature; each blob against its hash." Its hash is checked where it is read; here its signature, and
   * each data blob it names fetched and kept first, so the store never holds a problem without its data. A node with
   * `work` beside `admit` keeps in the door's store, whose layer folds every problem there (NODE.md section 2).
   */
  private async keepEnvelope(hash: Hash, envelope: Envelope, link: Link): Promise<void> {
    if (this.chains.envelopeOf(hash)) return;
    if (!signedBy(envelope as unknown as Record<string, unknown>, envelope.problem.owner)) return;
    for (const h of Object.values(envelope.problem.data)) if (!(await this.blob(h, link))) return;
    this.chains.putEnvelope(hash, envelope, new Date().toISOString());
  }

  async blob(hash: Hash, link: Link): Promise<Uint8Array | null> {
    const cached = this.chains.getBlob(hash);
    if (cached && hashBytes(cached) === hash) return cached;
    for (const p of this.places(link, link.hash ?? null)) {
      const b = await this.getBytes(p.kind === 'mirror' ? `${p.url}blobs/${hash}` : `${p.url}b/${hash}`);
      if (b && hashBytes(b) === hash) {
        this.chains.putBlob(hash, b);
        return b;
      }
    }
    return null;
  }

  /**
   * A problem's chained receipts, else the cache. Read (`open`): the first place's chain that verifies, kept where it
   * only grew the one kept. Grow (`keep`): the first place's chain that verifies and grows the one kept, and where none
   * does, the first that verifies, read and not kept; so a node that opened a problem from a second place goes on
   * keeping the chain of the first.
   */
  async receipts(
    hash: Hash,
    link: Link,
    genesis: Hash = hash,
    note?: (line: string) => void,
    mode: 'read' | 'grow' = 'read',
  ): Promise<Receipt[]> {
    let read: Receipt[] | null = null;
    for (const p of this.places(link, hash)) {
      const lines =
        p.kind === 'mirror'
          ? await this.getFileLines(`${p.url}ledger/${hash}.jsonl`)
          : await this.getLines(`${p.url}p/${hash}/events`);
      if (!lines || !verifyChain(lines, genesis).ok) continue;
      const added = this.keepLines(hash, lines, `${hash}: chain from ${p.url}`, note);
      if (added >= 0 || mode === 'read') return lines;
      read ??= lines;
    }
    if (read) return read;
    return this.chains.lines(hash);
  }

  /**
   * A chain is kept where it is a growth of the one kept, as the mirror keeps one (PROTOCOL.md, The mirror): this node
   * follows one place's chain per log, and another place's chain for the same log, which has the same events in its
   * own order, is read for the state it gives and not kept. The lines added, or -1 where the chain was not kept.
   */
  private keepLines(log: Hash, lines: Receipt[], label: string, note?: (line: string) => void): number {
    const held = this.chains.lines(log);
    const growth = onlyAppends(held, lines);
    if (!growth.ok) {
      note?.(`${label} did not only grow: ${growth.problem}`);
      return -1;
    }
    if (growth.added > 0 || held.length === 0) this.chains.appendLines(log, lines.slice(held.length));
    return growth.added;
  }

  /**
   * The keeper's loop over this node's cache (NODE.md section 4): every problem held is pulled again from the places
   * known for it, its chain kept where it only grew, the reads its traces name fetched under their hashes (QX-19), and
   * the identity log the same; so what a person's node touched stays whole and current, and what it serves at
   * `/held`, `/p/<hash>/events` and `/b/<hash>` is worth pulling. It begins by sending the queue, the events written
   * while no tracker answered (APP.md, the node). The page runs it every half hour and the owner's turn once an hour;
   * `quilt keep` runs it once.
   */
  async keep(): Promise<KeepReport> {
    // APP.md, the node: an event written while no tracker answered waits in the queue and goes out when one does. This
    // loop is when, since it runs wherever a node is up; the queue goes first, so what the home wrote is out before it
    // pulls.
    const { sent } = await this.flush();
    const out: KeepReport = { problems: 0, added: 0, reads: 0, sent, refused: [] };
    const note = (line: string) => out.refused.push(line);
    const everywhere = new Set<string>();
    for (const held of this.heldProblems()) {
      const hash = held.problem;
      const trackers = this.library.problems[hash]?.trackers ?? [];
      for (const t of trackers) everywhere.add(t);
      const link: Link = { hash, trackers, mirrors: [] };
      out.problems += 1;
      const before = this.cachedReceipts(hash).length;
      const lines = await this.receipts(hash, link, hash, note, 'grow');
      out.added += Math.max(0, this.cachedReceipts(hash).length - before);
      out.reads += await this.fetchReads(lines, link);
    }
    const before = this.cachedIdentity().length;
    await this.identity({ trackers: [...everywhere], mirrors: [] }, note, 'grow');
    out.added += Math.max(0, this.cachedIdentity().length - before);
    return out;
  }

  /**
   * QX-19: the reads the traces on a chain name, each fetched from the places and kept under its hash where it is not
   * here yet; how many were fetched. As NODE.md section 4, step 3, says: "A read a trace names by anything but a hash,
   * and reads that are not a list, are not fetched." A chain that verifies may hold a trace with any body, since a core
   * client ignores the event (EXTENSIONS.md, What an extension may do), so no body stops the loop.
   */
  private async fetchReads(lines: Receipt[], link: Link): Promise<number> {
    let fetched = 0;
    for (const l of lines) {
      if (l.event.type !== 'trace') continue;
      const reads = (l.event.body as { reads?: unknown }).reads;
      if (!Array.isArray(reads)) continue;
      for (const r of reads) {
        if (!isRecord(r) || !isHash(r.hash) || this.chains.getBlob(r.hash)) continue;
        if (await this.blob(r.hash, link)) fetched += 1;
      }
    }
    return fetched;
  }

  /**
   * A tracker's receipts for a log, page by page as the x-quilt-next-since header leads; null where it does not answer.
   */
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
      const lines = text
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Receipt);
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
      return (await r.text())
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Receipt);
    } catch {
      return null;
    }
  }

  /** The identity log, as `receipts` reads or grows a chain. */
  async identity(link: Link, note?: (line: string) => void, mode: 'read' | 'grow' = 'read'): Promise<Receipt[]> {
    let read: Receipt[] | null = null;
    for (const p of this.places(link)) {
      const lines =
        p.kind === 'mirror'
          ? await this.getFileLines(`${p.url}ledger/identity.jsonl`)
          : await this.getLines(`${p.url}k/events`);
      if (!lines || !verifyChain(lines, IDENTITY_LOG).ok) continue;
      const added = this.keepLines(IDENTITY_LOG, lines, `identity: log from ${p.url}`, note);
      if (added >= 0 || mode === 'read') return lines;
      read ??= lines;
    }
    if (read) return read;
    return this.chains.lines(IDENTITY_LOG);
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
      for (const h of Object.values(got.envelope.problem.data))
        if (!blobs.has(h)) {
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
    const own = this.postHeaders && withSlash(this.postHeaders.to) === t ? this.postHeaders.headers : {};
    let r: Response;
    try {
      r = await this.fetchImpl(this.logUrl(t, log), {
        method: 'POST',
        body: JSON.stringify(event),
        headers: { 'content-type': 'application/json', ...own },
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      return { status: 'down', error: (err as Error).message };
    }
    if (r.status === 202 || r.status === 409) return { status: 'taken' };
    const error = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `${r.status}`;
    return { status: r.status >= 400 && r.status < 500 && r.status !== 429 ? 'refused' : 'down', error };
  }

  /**
   * Posts an event to the trackers in order until one takes it or one refuses it; none answering, queues it. Returns
   * where it went. A refusal after a tracker was down may be a door's answer to a repeat of what it took, and "a worker
   * that lost the answer to its post looks for its event in the problem's log"
   * (CLIENT.md, What the door checks, in order): the trackers offered it are asked for their logs, and the first whose
   * log holds the event took it.
   */
  async post(event: Event, problem: Hash | null | 'coin', trackers: string[]): Promise<Posted> {
    let lastError = '';
    const offered: string[] = [];
    for (const t of trackers.map(withSlash)) {
      const o = await this.offer(t, problem, event);
      if (o.status === 'taken') return { at: t, queued: false };
      offered.push(t);
      if (o.status === 'refused') {
        const at = offered.length > 1 ? await this.holder(event, problem, offered) : null;
        return at ? { at, queued: false } : { at: null, queued: false, error: o.error };
      }
      lastError = o.error;
    }
    appendFileSync(join(this.home, 'queue.jsonl'), JSON.stringify({ problem, event, trackers }) + '\n');
    return { at: null, queued: true, ...(lastError ? { error: lastError } : {}) };
  }

  /** The first of these trackers whose log holds the event, found by its id (CORE.md section 4); else null. */
  private async holder(event: Event, log: Hash | null | 'coin', trackers: string[]): Promise<string | null> {
    const id = eventId(event);
    for (const t of new Set(trackers)) {
      const lines = await this.getLines(this.logUrl(t, log));
      if (lines?.some((l) => eventId(l.event) === id)) return t;
    }
    return null;
  }

  /** Tries the queue again; what a tracker takes, or refuses, leaves it. */
  async flush(): Promise<{ sent: number; left: number }> {
    const file = join(this.home, 'queue.jsonl');
    if (!existsSync(file)) return { sent: 0, left: 0 };
    const items = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { problem: Hash | null | 'coin'; event: Event; trackers: string[] });
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

  /**
   * Every problem this node holds, for `GET /held`: the envelope's hash, title, slug and owner, and how many lines of
   * its chain are held, so another node or a mirror learns what to pull with no tracker between. Read from the folders.
   */
  heldProblems(): { problem: Hash; title: string; slug: string; owner: string; lines: number }[] {
    return this.chains
      .listEnvelopes()
      .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))
      .map(({ hash, envelope: e }) => ({
        problem: hash,
        title: e.problem.title,
        slug: e.problem.slug,
        owner: e.problem.owner,
        lines: this.chains.lines(hash).length,
      }));
  }

  /** The identity log as this node holds it, for `GET /k/events`. */
  cachedIdentity(): Receipt[] {
    return this.chains.lines(IDENTITY_LOG);
  }

  /** What this node holds, to serve to others. */
  cachedEnvelope(hash: Hash): Envelope | null {
    return this.chains.envelopeOf(hash);
  }

  cachedReceipts(hash: Hash): Receipt[] {
    return this.chains.lines(hash);
  }

  cachedBlob(hash: Hash): Uint8Array | null {
    return this.chains.getBlob(hash);
  }
}
