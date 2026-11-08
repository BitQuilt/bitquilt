/**
 * PROTOCOL.md, The on-ramp's routes, held to the on-ramp mounted beside a tracker with the authorization server on
 * (QX-18 section 1): a row's Methods cell names methods and nothing else, and each method a row names is one the
 * on-ramp takes at every path the row names, answered neither 405 nor the tracker's `no such route`. The row of the
 * authorization server, whose paths end in an ellipsis, stands for the endpoints QX-18 section 1 lists, and those
 * include every endpoint the server's metadata names; across them the methods taken are the row's, no more and no
 * fewer. The refusals column is not read. The tracker's own table is protocol-table.test.ts's.
 */
import { randomBytes } from 'node:crypto';
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
const NO_SQUARE = `sha256:${'0'.repeat(64)}`;

let server: Server;
let base: string;
let token: string;

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
  const joined = (await (await fetch(`${base}/join`, { method: 'POST' })).json()) as { url: string };
  token = /\/mcp\/([0-9a-f]{64})$/.exec(joined.url)![1]!;
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

/** A row: the paths it names in backticks, and its methods. */
const routes = (): { paths: string[]; methods: string[] }[] =>
  rows().map(([paths, methods]) => ({
    paths: [...paths!.matchAll(/`([^`]+)`/g)].map((m) => m[1]!),
    methods: methods!.split(',').map((m) => m.trim()),
  }));

/** The paths a row's path stands for: an ellipsis for the authorization server's, a placeholder filled. */
function concrete(path: string): string[] {
  if (path.endsWith('…')) return OAUTH.filter((p) => p.startsWith(path.slice(0, -1)));
  return [path.replace('<token>', token).replace('<problem>', NO_SQUARE).replace('<piece>', NO_SQUARE)];
}

/** Whether the on-ramp takes a method at a path: an answer that is neither 405 nor the tracker's `no such route`. */
async function takes(method: string, path: string): Promise<boolean> {
  const r = await fetch(base + path, { method, redirect: 'manual', ...(method === 'GET' ? {} : { body: '' }) });
  const json = (r.headers.get('content-type') ?? '').startsWith('application/json');
  const error = json ? ((await r.json()) as { error?: string }).error : (await r.arrayBuffer(), undefined);
  return r.status !== 405 && !(r.status === 404 && error === 'no such route');
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

  it('names for each row only methods the on-ramp takes, and every one it takes at its endpoints', async () => {
    for (const r of routes()) {
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
});
