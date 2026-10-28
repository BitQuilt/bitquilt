import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, type Receipt, type Unsigned, IDENTITY_LOG, addressOf, commitHash, hashBytes, newNonce, problemHash, signEvent, signObject, verifyChain } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { mirror } from '../src/mirror.js';

/**
 * The mirror over two real trackers: it writes the layout from one, with chains that verify and names from version
 * events; only grows, and writes the output once the problem is complete; refuses a second tracker whose chain for the
 * problem is not a growth of the one it holds; passes over a chain whose pages have no end, keeping what it holds; and
 * anchors the head of every chain when asked, keeping a stamp it already has.
 */
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const owner = key(9), A = key(1), B = key(2);
const addr = addressOf;
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } };
const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }, { s: 'two' }]));
const citesHash = hashBytes(cites);

function envelope(): Envelope {
  const problem: Envelope['problem'] = {
    title: 'A report', done_when: 'Done.', owner: addr(owner), slug: 'report', prev: null, from: null,
    settings: { challenge_window_h: 0.001, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
    pieces: { 'cite/*': { count: 2, verifier: 'agree', brief: 'Citation {n}: {cite.s}', data: { cite: 'cites.json' }, schema, agree: ['verdict'] } },
    data: { 'cites.json': citesHash },
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

let tick = Date.parse('2026-10-25T09:00:00Z');
const now = () => new Date(tick).toISOString();
async function startTracker(): Promise<{ server: Server; base: string }> {
  const t = createTracker({ store: new Store(':memory:'), url: 'http://t.test/', now, ipSalt: 's' });
  const server = await t.listen(0);
  const a = server.address();
  return { server, base: typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '' };
}
function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: now(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}
const post = (base: string, path: string, body: unknown) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
async function handIn(base: string, k: Uint8Array, problem: Hash, piece: Hash, ret: Record<string, unknown>, model: string) {
  const nonce = newNonce();
  expect((await post(base, `p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece))).status).toBe(202);
  tick += 1000;
  expect((await post(base, `p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece))).status).toBe(202);
  tick += 1000;
}

const env = envelope();
const P = problemHash(env);
let one: { server: Server; base: string };
let two: { server: Server; base: string };
let pieces: Hash[];
const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-'));

beforeAll(async () => {
  one = await startTracker();
  two = await startTracker();
  for (const t of [one, two]) expect((await post(t.base, 'p', { envelope: env, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } })).status).toBe(201);
  const state = (await (await fetch(`${one.base}p/${P}/state`)).json()) as { pieces: { hash: Hash }[] };
  pieces = state.pieces.map((p) => p.hash);
});
afterAll(async () => {
  await new Promise<void>((r) => one.server.close(() => r()));
  await new Promise<void>((r) => two.server.close(() => r()));
});

// The mirror names a chain's files by its hash, sha256 and a colon, which Windows refuses in a path; the mirror runs on Linux, and these tests do too.
describe.skipIf(process.platform === 'win32')('the mirror', () => {
  it('writes the layout from a tracker, with chains that verify and names from version events', async () => {
    expect((await post(one.base, `p/${P}/events`, ev(owner, 'version', { slug: 'report', hash: P }, P))).status).toBe(202);
    expect((await post(one.base, 'k/events', ev(owner, 'name', { name: 'Maya' }))).status).toBe(202);
    await handIn(one.base, A, P, pieces[0]!, { verdict: 'supports' }, 'a/x');
    const report = await mirror({ trackers: [one.base], out, now });
    expect(report.refused).toEqual([]);
    expect(report.problems).toEqual([{ hash: P, lines: 3, added: 3, complete: false }]);
    expect(JSON.parse(readFileSync(join(out, 'problems', `${P}.json`), 'utf8'))).toEqual(env);
    expect(new Uint8Array(readFileSync(join(out, 'blobs', citesHash)))).toEqual(cites);
    const lines = readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
    expect(verifyChain(lines, P).ok).toBe(true);
    expect(readFileSync(join(out, 'names', addr(owner), 'report'), 'utf8').trim()).toBe(P);
    const identity = readFileSync(join(out, 'ledger', 'identity.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
    expect(verifyChain(identity, IDENTITY_LOG).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'keys.json'), 'utf8'))[addr(owner)].name).toBe('Maya');
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).problems[0].hash).toBe(P);
  });
  it('only grows, and writes the output once the problem is complete', async () => {
    await handIn(one.base, B, P, pieces[0]!, { verdict: 'supports' }, 'b/y');
    await handIn(one.base, A, P, pieces[1]!, { verdict: 'contradicts' }, 'a/x');
    await handIn(one.base, B, P, pieces[1]!, { verdict: 'contradicts' }, 'b/y');
    tick += 60 * 60 * 1000;
    const report = await mirror({ trackers: [one.base], out, now });
    expect(report.refused).toEqual([]);
    expect(report.problems[0]).toEqual({ hash: P, lines: 9, added: 6, complete: true });
    expect(existsSync(join(out, 'outputs', P, 'output.json'))).toBe(true);
    expect(readFileSync(join(out, 'outputs', P, 'hash'), 'utf8')).toMatch(/^sha256:[0-9a-f]{64}\n$/);
  });
  it('refuses a tracker whose chain for the problem is not a growth of the one it holds', async () => {
    await handIn(two.base, B, P, pieces[0]!, { verdict: 'supports' }, 'b/y');
    const report = await mirror({ trackers: [two.base], out, now });
    // The problem's chain and the identity log both differ from what the mirror holds: a mirror follows one tracker's chains.
    expect(report.refused).toHaveLength(2);
    expect(report.refused.every((r) => /did not only grow/.test(r))).toBe(true);
    const lines = readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8').split('\n').filter(Boolean);
    expect(lines).toHaveLength(9);
  });
  it('passes over a chain whose pages have no end, and keeps the one it holds', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      if (/\/p\/[^/]+\/events\?since=/.test(String(input))) return new Response('', { status: 200, headers: { 'x-quilt-next-since': '1' } });
      return fetch(input, init);
    };
    const report = await mirror({ trackers: [one.base], out, now, fetchImpl });
    expect(report.problems).toEqual([]);
    expect(report.refused).toEqual([]);
    expect(readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8').split('\n').filter(Boolean)).toHaveLength(9);
  });
  it('anchors the head of every chain it holds when asked, and keeps a stamp it already has', async () => {
    const calendarBytes = new Uint8Array([0xf0, 0x10, 0x01, 0x02, 0x03, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
    let posts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input) === 'https://cal.test/digest') {
        posts++;
        return new Response(calendarBytes, { status: 200 });
      }
      return fetch(input, init);
    };
    const report = await mirror({ trackers: [one.base], out, now, anchor: { calendars: ['https://cal.test'] }, fetchImpl });
    expect(report.anchors?.failed).toEqual([]);
    expect(report.anchors?.stamped.map((a) => a.problem).sort()).toEqual([P, 'identity'].sort());
    const head = JSON.parse(readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8').trim().split('\n').pop()!) as { seq: number; hash: string };
    expect(existsSync(join(out, 'anchors', P, `${head.seq}.ots`))).toBe(true);
    const side = JSON.parse(readFileSync(join(out, 'anchors', P, `${head.seq}.json`), 'utf8')) as { hash: string; calendar: string };
    expect(side.hash).toBe(head.hash);
    expect(side.calendar).toBe('https://cal.test');
    const again = await mirror({ trackers: [one.base], out, now, anchor: { calendars: ['https://cal.test'] }, fetchImpl });
    expect(again.anchors?.kept).toBe(2);
    expect(posts).toBe(2);
  });
});
