import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, commitHash, hashBytes, newNonce, problemHash } from '@bitquilt/core';
import { type Route as TableRow, handlerOf, segmentsOf } from '../src/routes.js';
import { type Booted, addr, boot, envelope, key } from './helpers.js';

/**
 * The door's routes (PROTOCOL.md, The tracker; QX-17 for the coin's): the status each route the well-known document
 * lists answers, for every method it takes and for a method it refuses, beside the two paths it answers unlisted and
 * OPTIONS on every path; the 404 an unknown problem gets before any of its sub-routes; the coin's routes on a tracker
 * that carries the coin, its fallbacks there, and the 404 every path under /coin gets on a tracker that does not,
 * with a path that only opens with /coin answered as an unknown path on both. These rows are held to the door's table
 * (routes.ts), whose rows the well-known document lists: the list is these rows' names in their order, each row's
 * path is checked against the name it is listed under, and each path these rows ask finds its own row of the table,
 * in the table's order, with every row of the table found. The address's hourly limit: the five writes the table
 * takes are the ones it counts, each spends one address's budget and is refused once it is spent, before its body is
 * read; a read, a listing, a 405 and a guard's 404 spend nothing. A path the URL reader cannot read, such as `//`, is
 * answered as an unknown path is. And the table's own words: a row's path takes a request's path whole, each
 * placeholder one segment of its kind and a final `/*` the path before it and every path under it, and a method the
 * row has no handler for is answered by its GET only where the row says so.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  treasury = key(7),
  reader = key(40);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['stance'],
  properties: { stance: { enum: ['asserts', 'denies'] } },
};
const env = envelope(
  owner,
  'routes',
  {
    question: {
      verifier: 'record:2',
      requires: ['web'],
      brief: 'Does the statement hold? Read it your way.',
      schema,
      agree: ['stance'],
    },
  },
  { title: 'Two readings' },
);
const P = problemHash(env);
const UNKNOWN = `sha256:${'0'.repeat(64)}` as Hash;
const KEPT = new TextEncoder().encode('A page this tracker keeps.');
const KEPT_HASH = hashBytes(KEPT);
const NO_ROUTE = 'no such route';
const NO_COIN = 'this tracker carries no coin';

const T0 = '2026-11-07T00:00:00.000Z';
const coin = {
  genesis: T0,
  epoch_h: 24,
  emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 },
  vesting_h: 48,
  infra_bp: 1000,
  treasury: addr(treasury),
  unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 },
  burn_rate: 100,
  transfers_from: T0,
  redeem_from: T0,
  reader: addr(reader),
};
const limits = { keyPerHour: 1000, ipPerHour: 10000 };
const plain = boot('2026-11-07T12:00:00Z', { limits });
const coined = boot('2026-11-07T12:00:00Z', { limits, coin });
let question: Hash;
let lockId: Hash;

/** What a request is answered with: its status, and the refusal's sentence where the door refuses. */
interface Answer {
  status: number;
  error?: string;
}
/** One method on a route, the body it sends, and what the door answers it today. */
interface Ask extends Answer {
  method: string;
  body?: () => string | Uint8Array;
}
/**
 * A path the door answers, in the order of the door's table: the name the well-known lists it under, or null where it
 * lists none; whether it is the coin's; and each method asked of it.
 */
interface Route {
  listed: string | null;
  coin?: true;
  path: string;
  query?: string;
  asks: Ask[];
}

const get = (status: number, error?: string): Ask => ({ method: 'GET', status, ...(error ? { error } : {}) });
const post = (status: number, error?: string): Ask => ({ method: 'POST', status, ...(error ? { error } : {}) });
const sent = (event: unknown) => () => JSON.stringify(event);

/**
 * Every route, in the order of the door's table. Built once a test runs, when the setup has made what the rows name.
 */
function routes(t: Booted): Route[] {
  const { ev } = t;
  const asked = `key=${addr(D)}&can=web&model=google/gemini`;
  return [
    { listed: null, path: '/.well-known/quilt', asks: [get(200), post(404, NO_ROUTE)] },
    {
      listed: '/p',
      path: '/p',
      asks: [{ method: 'POST', body: sent({ envelope: env }), status: 201 }, get(404, NO_ROUTE)],
    },
    { listed: '/p/<hash>', path: `/p/${P}`, asks: [get(200), post(405, 'GET')] },
    {
      listed: '/p/<hash>/events',
      path: `/p/${P}/events`,
      asks: [
        get(200),
        {
          method: 'POST',
          body: () =>
            sent(
              ev(
                owner,
                'announce',
                { title: env.problem.title, slug: env.problem.slug, done_when: env.problem.done_when, topics: [] },
                P,
              ),
            )(),
          status: 202,
        },
        { method: 'PUT', status: 405, error: 'GET' },
      ],
    },
    { listed: '/p/<hash>/state', path: `/p/${P}/state`, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/scrape', path: `/p/${P}/scrape`, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/next', path: `/p/${P}/next`, query: asked, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/challenges', path: `/p/${P}/challenges`, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/panels', path: `/p/${P}/panels`, asks: [get(200), post(405, 'GET')] },
    { listed: '/p/<hash>/record', path: `/p/${P}/record`, asks: [get(200), post(405, 'GET')] },
    // Any method but POST lists the identity log.
    {
      listed: '/k/events',
      path: '/k/events',
      asks: [
        get(200),
        { method: 'POST', body: () => sent(ev(C, 'name', { name: 'Cleo' }))(), status: 202 },
        { method: 'PUT', status: 200 },
      ],
    },
    { listed: '/k/<address>/standing', path: `/k/${addr(A)}/standing`, asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/k/<address>/work', path: `/k/${addr(A)}/work`, asks: [get(200), post(404, NO_ROUTE)] },
    {
      listed: '/b/<hash>',
      path: `/b/${KEPT_HASH}`,
      asks: [{ method: 'PUT', body: () => KEPT, status: 202 }, get(200), post(404, NO_ROUTE)],
    },
    { listed: '/n/<owner>/<slug>', path: `/n/${addr(owner)}/routes`, asks: [get(200), post(404, NO_ROUTE)] },
    { listed: null, path: '/', asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/search', path: '/search', asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/offer', path: '/offer', query: asked, asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/hidden', path: '/hidden', asks: [get(200), post(404, NO_ROUTE)] },
    { listed: '/counts', path: '/counts', asks: [get(200), post(404, NO_ROUTE)] },
    // Any method but POST lists the coin log.
    {
      listed: '/coin/events',
      coin: true,
      path: '/coin/events',
      asks: [
        get(200),
        {
          method: 'POST',
          body: () => sent(ev(reader, 'credit', { deposit: 2, root: addr(C), amount: 10 }))(),
          status: 202,
        },
        { method: 'PUT', status: 200 },
      ],
    },
    { listed: '/coin/lock/<id>', coin: true, path: `/coin/lock/${lockId}`, asks: [get(200), post(405, 'GET')] },
    {
      listed: '/coin/balance/<root>',
      coin: true,
      path: `/coin/balance/${addr(B)}`,
      asks: [get(200), post(405, 'GET')],
    },
    { listed: '/coin/epochs', coin: true, path: '/coin/epochs', asks: [get(200), post(405, 'GET')] },
    { listed: '/coin/redeems', coin: true, path: '/coin/redeems', asks: [get(200), post(405, 'GET')] },
    { listed: '/coin/credits', coin: true, path: '/coin/credits', asks: [get(200), post(405, 'GET')] },
    { listed: '/coin/state', coin: true, path: '/coin/state', asks: [get(200), post(405, 'GET')] },
    // Under /coin the method is asked before the path: a GET finds no route, any other method is told GET.
    { listed: null, coin: true, path: '/coin/nope', asks: [get(404, NO_ROUTE), post(405, 'GET')] },
  ];
}

/**
 * What the door answers a request: its status, and the sentence of a refusal written as JSON. With `client`, the
 * request names that address as the one the trusted proxy saw it from.
 */
async function answer(
  t: Booted,
  method: string,
  path: string,
  body?: string | Uint8Array,
  client?: string,
): Promise<Answer> {
  const r = await fetch(t.base + path, {
    method,
    ...(body === undefined ? {} : { body }),
    ...(client ? { headers: { 'x-forwarded-for': client } } : {}),
  });
  if (r.status >= 400 && (r.headers.get('content-type') ?? '').startsWith('application/json'))
    return { status: r.status, error: ((await r.json()) as { error: string }).error };
  await r.arrayBuffer();
  return { status: r.status };
}

/**
 * What the door answers a request whose target is sent as written: fetch reads a URL before it sends it, and would
 * send `/\` as `//`.
 */
function sentAsWritten(t: Booted, method: string, target: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: new URL(t.base).port, method, path: target }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        const json = status >= 400 && (res.headers['content-type'] ?? '').startsWith('application/json');
        resolve(json ? { status, error: (JSON.parse(body) as { error: string }).error } : { status });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** A commit and its reveal from one key on the record piece. */
async function reading(t: Booted, k: Uint8Array, model: string, stance: string): Promise<void> {
  const ret = { stance };
  const nonce = newNonce();
  await t.accepted(`/p/${P}/events`, t.ev(k, 'commit', { h: commitHash(ret, nonce) }, P, question));
  await t.accepted(`/p/${P}/events`, t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, question));
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

describe("the door's routes", () => {
  it("lists every route it answers but the front page and the well-known document, in the order of its table, and the coin's only where it carries the coin", async () => {
    const all = routes(plain);
    const listed = (withCoin: boolean) =>
      all.filter((r) => r.listed !== null && (withCoin || !r.coin)).map((r) => r.listed);
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

  it("finds each path these rows ask at its own row of the door's table, in the table's order, and every row of the table at one of them", () => {
    const table = plain.tracker.routes;
    const found = routes(plain).map((r) => {
      const taking = table.flatMap((row, i) => (segmentsOf(row.path, r.path) ? [i] : []));
      return { r, at: taking[0] ?? -1, taking };
    });
    expect(table.length).toBeGreaterThan(20);
    let last = 0;
    for (const { r, at, taking } of found) {
      expect(at, `${r.path} finds no row`).toBeGreaterThanOrEqual(0);
      expect(at, `${r.path} is found out of the table's order`).toBeGreaterThanOrEqual(last);
      last = at;
      const row = table[at]!;
      expect(row.listed === false ? null : row.path, `${r.path} is listed as its row says`).toBe(r.listed);
      expect(row.guard === 'coin', `${r.path} is the coin's as its row says`).toBe(r.coin === true);
      // The first row that takes a path answers it: where a later row takes it too, the first answers every method, so
      // the later is never asked.
      if (taking.length > 1) expect(row.otherwise, `${r.path} is taken by two rows`).toBeDefined();
    }
    for (const [i, row] of table.entries())
      expect(
        found.some((f) => f.at === i),
        `${row.path} is asked by no row here`,
      ).toBe(true);
  });

  it("answers each route's methods on a tracker without the coin, OPTIONS on every path, and 404 for every path under /coin", async () => {
    for (const r of routes(plain).filter((x) => !x.coin)) {
      const path = r.query ? `${r.path}?${r.query}` : r.path;
      for (const a of r.asks)
        expect(await answer(plain, a.method, path, a.body?.()), `${a.method} ${r.path}`).toEqual({
          status: a.status,
          ...(a.error ? { error: a.error } : {}),
        });
      expect((await answer(plain, 'OPTIONS', r.path)).status, `OPTIONS ${r.path}`).toBe(204);
    }
    for (const path of ['/coin/events', '/coin/state', '/coin/nope', '/coin']) {
      for (const method of ['GET', 'POST'])
        expect(await answer(plain, method, path), `${method} ${path}`).toEqual({ status: 404, error: NO_COIN });
    }
    expect(await answer(plain, 'GET', '/nothing')).toEqual({ status: 404, error: NO_ROUTE });
  });

  it("answers the coin's routes and their fallbacks on a tracker that carries the coin", async () => {
    for (const r of routes(coined).filter((x) => x.coin)) {
      for (const a of r.asks)
        expect(await answer(coined, a.method, r.path, a.body?.()), `${a.method} ${r.path}`).toEqual({
          status: a.status,
          ...(a.error ? { error: a.error } : {}),
        });
      expect((await answer(coined, 'OPTIONS', r.path)).status, `OPTIONS ${r.path}`).toBe(204);
    }
    expect(await answer(coined, 'GET', '/coin')).toEqual({ status: 404, error: NO_ROUTE });
  });

  it('answers a path that opens with /coin and is not under it as an unknown path, with the coin or without', async () => {
    for (const t of [plain, coined])
      for (const path of ['/coins', '/coinage', '/coin-state', '/coin.json'])
        for (const method of ['GET', 'POST', 'PUT'])
          expect(await answer(t, method, path), `${method} ${path}`).toEqual({ status: 404, error: NO_ROUTE });
  });

  it('answers a path the URL reader cannot read as an unknown path: OPTIONS as on every path, and 404 for the rest', async () => {
    // Each of these makes `new URL(path, base)` throw: an empty host, a broken one, a port out of range, a backslash.
    const unreadable = ['//', '///', '//[', '//a:b', '//:99999', '//%zz', '//a%2fb', '/\\'];
    for (const t of [plain, coined]) {
      for (const target of unreadable) {
        for (const method of ['GET', 'POST', 'PUT'])
          expect(await sentAsWritten(t, method, target), `${method} ${target}`).toEqual({
            status: 404,
            error: NO_ROUTE,
          });
        expect(await sentAsWritten(t, 'OPTIONS', target), `OPTIONS ${target}`).toEqual({ status: 204 });
      }
    }
  });

  it('answers 404 for a problem it does not hold before any of its sub-routes, whatever the method', async () => {
    for (const sub of ['', '/events', '/state', '/scrape', '/next', '/challenges', '/panels', '/record']) {
      for (const method of ['GET', 'POST', 'PUT'])
        expect(await answer(plain, method, `/p/${UNKNOWN}${sub}`), `${method} /p/<unknown>${sub}`).toEqual({
          status: 404,
          error: 'no such problem here',
        });
    }
  });
});

describe("the address's hourly limit", () => {
  const ipPerHour = 3;
  const capped = boot('2026-11-07T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour }, coin });
  const coinless = boot('2026-11-07T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour } });
  const OVER: Answer = { status: 429, error: "over the hour's limit" };
  /** A body no write takes: refused once it is read, so a write sent it changes nothing but the address's budget. */
  const BODY = 'not JSON';
  /**
   * The writes the limit counts, in the table's order: the method, the path the row is listed under, a path it takes,
   * and what the body above gets while the budget holds.
   */
  const WRITES = [
    { method: 'POST', row: '/p', path: '/p', malformed: 'not JSON' },
    { method: 'POST', row: '/p/<hash>/events', path: `/p/${P}/events`, malformed: 'not JSON' },
    { method: 'POST', row: '/k/events', path: '/k/events', malformed: 'not JSON' },
    { method: 'PUT', row: '/b/<hash>', path: `/b/${KEPT_HASH}`, malformed: 'the bytes do not match the hash' },
    { method: 'POST', row: '/coin/events', path: '/coin/events', malformed: 'not JSON' },
  ];
  /** The reads on the writes' paths, and the listing any method but POST gets on the two logs. */
  const READS = [
    { method: 'GET', path: '/p' },
    { method: 'GET', path: `/p/${P}/events` },
    { method: 'GET', path: '/k/events' },
    { method: 'PUT', path: '/k/events' },
    { method: 'GET', path: `/b/${KEPT_HASH}` },
    { method: 'GET', path: '/coin/events' },
    { method: 'PUT', path: '/coin/events' },
  ];
  let clients = 0;
  /** An address no request has come from yet, so its hour's budget is whole. */
  const fresh = () => `203.0.113.${++clients}`;
  /** What each read answers the address. */
  async function reads(t: Booted, from: string): Promise<Answer[]> {
    const answers: Answer[] = [];
    for (const r of READS) answers.push(await answer(t, r.method, r.path, undefined, from));
    return answers;
  }
  /**
   * Spends the address's whole budget on one write and holds that it is spent: the body refused once for each hit the
   * hour allows, then 429.
   */
  async function spend(t: Booted, from: string, w: (typeof WRITES)[number]): Promise<void> {
    for (let i = 0; i < ipPerHour; i++)
      expect(await answer(t, w.method, w.path, BODY, from), `${w.method} ${w.path} inside the budget`).toEqual({
        status: 400,
        error: w.malformed,
      });
    expect(await answer(t, w.method, w.path, BODY, from), `${w.method} ${w.path} past the budget`).toEqual(OVER);
  }

  beforeAll(async () => {
    for (const t of [capped, coinless]) {
      await t.listen();
      expect((await t.post('/p', { envelope: env })).status).toBe(201);
    }
  });
  afterAll(async () => {
    await capped.close();
    await coinless.close();
  });

  it('counts the writes of every row that takes a method other than GET, and those are these five', () => {
    const taken = capped.tracker.routes.flatMap((row) =>
      (['POST', 'PUT'] as const).flatMap((method) => (row[method] ? [`${method} ${row.path}`] : [])),
    );
    expect(taken).toEqual(WRITES.map((w) => `${w.method} ${w.row}`));
  });

  it('refuses every write once any one of them has spent the budget, before the body is read, and answers every read as before', async () => {
    for (const [t, writes] of [
      [capped, WRITES],
      [coinless, WRITES.filter((w) => w.row !== '/coin/events')],
    ] as const) {
      for (const spender of writes) {
        const from = fresh();
        const before = await reads(t, from);
        await spend(t, from, spender);
        for (const w of writes)
          expect(
            await answer(t, w.method, w.path, BODY, from),
            `${w.method} ${w.path} once ${spender.method} ${spender.path} spent the budget`,
          ).toEqual(OVER);
        expect(await reads(t, from), `the reads once ${spender.method} ${spender.path} spent the budget`).toEqual(
          before,
        );
      }
    }
  });

  it("spends nothing on a read, a listing, a method a row does not take, or a path its guard refuses, and the guard's 404 comes before the 429", async () => {
    const unknown = { status: 404, error: 'no such problem here' };
    const told = { status: 405, error: 'GET' };
    const from = fresh();
    const first = await reads(capped, from);
    for (let i = 0; i <= ipPerHour; i++) {
      expect(await reads(capped, from)).toEqual(first);
      expect(await answer(capped, 'POST', `/p/${UNKNOWN}/events`, BODY, from)).toEqual(unknown);
      expect(await answer(capped, 'POST', `/p/${P}`, BODY, from)).toEqual(told);
      expect(await answer(capped, 'PUT', `/p/${P}/events`, BODY, from)).toEqual(told);
    }
    await spend(capped, from, WRITES[2]!);
    expect(await answer(capped, 'POST', `/p/${UNKNOWN}/events`, BODY, from)).toEqual(unknown);
    expect(await answer(capped, 'POST', `/p/${P}`, BODY, from)).toEqual(told);

    // On a tracker without the coin, every path under /coin is refused before the limit is asked.
    const coinFrom = fresh();
    for (let i = 0; i <= ipPerHour; i++)
      for (const method of ['POST', 'PUT'])
        expect(await answer(coinless, method, '/coin/events', BODY, coinFrom), `${method} /coin/events`).toEqual({
          status: 404,
          error: NO_COIN,
        });
    await spend(coinless, coinFrom, WRITES[2]!);
    expect(await answer(coinless, 'POST', '/coin/events', BODY, coinFrom)).toEqual({ status: 404, error: NO_COIN });
  });
});

describe("the door's table", () => {
  const HASH = `sha256:${'ab'.repeat(32)}`;
  const ADDRESS = '0x00000000000000000000000000000000000000Ab';

  it('takes a path whole, each placeholder one segment of its kind, and names the segments it took', () => {
    expect(segmentsOf('/p/<hash>', `/p/${HASH}`)).toEqual({ hash: HASH });
    expect(segmentsOf('/p/<hash>/state', `/p/${HASH}/state`)).toEqual({ hash: HASH });
    expect(segmentsOf('/p/<hash>', `/p/${HASH}/state`)).toBeNull();
    expect(segmentsOf('/p/<hash>', `/p/${HASH.toUpperCase()}`)).toBeNull();
    expect(segmentsOf('/p/<hash>', `/p/sha256:${'ab'.repeat(31)}`)).toBeNull();
    expect(segmentsOf('/coin/lock/<id>', `/coin/lock/${HASH}`)).toEqual({ id: HASH });
    // An address in any case: its checksum is the handler's to check.
    expect(segmentsOf('/k/<address>/standing', `/k/${ADDRESS}/standing`)).toEqual({ address: ADDRESS });
    expect(segmentsOf('/k/<address>/standing', `/k/${ADDRESS.toLowerCase()}/standing`)).toEqual({
      address: ADDRESS.toLowerCase(),
    });
    expect(segmentsOf('/coin/balance/<root>', `/coin/balance/${ADDRESS.slice(0, -1)}`)).toBeNull();
    expect(segmentsOf('/n/<owner>/<slug>', `/n/${ADDRESS}/a-slug-9`)).toEqual({ owner: ADDRESS, slug: 'a-slug-9' });
    expect(segmentsOf('/n/<owner>/<slug>', `/n/${ADDRESS}/A-Slug`)).toBeNull();
    expect(segmentsOf('/n/<owner>/<slug>', `/n/${ADDRESS}/${'a'.repeat(65)}`)).toBeNull();
    // The literal text is literal: the dot in the well-known path is a dot.
    expect(segmentsOf('/.well-known/quilt', '/.well-known/quilt')).toEqual({});
    expect(segmentsOf('/.well-known/quilt', '/Xwell-known/quilt')).toBeNull();
    expect(segmentsOf('/', '/')).toEqual({});
    expect(segmentsOf('/', '/search')).toBeNull();
  });

  it('takes the path before a final /* and every path under it, and no path that only opens with it', () => {
    for (const path of ['/coin', '/coin/nope', '/coin/lock/x', '/coin//x'])
      expect(segmentsOf('/coin/*', path)).toEqual({});
    for (const path of ['/coins', '/coinage', '/coi', '/x/coin', '/']) expect(segmentsOf('/coin/*', path)).toBeNull();
  });

  it('refuses a placeholder that is no kind of segment', () => {
    expect(() => segmentsOf('/p/<piece>', '/p/x')).toThrow('no kind of segment');
    expect(() => segmentsOf('/p/<constructor>', '/p/x')).toThrow('no kind of segment');
  });

  it("runs a method's own handler, the GET for any other method only where the row says so, and none otherwise", () => {
    const GET = () => {};
    const POST = () => {};
    const listing: TableRow = { path: '/k/events', otherwise: 'GET', GET, POST };
    const told: TableRow = { path: '/p/<hash>', otherwise: 405, GET };
    const passed: TableRow = { path: '/search', GET };
    expect(handlerOf(listing, 'POST')).toBe(POST);
    expect(handlerOf(listing, 'PUT')).toBe(GET);
    expect(handlerOf(listing, 'HEAD')).toBe(GET);
    expect(handlerOf(told, 'GET')).toBe(GET);
    expect(handlerOf(told, 'POST')).toBeUndefined();
    expect(handlerOf(passed, 'DELETE')).toBeUndefined();
    expect(handlerOf(passed, 'constructor')).toBeUndefined();
  });
});
