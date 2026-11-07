import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, eventId, problemHash } from '@bitquilt/core';
import { addr, boot, envelope, key } from './helpers.js';

/**
 * PROTOCOL.md, The tracker, held to the door: every path the well-known document lists, with the coin and without,
 * has a row in the table under "### Routes", in the list's order; every row names a listed path or one the door answers
 * unlisted, and a path listed only with the coin sits in a row that says QX-17; each method a row names is one the door
 * takes at that path; the fields of the piece next hands over are the rows under "### The piece next hands over"; and
 * a post is answered with the fields the prose names, a second post of it with 409. The node's and the on-ramp's tables
 * sit under their own headings and are not read here. The dispatcher's order is routes.test.ts's.
 */
const DOC = readFileSync(new URL('../../../docs/PROTOCOL.md', import.meta.url), 'utf8');
const owner = key(9), A = key(1);
const schema = {
  type: 'object' as const, additionalProperties: false as const, required: ['verdict'],
  properties: { verdict: { enum: ['holds', 'fails'] } },
};
const brief = 'Does the statement hold? Answer holds or fails.';
const piece = { verifier: 'agree', requires: ['web' as const], brief, schema, agree: ['verdict'] };
const env = envelope(owner, 'table', { claim: piece }, { title: 'One statement' });
const P = problemHash(env);
const T0 = '2026-11-07T00:00:00.000Z';
const coin = {
  genesis: T0, epoch_h: 24, emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 }, vesting_h: 48,
  infra_bp: 1000, treasury: addr(key(7)), unit: 1000, weights: { cross_vendor: 2, same_vendor: 1, attest: 0 },
  burn_rate: 100, transfers_from: T0, redeem_from: T0, reader: addr(key(40)),
};
const limits = { keyPerHour: 1000, ipPerHour: 10000 };
const plain = boot('2026-11-07T12:00:00Z', { limits });
const coined = boot('2026-11-07T12:00:00Z', { limits, coin });
const asked = `key=${addr(A)}&model=anthropic/claude`;

/** The rows of the first table under a heading of PROTOCOL.md, each a list of its cells, header and rule left out. */
function table(heading: string): string[][] {
  const lines = DOC.split('\n');
  const at = lines.indexOf(heading);
  if (at < 0) throw new Error(`PROTOCOL.md has no heading ${heading}`);
  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith('#')) break;
    if (line.startsWith('|')) rows.push(line.slice(1, -1).split('|').map((c) => c.trim()));
    else if (rows.length) break;
  }
  return rows.slice(2);
}

/** The names a cell gives in backticks. */
const named = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** A row of the tracker's route table: its paths, its methods, and what it says it answers. */
interface Row { paths: string[]; methods: string[]; answers: string }
function routes(): Row[] {
  return table('### Routes').map(([paths, methods, answers]) => ({
    paths: named(paths!), methods: methods!.split(',').map((m) => m.trim()), answers: answers!,
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

describe('PROTOCOL.md, the tracker\'s route table', () => {
  it('has a row for every path the well-known document lists, in its order, the coin\'s included', () => {
    const paths = routes().flatMap((r) => r.paths);
    expect(listed.coined.length).toBeGreaterThan(listed.plain.length);
    for (const p of listed.coined) expect(paths, `${p} has no row`).toContain(p);
    expect(paths.filter((p) => listed.coined.includes(p))).toEqual(listed.coined);
  });

  it('names only listed paths and ones the door answers unlisted, and the coin\'s rows say QX-17', async () => {
    for (const r of routes()) {
      for (const p of r.paths) {
        if (listed.coined.includes(p)) {
          if (!listed.plain.includes(p)) expect(r.answers, `${p} is listed only with the coin`).toContain('QX-17');
          continue;
        }
        expect(r.answers, `${p} is not listed, and its row says so`).toContain('unlisted');
        expect((await answer(plain.base, 'GET', filled(p))).status, `${p} is answered`).toBe(200);
      }
    }
  });

  it('names for each row only methods the door takes at its paths', async () => {
    for (const r of routes()) {
      expect(r.methods.length, `${r.paths.join(', ')} names its methods`).toBeGreaterThan(0);
      for (const p of r.paths) {
        for (const method of r.methods) {
          const a = await answer(coined.base, method, filled(p));
          expect(a.status, `${method} ${p}`).not.toBe(405);
          expect(a, `${method} ${p}`).not.toEqual({ status: 404, error: 'no such route' });
        }
      }
    }
  });
});

describe('PROTOCOL.md, what the door answers', () => {
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
    expect(said, 'the prose names the post\'s answer').not.toBeNull();
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

  it('signs in the text form the prose names: 0x, 130 lower-case hex characters, v 27 or 28', () => {
    expect(DOC).toContain('`0x` and 130 lower-case hex characters');
    const { sig } = plain.ev(A, 'name', { name: 'Ada' });
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(['1b', '1c']).toContain(sig.slice(-2));
  });
});
