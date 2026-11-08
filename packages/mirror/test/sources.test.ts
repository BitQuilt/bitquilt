import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Hash,
  type Unsigned,
  IDENTITY_LOG,
  commitHash,
  hashBytes,
  newNonce,
  problemHash,
  signEvent,
  signObject,
  verifyChain,
} from '@bitquilt/core';
import { Store } from '@bitquilt/tracker';
import { keep } from '../src/mirror.js';
import { VERDICT, addr, by, key, startTracker } from './helpers.js';

/**
 * NODE.md section 5: which source a keeper takes each log from. Two trackers hold one problem, and only the second
 * has a commit and a reveal on it and a name on its identity log. Read in the order one, two, the problem is taken
 * from the first alone, run after run, while the identity log is taken from both. Read in the order two, one, the
 * problem's chain gains the second's events after the lines it holds. Where the first source's chain cannot be read
 * whole, the problem is taken from the next source that lists it, in the same run. A source whose list cannot be read
 * is passed over whole, so its identity log is not taken either.
 */
const owner = key(9),
  A = key(1),
  M = key(3);
const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }]));
const citesHash = hashBytes(cites);

function envelope(): Envelope {
  const problem: Envelope['problem'] = {
    title: 'Which source',
    done_when: 'Done.',
    owner: addr(owner),
    slug: 'which-source',
    prev: null,
    from: null,
    settings: { challenge_window_h: 0.001, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
    pieces: {
      'cite/*': {
        count: 1,
        verifier: 'agree',
        brief: 'Citation {n}: {cite.s}',
        data: { cite: 'cites.json' },
        schema: VERDICT,
        agree: ['verdict'],
      },
    },
    data: { 'cites.json': citesHash },
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

let tick = Date.parse('2026-11-07T09:00:00Z');
const now = () => new Date(tick).toISOString();
function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: now(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}
const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });

const env = envelope();
const P = problemHash(env);
let one: { server: Server; base: string };
let two: { server: Server; base: string };

beforeAll(async () => {
  one = await startTracker(now);
  two = await startTracker(now);
  for (const t of [one, two])
    expect(
      (await post(t.base, 'p', { envelope: env, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } }))
        .status,
    ).toBe(201);
  const state = (await (await fetch(`${two.base}p/${P}/state`)).json()) as { pieces: { hash: Hash }[] };
  const piece = state.pieces[0]!.hash;
  const answer = { verdict: 'supports' };
  const nonce = newNonce();
  expect(
    (await post(two.base, `p/${P}/events`, ev(A, 'commit', { h: commitHash(answer, nonce) }, P, piece))).status,
  ).toBe(202);
  tick += 1000;
  expect(
    (await post(two.base, `p/${P}/events`, ev(A, 'reveal', { return: answer, nonce, by: by('a/x') }, P, piece))).status,
  ).toBe(202);
  tick += 1000;
  expect((await post(two.base, 'k/events', ev(M, 'name', { name: 'Mo' }))).status).toBe(202);
  tick += 1000;
});
afterAll(async () => {
  await new Promise<void>((r) => one.server.close(() => r()));
  await new Promise<void>((r) => two.server.close(() => r()));
});

const types = (store: Store, log: Hash) => store.lines(log).map((l) => l.event.type);

describe('the source a keeper takes each log from (NODE.md section 5)', () => {
  it('takes a problem from the first source that gives it in a run, and the identity log from every source', async () => {
    const store = new Store(':memory:');
    for (let run = 0; run < 2; run++) {
      const report = await keep({ store, sources: [one.base, two.base], peers: false, coin: false, now });
      expect(report.refused).toEqual([]);
      expect(report.sources).toEqual([one.base, two.base]);
      expect(report.problems).toEqual([{ hash: P, lines: 0, added: 0, complete: false }]);
      expect(types(store, P)).toEqual([]);
      expect(types(store, IDENTITY_LOG)).toEqual(['name']);
    }
    const report = await keep({ store, sources: [two.base, one.base], peers: false, coin: false, now });
    expect(report.refused).toEqual([]);
    expect(report.problems).toEqual([{ hash: P, lines: 2, added: 2, complete: false }]);
    expect(types(store, P)).toEqual(['commit', 'reveal']);
    expect(verifyChain(store.lines(P), P).ok).toBe(true);
    expect(store.lines(P).every((l) => l.received.map((w) => w.by).join(',') === 'http://t.test/,mirror')).toBe(true);
    expect(types(store, IDENTITY_LOG)).toEqual(['name']);
  });
  it('takes a problem from the next source that lists it where the first source cannot be read whole', async () => {
    const store = new Store(':memory:');
    const fetchImpl: typeof fetch = async (input, init) =>
      String(input).startsWith(`${one.base}p/${P}/events`) ? new Response('', { status: 503 }) : fetch(input, init);
    const report = await keep({ store, sources: [one.base, two.base], peers: false, coin: false, now, fetchImpl });
    expect(report.refused).toEqual([]);
    expect(report.problems).toEqual([{ hash: P, lines: 2, added: 2, complete: false }]);
    expect(types(store, P)).toEqual(['commit', 'reveal']);
  });
  it('passes over a source whose list cannot be read, its identity log with it', async () => {
    const store = new Store(':memory:');
    const fetchImpl: typeof fetch = async (input, init) =>
      String(input) === two.base ? new Response('', { status: 503 }) : fetch(input, init);
    const report = await keep({ store, sources: [one.base, two.base], peers: false, coin: false, now, fetchImpl });
    expect(report.sources).toEqual([one.base, two.base]);
    expect(report.errors).toEqual([`${two.base}: no index`]);
    expect(report.problems).toEqual([{ hash: P, lines: 0, added: 0, complete: false }]);
    expect(types(store, IDENTITY_LOG)).toEqual([]);
  });
});
