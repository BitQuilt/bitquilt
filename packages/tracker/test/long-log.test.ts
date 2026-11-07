import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, type Receipt, IDENTITY_LOG } from '@bitquilt/core';
import { COIN_LOG } from '../src/coin.js';
import { VERDICT_QUOTE, addr, boot, envelope as signed, key } from './helpers.js';

/**
 * QX-11's chained logs, read whole where the whole is meant. The store once cut a log at ten thousand lines when a
 * caller named no bounds, and the fold, the hides, the coin, the scrape and the counts named none. Each now reads
 * every line: the fold takes a claim past that line and the counts count it, the coin credits a deposit past it and
 * the challenge layer counts a burn past it as standing (QX-17), the scrape finds a break past it, a maintainer's hide
 * past it on the identity log takes effect (QX-6), and the fold takes a delegation past it on the same log, as the
 * mirror and the client already read them. The routes that page still page.
 */
const owner = key(9),
  M = key(21),
  A = key(1),
  A2 = key(3),
  B = key(2),
  F = key(30),
  treasury = key(7),
  reader = key(40);
const by = { model: 'meta/llama', client: 'test/0', can: ['web'] };

/** The page the store gave a caller that named no bounds: a log one line longer is past it. */
const OLD_PAGE = 10_000;

const T0 = '2026-10-27T00:00:00.000Z';
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
const t = boot('2026-10-27T09:00:00Z', {
  maintainers: [addr(M)],
  limits: { keyPerHour: 1000, ipPerHour: 10000 },
  coin,
});
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

function envelope(slug: string): Envelope {
  return signed(owner, slug, {
    'statement/*': {
      count: 2,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: does the paper say so?',
      schema: VERDICT_QUOTE,
      agree: ['verdict'],
    },
  });
}
async function publish(slug: string): Promise<Hash> {
  const r = await post('/p', { envelope: envelope(slug), blobs: {} });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}

/**
 * A line of filler: an event of a type no reader folds, received before the tracker's clock starts. The store keeps
 * the lines it is given and the door is what checks a signature, so one signature stands in for every filler line.
 */
const filler = (() => {
  const at = '2026-10-27T08:00:00.000Z';
  const signer = addr(F);
  const sig = ev(F, 'note', { n: 0 }).sig;
  return (n: number, hash?: string): Receipt => ({
    event: { quilt: 1, type: 'note', key: signer, ts: at, body: { n }, sig },
    received: [{ by: 'http://tracker.test/', at }],
    ...(hash ? { hash } : {}),
  });
})();
/** `n` lines of filler on a log, put into the store directly so the test stays fast. */
function fill(log: Hash, n: number): void {
  t.store.appendLines(
    log,
    Array.from({ length: n }, (_, i) => filler(i)),
  );
}

type Piece = { hash: Hash; state: string };
const piecesOf = async (problem: Hash) => ((await get(`/p/${problem}/state`)) as { pieces: Piece[] }).pieces;

describe("a log longer than the store's old page (QX-11)", () => {
  let P: Hash;
  let claimed: Hash;
  it("reads a problem's chain whole by its lines and a page of it by both bounds, and the events route still pages", async () => {
    P = await publish('long');
    fill(P, OLD_PAGE);
    claimed = (await piecesOf(P))[0]!.hash;
    await accepted(`/p/${P}/events`, ev(A, 'claim', { by }, P, claimed));
    const whole = t.store.lines(P);
    expect(whole).toHaveLength(OLD_PAGE + 1);
    expect(whole.at(-1)!.event.type).toBe('claim');
    expect(t.store.receipts(P, 0, 500).map((l) => l.seq)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
    expect(t.store.receipts(P, OLD_PAGE, 500).map((l) => l.event.type)).toEqual(['claim']);
    const first = await fetch(`${t.base}/p/${P}/events`);
    expect(first.headers.get('x-quilt-next-since')).toBe('500');
    expect((await first.text()).trim().split('\n')).toHaveLength(500);
    const last = await fetch(`${t.base}/p/${P}/events?since=${OLD_PAGE}`);
    expect(last.headers.get('x-quilt-next-since')).toBeNull();
    expect(
      (await last.text())
        .trim()
        .split('\n')
        .map((l) => (JSON.parse(l) as Receipt).event.type),
    ).toEqual(['claim']);
  });
  it('folds a claim past the old page, and the counts count it', async () => {
    expect((await piecesOf(P)).find((p) => p.hash === claimed)!.state).toBe('in_flight');
    const counts = (await get('/counts?days=1')) as { totals: { claims: number } };
    expect(counts.totals.claims).toBe(1);
  });
  it('credits a deposit past the old page of the coin log, and refuses the same deposit twice (QX-17)', async () => {
    fill(COIN_LOG, OLD_PAGE);
    await accepted('/coin/events', ev(reader, 'credit', { deposit: 1, root: addr(B), amount: 100 }));
    expect(t.store.head(COIN_LOG)!.seq).toBe(OLD_PAGE + 1);
    expect(await get(`/coin/balance/${addr(B)}`)).toMatchObject({ credited: 100, received: 100 });
    const again = await post('/coin/events', ev(reader, 'credit', { deposit: 1, root: addr(B), amount: 5 }));
    expect(again.status).toBe(400);
    expect(((await again.json()) as { error: string }).error).toBe('deposit 1 is credited already');
  });
  it('counts a burn past the old page of the coin log as standing (QX-17)', async () => {
    const standingOf = async () => ((await get(`/k/${addr(B)}/standing`)) as { standing: number }).standing;
    const before = await standingOf();
    // A burn rate of 100: the credit above is one point of standing once it is burned.
    await accepted('/coin/events', ev(B, 'burn', { amount: 100 }));
    expect(t.store.head(COIN_LOG)!.seq).toBe(OLD_PAGE + 2);
    expect(await get(`/coin/balance/${addr(B)}`)).toMatchObject({ burned: 100 });
    expect(await standingOf()).toBe(before + 1);
  });
  it('finds a break in a chain past the old page', async () => {
    const R = await publish('broken');
    fill(R, OLD_PAGE);
    // A line kept with a hash its contents do not give: the chain breaks one line past the old page.
    t.store.appendLines(R, [filler(OLD_PAGE, '0'.repeat(64))]);
    const scrape = (await get(`/p/${R}/scrape`)) as { chain_ok: boolean; head: { seq: number } };
    expect(scrape.head.seq).toBe(OLD_PAGE + 1);
    expect(scrape.chain_ok).toBe(false);
  });
  it("takes a maintainer's hide past the old page of the identity log (QX-6)", async () => {
    const Q = await publish('hidden');
    fill(IDENTITY_LOG, OLD_PAGE);
    await accepted('/k/events', ev(M, 'hide', { id: Q, why: 'The brief names a private person.' }));
    expect(t.store.head(IDENTITY_LOG)!.seq).toBe(OLD_PAGE + 1);
    const hidden = (await get('/hidden')) as { hidden: { id: string; by: string }[] };
    expect(hidden.hidden.map((h) => [h.id, h.by])).toEqual([[Q, addr(M)]]);
    const listed = ((await get('/search?q=')) as { problems: { problem: Hash }[] }).problems.map((p) => p.problem);
    expect(listed).toContain(P);
    expect(listed).not.toContain(Q);
    expect(((await get(`/p/${Q}/state`)) as { hidden: { by: string } | null }).hidden?.by).toBe(addr(M));
  });
  it('folds a delegation past the old page of the identity log', async () => {
    expect(t.store.head(IDENTITY_LOG)!.seq).toBeGreaterThan(OLD_PAGE);
    await accepted(
      '/k/events',
      ev(A, 'delegate', { to: addr(A2), scope: ['claim', 'commit', 'reveal'], expires: '2027-01-01T00:00:00Z' }),
    );
    const later = new Date(t.clock.tick + 1000).toISOString();
    expect(t.tracker.reduceProblem(P)!.rootOf(addr(A2), later)).toBe(addr(A));
  });
});
