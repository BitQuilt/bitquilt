/**
 * PROTOCOL.md, The node's routes, held to Quilt's page over a home that opened a problem: the well-known document's
 * `routes` are the paths of every row below its own, in their order, and the well-known's row says it is unlisted;
 * each method a row names is one the node takes at that path, and another method at a listed path is `404`, `no such
 * route`; every answer a row gives allows any origin, the blob's and each `not held here` among them; the well-known
 * and `/held` answer the fields their rows name; the envelope and the blob are served where held
 * and refused `not held here` where not; and a chain and the identity log come whole in one page, with no header
 * naming another. The tracker's table is packages/tracker/test/protocol-table.test.ts's, and the on-ramp's is
 * packages/hosted/test/onramp-table.test.ts's.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, IDENTITY_LOG, hashBytes } from '@bitquilt/core';
import { type Config, DEFAULT_CONFIG, createKey, loadKey } from '../src/config.js';
import { createPage } from '../src/page.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { baseOf, hex, quiltOver, startTracker, tempHome } from './helpers.js';

const DOC = readFileSync(new URL('../../../docs/PROTOCOL.md', import.meta.url), 'utf8');
const METHODS = ['GET', 'POST', 'PUT', 'DELETE'];
/** A hash this node holds nothing under. */
const NOT_HELD = `sha256:${'0'.repeat(64)}`;

const pattern: Pattern = {
  title: 'Statements, held at a node',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'held-at-a-node',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: {claim.text}',
      data: { claim: 'claims' },
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict'],
        properties: { verdict: { enum: ['supports', 'contradicts'] } },
      },
      agree: ['verdict'],
    },
  },
  data: { claims: [{ text: 'Headers are about 80 bytes.' }, { text: 'Difficulty never changes.' }] },
};

let tracker: Server;
let page: Server;
/** Where the node answers, with no trailing slash. */
let site: string;
let resolver: Resolver;
let problem: Hash;
/** The data blob of the problem, which the node holds once it opened the problem. */
let blob: Hash;
/** The paths the node's well-known document lists. */
let listed: string[];

beforeAll(async () => {
  const t = await startTracker();
  tracker = t.server;
  const owner = quiltOver(t.base)(9);
  problem = (await owner.publish(pattern)).hash;
  // A name on the identity log, so the log the node serves has a line.
  await owner.setName('Ada');
  const home = tempHome('quilt-node-table-');
  createKey(home, { secretHex: hex(5) });
  const config: Config = { ...DEFAULT_CONFIG, trackers: [t.base] };
  resolver = new Resolver(config, home);
  const identity = loadKey(home);
  const quilt = new Quilt(config, identity, resolver, undefined);
  await quilt.open(problem);
  blob = Object.values(resolver.cachedEnvelope(problem)!.problem.data)[0]!;
  const person = Quilt.asPerson(config, identity, resolver);
  page = await createPage({ quilt, person, resolver, keep: false }).listen(0);
  site = baseOf(page).slice(0, -1);
  listed = ((await (await fetch(`${site}/.well-known/quilt`)).json()) as { routes: string[] }).routes;
});
afterAll(async () => {
  await new Promise<void>((r) => page.close(() => r()));
  await new Promise<void>((r) => tracker.close(() => r()));
});

/** The rows of the table under "### The node's routes", each a list of its cells, header and rule left out. */
function rows(): string[][] {
  const lines = DOC.split('\n');
  const at = lines.indexOf("### The node's routes");
  if (at < 0) throw new Error("PROTOCOL.md has no heading ### The node's routes");
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

/** The names a cell gives in backticks. */
const named = (cell: string): string[] => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** A row: the paths it names, its methods, and what it says it answers. */
const routes = (): { paths: string[]; methods: string[]; answers: string }[] =>
  rows().map(([paths, methods, answers]) => ({
    paths: named(paths!),
    methods: methods!.split(',').map((m) => m.trim()),
    answers: answers!,
  }));

/** The What it answers cell of the row that names a path. */
function answers(path: string): string {
  const row = routes().find((r) => r.paths.includes(path));
  if (!row) throw new Error(`no row names ${path}`);
  return row.answers;
}

/** A path a row names, its hash filled with what the node holds: the blob under `/b/`, the problem elsewhere. */
const filled = (path: string): string => path.replace('<hash>', path.startsWith('/b/') ? blob : problem);

/** What the node answers a method on a path: its status, and the refusal's sentence where it wrote one as JSON. */
async function answer(method: string, path: string): Promise<{ status: number; error?: string }> {
  const r = await fetch(site + path, { method, ...(method === 'GET' ? {} : { body: '' }) });
  if (r.status >= 400 && (r.headers.get('content-type') ?? '').startsWith('application/json'))
    return { status: r.status, error: ((await r.json()) as { error: string }).error };
  await r.arrayBuffer();
  return { status: r.status };
}

/** The lines of a log the node serves, read from one answer, and whether that answer names a next page. */
async function page1(path: string): Promise<{ lines: unknown[]; next: string | null }> {
  const r = await fetch(site + path);
  expect(r.headers.get('content-type'), path).toContain('application/x-ndjson');
  const lines = (await r.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as unknown);
  return { lines, next: r.headers.get('x-quilt-next-since') };
}

describe("PROTOCOL.md, the node's route table", () => {
  it('lists the paths of every row below the well-known in their order, and says the well-known is unlisted', async () => {
    expect(DOC).toContain('lists as `routes` the paths of every row below its own, in their order');
    const [own, ...below] = routes();
    expect(own!.paths).toEqual(['/.well-known/quilt']);
    expect(own!.answers).toContain('unlisted');
    expect(listed.length).toBeGreaterThan(0);
    expect(below.flatMap((r) => r.paths)).toEqual(listed);
    expect((await answer('GET', '/.well-known/quilt')).status).toBe(200);
  });

  it('names for each row only methods the node takes at its paths, and another method at a listed path is 404, no such route', async () => {
    expect(DOC).toContain('Another method at a listed path is `404`, `no such route`.');
    for (const r of routes()) {
      expect(r.methods.length, `${r.paths.join(', ')} names its methods`).toBeGreaterThan(0);
      for (const p of r.paths) {
        for (const m of r.methods) {
          expect(METHODS, `${p}: ${m} is a method`).toContain(m);
          const a = await answer(m, filled(p));
          expect(a.status, `${m} ${p}`).not.toBe(405);
          expect(a, `${m} ${p}`).not.toEqual({ status: 404, error: 'no such route' });
        }
        if (!listed.includes(p)) continue;
        for (const m of METHODS.filter((m) => !r.methods.includes(m)))
          expect(await answer(m, filled(p)), `${m} ${p}`).toEqual({ status: 404, error: 'no such route' });
      }
    }
  });

  it('lets a page on any site read every answer a row gives, held or not', async () => {
    expect(DOC).toContain(
      'Every answer a row gives allows any origin, so a page on any site can read what the node holds.',
    );
    for (const r of routes())
      for (const p of r.paths)
        for (const path of [filled(p), ...(p.endsWith('<hash>') ? [p.replace('<hash>', NOT_HELD)] : [])]) {
          const a = await fetch(site + path);
          await a.arrayBuffer();
          expect(a.headers.get('access-control-allow-origin'), `${a.status} ${path}`).toBe('*');
        }
  });

  it("answers the fields the well-known's and /held's rows name, with the identity log's hash", async () => {
    expect(DOC).toContain("says `node: true`, names the identity log's hash");
    const known = (await (await fetch(`${site}/.well-known/quilt`)).json()) as Record<string, unknown>;
    expect(named(answers('/.well-known/quilt'))[0]).toBe(`{ ${Object.keys(known).join(', ')} }`);
    expect(known.node).toBe(true);
    expect(known.identity).toBe(IDENTITY_LOG);
    const held = (await (await fetch(`${site}/held`)).json()) as { problems: Record<string, unknown>[] };
    const [whole, ...each] = named(answers('/held'));
    expect(whole).toBe(`{ ${Object.keys(held).join(', ')} }`);
    const mine = held.problems.find((p) => p.problem === problem);
    expect(mine, 'the problem the home opened is held').toBeDefined();
    expect([...each].sort()).toEqual(Object.keys(mine!).sort());
  });

  it('serves the envelope and the blob where held, and refuses each with not held here where not', async () => {
    for (const path of ['/p/<hash>', '/b/<hash>']) expect(answers(path)).toContain('`404`, `not held here`');
    expect(await (await fetch(`${site}/p/${problem}`)).json()).toEqual(resolver.cachedEnvelope(problem));
    expect(hashBytes(new Uint8Array(await (await fetch(`${site}/b/${blob}`)).arrayBuffer()))).toBe(blob);
    for (const path of [`/p/${NOT_HELD}`, `/b/${NOT_HELD}`])
      expect(await answer('GET', path), path).toEqual({ status: 404, error: 'not held here' });
  });

  it('gives the chain and the identity log whole, in one page', async () => {
    expect(answers('/p/<hash>/events')).toContain('as held, in one page');
    const held = (await (await fetch(`${site}/held`)).json()) as { problems: { problem: Hash; lines: number }[] };
    const chain = await page1(`/p/${problem}/events`);
    expect(chain.lines.length).toBeGreaterThan(0);
    expect(chain.lines.length).toBe(held.problems.find((p) => p.problem === problem)!.lines);
    expect(chain.next).toBeNull();
    const identity = await page1('/k/events');
    expect(identity.lines.length).toBeGreaterThan(0);
    expect(identity.lines).toEqual(resolver.cachedIdentity());
    expect(identity.next).toBeNull();
  });
});
