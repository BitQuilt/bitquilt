/**
 * PROTOCOL.md, The on-ramp's routes, held to the on-ramp mounted beside a tracker with the authorization server on
 * (QX-18 section 1): every test the `routes` of hosted.ts and oauth.ts make of a path, a literal, a pattern or a
 * prefix, meets a row's path, and each word a pattern's alternatives take meets a row's path that ends in it, as
 * routes.test.ts holds the rows of the door's table; a path the source builds at run time, as it builds the metadata's,
 * is not among them. A row's Methods cell names methods and nothing else, and each method a row names is one the
 * on-ramp takes at every path the row names, answered neither 405 nor the tracker's `no such route`. The row of the
 * authorization server, whose paths end in an ellipsis, stands for the endpoints QX-18 section 1 lists, and those
 * include every endpoint the server's metadata names; across them the methods taken are the row's, no more and no
 * fewer. The connector's two rows are held inside an MCP session, since outside one only an initialize reaches the
 * transport and the on-ramp answers the rest itself. At `/mcp/<token>` the token in the path names the address, and at
 * `/mcp` a bearer token from the authorization server does. Their methods are the ones the transport names in `Allow`
 * when it refuses another, and each is answered in the session, DELETE last. Their refusals are the statuses the
 * on-ramp and the transport give, each provoked here and held to its status, and a body that is not JSON, at a
 * session's start or inside one, is refused with the transport's own parse error, as PROTOCOL.md says under the
 * table. Where a browser meets the person's sheet page and where the page reads its data are held from the rows' What
 * it answers cells: the page at the address, the JSON at its `/sheet`, and no page at `/mcp`. The other rows'
 * refusals are not read. The tracker's own table is protocol-table.test.ts's, and the node's is
 * packages/client/test/node-table.test.ts's.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store, createTracker } from '@bitquilt/tracker';
import { createHosted } from '../src/hosted.js';

const DOC = readFileSync(new URL('../../../docs/PROTOCOL.md', import.meta.url), 'utf8');
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
/** The authorization server's endpoints and metadata, as QX-18 section 1 lists them. */
const OAUTH = [
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/mcp',
  '/.well-known/oauth-authorization-server',
  '/oauth/register',
  '/oauth/authorize',
  '/oauth/authorize/request',
  '/oauth/token',
  '/oauth/revoke',
];
/** The connector's paths, whose methods the MCP transport answers once a session is open. */
const CONNECTOR = ['/mcp/<token>', '/mcp'];
const NO_SQUARE = `sha256:${'0'.repeat(64)}`;
/** A token that names no address here. */
const NO_ADDRESS = '0'.repeat(64);
/** A client's callback, registered as its own. */
const CALLBACK = 'https://agent.example/callback';
/** What the transport asks a POST to accept. */
const ACCEPT = 'application/json, text/event-stream';
/** The transport's parse error, as the SDK's transport writes it: JSON-RPC's -32700 with no id. */
const PARSE_ERROR = '{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error: Invalid JSON"},"id":null}';

let server: Server;
let base: string;
/** The address the table's paths are filled with, and a second one whose session is not the first's. */
let mine: { url: string; token: string };
let theirs: { url: string; token: string };

const rpc = (id: number, method: string, params?: unknown): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const INITIALIZE = rpc(1, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'onramp-table', version: '1' },
});

/** An address made at the join, with its token. */
async function joinOnce(): Promise<{ url: string; token: string }> {
  const { url } = (await (await fetch(`${base}/join`, { method: 'POST' })).json()) as { url: string };
  return { url, token: /\/mcp\/([0-9a-f]{64})$/.exec(url)![1]! };
}

beforeAll(async () => {
  const store = new Store(':memory:');
  const custodySecret = randomBytes(16).toString('hex');
  const hosted = createHosted({
    store,
    trackerUrl: () => base,
    keySecret: 'test-secret',
    home: mkdtempSync(join(tmpdir(), 'hosted-table-')),
    custodySecret,
    name: 'Test tracker',
    oauth: { secret: 'oauth-test-secret' },
  });
  server = await createTracker({
    store,
    url: 'http://t.test/',
    ipSalt: 's',
    custodySecret,
    extra: hosted.routes,
    extraWellKnown: hosted.describe,
  }).listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
  mine = await joinOnce();
  theirs = await joinOnce();
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** The rows of the table under "### The on-ramp's routes", each a list of its cells, header and rule left out. */
function rows(): string[][] {
  const lines = DOC.split('\n');
  const at = lines.indexOf("### The on-ramp's routes");
  if (at < 0) throw new Error("PROTOCOL.md has no heading ### The on-ramp's routes");
  const out: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('#')) break;
    if (line.startsWith('|'))
      out.push(
        line
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim()),
      );
    else if (out.length) break;
  }
  return out.slice(2);
}

/** A row: the paths it names in backticks, its methods, what it answers, and the statuses it is refused with. */
const routes = (): { paths: string[]; methods: string[]; answers: string; refusals: number[] }[] =>
  rows().map(([paths, methods, answers, refusals]) => ({
    paths: [...paths!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!),
    methods: methods!.split(',').map((m) => m.trim()),
    answers: answers!,
    refusals: refusals!.split(',').map((s) => Number(s.trim())),
  }));

/** The What it answers cell of the row that names a path. */
function answer(path: string): string {
  const row = routes().find((r) => r.paths.includes(path));
  if (!row) throw new Error(`no row names ${path}`);
  return row.answers;
}

/** Whether a row is one of the connector's. */
const isConnector = (r: { paths: string[] }): boolean => r.paths.some((p) => CONNECTOR.includes(p));

/** The paths a row's path stands for: an ellipsis for the authorization server's, a placeholder filled. */
function concrete(path: string): string[] {
  if (path.endsWith('…')) return OAUTH.filter((p) => p.startsWith(path.slice(0, -1)));
  return [path.replace('<token>', mine.token).replace('<problem>', NO_SQUARE).replace('<piece>', NO_SQUARE)];
}

/**
 * Every test the on-ramp's `routes` make of a request's path, in hosted.ts and in oauth.ts for the authorization
 * server, in the order the source makes them: a literal it is compared with, a pattern run on it, or a prefix; with
 * the words a pattern's alternatives take. A path built at run time, as the metadata's are, is not among them.
 */
function pathTests(): { text: string; matches: (path: string) => boolean; words: string[] }[] {
  return ['hosted.ts', 'oauth.ts'].flatMap((file) => {
    const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    const at = source.indexOf('async function routes(');
    if (at < 0) throw new Error(`${file} has no routes`);
    const body = source.slice(at, source.indexOf('\n  }\n', at));
    return [...body.matchAll(/path === '([^']+)'|\/(\^[^\n]*?\$)\/\.exec\(path\)|path\.startsWith\('([^']+)'\)/g)].map(
      (m) => {
        const [text, literal, pattern, prefix] = m as unknown as [
          string,
          string | undefined,
          string | undefined,
          string | undefined,
        ];
        if (literal !== undefined) return { text, matches: (p: string) => p === literal, words: [] };
        if (pattern !== undefined) {
          const re = new RegExp(pattern);
          const words = [...pattern.matchAll(/\(([a-z]+(?:\|[a-z]+)+)\)/g)].flatMap((g) => g[1]!.split('|'));
          return { text, matches: (p: string) => re.test(p), words };
        }
        return { text, matches: (p: string) => p.startsWith(prefix!), words: [] };
      },
    );
  });
}

/** Whether the on-ramp takes a method at a path: an answer that is neither 405 nor the tracker's `no such route`. */
async function takes(method: string, path: string): Promise<boolean> {
  const r = await fetch(base + path, { method, redirect: 'manual', ...(method === 'GET' ? {} : { body: '' }) });
  const json = (r.headers.get('content-type') ?? '').startsWith('application/json');
  const error = json ? ((await r.json()) as { error?: string }).error : (await r.arrayBuffer(), undefined);
  return r.status !== 405 && !(r.status === 404 && error === 'no such route');
}

/** A bearer token for an address, as a client registered here gets one: registered, approved, exchanged with PKCE. */
async function bearerFor(address: string): Promise<string> {
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const client = (await (
    await post('/oauth/register', {
      client_name: 'Table',
      redirect_uris: [CALLBACK],
      token_endpoint_auth_method: 'none',
    })
  ).json()) as { client_id: string };
  const verifier = randomBytes(32).toString('base64url');
  const approved = (await (
    await post('/oauth/authorize', {
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: CALLBACK,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      allow: true,
      address,
    })
  ).json()) as { redirect: string };
  const exchanged = await fetch(`${base}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: new URL(approved.redirect).searchParams.get('code')!,
      code_verifier: verifier,
      client_id: client.client_id,
    }).toString(),
  });
  return ((await exchanged.json()) as { access_token: string }).access_token;
}

/** Where a connector path is reached: its URL and the headers that name the address there. */
interface Door {
  url: string;
  headers: Record<string, string>;
}

/** A session opened at a door with an initialize, and its id. */
async function session(door: Door): Promise<string> {
  const r = await fetch(door.url, {
    method: 'POST',
    headers: { ...door.headers, accept: ACCEPT, 'content-type': 'application/json' },
    body: INITIALIZE,
  });
  await r.text();
  expect(r.status, `an initialize at ${door.url}`).toBe(200);
  return r.headers.get('mcp-session-id')!;
}

describe("PROTOCOL.md, the on-ramp's route table", () => {
  it('gives each row methods in its Methods cell, and nothing else there', () => {
    const all = routes();
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(r.methods.length, `${r.paths.join(', ')} names its methods`).toBeGreaterThan(0);
      for (const m of r.methods) expect(METHODS, `${r.paths.join(', ')}: ${m} is a method`).toContain(m);
    }
  });

  it('names a row for every path the routes of hosted.ts and oauth.ts test, and for every sub-route a pattern takes', () => {
    expect(DOC).toContain("holds a row for every path the two files' `routes` test");
    const paths = routes().flatMap((r) => r.paths.flatMap(concrete));
    const tests = pathTests();
    expect(tests.length).toBeGreaterThan(10);
    for (const t of tests) {
      expect(
        paths.some((p) => t.matches(p)),
        `${t.text} tests no row's path`,
      ).toBe(true);
      for (const w of t.words)
        expect(
          paths.some((p) => t.matches(p) && p.endsWith(`/${w}`)),
          `${t.text} takes ${w}, which no row names`,
        ).toBe(true);
    }
  });

  it("lists every endpoint the authorization server's metadata names", async () => {
    const meta = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<
      string,
      unknown
    >;
    const endpoints = Object.entries(meta)
      .filter(([k, v]) => k.endsWith('_endpoint') && typeof v === 'string')
      .map(([, v]) => new URL(v as string).pathname);
    expect(endpoints.length).toBeGreaterThan(0);
    for (const p of endpoints) expect(OAUTH, `${p} is listed`).toContain(p);
  });

  it("names for each row but the connector's only methods the on-ramp takes, and every one it takes at its endpoints", async () => {
    for (const r of routes().filter((r) => !isConnector(r))) {
      const taken = new Set<string>();
      for (const p of r.paths) {
        const paths = concrete(p);
        expect(paths.length, `${p} stands for a path`).toBeGreaterThan(0);
        if (!p.endsWith('…')) {
          for (const m of r.methods) expect(await takes(m, paths[0]!), `${m} ${p}`).toBe(true);
          continue;
        }
        for (const path of paths) for (const m of METHODS) if (await takes(m, path)) taken.add(m);
      }
      if (r.paths.some((p) => p.endsWith('…')))
        expect([...taken].sort(), `the methods taken under ${r.paths.join(', ')}`).toEqual([...r.methods].sort());
    }
  });

  it("names for the connector's rows the methods the MCP transport takes in a session, and every status the connector refuses with", async () => {
    // How each path names the address, and how it names none, with the status that none is refused with.
    const doors: Record<string, { as: Door; nobody: Door; none: number }> = {
      '/mcp/<token>': {
        as: { url: `${base}/mcp/${mine.token}`, headers: {} },
        nobody: { url: `${base}/mcp/${NO_ADDRESS}`, headers: {} },
        none: 404,
      },
      '/mcp': {
        as: { url: `${base}/mcp`, headers: { authorization: `Bearer ${await bearerFor(mine.url)}` } },
        nobody: { url: `${base}/mcp`, headers: {} },
        none: 401,
      },
    };
    expect(DOC).toContain(
      "A body that is not JSON is the caller's fault, and the connector refuses it with 400 and the transport's own parse error, a JSON-RPC error -32700, at a session's start and inside one.",
    );
    const other: Door = { url: `${base}/mcp/${theirs.token}`, headers: {} };
    const another = await session(other);
    for (const path of CONNECTOR) {
      const row = routes().find((r) => r.paths.includes(path));
      expect(row, `a row names ${path}`).toBeDefined();
      const { as, nobody, none } = doors[path]!;
      const sid = await session(as);
      const typed = { accept: ACCEPT, 'content-type': 'application/json' };
      const inside = { ...as.headers, ...typed, 'mcp-session-id': sid };
      const answered = new Set<string>();
      const refused = new Set<number>();
      /** A request the connector refuses, held to the status it is refused with. */
      const refuses = async (status: number, what: string, url: string, init: RequestInit): Promise<Response> => {
        const r = await fetch(url, init);
        await r.arrayBuffer();
        expect(r.status, `${path}: ${what}`).toBe(status);
        refused.add(status);
        return r;
      };
      // Another method in the session is the transport's 405, and its Allow names the methods it takes.
      const put = await refuses(405, 'another method in a session', as.url, { method: 'PUT', headers: inside });
      const allow = (put.headers.get('allow') ?? '').split(',').map((m) => m.trim());
      expect([...row!.methods].sort(), `${path}: the methods the transport takes`).toEqual(allow.sort());
      // Each is answered in the session: GET opens the stream, which refuses a second while it is open, POST
      // answers a ping, and DELETE, sent last, ends the session.
      const open = new AbortController();
      const stream = await fetch(as.url, {
        method: 'GET',
        headers: { ...inside, accept: 'text/event-stream' },
        signal: open.signal,
      });
      expect(stream.status, `GET ${path} in a session`).toBe(200);
      answered.add('GET');
      await refuses(409, 'a second stream in one session', as.url, {
        method: 'GET',
        headers: { ...inside, accept: 'text/event-stream' },
      });
      open.abort();
      const ping = await fetch(as.url, { method: 'POST', headers: inside, body: rpc(2, 'ping') });
      await ping.text();
      expect(ping.status, `POST ${path} in a session`).toBe(200);
      answered.add('POST');
      await refuses(406, 'a GET in a session that does not accept the event stream', as.url, {
        method: 'GET',
        headers: { ...inside, accept: 'application/json' },
      });
      await refuses(400, 'a GET with no session', as.url, { method: 'GET', headers: as.headers });
      await refuses(406, 'an initialize that does not accept the event stream', as.url, {
        method: 'POST',
        headers: { ...as.headers, ...typed, accept: 'application/json' },
        body: INITIALIZE,
      });
      await refuses(406, 'an initialize that does not accept JSON', as.url, {
        method: 'POST',
        headers: { ...as.headers, ...typed, accept: 'text/event-stream' },
        body: INITIALIZE,
      });
      await refuses(415, 'an initialize not typed as JSON', as.url, {
        method: 'POST',
        headers: { ...as.headers, ...typed, 'content-type': 'text/plain' },
        body: INITIALIZE,
      });
      // A body that is not JSON is refused as the transport refuses one, at a session's start and inside one: the
      // transport's own answer to a body it reads empty in a session, the same status, type and words.
      const own = await fetch(as.url, { method: 'POST', headers: inside, body: '' });
      const parseError = { status: own.status, type: own.headers.get('content-type'), body: await own.text() };
      expect(parseError, `${path}: the transport's parse error`).toEqual({
        status: 400,
        type: 'application/json',
        body: PARSE_ERROR,
      });
      for (const [what, headers] of [
        ['a session begun with a body that is not JSON', { ...as.headers, ...typed }],
        ['a body that is not JSON in a session', inside],
      ] as const) {
        const r = await fetch(as.url, { method: 'POST', headers, body: '{"jsonrpc": "2.0", "id": 4,' });
        const got = { status: r.status, type: r.headers.get('content-type'), body: await r.text() };
        expect(got, `${path}: ${what}`).toEqual(parseError);
        refused.add(r.status);
      }
      await refuses(403, "another address's session", as.url, {
        method: 'POST',
        headers: { ...inside, 'mcp-session-id': another },
        body: rpc(3, 'ping'),
      });
      await refuses(none, 'an initialize for no address', nobody.url, {
        method: 'POST',
        headers: { ...nobody.headers, ...typed },
        body: INITIALIZE,
      });
      const end = await fetch(as.url, { method: 'DELETE', headers: inside });
      await end.arrayBuffer();
      expect(end.status, `DELETE ${path} in a session`).toBe(200);
      answered.add('DELETE');
      expect([...answered].sort(), `${path}: the methods answered in a session`).toEqual([...row!.methods].sort());
      expect(
        [...refused].sort((a, b) => a - b),
        `${path}: the statuses it is refused with`,
      ).toEqual(row!.refusals);
    }
    const ended = await fetch(other.url, { method: 'DELETE', headers: { accept: ACCEPT, 'mcp-session-id': another } });
    await ended.arrayBuffer();
    expect(ended.status, 'the other address ends its session').toBe(200);
  });

  it('says where a browser meets the sheet page and where the page reads its data', async () => {
    const browser = { headers: { accept: 'text/html,application/xhtml+xml' } };
    // The address itself is the page to a browser, and the page reads the JSON at its /sheet.
    expect(answer('/mcp/<token>')).toContain(
      "To a browser (a `GET` whose `accept` names `text/html`), the person's sheet page",
    );
    const page = await fetch(`${base}/mcp/${mine.token}`, browser);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await page.text()).toContain("+ '/sheet'");
    expect(answer('/mcp/<token>/sheet')).toContain('the sheet as JSON, which the sheet page reads');
    const data = await fetch(`${base}/mcp/${mine.token}/sheet`, browser);
    expect(data.status).toBe(200);
    expect(data.headers.get('content-type')).toMatch(/^application\/json/);
    expect(((await data.json()) as { url: string }).url).toBe(mine.url);
    // At /mcp a browser meets the authorization server's challenge, not a page.
    expect(answer('/mcp')).toContain('no sheet page');
    const bare = await fetch(`${base}/mcp`, browser);
    await bare.arrayBuffer();
    expect(bare.status).toBe(401);
  });
});
