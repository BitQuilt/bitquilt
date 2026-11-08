import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, problemHash } from '@bitquilt/core';
import { VERDICT, addr, boot, envelope as signed, key } from './helpers.js';

/**
 * A coin-kind lock at a tracker whose coin is kept at another tracker, its home (QX-17 section 5): the door reads the
 * lock from the home's `/coin/lock/<id>`, and where the home's answer gives no burn rate, as an older home's does not,
 * the rate its well-known document publishes, read once and kept for the next lock. What the door read is the word in
 * the receipt. The rate is kept by the tracker that read it and by no other, so two trackers in one process, each
 * reading its own home, each check a lock at their own home's rate. A home that does not answer is said so.
 */
const owner = key(9),
  A = key(1);
const T0 = '2026-11-07T09:00:00.000Z';
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
};
const P = signed(owner, 'homed', {
  'statement/*': {
    count: 3,
    verifier: 'agree',
    requires: ['web'],
    brief: 'Statement {n}: does the paper say so?',
    schema: VERDICT,
    agree: ['verdict'],
  },
});
const p = problemHash(P);
const HEAD = { seq: 4, hash: 'f'.repeat(64) };
const lockId = (n: number) => `sha256:${String(n).padStart(64, '0')}` as Hash;
/** A lock whose read the home fails. */
const FAILING = lockId(8);

/**
 * A home that answers each lock as live, unbound and A's, of 300 units, on the piece the test names for it, with no
 * rate beside it, and publishes `rate` at its well-known document; `asked` counts the reads of each.
 */
function home(rate: number) {
  const pieceOf = new Map<Hash, Hash>();
  const asked = { lock: 0, wellKnown: 0 };
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    const answer = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
    if (url.endsWith('/.well-known/quilt')) {
      asked.wellKnown += 1;
      return answer({ quilt: 1, stake: { extension: 'QX-15', coin: 'here', burn_rate: rate } });
    }
    const id = /\/coin\/lock\/(sha256:[0-9a-f]{64})$/.exec(url)?.[1] as Hash | undefined;
    if (id && pieceOf.has(id)) {
      asked.lock += 1;
      return answer({
        id,
        key: addr(A),
        root: addr(A),
        problem: p,
        piece: pieceOf.get(id),
        units: 300,
        at: T0,
        bound: null,
        state: 'live',
        endedAt: null,
        head: HEAD,
      });
    }
    if (id === FAILING) return new Response('', { status: 500 });
    return new Response(JSON.stringify({ error: 'no such lock on the coin log' }), { status: 404 });
  }) as typeof fetch;
  return { pieceOf, asked, fetchImpl };
}

const cheap = home(100);
const dear = home(200);
const at = new Date(Date.parse(T0) + 3_600_000).toISOString();
const limits = { keyPerHour: 1000, ipPerHour: 10000 };
const t = boot(at, { limits, coin: { ...coin, home: 'http://cheap.test/' }, fetchImpl: cheap.fetchImpl });
const u = boot(at, { limits, coin: { ...coin, home: 'http://dear.test/' }, fetchImpl: dear.fetchImpl });
let pieces: Hash[] = [];

const lock = (b: typeof t, piece: Hash, id: Hash) => b.ev(A, 'lock', { kind: 'coin', amount: 2, id }, p, piece);

beforeAll(async () => {
  await t.listen();
  await u.listen();
  for (const b of [t, u]) {
    expect((await b.post('/p', { envelope: P })).status).toBe(201);
    await b.accepted(`/p/${p}/events`, b.ev(owner, 'stake_rule', { min: 2 }, p));
  }
  pieces = (await t.get<{ pieces: { hash: Hash }[] }>(`/p/${p}/state`)).pieces.map((x) => x.hash);
});
afterAll(async () => {
  await t.close();
  await u.close();
});

describe("a coin lock read from the coin's home", () => {
  it("is admitted on the home's word, with the published rate read once and kept for the next lock", async () => {
    cheap.pieceOf.set(lockId(1), pieces[0]!);
    cheap.pieceOf.set(lockId(2), pieces[1]!);
    await t.accepted(`/p/${p}/events`, lock(t, pieces[0]!, lockId(1)));
    expect(cheap.asked).toEqual({ lock: 1, wellKnown: 1 });
    await t.accepted(`/p/${p}/events`, lock(t, pieces[1]!, lockId(2)));
    expect(cheap.asked).toEqual({ lock: 2, wellKnown: 1 });
    const lines = (await (await fetch(`${t.base}/p/${p}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as { event: { type: string }; received: { stake?: Record<string, unknown> }[] });
    const words = lines.filter((l) => l.event.type === 'lock').map((l) => l.received[0]!.stake);
    expect(words).toEqual([
      { kind: 'coin', amount: 2, id: lockId(1), units: 300, home: 'http://cheap.test/', head: HEAD },
      { kind: 'coin', amount: 2, id: lockId(2), units: 300, home: 'http://cheap.test/', head: HEAD },
    ]);
  });

  it("is checked at each tracker's own home's rate, which another tracker in the process does not share", async () => {
    dear.pieceOf.set(lockId(1), pieces[0]!);
    expect(await u.refused(`/p/${p}/events`, lock(u, pieces[0]!, lockId(1)))).toBe(
      'the lock holds 300 units, a stake of 1 at 200 a point',
    );
    expect(dear.asked).toEqual({ lock: 1, wellKnown: 1 });
    expect(cheap.asked).toEqual({ lock: 2, wellKnown: 1 });
  });

  it('is refused naming a lock the home does not hold, and a home that does not answer', async () => {
    expect(await t.refused(`/p/${p}/events`, lock(t, pieces[2]!, lockId(9)))).toBe('no such lock on the coin log');
    expect(await t.refused(`/p/${p}/events`, lock(t, pieces[2]!, FAILING))).toBe('the home did not answer');
  });
});
