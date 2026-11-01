import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign as signBytes, type KeyObject } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { type AddClientAuthentication, type OAuthClientProvider, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type OAuthClientInformationMixed, type OAuthClientMetadata, type OAuthTokens, OAuthMetadataSchema, OAuthProtectedResourceMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { type Hash, type Receipt } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { DEFAULT_CONFIG, Quilt, Resolver, createKey, loadKey, type Pattern } from 'quilt';
import { ASSERTION_TYPE } from '../src/cimd.js';
import { createHosted } from '../src/hosted.js';
import { PRODUCT_CALLBACKS, onProductOrigin, productOf } from '../src/products.js';

/**
 * QX-18, the product as witness, on the hosted on-ramp. The metadata at the well-known paths the MCP authorization spec
 * names, read with the SDK's own schemas, with the document and key methods advertised, and the challenge at the
 * connector; the well-known document saying what the tracker binds. The callback allow-list: each product's redirect
 * URIs, the near misses that are no product's, and the origins. Registration and what it refuses.
 *
 * claude.ai's flow walked end to end by the SDK's own OAuth client, as claude.ai walks it against a server that
 * advertises documents: identified by a document on claude.ai's origin, the person's part done on the authorization
 * page, the code exchanged from an address in the range Anthropic publishes, a session opened with the bearer token, a
 * piece returned, and the reveal's receipt read marked via: claude.ai and via_by: address, with the state, quilt_me
 * and quilt_read saying so. ChatGPT's flow the same way, by its document and a token request signed with the key the
 * document publishes, from an address that binds nothing: via: chatgpt.com and via_by: key.
 *
 * The attack the binding is for: a code sent to a product's callback and lifted from the browser is refused when
 * redeemed by anyone else, whether they registered a client of their own, or borrowed the product's document, or
 * serve a document of their own naming the product's callback. A grant through a product refreshes only as the
 * product does; an older refresh token presented again revokes the grant; a request through a product's callback
 * names the resource. A client with a callback of its own walks to via: other and its name, quoted, and can revoke.
 * The code refused when the verifier, the redirect URI or the client is wrong, when it has expired, and when it is
 * used twice; a signed assertion refused when its key, audience or id is wrong; a document refused when its client_id
 * is not its URL, when it lives on a loopback host, or when its keys are elsewhere. The bare address works beside a
 * token, and a token for one address is refused at another's.
 */
let server: Server;
let base: string;
let problem: Hash;
const skew = { ms: 0 };
const store = new Store(':memory:');
const custodySecret = randomBytes(16).toString('hex');
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const CHATGPT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const AGENT = 'https://agent.example/callback';
/** An address inside the range Anthropic publishes for its servers, and one outside every product's. */
const ANTHROPIC = '160.79.104.10';
const ELSEWHERE = '203.0.113.9';
/** ChatGPT's document, as it is published; the hosted claude.ai document, whose address Anthropic does not publish, so a path on claude.ai's origin stands for it here. */
const CHATGPT_DOC = 'https://chatgpt.com/oauth/client.json';
const CHATGPT_JWKS = 'https://chatgpt.com/oauth/jwks.json';
const CLAUDE_DOC = 'https://claude.ai/oauth/test-client-metadata';
const KID = 'cimd-test';

const { publicKey: chatgptPublic, privateKey: chatgptPrivate } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const { privateKey: strangerPrivate } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const chatgptJwk = { ...chatgptPublic.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' };

/** The documents the on-ramp may read, served from memory; everything else goes to the network, since the tracker is real. */
const documents: Record<string, Record<string, unknown>> = {
  [CHATGPT_DOC]: {
    client_id: CHATGPT_DOC, client_name: 'ChatGPT', client_uri: 'https://chatgpt.com/', redirect_uris: [CHATGPT], token_endpoint_auth_method: 'private_key_jwt',
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'], token_endpoint_auth_signing_alg: 'RS256', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], jwks_uri: CHATGPT_JWKS,
  },
  [CHATGPT_JWKS]: { keys: [chatgptJwk] },
  [CLAUDE_DOC]: { client_id: CLAUDE_DOC, client_name: 'Claude', client_uri: 'https://claude.ai', redirect_uris: [CLAUDE], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
  // Documents of the wrong shape: one whose client_id is not its URL, one borrowing another host's keys, and one of a stranger's naming claude.ai's callback.
  'https://agent.example/client.json': { client_id: 'https://agent.example/other.json', client_name: 'Agent', redirect_uris: [AGENT], token_endpoint_auth_method: 'none' },
  'https://mirror.example/chatgpt.json': { client_id: 'https://mirror.example/chatgpt.json', client_name: 'ChatGPT', redirect_uris: [CHATGPT], token_endpoint_auth_method: 'private_key_jwt', jwks_uri: CHATGPT_JWKS },
  'https://evil.example/claude.json': { client_id: 'https://evil.example/claude.json', client_name: 'Claude', redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' },
};
const testFetch: typeof fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const doc = documents[url];
  if (doc) return Promise.resolve(new Response(JSON.stringify(doc), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' } }));
  return fetch(input, init);
};

/** A fetch that comes from an address: what a product's backend looks like to the tracker behind its proxy. */
const fromAddress = (ip: string): typeof fetch => (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('x-forwarded-for', ip);
  return fetch(input, { ...init, headers });
};

const pkce = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const form = (path: string, body: Record<string, string>, ip?: string): Promise<Response> => (ip ? fromAddress(ip) : fetch)(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
const postJson = (path: string, body: unknown): Promise<Response> => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const join_ = async (): Promise<{ url: string; address: string }> => (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { url: string; address: string };
const receiptsOf = async (address: string): Promise<Receipt[]> => (await (await fetch(`${base}p/${problem}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as Receipt).filter((l) => l.event.key === address);
const errorOf = async (r: Response): Promise<string> => ((await r.clone().json()) as { error: string }).error;
const descriptionOf = async (r: Response): Promise<string> => ((await r.clone().json()) as { error_description: string }).error_description;
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');

/** A client assertion as RFC 7523 shapes it, signed with a key and naming the client and the audience. */
function assertion(key: KeyObject, clientId: string, aud: string, over: Record<string, unknown> = {}, kid = KID): string {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64({ iss: clientId, sub: clientId, aud, jti: randomUUID(), iat: now, exp: now + 60, ...over });
  return `${head}.${body}.${signBytes('sha256', Buffer.from(`${head}.${body}`), key).toString('base64url')}`;
}

/** The person's part, as a browser does it: the page, what it reads of the request, and the answer with the address; the code where the redirect lands. */
async function person(authorization: URL, address: string, expect_: { name: string | null; product: string | null; host?: string | null }): Promise<{ code: string; state: string | null; iss: string | null; landed: string }> {
  const page = await fetch(authorization, { headers: { accept: 'text/html' } });
  expect(page.status).toBe(200);
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  const html = await page.text();
  expect(html).toContain('Let a client use your Quilt');
  expect(html).not.toMatch(/(src|href)="https?:/);
  const info = (await (await fetch(`${base}oauth/authorize/request${authorization.search}`)).json()) as { client: { name: string | null; host: string | null }; redirect: { product: string | null }; via: string };
  expect(info.client.name).toBe(expect_.name);
  expect(info.redirect.product).toBe(expect_.product);
  expect(info.via).toBe(expect_.product ?? 'other');
  if (expect_.host !== undefined) expect(info.client.host).toBe(expect_.host);
  const params = Object.fromEntries(authorization.searchParams);
  expect((await postJson('oauth/authorize', { ...params, allow: true, address: 'f'.repeat(64) })).status).toBe(400);
  const r = (await (await postJson('oauth/authorize', { ...params, allow: true, address })).json()) as { redirect: string };
  const landed = new URL(r.redirect);
  return { code: landed.searchParams.get('code')!, state: landed.searchParams.get('state'), iss: landed.searchParams.get('iss'), landed: `${landed.origin}${landed.pathname}` };
}

/** A product's backend as the SDK's OAuth client plays it: identified by its document, sending the person to the page and keeping what the server hands it. */
class Product implements OAuthClientProvider {
  info: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = '';
  code: string | null = null;
  landed: { state: string | null; iss: string | null; at: string } | null = null;
  readonly clientMetadata: OAuthClientMetadata;
  /** Set for a product that signs its token requests; absent, the SDK sends the request as a public client. */
  addClientAuthentication?: AddClientAuthentication;
  constructor(readonly clientMetadataUrl: string, readonly redirectUrl: string, private readonly name: string, private readonly product: string, private readonly address: string, signing?: AddClientAuthentication) {
    this.clientMetadata = { client_name: name, redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
    if (signing) this.addClientAuthentication = signing;
  }
  state(): string { return `${this.product}-state`; }
  clientInformation(): OAuthClientInformationMixed | undefined { return this.info; }
  saveClientInformation(i: OAuthClientInformationMixed): void { this.info = i; }
  tokens(): OAuthTokens | undefined { return this.saved; }
  saveTokens(t: OAuthTokens): void { this.saved = t; }
  saveCodeVerifier(v: string): void { this.verifier = v; }
  codeVerifier(): string { return this.verifier; }
  async redirectToAuthorization(url: URL): Promise<void> {
    const r = await person(url, this.address, { name: this.name, product: this.product, host: new URL(this.clientMetadataUrl).host });
    this.code = r.code;
    this.landed = { state: r.state, iss: r.iss, at: r.landed };
  }
}

/** The two steps the SDK client takes: the first connection ends at the page, the code finishes it; then a session. */
async function connectThrough(provider: Product, fetchFn: typeof fetch): Promise<Client> {
  const url = new URL(`${base}mcp`);
  await expect(new Client({ name: provider.clientMetadata.client_name!, version: '1.0' }).connect(new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: fetchFn }))).rejects.toBeInstanceOf(UnauthorizedError);
  await new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: fetchFn }).finishAuth(provider.code!);
  const client = new Client({ name: provider.clientMetadata.client_name!, version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider, fetch: fetchFn }));
  return client;
}

const meText = async (client: Client): Promise<{ text: string; handles: Record<string, unknown> }> => (await client.callTool({ name: 'quilt_me', arguments: {} })).structuredContent as { text: string; handles: Record<string, unknown> };
/** A return on the piece named, or on the one `next` hands out; a return needs no claim first. */
async function returnPiece(client: Client, piece?: string): Promise<string> {
  if (!piece) {
    const next = await client.callTool({ name: 'quilt_next', arguments: { problem } });
    piece = (next.structuredContent as { handles: { piece: string } }).handles.piece;
  }
  await client.callTool({ name: 'quilt_return', arguments: { problem, piece, return: { verdict: 'supports' } } });
  return piece;
}
/** The square claude.ai returned first, which ChatGPT then seconds: the one square with two witnesses. */
const shared = { piece: '' };

beforeAll(async () => {
  const hosted = createHosted({
    store, trackerUrl: () => base, keySecret: 'test-secret', home: mkdtempSync(join(tmpdir(), 'hosted-oauth-')), custodySecret, name: 'Test tracker', fetchImpl: testFetch,
    now: () => new Date(Date.now() + skew.ms).toISOString(), oauth: { secret: 'oauth-test-secret' },
  });
  const tracker = createTracker({ store, url: 'http://t.test/', ipSalt: 's', custodySecret, extra: hosted.routes, extraWellKnown: hosted.describe, limits: { keyPerHour: 1000, ipPerHour: 10000 } });
  server = await tracker.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '';
  const ownerHome = mkdtempSync(join(tmpdir(), 'owner-'));
  createKey(ownerHome, { secretHex: '00'.repeat(31) + '0a' });
  const config = { ...DEFAULT_CONFIG, trackers: [base] };
  const owner = new Quilt(config, loadKey(ownerHome), new Resolver(config, ownerHome), 'Claude Code');
  const pattern: Pattern = { title: 'Witnessed', done_when: 'Done.', slug: 'witnessed', pieces: { 'cite/*': { count: 2, verifier: 'agree', requires: ['web'], brief: 'Citation {n}: {cite.s}', data: { cite: 'cites' }, schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } } } }, data: { cites: [{ s: 'one' }, { s: 'two' }] } };
  problem = (await owner.publish(pattern)).hash;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the callback allow-list', () => {
  it('knows claude.ai\'s and claude.com\'s callback as claude.ai, and chatgpt.com\'s stable and per-connector callbacks as chatgpt.com', () => {
    expect(productOf('https://claude.ai/api/mcp/auth_callback')).toBe('claude.ai');
    expect(productOf('https://claude.com/api/mcp/auth_callback')).toBe('claude.ai');
    expect(productOf('https://chatgpt.com/connector_platform_oauth_redirect')).toBe('chatgpt.com');
    expect(productOf('https://chatgpt.com/connector/oauth/abc_DEF-123')).toBe('chatgpt.com');
    expect(PRODUCT_CALLBACKS.map((c) => c.product)).toEqual(['claude.ai', 'claude.ai', 'chatgpt.com', 'chatgpt.com']);
  });
  it('knows nothing that only looks like one', () => {
    for (const near of [
      'http://claude.ai/api/mcp/auth_callback', 'https://claude.ai/api/mcp/auth_callback/', 'https://claude.ai/api/mcp/auth_callback?next=x', 'https://claude.ai/api/mcp/auth_callback#x',
      'https://claude.ai.evil.example/api/mcp/auth_callback', 'https://evil.example/api/mcp/auth_callback', 'https://user@claude.ai/api/mcp/auth_callback', 'https://claude.ai:443/api/mcp/auth_callback',
      'https://CLAUDE.AI/api/mcp/auth_callback', 'https://evil.example/?https://claude.ai/api/mcp/auth_callback', 'https://chatgpt.com/connector/oauth/', 'https://chatgpt.com/connector/oauth/a/b',
      'https://chatgpt.com/connector/oauth/a?x=1', 'https://chatgpt.com/connector/oauth/../oauth_redirect', 'https://chat.openai.com/connector_platform_oauth_redirect', AGENT,
    ]) expect(productOf(near), near).toBeNull();
  });
  it('knows each product\'s own origins for its document and keys', () => {
    expect(onProductOrigin('chatgpt.com', CHATGPT_DOC)).toBe(true);
    expect(onProductOrigin('claude.ai', CLAUDE_DOC)).toBe(true);
    expect(onProductOrigin('claude.ai', 'https://claude.com/oauth/x')).toBe(true);
    expect(onProductOrigin('chatgpt.com', 'https://mirror.example/chatgpt.json')).toBe(false);
    expect(onProductOrigin('chatgpt.com', 'https://chatgpt.com.evil.example/oauth/client.json')).toBe(false);
    expect(onProductOrigin('chatgpt.com', 'not a url')).toBe(false);
  });
});

describe('the authorization server\'s doors', () => {
  it('serves the metadata, advertising documents and signed requests, says at the well-known document what it binds, and challenges a connection with no token', async () => {
    const issuer = base.replace(/\/$/, '');
    for (const path of ['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp']) {
      const prm = OAuthProtectedResourceMetadataSchema.parse(await (await fetch(`${base}${path}`)).json());
      expect(prm.resource).toBe(`${base}mcp`);
      expect(prm.authorization_servers).toEqual([issuer]);
    }
    const as = OAuthMetadataSchema.parse(await (await fetch(`${base}.well-known/oauth-authorization-server`)).json());
    expect(as).toMatchObject({
      issuer, authorization_endpoint: `${base}oauth/authorize`, token_endpoint: `${base}oauth/token`, registration_endpoint: `${base}oauth/register`,
      code_challenge_methods_supported: ['S256'], response_types_supported: ['code'], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true,
      token_endpoint_auth_signing_alg_values_supported: ['RS256', 'PS256', 'ES256'],
    });
    expect(as.token_endpoint_auth_methods_supported).toEqual(expect.arrayContaining(['none', 'private_key_jwt']));
    const wk = (await (await fetch(`${base}.well-known/quilt`)).json()) as { hosted: boolean; witness: { extension: string; connector: string; products: Record<string, { callbacks: string[]; bound_by: string[] }> } };
    expect(wk.hosted).toBe(true);
    expect(wk.witness.extension).toBe('QX-18');
    expect(wk.witness.connector).toBe(`${base}mcp`);
    expect(wk.witness.products['claude.ai']).toEqual({ callbacks: ['https://claude.ai/api/mcp/auth_callback', 'https://claude.com/api/mcp/auth_callback'], bound_by: ['key', 'address'] });
    expect(wk.witness.products['chatgpt.com']!.bound_by).toEqual(['key']);
    expect(wk.witness.products['chatgpt.com']!.callbacks[0]).toBe(CHATGPT);
    const r = await fetch(`${base}mcp`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain(`resource_metadata="${base}.well-known/oauth-protected-resource/mcp"`);
    const bad = await fetch(`${base}mcp`, { method: 'POST', headers: { authorization: 'Bearer forged.token' } });
    expect(bad.status).toBe(401);
    expect(bad.headers.get('www-authenticate')).toContain('error="invalid_token"');
  });
  it('registers a client, keeping a name that passes the gate and dropping one that does not, and refuses what OAuth 2.1 does not allow', async () => {
    const ok = await postJson('oauth/register', { client_name: 'Acme Agent', redirect_uris: [AGENT] });
    expect(ok.status).toBe(201);
    const c = (await ok.json()) as { client_id: string; client_secret?: string; client_name?: string; token_endpoint_auth_method: string };
    expect(c.client_name).toBe('Acme Agent');
    expect(c.token_endpoint_auth_method).toBe('client_secret_basic');
    expect(c.client_secret).toMatch(/^[0-9a-f]{64}$/);
    const linked = (await (await postJson('oauth/register', { client_name: 'Visit https://evil.example today', redirect_uris: [AGENT], token_endpoint_auth_method: 'none' })).json()) as { client_name?: string; client_secret?: string };
    expect(linked.client_name).toBeUndefined();
    expect(linked.client_secret).toBeUndefined();
    const refusals: [unknown, string][] = [
      [{ redirect_uris: [] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['http://agent.example/callback'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['https://agent.example/callback#here'] }, 'invalid_redirect_uri'],
      [{ redirect_uris: ['javascript:alert(1)'] }, 'invalid_client_metadata'],
      // A client that signs its requests publishes a document; a registration cannot carry a key.
      [{ redirect_uris: [AGENT], token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
      [{ redirect_uris: [AGENT], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
      [{ client_name: 'no redirect' }, 'invalid_client_metadata'],
    ];
    for (const [body, error] of refusals) {
      const r = await postJson('oauth/register', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(r), JSON.stringify(body)).toBe(error);
    }
    // A loopback redirect for a client on the person's own machine, the port free.
    expect((await postJson('oauth/register', { redirect_uris: ['http://127.0.0.1:33418/callback'], token_endpoint_auth_method: 'none' })).status).toBe(201);
  });
  it('says on the join page, in one paragraph, what the witness is and is not', async () => {
    const html = await (await fetch(`${base}join`)).text();
    expect(html).toContain('<h2>The witness</h2>');
    for (const words of ['via: claude.ai', 'says the product made the calls, not who wrote the answer', 'A connector on your own machine has no witness', 'It is the tracker\'s word, as custody is.']) expect(html).toContain(words);
    expect(html).not.toMatch(/(src|href)="https?:/);
  });
});

describe('claude.ai\'s flow, end to end', () => {
  let member: { url: string; address: string };
  let provider: Product;
  const anthropic = fromAddress(ANTHROPIC);
  it('identifies itself by a document on claude.ai\'s origin, authorizes with PKCE, exchanges the code from Anthropic\'s published range, returns a piece, and the reveal says via: claude.ai, bound by address', async () => {
    member = await join_();
    provider = new Product(CLAUDE_DOC, CLAUDE, 'Claude', 'claude.ai', member.url);
    const client = await connectThrough(provider, anthropic);
    expect(provider.landed).toEqual({ state: 'claude.ai-state', iss: base.replace(/\/$/, ''), at: CLAUDE });
    // No registration happened: the client is the document.
    expect((provider.info as { client_id: string }).client_id).toBe(CLAUDE_DOC);
    expect(provider.saved).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'quilt' });
    const [grant] = store.grantsOf(createHash('sha256').update(member.url.slice(-64)).digest('hex'));
    expect(grant).toMatchObject({ redirectUri: CLAUDE, via: 'claude.ai', viaBy: 'address', clientName: null, clientId: CLAUDE_DOC, resource: `${base}mcp` });
    const me = await meText(client);
    expect(me.text).toContain(`Address: ${member.address}`);
    expect(me.text).toContain('Witnessed by claude.ai');
    expect(me.text).toContain('came from the addresses claude.ai publishes');
    expect(me.handles.witness).toBe('claude.ai');
    const piece = await returnPiece(client);
    shared.piece = piece;
    const mine = await receiptsOf(member.address);
    expect(mine.map((l) => l.event.type)).toEqual(['claim', 'commit', 'reveal']);
    for (const l of mine) expect(l.received[0]).toMatchObject({ custody: 'hosted', seat: 'ai', via: 'claude.ai', via_by: 'address' });
    const state = (await (await fetch(`${base}p/${problem}/state`)).json()) as { pieces: { hash: string; witnessed: unknown[] }[] };
    expect(state.pieces.find((p) => p.hash === piece)!.witnessed).toEqual([{ key: member.address, via: 'claude.ai', via_by: 'address' }]);
    await client.close();
  });

  it('takes the token at the member\'s own long address and refuses it at another\'s, and the bare address goes on as it was', async () => {
    const bearer = { headers: { authorization: `Bearer ${provider.saved!.access_token}` } };
    const own = new Client({ name: 'claude-ai', version: '1.0' });
    await own.connect(new StreamableHTTPClientTransport(new URL(member.url), { requestInit: bearer }));
    expect((await meText(own)).text).toContain('Witnessed by claude.ai');
    await own.close();
    const other = await join_();
    const r = await fetch(other.url, { method: 'POST', headers: { ...bearer.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) });
    expect(r.status).toBe(403);
    for (const requestInit of [undefined, { headers: { authorization: 'Bearer not-from-here' } }]) {
      const bare = new Client({ name: 'claude-ai', version: '1.0' });
      await bare.connect(new StreamableHTTPClientTransport(new URL(other.url), requestInit ? { requestInit } : {}));
      expect((await meText(bare)).text).not.toContain('Witnessed');
      await bare.close();
    }
  });

  it('refreshes only from Anthropic\'s range, rotating; an older refresh token presented again revokes the grant', async () => {
    const old = provider.saved!.refresh_token!;
    for (const ip of [undefined, ELSEWHERE]) {
      const outside = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: old, client_id: CLAUDE_DOC }, ip);
      expect(outside.status).toBe(400);
      expect(await errorOf(outside)).toBe('invalid_grant');
      expect(await descriptionOf(outside)).toContain('redeemed by claude.ai');
    }
    const r = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: old, client_id: CLAUDE_DOC }, ANTHROPIC);
    expect(r.status).toBe(200);
    const fresh = (await r.json()) as OAuthTokens;
    expect((await fetch(`${base}mcp`, { method: 'POST', headers: { authorization: `Bearer ${fresh.access_token}` } })).status).not.toBe(401);
    const again = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: old, client_id: CLAUDE_DOC }, ANTHROPIC);
    expect(await errorOf(again)).toBe('invalid_grant');
    expect(await descriptionOf(again)).toContain('revoked');
    const dead = await fetch(`${base}mcp`, { method: 'POST', headers: { authorization: `Bearer ${fresh.access_token}` } });
    expect(dead.status).toBe(401);
    expect(dead.headers.get('www-authenticate')).toContain('revoked');
  });
});

describe('ChatGPT\'s flow, end to end', () => {
  let member: { url: string; address: string };
  let provider: Product;
  const signing: AddClientAuthentication = (_headers, params, url) => {
    params.set('client_assertion_type', ASSERTION_TYPE);
    params.set('client_assertion', assertion(chatgptPrivate, CHATGPT_DOC, String(url)));
  };
  it('identifies itself by its document, signs the token request with the key the document publishes, and the reveal says via: chatgpt.com, bound by key', async () => {
    member = await join_();
    provider = new Product(CHATGPT_DOC, CHATGPT, 'ChatGPT', 'chatgpt.com', member.url, signing);
    const client = await connectThrough(provider, fetch);
    expect(provider.landed).toEqual({ state: 'chatgpt.com-state', iss: base.replace(/\/$/, ''), at: CHATGPT });
    const [grant] = store.grantsOf(createHash('sha256').update(member.url.slice(-64)).digest('hex'));
    expect(grant).toMatchObject({ redirectUri: CHATGPT, via: 'chatgpt.com', viaBy: 'key', clientName: null, clientId: CHATGPT_DOC });
    const me = await meText(client);
    expect(me.text).toContain('Witnessed by chatgpt.com');
    expect(me.text).toContain('signed with the key chatgpt.com publishes');
    // The second vendor on the piece claude.ai returned, so the square is accepted and quilt_read names both witnesses; then the open piece, for the next client to second.
    await returnPiece(client, shared.piece);
    await returnPiece(client);
    for (const l of await receiptsOf(member.address)) expect(l.received[0]).toMatchObject({ custody: 'hosted', via: 'chatgpt.com', via_by: 'key' });
    const read = (await client.callTool({ name: 'quilt_read', arguments: { problem } })).structuredContent as { text: string };
    expect(read.text).toContain('(witnessed by claude.ai) returned: {"verdict":"supports"}');
    expect(read.text).toContain('(witnessed by chatgpt.com) returned: {"verdict":"supports"}');
    expect(read.text).toContain('A witness is the tracker\'s word (QX-18)');
    await client.close();
  });

  it('refreshes with a signed request and not without one, and refuses an assertion by the wrong key, for the wrong audience, or presented twice', async () => {
    const refresh = provider.saved!.refresh_token!;
    const unsigned = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: refresh, client_id: CHATGPT_DOC });
    expect(await errorOf(unsigned)).toBe('invalid_grant');
    expect(await descriptionOf(unsigned)).toContain('redeemed by chatgpt.com');
    const stranger = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: refresh, client_assertion_type: ASSERTION_TYPE, client_assertion: assertion(strangerPrivate, CHATGPT_DOC, `${base}oauth/token`) });
    expect(stranger.status).toBe(401);
    expect(await descriptionOf(stranger)).toContain('signature is not by a published key');
    const elsewhere = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: refresh, client_assertion_type: ASSERTION_TYPE, client_assertion: assertion(chatgptPrivate, CHATGPT_DOC, 'https://other.example/token') });
    expect(await descriptionOf(elsewhere)).toContain('audience');
    const once = assertion(chatgptPrivate, CHATGPT_DOC, `${base}oauth/token`);
    const first = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: refresh, client_assertion_type: ASSERTION_TYPE, client_assertion: once });
    expect(first.status).toBe(200);
    const rotated = (await first.json()) as OAuthTokens;
    const replay = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: rotated.refresh_token!, client_assertion_type: ASSERTION_TYPE, client_assertion: once });
    expect(replay.status).toBe(401);
    expect(await descriptionOf(replay)).toContain('presented before');
    provider.saved = rotated;
  });

  it('refuses a code sent to chatgpt.com\'s callback that is redeemed as a public client, which the document allows but nothing binds', async () => {
    const { verifier, challenge } = pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: CHATGPT_DOC, redirect_uri: CHATGPT, code_challenge: challenge, code_challenge_method: 'S256', resource: `${base}mcp` });
    const landed = await person(new URL(`${base}oauth/authorize?${q}`), member.url, { name: 'ChatGPT', product: 'chatgpt.com', host: 'chatgpt.com' });
    const r = await form('oauth/token', { grant_type: 'authorization_code', code: landed.code, code_verifier: verifier, client_id: CHATGPT_DOC });
    expect(r.status).toBe(400);
    expect(await errorOf(r)).toBe('invalid_grant');
    expect(await descriptionOf(r)).toBe('a code sent to chatgpt.com\'s callback is redeemed by chatgpt.com: with a token request signed by a key from chatgpt.com\'s own client metadata document');
  });
});

describe('a code lifted from the browser', () => {
  let member: { url: string; address: string };
  beforeAll(async () => {
    member = await join_();
  });
  const landedCode = async (clientId: string, redirectUri: string, expect_: { name: string | null; product: string | null }): Promise<{ code: string; verifier: string }> => {
    const { verifier, challenge } = pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: 'S256', resource: `${base}mcp` });
    return { code: (await person(new URL(`${base}oauth/authorize?${q}`), member.url, expect_)).code, verifier };
  };
  it('is refused when redeemed by a client of one\'s own registered with claude.ai\'s callback, from anywhere but Anthropic\'s range', async () => {
    const own = (await (await postJson('oauth/register', { client_name: 'Claude', redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' })).json()) as { client_id: string };
    const { code, verifier } = await landedCode(own.client_id, CLAUDE, { name: 'Claude', product: 'claude.ai' });
    const r = await form('oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: own.client_id }, ELSEWHERE);
    expect(r.status).toBe(400);
    expect(await errorOf(r)).toBe('invalid_grant');
    expect(await descriptionOf(r)).toBe('a code sent to claude.ai\'s callback is redeemed by claude.ai: with a token request signed by a key from claude.ai\'s own client metadata document, or from the addresses claude.ai publishes for its servers');
    // The code is spent by the attempt; from the range it would have bound, it is gone.
    expect(await descriptionOf(await form('oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: own.client_id }, ANTHROPIC))).toContain('used already');
    expect(store.grantsOf(createHash('sha256').update(member.url.slice(-64)).digest('hex'))).toEqual([]);
  });
  it('is refused when redeemed with claude.ai\'s own document from one\'s own address, or with a document of one\'s own naming claude.ai\'s callback', async () => {
    const borrowed = await landedCode(CLAUDE_DOC, CLAUDE, { name: 'Claude', product: 'claude.ai' });
    expect(await descriptionOf(await form('oauth/token', { grant_type: 'authorization_code', code: borrowed.code, code_verifier: borrowed.verifier, client_id: CLAUDE_DOC }))).toContain('redeemed by claude.ai');
    const forged = await landedCode('https://evil.example/claude.json', CLAUDE, { name: 'Claude', product: 'claude.ai' });
    expect(await descriptionOf(await form('oauth/token', { grant_type: 'authorization_code', code: forged.code, code_verifier: forged.verifier, client_id: 'https://evil.example/claude.json' }))).toContain('redeemed by claude.ai');
    // A document of one's own naming the product's callback binds by address like any other: from the range, the product itself made the request.
    const fromRange = await landedCode('https://evil.example/claude.json', CLAUDE, { name: 'Claude', product: 'claude.ai' });
    expect((await form('oauth/token', { grant_type: 'authorization_code', code: fromRange.code, code_verifier: fromRange.verifier, client_id: 'https://evil.example/claude.json' }, ANTHROPIC)).status).toBe(200);
  });
  it('is not issued at all unless the request names this connector as its resource', async () => {
    const { challenge } = pkce();
    const without = new URLSearchParams({ response_type: 'code', client_id: CLAUDE_DOC, redirect_uri: CLAUDE, code_challenge: challenge, code_challenge_method: 'S256', state: 's' });
    const r = await fetch(`${base}oauth/authorize?${without}`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get('location')!);
    expect(`${to.origin}${to.pathname}`).toBe(CLAUDE);
    expect(to.searchParams.get('error')).toBe('invalid_target');
    expect(to.searchParams.get('error_description')).toContain('names the resource it is for');
    const elsewhere = new URLSearchParams({ response_type: 'code', client_id: CLAUDE_DOC, redirect_uri: CLAUDE, code_challenge: challenge, code_challenge_method: 'S256', resource: 'https://attacker.example/mcp' });
    const r2 = await fetch(`${base}oauth/authorize?${elsewhere}`, { redirect: 'manual' });
    expect(new URL(r2.headers.get('location')!).searchParams.get('error')).toBe('invalid_target');
  });
});

describe('a client with a callback of its own', () => {
  let member: { url: string; address: string };
  let reg: { client_id: string; client_secret: string };
  let tokens: OAuthTokens;
  it('walks to via: other with the name it gave, quoted, with no binding asked', async () => {
    reg = (await (await postJson('oauth/register', { client_name: 'Acme Agent', redirect_uris: [AGENT], token_endpoint_auth_method: 'client_secret_post' })).json()) as { client_id: string; client_secret: string };
    member = await join_();
    const { verifier, challenge } = pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: AGENT, code_challenge: challenge, code_challenge_method: 'S256', state: 'agent-state' });
    const landed = await person(new URL(`${base}oauth/authorize?${q}`), member.url.slice(-64), { name: 'Acme Agent', product: null, host: null });
    expect(landed.landed).toBe(AGENT);
    expect(landed.state).toBe('agent-state');
    tokens = (await (await form('oauth/token', { grant_type: 'authorization_code', code: landed.code, code_verifier: verifier, redirect_uri: AGENT, client_id: reg.client_id, client_secret: reg.client_secret })).json()) as OAuthTokens;
    expect(tokens.token_type).toBe('Bearer');
    const client = new Client({ name: 'acme', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}mcp`), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
    const me = await meText(client);
    expect(me.text).toContain('Witness: none');
    expect(me.text).toContain('calls itself "Acme Agent"');
    expect(me.handles).toMatchObject({ witness: 'other' });
    expect(JSON.stringify(me.handles)).not.toContain('Acme');
    await returnPiece(client);
    for (const l of await receiptsOf(member.address)) {
      expect(l.received[0]).toMatchObject({ custody: 'hosted', via: 'other', via_client: 'Acme Agent' });
      expect(l.received[0]).not.toHaveProperty('via_by');
    }
    const read = (await client.callTool({ name: 'quilt_read', arguments: { problem } })).structuredContent as { text: string };
    expect(read.text).toContain('(through a client that calls itself "Acme Agent") returned: {"verdict":"supports"}');
    await client.close();
  });
  it('ends the grant when the client revokes its token', async () => {
    expect((await form('oauth/revoke', { token: tokens.refresh_token!, client_id: reg.client_id, client_secret: reg.client_secret })).status).toBe(200);
    const r = await fetch(`${base}mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('revoked');
  });
});

describe('the code and PKCE', () => {
  let client: { client_id: string };
  let member: { url: string };
  const authorize = async (over: Record<string, string> = {}): Promise<{ code: string; verifier: string }> => {
    const { verifier, challenge } = pkce();
    const params = { response_type: 'code', client_id: client.client_id, redirect_uri: AGENT, code_challenge: challenge, code_challenge_method: 'S256', ...over };
    const r = (await (await postJson('oauth/authorize', { ...params, allow: true, address: member.url })).json()) as { redirect: string };
    return { code: new URL(r.redirect).searchParams.get('code')!, verifier };
  };
  const exchange = (code: string, verifier: string, over: Record<string, string> = {}) => form('oauth/token', { grant_type: 'authorization_code', code, code_verifier: verifier, client_id: client.client_id, ...over });

  beforeAll(async () => {
    client = (await (await postJson('oauth/register', { client_name: 'Tester', redirect_uris: [AGENT, 'https://agent.example/other'], token_endpoint_auth_method: 'none' })).json()) as { client_id: string };
    member = await join_();
  });

  it('sends an authorization without S256 back to the client, and says to the person when the redirect URI is not registered', async () => {
    const plain = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: AGENT, code_challenge: 'x'.repeat(43), code_challenge_method: 'plain', state: 's' });
    const r = await fetch(`${base}oauth/authorize?${plain}`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const to = new URL(r.headers.get('location')!);
    expect(`${to.origin}${to.pathname}`).toBe(AGENT);
    expect(to.searchParams.get('error')).toBe('invalid_request');
    expect(to.searchParams.get('state')).toBe('s');
    const stray = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CLAUDE, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    expect((await fetch(`${base}oauth/authorize?${stray}`, { redirect: 'manual' })).status).toBe(400);
    expect((await fetch(`${base}oauth/authorize/request?${stray}`)).status).toBe(400);
    const unnamed = new URLSearchParams({ response_type: 'code', client_id: client.client_id, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    expect((await fetch(`${base}oauth/authorize?${unnamed}`, { redirect: 'manual' })).status).toBe(400);
  });

  it('says to the person when a document is not its own URL, lives on a loopback host, or does not name the redirect URI, and names a document client by its host', async () => {
    const ask = (clientId: string, redirectUri = AGENT) => fetch(`${base}oauth/authorize/request?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', resource: `${base}mcp` })}`);
    const mismatch = await ask('https://agent.example/client.json');
    expect(mismatch.status).toBe(400);
    expect(((await mismatch.json()) as { error: string }).error).toContain('client_id is not its own URL');
    expect(((await (await ask('https://127.0.0.1/client.json')).json()) as { error: string }).error).toContain('public host');
    expect(((await (await ask('https://localhost/client.json')).json()) as { error: string }).error).toContain('public host');
    expect(((await (await ask(CHATGPT_DOC, AGENT)).json()) as { error: string }).error).toContain('not one this client registered');
    const borrowed = await ask('https://mirror.example/chatgpt.json', CHATGPT);
    expect(((await borrowed.json()) as { error: string }).error).toContain('keys are published on its own host');
    const info = (await (await ask(CHATGPT_DOC, CHATGPT)).json()) as { client: { host: string; name: string }; redirect: { product: string } };
    expect(info.client).toMatchObject({ host: 'chatgpt.com', name: 'ChatGPT' });
    expect(info.redirect.product).toBe('chatgpt.com');
  });

  it('sends a declined authorization back with access_denied', async () => {
    const { challenge } = pkce();
    const r = (await (await postJson('oauth/authorize', { response_type: 'code', client_id: client.client_id, redirect_uri: AGENT, code_challenge: challenge, code_challenge_method: 'S256', state: 'n', allow: false })).json()) as { redirect: string };
    expect(new URL(r.redirect).searchParams.get('error')).toBe('access_denied');
  });

  it('refuses a code with the wrong verifier, the wrong redirect URI, another client, or after it expires', async () => {
    const a = await authorize();
    expect(await errorOf(await exchange(a.code, pkce().verifier))).toBe('invalid_grant');
    const b = await authorize();
    expect(await errorOf(await exchange(b.code, b.verifier, { redirect_uri: 'https://agent.example/other' }))).toBe('invalid_grant');
    const c = await authorize();
    const stranger = (await (await postJson('oauth/register', { redirect_uris: [AGENT], token_endpoint_auth_method: 'none' })).json()) as { client_id: string };
    expect(await errorOf(await exchange(c.code, c.verifier, { client_id: stranger.client_id }))).toBe('invalid_grant');
    const d = await authorize();
    skew.ms = 6 * 60 * 1000;
    try {
      expect(await errorOf(await exchange(d.code, d.verifier))).toBe('invalid_grant');
    } finally {
      skew.ms = 0;
    }
    expect(await errorOf(await form('oauth/token', { grant_type: 'client_credentials', client_id: client.client_id }))).toBe('unsupported_grant_type');
    const confidential = (await (await postJson('oauth/register', { redirect_uris: [AGENT] })).json()) as { client_id: string };
    const unauthenticated = await form('oauth/token', { grant_type: 'authorization_code', code: 'x', code_verifier: 'y', client_id: confidential.client_id });
    expect(unauthenticated.status).toBe(401);
    expect(await errorOf(unauthenticated)).toBe('invalid_client');
  });

  it('takes a code once, and revokes what it gave when it comes again', async () => {
    const a = await authorize();
    const r = await exchange(a.code, a.verifier);
    expect(r.status).toBe(200);
    const tokens = (await r.json()) as OAuthTokens;
    const ok = await fetch(`${base}mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) });
    expect(ok.status).toBe(200);
    expect(await errorOf(await exchange(a.code, a.verifier))).toBe('invalid_grant');
    expect((await fetch(`${base}mcp`, { method: 'POST', headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);
  });
});
