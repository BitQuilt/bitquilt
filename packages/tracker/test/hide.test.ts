import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, eventId } from '@bitquilt/core';
import { addr, boot, envelope as signed, key } from './helpers.js';

/**
 * QX-6 at the tracker: a hide is taken only from a maintainer's key and only well formed; a hidden problem leaves the
 * index, the search and the offer, hands out no piece and takes no event, while its envelope and chain are still
 * served; a lift restores it; a hidden event is listed for renderers to honour.
 */
const owner = key(9), M = key(21), X = key(22), A = key(1);
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };

function envelope(slug: string): Envelope {
  return signed(owner, slug, { 'statement/*': { count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } });
}

const t = boot('2026-10-27T09:00:00Z', { maintainers: [addr(M)], limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

async function publish(e: Envelope): Promise<Hash> {
  const r = await post('/p', { envelope: e, blobs: {} });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
const listed = async () => ((await get('/search?q=')) as { problems: { problem: Hash }[] }).problems.map((p) => p.problem).sort();
const by = { model: 'meta/llama', client: 'test/0', can: ['web'] };

let P: Hash, Q: Hash, qPiece: Hash, claimId: Hash;

describe('hide and a maintainer\'s key (QX-6)', () => {
  it('takes a hide only from a maintainer and only well formed', async () => {
    P = await publish(envelope('p'));
    Q = await publish(envelope('q'));
    expect(await listed()).toEqual([P, Q].sort());
    const notM = await post('/k/events', ev(X, 'hide', { id: P, why: 'Not mine to say.' }));
    expect(notM.status).toBe(403);
    const bad = await post('/k/events', ev(M, 'hide', { id: 'not a hash', why: 'x' }));
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/body\.id/);
    const link = await post('/k/events', ev(M, 'hide', { id: P, why: 'see https://x.y' }));
    expect(link.status).toBe(400);
    const onProblem = await post(`/p/${P}/events`, ev(M, 'hide', { id: P, why: 'wrong log' }, P));
    expect(onProblem.status).toBe(400);
  });
  it('a hidden problem leaves the index, the search and the offer, hands out no piece and takes no event, and is still served by hash', async () => {
    const r = await post('/k/events', ev(M, 'hide', { id: P, why: 'The brief names a private person.' }));
    expect(r.status, await r.clone().text()).toBe(202);
    expect(await listed()).toEqual([Q]);
    expect(((await get('/')) as { problems: { problem: Hash }[] }).problems.map((p) => p.problem)).toEqual([Q]);
    const offer = (await get(`/offer?key=${addr(A)}&can=web&model=meta/llama`)) as { offers: { problem: Hash }[] };
    expect(offer.offers.map((o) => o.problem)).toEqual([Q]);
    const nextR = await fetch(`${t.base}/p/${P}/next?key=${addr(A)}&can=web&model=meta/llama`);
    expect(nextR.status).toBe(410);
    const state = (await get(`/p/${P}/state`)) as { pieces: { hash: Hash }[]; hidden: { by: string; why: string } | null };
    expect(state.hidden?.by).toBe(addr(M));
    expect(state.hidden?.why).toBe('The brief names a private person.');
    const scrape = (await get(`/p/${P}/scrape`)) as { hidden: { by: string } | null; chain_ok: boolean };
    expect(scrape.hidden?.by).toBe(addr(M));
    expect(scrape.chain_ok).toBe(true);
    const env = (await get(`/p/${P}`)) as { problem: { slug: string } };
    expect(env.problem.slug).toBe('p');
    const claim = await post(`/p/${P}/events`, ev(A, 'claim', { by }, P, state.pieces[0]!.hash));
    expect(claim.status).toBe(410);
    const hidden = (await get('/hidden')) as { hidden: { id: string; by: string }[] };
    expect(hidden.hidden.map((h) => h.id)).toEqual([P]);
    const wk = (await get('/.well-known/quilt')) as { hide: string; maintainers: string[]; routes: string[] };
    expect(wk.hide).toBe('QX-6');
    expect(wk.maintainers).toEqual([addr(M)]);
    expect(wk.routes).toContain('/hidden');
  });
  it('a lift restores the problem, and a hide of one event is listed while the problem stays', async () => {
    expect((await post('/k/events', ev(M, 'hide', { id: P, why: 'Lifted: the brief was changed.', on: false }))).status).toBe(202);
    expect(await listed()).toEqual([P, Q].sort());
    expect(((await get(`/p/${P}/scrape`)) as { hidden: unknown }).hidden).toBeNull();
    const qs = (await get(`/p/${Q}/state`)) as { pieces: { hash: Hash }[] };
    qPiece = qs.pieces[0]!.hash;
    const claim = ev(A, 'claim', { by }, Q, qPiece);
    claimId = eventId(claim);
    expect((await post(`/p/${Q}/events`, claim)).status).toBe(202);
    expect((await post('/k/events', ev(M, 'hide', { id: claimId, why: 'The claim carries a slur in its client field.' }))).status).toBe(202);
    const hidden = (await get('/hidden')) as { hidden: { id: string }[] };
    expect(hidden.hidden.map((h) => h.id)).toEqual([claimId]);
    expect(await listed()).toEqual([P, Q].sort());
    // The chain still carries the hidden event: history keeps everything.
    const lines = (await (await fetch(`${t.base}/p/${Q}/events`)).text()).trim().split('\n');
    expect(lines.some((l) => eventId((JSON.parse(l) as { event: Parameters<typeof eventId>[0] }).event) === claimId)).toBe(true);
  });
});
