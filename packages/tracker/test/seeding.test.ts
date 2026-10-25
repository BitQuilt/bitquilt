import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { type Address, type Envelope, type Hash, type Unsigned, addressOf, commitHash, newNonce, signEvent, signObject } from '@bitquilt/core';
import { Store } from '../src/store.js';
import { createTracker } from '../src/tracker.js';
import { TENTH } from '../src/seeding.js';

/**
 * QX-4 and QX-5 at the tracker: seeders and the last seed read off `seed` events; a watch piece offered to a seeder
 * first and kept from others for its lease; and the offer: the problems of people who have worked for the asker
 * first, the rest rarest first, every tenth offer a newcomer's, and never the asker's own.
 */
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const A = key(1), O1 = key(2), O2 = key(3), O3 = key(4), X = key(5), S = key(6), B = key(7);
const addr = addressOf;
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };

function envelope(owner: Uint8Array, slug: string, count: number, watch = 0): Envelope {
  const pieces: Envelope['problem']['pieces'] = { 'statement/*': { count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } };
  if (watch) pieces['watch/*'] = { count: watch, verifier: 'agree', requires: ['web'], brief: 'Watch {n}: is the paper still where it was, and does it still say so?', schema, agree: ['verdict'] };
  const problem: Envelope['problem'] = {
    title: `Statements (${slug})`, done_when: 'Every statement has a verdict.', owner: addr(owner), slug, prev: null, from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 100, patch_max: 10000 },
    pieces, data: {},
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

let server: Server;
let base: string;
const store = new Store(':memory:');
let tick = Date.parse('2026-10-26T09:00:00Z');
const HOUR = 3_600_000;
const tracker = createTracker({ store, url: 'http://tracker.test/', now: () => new Date(tick).toISOString(), ipSalt: 's', limits: { keyPerHour: 1000, ipPerHour: 10000 } });

beforeAll(async () => {
  server = await tracker.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const get = async (path: string) => (await fetch(base + path)).json();
function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  tick += 1000;
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: new Date(tick).toISOString(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}
async function accepted(path: string, event: unknown): Promise<Hash> {
  const r = await post(path, event);
  expect(r.status, await r.clone().text()).toBe(202);
  return ((await r.json()) as { id: Hash }).id;
}
async function publish(e: Envelope): Promise<Hash> {
  const r = await post('/p', { envelope: e, blobs: {} });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
async function pieceNamed(problem: Hash, name: string): Promise<Hash> {
  const s = (await get(`/p/${problem}/state`)) as { pieces: { hash: Hash; name: string }[] };
  return s.pieces.find((p) => p.name === name)!.hash;
}
/** A commit and its reveal from one key, agreeing on `verdict`. */
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string) {
  const ret = { verdict: 'supports', quote: `as ${addr(k).slice(0, 6)} read it` };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
const nextFor = async (problem: Hash, k: Uint8Array) => (await get(`/p/${problem}/next?key=${addr(k)}&can=web&model=meta/llama`)) as { piece: Hash | null; name?: string };
type Offer = { problem: Hash; owner: Address; reason: string; name: string };
const offerFor = async (k: Uint8Array) => (await get(`/offer?key=${addr(k)}&can=web&model=meta/llama`)) as { offer: number; offers: Offer[] };

let PA: Hash, P1: Hash, P2: Hash, P3: Hash;

describe('the offer (QX-5)', () => {
  it('puts the problems of those who worked for the asker first, the rest rarest first, and never the asker\'s own', async () => {
    PA = await publish(envelope(A, 'by-a', 2));
    P1 = await publish(envelope(O1, 'by-o1', 3, 1));
    P2 = await publish(envelope(O2, 'by-o2', 3));
    P3 = await publish(envelope(O3, 'by-o3', 3));
    // O1 and X work for A: an accepting set on A's problem. O3 and X work on O1's: O3 has accepted work, but not for A.
    const pa1 = await pieceNamed(PA, 'statement/1');
    await returnOn(PA, pa1, O1, 'anthropic/claude');
    await returnOn(PA, pa1, X, 'openai/gpt');
    const p11 = await pieceNamed(P1, 'statement/1');
    await returnOn(P1, p11, O3, 'anthropic/claude');
    await returnOn(P1, p11, X, 'openai/gpt');
    const o = await offerFor(A);
    expect(o.offer).toBe(1);
    expect(o.offers.map((x) => x.problem)).not.toContain(PA);
    expect(o.offers[0]!.problem).toBe(P1);
    expect(o.offers[0]!.reason).toBe('reciprocal');
    expect(o.offers.slice(1).map((x) => x.problem).sort()).toEqual([P2, P3].sort());
    expect(o.offers.slice(1).every((x) => x.reason === 'rarest')).toBe(true);
    // A problem with no piece for the asker is left out: X has revealed on every problem it could be offered here except its own... X owns nothing, so all four are its candidates.
    const ox = await offerFor(X);
    expect(ox.offers.map((x) => x.problem).sort()).toEqual([PA, P1, P2, P3].sort());
  });
  it('gives every tenth offer to a newcomer\'s problem', async () => {
    let last: { offer: number; offers: Offer[] } | null = null;
    for (let i = 2; i <= TENTH; i++) last = await offerFor(A);
    expect(last!.offer).toBe(TENTH);
    expect(last!.offers[0]!.problem).toBe(P2);
    expect(last!.offers[0]!.reason).toBe('newcomer');
    const after = await offerFor(A);
    expect(after.offer).toBe(TENTH + 1);
    expect(after.offers[0]!.problem).toBe(P1);
  });
  it('refuses a key without its checksum and a capability it does not know', async () => {
    expect(((await get(`/offer?key=${addr(A).toLowerCase()}&can=web`)) as { error: string }).error).toMatch(/checksum/);
    expect(((await get(`/offer?key=${addr(A)}&can=flying`)) as { error: string }).error).toMatch(/can:/);
  });
});

describe('seeding (QX-4)', () => {
  it('counts seeders and keeps the last seed from seed events, and refuses a malformed one', async () => {
    const before = (await get(`/p/${P1}/scrape`)) as { seeders: number; last_seeded: string | null };
    expect(before.seeders).toBe(0);
    expect(before.last_seeded).toBeNull();
    const r = await post(`/p/${P1}/events`, ev(S, 'seed', { on: 'yes' }, P1));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/seed\.on/);
    await accepted(`/p/${P1}/events`, ev(S, 'seed', { on: true }, P1));
    const seededAt = new Date(tick).toISOString();
    const on = (await get(`/p/${P1}/scrape`)) as { seeders: number; last_seeded: string | null };
    expect(on.seeders).toBe(1);
    expect(on.last_seeded).toBe(seededAt);
    const listed = ((await get('/search?q=by-o1')) as { problems: { seeders: number; last_seeded: string | null }[] }).problems[0]!;
    expect(listed.seeders).toBe(1);
    expect(listed.last_seeded).toBe(seededAt);
  });
  it('hands a seeder the watch piece first and keeps it from others for its lease', async () => {
    const watch = await pieceNamed(P1, 'watch/1');
    expect((await nextFor(P1, S)).piece).toBe(watch);
    expect((await nextFor(P1, B)).piece).not.toBe(watch);
    tick += 3 * HOUR;
    const seen = new Set<Hash>();
    for (let i = 0; i < 4; i++) {
      const n = await nextFor(P1, B);
      if (!n.piece) break;
      seen.add(n.piece);
      if (n.piece === watch) break;
      await accepted(`/p/${P1}/events`, ev(B, 'decline', { reason: 'no_time' }, P1, n.piece));
    }
    expect(seen.has(watch)).toBe(true);
  });
  it('a seed off ends the seeding and leaves the last seed as it was', async () => {
    const was = (await get(`/p/${P1}/scrape`)) as { last_seeded: string | null };
    await accepted(`/p/${P1}/events`, ev(S, 'seed', { on: false }, P1));
    const off = (await get(`/p/${P1}/scrape`)) as { seeders: number; last_seeded: string | null };
    expect(off.seeders).toBe(0);
    expect(off.last_seeded).toBe(was.last_seeded);
    const wk = (await get('/.well-known/quilt')) as { seeding: string; reciprocity: string; routes: string[] };
    expect(wk.seeding).toBe('QX-4');
    expect(wk.reciprocity).toBe('QX-5');
    expect(wk.routes).toContain('/offer');
  });
});
