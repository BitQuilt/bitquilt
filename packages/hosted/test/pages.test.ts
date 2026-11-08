/**
 * The four pages the hosted on-ramp serves, under AGENTS.md rule 6, as packages/client/test/page.test.ts holds the
 * client's page: the join page, the authorization page (QX-18), the sheet and the page of one square. Each sets its
 * text as text, loads nothing from another server, and comes with a Content-Security-Policy that allows each inline
 * script and style it carries and nothing else. The three served whole run their own script and style by their hashes
 * (page-policy.ts), read from this tracker alone, post no form, set no base, and let no other page frame it; the hashes
 * are taken here from the document as served, so a page's own script is shown to be allowed by its policy, and nothing
 * else is. Their scripts put text on the page with `textContent` and never as markup. The square page is built on the
 * server with every word escaped and runs no script: its policy allows none, and its one style inline, as hosted.ts
 * serves it, with no base and no form.
 */
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import type { Pattern } from 'quilt';
import { pagePolicy } from '../src/page-policy.js';
import { type SquareView, squarePage } from '../src/square-page.js';
import { openDoor, quiltOver } from './helpers.js';

let server: Server;
let base: string;
let problem: Hash;
let piece: Hash;

const pattern: Pattern = {
  title: 'Pages',
  done_when: 'Done.',
  slug: 'pages',
  pieces: {
    'cite/*': {
      count: 1,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Citation {n}: {cite.s}',
      data: { cite: 'cites' },
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict'],
        properties: { verdict: { enum: ['supports', 'contradicts'] } },
      },
    },
  },
  data: { cites: [{ s: 'one' }] },
};

beforeAll(async () => {
  ({ server, base } = await openDoor({ hosted: { name: 'Test tracker', oauth: { secret: 'oauth-test-secret' } } }));
  const owner = quiltOver(base, 0x0b);
  problem = (await owner.publish(pattern)).hash;
  piece = (await owner.open(problem)).state.pieces[0]!.piece.hash;
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

/**
 * What every hosted page is held to: its text set as text, and nothing loaded from another server, by an element, a
 * style or a script.
 */
function textAsText(html: string): void {
  expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  expect(html).not.toMatch(/<(script|link|img|iframe|frame|object|embed|source|video|audio)\b[^>]*\b(src|href|data)=/i);
  expect(html).not.toMatch(/@import|url\(/);
  expect(html).not.toMatch(/\bimport\(|\bfetch\(["'`]https?:/);
}

/**
 * What a page served whole is held to: its own script and style allowed by hash, and nothing else loaded, posted or
 * framed.
 */
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
  textAsText(html);
}

/** The name of every attribute of every tag in a document, with quoted values read past. */
const attributes = (html: string): string[] =>
  [...html.matchAll(/<[a-z][a-z0-9]*((?:\s+[^\s=>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*\/?>/gi)].flatMap(
    (tag) =>
      [...tag[1]!.matchAll(/\s+([^\s=>]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g)].map((a) => a[1]!.toLowerCase()),
  );

/**
 * What the square page is held to: no script and a policy that runs none, its one style allowed inline, no base and no
 * form, and its text set as text.
 */
function heldAsTheSquare({ headers, html }: { headers: Headers; html: string }): void {
  const d = directives(headers.get('content-security-policy') ?? '');
  expect(d).toEqual({
    'default-src': ["'none'"],
    'style-src': ["'unsafe-inline'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"],
  });
  expect(html).not.toMatch(/<script\b/i);
  expect(attributes(html).filter((name) => name.startsWith('on'))).toEqual([]);
  expect(html.match(/<style\b/g)?.length ?? 0).toBeLessThanOrEqual(1);
  textAsText(html);
}

describe('the pages the on-ramp serves', () => {
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

  it('serves the page of a square with no script, its style inline, and the same policy where there is no square', async () => {
    const p = await page(`r/${problem}/${piece}`);
    expect(p.status).toBe(200);
    expect(p.html).toContain('<h1>cite/1: open: nobody has read it yet</h1>');
    heldAsTheSquare(p);
    const none = await page(`r/${problem}/${problem}`);
    expect(none.status).toBe(404);
    heldAsTheSquare(none);
  });

  it('builds the square page with every word escaped, so the words of a reading reach the page as text', () => {
    const markup = '<img src=x onerror=alert(1)>"&';
    const shown = '&lt;img src=x onerror=alert(1)&gt;&quot;&amp;';
    const view: SquareView = {
      url: `${base}r/${problem}/${piece}`,
      problem,
      holder: null,
      title: markup,
      owner: '0x0000000000000000000000000000000000000001',
      ownerName: markup,
      piece,
      name: markup,
      brief: markup,
      state: markup,
      kind: markup,
      agreed: [{ field: markup, value: markup }],
      vendors: [markup],
      traced: 'one',
      verified: true,
      readings: [
        {
          key: '0x0000000000000000000000000000000000000002',
          name: markup,
          vendor: markup,
          model: markup,
          at: markup,
          accepting: true,
          aside: false,
          fields: [[markup, markup]],
          rests: [
            {
              field: markup,
              url: `https://example.org/${markup}`,
              hash: markup as Hash,
              span: [0, 1],
              passage: markup,
            },
            { field: markup, url: `https://example.org/${markup}`, hash: markup as Hash, span: [0, 1], passage: null },
          ],
        },
      ],
      now: { version: markup, same: false, piece: markup, state: markup, brief: markup },
      link: markup,
      directory: markup,
    };
    const html = squarePage(view);
    expect(html).not.toContain(markup);
    expect(html).not.toContain('<img');
    expect(attributes(html)).toEqual(expect.arrayContaining(['href', 'rel', 'class', 'content']));
    expect(html.split(shown).length - 1).toBeGreaterThan(20);
    heldAsTheSquare({
      headers: new Headers({
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      }),
      html,
    });
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
