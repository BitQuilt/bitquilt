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
 * is passed over whole, so its identity log is not taken either. A problem its source hid or replaced before any run
 * took it is not taken, since the index leaves it out though the door still serves it: one no run listed, and one a
 * run listed and passed over, its chain not read whole, with nothing refused, so that run would have committed. Once
 * the store holds it, it is asked for by hash and taken (PROTOCOL.md, The mirror).
 */
const owner = key(9),
  A = key(1),
  M = key(3),
  maintainer = key(21);
const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }]));
const citesHash = hashBytes(cites);

/** The owner's problem; another title makes another problem, and `prev` a version of the one it names. */
function envelope(title = 'Which source', slug = 'which-source', prev: Hash | null = null): Envelope {
  const problem: Envelope['problem'] = {
    title,
    done_when: 'Done.',
    owner: addr(owner),
    slug,
    prev,
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
/** A publish of an envelope with the blob its pieces read. */
const publish = (base: string, e: Envelope) =>
  post(base, 'p', { envelope: e, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } });

const env = envelope();
const P = problemHash(env);
let one: { server: Server; base: string };
let two: { server: Server; base: string };

beforeAll(async () => {
  one = await startTracker(now);
  two = await startTracker(now);
  for (const t of [one, two]) expect((await publish(t.base, env)).status).toBe(201);
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
  it('takes no problem its source hid or replaced before any run listed it, and asks for it by hash once it is held', async () => {
    const three = await startTracker(now, { maintainers: [addr(maintainer)] });
    try {
      const hidden = envelope('Hidden there', 'hidden-there');
      const replaced = envelope('Replaced there', 'replaced-there');
      const version = envelope('Replaced there, again', 'replaced-there', problemHash(replaced));
      const H = problemHash(hidden),
        R = problemHash(replaced),
        V = problemHash(version);
      for (const e of [hidden, replaced, version]) expect((await publish(three.base, e)).status).toBe(201);
      const hide = ev(maintainer, 'hide', { id: H, why: 'Taken down to test the keeper.' });
      expect((await post(three.base, 'k/events', hide)).status).toBe(202);
      tick += 1000;
      const store = new Store(':memory:');
      const first = await keep({ store, sources: [three.base], peers: false, coin: false, now });
      expect(first.refused).toEqual([]);
      expect(first.problems.map((p) => p.hash)).toEqual([V]);
      for (const h of [H, R]) {
        expect(store.envelopeOf(h), `${h} is not taken`).toBeNull();
        expect((await fetch(`${three.base}p/${h}`)).status, `${h} is still served by hash`).toBe(200);
      }
      for (const e of [hidden, replaced]) store.putEnvelope(problemHash(e), e, now());
      const second = await keep({ store, sources: [three.base], peers: false, coin: false, now });
      expect(second.refused).toEqual([]);
      expect(second.problems.map((p) => p.hash).sort()).toEqual([H, R, V].sort());
    } finally {
      await new Promise<void>((r) => three.server.close(() => r()));
    }
  });
  it('takes no problem a run listed and did not take, once its source hides it, and refuses nothing in either run', async () => {
    const four = await startTracker(now, { maintainers: [addr(maintainer)] });
    try {
      const late = envelope('Hidden later', 'hidden-later');
      const L = problemHash(late);
      expect((await publish(four.base, late)).status).toBe(201);
      const store = new Store(':memory:');
      // The first run lists the problem and cannot read its chain whole: it passes the problem over, refuses nothing,
      // and holds nothing of it.
      const failing: typeof fetch = async (input, init) =>
        String(input).startsWith(`${four.base}p/${L}/events`) ? new Response('', { status: 503 }) : fetch(input, init);
      const first = await keep({ store, sources: [four.base], peers: false, coin: false, now, fetchImpl: failing });
      expect(first.refused).toEqual([]);
      expect(first.problems).toEqual([]);
      expect(store.envelopeOf(L)).toBeNull();
      // Then the source hides it, and no later run takes it: the index leaves it out, and nothing held here names it.
      const hide = ev(maintainer, 'hide', { id: L, why: 'Taken down after a run listed it.' });
      expect((await post(four.base, 'k/events', hide)).status).toBe(202);
      tick += 1000;
      const second = await keep({ store, sources: [four.base], peers: false, coin: false, now });
      expect(second.refused).toEqual([]);
      expect(second.problems).toEqual([]);
      expect(store.envelopeOf(L)).toBeNull();
      expect((await fetch(`${four.base}p/${L}`)).status, 'it is still served by hash').toBe(200);
    } finally {
      await new Promise<void>((r) => four.server.close(() => r()));
    }
  });
});
