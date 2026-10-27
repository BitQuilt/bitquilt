import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, type Receipt, commitHash, hashBytes, newNonce, problemHash, verifyChain } from '@bitquilt/core';
import { IDENTITY } from '../src/tracker.js';
import { addr, boot, envelope, json, key } from './helpers.js';

/**
 * The core at the tracker's door: the well-known document; an envelope published with its blobs and served back, or
 * refused at the gate, unsigned, or with a blob missing; receipts stamped strictly increasing and chained, a duplicate
 * refused; a reveal refused with no commit, outside the schema, or through the gate; agreement across vendors
 * accepted and pieces handed out with short holds; the identity log kept apart and announcements in the index; a name
 * resolved through a version event.
 */
const owner = key(9), A = key(1), B = key(2), C = key(3), D = key(4), E = key(5);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };
const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }, { s: 'two' }, { s: 'three' }]));
const citesHash = hashBytes(cites);

function report(brief = 'Citation {n}: {cite.s}', slug = 'report'): Envelope {
  return envelope(owner, slug, { 'cite/*': { count: 3, verifier: 'agree', requires: ['web'], brief, data: { cite: 'cites.json' }, schema, agree: ['verdict'] } }, { title: 'A report', done_when: 'Every citation has a verdict.', data: { 'cites.json': citesHash } });
}

const t = boot('2026-10-24T18:00:00Z');
const { ev, post, get } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type StateView = { pieces: { hash: Hash; state: string }[] };
type Next = { piece: Hash | null; brief: string; error?: string };

const env = report();
const P = problemHash(env);
let cite1: Hash, cite2: Hash;

describe('the reference tracker', () => {
  it('serves its well-known document with its name, limits, layers and coin', async () => {
    const r = await fetch(`${t.base}/.well-known/quilt`);
    expect(r.status).toBe(200);
    const w = await json<{ quilt: number; tracker: string; limits: { keyPerHour: number; ipPerHour: number }; identity: string; challenge: { extension: string }; stake: { extension: string; coin: string | null }; gold: { extension: string }; coin: unknown; routes: string[] }>(r);
    expect(w.quilt).toBe(1);
    expect(w.tracker).toBe('http://tracker.test/');
    expect(w.limits).toEqual({ keyPerHour: 120, ipPerHour: 600 });
    expect(w.identity).toBe(IDENTITY);
    expect(w.challenge.extension).toBe('QX-1');
    expect(w.stake).toEqual({ extension: 'QX-15', coin: null });
    expect(w.gold).toEqual({ extension: 'QX-16' });
    expect(w.coin).toBeNull();
    expect(w.routes).toContain('/p/<hash>/state');
    expect(w.routes).not.toContain('/coin/events');
  });
  it('publishes an envelope with its blobs and serves both back', async () => {
    const r = await post('/p', { envelope: env, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } });
    expect(r.status).toBe(201);
    expect((await json<{ hash: Hash }>(r)).hash).toBe(P);
    expect(await get(`/p/${P}`)).toEqual(env);
    expect(new Uint8Array(await (await fetch(`${t.base}/b/${citesHash}`)).arrayBuffer())).toEqual(cites);
    const state = await get<StateView>(`/p/${P}/state`);
    expect(state.pieces.map((p) => p.state)).toEqual(['open', 'open', 'open']);
    cite1 = state.pieces[0]!.hash;
    cite2 = state.pieces[1]!.hash;
  });
  it('refuses an envelope whose brief fails the gate, one not signed by its owner, and one with a missing blob', async () => {
    const linky = report('Read https://example.org/{n}', 'linky');
    expect((await json<{ error: string }>(post('/p', { envelope: linky, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } }))).error).toMatch(/no links/);
    const other = report('Citation {n}', 'other');
    expect((await json<{ error: string }>(post('/p', { envelope: { ...other, sig: report().sig } }))).error).toMatch(/not signed by its owner/);
    const missing = envelope(owner, 'missing', report('Citation {n}').problem.pieces, { title: 'A report', done_when: 'Every citation has a verdict.', data: { 'cites.json': hashBytes(new Uint8Array([1])) } });
    expect((await json<{ error: string }>(post('/p', { envelope: missing }))).error).toMatch(/not present/);
  });
  it('stamps receipts strictly increasing, chains them, and refuses a duplicate', async () => {
    const claim = ev(A, 'claim', { by: by('anthropic/claude') }, P, cite1);
    const r1 = await post(`/p/${P}/events`, claim);
    expect(r1.status).toBe(202);
    const r2 = await post(`/p/${P}/events`, ev(B, 'claim', { by: by('openai/gpt') }, P, cite1));
    const l1 = await json<{ seq: number; at: string }>(r1);
    const l2 = await json<{ seq: number; at: string }>(r2);
    expect(l2.seq).toBe(l1.seq + 1);
    expect(l2.at > l1.at).toBe(true);
    const dup = await post(`/p/${P}/events`, claim);
    expect(dup.status).toBe(409);
    const lines = (await (await fetch(`${t.base}/p/${P}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as Receipt);
    expect(lines).toHaveLength(2);
    expect(verifyChain(lines, P).ok).toBe(true);
    const scrape = await get<{ chain_ok: boolean; head: { seq: number }; counts: Record<string, number> }>(`/p/${P}/scrape`);
    expect(scrape.chain_ok).toBe(true);
    expect(scrape.head.seq).toBe(2);
    expect(scrape.counts.in_flight).toBe(1);
  });
  it('refuses a reveal with no commit, a return outside the schema, and a return the gate refuses', async () => {
    const nonce = newNonce();
    const orphan = ev(A, 'reveal', { return: { verdict: 'supports', quote: 'q' }, nonce, by: by('a/x') }, P, cite1);
    expect(await t.refused(`/p/${P}/events`, orphan)).toBe('no unrevealed commit by this key on the piece');
    const bad = { verdict: 'maybe', quote: 'q' };
    await t.accepted(`/p/${P}/events`, ev(A, 'commit', { h: commitHash(bad, nonce) }, P, cite1));
    expect(await t.refused(`/p/${P}/events`, ev(A, 'reveal', { return: bad, nonce, by: by('a/x') }, P, cite1))).toMatch(/return.verdict/);
    const linky = { verdict: 'supports', quote: 'see https://x.y/z' };
    const n2 = newNonce();
    await t.accepted(`/p/${P}/events`, ev(C, 'commit', { h: commitHash(linky, n2) }, P, cite1));
    expect(await t.refused(`/p/${P}/events`, ev(C, 'reveal', { return: linky, nonce: n2, by: by('a/x') }, P, cite1))).toMatch(/no links/);
  });
  it('accepts agreement across vendors and hands out pieces with short holds', async () => {
    for (const [k, model, quote] of [[A, 'anthropic/claude', 'q1'], [B, 'openai/gpt', 'q2']] as const) {
      const ret = { verdict: 'supports', quote };
      const nonce = newNonce();
      await t.accepted(`/p/${P}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, P, cite2));
      await t.accepted(`/p/${P}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, cite2));
    }
    const state = await get<StateView>(`/p/${P}/state`);
    expect(state.pieces[1]!.state).toBe('accepted_provisional');
    const n1 = await get<Next>(`/p/${P}/next?key=${addr(C)}&can=web&model=meta/llama`);
    const n2 = await get<Next>(`/p/${P}/next?key=${addr(D)}&can=web&model=meta/llama`);
    expect(n1.piece).not.toBeNull();
    expect(n2.piece).not.toBeNull();
    expect(n1.piece).not.toBe(n2.piece);
    expect(n1.brief).toMatch(/^Citation \d: /);
    expect((await get<Next>(`/p/${P}/next?key=${addr(C).toLowerCase()}&can=web`)).error).toMatch(/checksum/);
    // A hold is spent by its key's reveal: the piece goes to the next key at once, not when the hold's minute is up.
    const ret = { verdict: 'contradicts', quote: 'q3' };
    const nonce = newNonce();
    await t.accepted(`/p/${P}/events`, ev(C, 'commit', { h: commitHash(ret, nonce) }, P, n1.piece!));
    await t.accepted(`/p/${P}/events`, ev(C, 'reveal', { return: ret, nonce, by: by('meta/llama') }, P, n1.piece!));
    const n3 = await get<Next>(`/p/${P}/next?key=${addr(E)}&can=web&model=google/gemini`);
    expect(n3.piece).toBe(n1.piece);
  });
  it('keeps identity events in their own log and announcements in the index', async () => {
    const name = ev(A, 'name', { name: 'Ada' });
    expect((await post('/k/events', name)).status).toBe(202);
    expect(await t.refused(`/p/${P}/events`, ev(A, 'name', { name: 'Ada' }, P))).toMatch(/identity log/);
    const lines = (await (await fetch(`${t.base}/k/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as Receipt);
    expect(lines).toHaveLength(1);
    expect(verifyChain(lines, IDENTITY).ok).toBe(true);
    const announce = ev(owner, 'announce', { title: env.problem.title, slug: env.problem.slug, done_when: env.problem.done_when, topics: ['citations', 'ai-safety'], counts: {}, trackers: [], mirrors: [] }, P);
    expect((await post(`/p/${P}/events`, announce)).status).toBe(202);
    const lying = ev(owner, 'announce', { title: 'Something else', slug: env.problem.slug, done_when: env.problem.done_when, topics: [] }, P);
    expect(await t.refused(`/p/${P}/events`, lying)).toMatch(/announce: title/);
    type Found = { problems: { problem: Hash; topics: string[]; title: string }[] };
    const found = await get<Found>('/search?q=ai-safety');
    expect(found.problems.map((p) => p.problem)).toEqual([P]);
    expect(found.problems[0]!.topics).toEqual(['citations', 'ai-safety']);
    expect((await get<Found>('/search?q=nothing-like-this')).problems).toEqual([]);
    const home = await get<Found>('/');
    expect(home.problems[0]!.title).toBe('A report');
  });
  it('resolves a name through a version event', async () => {
    const version = ev(owner, 'version', { slug: 'report', hash: P }, P);
    expect((await post(`/p/${P}/events`, version)).status).toBe(202);
    expect((await get<{ hash: Hash }>(`/n/${addr(owner)}/report`)).hash).toBe(P);
  });
});
