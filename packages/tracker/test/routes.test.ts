import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, commitHash, hashBytes, newNonce, problemHash } from '@bitquilt/core';
import { type Booted, addr, boot, envelope, key } from './helpers.js';

/**
 * The door's routes (PROTOCOL.md, The tracker; QX-17 for the coin's): the status each route the well-known document
 * lists answers, for every method it takes and for a method it refuses, beside the two paths it answers unlisted and
 * OPTIONS on every path; the 404 an unknown problem gets before any of its sub-routes; the coin's routes on a tracker
 * that carries the coin, its fallbacks there, and the 404 every path under /coin gets on a tracker that does not. The
 * list is held to the dispatcher in `handle`: the list is these rows' names in their order, each row's path is checked
 * against the name it is listed under, and every test `handle` makes of a path is one of these rows, made in the rows'
 * order.
 */
const owner = key(9), A = key(1), B = key(2), C = key(3), D = key(4), treasury = key(7), reader = key(40);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['stance'], properties: { stance: { enum: ['asserts', 'denies'] } } };
const env = envelope(owner, 'routes', { question: { verifier: 'record:2', requires: ['web'], brief: 'Does the statement hold? Read it your way.', schema, agree: ['stance'] } }, { title: 'Two readings' });
const P = problemHash(env);
const UNKNOWN = `sha256:${'0'.repeat(64)}` as Hash;
const KEPT = new TextEncoder().encode('A page this tracker keeps.');
const KEPT_HASH = hashBytes(KEPT);
const NO_ROUTE = 'no such route';
const NO_COIN = 'this tracker carries no coin';

const T0 = '2026-11-07T00:00:00.000Z';
const coin = {
  genesis: T0, epoch_h: 24, emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 }, vesting_h: 48, infra_bp: 1000, treasury: addr(treasury), unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 }, burn_rate: 100, transfers_from: T0, redeem_from: T0, reader: addr(reader),
};
const limits = { keyPerHour: 1000, ipPerHour: 10000 };
const plain = boot('2026-11-07T12:00:00Z', { limits });
const coined = boot('2026-11-07T12:00:00Z', { limits, coin });
let question: Hash;
let lockId: Hash;

/** What a request is answered with: its status, and the refusal's sentence where the door refuses. */
interface Answer { status: number; error?: string }
/** One method on a route, the body it sends, and what the door answers it today. */
interface Ask extends Answer { method: string; body?: () => string | Uint8Array }
/** A path the door answers, in the order `handle` tests it: the name the well-known lists it under, or null where it lists none; whether it is the coin's; and each method asked of it. */
interface Route { listed: string | null; coin?: true; path: string; query?: string; asks: Ask[] }

const get = (status: number, error?: string): Ask => ({ method: 'GET', status, ...(error ? { error } : {}) });
const post = (status: number, error?: string): Ask => ({ method: 'POST', status, ...(error ? { error } : {}) });
const sent = (event: unknown) => () => JSON.stringify(event);

/** Every route, in the order `handle` tests the paths. Built once a test runs, when the setup has made what the rows name. */
function routes(t: Booted): Route[] {
  const { ev } = t;
  const asked = `key=${addr(D)}&can=web&model=google/gemini`;
  return [
    { listed: null, path: '/.well-known/quilt', asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/p', path: '/p', asks: [{ method: 'POST', body: sent({ envelope: env }), status: 201 }, get(404, NO_ROUTE)] },
    { listed: '/p/<hash>', path: `/p/${P}`, asks: [get(200), post(405, 'GET')] },
    {
      listed: '/p/<hash>/events', path: `/p/${P}/events`,
      asks: [get(200), { method: 'POST', body: () => sent(ev(owner, 'announce', { title: env.problem.title, slug: env.problem.slug, done_when: env.problem.done_when, topics: [] }, P))(), status: 202 }, { method: 'PUT', status: 405, error: 'GET' }],
    },
    { listed: '/p/<hash>/state', path: `/p/${P}/state`, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/scrape', path: `/p/${P}/scrape`, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/next', path: `/p/${P}/next`, query: asked, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/challenges', path: `/p/${P}/challenges`, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/panels', path: `/p/${P}/panels`, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/record', path: `/p/${P}/record`, asks: [get(200), post(405, 'GET')] },
    // Any method but POST lists the identity log.
    { listed: '/k/events', path: '/k/events', asks: [get(200), { method: 'POST', body: () => sent(ev(C, 'name', { name: 'Cleo' }))(), status: 202 }, { method: 'PUT', status: 200 }] },
    { listed: '/k/<address>/standing', path: `/k/${addr(A)}/standing`, asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/k/<address>/work', path: `/k/${addr(A)}/work`, asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/b/<hash>', path: `/b/${KEPT_HASH}`, asks: [{ method: 'PUT', body: () => KEPT, status: 202 }, get(200), post(404, NO_ROUTE)] },
    { listed: '/n/<owner>/<slug>', path: `/n/${addr(owner)}/routes`, asks: [get(200), post(404, NO_ROUTE)] },
    { listed: null, path: '/', asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/search', path: '/search', asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/offer', path: '/offer', query: asked, asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/hidden', path: '/hidden', asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/counts', path: '/counts', asks: [get(200), post(404, NO_ROUTE)] },
    // Any method but POST lists the coin log.
    { listed: '/coin/events', coin: true, path: '/coin/events', asks: [get(200), { method: 'POST', body: () => sent(ev(reader, 'credit', { deposit: 2, root: addr(C), amount: 10 }))(), status: 202 }, { method: 'PUT', status: 200 }] },
    { listed: '/coin/lock/<id>', coin: true, path: `/coin/lock/${lockId}`, asks: [get(200), post(405, 'GET')] },
    { listed: '/coin/balance/<root>', coin: true, path: `/coin/balance/${addr(B)}`, asks: [get(200), post(405, 'GET')] },
    { listed: '/coin/epochs', coin: true, path: '/coin/epochs', asks: [get(200), post(405, 'GET')] },
    { listed: '/coin/redeems', coin: true, path: '/coin/redeems', asks: [get(200), post(405, 'GET')] },
    { listed: '/coin/credits', coin: true, path: '/coin/credits', asks: [get(200), post(405, 'GET')] },
    { listed: '/coin/state', coin: true, path: '/coin/state', asks: [get(200), post(405, 'GET')] },
    // Under /coin the method is asked before the path: a GET finds no route, any other method is told GET.
    { listed: null, coin: true, path: '/coin/nope', asks: [get(404, NO_ROUTE), post(405, 'GET')] },
    { listed: null, coin: true, path: '/coins', asks: [get(404, NO_ROUTE), post(405, 'GET')] },
  ];
}

/** What the door answers a request: its status, and the sentence of a refusal written as JSON. */
async function answer(t: Booted, method: string, path: string, body?: string | Uint8Array): Promise<Answer> {
  const r = await fetch(t.base + path, { method, ...(body === undefined ? {} : { body }) });
  if (r.status >= 400 && (r.headers.get('content-type') ?? '').startsWith('application/json')) return { status: r.status, error: ((await r.json()) as { error: string }).error };
  await r.arrayBuffer();
  return { status: r.status };
}

/** A commit and its reveal from one key on the record piece. */
async function reading(t: Booted, k: Uint8Array, model: string, stance: string): Promise<void> {
  const ret = { stance };
  const nonce = newNonce();
  await t.accepted(`/p/${P}/events`, t.ev(k, 'commit', { h: commitHash(ret, nonce) }, P, question));
  await t.accepted(`/p/${P}/events`, t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, question));
}

/** Every test `handle` makes of the path, in the order its source makes them: a literal it is compared with, a pattern run on it, or a prefix. */
function pathTests(): { text: string; matches: (path: string) => boolean; words: string[] }[] {
  const source = readFileSync(new URL('../src/tracker.ts', import.meta.url), 'utf8');
  const handle = source.slice(source.indexOf('async function handle('), source.indexOf('function listen('));
  return [...handle.matchAll(/path === '([^']+)'|\/(\^[^\n]*?\$)\/\.exec\(path\)|path\.startsWith\('([^']+)'\)/g)].map((m) => {
    const [text, literal, pattern, prefix] = m as unknown as [string, string | undefined, string | undefined, string | undefined];
    if (literal !== undefined) return { text, matches: (p: string) => p === literal, words: [] };
    if (pattern !== undefined) {
      const re = new RegExp(pattern);
      const words = [...pattern.matchAll(/\(([a-z]+(?:\|[a-z]+)+)\)/g)].flatMap((g) => g[1]!.split('|'));
      return { text, matches: (p: string) => re.test(p), words };
    }
    return { text, matches: (p: string) => p.startsWith(prefix!), words: [] };
  });
}

beforeAll(async () => {
  for (const t of [plain, coined]) {
    await t.listen();
    expect((await t.post('/p', { envelope: env })).status).toBe(201);
  }
  question = (await plain.get<{ pieces: { hash: Hash }[] }>(`/p/${P}/state`)).pieces[0]!.hash;
  // Two readings record the piece, so the problem is complete and its record document is stated.
  await reading(plain, A, 'anthropic/claude', 'asserts');
  await reading(plain, B, 'openai/gpt', 'denies');
  await plain.accepted(`/p/${P}/events`, plain.ev(owner, 'version', { slug: 'routes', hash: P }, P));
  // A deposit credited to B, and a lock of B's coin on the piece, so the coin's routes have something to answer.
  await coined.accepted('/coin/events', coined.ev(reader, 'credit', { deposit: 1, root: addr(B), amount: 100 }));
  lockId = await coined.accepted('/coin/events', coined.ev(B, 'lock', { problem: P, piece: question, amount: 50 }));
});
afterAll(async () => {
  await plain.close();
  await coined.close();
});

describe('the door\'s routes', () => {
  it('lists every route it answers but the front page and the well-known document, in the order `handle` tests them, and the coin\'s only where it carries the coin', async () => {
    const all = routes(plain);
    const listed = (withCoin: boolean) => all.filter((r) => r.listed !== null && (withCoin || !r.coin)).map((r) => r.listed);
    expect((await plain.get<{ routes: string[] }>('/.well-known/quilt')).routes).toEqual(listed(false));
    expect((await coined.get<{ routes: string[] }>('/.well-known/quilt')).routes).toEqual(listed(true));
  });

  it('asks each listed route at a path its name describes, each placeholder standing for one segment', () => {
    for (const r of routes(plain)) {
      if (r.listed === null) continue;
      const name = new RegExp(`^${r.listed.replace(/<[a-z]+>/g, '[^/]+')}$`);
      expect(name.test(r.path), `${r.path} is no ${r.listed}`).toBe(true);
    }
  });

  it('tests each path in `handle` as one of these rows, in the rows\' order, and names a row for every sub-route a pattern takes', () => {
    const rows = routes(plain).map((r) => r.path);
    const tests = pathTests();
    expect(tests.length).toBeGreaterThan(20);
    let last = 0;
    for (const t of tests) {
      const first = rows.findIndex((p) => t.matches(p));
      expect(first, `${t.text} tests no row`).toBeGreaterThanOrEqual(0);
      expect(first, `${t.text} is tested out of the rows' order`).toBeGreaterThanOrEqual(last);
      last = first;
      for (const w of t.words) expect(rows.some((p) => t.matches(p) && p.endsWith(`/${w}`)), `${t.text} takes ${w}, which no row names`).toBe(true);
    }
    for (const p of rows) expect(tests.some((t) => t.matches(p)), `${p} is tested nowhere in handle`).toBe(true);
  });

  it('answers each route\'s methods on a tracker without the coin, OPTIONS on every path, and 404 for every path under /coin', async () => {
    for (const r of routes(plain).filter((x) => !x.coin)) {
      const path = r.query ? `${r.path}?${r.query}` : r.path;
      for (const a of r.asks) expect(await answer(plain, a.method, path, a.body?.()), `${a.method} ${r.path}`).toEqual({ status: a.status, ...(a.error ? { error: a.error } : {}) });
      expect((await answer(plain, 'OPTIONS', r.path)).status, `OPTIONS ${r.path}`).toBe(204);
    }
    for (const path of ['/coin/events', '/coin/state', '/coin/nope', '/coins', '/coin']) {
      for (const method of ['GET', 'POST']) expect(await answer(plain, method, path), `${method} ${path}`).toEqual({ status: 404, error: NO_COIN });
    }
    expect(await answer(plain, 'GET', '/nothing')).toEqual({ status: 404, error: NO_ROUTE });
  });

  it('answers the coin\'s routes and their fallbacks on a tracker that carries the coin', async () => {
    for (const r of routes(coined).filter((x) => x.coin)) {
      for (const a of r.asks) expect(await answer(coined, a.method, r.path, a.body?.()), `${a.method} ${r.path}`).toEqual({ status: a.status, ...(a.error ? { error: a.error } : {}) });
      expect((await answer(coined, 'OPTIONS', r.path)).status, `OPTIONS ${r.path}`).toBe(204);
    }
    expect(await answer(coined, 'GET', '/coin')).toEqual({ status: 404, error: NO_ROUTE });
  });

  it('answers 404 for a problem it does not hold before any of its sub-routes, whatever the method', async () => {
    for (const sub of ['', '/events', '/state', '/scrape', '/next', '/challenges', '/panels', '/record']) {
      for (const method of ['GET', 'POST', 'PUT']) expect(await answer(plain, method, `/p/${UNKNOWN}${sub}`), `${method} /p/<unknown>${sub}`).toEqual({ status: 404, error: 'no such problem here' });
    }
  });
});
