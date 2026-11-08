import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, hashBytes, problemHash, reduce } from '@bitquilt/core';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * CORE.md section 6: "An envelope that fails its checks makes the input invalid: `reduce` refuses it and produces no
 * state." A store the door folds can hold a problem the core refuses, one without the data blob it names or one not
 * signed by its owner; the layer leaves that problem out with the core's reason and folds every other. The index, the
 * search, the offer and the coin's state go on without it, `/coin/state` naming only the problems folded (QX-17
 * section 6); its envelope is served by hash; a read of its state, scrape, challenges, panels, record or next, and a
 * post on its log, is refused with 503 and the core's reason; and once the blob is held it folds. A problem published
 * through the door has its blobs kept before its envelope, so the door's own write never leaves one without its data.
 */
const owner = key(9),
  worker = key(1),
  treasury = key(30),
  reader = key(31);
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
const t = boot('2026-11-08T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 }, coin });

const statements = {
  'statement/*': {
    count: 1,
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Statement {n}: {claim.text} Does the paper say so?',
    schema: VERDICT,
    agree: ['verdict'],
    data: { claim: 'claims' },
  },
};
const claims = new TextEncoder().encode(JSON.stringify([{ text: 'The coin is a chain of signatures.' }]));
const claimsHash = hashBytes(claims);
/** A problem published through the door, with no data. */
const P = envelope(owner, 'folded', { 'statement/*': { ...statements['statement/*'], data: {} } });
const p = problemHash(P);
/** A problem the store holds without the data blob it names. */
const Q = envelope(owner, 'no-blob', statements, { data: { claims: claimsHash } });
const q = problemHash(Q);
/** A problem the store holds whose signature is not its owner's. */
const signed = envelope(owner, 'not-signed', { 'statement/*': { ...statements['statement/*'], data: {} } });
const R: Envelope = { ...signed, sig: envelope(worker, 'other', {}).sig };
const r = problemHash(R);
const qPiece = reduce({ envelopes: [Q], blobs: new Map([[claimsHash, claims]]), receipts: [], now: T0 }).pieces[0]!
  .piece.hash;
const noBlob = `the core refuses this problem as held here: blob claims: ${claimsHash} not present`;

beforeAll(async () => {
  await t.listen();
  expect((await t.post('/p', { envelope: P })).status).toBe(201);
  t.store.putEnvelope(q, Q, new Date(t.clock.tick).toISOString());
  t.store.putEnvelope(r, R, new Date(t.clock.tick).toISOString());
});
afterAll(() => t.close());

const status = async (path: string) => (await fetch(t.base + path)).status;
const refusal = async (path: string) => {
  const res = await fetch(t.base + path);
  return { status: res.status, error: ((await res.json()) as { error: string }).error };
};

describe('a problem held here that the core refuses (CORE.md section 6)', () => {
  it('is left out of the layer with the core reason, and every other problem is folded', () => {
    const layer = t.tracker.layer();
    expect([...layer.problems.keys()]).toEqual([p]);
    expect(layer.refused.get(q)).toBe(`blob claims: ${claimsHash} not present`);
    expect(layer.refused.get(r)).toBe('envelope: not signed by its owner');
  });

  it('leaves the index, the search and the offer answering without it', async () => {
    const front = await t.get<{ problems: { problem: Hash }[] }>('/');
    expect(front.problems.map((x) => x.problem)).toEqual([p]);
    const found = await t.get<{ problems: { problem: Hash }[] }>('/search?q=statements');
    expect(found.problems.map((x) => x.problem)).toEqual([p]);
    expect(await status(`/offer?key=${addr(worker)}`)).toBe(200);
    expect(await status(`/p/${p}/state`)).toBe(200);
  });

  it('names only the problems folded in the coin state (QX-17 section 6)', async () => {
    const state = await t.get<{ folded: { problems: { problem: Hash }[] } }>('/coin/state');
    expect(state.folded.problems.map((x) => x.problem)).toEqual([p]);
  });

  it('serves its envelope by hash and refuses every read of its fold with 503 and the core reason', async () => {
    expect(await t.get(`/p/${q}`)).toEqual(Q);
    for (const path of ['state', 'scrape', 'challenges', 'panels', 'record', `next?key=${addr(worker)}`])
      expect(await refusal(`/p/${q}/${path}`)).toEqual({ status: 503, error: noBlob });
    expect(await refusal(`/p/${r}/state`)).toEqual({
      status: 503,
      error: 'the core refuses this problem as held here: envelope: not signed by its owner',
    });
  });

  it('refuses a post on its log with 503 and the core reason', async () => {
    const claim = t.ev(
      worker,
      'claim',
      { by: { model: 'anthropic/claude', client: 'test/0', can: ['web'] } },
      q,
      qPiece,
    );
    const res = await t.post(`/p/${q}/events`, claim);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe(noBlob);
  });

  it('folds once the blob is held', async () => {
    t.store.putBlob(claimsHash, claims);
    expect(t.tracker.layer().refused.has(q)).toBe(false);
    expect(await status(`/p/${q}/state`)).toBe(200);
    const front = await t.get<{ problems: { problem: Hash }[] }>('/');
    expect(front.problems.map((x) => x.problem).sort()).toEqual([p, q].sort());
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
      const notes = new TextEncoder().encode(JSON.stringify([{ text: 'Difficulty never changes.' }]));
      const S = envelope(owner, 'published', statements, { data: { claims: hashBytes(notes) } });
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
