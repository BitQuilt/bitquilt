import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, eventId, hashBytes, problemHash, reduce, signEvent } from '@bitquilt/core';
import { challengeLayer, inputRefused } from '../src/challenge.js';
import { VERDICT, addr, boot, envelope, key, line } from './helpers.js';

/**
 * CORE.md section 6: "An envelope that fails its checks makes the input invalid: `reduce` refuses it and produces no
 * state." A store the door folds can hold a problem the core refuses, one without the data blob it names or one not
 * signed by its owner; the layer leaves that problem out with the core's reason and folds every other. The index, the
 * search and the offer go on without it; a version the core refuses replaces nothing, so the version before it stays
 * listed and offered; `/coin/state` names it among the refused with its chain's head (QX-17 section 6); its envelope
 * and its log are served by hash; a read of its state, scrape, challenges, panels, record or next, and a post on its
 * log, is refused with 503 and the core's reason, after a problem taken down is refused with 410, and a coin lock or
 * pay naming it with the same words (QX-17 section 2); and once the blob is held it folds. A fold that fails on a
 * receipt, not on the envelopes and blobs, is no refusal of the core's and fails as it did. A problem published through
 * the door has its blobs kept before its envelope, so the door's own write never leaves one without its data.
 */
const owner = key(9),
  worker = key(1),
  treasury = key(30),
  reader = key(31),
  maintainer = key(21);
const T0 = '2026-11-01T00:00:00.000Z';
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
const t = boot('2026-11-08T12:00:00Z', {
  limits: { keyPerHour: 1000, ipPerHour: 10000 },
  coin,
  maintainers: [addr(maintainer)],
});

/** Statements read from the data blob named `blob`. */
const statements = (blob: string) => ({
  'statement/*': {
    count: 1,
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Statement {n}: {claim.text} Does the paper say so?',
    schema: VERDICT,
    agree: ['verdict'],
    data: { claim: blob },
  },
});
const plain = { 'statement/*': { ...statements('none')['statement/*'], data: {} } };
const list = (text: string) => new TextEncoder().encode(JSON.stringify([{ text }]));
const claims = list('The coin is a chain of signatures.');
const claimsHash = hashBytes(claims);
const notesHash = hashBytes(list('Difficulty never changes.'));
const otherHash = hashBytes(list('The paper has nine pages.'));
/** A problem published through the door, with no data. */
const P = envelope(owner, 'folded', plain);
const p = problemHash(P);
/** A problem the store holds without the data blob it names. */
const Q = envelope(owner, 'no-blob', statements('claims'), { data: { claims: claimsHash } });
const q = problemHash(Q);
/** A problem the store holds whose signature is not its owner's. */
const R: Envelope = { ...envelope(owner, 'not-signed', plain), sig: envelope(worker, 'other', {}).sig };
const r = problemHash(R);
/** The owner's next version of P, held without the data blob it names. */
const V = envelope(owner, 'folded', statements('notes'), { prev: p, data: { notes: notesHash } });
const v = problemHash(V);
/** A problem held without its data blob that a maintainer takes down (QX-6). */
const H = envelope(owner, 'taken-down', statements('claims'), { data: { claims: otherHash } });
const h = problemHash(H);
const qPiece = reduce({ envelopes: [Q], blobs: new Map([[claimsHash, claims]]), receipts: [], now: T0 }).pieces[0]!
  .piece.hash;
const by = { model: 'anthropic/claude', client: 'test/0', can: ['web'] };
const noBlob = `the core refuses this problem as held here: blob claims: ${claimsHash} not present`;

beforeAll(async () => {
  await t.listen();
  expect((await t.post('/p', { envelope: P })).status).toBe(201);
  const at = new Date(t.clock.tick).toISOString();
  for (const [hash, e] of [
    [q, Q],
    [r, R],
    [v, V],
    [h, H],
  ] as const)
    t.store.putEnvelope(hash, e, at);
  // A line on Q's chain, as a store keeps one it pulled, so the state names the chain's head.
  const claim = t.ev(worker, 'claim', { by }, q, qPiece);
  t.store.appendReceipt(q, claim, eventId(claim), 'http://tracker.test/', claim.ts, 'self');
  await t.accepted('/k/events', t.ev(maintainer, 'hide', { id: h, why: 'Taken down here.' }));
});
afterAll(() => t.close());

const status = async (path: string) => (await fetch(t.base + path)).status;
const refusal = async (path: string) => {
  const res = await fetch(t.base + path);
  return { status: res.status, error: ((await res.json()) as { error: string }).error };
};
const listed = async (path: string) =>
  (await t.get<{ problems: { problem: Hash }[] }>(path)).problems.map((x) => x.problem);

describe('a problem held here that the core refuses (CORE.md section 6)', () => {
  it('is left out of the layer with the core reason, and every other problem is folded', () => {
    const layer = t.tracker.layer();
    expect([...layer.problems.keys()]).toEqual([p]);
    expect(layer.refused.get(q)).toBe(`blob claims: ${claimsHash} not present`);
    expect(layer.refused.get(r)).toBe('envelope: not signed by its owner');
    expect(layer.refused.get(v)).toBe(`blob notes: ${notesHash} not present`);
    expect(layer.refused.has(h)).toBe(true);
  });

  it('leaves the index, the search and the offer answering without it, and a refused version replaces nothing', async () => {
    expect(await listed('/')).toEqual([p]);
    expect(await listed('/search?q=statements')).toEqual([p]);
    const offered = await t.get<{ offers: { problem: Hash }[] }>(`/offer?key=${addr(worker)}&can=web`);
    expect(offered.offers.map((o) => o.problem)).toEqual([p]);
    expect(await t.get<{ superseded: Hash | null }>(`/p/${p}/state`)).toMatchObject({ superseded: null });
    const next = await t.get<{ piece: unknown; superseded?: Hash }>(`/p/${p}/next?key=${addr(worker)}&can=web`);
    expect(next.piece).not.toBeNull();
    expect(next.superseded).toBeUndefined();
  });

  it('is named among the refused in the coin state, with its chain head (QX-17 section 6)', async () => {
    type Named = { problem: Hash; head: { seq: number; hash: string } | null };
    const state = await t.get<{ folded: { problems: Named[]; refused: Named[] } }>('/coin/state');
    expect(state.folded.problems.map((x) => x.problem)).toEqual([p]);
    expect(state.folded.refused.map((x) => x.problem).sort()).toEqual([q, r, v, h].sort());
    const head = t.store.head(q)!;
    expect(state.folded.refused.find((x) => x.problem === q)!.head).toEqual({ seq: 1, hash: head.hash });
    expect(state.folded.refused.find((x) => x.problem === r)!.head).toBeNull();
  });

  it('serves its envelope and its log by hash and refuses every read of its fold with 503 and the core reason', async () => {
    expect(await t.get(`/p/${q}`)).toEqual(Q);
    const log = await fetch(`${t.base}/p/${q}/events`);
    expect(log.status).toBe(200);
    expect((await log.text()).trim().split('\n')).toHaveLength(1);
    for (const path of ['state', 'scrape', 'challenges', 'panels', 'record', `next?key=${addr(worker)}`])
      expect(await refusal(`/p/${q}/${path}`)).toEqual({ status: 503, error: noBlob });
    expect(await refusal(`/p/${r}/state`)).toEqual({
      status: 503,
      error: 'the core refuses this problem as held here: envelope: not signed by its owner',
    });
  });

  it('refuses a post on its log with 503 and the core reason', async () => {
    const res = await t.post(`/p/${q}/events`, t.ev(worker, 'claim', { by }, q, qPiece));
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(noBlob);
  });

  it('refuses a coin lock or pay naming it with the core reason (QX-17 section 2)', async () => {
    const pay = await t.post('/coin/events', t.ev(worker, 'pay', { problem: r, amount: 1, per_square: 1 }));
    expect(pay.status).toBe(400);
    expect(((await pay.json()) as { error: string }).error).toBe(
      'the core refuses this problem as held here: envelope: not signed by its owner',
    );
    const lock = await t.post('/coin/events', t.ev(worker, 'lock', { problem: q, piece: qPiece, amount: 1 }));
    expect(((await lock.json()) as { error: string }).error).toBe(noBlob);
  });

  it('is taken down before its fold is read: next and a post are 410, and its state 503', async () => {
    const gone = { status: 410, error: 'this problem is taken down here' };
    expect(await refusal(`/p/${h}/next?key=${addr(worker)}`)).toEqual(gone);
    const res = await t.post(`/p/${h}/events`, t.ev(worker, 'claim', { by }, h, qPiece));
    expect({ status: res.status, error: ((await res.json()) as { error: string }).error }).toEqual(gone);
    expect(await status(`/p/${h}/state`)).toBe(503);
  });

  it('folds once the blob is held', async () => {
    t.store.putBlob(claimsHash, claims);
    expect(t.tracker.layer().refused.has(q)).toBe(false);
    expect(await status(`/p/${q}/state`)).toBe(200);
    expect((await listed('/')).sort()).toEqual([p, q].sort());
  });
});

describe('a fold that fails on a receipt', () => {
  it('is no refusal of the core: the layer fails as the reduce does', () => {
    const piece = reduce({ envelopes: [P], blobs: new Map(), receipts: [], now: T0 }).pieces[0]!.piece.hash;
    const claim = signEvent(
      { quilt: 1, type: 'claim', problem: p, piece, key: addr(worker), ts: T0, body: { by } },
      worker,
    );
    const input = { envelopes: [P], blobs: new Map(), receipts: [line(claim, 'not a time')], now: T0 };
    expect(() => reduce(input)).toThrow();
    expect(inputRefused(input)).toBeNull();
    expect(() => challengeLayer({ problems: [input], now: T0 })).toThrow();
  });

  it('fails a read and a post inside, with 500, and does not call the problem refused', async () => {
    const u = boot('2026-11-08T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
    await u.listen();
    try {
      expect((await u.post('/p', { envelope: P })).status).toBe(201);
      const piece = (await u.get<{ pieces: { hash: Hash }[] }>(`/p/${p}/state`)).pieces[0]!.hash;
      const claim = u.ev(worker, 'claim', { by }, p, piece);
      u.store.appendReceipt(p, claim, eventId(claim), 'http://tracker.test/', 'not a time', 'self');
      expect((await fetch(`${u.base}/`)).status).toBe(500);
      const res = await u.post(`/p/${p}/events`, u.ev(key(2), 'claim', { by }, p, piece));
      expect(res.status).toBe(500);
    } finally {
      await u.close();
    }
  });
});

describe('a problem published through the door', () => {
  it('has its blobs kept before its envelope', async () => {
    const order: string[] = [];
    const { putBlob, putEnvelope } = t.store;
    t.store.putBlob = (h, bytes) => {
      order.push('blob');
      putBlob.call(t.store, h, bytes);
    };
    t.store.putEnvelope = (h, e, at) => {
      order.push('envelope');
      putEnvelope.call(t.store, h, e, at);
    };
    try {
      const notes = list('The paper has one author.');
      const S = envelope(owner, 'published', statements('claims'), { data: { claims: hashBytes(notes) } });
      const res = await t.post('/p', {
        envelope: S,
        blobs: { [hashBytes(notes)]: Buffer.from(notes).toString('base64') },
      });
      expect(res.status).toBe(201);
    } finally {
      t.store.putBlob = putBlob;
      t.store.putEnvelope = putEnvelope;
    }
    expect(order).toEqual(['blob', 'envelope']);
  });
});
