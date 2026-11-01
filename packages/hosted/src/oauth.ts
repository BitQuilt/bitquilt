/**
 * The hosted on-ramp's authorization server (QX-18), as the MCP authorization spec asks of a remote connector: the
 * protected-resource metadata (RFC 9728) and the authorization-server metadata (RFC 8414) at their well-known paths,
 * dynamic client registration (RFC 7591), the authorization code with PKCE (S256 alone), and tokens issued, refreshed
 * and revoked. A member proves they hold an address by presenting it on the authorization page; the token then stands
 * for that address at the connector, `/mcp`, and its grant keeps the client and the redirect URI the code was sent to.
 * That redirect URI, held to the products' callbacks (products.ts), is the witness: nothing a client says of itself
 * decides it.
 *
 * The SDK's server-side handlers are Express routers with a limiter of their own; this server is the tracker's
 * node:http, behind a proxy, with the store's hourly buckets. So the routes are written here, and the SDK lends what
 * fits: the registration schema, the metadata and token types, the error shapes, and the resource check.
 *
 * Tokens are signed with a key from the environment and name their grant; a grant is a row, so a token stops working
 * when its grant is revoked. A refresh rotates: only the newest refresh token of a grant is good.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { checkResourceAllowed } from '@modelcontextprotocol/sdk/shared/auth-utils.js';
import { type OAuthMetadata, type OAuthProtectedResourceMetadata, type OAuthTokens, OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  AccessDeniedError, CustomOAuthError, InvalidClientError, InvalidClientMetadataError, InvalidGrantError, InvalidRequestError, InvalidTargetError, OAuthError,
  TooManyRequestsError, UnsupportedGrantTypeError, UnsupportedResponseTypeError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { textIssues } from '@bitquilt/core';
import { CLIENT_NAME_MAX, type GrantRow, type OAuthClientRow, type Store } from '@bitquilt/tracker';
import type { Witness } from 'quilt';
import { AUTHORIZE_PAGE } from './authorize-page.js';
import { productOf } from './products.js';

/** An access token lasts an hour; a refresh token ninety days, and each refresh hands out the next. */
export const ACCESS_SECONDS = 60 * 60;
export const REFRESH_SECONDS = 90 * 24 * 60 * 60;
/** An authorization code is good for five minutes and once. */
export const CODE_MS = 5 * 60 * 1000;
/** The one scope: the connector's tools, as the address gives them. */
export const SCOPE = 'quilt';
/** The most a registration, an authorization or a token request may carry. */
const BODY_MAX = 16 * 1024;
/** The most redirect URIs one client registers. */
const REDIRECTS_MAX = 10;
const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'];
const GRANT_TYPES = ['authorization_code', 'refresh_token'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface OAuthOptions {
  store: Store;
  /** The tracker's own address, with a trailing slash: the endpoints and the connector live under it. */
  trackerUrl: () => string;
  /** The issuer the metadata names; the tracker's address without its trailing slash. */
  issuer: () => string;
  /** The key tokens are signed with; from the environment, never from code. */
  secret: string;
  /** What the resource metadata calls the connector. */
  name: string;
  now: () => string;
  /** Registrations, authorizations and token requests one network address may make in an hour. */
  perHour: number;
  /** The rate-limit bucket a request counts in. */
  bucketFor: (req: IncomingMessage) => string;
  /** The member an address belongs to, by the hash of its token, from the long address or its last part as a person pastes it. */
  memberOf: (presented: string) => string | null;
}

/** What the bearer on a request is: none, one refused with the reason, or a grant with the member and the witness. */
export type Bearer =
  | { kind: 'none' }
  | { kind: 'refused'; why: string }
  | { kind: 'granted'; tokenHash: string; grant: GrantRow; witness: Witness };

export interface OAuthServer {
  /** The connector's address under this server: what the resource metadata names and a token is issued for. */
  resource(): string;
  routes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  bearer(req: IncomingMessage): Bearer;
  /** Answers 401 with the challenge that leads a client to the resource metadata, and the reason where a token was refused. */
  challenge(res: ServerResponse, why?: string): void;
}

type Params = Record<string, unknown>;
interface TokenClaims { g: string; k: 'access' | 'refresh'; n: number; e: number; j: string }
/** An authorization request that passed: the client, where the code goes, the challenge, and what was asked. */
interface AuthRequest { client: OAuthClientRow; redirectUri: string; challenge: string; state: string | null; resource: string | null }
type Checked = { ok: true; request: AuthRequest } | { ok: false; error: OAuthError; redirect: string | null };

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const str = (p: Params, k: string): string | undefined => (typeof p[k] === 'string' ? (p[k] as string) : undefined);

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...headers });
  res.end(JSON.stringify(body));
}

async function readText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > BODY_MAX) throw new InvalidRequestError('the body is over 16 KB');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** A request's parameters: a JSON object, or a form as the token endpoint is spoken to. */
async function readParams(req: IncomingMessage): Promise<Params> {
  const text = await readText(req);
  if ((req.headers['content-type'] ?? '').includes('application/json')) {
    try {
      const v = text ? (JSON.parse(text) as unknown) : {};
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Params;
    } catch {
      // said below
    }
    throw new InvalidRequestError('the body is not a JSON object');
  }
  return Object.fromEntries(new URLSearchParams(text));
}

/** Why a redirect URI cannot be registered, or null: https, http on this machine alone, or a native app's own scheme; no fragment. */
function redirectProblem(uri: string): string | null {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return 'a redirect URI is a URL';
  }
  if (u.hash) return 'a redirect URI carries no fragment';
  if (u.protocol === 'http:') return LOOPBACK.has(u.hostname) ? null : 'a redirect URI over http is on the same machine (localhost, 127.0.0.1 or [::1])';
  if (u.protocol === 'file:') return 'a redirect URI is not a file';
  return null;
}

/** A requested redirect URI against a registered one: the same string, or, on this machine's loopback, the same but for the port (RFC 8252 section 7.3). */
function redirectMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  try {
    const a = new URL(requested);
    const b = new URL(registered);
    return a.protocol === 'http:' && b.protocol === 'http:' && LOOPBACK.has(a.hostname) && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
  } catch {
    return false;
  }
}

/** The name a client gave itself, kept when it passes the plain-text gate and is short; null otherwise. Shown only as the client's quoted words. */
export function keptClientName(raw: unknown): string | null {
  const n = typeof raw === 'string' ? raw.trim() : '';
  return n && n.length <= CLIENT_NAME_MAX && textIssues(n).length === 0 ? n : null;
}

export function createOAuth(options: OAuthOptions): OAuthServer {
  const { store } = options;
  const resource = (): string => `${options.trackerUrl()}mcp`;
  const endpoint = (name: string): string => `${options.trackerUrl()}oauth/${name}`;
  const wellKnown = (kind: string, of: string): string => `/.well-known/${kind}${new URL(of).pathname.replace(/\/$/, '')}`;
  const nowMs = (): number => Date.parse(options.now());
  const nowS = (): number => Math.floor(nowMs() / 1000);
  const mac = (body: string): Buffer => createHmac('sha256', options.secret).update(`quilt-oauth-1.${body}`).digest();

  function limit(req: IncomingMessage): void {
    if (store.hit(`oauth:${options.bucketFor(req)}`, options.now().slice(0, 13), options.perHour)) throw new TooManyRequestsError('over the hour\'s limit for this authorization server from here');
  }

  function sign(claims: Omit<TokenClaims, 'j'>): string {
    const body = Buffer.from(JSON.stringify({ ...claims, j: randomBytes(9).toString('base64url') })).toString('base64url');
    return `${body}.${mac(body).toString('base64url')}`;
  }

  /** A token's claims when this server signed it, it is of the kind asked and it has not expired; null otherwise. */
  function verify(token: string | undefined, kind: TokenClaims['k']): TokenClaims | null {
    if (!token) return null;
    const dot = token.indexOf('.');
    if (dot <= 0) return null;
    const body = token.slice(0, dot);
    const got = Buffer.from(token.slice(dot + 1), 'base64url');
    const want = mac(body);
    if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
    let c: TokenClaims;
    try {
      c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims;
    } catch {
      return null;
    }
    return c.k === kind && typeof c.g === 'string' && typeof c.n === 'number' && typeof c.e === 'number' && c.e > nowS() ? c : null;
  }

  function issue(grant: string, gen: number): OAuthTokens {
    const at = nowS();
    return {
      access_token: sign({ g: grant, k: 'access', n: gen, e: at + ACCESS_SECONDS }),
      token_type: 'Bearer',
      expires_in: ACCESS_SECONDS,
      refresh_token: sign({ g: grant, k: 'refresh', n: gen, e: at + REFRESH_SECONDS }),
      scope: SCOPE,
    };
  }

  function resourceOk(r: string): boolean {
    try {
      return checkResourceAllowed({ requestedResource: r, configuredResource: resource() });
    } catch {
      return false;
    }
  }

  function errorRedirect(redirectUri: string, error: OAuthError, state: string | null): string {
    const to = new URL(redirectUri);
    to.searchParams.set('error', error.errorCode);
    to.searchParams.set('error_description', error.message);
    if (state) to.searchParams.set('state', state);
    to.searchParams.set('iss', options.issuer());
    return to.href;
  }

  /**
   * An authorization request, checked in the spec's two steps: the client and its redirect URI first, where an error is
   * said to the person since there is nowhere safe to send it; then the rest, where an error goes back to the client.
   */
  function checkAuthorization(p: Params): Checked {
    const clientId = str(p, 'client_id');
    const client = clientId ? store.getOAuthClient(clientId) : null;
    if (!client) return { ok: false, error: new InvalidClientError('no client is registered here with that client_id'), redirect: null };
    const registered = client.metadata.redirect_uris as string[];
    let redirectUri = str(p, 'redirect_uri');
    if (redirectUri === undefined) {
      if (registered.length !== 1) return { ok: false, error: new InvalidRequestError('redirect_uri is named when a client registered more than one'), redirect: null };
      redirectUri = registered[0]!;
    } else if (!registered.some((r) => redirectMatches(redirectUri!, r))) {
      return { ok: false, error: new InvalidRequestError('redirect_uri is not one this client registered'), redirect: null };
    }
    const state = str(p, 'state') ?? null;
    const back = (error: OAuthError): Checked => ({ ok: false, error, redirect: errorRedirect(redirectUri!, error, state) });
    if (str(p, 'response_type') !== 'code') return back(new UnsupportedResponseTypeError('response_type is code'));
    const challenge = str(p, 'code_challenge');
    if (str(p, 'code_challenge_method') !== 'S256') return back(new InvalidRequestError('code_challenge_method is S256: PKCE is asked of every client'));
    if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return back(new InvalidRequestError('code_challenge is the S256 hash of a verifier, 43 characters'));
    const asked = str(p, 'resource');
    if (asked !== undefined && !resourceOk(asked)) return back(new InvalidTargetError(`this server issues tokens for ${resource()}`));
    return { ok: true, request: { client, redirectUri, challenge, state, resource: asked ?? null } };
  }

  /** The client a token or revocation request authenticates as: its id from the body or a Basic header, and its secret where it registered one. */
  function authenticate(req: IncomingMessage, p: Params): OAuthClientRow {
    let id = str(p, 'client_id');
    let secret = str(p, 'client_secret');
    const basic = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (basic) {
      const pair = Buffer.from(basic[1]!, 'base64').toString('utf8');
      const colon = pair.indexOf(':');
      try {
        id = decodeURIComponent(colon < 0 ? pair : pair.slice(0, colon));
        secret = colon < 0 ? undefined : decodeURIComponent(pair.slice(colon + 1));
      } catch {
        throw new InvalidClientError('the Basic credentials are not form-encoded');
      }
    }
    if (!id) throw new InvalidClientError('client_id is given');
    const client = store.getOAuthClient(id);
    if (!client) throw new InvalidClientError('no client is registered here with that client_id');
    if (client.secretHash) {
      const a = Buffer.from(sha(secret ?? ''), 'hex');
      if (!secret || !timingSafeEqual(a, Buffer.from(client.secretHash, 'hex'))) throw new InvalidClientError('the client secret is not this client\'s');
    }
    return client;
  }

  async function register(req: IncomingMessage, res: ServerResponse): Promise<void> {
    limit(req);
    const parsed = OAuthClientMetadataSchema.safeParse(await readParams(req));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new InvalidClientMetadataError(issue ? `${issue.path.join('.') || 'metadata'}: ${issue.message}` : 'the metadata does not parse');
    }
    const m = parsed.data;
    if (m.redirect_uris.length === 0 || m.redirect_uris.length > REDIRECTS_MAX) throw new CustomOAuthError('invalid_redirect_uri', `a client registers between 1 and ${REDIRECTS_MAX} redirect URIs`);
    for (const uri of m.redirect_uris) {
      const why = redirectProblem(uri);
      if (why) throw new CustomOAuthError('invalid_redirect_uri', why);
    }
    const method = m.token_endpoint_auth_method ?? 'client_secret_basic';
    if (!AUTH_METHODS.includes(method)) throw new InvalidClientMetadataError(`token_endpoint_auth_method is one of ${AUTH_METHODS.join(', ')}`);
    if (m.grant_types?.some((g) => !GRANT_TYPES.includes(g))) throw new InvalidClientMetadataError(`grant_types are among ${GRANT_TYPES.join(' and ')}`);
    if (m.response_types?.some((t) => t !== 'code')) throw new InvalidClientMetadataError('response_types is code');
    // A name that is not plain text, or too long, is not kept: the client is registered without one.
    const name = keptClientName(m.client_name);
    const { client_name: _given, ...rest } = m;
    const metadata = { ...rest, ...(name ? { client_name: name } : {}), token_endpoint_auth_method: method, grant_types: m.grant_types ?? GRANT_TYPES, response_types: ['code'] };
    const clientId = randomUUID();
    const secret = method === 'none' ? null : randomBytes(32).toString('hex');
    store.putOAuthClient(clientId, metadata, secret ? sha(secret) : null, options.now());
    json(res, 201, { ...metadata, client_id: clientId, client_id_issued_at: nowS(), ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}) }, { 'cache-control': 'no-store' });
  }

  /** What the authorization page shows of a request: the client's own name, where the code goes, and the mark the events will carry. */
  function requestInfo(res: ServerResponse, p: Params): void {
    const c = checkAuthorization(p);
    if (!c.ok) {
      json(res, 400, { error: c.error.message }, { 'cache-control': 'no-store' });
      return;
    }
    const { client, redirectUri } = c.request;
    const product = productOf(redirectUri);
    json(res, 200, {
      client: { id: client.clientId, name: (client.metadata.client_name as string | undefined) ?? null },
      redirect: { uri: redirectUri, host: new URL(redirectUri).host, product },
      via: product ?? 'other',
      tracker: options.name,
    }, { 'cache-control': 'no-store' });
  }

  /** The person's answer on the authorization page: declined, an address that is not here, or a code sent to the client. */
  async function approve(req: IncomingMessage, res: ServerResponse): Promise<void> {
    limit(req);
    const p = await readParams(req);
    const c = checkAuthorization(p);
    if (!c.ok) {
      json(res, 400, { error: c.error.message }, { 'cache-control': 'no-store' });
      return;
    }
    const { client, redirectUri, challenge, state, resource: asked } = c.request;
    if (p.allow !== true) {
      json(res, 200, { redirect: errorRedirect(redirectUri, new AccessDeniedError('the person declined'), state) }, { 'cache-control': 'no-store' });
      return;
    }
    const member = options.memberOf(str(p, 'address') ?? '');
    if (!member) {
      json(res, 400, { error: 'That is not an address on this tracker. Paste the long address the join page gave, or its last part.' }, { 'cache-control': 'no-store' });
      return;
    }
    const code = randomBytes(32).toString('base64url');
    store.putOAuthCode(sha(code), { clientId: client.clientId, tokenHash: member, redirectUri, challenge, resource: asked, expiresAt: new Date(nowMs() + CODE_MS).toISOString() });
    const to = new URL(redirectUri);
    to.searchParams.set('code', code);
    if (state) to.searchParams.set('state', state);
    to.searchParams.set('iss', options.issuer());
    json(res, 200, { redirect: to.href }, { 'cache-control': 'no-store' });
  }

  /** A code for tokens: the client's own, once, in time, to the redirect URI it was sent to, with the verifier behind its challenge. The grant it makes carries the witness. */
  function exchangeCode(client: OAuthClientRow, p: Params): OAuthTokens {
    const code = str(p, 'code');
    const verifier = str(p, 'code_verifier');
    if (!code || !verifier) throw new InvalidRequestError('code and code_verifier are both given');
    const row = store.spendOAuthCode(sha(code), options.now());
    if (!row || row.clientId !== client.clientId) throw new InvalidGrantError('no such code for this client');
    if (row.usedAt !== null) {
      // A code used twice may have been taken on its way: the tokens the first use gave stop working.
      if (row.grantId) store.revokeGrant(row.grantId, options.now());
      throw new InvalidGrantError('the code was used already, and the tokens it gave are revoked');
    }
    if (Date.parse(row.expiresAt) <= nowMs()) throw new InvalidGrantError('the code has expired');
    const redirectUri = str(p, 'redirect_uri');
    if (redirectUri !== undefined && redirectUri !== row.redirectUri) throw new InvalidGrantError('redirect_uri is not the one the code was sent to');
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== row.challenge) throw new InvalidGrantError('code_verifier does not match the challenge');
    const asked = str(p, 'resource');
    if (asked !== undefined && !resourceOk(asked)) throw new InvalidTargetError(`this server issues tokens for ${resource()}`);
    if (!store.getMember(row.tokenHash)) throw new InvalidGrantError('the address behind the code is gone');
    // The witness (QX-18): the product whose callback the code was sent to, else other with the name the client gave.
    const product = productOf(row.redirectUri);
    const grant = {
      id: randomUUID(), tokenHash: row.tokenHash, clientId: client.clientId, redirectUri: row.redirectUri, via: product ?? 'other',
      clientName: product ? null : ((client.metadata.client_name as string | undefined) ?? null), resource: asked ?? row.resource, createdAt: options.now(),
    };
    store.putGrant(grant);
    store.setOAuthCodeGrant(sha(code), grant.id);
    return issue(grant.id, 0);
  }

  /** A refresh token for the next pair: this server's, the client's own grant, live, and the newest of its generation. */
  function refresh(client: OAuthClientRow, p: Params): OAuthTokens {
    const claims = verify(str(p, 'refresh_token'), 'refresh');
    if (!claims) throw new InvalidGrantError('the refresh token is not this server\'s, or it has expired');
    const g = store.getGrant(claims.g);
    if (!g || g.revokedAt !== null || g.clientId !== client.clientId) throw new InvalidGrantError('the grant is revoked, or another client\'s');
    if (!store.getMember(g.tokenHash)) throw new InvalidGrantError('the address behind the grant is gone');
    if (!store.rotateGrant(g.id, claims.n)) throw new InvalidGrantError('the refresh token was replaced by a newer one');
    return issue(g.id, claims.n + 1);
  }

  async function token(req: IncomingMessage, res: ServerResponse): Promise<void> {
    limit(req);
    const p = await readParams(req);
    const client = authenticate(req, p);
    const grantType = str(p, 'grant_type');
    const tokens = grantType === 'authorization_code' ? exchangeCode(client, p) : grantType === 'refresh_token' ? refresh(client, p) : null;
    if (!tokens) throw new UnsupportedGrantTypeError('this server takes authorization_code and refresh_token');
    json(res, 200, tokens, { 'cache-control': 'no-store', pragma: 'no-cache' });
  }

  /** RFC 7009: a token of this client's revokes its grant; anything else is answered the same, so nothing is learnt from the answer. */
  async function revoke(req: IncomingMessage, res: ServerResponse): Promise<void> {
    limit(req);
    const p = await readParams(req);
    const client = authenticate(req, p);
    const t = str(p, 'token');
    const claims = verify(t, 'access') ?? verify(t, 'refresh');
    const g = claims ? store.getGrant(claims.g) : null;
    if (g && g.clientId === client.clientId) store.revokeGrant(g.id, options.now());
    res.writeHead(200, { 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end();
  }

  function protectedResource(): OAuthProtectedResourceMetadata {
    return { resource: resource(), authorization_servers: [options.issuer()], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: options.name, resource_documentation: `${options.trackerUrl()}join` };
  }

  function authorizationServer(): OAuthMetadata & { authorization_response_iss_parameter_supported: boolean } {
    return {
      issuer: options.issuer(),
      authorization_endpoint: endpoint('authorize'),
      token_endpoint: endpoint('token'),
      registration_endpoint: endpoint('register'),
      revocation_endpoint: endpoint('revoke'),
      response_types_supported: ['code'],
      grant_types_supported: GRANT_TYPES,
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: AUTH_METHODS,
      revocation_endpoint_auth_methods_supported: AUTH_METHODS,
      scopes_supported: [SCOPE],
      service_documentation: `${options.trackerUrl()}join`,
      authorization_response_iss_parameter_supported: true,
    };
  }

  async function routes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    const prm = wellKnown('oauth-protected-resource', resource());
    // The connector's metadata at the root, at its own path, and at a long address's path, which names the same resource.
    if (method === 'GET' && (path === '/.well-known/oauth-protected-resource' || path === prm || (path.startsWith(`${prm}/`) && /^[0-9a-f]{64}$/.test(path.slice(prm.length + 1))))) {
      json(res, 200, protectedResource());
      return true;
    }
    if (method === 'GET' && path === wellKnown('oauth-authorization-server', options.issuer())) {
      json(res, 200, authorizationServer());
      return true;
    }
    if (!path.startsWith('/oauth/')) return false;
    res.setHeader('cache-control', 'no-store');
    try {
      if (path === '/oauth/register' && method === 'POST') await register(req, res);
      else if (path === '/oauth/token' && method === 'POST') await token(req, res);
      else if (path === '/oauth/revoke' && method === 'POST') await revoke(req, res);
      else if (path === '/oauth/authorize/request' && method === 'GET') requestInfo(res, Object.fromEntries(url.searchParams));
      else if (path === '/oauth/authorize' && method === 'POST') await approve(req, res);
      else if (path === '/oauth/authorize' && method === 'GET') {
        // A request whose client and redirect URI stand but whose rest does not goes back to the client at once; otherwise the page, which asks the request again for what to show.
        const c = checkAuthorization(Object.fromEntries(url.searchParams));
        if (!c.ok && c.redirect) {
          res.writeHead(302, { location: c.redirect });
          res.end();
          return true;
        }
        res.writeHead(c.ok ? 200 : 400, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
        });
        res.end(AUTHORIZE_PAGE);
      } else json(res, 405, { error: 'invalid_request', error_description: 'no such endpoint for that method' });
    } catch (err) {
      if (!(err instanceof OAuthError)) throw err;
      const status = err instanceof TooManyRequestsError ? 429 : err instanceof InvalidClientError ? 401 : 400;
      json(res, status, err.toResponseObject());
    }
    return true;
  }

  function bearer(req: IncomingMessage): Bearer {
    const header = req.headers.authorization;
    if (!header) return { kind: 'none' };
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m) return { kind: 'refused', why: 'the Authorization header is not a bearer token' };
    const claims = verify(m[1], 'access');
    if (!claims) return { kind: 'refused', why: 'the token is not this server\'s, or it has expired' };
    const grant = store.getGrant(claims.g);
    if (!grant || grant.revokedAt !== null) return { kind: 'refused', why: 'the token\'s grant is revoked' };
    if (!store.getMember(grant.tokenHash)) return { kind: 'refused', why: 'the address behind the token is gone' };
    return { kind: 'granted', tokenHash: grant.tokenHash, grant, witness: { via: grant.via, client: grant.clientName } };
  }

  function challenge(res: ServerResponse, why?: string): void {
    const metadata = new URL(wellKnown('oauth-protected-resource', resource()), options.trackerUrl()).href;
    const params = [...(why ? ['error="invalid_token"', `error_description="${why.replace(/["\\]/g, '')}"`] : []), `scope="${SCOPE}"`, `resource_metadata="${metadata}"`];
    json(res, 401, why ? { error: 'invalid_token', error_description: why } : { error: 'unauthorized', error_description: 'this connector takes a bearer token from this tracker\'s authorization server' }, {
      'www-authenticate': `Bearer ${params.join(', ')}`,
      'access-control-expose-headers': 'WWW-Authenticate',
    });
  }

  return { resource, routes, bearer, challenge };
}
