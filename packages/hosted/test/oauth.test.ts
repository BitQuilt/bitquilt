import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { type OAuthClientProvider, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type OAuthClientInformationMixed, type OAuthClientMetadata, type OAuthTokens, OAuthMetadataSchema, OAuthProtectedResourceMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import { type Hash, type Receipt } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { DEFAULT_CONFIG, Quilt, Resolver, createKey, loadKey, type Pattern } from 'quilt';
import { createHosted } from '../src/hosted.js';
import { PRODUCT_CALLBACKS, productOf } from '../src/products.js';

/**
 * QX-18, the product as witness, on the hosted on-ramp. The metadata at the well-known paths the MCP authorization spec
 * names, read with the SDK's own schemas, and the challenge at the connector. The callback allow-list: each product's
 * redirect URIs, and the near misses that are no product's. Registration and what it refuses. claude.ai's flow walked
 * end to end by the SDK's own OAuth client, the person's part done on the authorization page: registered with
 * claude.ai's callback, authorized with PKCE, the code exchanged, a session opened with the bearer token, a piece
 * returned, and the reveal's receipt read marked via: claude.ai, with the state and quilt_me and quilt_read saying so.
 * A client with a callback of its own walked by hand to via: other and its name, quoted. The code refused when the
 * verifier, the redirect URI or the client is wrong, when it has expired, and when it is used twice, which revokes
 * what it gave. Refresh rotates; revocation ends the grant; the bare address works beside a token, and a token for one
 * address is refused at another's.
 */
let server: Server;
let base: string;
let problem: Hash;
const skew = { ms: 0 };
const store = new Store(':memory:');
const custodySecret = randomBytes(16).toString('hex');
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const AGENT = 'https://agent.example/callback';

const pkce = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const form = (path: string, body: Record<string, string>): Promise<Response> => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
const postJson = (path: string, body: unknown): Promise<Response> => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const join_ = async (): Promise<{ url: string; address: string }> => (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { url: string; address: string };
const receiptsOf = async (address: string): Promise<Receipt[]> => (await (await fetch(`${base}p/${problem}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as Receipt).filter((l) => l.event.key === address);

/** The person's part, as a browser does it: the page, what it reads of the request, and the answer with the address; the code where the redirect lands. */
async function person(authorization: URL, address: string, expect_: { name: string | null; product: string | null }): Promise<{ code: string; state: string | null; iss: string | null; landed: string }> {
  const page = await fetch(authorization, { headers: { accept: 'text/html' } });
  expect(page.status).toBe(200);
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  const html = await page.text();
  expect(html).toContain('Let a client use your Quilt');
  expect(html).not.toMatch(/(src|href)="https?:/);
  const info = (await (await fetch(`${base}oauth/authorize/request${authorization.search}`)).json()) as { client: { name: string | null }; redirect: { product: string | null }; via: string };
  expect(info.client.name).toBe(expect_.name);
  expect(info.redirect.product).toBe(expect_.product);
  expect(info.via).toBe(expect_.product ?? 'other');
  const params = Object.fromEntries(authorization.searchParams);
  expect((await postJson('oauth/authorize', { ...params, allow: true, address: 'f'.repeat(64) })).status).toBe(400);
  const r = (await (await postJson('oauth/authorize', { ...params, allow: true, address })).json()) as { redirect: string };
  const landed = new URL(r.redirect);
  return { code: landed.searchParams.get('code')!, state: landed.searchParams.get('state'), iss: landed.searchParams.get('iss'), landed: `${landed.origin}${landed.pathname}` };
}

/** claude.ai's backend as the SDK's OAuth client plays it: it registers with claude.ai's callback and keeps what the server hands it. */
class ClaudeAi implements OAuthClientProvider {
  readonly redirectUrl = CLAUDE;
  readonly clientMetadata: OAuthClientMetadata = { client_name: 'Claude', redirect_uris: [CLAUDE], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' };
  info: OAuthClientInformationMixed | undefined;
  saved: OAuthTokens | undefined;
  verifier = '';
  code: string | null = null;
  landed: { state: string | null; iss: string | null; at: string } | null = null;
  constructor(private readonly address: string) {}
  state(): string { return 'claude-state'; }
  clientInformation(): OAuthClientInformationMixed | undefined { return this.info; }
  saveClientInformation(i: OAuthClientInformationMixed): void { this.info = i; }
  tokens(): OAuthTokens | undefined { return this.saved; }
  saveTokens(t: OAuthTokens): void { this.saved = t; }
  saveCodeVerifier(v: string): void { this.verifier = v; }
  codeVerifier(): string { return this.verifier; }
  async redirectToAuthorization(url: URL): Promise<void> {
    const r = await person(url, this.address, { name: 'Claude', product: 'claude.ai' });
    this.code = r.code;
    this.landed = { state: r.state, iss: r.iss, at: r.landed };
  }
}

beforeAll(async () => {
  const hosted = createHosted({
    store, trackerUrl: () => base, keySecret: 'test-secret', home: mkdtempSync(join(tmpdir(), 'hosted-oauth-')), custodySecret, name: 'Test tracker',
    now: () => new Date(Date.now() + skew.ms).toISOString(), oauth: { secret: 'oauth-test-secret' },
  });
  const tracker = createTracker({ store, url: 'http://t.test/', ipSalt: 's', custodySecret, extra: hosted.routes, limits: { keyPerHour: 1000, ipPerHour: 10000 } });
  server = await tracker.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '';
  const ownerHome = mkdtempSync(join(tmpdir(), 'owner-'));
  createKey(ownerHome, { secretHex: '00'.repeat(31) + '0a' });
  const config = { ...DEFAULT_CONFIG, trackers: [base] };
  const owner = new Quilt(config, loadKey(ownerHome), new Resolver(config, ownerHome), 'Claude Code');
  const pattern: Pattern = { title: 'Witnessed', done_when: 'Done.', slug: 'witnessed', pieces: { 'cite/*': { count: 1, verifier: 'agree', requires: ['web'], brief: 'Citation {n}: {cite.s}', data: { cite: 'cites' }, schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } } } }, data: { cites: [{ s: 'one' }] } };
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
});

describe('the authorization server\'s doors', () => {
  it('serves the protected-resource and authorization-server metadata, and challenges a connection with no token', async () => {
    const issuer = base.replace(/\/$/, '');
    for (const path of ['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp']) {
      const prm = OAuthProtectedResourceMetadataSchema.parse(await (await fetch(`${base}${path}`)).json());
      expect(prm.resource).toBe(`${base}mcp`);
      expect(prm.authorization_servers).toEqual([issuer]);
    }
    const as = OAuthMetadataSchema.parse(await (await fetch(`${base}.well-known/oauth-authorization-server`)).json());
    expect(as).toMatchObject({ issuer, authorization_endpoint: `${base}oauth/authorize`, token_endpoint: `${base}oauth/token`, registration_endpoint: `${base}oauth/register`, code_challenge_methods_supported: ['S256'], response_types_supported: ['code'] });
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
      [{ redirect_uris: [AGENT], token_endpoint_auth_method: 'private_key_jwt' }, 'invalid_client_metadata'],
      [{ redirect_uris: [AGENT], grant_types: ['client_credentials'] }, 'invalid_client_metadata'],
      [{ client_name: 'no redirect' }, 'invalid_client_metadata'],
    ];
    for (const [body, error] of refusals) {
      const r = await postJson('oauth/register', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(((await r.json()) as { error: string }).error, JSON.stringify(body)).toBe(error);
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
  let provider: ClaudeAi;
  it('registers with claude.ai\'s callback, authorizes with PKCE, exchanges the code, returns a piece, and the reveal\'s receipt says via: claude.ai', async () => {
    member = await join_();
    provider = new ClaudeAi(member.url);
    const url = new URL(`${base}mcp`);
    // The SDK's client finds the challenge, the metadata, registers, and sends the person to the page; the code comes back to "claude.ai".
    await expect(new Client({ name: 'claude-ai', version: '1.0' }).connect(new StreamableHTTPClientTransport(url, { authProvider: provider }))).rejects.toBeInstanceOf(UnauthorizedError);
    expect(provider.landed).toEqual({ state: 'claude-state', iss: base.replace(/\/$/, ''), at: CLAUDE });
    const first = new StreamableHTTPClientTransport(url, { authProvider: provider });
    await first.finishAuth(provider.code!);
    expect(provider.saved).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'quilt' });
    const [grant] = store.grantsOf(createHash('sha256').update(member.url.slice(-64)).digest('hex'));
    expect(grant).toMatchObject({ redirectUri: CLAUDE, via: 'claude.ai', clientName: null, clientId: (provider.info as { client_id: string }).client_id });

    const client = new Client({ name: 'claude-ai', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(url, { authProvider: provider }));
    const me = (await client.callTool({ name: 'quilt_me', arguments: {} })).structuredContent as { text: string; handles: { witness: string } };
    expect(me.text).toContain(`Address: ${member.address}`);
    expect(me.text).toContain('Witnessed by claude.ai');
    expect(me.handles.witness).toBe('claude.ai');
    const next = await client.callTool({ name: 'quilt_next', arguments: { problem } });
    const piece = (next.structuredContent as { handles: { piece: string } }).handles.piece;
    await client.callTool({ name: 'quilt_return', arguments: { problem, piece, return: { verdict: 'supports' } } });
    const mine = await receiptsOf(member.address);
    expect(mine.map((l) => l.event.type)).toEqual(['claim', 'commit', 'reveal']);
    for (const l of mine) expect(l.received[0]).toMatchObject({ custody: 'hosted', seat: 'ai', via: 'claude.ai' });
    const state = (await (await fetch(`${base}p/${problem}/state`)).json()) as { pieces: { hash: string; witnessed: { key: string; via: string }[] }[] };
    expect(state.pieces.find((p) => p.hash === piece)!.witnessed).toEqual([{ key: member.address, via: 'claude.ai' }]);
    await client.close();
  });

  it('refreshes by rotation: the new pair works, the old refresh token does not', async () => {
    const clientId = (provider.info as { client_id: string }).client_id;
    const old = provider.saved!.refresh_token!;
    const r = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: old, client_id: clientId });
    expect(r.status).toBe(200);
    const fresh = (await r.json()) as OAuthTokens;
    const again = await form('oauth/token', { grant_type: 'refresh_token', refresh_token: old, client_id: clientId });
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe('invalid_grant');
    provider.saved = fresh;
    const client = new Client({ name: 'claude-ai', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}mcp`), { authProvider: provider }));
    expect(((await client.callTool({ name: 'quilt_me', arguments: {} })).structuredContent as { text: string }).text).toContain('Witnessed by claude.ai');
    await client.close();
  });

  it('takes the token at the member\'s own long address and refuses it at another\'s', async () => {
    const bearer = { headers: { authorization: `Bearer ${provider.saved!.access_token}` } };
    const own = new Client({ name: 'claude-ai', version: '1.0' });
    await own.connect(new StreamableHTTPClientTransport(new URL(member.url), { requestInit: bearer }));
    expect(((await own.callTool({ name: 'quilt_me', arguments: {} })).structuredContent as { text: string }).text).toContain('Witnessed by claude.ai');
    await own.close();
    const other = await join_();
    const r = await fetch(other.url, { method: 'POST', headers: { ...bearer.headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } }) });
    expect(r.status).toBe(403);
    // The bare address, with no token or with a header this server did not issue, works as it did, and says no witness.
    for (const requestInit of [undefined, { headers: { authorization: 'Bearer not-from-here' } }]) {
      const bare = new Client({ name: 'claude-ai', version: '1.0' });
      await bare.connect(new StreamableHTTPClientTransport(new URL(other.url), requestInit ? { requestInit } : {}));
      expect(((await bare.callTool({ name: 'quilt_me', arguments: {} })).structuredContent as { text: string }).text).not.toContain('Witnessed');
      await bare.close();
    }
  });

  it('ends the grant when the client revokes its token', async () => {
    const clientId = (provider.info as { client_id: string }).client_id;
    expect((await form('oauth/revoke', { token: provider.saved!.refresh_token!, client_id: clientId })).status).toBe(200);
    const r = await fetch(`${base}mcp`, { method: 'POST', headers: { authorization: `Bearer ${provider.saved!.access_token}`, 'content-type': 'application/json' }, body: '{}' });
    expect(r.status).toBe(401);
    expect(r.headers.get('www-authenticate')).toContain('revoked');
  });
});

describe('a client with a callback of its own', () => {
  it('walks to via: other with the name it gave, and quilt_read quotes that name beside claude.ai\'s witness', async () => {
    const reg = (await (await postJson('oauth/register', { client_name: 'Acme Agent', redirect_uris: [AGENT], token_endpoint_auth_method: 'client_secret_post' })).json()) as { client_id: string; client_secret: string };
    const member = await join_();
    const { verifier, challenge } = pkce();
    const q = new URLSearchParams({ response_type: 'code', client_id: reg.client_id, redirect_uri: AGENT, code_challenge: challenge, code_challenge_method: 'S256', state: 'agent-state', resource: `${base}mcp` });
    const landed = await person(new URL(`${base}oauth/authorize?${q}`), member.url.slice(-64), { name: 'Acme Agent', product: null });
    expect(landed.landed).toBe(AGENT);
    expect(landed.state).toBe('agent-state');
    const tokens = (await (await form('oauth/token', { grant_type: 'authorization_code', code: landed.code, code_verifier: verifier, redirect_uri: AGENT, client_id: reg.client_id, client_secret: reg.client_secret })).json()) as OAuthTokens;
    expect(tokens.token_type).toBe('Bearer');

    const client = new Client({ name: 'chatgpt', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}mcp`), { requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } } }));
    const me = (await client.callTool({ name: 'quilt_me', arguments: {} })).structuredContent as { text: string; handles: { witness: string } };
    expect(me.text).toContain('Witness: none');
    expect(me.text).toContain('calls itself "Acme Agent"');
    expect(me.handles).toMatchObject({ witness: 'other' });
    expect(JSON.stringify(me.handles)).not.toContain('Acme');
    const next = await client.callTool({ name: 'quilt_next', arguments: { problem } });
    const piece = (next.structuredContent as { handles: { piece: string } }).handles.piece;
    await client.callTool({ name: 'quilt_return', arguments: { problem, piece, return: { verdict: 'supports' } } });
    for (const l of await receiptsOf(member.address)) expect(l.received[0]).toMatchObject({ custody: 'hosted', via: 'other', via_client: 'Acme Agent' });
    // The one piece now has claude.ai's return and this one, from two vendors that agree: quilt_read names the witness beside each signer.
    const read = (await client.callTool({ name: 'quilt_read', arguments: { problem } })).structuredContent as { text: string };
    expect(read.text).toContain('(witnessed by claude.ai) returned: {"verdict":"supports"}');
    expect(read.text).toContain('(through a client that calls itself "Acme Agent") returned: {"verdict":"supports"}');
    expect(read.text).toContain('A witness is the tracker\'s word (QX-18)');
    await client.close();
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
  const errorOf = async (r: Response): Promise<string> => ((await r.json()) as { error: string }).error;

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
    // Two registered, none named: there is no telling which.
    const unnamed = new URLSearchParams({ response_type: 'code', client_id: client.client_id, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256' });
    expect((await fetch(`${base}oauth/authorize?${unnamed}`, { redirect: 'manual' })).status).toBe(400);
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
