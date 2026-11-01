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
import { type Address, addressOf, randomSecretKey, secretFromHex, secretToHex, withSlash } from '@bitquilt/core';
import { PRIVATE_RANGES, type Store, clientAddress, rangesOf } from '@bitquilt/tracker';
import { type Config, DEFAULT_CONFIG, Quilt, Resolver, type Witness, createMcpServer, localRunner, sheetOf } from 'quilt';
import { joinPage } from './join-page.js';
import { type OAuthServer, createOAuth } from './oauth.js';
import { SHEET_PAGE } from './sheet-page.js';

export interface HostedOptions {
  store: Store;
  /** The tracker's own address, which the connector posts to and which addresses are made from; a function when it is known only once the tracker listens. */
  trackerUrl: string | (() => string);
  /** The secret the keys are encrypted with at rest; from the environment, never from code. */
  keySecret: string;
  /** A folder for each member's cache, library and queue. */
  home: string;
  /** The secret the tracker recognises as its own connector's, so it marks custody. */
  custodySecret: string;
  /** How many addresses one network address may be handed in an hour (20). */
  joinsPerHour?: number;
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
  /** The proxies whose X-Forwarded-For is believed, as the tracker takes them (address.ts); the private networks and the machine itself when none are given. */
  trustedProxies?: readonly string[];
  now?: () => string;
  fetchImpl?: typeof fetch;
}

export interface Hosted {
  routes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  /** What the tracker's well-known document says of the on-ramp: the witness it binds (QX-18), where the authorization server is on. */
  describe(): Record<string, unknown>;
  join(): { token: string; address: Address; url: string };
  sessions(): number;
}

/** Who a connector session is for: the member, by the hash of their address token, and the witness its token carries, or none for the bare address. */
interface Seat { member: string; witness: Witness | null }

/** QX-18: the witness as the headers the tracker reads beside the custody secret; the client's own name is encoded, since it is any text that passed the gate. */
function witnessHeaders(w: Witness | null): Record<string, string> {
  if (!w) return {};
  return { 'x-quilt-via': w.via, ...(w.by ? { 'x-quilt-via-by': w.by } : {}), ...(w.client ? { 'x-quilt-via-client': encodeURIComponent(w.client) } : {}) };
}

const SESSION_IDLE_MS = 60 * 60 * 1000;

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
  const trackerUrl = (): string => withSlash(typeof options.trackerUrl === 'function' ? options.trackerUrl() : options.trackerUrl);
  const now = options.now ?? (() => new Date().toISOString());
  const joinsPerHour = options.joinsPerHour ?? 20;
  mkdirSync(options.home, { recursive: true });
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; member: string; witness: Witness | null; last: number }>();
  const joinHtml = joinPage(options.oauth !== undefined);
  /** The member a pasted address belongs to: the long address, or its last part. */
  const memberOf = (presented: string): string | null => {
    const m = /(?:^|\/mcp\/)([0-9a-f]{64})(?:\/(?:key|sheet))?\/?$/.exec(presented.trim());
    return m && store.getMember(tokenHash(m[1]!)) ? tokenHash(m[1]!) : null;
  };
  const trustedProxies = rangesOf(options.trustedProxies ?? PRIVATE_RANGES);
  const oauth: OAuthServer | null = options.oauth
    ? createOAuth({
      store, trackerUrl, now, memberOf, secret: options.oauth.secret, perHour: options.oauth.perHour ?? 600,
      issuer: () => options.oauth?.issuer ?? trackerUrl().replace(/\/$/, ''),
      name: options.name ?? trackerUrl(),
      bucketFor: (req) => addressHash(req),
      clientAddress: (req) => clientAddress(req, trustedProxies),
      fetchImpl: options.fetchImpl ?? fetch,
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

  /** The Quilt that signs for a member, by the hash of their address token, posting with the custody secret and the session's witness. */
  function quiltFor(hash: string, hostName: string | undefined, witness: Witness | null = null): Quilt | null {
    const member = store.getMember(hash);
    if (!member) return null;
    const secret = secretFromHex(decrypt(keySecret, member.keyEnc));
    const config: Config = { ...DEFAULT_CONFIG, trackers: [trackerUrl()], can: ['web'], ...(member.name ? { name: member.name } : {}) };
    const home = join(options.home, hash);
    const resolver = new Resolver(config, home, options.fetchImpl ?? fetch, { 'x-quilt-custody': custodySecret, ...witnessHeaders(witness) });
    return new Quilt(config, { secret, address: addressOf(secret) }, resolver, hostName, witness);
  }

  function sweep(): void {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, s] of sessions) if (s.last < cutoff) {
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
    const server: McpServer = createMcpServer(localRunner((hostName) => {
      const q = quiltFor(seat.member, hostName, seat.witness);
      if (!q) throw new Error('this address is gone');
      return q;
    }), {
      // The AI that connects is recorded in the member's library, as a home's node records it: the sheet at the address moves from the connecting words to the phrases.
      connected: (host) => { quiltFor(seat.member, host ?? undefined)?.resolver.sawConnector(host); },
    });
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
    return createHash('sha256').update(custodySecret + clientAddress(req, trustedProxies)).digest('hex').slice(0, 16);
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
    const [standing, coin, attention] = await Promise.all([q.standing(), q.coin(), connected ? q.attention().then((a) => a.items) : Promise.resolve([])]);
    const made = sheetOf({ address: member.address as Address, name: member.name, library: q.library, attention, standing: standing?.standing ?? null, wordsDue: false, claude: { installed: false, config: '', running: false } });
    return { ...made, url: `${trackerUrl()}mcp/${token}`, standing, coin };
  }

  async function routes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    if (oauth && (await oauth.routes(req, res, url))) return true;
    // QX-18: the connector for a token from this server, with no address in its path; without a good token, the challenge that leads a client to the metadata.
    if (path === '/mcp' && oauth) {
      const b = oauth.bearer(req);
      if (b.kind !== 'granted') oauth.challenge(res, b.kind === 'refused' ? b.why : undefined);
      else await mcp(req, res, { member: b.tokenHash, witness: b.witness });
      return true;
    }
    if (path === '/join') {
      if (method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(joinHtml);
        return true;
      }
      if (method === 'POST') {
        if (store.hit(`join:${addressHash(req)}`, now().slice(0, 13), joinsPerHour)) {
          json(res, 429, { error: 'over the hour\'s limit for new addresses from here' });
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
      // A browser at the address gets the person's sheet; the AI's connector, which asks for JSON or an event stream, gets the MCP transport.
      if (m[2] === undefined && method === 'GET' && (req.headers.accept ?? '').includes('text/html')) {
        if (!store.getMember(tokenHash(token))) {
          json(res, 404, { error: 'no such address here' });
          return true;
        }
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
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
        json(res, 200, { address: member.address, secret: decrypt(keySecret, member.keyEnc), note: 'This is the key itself. Import it into Quilt with quilt init --secret or --from, and treat this address as spent.' });
        return true;
      }
      // The bare address is its own credential, as it always was, so a header this server did not issue changes nothing; a token it did is for this address, and brings its witness.
      const b = oauth?.bearer(req) ?? { kind: 'none' as const };
      if (b.kind === 'granted' && b.tokenHash !== tokenHash(token)) {
        json(res, 403, { error: 'that token is for another address' });
        return true;
      }
      await mcp(req, res, { member: tokenHash(token), witness: b.kind === 'granted' ? b.witness : null });
      return true;
    }
    return false;
  }

  return { routes, describe: () => oauth?.describe() ?? {}, join: mint, sessions: () => sessions.size };
}
