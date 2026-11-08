import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type Hash, eventId, hashBytes, problemHash } from '@bitquilt/core';
import type { Route } from '../src/routes.js';
import { addr, boot, envelope, key } from './helpers.js';

/**
 * PROTOCOL.md, The tracker, held to the door's table (`Tracker.routes`) and to the door. The rows under "### Routes"
 * name the table's paths in the table's order, all but its last row, the fallback under /coin that the prose says;
 * a row says unlisted where its path's row is left out of the well-known document, and QX-17 where its path's row
 * asks for the coin; each row's methods are the ones its table rows have handlers for, and the door takes each of
 * them; the scrape's row names every field the scrape answers, and `/` and `/search` give each problem the same
 * without `chain_ok`. Then what the door answers, as the prose names it: a method a row has no handler for, 405 under
 * a problem and the coin, the log at the two logs that read it so, the fallback's 404, and the routes mounted beside
 * the tracker asked once no row answered, and not for a path that cannot be read as a URL; any origin allowed on
 * every answer the tracker writes itself, and nothing added to what the routes beside it write; a post asked in the
 * prose's order, its guard first and its address's limit before its body is read; the fields of the piece next hands
 * over, the rows under "### The piece next hands over";
 * a post's answer, and 409 for it again; the signature's text form, with a `v` of 0 or 1 taken and any other
 * refused; the limits as published, the address's counting every write and the key's every post; and the hold, on
 * the piece next hands over and on the first the offer names, for 60 seconds. And The problem envelope's checks at
 * publish: the gate on the title, done_when and briefs, a prev held and by the same owner, a from by another owner
 * where it is held and taken where it is not, and the coin's home's bound on the window. Every name the document
 * places in a file of the code (`name` in `packages/...`) is declared in that file. The refusals column is not read.
 * The on-ramp's table is packages/hosted/test/onramp-table.test.ts's, the node's is
 * packages/client/test/node-table.test.ts's, and the table's own words, each route's statuses and the address's limit
 * are routes.test.ts's.
 */
const DOC = readFileSync(new URL('../../../docs/PROTOCOL.md', import.meta.url), 'utf8');
const owner = key(9),
  A = key(1);
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['holds', 'fails'] } },
};
const brief = 'Does the statement hold? Answer holds or fails.';
const piece = { verifier: 'agree', requires: ['web' as const], brief, schema, agree: ['verdict'] };
const env = envelope(owner, 'table', { claim: piece }, { title: 'One statement' });
const P = problemHash(env);
const T0 = '2026-11-07T00:00:00.000Z';
const coin = {
  genesis: T0,
  epoch_h: 24,
  emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 },
  vesting_h: 48,
  infra_bp: 1000,
  treasury: addr(key(7)),
  unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 },
  burn_rate: 100,
  transfers_from: T0,
  redeem_from: T0,
  reader: addr(key(40)),
};
const limits = { keyPerHour: 1000, ipPerHour: 10000 };
const plain = boot('2026-11-07T12:00:00Z', { limits });
const coined = boot('2026-11-07T12:00:00Z', { limits, coin });
const asked = `key=${addr(A)}&model=anthropic/claude`;

/** A table row's cells, trimmed. */
const cells = (line: string): string[] =>
  line
    .slice(1, -1)
    .split('|')
    .map((c) => c.trim());

/** The rows of the first table under a heading of PROTOCOL.md, each a list of its cells, header and rule left out. */
function table(heading: string): string[][] {
  const lines = DOC.split('\n');
  const at = lines.indexOf(heading);
  if (at < 0) throw new Error(`PROTOCOL.md has no heading ${heading}`);
  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('#')) break;
    if (line.startsWith('|')) rows.push(cells(line));
    else if (rows.length) break;
  }
  return rows.slice(2);
}

/** The names a cell gives in backticks. */
const named = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** A row of the tracker's route table: its paths, its methods, and what it says it answers. */
interface Row {
  paths: string[];
  methods: string[];
  answers: string;
}
function routes(): Row[] {
  return table('### Routes').map(([paths, methods, answers]) => ({
    paths: named(paths!),
    methods: methods!.split(',').map((m) => m.trim()),
    answers: answers!,
  }));
}

/** A path a row names, with each placeholder filled by something the door can be asked about. */
function filled(path: string): string {
  return path
    .replace('<hash>', P)
    .replace(/<(address|owner|root)>/, addr(A))
    .replace('<slug>', 'table')
    .replace('<id>', `sha256:${'0'.repeat(64)}`);
}

/** What the door answers a method on a path: its status, and the refusal's sentence where it wrote one as JSON. */
async function answer(base: string, method: string, path: string): Promise<{ status: number; error?: string }> {
  const r = await fetch(base + path, { method, ...(method === 'GET' ? {} : { body: '' }) });
  if (r.status >= 400 && (r.headers.get('content-type') ?? '').startsWith('application/json')) {
    return { status: r.status, error: ((await r.json()) as { error: string }).error };
  }
  await r.arrayBuffer();
  return { status: r.status };
}

let listed: { plain: string[]; coined: string[] };

beforeAll(async () => {
  for (const t of [plain, coined]) {
    await t.listen();
    expect((await t.post('/p', { envelope: env })).status).toBe(201);
  }
  listed = {
    plain: (await plain.get<{ routes: string[] }>('/.well-known/quilt')).routes,
    coined: (await coined.get<{ routes: string[] }>('/.well-known/quilt')).routes,
  };
});
afterAll(async () => {
  await plain.close();
  await coined.close();
});

/** The methods a row of the door's table has a handler for. */
const handled = (row: Route): string[] => (['GET', 'POST', 'PUT'] as const).filter((m) => row[m] !== undefined);
/** The door's table on the tracker that carries the coin, where every row of it is asked. */
const doorTable = (): readonly Route[] => coined.tracker.routes;
/** The row of the door's table a path of PROTOCOL.md's table names. */
const rowOf = (path: string): Route => {
  const row = doorTable().find((r) => r.path === path);
  if (!row) throw new Error(`${path} is no row of the door's table`);
  return row;
};

describe("PROTOCOL.md, the tracker's route table", () => {
  it("names the door's table's paths in the table's order, all but its last row, which the prose says", () => {
    const paths = routes().flatMap((r) => r.paths);
    const last = doorTable().at(-1)!;
    expect(paths).toEqual(
      doorTable()
        .map((r) => r.path)
        .filter((p) => p !== last.path),
    );
    // The last row is the fallback: its path ends in `*`, so it takes every path that starts with what comes before.
    expect(last.path).toBe('/coin*');
    expect(DOC).toContain(
      'Its last row is left out here: it takes every other path under `/coin`, where a `GET` is `404`, `no such route`.',
    );
    expect(listed.coined.length).toBeGreaterThan(listed.plain.length);
    expect(paths.filter((p) => listed.coined.includes(p))).toEqual(listed.coined);
  });

  it('says unlisted where the table leaves a row out of the well-known document, and QX-17 where a row asks for the coin', async () => {
    for (const r of routes()) {
      for (const p of r.paths) {
        const row = rowOf(p);
        expect(r.answers.includes('unlisted'), `${p} says unlisted as its row is`).toBe(row.listed === false);
        expect(listed.coined.includes(p), `${p} is listed as its row says`).toBe(row.listed !== false);
        expect(listed.plain.includes(p), `${p} is listed without the coin as its row says`).toBe(
          row.listed !== false && row.guard !== 'coin',
        );
        if (row.guard === 'coin') expect(r.answers, `${p} is listed only with the coin`).toContain('QX-17');
        if (row.listed === false)
          expect((await answer(plain.base, 'GET', filled(p))).status, `${p} is answered`).toBe(200);
      }
    }
  });

  it('names for each row the methods its rows of the door have handlers for, and the door takes each of them', async () => {
    for (const r of routes()) {
      expect(r.methods.length, `${r.paths.join(', ')} names its methods`).toBeGreaterThan(0);
      for (const p of r.paths) {
        expect([...r.methods].sort(), `the methods of ${p}`).toEqual(handled(rowOf(p)).sort());
        for (const method of r.methods) {
          const a = await answer(coined.base, method, filled(p));
          expect(a.status, `${method} ${p}`).not.toBe(405);
          expect(a, `${method} ${p}`).not.toEqual({ status: 404, error: 'no such route' });
        }
      }
    }
  });

  it("names the scrape's fields, and / and /search give each problem the same without chain_ok", async () => {
    const row = (path: string): Row => routes().find((r) => r.paths.includes(path))!;
    const scrape = await plain.get<Record<string, unknown>>(`/p/${P}/scrape`);
    expect(named(row('/p/<hash>/scrape').answers).sort()).toEqual(Object.keys(scrape).sort());
    const { chain_ok: _, ...summary } = scrape;
    const front = await plain.get<{ problems: Record<string, unknown>[] }>('/');
    expect(named(row('/').answers)[0]).toBe(`{ ${Object.keys(front).join(', ')} }`);
    expect(row('/').answers).toContain('without `chain_ok`');
    const search = await plain.get<{ problems: Record<string, unknown>[] }>('/search?q=statement');
    expect(front.problems.length).toBe(1);
    expect(search.problems.length).toBe(1);
    for (const p of [...front.problems, ...search.problems]) {
      expect(Object.keys(p).sort()).toEqual(Object.keys(summary).sort());
    }
  });
});

describe('PROTOCOL.md, what the door answers', () => {
  it('answers a method a row has no handler for as the prose says, and asks the routes beside the tracker once no row answered', async () => {
    expect(DOC).toContain(
      'At `/k/events` and `/coin/events` any method but `POST` reads the log; elsewhere under `/p/<hash>` and `/coin`, a method the row has no handler for is `405`, `GET`.',
    );
    for (const path of ['/k/events', '/coin/events']) {
      const r = await fetch(coined.base + path, { method: 'PUT', body: '' });
      expect(r.status, `PUT ${path}`).toBe(200);
      expect(r.headers.get('content-type'), `PUT ${path}`).toContain('application/x-ndjson');
      await r.arrayBuffer();
    }
    expect(await answer(coined.base, 'PUT', `/p/${P}/events`)).toEqual({ status: 405, error: 'GET' });
    expect(await answer(coined.base, 'PUT', '/coin/epochs')).toEqual({ status: 405, error: 'GET' });
    // The table's last row, under /coin: a GET there finds no route, and any other method is told GET.
    expect(await answer(coined.base, 'GET', '/coin/nothing')).toEqual({ status: 404, error: 'no such route' });
    expect(await answer(coined.base, 'POST', '/coin/nothing')).toEqual({ status: 405, error: 'GET' });
    expect(DOC).toContain(
      "Last, a request no row answered goes to the routes mounted beside the tracker, such as the on-ramp's, and is `404`, `no such route`, where none of them takes it.",
    );
    const beside = boot('2026-11-07T12:00:00Z', {
      limits,
      extra: async (req, res, u) => {
        if (u.pathname === '/declined') return false;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ beside: `${req.method} ${u.pathname}` }));
        return true;
      },
    });
    /** What the tracker with routes beside it answers: its status and its JSON. */
    const asked = async (method: string, path: string): Promise<{ status: number; body: unknown }> => {
      const r = await fetch(beside.base + path, { method, ...(method === 'GET' ? {} : { body: '' }) });
      return { status: r.status, body: await r.json() };
    };
    await beside.listen();
    try {
      expect((await beside.post('/p', { envelope: env })).status).toBe(201);
      // A path no row takes, and a method a row without a fallback has no handler for: the routes beside answer.
      expect(await asked('GET', '/elsewhere')).toEqual({ status: 200, body: { beside: 'GET /elsewhere' } });
      expect(await asked('POST', '/search')).toEqual({ status: 200, body: { beside: 'POST /search' } });
      // A guard and a 405 are the door's own, and the routes beside are not asked; where they take nothing, 404.
      const unheld = `sha256:${'0'.repeat(64)}`;
      expect(await asked('POST', `/p/${unheld}`)).toEqual({ status: 404, body: { error: 'no such problem here' } });
      expect(await asked('POST', `/p/${P}`)).toEqual({ status: 405, body: { error: 'GET' } });
      expect(await asked('GET', '/declined')).toEqual({ status: 404, body: { error: 'no such route' } });
      // A path that cannot be read as a URL reaches no route beside the tracker, which would answer anything else.
      expect(DOC).toContain(
        'A path that cannot be read as a URL, such as `//`, is `404`, `no such route`, with none of them asked, since none of them could read it either.',
      );
      expect(await asked('GET', '//')).toEqual({ status: 404, body: { error: 'no such route' } });
    } finally {
      await beside.close();
    }
  });

  it('allows any origin on every answer the tracker writes itself, and adds nothing to what the routes beside it write', async () => {
    expect(DOC).toContain(
      "Every answer the tracker writes itself allows any origin, so a page on any site can read the door: the `204`, each row's answer, a guard's or a row's refusal, the last `404` and the `500`. The routes mounted beside it write their own headers, and the tracker adds none to what they write.",
    );
    const door = boot('2026-11-07T12:00:00Z', {
      limits,
      coin,
      extra: async (_req, res, u) => {
        if (u.pathname === '/fails') throw new Error('a route beside the tracker failed');
        if (u.pathname !== '/beside') return false;
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><title>Beside</title>');
        return true;
      },
    });
    /** What the door answers a method on a path: its status and the origins it allows, null where it names none. */
    const origin = async (base: string, method: string, path: string, body?: Uint8Array) => {
      const r = await fetch(base + path, { method, ...(method === 'GET' ? {} : { body: body ?? '' }) });
      await r.arrayBuffer();
      return { status: r.status, origin: r.headers.get('access-control-allow-origin') };
    };
    const failed = vi.spyOn(console, 'error').mockImplementation(() => {});
    await door.listen();
    try {
      expect(
        await origin(door.base, 'POST', '/p', new TextEncoder().encode(JSON.stringify({ envelope: env }))),
      ).toEqual({ status: 201, origin: '*' });
      const read = new TextEncoder().encode('one read');
      const at = `/b/${hashBytes(read)}`;
      expect(await origin(door.base, 'PUT', at, read)).toEqual({ status: 202, origin: '*' });
      expect(await origin(door.base, 'GET', at)).toEqual({ status: 200, origin: '*' });
      // Each row by every method it has a handler for and by one it has none for: its answer, its refusal, its log,
      // or the last 404 once the routes beside take nothing.
      for (const row of door.tracker.routes) {
        const path = filled(row.path.replace(/\*$/, '/nothing'));
        for (const method of [...handled(row), 'DELETE']) {
          expect((await origin(door.base, method, path)).origin, `${method} ${path}`).toBe('*');
        }
      }
      // The preflight, the two guards, the last 404 and the 500.
      expect(await origin(door.base, 'OPTIONS', '/beside')).toEqual({ status: 204, origin: '*' });
      expect(await origin(door.base, 'GET', `/p/sha256:${'0'.repeat(64)}`)).toEqual({ status: 404, origin: '*' });
      expect(await origin(plain.base, 'GET', '/coin/state')).toEqual({ status: 404, origin: '*' });
      expect(await origin(door.base, 'GET', '/nowhere')).toEqual({ status: 404, origin: '*' });
      expect(await origin(door.base, 'GET', '/fails')).toEqual({ status: 500, origin: '*' });
      // What a route beside the tracker writes reaches the reader with its own headers and nothing the tracker adds.
      expect(await origin(door.base, 'GET', '/beside')).toEqual({ status: 200, origin: null });
    } finally {
      failed.mockRestore();
      await door.close();
    }
  });

  it('names every field of the piece next hands over, and no other', async () => {
    const fields = table('### The piece next hands over').flatMap(([field]) => named(field!));
    const handed = await plain.get<Record<string, unknown>>(`/p/${P}/next?${asked}&can=web`);
    expect(handed.piece).not.toBeNull();
    expect([...fields].sort()).toEqual(Object.keys(handed).sort());
    const none = await plain.get<Record<string, unknown>>(`/p/${P}/next?${asked}&can=files`);
    expect(DOC).toContain('`{ piece: null, unaffordable }`');
    expect(Object.keys(none).sort()).toEqual(['piece', 'unaffordable']);
  });

  it('answers a post with the fields the prose names, and the same post again with 409', async () => {
    const said = /Taken: `202 \{ ([a-z, ]+) \}`/.exec(DOC);
    expect(said, "the prose names the post's answer").not.toBeNull();
    const at = (await plain.get<{ pieces: { hash: Hash }[] }>(`/p/${P}/state`)).pieces[0]!.hash;
    const event = plain.ev(A, 'claim', { by: { model: 'anthropic/claude', client: 'test/0', can: ['web'] } }, P, at);
    const first = await plain.post(`/p/${P}/events`, event);
    expect(first.status).toBe(202);
    const body = (await first.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(said![1]!.split(', ').sort());
    expect(body.id).toBe(eventId(event));
    const again = await plain.post(`/p/${P}/events`, event);
    expect(DOC).toContain('`409`, `already here`');
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'already here' });
  });

  it("asks a post in the prose's order: the guard, the address's limit before the body is read, then the JSON, the shape, the signature, the key's limit, the log and what it holds", async () => {
    expect(DOC).toContain(
      "Its row's guard comes first, where it has one: the problem held, or the coin carried. Then the row counts the post against its address's hourly limit before the body is read (`limited` in `packages/tracker/src/tracker.ts`), and `postEvent` in `packages/tracker/src/admit.ts` reads the body and checks the JSON, the shape (CORE.md section 4), the signature, the key's limit, the log's admission, and whether it holds the event.",
    );
    const M = key(21),
      B = key(2),
      C = key(3);
    const ordered = boot('2026-11-07T12:00:00Z', { limits: { keyPerHour: 2, ipPerHour: 1 }, maintainers: [addr(M)] });
    let clients = 0;
    /** An address no write has come from, so its hour's one write is whole. */
    const fresh = () => `203.0.113.${++clients}`;
    /** What the door answers a post of `body` to `path` from `from`: its status, and why where it refuses. */
    const sent = async (path: string, body: string, from = fresh()): Promise<{ status: number; error?: string }> => {
      const r = await fetch(ordered.base + path, { method: 'POST', body, headers: { 'x-forwarded-for': from } });
      const { error } = (await r.json()) as { error?: string };
      return error === undefined ? { status: r.status } : { status: r.status, error };
    };
    const over = { status: 429, error: "over the hour's limit" };
    await ordered.listen();
    try {
      expect(await sent('/p', JSON.stringify({ envelope: env }))).toEqual({ status: 201 });
      const at = (await ordered.get<{ pieces: { hash: Hash }[] }>(`/p/${P}/state`)).pieces[0]!.hash;
      // The address's one write spent on a body over 4 MB: the body is read once the limit holds, and not after.
      const spent = fresh();
      const heavy = 'x'.repeat(4 * 1024 * 1024 + 1);
      expect(await sent('/k/events', heavy, spent)).toEqual({ status: 413, error: 'body over 4 MB' });
      expect(await sent('/k/events', heavy, spent)).toEqual(over);
      // Each guard comes before the address's limit: the problem held, and the coin carried.
      const unheld = `sha256:${'0'.repeat(64)}`;
      expect(await sent(`/p/${unheld}/events`, 'not JSON', spent)).toEqual({
        status: 404,
        error: 'no such problem here',
      });
      expect(await sent('/coin/events', 'not JSON', spent)).toEqual({
        status: 404,
        error: 'this tracker carries no coin',
      });
      // The shape before the signature: an event dated in no form is refused for its date.
      const undated = { ...ordered.ev(B, 'name', { name: 'Bo' }), ts: 'yesterday' };
      expect(await sent('/k/events', JSON.stringify(undated))).toEqual({
        status: 400,
        error: 'event.ts: a time, ISO 8601 with a zone',
      });
      // B spends its two posts of the hour.
      for (const name of ['Bo', 'Bea'])
        expect(await sent('/k/events', JSON.stringify(ordered.ev(B, 'name', { name })))).toEqual({ status: 202 });
      // The signature before the key's limit: past B's posts, another key's signature is refused for itself.
      const forged = { ...ordered.ev(C, 'name', { name: 'Bo' }), key: addr(B) };
      expect(await sent('/k/events', JSON.stringify(forged))).toEqual({
        status: 400,
        error: "signature is not the key's",
      });
      // The key's limit before the log's admission: past it, a type the log does not take is refused for the limit.
      expect(await sent('/k/events', JSON.stringify(ordered.ev(B, 'bogus', {})))).toEqual(over);
      // The log's admission before what it holds: once the problem is taken down, the same claim again is 410.
      const claim = ordered.ev(
        C,
        'claim',
        { by: { model: 'anthropic/claude', client: 'test/0', can: ['web'] } },
        P,
        at,
      );
      expect(await sent(`/p/${P}/events`, JSON.stringify(claim))).toEqual({ status: 202 });
      const hide = ordered.ev(M, 'hide', { id: P, why: 'Taken down to test the order.' });
      expect(await sent('/k/events', JSON.stringify(hide))).toEqual({ status: 202 });
      expect(await sent(`/p/${P}/events`, JSON.stringify(claim))).toEqual({
        status: 410,
        error: 'this problem is taken down here',
      });
    } finally {
      await ordered.close();
    }
  });

  it('signs as the prose says, v 27 or 28, and takes a v of 0 or 1 where it refuses another v or form', async () => {
    expect(DOC).toContain('`0x` and 130 lower-case hex characters');
    expect(DOC).toContain('The reference writes `v` as 27 or 28');
    expect(DOC).toContain('The door also recovers a `v` of 0 or 1');
    expect(DOC).toContain('Any other text is refused as `event.sig: a signature`');
    const { sig } = plain.ev(A, 'name', { name: 'Ada' });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(['1b', '1c']).toContain(sig.slice(-2));
    /** A name event of A's, signed and then its signature rewritten. */
    const signed = (rewrite: (sig: string) => string) => {
      const e = plain.ev(A, 'name', { name: 'Ada' });
      return { ...e, sig: rewrite(e.sig) };
    };
    const low = (s: string): string => s.slice(0, -2) + (s.endsWith('1b') ? '00' : '01');
    const odd = (s: string): string => `${s.slice(0, -2)}1d`;
    const upper = (s: string): string => `0x${s.slice(2).toUpperCase()}`;
    const short = (s: string): string => s.slice(0, -2);
    await plain.accepted('/k/events', signed(low));
    expect(await plain.refused('/k/events', signed(odd))).toBe("signature is not the key's");
    for (const form of [upper, short]) {
      expect(await plain.refused('/k/events', signed(form)), form.name).toBe('event.sig: a signature');
    }
  });

  it("publishes the limits the prose names, and counts every write against the address's and every post the key's", async () => {
    const said = /(\d+) posts an hour from a key, and (\d+) writes \(posts, publishes and blob puts\)/.exec(DOC);
    expect(said, 'the prose names the limits').not.toBeNull();
    const fresh = boot('2026-11-07T12:00:00Z');
    await fresh.listen();
    const { limits: published } = await fresh.get<{ limits: { keyPerHour: number; ipPerHour: number } }>(
      '/.well-known/quilt',
    );
    await fresh.close();
    expect([published.keyPerHour, published.ipPerHour]).toEqual([Number(said![1]), Number(said![2])]);
    const tight = boot('2026-11-07T12:00:00Z', { limits: { keyPerHour: 1, ipPerHour: 4 } });
    await tight.listen();
    /** A blob put of a read, its bytes named by their hash. */
    const put = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      return fetch(`${tight.base}/b/${hashBytes(bytes)}`, { method: 'PUT', body: bytes });
    };
    /** A 429's sentence. */
    const over = async (answer: Promise<Response>): Promise<string> => {
      const r = await answer;
      expect(r.status).toBe(429);
      return ((await r.json()) as { error: string }).error;
    };
    try {
      expect((await tight.post('/p', { envelope: env })).status).toBe(201);
      const at = (await tight.get<{ pieces: { hash: Hash }[] }>(`/p/${P}/state`)).pieces[0]!.hash;
      const by = { model: 'anthropic/claude', client: 'test/0', can: ['web'] };
      await tight.accepted(`/p/${P}/events`, tight.ev(A, 'claim', { by }, P, at));
      const name = tight.ev(A, 'name', { name: 'Ada' });
      expect(await over(tight.post('/k/events', name)), "the key's second post").toBe("over the hour's limit");
      expect((await put('the first read')).status, "the address's fourth write").toBe(202);
      expect(await over(put('the second read')), "the address's fifth").toBe("over the hour's limit");
      expect((await fetch(`${tight.base}/p/${P}`)).status, 'a read is no write').toBe(200);
    } finally {
      await tight.close();
    }
  });

  it('holds the piece next hands over, and the first piece the offer names, for that key for 60 seconds', async () => {
    expect(DOC).toContain(
      '`next` holds the piece it hands over, and `/offer` the first piece it offers, for that key for 60 seconds',
    );
    const held = boot('2026-11-07T12:00:00Z', { limits });
    await held.listen();
    const other = { ...piece, brief: 'Does the other statement hold? Answer holds or fails.' };
    const second = envelope(owner, 'other', { claim: other }, { title: 'Another statement' });
    const [B, C] = [key(2), key(3)];
    /** The piece next hands the key on a problem, or null. */
    const handed = async (k: Uint8Array, problem: Hash): Promise<Hash | null> =>
      (await held.get<{ piece: Hash | null }>(`/p/${problem}/next?key=${addr(k)}&can=web&model=openai/gpt`)).piece;
    try {
      for (const e of [env, second]) expect((await held.post('/p', { envelope: e })).status).toBe(201);
      const { offers } = await held.get<{ offers: { problem: Hash; piece: Hash }[] }>(`/offer?${asked}&can=web`);
      expect(offers.length).toBe(2);
      const [first, then] = offers as [{ problem: Hash; piece: Hash }, { problem: Hash; piece: Hash }];
      expect(await handed(B, first.problem), 'the offer holds its first piece').toBeNull();
      expect(await handed(B, then.problem), 'and no other').toBe(then.piece);
      expect(await handed(C, then.problem), 'next holds what it hands over').toBeNull();
      held.clock.tick += 59_000;
      expect(await handed(C, first.problem), 'for 59 seconds').toBeNull();
      held.clock.tick += 1_000;
      expect(await handed(C, first.problem), 'and not for 60').toBe(first.piece);
    } finally {
      await held.close();
    }
  });
});

describe('PROTOCOL.md, The problem envelope, what the reference tracker adds at publish', () => {
  it("gates the text, takes a prev it holds by the same owner and a from it holds by another owner, takes a from it does not hold, and bounds the window at the coin's home", async () => {
    expect(DOC).toContain(
      "At publish (`publish` in `packages/tracker/src/admit.ts`) the reference tracker adds four checks: the gate on the title, `done_when` and briefs; a `prev` it holds, by the same owner; a `from` by another owner, where it holds the problem named; and, at the coin's home, a challenge window within `window_max_h` (QX-17 section 6). A `from` naming a problem it does not hold is taken on the forker's word, as the core takes it.",
    );
    const bare = boot('2026-11-07T12:00:00Z', { limits });
    const home = boot('2026-11-07T12:00:00Z', { limits, coin: { ...coin, window_max_h: 48 } });
    const B = key(2);
    const elsewhere = `sha256:${'cd'.repeat(32)}` as Hash;
    /** An envelope of the table's piece by `k`, with what `extra` says. */
    const one = (k: Uint8Array, slug: string, extra: Parameters<typeof envelope>[3] = {}) =>
      envelope(k, slug, { claim: piece }, extra);
    const taken = async (t: typeof bare, e: ReturnType<typeof envelope>) =>
      expect((await t.post('/p', { envelope: e })).status, e.problem.slug).toBe(201);
    try {
      for (const t of [bare, home]) {
        await t.listen();
        await taken(t, env);
      }
      const linked = 'Read example.com, then answer holds or fails.';
      expect(await bare.refused('/p', { envelope: one(owner, 'title', { title: linked }) })).toBe(
        'title: no links or markup',
      );
      expect(await bare.refused('/p', { envelope: one(owner, 'done', { done_when: linked }) })).toBe(
        'done_when: no links or markup',
      );
      const briefed = envelope(owner, 'brief', { claim: { ...piece, brief: linked } });
      expect(await bare.refused('/p', { envelope: briefed })).toBe('pieces.claim.brief: no links or markup');
      expect(await bare.refused('/p', { envelope: one(owner, 'unheld', { prev: elsewhere }) })).toBe(
        'prev: not a problem this tracker holds',
      );
      expect(await bare.refused('/p', { envelope: one(B, 'theirs', { prev: P }) })).toBe('prev: by another owner');
      await taken(bare, one(owner, 'table', { title: 'One statement, again', prev: P }));
      expect(await bare.refused('/p', { envelope: one(owner, 'mine', { from: P }) })).toBe(
        'from: by the same owner; a version sets prev',
      );
      await taken(bare, one(B, 'fork', { from: P }));
      await taken(bare, one(B, 'fork-elsewhere', { from: elsewhere }));
      const patient = one(owner, 'patient', { settings: { challenge_window_h: 72 } });
      expect(await home.refused('/p', { envelope: patient })).toBe(
        'the challenge window of 72 hours is beyond the 48 this home admits (QX-17)',
      );
      await taken(bare, patient);
    } finally {
      await bare.close();
      await home.close();
    }
  });
});

describe("PROTOCOL.md's names in the code", () => {
  it('declares in each file of the code every name the document places there', () => {
    const placed = [...DOC.matchAll(/((?:`[A-Za-z_][\w.]*`(?:, | and )?)+) in `(packages\/[\w./-]+\.ts)`/g)];
    expect(placed.length).toBeGreaterThan(5);
    for (const [, names, file] of placed) {
      const source = readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');
      for (const name of named(names!)) {
        // A name is declared as a function, a constant, a class, an interface or a type; a member after a dot, as a
        // method or a field of the one before it.
        const [first, ...members] = name.split('.');
        const declared = new RegExp(`\\b(?:function\\*?|const|let|class|interface|type)\\s+${first}\\b`);
        expect(declared.test(source), `${name} in ${file}`).toBe(true);
        for (const member of members) {
          const held = new RegExp(`^\\s*(?:readonly\\s+)?(?:async\\s+)?${member}\\s*[(:?<]`, 'm');
          expect(held.test(source), `${name} in ${file}`).toBe(true);
        }
      }
    }
  });
});
