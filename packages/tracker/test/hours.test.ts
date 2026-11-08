import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, eventId, problemHash, reduce } from '@bitquilt/core';
import { HOURS_MAX } from '../src/admit.js';
import { VERDICT, boot, envelope, key } from './helpers.js';

/**
 * PROTOCOL.md, What the door answers: a lease or a challenge window is at most a million hours (`HOURS_MAX`), since the
 * fold adds it to a receipt's time (CORE.md section 6) and a count past the last date that can be written leaves the
 * fold no time, so it fails on the receipt and every page of the door with it. A claim whose `lease_h` is over is
 * refused with the event's shape, and an envelope whose lease, challenge window or piece's lease is over is refused at
 * publish, each naming the field; a claim at the limit is taken, and the door folds it. A peer's line (QX-21) is held
 * to the same: a claim over the limit is not taken, nor a line whose wrapper carries a time that is not one in UTC as
 * a door writes it, and the pull says why for each while the door goes on answering.
 */
const owner = key(9),
  worker = key(1);
const limits = { keyPerHour: 1000, ipPerHour: 10000 };
const START = '2026-11-08T12:00:00Z';
const pieces = (extra: Record<string, unknown> = {}) => ({
  'statement/*': {
    count: 1,
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Statement {n}: does the paper say so?',
    schema: VERDICT,
    agree: ['verdict'],
    ...extra,
  },
});
const P = envelope(owner, 'hours', pieces());
const p = problemHash(P);
const piece = reduce({ envelopes: [P], blobs: new Map(), receipts: [], now: START }).pieces[0]!.piece.hash;
const by = { model: 'anthropic/claude', client: 'test/0', can: ['web'] };
const peer = boot(START, { limits });
let t: ReturnType<typeof boot>;

beforeAll(async () => {
  await peer.listen();
  t = boot(START, { limits, peers: [`${peer.base}/`] });
  await t.listen();
  for (const d of [peer, t]) expect((await d.post('/p', { envelope: P })).status).toBe(201);
});
afterAll(async () => {
  await peer.close();
  await t.close();
});

const answered = async (path: string) => (await fetch(t.base + path)).status;

describe('a lease or a window over a million hours', () => {
  it('is refused on a claim with the event shape, and a claim at the limit is taken and folded', async () => {
    expect(HOURS_MAX).toBe(1_000_000);
    const over = await t.refused(`/p/${p}/events`, t.ev(worker, 'claim', { by, lease_h: HOURS_MAX + 1 }, p, piece));
    expect(over).toBe('body.lease_h: at most 1000000 hours');
    expect(await t.refused(`/p/${p}/events`, t.ev(worker, 'claim', { by, lease_h: 1e12 }, p, piece))).toBe(over);
    await t.accepted(`/p/${p}/events`, t.ev(worker, 'claim', { by, lease_h: HOURS_MAX }, p, piece));
    for (const path of ['/', '/search', `/p/${p}/state`]) expect(await answered(path)).toBe(200);
  });

  it('is refused at publish, naming the field', async () => {
    const publish = async (e: Envelope) => {
      const res = await t.post('/p', { envelope: e });
      return { status: res.status, error: ((await res.json()) as { error?: string }).error };
    };
    expect(await publish(envelope(owner, 'long-lease', pieces(), { settings: { lease_h: 1e9 } }))).toEqual({
      status: 400,
      error: 'problem.settings.lease_h: at most 1000000 hours',
    });
    expect(await publish(envelope(owner, 'long-window', pieces(), { settings: { challenge_window_h: 3e9 } }))).toEqual({
      status: 400,
      error: 'problem.settings.challenge_window_h: at most 1000000 hours',
    });
    expect(await publish(envelope(owner, 'long-piece', pieces({ lease_h: HOURS_MAX + 1 })))).toEqual({
      status: 400,
      error: 'problem.pieces.statement/*.lease_h: at most 1000000 hours',
    });
    expect(
      (
        await publish(
          envelope(owner, 'at-the-limit', pieces({ lease_h: HOURS_MAX }), { settings: { lease_h: HOURS_MAX } }),
        )
      ).status,
    ).toBe(201);
  });
});

describe("a peer's line (QX-21)", () => {
  it('is not taken where its claim is over the limit, or its wrapper carries a time not written as a door writes it', async () => {
    const long = peer.ev(worker, 'claim', { by, lease_h: 1e12 }, p, piece);
    peer.store.appendReceipt(p, long, eventId(long), 'http://peer.test/', long.ts, 'self');
    const stamped = peer.ev(key(2), 'claim', { by }, p, piece);
    peer.store.appendPulled(p, stamped, eventId(stamped), [
      { by: 'http://peer.test/', at: '+275760-09-13T00:00:00.000Z', custody: 'self' },
    ]);
    t.clock.tick = peer.clock.tick + 60_000;
    const [pull] = await t.tracker.pullPeers();
    expect(pull!.refused).toEqual([
      { id: eventId(long), why: 'body.lease_h: at most 1000000 hours' },
      { id: eventId(stamped), why: 'received[0].at: a time in UTC, as a door writes one' },
    ]);
    const held = (await (await fetch(`${t.base}/p/${p}/events`)).text()).trim().split('\n');
    expect(held.map((l) => (JSON.parse(l) as { event: { sig: string } }).event.sig)).not.toContain(long.sig);
    for (const path of ['/', '/search', `/p/${p}/state`]) expect(await answered(path)).toBe(200);
  });
});
