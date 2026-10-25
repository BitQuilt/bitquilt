import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { type Envelope, type Hash, type Receipt, type Unsigned, addressOf, commitHash, hashBytes, newNonce, problemHash, signEvent, signObject, verifyChain } from '@bitquilt/core';
import { Store } from '../src/store.js';
import { createTracker, IDENTITY } from '../src/tracker.js';

const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const owner = key(9), A = key(1), B = key(2), C = key(3), D = key(4);
const addr = addressOf;
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };
const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }, { s: 'two' }, { s: 'three' }]));
const citesHash = hashBytes(cites);

function envelope(brief = 'Citation {n}: {cite.s}', slug = 'report'): Envelope {
  const problem: Envelope['problem'] = {
    title: 'A report', done_when: 'Every citation has a verdict.', owner: addr(owner), slug, prev: null, from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 100, patch_max: 10000 },
    pieces: { 'cite/*': { count: 3, verifier: 'agree', requires: ['web'], brief, data: { cite: 'cites.json' }, schema, agree: ['verdict'] } },
    data: { 'cites.json': citesHash },
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

let server: Server;
let base: string;
const store = new Store(':memory:');
let tick = Date.parse('2026-10-24T18:00:00Z');
const tracker = createTracker({ store, url: 'http://tracker.test/', now: () => new Date(tick).toISOString(), ipSalt: 's' });

beforeAll(async () => {
  server = await tracker.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const get = (path: string) => fetch(base + path);
function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: new Date(tick).toISOString(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}

const env = envelope();
const P = problemHash(env);
let cite1: Hash, cite2: Hash;

describe('the reference tracker', () => {
  it('describes itself', async () => {
    const r = await get('/.well-known/quilt');
    expect(r.status).toBe(200);
    const w = await r.json();
    expect(w.quilt).toBe(1);
    expect(w.identity).toBe(IDENTITY);
  });
  it('publishes an envelope with its blobs and serves both back', async () => {
    const r = await post('/p', { envelope: env, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } });
    expect(r.status).toBe(201);
    expect((await r.json()).hash).toBe(P);
    expect(await (await get(`/p/${P}`)).json()).toEqual(env);
    expect(new Uint8Array(await (await get(`/b/${citesHash}`)).arrayBuffer())).toEqual(cites);
    const state = await (await get(`/p/${P}/state`)).json();
    expect(state.pieces.map((p: { state: string }) => p.state)).toEqual(['open', 'open', 'open']);
    cite1 = state.pieces[0].hash;
    cite2 = state.pieces[1].hash;
  });
  it('refuses an envelope whose brief fails the gate, one not signed by its owner, and one with a missing blob', async () => {
    const linky = envelope('Read https://example.org/{n}', 'linky');
    expect((await (await post('/p', { envelope: linky, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } })).json()).error).toMatch(/no links/);
    const other = envelope('Citation {n}', 'other');
    expect((await (await post('/p', { envelope: { ...other, sig: envelope().sig } })).json()).error).toMatch(/not signed by its owner/);
    const missing = { ...envelope('Citation {n}', 'missing') };
    missing.problem.data = { 'cites.json': hashBytes(new Uint8Array([1])) };
    const unsigned = { quilt: 1 as const, problem: missing.problem, hints: missing.hints };
    expect((await (await post('/p', { envelope: { ...unsigned, sig: signObject(unsigned, owner) } })).json()).error).toMatch(/not present/);
  });
  it('stamps receipts strictly increasing, chains them, and refuses a duplicate', async () => {
    const r1 = await post(`/p/${P}/events`, ev(A, 'claim', { by: by('anthropic/claude') }, P, cite1));
    expect(r1.status).toBe(202);
    const r2 = await post(`/p/${P}/events`, ev(B, 'claim', { by: by('openai/gpt') }, P, cite1));
    const l1 = await r1.json();
    const l2 = await r2.json();
    expect(l2.seq).toBe(l1.seq + 1);
    expect(l2.at > l1.at).toBe(true);
    const dup = await post(`/p/${P}/events`, ev(A, 'claim', { by: by('anthropic/claude') }, P, cite1));
    expect(dup.status).toBe(409);
    const lines = (await (await get(`/p/${P}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as Receipt);
    expect(lines).toHaveLength(2);
    expect(verifyChain(lines, P).ok).toBe(true);
    const scrape = await (await get(`/p/${P}/scrape`)).json();
    expect(scrape.chain_ok).toBe(true);
    expect(scrape.head.seq).toBe(2);
    expect(scrape.counts.in_flight).toBe(1);
  });
  it('refuses a reveal with no commit, a return outside the schema, and a return the gate refuses', async () => {
    const nonce = newNonce();
    const orphan = ev(A, 'reveal', { return: { verdict: 'supports', quote: 'q' }, nonce, by: by('a/x') }, P, cite1);
    expect((await (await post(`/p/${P}/events`, orphan)).json()).error).toBe('no unrevealed commit by this key on the piece');
    tick += 1000;
    const bad = { verdict: 'maybe', quote: 'q' };
    expect((await post(`/p/${P}/events`, ev(A, 'commit', { h: commitHash(bad, nonce) }, P, cite1))).status).toBe(202);
    expect((await (await post(`/p/${P}/events`, ev(A, 'reveal', { return: bad, nonce, by: by('a/x') }, P, cite1))).json()).error).toMatch(/return.verdict/);
    const linky = { verdict: 'supports', quote: 'see https://x.y/z' };
    const n2 = newNonce();
    expect((await post(`/p/${P}/events`, ev(C, 'commit', { h: commitHash(linky, n2) }, P, cite1))).status).toBe(202);
    expect((await (await post(`/p/${P}/events`, ev(C, 'reveal', { return: linky, nonce: n2, by: by('a/x') }, P, cite1))).json()).error).toMatch(/no links/);
  });
  it('accepts agreement across vendors and hands out pieces with short holds', async () => {
    tick += 1000;
    for (const [k, model, quote] of [[A, 'anthropic/claude', 'q1'], [B, 'openai/gpt', 'q2']] as const) {
      const ret = { verdict: 'supports', quote };
      const nonce = newNonce();
      expect((await post(`/p/${P}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, P, cite2))).status).toBe(202);
      tick += 1000;
      expect((await post(`/p/${P}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, cite2))).status).toBe(202);
      tick += 1000;
    }
    const state = await (await get(`/p/${P}/state`)).json();
    expect(state.pieces[1].state).toBe('accepted_provisional');
    const n1 = await (await get(`/p/${P}/next?key=${addr(C)}&can=web&model=meta/llama`)).json();
    const n2 = await (await get(`/p/${P}/next?key=${addr(D)}&can=web&model=meta/llama`)).json();
    expect(n1.piece).not.toBeNull();
    expect(n2.piece).not.toBeNull();
    expect(n1.piece).not.toBe(n2.piece);
    expect(n1.brief).toMatch(/^Citation \d: /);
    expect((await (await get(`/p/${P}/next?key=${addr(C).toLowerCase()}&can=web`)).json()).error).toMatch(/checksum/);
  });
  it('keeps identity events in their own log and announcements in the index', async () => {
    const name = ev(A, 'name', { name: 'Ada' });
    expect((await post('/k/events', name)).status).toBe(202);
    expect((await (await post(`/p/${P}/events`, ev(A, 'name', { name: 'Ada' }, P))).json()).error).toMatch(/identity log/);
    const lines = (await (await get('/k/events')).text()).trim().split('\n').map((l) => JSON.parse(l) as Receipt);
    expect(lines).toHaveLength(1);
    expect(verifyChain(lines, IDENTITY).ok).toBe(true);
    const announce = ev(owner, 'announce', { title: env.problem.title, slug: env.problem.slug, done_when: env.problem.done_when, topics: ['citations', 'ai-safety'], counts: {}, trackers: [], mirrors: [] }, P);
    expect((await post(`/p/${P}/events`, announce)).status).toBe(202);
    const lying = ev(owner, 'announce', { title: 'Something else', slug: env.problem.slug, done_when: env.problem.done_when, topics: [] }, P);
    expect((await (await post(`/p/${P}/events`, lying)).json()).error).toMatch(/announce: title/);
    const found = await (await get('/search?q=ai-safety')).json();
    expect(found.problems.map((p: { problem: string }) => p.problem)).toEqual([P]);
    expect(found.problems[0].topics).toEqual(['citations', 'ai-safety']);
    expect((await (await get('/search?q=nothing-like-this')).json()).problems).toEqual([]);
    const home = await (await get('/')).json();
    expect(home.problems[0].title).toBe('A report');
  });
  it('resolves a name through a version event', async () => {
    const version = ev(owner, 'version', { slug: 'report', hash: P }, P);
    expect((await post(`/p/${P}/events`, version)).status).toBe(202);
    expect((await (await get(`/n/${addr(owner)}/report`)).json()).hash).toBe(P);
  });
});
