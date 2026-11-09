/**
 * The tracker's store: SQLite through Node's own module, so a tracker runs anywhere Node runs with nothing to compile.
 * Envelopes and blobs by hash; receipts as one chained file per problem (QX-11), stamped strictly increasing; names
 * from version events; announcements for the index (QX-13); the rate-limit buckets; short holds for assisted next;
 * the hosted on-ramp's members, and the clients, codes and grants of its authorization server (QX-18). Beside it, the
 * input the reducer takes for a problem, read from any store that answers an envelope, a blob and a log's lines, so
 * the door and the mirror fold the same chains the same way.
 */
import { DatabaseSync } from 'node:sqlite';
import {
  type Envelope,
  type Event,
  type Hash,
  type Receipt,
  type Received,
  type ReduceInput,
  IDENTITY_LOG,
  eventId,
  lineHash,
  hashHex,
  problemHash,
} from '@bitquilt/core';
import type { MemberTimes } from './counts.js';

/**
 * A client registered with the hosted on-ramp's authorization server (QX-18): its metadata as kept, and the hash of its
 * secret where it has one.
 */
export interface OAuthClientRow {
  clientId: string;
  metadata: Record<string, unknown>;
  secretHash: string | null;
  createdAt: string;
}

/**
 * An authorization code by the hash it is kept under: the client, the member who presented their address, where it was
 * sent, the PKCE challenge, and when it was spent.
 */
export interface OAuthCodeRow {
  clientId: string;
  tokenHash: string;
  redirectUri: string;
  challenge: string;
  resource: string | null;
  expiresAt: string;
  usedAt: string | null;
  grantId: string | null;
}

/**
 * A grant: one member's tokens through one client, as the code that began it was sent. `via` is the product the
 * exchange was bound to, with `viaBy` saying how (its published addresses, or its published key), or `other`, with the
 * name the client gave itself; `refreshGen` counts the rotations, so only the newest refresh token is good.
 */
export interface GrantRow {
  id: string;
  tokenHash: string;
  clientId: string;
  redirectUri: string;
  via: string;
  viaBy: string | null;
  clientName: string | null;
  resource: string | null;
  createdAt: string;
  refreshGen: number;
  revokedAt: string | null;
}

export interface StoredEnvelope {
  hash: Hash;
  envelope: Envelope;
  receivedAt: string;
}

/** The lines of a log with none, which no reader can add to. */
const NO_LINES: readonly Receipt[] = Object.freeze([]);

/**
 * A value made read-only through every level, as the store hands out what it keeps: every reader shares it, so a
 * reader that wrote to it would change what the next one reads. Iterative, since a body may nest as deep as the door
 * takes.
 */
function frozen<T>(value: T): T {
  const left: unknown[] = [value];
  while (left.length) {
    const v = left.pop();
    if (v === null || typeof v !== 'object' || Object.isFrozen(v)) continue;
    Object.freeze(v);
    for (const x of Object.values(v)) left.push(x);
  }
  return value;
}

export class Store {
  readonly db: DatabaseSync;
  /**
   * How many envelopes, blobs and receipts this store has taken since it opened: what the tracker's kept layer is keyed
   * on.
   */
  version = 0;

  /**
   * What the store keeps of what it has read, so a fold over the whole store, which every read and every admission
   * makes, parses each line and each envelope once and not again each time: each log's lines read whole, each envelope
   * by its hash, and the list of envelopes. Lines are only appended, and envelopes only added, so what is kept stays
   * true; a write through this store, or a commit by another connection to its database, is caught up by reading what
   * came after. Each line and envelope it hands out is frozen, since every reader shares it; each list is the reader's
   * own, to sort or add to.
   */
  private readonly kept = {
    logs: new Map<Hash, { lines: readonly Receipt[]; stamp: string }>(),
    envelopes: new Map<Hash, StoredEnvelope>(),
    list: null as { list: readonly StoredEnvelope[]; stamp: string } | null,
  };

  /** SQLite's data version as last read, until the code running now has run. */
  private dataVersion: number | null = null;

  /**
   * Where the database stands: this store's version, which each write through it moves, and SQLite's data version,
   * which moves when another connection commits, read once for all the code that runs before it next waits.
   */
  stamp(): string {
    if (this.dataVersion === null) {
      this.dataVersion = (this.db.prepare('pragma data_version').get() as { data_version: number }).data_version;
      queueMicrotask(() => {
        this.dataVersion = null;
      });
    }
    return `${this.version}:${this.dataVersion}`;
  }

  /** Whether this store keeps what it reads (`kept`): a door's does, since its layer reads every log again. */
  private readonly keep: boolean;

  /**
   * A store over the SQLite file at `path`, or in memory for `:memory:`. With `keep` false it reads every log and
   * envelope afresh each time it is asked, as a node with no door does, which never folds the whole store and so has
   * no use for holding all of it.
   */
  constructor(path: string, { keep = true }: { keep?: boolean } = {}) {
    this.keep = keep;
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
      create table if not exists oauth_clients (client_id text primary key, json text not null, secret_hash text, created_at text not null);
      create table if not exists oauth_codes (code_hash text primary key, client_id text not null, token_hash text not null, redirect_uri text not null, challenge text not null, resource text, expires_at text not null, used_at text, grant_id text);
      create table if not exists oauth_grants (
        id text primary key, token_hash text not null, client_id text not null, redirect_uri text not null, via text not null, client_name text,
        resource text, created_at text not null, refresh_gen integer not null, revoked_at text, via_by text
      );
      create index if not exists oauth_grants_member on oauth_grants (token_hash);
      create table if not exists oauth_assertions (jti_hash text primary key, expires_at text not null);
    `);
    // SQLite has no "add column if not exists": a column the members table gained after the first databases were made
    // is added here when it is missing, so a database made before it upgrades on open. Every store, new or old, takes
    // this path.
    const columns = new Set(
      (this.db.prepare('pragma table_info(members)').all() as { name: string }[]).map((c) => c.name),
    );
    for (const column of ['first_used_at', 'key_taken_at'])
      if (!columns.has(column)) this.db.exec(`alter table members add column ${column} text`);
    const grantColumns = new Set(
      (this.db.prepare('pragma table_info(oauth_grants)').all() as { name: string }[]).map((c) => c.name),
    );
    if (!grantColumns.has('via_by')) this.db.exec('alter table oauth_grants add column via_by text');
  }

  close(): void {
    this.db.close();
  }

  putEnvelope(hash: Hash, envelope: Envelope, receivedAt: string): void {
    this.db
      .prepare('insert or ignore into envelopes (hash, owner, slug, prev, json, received_at) values (?, ?, ?, ?, ?, ?)')
      .run(
        hash,
        envelope.problem.owner,
        envelope.problem.slug,
        envelope.problem.prev,
        JSON.stringify(envelope),
        receivedAt,
      );
    this.version += 1;
  }

  /** An envelope by its hash, read once and kept frozen where this store keeps (`kept`), or null where none is held. */
  getEnvelope(hash: Hash): StoredEnvelope | null {
    const kept = this.kept.envelopes.get(hash);
    if (kept) return kept;
    const row = this.db.prepare('select hash, json, received_at from envelopes where hash = ?').get(hash) as
      | { hash: string; json: string; received_at: string }
      | undefined;
    if (!row) return null;
    const stored = { hash: row.hash as Hash, envelope: JSON.parse(row.json) as Envelope, receivedAt: row.received_at };
    if (!this.keep) return stored;
    this.kept.envelopes.set(hash, frozen(stored));
    return stored;
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

  /**
   * Every envelope, the latest received first, each read once and kept where this store keeps (`kept`): a list of its
   * own for each reader, of envelopes they share.
   */
  listEnvelopes(): StoredEnvelope[] {
    const stamp = this.stamp();
    if (this.kept.list?.stamp === stamp) return [...this.kept.list.list];
    const rows = this.db.prepare('select hash from envelopes order by received_at desc').all() as { hash: string }[];
    const list = rows.map((r) => this.getEnvelope(r.hash as Hash)!);
    if (this.keep) this.kept.list = { list: Object.freeze([...list]), stamp };
    return list;
  }

  putBlob(hash: Hash, bytes: Uint8Array): void {
    this.db.prepare('insert or ignore into blobs (hash, bytes) values (?, ?)').run(hash, bytes);
    this.version += 1;
  }

  getBlob(hash: Hash): Uint8Array | null {
    const row = this.db.prepare('select bytes from blobs where hash = ?').get(hash) as
      | { bytes: Uint8Array }
      | undefined;
    return row ? new Uint8Array(row.bytes) : null;
  }

  /** Whether this store holds a blob. */
  hasBlob(hash: Hash): boolean {
    return this.db.prepare('select 1 from blobs where hash = ?').get(hash) !== undefined;
  }

  /**
   * How many bytes a blob has, without reading it, or null where this store has none: what a trace's spans are measured
   * against (QX-19).
   */
  blobLength(hash: Hash): number | null {
    const row = this.db.prepare('select length(bytes) as n from blobs where hash = ?').get(hash) as
      | { n: number }
      | undefined;
    return row ? row.n : null;
  }

  hasEvent(problem: Hash, id: Hash): boolean {
    return this.db.prepare('select 1 from receipts where problem = ? and id = ?').get(problem, id) !== undefined;
  }

  private last(problem: Hash): { seq: number; at: string; hash: string } | null {
    const row = this.db
      .prepare('select seq, at, hash from receipts where problem = ? order by seq desc limit 1')
      .get(problem) as { seq: number; at: string; hash: string } | undefined;
    return row ?? null;
  }

  /**
   * Appends an event to a problem's chain with a receipt stamped strictly after the last one, and returns the line.
   * Two events on one problem never share a time, so a commit always folds before its reveal.
   */
  appendReceipt(
    problem: Hash,
    event: Event,
    id: Hash,
    by: string,
    now: string,
    custody: Received['custody'],
    seat?: Received['seat'],
    extra?: Record<string, unknown>,
  ): Receipt {
    const last = this.last(problem);
    let at = now;
    if (last && at <= last.at) at = new Date(Date.parse(last.at) + 1).toISOString();
    // The wrapper may carry what the door read and vouches for (CORE.md section 5 allows extra fields); the coin's word
    // is one (QX-17).
    const received: Received = { by, at, ...(custody ? { custody } : {}), ...(seat ? { seat } : {}), ...(extra ?? {}) };
    const seq = (last?.seq ?? 0) + 1;
    const prev = last?.hash ?? hashHex(problem);
    const hash = lineHash(seq, prev, { event, received: [received] });
    this.db
      .prepare(
        'insert into receipts (problem, seq, id, type, key, at, json, received, prev, hash) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(problem, seq, id, event.type, event.key, at, JSON.stringify(event), JSON.stringify([received]), prev, hash);
    this.version += 1;
    return { event, received: [received], seq, prev, hash };
  }

  /**
   * QX-21: appends an event pulled from a peer's chain with the wrappers it came with, the peer's and this door's, and
   * returns the line. Nothing is stamped: the row's time is the earliest wrapper's, which is the time the fold reads.
   */
  appendPulled(problem: Hash, event: Event, id: Hash, received: Received[]): Receipt {
    const last = this.last(problem);
    const at = received.map((w) => w.at).sort()[0] ?? '';
    const seq = (last?.seq ?? 0) + 1;
    const prev = last?.hash ?? hashHex(problem);
    const hash = lineHash(seq, prev, { event, received });
    this.db
      .prepare(
        'insert into receipts (problem, seq, id, type, key, at, json, received, prev, hash) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(problem, seq, id, event.type, event.key, at, JSON.stringify(event), JSON.stringify(received), prev, hash);
    this.version += 1;
    return { event, received, seq, prev, hash };
  }

  /**
   * A page of a chain: its lines after `since`, oldest first, at most `limit`. A route that pages reads this and names
   * both bounds; a fold, a count or a check of the whole chain reads `lines`, which has no limit.
   */
  receipts(problem: Hash, since: number, limit: number): Receipt[] {
    const rows = this.db
      .prepare(
        'select seq, json, received, prev, hash from receipts where problem = ? and seq > ? order by seq limit ?',
      )
      .all(problem, since, limit) as { seq: number; json: string; received: string; prev: string; hash: string }[];
    return rows.map((r) => ({
      event: JSON.parse(r.json) as Event,
      received: JSON.parse(r.received) as Received[],
      seq: r.seq,
      prev: r.prev,
      hash: r.hash,
    }));
  }

  /** The chain's last line: its seq, hash and time, or null for a chain with no line. */
  head(problem: Hash): { seq: number; hash: string; at: string } | null {
    return this.last(problem);
  }

  // The node's store of chained logs (the client's `Chains`; NODE.md section 2): the same methods a home's cache
  // answers, so a door and a node are over this one store, and what the door admits is what the node serves and
  // keeps.

  envelopeOf(hash: Hash): Envelope | null {
    return this.getEnvelope(hash)?.envelope ?? null;
  }

  /**
   * Every line of a log, the whole of it, oldest first: a problem's by its hash, the identity log and the coin log by
   * their constants. Every read that means the whole log reads this, as the mirror and the client do, so a log of any
   * length folds the same at each.
   */
  lines(log: Hash): Receipt[] {
    return this.keep ? [...this.keptLines(log)] : this.receipts(log, 0, Number.MAX_SAFE_INTEGER);
  }

  /** How many lines a log holds. */
  lineCount(log: Hash): number {
    if (this.keep) return this.keptLines(log).length;
    return (this.db.prepare('select count(*) as n from receipts where problem = ?').get(log) as { n: number }).n;
  }

  /**
   * A log's lines as this store keeps them (`kept`): a log is only appended to, so what is kept is caught up with the
   * lines after its last. A log with no line is not kept, so asking after any hash keeps nothing.
   */
  private keptLines(log: Hash): readonly Receipt[] {
    const stamp = this.stamp();
    const kept = this.kept.logs.get(log);
    if (kept?.stamp === stamp) return kept.lines;
    const before = kept?.lines ?? NO_LINES;
    const after = this.receipts(log, before.length ? before[before.length - 1]!.seq! : 0, Number.MAX_SAFE_INTEGER);
    if (!kept && after.length === 0) return NO_LINES;
    const lines = after.length ? Object.freeze([...before, ...after.map(frozen)]) : before;
    this.kept.logs.set(log, { lines, stamp });
    return lines;
  }

  /**
   * Lines kept as another place gave them, with their seq, prev and hash: the node's keep after a chain only grew
   * (PROTOCOL.md, The mirror).
   */
  appendLines(log: Hash, lines: Receipt[]): void {
    const insert = this.db.prepare(
      'insert into receipts (problem, seq, id, type, key, at, json, received, prev, hash) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const last = this.last(log);
    let seq = last?.seq ?? 0;
    let prev = last?.hash ?? hashHex(log);
    for (const l of lines) {
      seq += 1;
      const at = l.received.map((w) => w.at).sort()[0] ?? '';
      const hash = l.hash ?? lineHash(seq, prev, { event: l.event, received: l.received });
      insert.run(
        log,
        seq,
        eventId(l.event),
        l.event.type,
        l.event.key,
        at,
        JSON.stringify(l.event),
        JSON.stringify(l.received),
        l.prev ?? prev,
        hash,
      );
      prev = hash;
      this.version += 1;
    }
  }

  /** What is held: problems, logs with a line, blobs, and the bytes of all three. */
  held(): { problems: number; ledgers: number; blobs: number; bytes: number } {
    const one = (sql: string): number => Number((this.db.prepare(sql).get() as { n: number | null }).n ?? 0);
    return {
      problems: one('select count(*) as n from envelopes'),
      ledgers: one('select count(distinct problem) as n from receipts'),
      blobs: one('select count(*) as n from blobs'),
      bytes:
        one('select coalesce(sum(length(json)), 0) as n from envelopes') +
        one('select coalesce(sum(length(json) + length(received)), 0) as n from receipts') +
        one('select coalesce(sum(length(bytes)), 0) as n from blobs'),
    };
  }

  putName(owner: string, slug: string, hash: Hash, at: string): void {
    this.db
      .prepare(
        'insert into names (owner, slug, hash, at) values (?, ?, ?, ?) on conflict (owner, slug) do update set hash = excluded.hash, at = excluded.at where excluded.at > names.at',
      )
      .run(owner, slug, hash, at);
  }

  getName(owner: string, slug: string): Hash | null {
    const row = this.db.prepare('select hash from names where owner = ? and slug = ?').get(owner, slug) as
      | { hash: string }
      | undefined;
    return row ? (row.hash as Hash) : null;
  }

  putAnnouncement(problem: Hash, key: string, event: Event, at: string): void {
    this.db
      .prepare(
        'insert into announcements (problem, key, json, at) values (?, ?, ?, ?) on conflict (problem, key) do update set json = excluded.json, at = excluded.at',
      )
      .run(problem, key, JSON.stringify(event), at);
  }

  announcements(problem?: Hash): { problem: Hash; key: string; event: Event; at: string }[] {
    const rows = (
      problem
        ? this.db
            .prepare('select problem, key, json, at from announcements where problem = ? order by at desc')
            .all(problem)
        : this.db.prepare('select problem, key, json, at from announcements order by at desc').all()
    ) as { problem: string; key: string; json: string; at: string }[];
    return rows.map((r) => ({ problem: r.problem as Hash, key: r.key, event: JSON.parse(r.json) as Event, at: r.at }));
  }

  /** Counts a hit in an hourly bucket and says whether it is over the limit. */
  hit(bucket: string, window: string, limit: number): boolean {
    this.db
      .prepare(
        'insert into limits (bucket, window, count) values (?, ?, 1) on conflict (bucket, window) do update set count = count + 1',
      )
      .run(bucket, window);
    const row = this.db.prepare('select count from limits where bucket = ? and window = ?').get(bucket, window) as {
      count: number;
    };
    return row.count > limit;
  }

  /**
   * A short hold on a piece for a key, so two clients on this tracker are not handed the same piece in the same minute.
   */
  hold(problem: Hash, piece: Hash, key: string, until: string): void {
    this.db
      .prepare(
        'insert into holds (problem, piece, key, until) values (?, ?, ?, ?) on conflict (problem, piece) do update set key = excluded.key, until = excluded.until',
      )
      .run(problem, piece, key, until);
  }

  /**
   * A member whose key this tracker holds, by the hash of their address token. The key is stored encrypted; the store
   * never sees it plain.
   */
  putMember(tokenHash: string, address: string, keyEnc: string, at: string): void {
    this.db
      .prepare('insert into members (token_hash, address, key_enc, created_at) values (?, ?, ?, ?)')
      .run(tokenHash, address, keyEnc, at);
  }

  /**
   * A member by the hash of their address token. The table's `name` column is never written, so it is not read; it
   * stays in the schema so that no store migrates.
   */
  getMember(tokenHash: string): { address: string; keyEnc: string; createdAt: string } | null {
    const row = this.db
      .prepare('select address, key_enc, created_at from members where token_hash = ?')
      .get(tokenHash) as { address: string; key_enc: string; created_at: string } | undefined;
    return row ? { address: row.address, keyEnc: row.key_enc, createdAt: row.created_at } : null;
  }

  /**
   * The first time a member's address was used, kept once: a later call changes nothing. What the funnel counts as
   * addresses first used (counts.ts).
   */
  markMemberUsed(tokenHash: string, at: string): void {
    this.db
      .prepare('update members set first_used_at = ? where token_hash = ? and first_used_at is null')
      .run(at, tokenHash);
  }

  /**
   * When a member took the key home, kept once: a later call changes nothing. What the funnel counts as keys taken home
   * (counts.ts).
   */
  markMemberKeyTaken(tokenHash: string, at: string): void {
    this.db
      .prepare('update members set key_taken_at = ? where token_hash = ? and key_taken_at is null')
      .run(at, tokenHash);
  }

  /** Every member, by the hash of their address token, oldest first: whom the hosted on-ramp's owner turn runs for. */
  members(): string[] {
    return (
      this.db.prepare('select token_hash from members order by created_at').all() as { token_hash: string }[]
    ).map((r) => r.token_hash);
  }

  /**
   * When each member was made, first used and took the key home, and nothing else about them: what the funnel reads
   * (counts.ts).
   */
  memberTimes(): MemberTimes[] {
    const rows = this.db
      .prepare('select created_at, first_used_at, key_taken_at from members order by created_at')
      .all() as { created_at: string; first_used_at: string | null; key_taken_at: string | null }[];
    return rows.map((r) => ({ createdAt: r.created_at, firstUsedAt: r.first_used_at, keyTakenAt: r.key_taken_at }));
  }

  /** QX-18: a client the authorization server registered, with the hash of its secret where it has one. */
  putOAuthClient(clientId: string, metadata: Record<string, unknown>, secretHash: string | null, at: string): void {
    this.db
      .prepare('insert into oauth_clients (client_id, json, secret_hash, created_at) values (?, ?, ?, ?)')
      .run(clientId, JSON.stringify(metadata), secretHash, at);
  }

  getOAuthClient(clientId: string): OAuthClientRow | null {
    const row = this.db
      .prepare('select client_id, json, secret_hash, created_at from oauth_clients where client_id = ?')
      .get(clientId) as { client_id: string; json: string; secret_hash: string | null; created_at: string } | undefined;
    return row
      ? {
          clientId: row.client_id,
          metadata: JSON.parse(row.json) as Record<string, unknown>,
          secretHash: row.secret_hash,
          createdAt: row.created_at,
        }
      : null;
  }

  putOAuthCode(codeHash: string, code: Omit<OAuthCodeRow, 'usedAt' | 'grantId'>): void {
    this.db
      .prepare(
        'insert into oauth_codes (code_hash, client_id, token_hash, redirect_uri, challenge, resource, expires_at) values (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(codeHash, code.clientId, code.tokenHash, code.redirectUri, code.challenge, code.resource, code.expiresAt);
  }

  /**
   * Spends a code: marks it used at `at` the first time, and returns it as it stood before, so a second use is seen.
   */
  spendOAuthCode(codeHash: string, at: string): OAuthCodeRow | null {
    const row = this.db
      .prepare(
        'select client_id, token_hash, redirect_uri, challenge, resource, expires_at, used_at, grant_id from oauth_codes where code_hash = ?',
      )
      .get(codeHash) as
      | {
          client_id: string;
          token_hash: string;
          redirect_uri: string;
          challenge: string;
          resource: string | null;
          expires_at: string;
          used_at: string | null;
          grant_id: string | null;
        }
      | undefined;
    if (!row) return null;
    if (row.used_at === null)
      this.db.prepare('update oauth_codes set used_at = ? where code_hash = ?').run(at, codeHash);
    return {
      clientId: row.client_id,
      tokenHash: row.token_hash,
      redirectUri: row.redirect_uri,
      challenge: row.challenge,
      resource: row.resource,
      expiresAt: row.expires_at,
      usedAt: row.used_at,
      grantId: row.grant_id,
    };
  }

  /** The grant a code began, kept on the code so a second use of it revokes that grant. */
  setOAuthCodeGrant(codeHash: string, grantId: string): void {
    this.db.prepare('update oauth_codes set grant_id = ? where code_hash = ?').run(grantId, codeHash);
  }

  putGrant(g: Omit<GrantRow, 'refreshGen' | 'revokedAt'>): void {
    this.db
      .prepare(
        'insert into oauth_grants (id, token_hash, client_id, redirect_uri, via, via_by, client_name, resource, created_at, refresh_gen) values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)',
      )
      .run(g.id, g.tokenHash, g.clientId, g.redirectUri, g.via, g.viaBy, g.clientName, g.resource, g.createdAt);
  }

  getGrant(id: string): GrantRow | null {
    const row = this.db
      .prepare(
        'select id, token_hash, client_id, redirect_uri, via, via_by, client_name, resource, created_at, refresh_gen, revoked_at from oauth_grants where id = ?',
      )
      .get(id) as
      | {
          id: string;
          token_hash: string;
          client_id: string;
          redirect_uri: string;
          via: string;
          via_by: string | null;
          client_name: string | null;
          resource: string | null;
          created_at: string;
          refresh_gen: number;
          revoked_at: string | null;
        }
      | undefined;
    return row
      ? {
          id: row.id,
          tokenHash: row.token_hash,
          clientId: row.client_id,
          redirectUri: row.redirect_uri,
          via: row.via,
          viaBy: row.via_by,
          clientName: row.client_name,
          resource: row.resource,
          createdAt: row.created_at,
          refreshGen: row.refresh_gen,
          revokedAt: row.revoked_at,
        }
      : null;
  }

  /**
   * QX-18: a signed client assertion's id, kept once so the assertion is not presented again; false when it was seen
   * already.
   */
  putAssertion(jtiHash: string, expiresAt: string): boolean {
    return (
      this.db
        .prepare('insert or ignore into oauth_assertions (jti_hash, expires_at) values (?, ?)')
        .run(jtiHash, expiresAt).changes === 1
    );
  }

  /** A member's grants, oldest first: which clients hold tokens for the address, and where each code was sent. */
  grantsOf(tokenHash: string): GrantRow[] {
    const ids = this.db
      .prepare('select id from oauth_grants where token_hash = ? order by created_at, id')
      .all(tokenHash) as { id: string }[];
    return ids.map((r) => this.getGrant(r.id)!);
  }

  /**
   * Moves a live grant's refresh tokens on by one, from the generation presented; false where that is not the newest or
   * the grant is revoked.
   */
  rotateGrant(id: string, from: number): boolean {
    return (
      this.db
        .prepare(
          'update oauth_grants set refresh_gen = refresh_gen + 1 where id = ? and refresh_gen = ? and revoked_at is null',
        )
        .run(id, from).changes === 1
    );
  }

  /** Revokes a grant, kept once: every token it issued stops working. */
  revokeGrant(id: string, at: string): void {
    this.db.prepare('update oauth_grants set revoked_at = ? where id = ? and revoked_at is null').run(at, id);
  }

  /**
   * A key's latest reveals across every log, newest first, by the index on (key, at): what the directory's hot list
   * reads (APP.md, "The window").
   */
  revealsBy(key: string, limit: number): { problem: Hash; piece: Hash; at: string }[] {
    const rows = this.db
      .prepare(
        `select problem, json_extract(json, '$.piece') as piece, at from receipts where key = ? and type = 'reveal' order by at desc limit ?`,
      )
      .all(key, limit) as { problem: string; piece: string; at: string }[];
    return rows.map((r) => ({ problem: r.problem as Hash, piece: r.piece as Hash, at: r.at }));
  }

  /** QX-18: a problem's reveals whose receipts carry a witness, read without parsing the rest of the chain. */
  witnessedReveals(problem: Hash): { key: string; piece: Hash; received: Received[] }[] {
    const rows = this.db
      .prepare(
        `select key, json_extract(json, '$.piece') as piece, received from receipts where problem = ? and type = 'reveal' and received like '%"via":%' order by seq`,
      )
      .all(problem) as { key: string; piece: string; received: string }[];
    return rows.map((r) => ({ key: r.key, piece: r.piece as Hash, received: JSON.parse(r.received) as Received[] }));
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
    const rows = this.db
      .prepare('select piece from holds where problem = ? and key != ? and until > ?')
      .all(problem, key, now) as { piece: string }[];
    return new Set(rows.map((r) => r.piece as Hash));
  }
}

/**
 * What `reduceInputOf` reads a problem from: an envelope by its hash, a blob by its hash, and every line of a log. The
 * tracker's store answers it, and so do the mirror's files and a node's store under the keeper (`KeptStore` in
 * packages/mirror), which share the shape and do not import it.
 */
export interface ChainReader {
  envelopeOf(hash: Hash): Envelope | null;
  getBlob(hash: Hash): Uint8Array | null;
  lines(log: Hash): Receipt[];
}

/**
 * What the reducer takes for a problem held here: its envelope chain along prev, the blobs, every receipt along the
 * chain and the identity log.
 */
export function reduceInputOf(store: ChainReader, envelope: Envelope, at: string): ReduceInput {
  const chainEnvelopes: Envelope[] = [envelope];
  const guard = new Set<Hash>([problemHash(envelope)]);
  for (let cur = envelope.problem.prev; cur && !guard.has(cur); ) {
    guard.add(cur);
    const prev = store.envelopeOf(cur);
    if (!prev) break;
    chainEnvelopes.push(prev);
    cur = prev.problem.prev;
  }
  const blobs = new Map<Hash, Uint8Array>();
  for (const e of chainEnvelopes)
    for (const h of Object.values(e.problem.data))
      if (!blobs.has(h)) {
        const b = store.getBlob(h);
        if (b) blobs.set(h, b);
      }
  const receipts: Receipt[] = [];
  // Line by line, not spread into one call, which a log of more than about a hundred thousand lines would overflow.
  for (const e of chainEnvelopes) for (const l of store.lines(problemHash(e))) receipts.push(l);
  for (const l of store.lines(IDENTITY_LOG)) receipts.push(l);
  return { envelopes: chainEnvelopes, blobs, receipts, now: at };
}
