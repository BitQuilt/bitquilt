/**
 * The tracker's store: SQLite through Node's own module, so a tracker runs anywhere Node runs with nothing to compile.
 * Envelopes and blobs by hash; receipts as one chained file per problem (QX-11), stamped strictly increasing; names
 * from version events; announcements for the index (QX-13); the rate-limit buckets; short holds for assisted next.
 */
import { DatabaseSync } from 'node:sqlite';
import { type Envelope, type Event, type Hash, type Receipt, type Received, lineHash, hashHex } from '@bitquilt/core';
import type { MemberTimes } from './counts.js';

export interface StoredEnvelope {
  hash: Hash;
  envelope: Envelope;
  receivedAt: string;
}

export class Store {
  readonly db: DatabaseSync;
  /** How many envelopes, blobs and receipts this store has taken since it opened: what the tracker's kept layer is keyed on. */
  version = 0;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      pragma journal_mode = wal;
      create table if not exists envelopes (hash text primary key, owner text not null, slug text not null, prev text, json text not null, received_at text not null);
      create table if not exists blobs (hash text primary key, bytes blob not null);
      create table if not exists receipts (
        problem text not null, seq integer not null, id text not null, type text not null, key text not null, at text not null,
        json text not null, received text not null, prev text not null, hash text not null,
        primary key (problem, seq), unique (problem, id)
      );
      create index if not exists receipts_key on receipts (key, at);
      create table if not exists names (owner text not null, slug text not null, hash text not null, at text not null, primary key (owner, slug));
      create table if not exists announcements (problem text not null, key text not null, json text not null, at text not null, primary key (problem, key));
      create table if not exists limits (bucket text not null, window text not null, count integer not null, primary key (bucket, window));
      create table if not exists holds (problem text not null, piece text not null, key text not null, until text not null, primary key (problem, piece));
      create table if not exists members (token_hash text primary key, address text not null, key_enc text not null, created_at text not null, name text);
      create table if not exists offers (key text primary key, n integer not null);
    `);
    // SQLite has no "add column if not exists": a column the members table gained after the first databases were made is
    // added here when it is missing, so a database made before it upgrades on open. Every store, new or old, takes this path.
    const columns = new Set((this.db.prepare('pragma table_info(members)').all() as { name: string }[]).map((c) => c.name));
    for (const column of ['first_used_at', 'key_taken_at']) if (!columns.has(column)) this.db.exec(`alter table members add column ${column} text`);
  }

  close(): void {
    this.db.close();
  }

  putEnvelope(hash: Hash, envelope: Envelope, receivedAt: string): void {
    this.db
      .prepare('insert or ignore into envelopes (hash, owner, slug, prev, json, received_at) values (?, ?, ?, ?, ?, ?)')
      .run(hash, envelope.problem.owner, envelope.problem.slug, envelope.problem.prev, JSON.stringify(envelope), receivedAt);
    this.version += 1;
  }

  getEnvelope(hash: Hash): StoredEnvelope | null {
    const row = this.db.prepare('select hash, json, received_at from envelopes where hash = ?').get(hash) as { hash: string; json: string; received_at: string } | undefined;
    return row ? { hash: row.hash as Hash, envelope: JSON.parse(row.json) as Envelope, receivedAt: row.received_at } : null;
  }

  /** The envelope and every ancestor along prev that this store holds, nearest first. */
  chain(hash: Hash): Envelope[] {
    const out: Envelope[] = [];
    const seen = new Set<string>();
    let cur: Hash | null = hash;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const e = this.getEnvelope(cur);
      if (!e) break;
      out.push(e.envelope);
      cur = e.envelope.problem.prev;
    }
    return out;
  }

  listEnvelopes(): StoredEnvelope[] {
    const rows = this.db.prepare('select hash, json, received_at from envelopes order by received_at desc').all() as { hash: string; json: string; received_at: string }[];
    return rows.map((r) => ({ hash: r.hash as Hash, envelope: JSON.parse(r.json) as Envelope, receivedAt: r.received_at }));
  }

  putBlob(hash: Hash, bytes: Uint8Array): void {
    this.db.prepare('insert or ignore into blobs (hash, bytes) values (?, ?)').run(hash, bytes);
    this.version += 1;
  }

  getBlob(hash: Hash): Uint8Array | null {
    const row = this.db.prepare('select bytes from blobs where hash = ?').get(hash) as { bytes: Uint8Array } | undefined;
    return row ? new Uint8Array(row.bytes) : null;
  }

  /** The blobs a chain of envelopes names, those this store holds. */
  blobsFor(chain: Envelope[]): Map<Hash, Uint8Array> {
    const m = new Map<Hash, Uint8Array>();
    for (const e of chain) for (const h of Object.values(e.problem.data)) {
      if (m.has(h)) continue;
      const b = this.getBlob(h);
      if (b) m.set(h, b);
    }
    return m;
  }

  hasEvent(problem: Hash, id: Hash): boolean {
    return this.db.prepare('select 1 from receipts where problem = ? and id = ?').get(problem, id) !== undefined;
  }

  private last(problem: Hash): { seq: number; at: string; hash: string } | null {
    const row = this.db.prepare('select seq, at, hash from receipts where problem = ? order by seq desc limit 1').get(problem) as { seq: number; at: string; hash: string } | undefined;
    return row ?? null;
  }

  /**
   * Appends an event to a problem's chain with a receipt stamped strictly after the last one, and returns the line.
   * Two events on one problem never share a time, so a commit always folds before its reveal.
   */
  appendReceipt(problem: Hash, event: Event, id: Hash, by: string, now: string, custody: Received['custody'], seat?: Received['seat'], extra?: Record<string, unknown>): Receipt {
    const last = this.last(problem);
    let at = now;
    if (last && at <= last.at) at = new Date(Date.parse(last.at) + 1).toISOString();
    // The wrapper may carry what the door read and vouches for (CORE.md section 5 allows extra fields); the coin's word is one (QX-17).
    const received: Received = { by, at, ...(custody ? { custody } : {}), ...(seat ? { seat } : {}), ...(extra ?? {}) };
    const seq = (last?.seq ?? 0) + 1;
    const prev = last?.hash ?? hashHex(problem);
    const hash = lineHash(seq, prev, { event, received: [received] });
    this.db
      .prepare('insert into receipts (problem, seq, id, type, key, at, json, received, prev, hash) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(problem, seq, id, event.type, event.key, at, JSON.stringify(event), JSON.stringify([received]), prev, hash);
    this.version += 1;
    return { event, received: [received], seq, prev, hash };
  }

  /** The chained lines of a problem after `since`, oldest first, at most `limit`. */
  receipts(problem: Hash, since = 0, limit = 10_000): Receipt[] {
    const rows = this.db.prepare('select seq, json, received, prev, hash from receipts where problem = ? and seq > ? order by seq limit ?').all(problem, since, limit) as { seq: number; json: string; received: string; prev: string; hash: string }[];
    return rows.map((r) => ({ event: JSON.parse(r.json) as Event, received: JSON.parse(r.received) as Received[], seq: r.seq, prev: r.prev, hash: r.hash }));
  }

  /** The chain's last line: its seq, hash and time, or null for a chain with no line. */
  head(problem: Hash): { seq: number; hash: string; at: string } | null {
    return this.last(problem);
  }

  putName(owner: string, slug: string, hash: Hash, at: string): void {
    this.db.prepare('insert into names (owner, slug, hash, at) values (?, ?, ?, ?) on conflict (owner, slug) do update set hash = excluded.hash, at = excluded.at where excluded.at > names.at').run(owner, slug, hash, at);
  }

  getName(owner: string, slug: string): Hash | null {
    const row = this.db.prepare('select hash from names where owner = ? and slug = ?').get(owner, slug) as { hash: string } | undefined;
    return row ? (row.hash as Hash) : null;
  }

  putAnnouncement(problem: Hash, key: string, event: Event, at: string): void {
    this.db.prepare('insert into announcements (problem, key, json, at) values (?, ?, ?, ?) on conflict (problem, key) do update set json = excluded.json, at = excluded.at').run(problem, key, JSON.stringify(event), at);
  }

  announcements(problem?: Hash): { problem: Hash; key: string; event: Event; at: string }[] {
    const rows = (problem
      ? this.db.prepare('select problem, key, json, at from announcements where problem = ? order by at desc').all(problem)
      : this.db.prepare('select problem, key, json, at from announcements order by at desc').all()) as { problem: string; key: string; json: string; at: string }[];
    return rows.map((r) => ({ problem: r.problem as Hash, key: r.key, event: JSON.parse(r.json) as Event, at: r.at }));
  }

  /** Counts a hit in an hourly bucket and says whether it is over the limit. */
  hit(bucket: string, window: string, limit: number): boolean {
    this.db.prepare('insert into limits (bucket, window, count) values (?, ?, 1) on conflict (bucket, window) do update set count = count + 1').run(bucket, window);
    const row = this.db.prepare('select count from limits where bucket = ? and window = ?').get(bucket, window) as { count: number };
    return row.count > limit;
  }

  /** A short hold on a piece for a key, so two clients on this tracker are not handed the same piece in the same minute. */
  hold(problem: Hash, piece: Hash, key: string, until: string): void {
    this.db.prepare('insert into holds (problem, piece, key, until) values (?, ?, ?, ?) on conflict (problem, piece) do update set key = excluded.key, until = excluded.until').run(problem, piece, key, until);
  }

  /** A member whose key this tracker holds, by the hash of their address token. The key is stored encrypted; the store never sees it plain. */
  putMember(tokenHash: string, address: string, keyEnc: string, at: string): void {
    this.db.prepare('insert into members (token_hash, address, key_enc, created_at) values (?, ?, ?, ?)').run(tokenHash, address, keyEnc, at);
  }

  getMember(tokenHash: string): { address: string; keyEnc: string; createdAt: string; name: string | null } | null {
    const row = this.db.prepare('select address, key_enc, created_at, name from members where token_hash = ?').get(tokenHash) as { address: string; key_enc: string; created_at: string; name: string | null } | undefined;
    return row ? { address: row.address, keyEnc: row.key_enc, createdAt: row.created_at, name: row.name } : null;
  }

  /** The first time a member's address was used, kept once: a later call changes nothing. What the funnel counts as addresses first used (counts.ts). */
  markMemberUsed(tokenHash: string, at: string): void {
    this.db.prepare('update members set first_used_at = ? where token_hash = ? and first_used_at is null').run(at, tokenHash);
  }

  /** When a member took the key home, kept once: a later call changes nothing. What the funnel counts as keys taken home (counts.ts). */
  markMemberKeyTaken(tokenHash: string, at: string): void {
    this.db.prepare('update members set key_taken_at = ? where token_hash = ? and key_taken_at is null').run(at, tokenHash);
  }

  /** When each member was made, first used and took the key home, and nothing else about them: what the funnel reads (counts.ts). */
  memberTimes(): MemberTimes[] {
    const rows = this.db.prepare('select created_at, first_used_at, key_taken_at from members order by created_at').all() as { created_at: string; first_used_at: string | null; key_taken_at: string | null }[];
    return rows.map((r) => ({ createdAt: r.created_at, firstUsedAt: r.first_used_at, keyTakenAt: r.key_taken_at }));
  }

  /** A hold is spent once its key has revealed on, or declined, the piece. */
  releaseHold(problem: Hash, piece: Hash, key: string): void {
    this.db.prepare('delete from holds where problem = ? and piece = ? and key = ?').run(problem, piece, key);
  }

  /** The number of this offer to the key, counting from one: QX-5's tenth is read off it. */
  nextOfferCount(key: string): number {
    this.db.prepare('insert into offers (key, n) values (?, 1) on conflict (key) do update set n = n + 1').run(key);
    return (this.db.prepare('select n from offers where key = ?').get(key) as { n: number }).n;
  }

  heldByOthers(problem: Hash, key: string, now: string): Set<Hash> {
    const rows = this.db.prepare('select piece from holds where problem = ? and key != ? and until > ?').all(problem, key, now) as { piece: string }[];
    return new Set(rows.map((r) => r.piece as Hash));
  }
}
