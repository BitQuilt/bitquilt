/**
 * The hosted on-ramp (PROTOCOL.md, Identity; APP.md, Three things in one process): for a person who cannot run
 * anything, a tracker makes a root key, holds it encrypted at rest, and mounts Quilt's connector at an address they
 * paste into their AI. Every receipt for its events says custody: hosted, so a reader can tell. The key is theirs:
 * they can fetch it with their address and move it into a Quilt of their own.
 *
 * With a token key set, the on-ramp is also the authorization server for its addresses (QX-18, oauth.ts): a product
 * that connects at `/mcp` holds a token for an address its person presented, and the events posted through that
 * token say which product's callback the code was sent to, `via` beside custody, in the same wrapper.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync } from 'node:fs';
import {
  type Address,
  type Hash,
  addressOf,
  problemHash,
  randomSecretKey,
  secretFromHex,
  secretToHex,
  withSlash,
} from '@bitquilt/core';
import { PRIVATE_RANGES, type Store, clientAddress, passageIn, rangesOf, restsOf } from '@bitquilt/tracker';
import {
  AWAY_LOG,
  type Config,
  DEFAULT_CONFIG,
  type OwnerTurn,
  Quilt,
  Resolver,
  WINDOW_HTML,
  WINDOW_OPS,
  WINDOW_READ_OPS,
  type Witness,
  createMcpServer,
  kindWords,
  localRunner,
  makeLink,
  ownerTurn,
  publicFetch,
  sheetOf,
  shared,
  windowAnswer,
} from 'quilt';
import { joinPage } from './join-page.js';
import { pagePolicy } from './page-policy.js';
import { type SquareNow, type SquareReading, type SquareView, squarePage } from './square-page.js';
import { type OAuthServer, createOAuth } from './oauth.js';
import { type Sentence, vendorSentence } from './sentence.js';
import { SHEET_PAGE } from './sheet-page.js';

export interface HostedOptions {
  store: Store;
  /**
   * The tracker's own address, which the connector posts to and which addresses are made from; a function when it is
   * known only once the tracker listens.
   */
  trackerUrl: string | (() => string);
  /** The secret the keys are encrypted with at rest; from the environment, never from code. */
  keySecret: string;
  /** A folder for each member's cache, library and queue. */
  home: string;
  /** The secret the tracker recognises as its own connector's, so it marks custody. */
  custodySecret: string;
  /** How many addresses one network address may be handed in an hour (20). */
  joinsPerHour?: number;
  /**
   * How many reads of the site's window reader (`/window/io`) one network address may make in an hour; 1200 unless set.
   */
  readsPerHour?: number;
  /** What the tracker calls itself, named on the authorization page; its address when none. */
  name?: string;
  /**
   * The authorization server (QX-18): the key its tokens are signed with, from the environment and never from code;
   * the issuer its metadata names, the tracker's address without the trailing slash when none is given; how many
   * registrations, authorizations and token requests one network address may make in an hour (600); and the address
   * ranges each product publishes for its servers, products.ts's when none are given. Absent, the on-ramp has no
   * OAuth and an address is its own credential, as before.
   */
  oauth?: { secret: string; issuer?: string; perHour?: number; ranges?: Readonly<Record<string, readonly string[]>> };
  /**
   * The proxies whose X-Forwarded-For is believed, as the tracker takes them (address.ts); the private networks and the
   * machine itself when none are given.
   */
  trustedProxies?: readonly string[];
  now?: () => string;
  fetchImpl?: typeof fetch;
  /**
   * The sentence a brief lacks, for the owners' turn (QX-19 section 4): the vendor the environment names when left out;
   * the tests' way in.
   */
  sentence?: Sentence | null;
  /** The environment the sentence's vendor key is read from; the process's when left out. */
  env?: NodeJS.ProcessEnv;
  /**
   * The relays a member's Quilt searches and announces on (QX-14), so a hosted search reaches past this tracker; none
   * when left out.
   */
  relays?: string[];
}

/** One owner's turn as the on-ramp ran it: whose, and what it did. */
export interface MemberTurn extends OwnerTurn {
  address: Address;
}

export interface Hosted {
  routes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  /**
   * What the tracker's well-known document says of the on-ramp: the witness it binds (QX-18), where the authorization
   * server is on.
   */
  describe(): Record<string, unknown>;
  /**
   * The owners' turn (the part of `quilt away` that needs no agent): for every member whose home holds a problem or a
   * gold, the gold due revealed and the briefs sharpened, signed with the key this tracker holds for them, each turn's
   * line written to the member's away.log. The binary runs it every hour; a member with nothing to do is passed over.
   */
  turn(): Promise<MemberTurn[]>;
}

/**
 * Who a connector session is for: the member, by the hash of their address token, and the witness its token carries, or
 * none for the bare address.
 */
interface Seat {
  member: string;
  witness: Witness | null;
}

/**
 * QX-18: the witness as the headers the tracker reads beside the custody secret; the client's own name is encoded,
 * since it is any text that passed the gate.
 */
function witnessHeaders(w: Witness | null): Record<string, string> {
  if (!w) return {};
  return {
    'x-quilt-via': w.via,
    ...(w.by ? { 'x-quilt-via-by': w.by } : {}),
    ...(w.client ? { 'x-quilt-via-client': encodeURIComponent(w.client) } : {}),
  };
}

const SESSION_IDLE_MS = 60 * 60 * 1000;

/**
 * The sheet's policy (page-policy.ts): its own script and style by hash, its reads from this tracker, and nothing else.
 */
const SHEET_POLICY = pagePolicy(SHEET_PAGE);

function encrypt(keySecret: string, plain: string): string {
  const key = createHash('sha256').update(keySecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${enc.toString('hex')}`;
}

function decrypt(keySecret: string, stored: string): string {
  const key = createHash('sha256').update(keySecret).digest();
  const [ivHex, tagHex, encHex] = stored.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex!, 'hex')), decipher.final()]).toString('utf8');
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

export function createHosted(options: HostedOptions): Hosted {
  const { store, keySecret, custodySecret } = options;
  const trackerUrl = (): string =>
    withSlash(typeof options.trackerUrl === 'function' ? options.trackerUrl() : options.trackerUrl);
  const now = options.now ?? (() => new Date().toISOString());
  // Every request a Quilt here makes, and the authorization server's, goes to this tracker as it is and, where the
  // connector is shared (QUILT_READS=public, which the binary sets), anywhere else through the guarded fetch: a
  // tracker, a mirror or a coin's home that a link or a document names, and a client's metadata document, reach
  // nothing on this machine or its networks.
  const base = options.fetchImpl ?? fetch;
  const own = (href: string): boolean => {
    try {
      const u = new URL(href);
      const door = new URL(trackerUrl());
      return u.origin === door.origin && u.pathname.startsWith(door.pathname);
    } catch {
      return false;
    }
  };
  const outward: typeof fetch = (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return !shared() || own(href) ? base(input, init) : publicFetch(input, init);
  };
  const joinsPerHour = options.joinsPerHour ?? 20;
  const readsPerHour = options.readsPerHour ?? 1200;

  // The site's reader (APP.md, "The window"): the card at /window and its read-only ops at /window/io, answered by a
  // Quilt with no key over this tracker and the relays, as a member's search sees the swarm. What it opens is kept
  // under a home of its own beside the members', which store.members() never lists. Each answer is kept twenty seconds,
  // since a site's visitors ask the same things.
  let readerQuilt: Quilt | null = null;
  const readerOf = (): Quilt => {
    if (!readerQuilt) {
      const config: Config = {
        ...DEFAULT_CONFIG,
        trackers: [trackerUrl()],
        relays: options.relays ?? [],
        can: ['web'],
      };
      readerQuilt = new Quilt(config, null, new Resolver(config, join(options.home, 'reader'), outward), 'site');
    }
    return readerQuilt;
  };
  const readerKept = new Map<string, { at: number; answer: Promise<Record<string, unknown>> }>();

  /**
   * One square for its page (square-page.ts): the version the address names, opened over the reader with no key, or,
   * where that version keeps the piece only as an earlier version's (CORE.md section 6, Envelopes), the newest version
   * of its chain that holds it, since an ancestral piece has no state where it is kept. The readings come from that
   * version's fold, the two that accepted the square and any the layer set aside marked; what each rests on from the
   * traces on the lines of the same chain (trace.ts, restsOf), with the passages of the reads kept here; and where the
   * piece stands in the newest version, following the replacements eight at most. Null where this tracker holds no
   * such problem or piece, or a maintainer hid the version the page reads.
   */
  async function squareOf(problem: Hash, piece: Hash): Promise<SquareView | null> {
    const reader = readerOf();
    type Opened = Awaited<ReturnType<Quilt['open']>>;
    const openOf = async (h: Hash): Promise<Opened | null> => {
      try {
        return await reader.open(h);
      } catch {
        return null;
      }
    };
    const opened = await openOf(problem);
    if (!opened || opened.hidden || opened.hash !== problem) return null;
    let holder: Opened | null = opened;
    if (!opened.state.byHash.has(piece)) {
      if (!opened.state.ancestral.has(piece)) return null;
      holder = null;
      for (const envelope of opened.state.chain.slice(1)) {
        const o = await openOf(problemHash(envelope));
        if (o?.state.byHash.has(piece)) {
          holder = o;
          break;
        }
      }
      if (!holder || holder.hidden) return null;
    }
    const { state, layer } = holder;
    const v = state.byHash.get(piece)!;
    const l = layer?.find((x) => x.hash === piece) ?? null;
    const st: string = l?.state ?? v.state;
    const accepting =
      (st === 'accepted' || st === 'accepted_provisional' || st === 'challenged') && v.accepting?.kind === 'agree'
        ? v.accepting
        : null;
    const aside = new Set((l?.aside ?? []).map((k) => k.toLowerCase()));
    const receipts = state.chain.flatMap((envelope) => store.lines(problemHash(envelope)));
    const restsFor = restsOf(v, receipts, (h, span) => passageIn(store.getBlob(h), span));
    const accepted = new Set(accepting ? accepting.reveals.map((r) => r.key.toLowerCase()) : []);
    const readings: SquareReading[] = v.reveals.map((r) => ({
      key: r.key,
      name: state.names.get(r.root)?.name ?? null,
      vendor: r.vendor,
      model: r.by.model,
      at: r.at,
      accepting: accepted.has(r.key.toLowerCase()),
      aside: aside.has(r.key.toLowerCase()),
      fields: Object.entries(r.return as Record<string, unknown>),
      rests: restsFor(r),
    }));
    // Where the piece stands now: from the versions that replaced the one the address names, and from that version
    // itself where it keeps the piece only as an earlier version's.
    let later: SquareNow | null = null;
    let newest: { hash: Hash; opened: Opened } | null = holder === opened ? null : { hash: problem, opened };
    for (let next = opened.superseded, hops = 0; next && hops < 8; hops++) {
      const o = await openOf(next);
      if (!o) break;
      newest = { hash: next, opened: o };
      next = o.superseded;
    }
    if (newest) {
      const stateIn = (h: Hash, core: string): string => newest!.opened.layer?.find((x) => x.hash === h)?.state ?? core;
      const same = newest.opened.state.byHash.get(piece);
      const named = same ? null : newest.opened.state.pieces.find((x) => x.piece.name === v.piece.name);
      if (same) later = { version: newest.hash, same: true, state: stateIn(piece, same.state) };
      else if (named)
        later = {
          version: newest.hash,
          same: false,
          piece: named.piece.hash,
          state: stateIn(named.piece.hash, named.state),
          brief: named.piece.brief,
        };
    }
    const env = opened.state.envelope.problem;
    return {
      url: `${trackerUrl()}r/${problem}/${piece}`,
      problem,
      holder: holder === opened ? null : holder.hash,
      title: env.title,
      owner: env.owner,
      ownerName: opened.state.names.get(env.owner as Address)?.name ?? null,
      piece,
      name: v.piece.name,
      brief: v.piece.brief,
      state: st,
      kind: kindWords(v.piece.verifier).says,
      agreed: accepting
        ? (v.piece.agree ?? []).map((field) => ({
            field,
            value: (accepting.reveals[0].return as Record<string, unknown>)[field],
          }))
        : null,
      vendors: accepting ? [...new Set(accepting.reveals.map((r) => r.vendor))] : [],
      traced: l?.traced ?? null,
      verified: l?.verified ?? false,
      readings,
      now: later,
      link: makeLink(problem, [trackerUrl()], env.slug),
      directory: `${trackerUrl()}window?reader=window/io`,
    };
  }
  function readerAnswer(op: string, input: Record<string, string>): Promise<Record<string, unknown>> {
    const key = JSON.stringify([op, input]);
    const t = Date.now();
    const had = readerKept.get(key);
    if (had && t - had.at < 20_000) return had.answer;
    if (readerKept.size > 500) readerKept.clear();
    const answer = windowAnswer(readerOf(), { op, ...input });
    readerKept.set(key, { at: t, answer });
    answer.catch(() => readerKept.delete(key));
    return answer;
  }
  mkdirSync(options.home, { recursive: true });
  const sessions = new Map<
    string,
    {
      transport: StreamableHTTPServerTransport;
      server: McpServer;
      member: string;
      witness: Witness | null;
      last: number;
    }
  >();
  const joinHtml = joinPage(options.oauth !== undefined);
  const joinPolicy = pagePolicy(joinHtml);
  /** The member a pasted address belongs to: the long address, or its last part. */
  const memberOf = (presented: string): string | null => {
    const m = /(?:^|\/mcp\/)([0-9a-f]{64})(?:\/(?:key|sheet))?\/?$/.exec(presented.trim());
    return m && store.getMember(tokenHash(m[1]!)) ? tokenHash(m[1]!) : null;
  };
  const trustedProxies = rangesOf(options.trustedProxies ?? PRIVATE_RANGES);
  const oauth: OAuthServer | null = options.oauth
    ? createOAuth({
        store,
        trackerUrl,
        now,
        memberOf,
        secret: options.oauth.secret,
        perHour: options.oauth.perHour ?? 600,
        issuer: () => options.oauth?.issuer ?? trackerUrl().replace(/\/$/, ''),
        name: options.name ?? trackerUrl(),
        bucketFor: (req) => addressHash(req),
        clientAddress: (req) => clientAddress(req, trustedProxies),
        fetchImpl: outward,
        ...(options.oauth.ranges ? { ranges: options.oauth.ranges } : {}),
      })
    : null;

  function mint(): { token: string; address: Address; url: string } {
    const token = randomBytes(32).toString('hex');
    const secret = randomSecretKey();
    const address = addressOf(secret);
    store.putMember(tokenHash(token), address, encrypt(keySecret, secretToHex(secret)), now());
    return { token, address, url: `${trackerUrl()}mcp/${token}` };
  }

  /**
   * The Quilt that signs for a member, by the hash of their address token, posting to this tracker with the custody
   * secret and the session's witness, and to any other with neither.
   */
  function quiltFor(hash: string, hostName: string | undefined, witness: Witness | null = null): Quilt | null {
    const member = store.getMember(hash);
    if (!member) return null;
    const secret = secretFromHex(decrypt(keySecret, member.keyEnc));
    const config: Config = {
      ...DEFAULT_CONFIG,
      trackers: [trackerUrl()],
      relays: options.relays ?? [],
      can: ['web'],
    };
    const home = join(options.home, hash);
    const resolver = new Resolver(config, home, outward, {
      to: trackerUrl(),
      headers: { 'x-quilt-custody': custodySecret, ...witnessHeaders(witness) },
    });
    return new Quilt(config, { secret, address: addressOf(secret) }, resolver, hostName, witness);
  }

  // QX-19 section 4, QX-16: the owners' turn. A person who runs nothing has no node to reveal their gold or sharpen
  // their briefs, so the on-ramp, which signs for them, does it for every member whose home holds a problem or a gold.
  const sentence: Sentence | null =
    options.sentence === undefined ? vendorSentence(options.env ?? process.env, base) : options.sentence;
  async function turn(): Promise<MemberTurn[]> {
    const out: MemberTurn[] = [];
    for (const hash of store.members()) {
      const q = quiltFor(hash, undefined);
      if (!q || (Object.keys(q.library.problems).length === 0 && Object.keys(q.library.gold ?? {}).length === 0))
        continue;
      const log = join(options.home, hash, AWAY_LOG);
      const t = await ownerTurn(
        q,
        sentence,
        (line) => appendFileSync(log, `${line}\n`),
        () => new Date(now()),
      );
      if (t.said) appendFileSync(log, `${now()} ${t.said}\n`);
      out.push({ address: q.identity!.address, ...t });
    }
    return out;
  }

  function sweep(): void {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, s] of sessions)
      if (s.last < cutoff) {
        sessions.delete(id);
        void s.transport.close().catch(() => undefined);
      }
  }

  async function mcp(req: IncomingMessage, res: ServerResponse, seat: Seat): Promise<void> {
    if (!store.getMember(seat.member)) {
      json(res, 404, { error: 'no such address here' });
      return;
    }
    // The funnel (counts.ts): the day this address was first used by an AI; the mark moves once and nothing else.
    store.markMemberUsed(seat.member, now());
    sweep();
    const sid = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sid) ? sid[0] : sid;
    const method = req.method ?? 'GET';
    if (sessionId && sessions.has(sessionId)) {
      const s = sessions.get(sessionId)!;
      if (s.member !== seat.member) {
        json(res, 403, { error: 'that session belongs to another address' });
        return;
      }
      s.last = Date.now();
      const body = method === 'POST' ? await readJson(req) : undefined;
      await s.transport.handleRequest(req, res, body);
      return;
    }
    if (method !== 'POST') {
      json(res, 400, { error: 'a session begins with an initialize request' });
      return;
    }
    const body = await readJson(req);
    if (!isInitializeRequest(body)) {
      json(res, 400, { error: 'no session with that id; begin with an initialize request' });
      return;
    }
    const server: McpServer = createMcpServer(
      localRunner((hostName) => {
        const q = quiltFor(seat.member, hostName, seat.witness);
        if (!q) throw new Error('this address is gone');
        return q;
      }),
      {
        // The AI that connects is recorded in the member's library, as a home's node records it: the sheet at the
        // address moves from the connecting words to the phrases.
        connected: (host) => {
          quiltFor(seat.member, host ?? undefined)?.resolver.sawConnector(host);
        },
      },
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // the callback runs inside handleRequest, after both exist
      onsessioninitialized: (id: string) => {
        sessions.set(id, { transport, server, member: seat.member, witness: seat.witness, last: Date.now() });
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  /**
   * The network address a request came from, as the rate-limit buckets of a join and of the authorization server name
   * it. It is hashed with the custody secret, which only this process knows and which changes at each start, so a
   * bucket in the store is not read back to an address and the tracker's own buckets, salted differently, say nothing
   * about it either.
   */
  function addressHash(req: IncomingMessage): string {
    return createHash('sha256')
      .update(custodySecret + clientAddress(req, trustedProxies))
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * The sheet for a hosted address, as the menu bar reads one from a home's node (`sheetOf`): the state, the first
   * phrase, the groups of phrases for what is wanted and kept, with the standing and coin the tracker computes for the
   * key and what it is owed today. Read by the sheet page at the address, and by anyone holding the address.
   */
  async function sheet(token: string): Promise<Record<string, unknown> | null> {
    const member = store.getMember(tokenHash(token));
    const q = quiltFor(tokenHash(token), undefined);
    if (!member || !q) return null;
    const connected = q.library.connector !== undefined;
    const [standing, coin, attention] = await Promise.all([
      q.standing(),
      q.coin(),
      connected ? q.attention().then((a) => a.items) : Promise.resolve([]),
    ]);
    const made = sheetOf({
      address: member.address as Address,
      // The on-ramp keeps no name for a member, so the sheet offers the phrase that chooses one.
      name: null,
      library: q.library,
      attention,
      standing: standing?.standing ?? null,
      wordsDue: false,
      claude: { installed: false, config: '', running: false },
    });
    return { ...made, url: `${trackerUrl()}mcp/${token}`, standing, coin };
  }

  async function routes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    if (oauth && (await oauth.routes(req, res, url))) return true;
    // QX-18: the connector for a token from this server, with no address in its path; without a good token, the
    // challenge that leads a client to the metadata.
    if (path === '/mcp' && oauth) {
      const b = oauth.bearer(req);
      if (b.kind !== 'granted') oauth.challenge(res, b.kind === 'refused' ? b.why : undefined);
      else await mcp(req, res, { member: b.member, witness: b.witness });
      return true;
    }
    // The page of one square (square-page.ts): public and read-only, built here with no script, under the reader's
    // hourly limit.
    const square = /^\/r\/(sha256:[0-9a-f]{64})\/(sha256:[0-9a-f]{64})$/.exec(path);
    if (square && method === 'GET') {
      const headers = {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        'cache-control': 'public, max-age=60',
      };
      if (store.hit(`window:${addressHash(req)}`, now().slice(0, 13), readsPerHour)) {
        res.writeHead(429, headers);
        res.end("<!doctype html><title>Over the limit</title><p>Over the hour's limit for reads from here.</p>");
        return true;
      }
      const view = await squareOf(square[1] as Hash, square[2] as Hash);
      res.writeHead(view ? 200 : 404, headers);
      res.end(
        view
          ? squarePage(view)
          : '<!doctype html><title>No such square</title><p>This tracker holds no such square.</p>',
      );
      return true;
    }
    // The directory window for a site (APP.md, "The window"): the card as a page, which any site may frame, since it
    // holds nothing of anyone's and reads what /search reads; and the read-only ops beside it, over the reader with no
    // key.
    if (path === '/window' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors *; base-uri 'none'",
        'cache-control': 'public, max-age=300',
      });
      res.end(WINDOW_HTML);
      return true;
    }
    if (path === '/window/io') {
      if (method !== 'GET') {
        json(res, 405, { error: 'GET' });
        return true;
      }
      const op = url.searchParams.get('op') ?? '';
      if (!(WINDOW_OPS as readonly string[]).includes(op)) {
        json(res, 404, { error: `the window's reader answers ${WINDOW_OPS.join(', ')}` });
        return true;
      }
      // A bearer token from this server's authorization server names a member (QX-18): every op is answered over that
      // member's own Quilt, as the connector would, so a site holding the token shows the person their own. Without
      // one, the read-only ops over the reader with no key; a personal op is refused with the challenge that names the
      // authorization server.
      let member: { hash: string; witness: Witness } | null = null;
      if (oauth) {
        const b = oauth.bearer(req);
        if (b.kind === 'refused') {
          oauth.challenge(res, b.why);
          return true;
        }
        if (b.kind === 'granted') member = { hash: b.member, witness: b.witness };
      }
      if (!member && !(WINDOW_READ_OPS as readonly string[]).includes(op)) {
        if (oauth) oauth.challenge(res);
        else json(res, 404, { error: `the site's reader answers ${WINDOW_READ_OPS.join(', ')}` });
        return true;
      }
      if (store.hit(`window:${addressHash(req)}`, now().slice(0, 13), readsPerHour)) {
        json(res, 429, { error: "over the hour's limit for reads from here" });
        return true;
      }
      const s = (k: string, max: number): string => (url.searchParams.get(k) ?? '').slice(0, max);
      const input = { query: s('query', 200), link: s('link', 400) };
      try {
        if (member) {
          const q = quiltFor(member.hash, member.witness.client ?? 'site', member.witness);
          if (!q) {
            json(res, 404, { error: 'no such address here' });
            return true;
          }
          json(
            res,
            200,
            await windowAnswer(q, {
              op,
              ...input,
              key: s('key', 64),
              name: s('name', 60),
              ...(url.searchParams.has('on') ? { on: url.searchParams.get('on') !== 'false' } : {}),
            }),
          );
        } else json(res, 200, await readerAnswer(op, input));
      } catch (e) {
        json(res, 400, { error: (e as Error).message });
      }
      return true;
    }
    if (path === '/join') {
      if (method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': joinPolicy });
        res.end(joinHtml);
        return true;
      }
      if (method === 'POST') {
        if (store.hit(`join:${addressHash(req)}`, now().slice(0, 13), joinsPerHour)) {
          json(res, 429, { error: "over the hour's limit for new addresses from here" });
          return true;
        }
        const made = mint();
        json(res, 201, { address: made.address, url: made.url });
        return true;
      }
    }
    let m: RegExpExecArray | null;
    if ((m = /^\/mcp\/([0-9a-f]{64})(?:\/(key|sheet))?$/.exec(path))) {
      const token = m[1]!;
      if (m[2] === 'sheet') {
        if (method !== 'GET') {
          json(res, 405, { error: 'GET' });
          return true;
        }
        const s = await sheet(token);
        if (!s) {
          json(res, 404, { error: 'no such address here' });
          return true;
        }
        json(res, 200, s);
        return true;
      }
      // A browser at the address gets the person's sheet; the AI's connector, which asks for JSON or an event stream,
      // gets the MCP transport.
      if (m[2] === undefined && method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
        if (!store.getMember(tokenHash(token))) {
          json(res, 404, { error: 'no such address here' });
          return true;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': SHEET_POLICY });
        res.end(SHEET_PAGE);
        return true;
      }
      if (m[2] === 'key') {
        if (method !== 'GET') {
          json(res, 405, { error: 'GET' });
          return true;
        }
        const member = store.getMember(tokenHash(token));
        if (!member) {
          json(res, 404, { error: 'no such address here' });
          return true;
        }
        // The funnel (counts.ts): the day the key went home.
        store.markMemberKeyTaken(tokenHash(token), now());
        json(res, 200, {
          address: member.address,
          secret: decrypt(keySecret, member.keyEnc),
          note: 'This is the key itself. Import it into Quilt with quilt init --secret or --from, and treat this address as spent.',
        });
        return true;
      }
      // The bare address is its own credential, as it always was, so a header this server did not issue changes
      // nothing; a token it did is for this address, and brings its witness.
      const b = oauth?.bearer(req) ?? { kind: 'none' as const };
      if (b.kind === 'granted' && b.member !== tokenHash(token)) {
        json(res, 403, { error: 'that token is for another address' });
        return true;
      }
      await mcp(req, res, { member: tokenHash(token), witness: b.kind === 'granted' ? b.witness : null });
      return true;
    }
    return false;
  }

  return { routes, describe: () => oauth?.describe() ?? {}, turn };
}
