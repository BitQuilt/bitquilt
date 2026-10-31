import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, problemHash, recoverAddress, signMessage } from '@bitquilt/core';
import { addr, boot, envelope as signed, key } from './helpers.js';

/**
 * What keeps a tracker's reads cheap: the layer, which reduces every problem here, is built once and answered from
 * while nothing is written and the clock stays in the same five seconds; a write or the clock moving on builds it
 * again, and admitting an event always builds it at now. Recovering a signer is remembered by signature and message.
 */
const owner = key(9), worker = key(1);
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } };
const P = signed(owner, 'kept', { 'statement/*': { count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } });
const p = problemHash(P);
const t = boot('2026-10-31T12:00:00Z');
beforeAll(async () => {
  await t.listen();
  expect((await t.post('/p', { envelope: P })).status).toBe(201);
});
afterAll(() => t.close());

describe('the kept layer', () => {
  it('is the same layer for reads while nothing is written and the clock stays in its five seconds', () => {
    const a = t.tracker.layer();
    t.clock.tick += 1000;
    expect(t.tracker.layer()).toBe(a);
  });

  it('is built again once the clock moves past those five seconds', () => {
    const a = t.tracker.layer();
    t.clock.tick += 6000;
    expect(t.tracker.layer()).not.toBe(a);
  });

  it('is built again after a write, and the read sees what was written', async () => {
    const before = await t.get<{ pieces: { hash: Hash; state: string }[] }>(`/p/${p}/state`);
    const piece = before.pieces[0]!.hash;
    expect(before.pieces[0]!.state).toBe('open');
    const a = t.tracker.layer();
    await t.accepted(`/p/${p}/events`, t.ev(worker, 'claim', { by: { model: 'anthropic/claude', client: 'test/0', can: ['web'] } }, p, piece));
    expect(t.tracker.layer()).not.toBe(a);
    const after = await t.get<{ pieces: { hash: Hash; state: string }[] }>(`/p/${p}/state`);
    expect(after.pieces.find((x) => x.hash === piece)!.state).toBe('in_flight');
  });
});

describe('recovering a signer', () => {
  it('answers the same the second time, and null for a signature that does not recover', () => {
    const message = new TextEncoder().encode('the same message');
    const sig = signMessage(message, worker);
    expect(recoverAddress(message, sig)).toBe(addr(worker));
    expect(recoverAddress(message, sig)).toBe(addr(worker));
    expect(recoverAddress(new TextEncoder().encode('another message'), sig)).not.toBe(addr(worker));
    const broken = `${sig.slice(0, -2)}1d`;
    expect(recoverAddress(message, broken)).toBeNull();
    expect(recoverAddress(message, broken)).toBeNull();
  });
});
