import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, commitHash, newNonce, problemHash } from '@bitquilt/core';
import { addr, boot, envelope, key } from './helpers.js';

/**
 * The directory row (APP.md, Search; CORE.md section 2 on `from`; QX-19 section 3): the tracker's index carries the
 * work on each problem and its quality, what its accepted squares found and how many declined, the pieces by kind,
 * the owner's name and the problem it forks; a fork by another owner shows `from`, and a `from` by the same owner is
 * refused at the door, since a version sets `prev`; a key's latest readings are read at /k/<address>/work with their
 * state, whether the layer set them aside, and grade, newest first, within the limit, with the key's name and
 * standing; and the row's numbers are the state's.
 */
const owner = key(9), other = key(8), A = key(1), B = key(2);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } };
const pieces = { 'statement/*': { count: 2, verifier: 'agree', requires: ['web' as const], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } };

const t = boot('2026-11-02T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Work = { returned: number; accepted: number; verified: number; disputed: number; traced: { both: number; one: number; none: number }; readers: number; vendors: number; last: string | null; declined: number; found: Record<string, Record<string, number>> };
type Row = { problem: Hash; owner: string; owner_name: string | null; from: Hash | null; kinds: Record<string, number>; work: Work };
type Found = { problems: Row[] };
type Readings = { address: string; root: string; name: string | null; standing: number; readings: { problem: Hash; title: string; piece: Hash; name: string; at: string; state: string; aside: boolean; verified: boolean; traced: string | null }[] };

const env = envelope(owner, 'paper', pieces, { title: 'Does the paper say so?' });
const P = problemHash(env);
let s1: Hash, s2: Hash;

async function returned(piece: Hash, k: Uint8Array, model: string, verdict: string): Promise<void> {
  const ret = { verdict };
  const nonce = newNonce();
  await accepted(`/p/${P}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
  await accepted(`/p/${P}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, piece));
}
const rowOf = async (hash: Hash): Promise<Row> => (await get<Found>('/search?q=paper')).problems.find((r) => r.problem === hash)!;

describe('the directory row', () => {
  it('carries the work and its quality, the pieces by kind, the owner and what is forked, all empty on a fresh problem', async () => {
    expect((await post('/p', { envelope: env })).status).toBe(201);
    const st = await get<{ pieces: { hash: Hash }[] }>(`/p/${P}/state`);
    [s1, s2] = [st.pieces[0]!.hash, st.pieces[1]!.hash];
    expect(await rowOf(P)).toMatchObject({ owner: addr(owner), owner_name: null, from: null, kinds: { agree: 2 }, work: { returned: 0, accepted: 0, verified: 0, disputed: 0, traced: { both: 0, one: 0, none: 0 }, readers: 0, vendors: 0, last: null, declined: 0, found: {} } });
  });

  it('counts a square accepted across vendors as returned, accepted and graded none, with its readers, its vendors and the last reading, the same numbers as the state', async () => {
    await returned(s1, A, 'anthropic/claude', 'supports');
    await returned(s1, B, 'openai/gpt-5', 'supports');
    const row = await rowOf(P);
    expect(row.work).toMatchObject({ returned: 1, accepted: 1, verified: 0, disputed: 0, traced: { both: 0, one: 0, none: 1 }, readers: 2, vendors: 2, declined: 0 });
    // What the accepted squares found: the agreed choice, counted.
    expect(row.work.found).toEqual({ verdict: { supports: 1 } });
    expect(row.work.last).toMatch(/^2026-11-02T/);
    const st = await get<{ pieces: { state: string; reveals: number }[] }>(`/p/${P}/state`);
    expect(st.pieces.filter((p) => p.state === 'accepted_provisional')).toHaveLength(row.work.accepted);
    expect(st.pieces.reduce((n, p) => n + p.reveals, 0)).toBe(2);
    expect((await get<Row>(`/p/${P}/scrape`)).work.accepted).toBe(1);
  });

  it('names the owner once the identity log does', async () => {
    expect((await post('/k/events', ev(owner, 'name', { name: 'Ada' }))).status).toBe(202);
    expect((await rowOf(P)).owner_name).toBe('Ada');
  });

  it('shows a fork by another owner with from, refuses a from by the same owner, and takes a fork of a problem not held here on the forker\'s word', async () => {
    const fork = envelope(other, 'paper', pieces, { title: 'Does the paper say so? Asked again.', from: P });
    expect((await post('/p', { envelope: fork })).status).toBe(201);
    expect(await rowOf(problemHash(fork))).toMatchObject({ owner: addr(other), owner_name: null, from: P, work: { returned: 0 } });
    const again = envelope(owner, 'paper-again', pieces, { title: 'The same owner, again', from: P });
    const r = await post('/p', { envelope: again });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('from: by the same owner; a version sets prev');
    const elsewhere = envelope(other, 'paper-elsewhere', pieces, { title: 'Forked from a problem held elsewhere', from: `sha256:${'ab'.repeat(32)}` as Hash });
    expect((await post('/p', { envelope: elsewhere })).status).toBe(201);
  });

  it('lists a key\'s latest readings newest first with their state and grade, within the limit, with its name and standing, and refuses a bad address', async () => {
    await returned(s2, A, 'anthropic/claude', 'contradicts');
    const w = await get<Readings>(`/k/${addr(A)}/work`);
    expect(w).toMatchObject({ address: addr(A), root: addr(A), name: null });
    expect(typeof w.standing).toBe('number');
    expect(w.readings.map((r) => [r.name, r.state, r.traced])).toEqual([['statement/2', 'needs_verify', null], ['statement/1', 'accepted_provisional', 'none']]);
    expect(w.readings[0]).toMatchObject({ problem: P, piece: s2, title: 'Does the paper say so?', aside: false, verified: false });
    expect(w.readings[0]!.at > w.readings[1]!.at).toBe(true);
    expect((await get<Readings>(`/k/${addr(A)}/work?limit=1`)).readings.map((r) => r.name)).toEqual(['statement/2']);
    expect((await get<Readings>(`/k/${addr(B)}/work`)).readings).toHaveLength(1);
    expect((await get<Readings>(`/k/${addr(owner)}/work`)).name).toBe('Ada');
    expect((await fetch(`${t.base}/k/${addr(A).toLowerCase()}/work`)).status).toBe(400);
    // A decline, a model's refusal among them, is counted beside the work.
    await accepted(`/p/${P}/events`, ev(other, 'decline', { reason: 'refuse' }, P, s2));
    expect((await rowOf(P)).work.declined).toBe(1);
  });

  it('keeps an announce that states the owner, the fork, the pieces, the counts and the work, refuses one that states them wrong, and gives the scrape the topics (QX-13)', async () => {
    const work = { returned: 1, accepted: 1, verified: 0, disputed: 0, traced: { both: 0, one: 0, none: 1 }, readers: 2, vendors: 2, last: '2026-11-02T12:00:01Z' };
    const body = { title: env.problem.title, slug: env.problem.slug, done_when: env.problem.done_when, topics: ['paper'], owner: addr(owner), from: null, pieces: 2, counts: { open: 1, accepted_provisional: 1 }, work, trackers: [], mirrors: [] };
    expect((await post(`/p/${P}/events`, ev(owner, 'announce', body, P))).status).toBe(202);
    expect(await t.refused(`/p/${P}/events`, ev(owner, 'announce', { ...body, owner: addr(other) }, P))).toMatch(/announce: owner is the envelope's/);
    expect(await t.refused(`/p/${P}/events`, ev(owner, 'announce', { ...body, from: P }, P))).toMatch(/announce: from is the envelope's/);
    expect(await t.refused(`/p/${P}/events`, ev(owner, 'announce', { ...body, work: { ...work, readers: -1 } }, P))).toMatch(/announce: pieces, counts and work are whole numbers/);
    expect(await t.refused(`/p/${P}/events`, ev(owner, 'announce', { ...body, pieces: 1.5 }, P))).toMatch(/announce: pieces, counts and work are whole numbers/);
    expect((await get<Row & { topics: string[] }>(`/p/${P}/scrape`)).topics).toEqual(['paper']);
  });
});
