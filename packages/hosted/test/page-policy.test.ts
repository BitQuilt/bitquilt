/**
 * The pages the hosted on-ramp serves whole, under AGENTS.md rule 6: the join page, the authorization page (QX-18) and
 * the sheet. Each comes with a Content-Security-Policy that loads nothing from another server, runs the page's own
 * inline script and style by their hashes and nothing else, reads from this tracker alone, posts no form, sets no base,
 * and lets no other page frame it. The hashes are taken here from the document as served, so the page's own script is
 * shown to be allowed by its policy, and nothing else is.
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Store, createTracker } from '@bitquilt/tracker';
import { createHosted } from '../src/hosted.js';
import { pagePolicy } from '../src/page-policy.js';

let server: Server;
let base: string;

beforeAll(async () => {
  const store = new Store(':memory:');
  const custodySecret = randomBytes(16).toString('hex');
  const hosted = createHosted({
    store,
    trackerUrl: () => base,
    keySecret: 'test-secret',
    home: mkdtempSync(join(tmpdir(), 'hosted-policy-')),
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
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '';
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** A policy's directives by name, each with its sources in order. */
const directives = (policy: string): Record<string, string[]> =>
  Object.fromEntries(
    policy
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...sources]) => [name!, sources]),
  );

/** The hash source of each inline element of one kind, read from the document as served. */
const inline = (html: string, tag: 'script' | 'style'): string[] =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map(
    (m) => `'sha256-${createHash('sha256').update(m[1]!).digest('base64')}'`,
  );

/** A page as a browser gets it: the status, the headers and the document. */
async function page(path: string): Promise<{ status: number; headers: Headers; html: string }> {
  const r = await fetch(`${base}${path}`, { headers: { accept: 'text/html' } });
  return { status: r.status, headers: r.headers, html: await r.text() };
}

/** What a page served whole is held to: its own script and style allowed by hash, and nothing else loaded, posted or framed. */
function heldToItsPolicy({ headers, html }: { headers: Headers; html: string }): void {
  const policy = headers.get('content-security-policy') ?? '';
  const d = directives(policy);
  const scripts = inline(html, 'script');
  expect(scripts.length).toBeGreaterThan(0);
  expect(d['default-src']).toEqual(["'none'"]);
  expect(d['script-src']).toEqual(scripts);
  expect(d['style-src']).toEqual(inline(html, 'style'));
  expect(d['connect-src']).toEqual(["'self'"]);
  expect(d['base-uri']).toEqual(["'none'"]);
  expect(d['form-action']).toEqual(["'none'"]);
  expect(d['frame-ancestors']).toEqual(["'none'"]);
  expect(policy).not.toContain('unsafe');
  expect(html).not.toMatch(/(src|href)="https?:/);
}

describe('the policy of a page the on-ramp serves whole', () => {
  it('serves the join page with a policy that allows its own script and style by hash and nothing else', async () => {
    const p = await page('join');
    expect(p.status).toBe(200);
    expect(p.html).toContain('Make me an address');
    heldToItsPolicy(p);
  });

  it('serves the authorization page the same way, still framed by no page and sending no referrer', async () => {
    const registered = await fetch(`${base}oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:33418/callback'], token_endpoint_auth_method: 'none' }),
    });
    expect(registered.status).toBe(201);
    const { client_id } = (await registered.json()) as { client_id: string };
    const challenge = createHash('sha256').update('a verifier').digest('base64url');
    const query = new URLSearchParams({
      response_type: 'code',
      client_id,
      redirect_uri: 'http://127.0.0.1:33418/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 's',
    });
    const p = await page(`oauth/authorize?${query}`);
    expect(p.status).toBe(200);
    expect(p.html).toContain('Let a client use your Quilt');
    heldToItsPolicy(p);
    expect(p.headers.get('x-frame-options')).toBe('DENY');
    expect(p.headers.get('referrer-policy')).toBe('no-referrer');
    // A request the page cannot answer still gets the page, under the same policy.
    const refused = await page('oauth/authorize');
    expect(refused.status).toBe(400);
    heldToItsPolicy(refused);
  });

  it('serves the sheet at an address the same way', async () => {
    const { url } = (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { url: string };
    const p = await page(url.slice(base.length));
    expect(p.status).toBe(200);
    expect(p.html).toContain('Your Quilt');
    heldToItsPolicy(p);
  });

  it('takes the hash of each inline script and style as a browser does, and allows none of a kind a page lacks', () => {
    // The example of a hash source in the CSP specification.
    const one = directives(pagePolicy("<p>Hi.</p><script>alert('Hello, world.');</script>"));
    expect(one['script-src']).toEqual(["'sha256-qznLcsROx4GACP2dm0UCKCzCG+HiZ1guq6ZZDob/Tng='"]);
    expect(one['style-src']).toEqual(["'none'"]);
    const two = directives(pagePolicy('<style>p{margin:0}</style><script>a()</script><script>b()</script>'));
    expect(two['script-src']).toHaveLength(2);
    expect(two['style-src']).toEqual(inline('<style>p{margin:0}</style>', 'style'));
    expect(directives(pagePolicy('<p>Nothing runs.</p>'))['script-src']).toEqual(["'none'"]);
  });
});
