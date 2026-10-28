import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type Envelope, type Hash, commitHash, newNonce, problemHash } from '@bitquilt/core';
import { Store } from '../src/store.js';
import { addr, boot, envelope as signed, key } from './helpers.js';

/**
 * The launch funnel counted by the UTC day (JOURNEY-AUDIT.md section 3, item 9) at GET /counts: every day of the
 * window with its zeros and the window's bounds, a window it cannot give refused; the claims, reveals, accepted sets
 * and verified squares by the day of the receipt, and each key's first event on a problem log, hosted apart from own,
 * with the identity log left out; the addresses the hosted on-ramp made, first used and took home, from the members
 * table and the two marks that fill it, each kept once; the totals over the window and the window cutting what is
 * before it; and no address, name or hash anywhere in the answer.
 */
const ownerP = key(9), ownerQ = key(8), A = key(1), B = key(2), X = key(3), N = key(5);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };
function envelope(owner: Uint8Array, slug: string, count: number): Envelope {
  return signed(owner, slug, { 'statement/*': { count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } });
}

const DAY1 = '2026-10-27T10:00:00.000Z';
const DAY2 = '2026-10-28T09:00:00.000Z';
const DAY3 = '2026-10-29T12:00:00.000Z';
const CUSTODY = 'custody-secret';
const hosted = { 'x-quilt-custody': CUSTODY };
const t = boot(DAY1, { limits: { keyPerHour: 1000, ipPerHour: 10000 }, custodySecret: CUSTODY });
const { clock, store, ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Counts = { addresses_made: number; addresses_first_used: number; keys_taken_home: number; keys_first_event: { hosted: number; own: number }; claims: number; reveals: number; sets_accepted: number; squares_verified: number };
type Day = Counts & { day: string };
type Funnel = { now: string; window: { days: number; from: string; to: string }; by_day: Day[]; totals: Counts; error?: string };
const counts = (query = '') => get<Funnel>(`/counts${query}`);
const zero: Counts = { addresses_made: 0, addresses_first_used: 0, keys_taken_home: 0, keys_first_event: { hosted: 0, own: 0 }, claims: 0, reveals: 0, sets_accepted: 0, squares_verified: 0 };
const FIELDS = ['addresses_first_used', 'addresses_made', 'claims', 'day', 'keys_first_event', 'keys_taken_home', 'reveals', 'sets_accepted', 'squares_verified'];

async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string, headers?: Record<string, string>) {
  const ret = { verdict: 'supports', quote: `as ${addr(k).slice(0, 6)} read it` };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece), headers);
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece), headers);
}
type PieceState = { hash: Hash; state: string; verified: boolean };
const pieceOf = async (problem: Hash, piece: Hash) => ((await get(`/p/${problem}/state`)) as { pieces: PieceState[] }).pieces.find((x) => x.hash === piece)!;

const P = envelope(ownerP, 'golden', 2);
const Q = envelope(ownerQ, 'elsewhere', 2);
const p = problemHash(P);
const q = problemHash(Q);
let p1: Hash, q1: Hash;
const gold = { projection: { verdict: 'supports' }, nonce: newNonce() };

describe('the funnel, counted', () => {
  it('lists the route, answers every day of the window with zeros before anything happened, and refuses a window it cannot give', async () => {
    const w = await get<{ routes: string[] }>('/.well-known/quilt');
    expect(w.routes).toContain('/counts');
    const f = await counts();
    expect(f.now).toBe(DAY1);
    expect(f.window).toEqual({ days: 30, from: '2026-09-28', to: '2026-10-27' });
    expect(f.by_day).toHaveLength(30);
    expect(f.by_day[0]).toEqual({ day: '2026-09-28', ...zero });
    expect(f.by_day[29]!.day).toBe('2026-10-27');
    expect(f.totals).toEqual(zero);
    expect((await counts('?days=365')).by_day).toHaveLength(365);
    expect((await counts('?days=1')).by_day.map((d) => d.day)).toEqual(['2026-10-27']);
    for (const bad of ['0', '366', '1.5', 'x']) expect((await counts(`?days=${bad}`)).error).toBe('days: a whole number from 1 to 365');
    expect((await fetch(`${t.base}/counts`, { method: 'POST' })).status).toBe(404);
  });

  it('counts claims, reveals, accepted sets, verified squares and each key\'s first event, hosted apart from own, by the day of the receipt', async () => {
    // Day one: both problems published; the owner of P earns the standing its gold asks by a return on Q beside a key of another vendor, then commits one blind gold.
    expect((await post('/p', { envelope: P })).status).toBe(201);
    expect((await post('/p', { envelope: Q })).status).toBe(201);
    p1 = ((await get(`/p/${p}/state`)) as { pieces: PieceState[] }).pieces[0]!.hash;
    q1 = ((await get(`/p/${q}/state`)) as { pieces: PieceState[] }).pieces[0]!.hash;
    await returnOn(q, q1, ownerP, 'anthropic/claude');
    await returnOn(q, q1, X, 'openai/gpt');
    await accepted(`/p/${p}/events`, ev(ownerP, 'gold', { commitments: [commitHash({ piece: p1, projection: gold.projection }, gold.nonce)], stake: 2 }, p));
    let f = await counts('?days=1');
    expect(f.by_day).toEqual([{ day: '2026-10-27', ...zero, keys_first_event: { hosted: 0, own: 2 }, reveals: 2, sets_accepted: 1 }]);
    // Day two: a hosted key and a key of its own claim and return on P's piece, the owner reveals the gold and the square is verified; a name on the identity log is no first event.
    clock.tick = Date.parse(DAY2);
    await accepted(`/p/${p}/events`, ev(A, 'claim', { by: by('anthropic/claude') }, p, p1), hosted);
    await accepted(`/p/${p}/events`, ev(B, 'claim', { by: by('openai/gpt') }, p, p1));
    await returnOn(p, p1, A, 'anthropic/claude', hosted);
    await returnOn(p, p1, B, 'openai/gpt');
    await accepted(`/p/${p}/events`, ev(ownerP, 'gold_reveal', gold, p, p1));
    expect(await pieceOf(p, p1)).toMatchObject({ state: 'accepted_provisional', verified: true });
    await accepted('/k/events', ev(N, 'name', { name: 'Ada' }));
    f = await counts('?days=2');
    expect(f.by_day).toEqual([
      { day: '2026-10-27', ...zero, keys_first_event: { hosted: 0, own: 2 }, reveals: 2, sets_accepted: 1 },
      { day: '2026-10-28', ...zero, keys_first_event: { hosted: 1, own: 1 }, claims: 2, reveals: 2, sets_accepted: 1, squares_verified: 1 },
    ]);
  });

  it('counts the hosted addresses by the day they were made, first used and taken home, each mark kept once', async () => {
    store.putMember('member-one', addr(key(31)), 'enc', DAY1);
    store.putMember('member-two', addr(key(32)), 'enc', DAY1);
    let f = await counts('?days=2');
    expect(f.by_day.map((d) => [d.addresses_made, d.addresses_first_used, d.keys_taken_home])).toEqual([[2, 0, 0], [0, 0, 0]]);
    store.markMemberUsed('member-one', DAY2);
    store.markMemberKeyTaken('member-two', DAY2);
    store.markMemberUsed('nobody', DAY2);
    f = await counts('?days=2');
    expect(f.by_day.map((d) => [d.addresses_made, d.addresses_first_used, d.keys_taken_home])).toEqual([[2, 0, 0], [0, 1, 1]]);
    // A second mark changes nothing: the first use stays on its day.
    store.markMemberUsed('member-one', DAY1);
    store.markMemberKeyTaken('member-two', DAY1);
    f = await counts('?days=2');
    expect(f.by_day.map((d) => [d.addresses_made, d.addresses_first_used, d.keys_taken_home])).toEqual([[2, 0, 0], [0, 1, 1]]);
    expect(store.getMember('member-one')).toMatchObject({ address: addr(key(31)), createdAt: DAY1 });
  });

  it('sums the window, cuts what is before it, and names nobody', async () => {
    clock.tick = Date.parse(DAY3);
    const f = await counts('?days=3');
    expect(f.window).toEqual({ days: 3, from: '2026-10-27', to: '2026-10-29' });
    expect(f.by_day[2]).toEqual({ day: '2026-10-29', ...zero });
    expect(f.totals).toEqual({ addresses_made: 2, addresses_first_used: 1, keys_taken_home: 1, keys_first_event: { hosted: 1, own: 3 }, claims: 2, reveals: 4, sets_accepted: 2, squares_verified: 1 });
    const today = await counts('?days=1');
    expect(today.by_day).toEqual([{ day: '2026-10-29', ...zero }]);
    expect(today.totals).toEqual(zero);
    const text = JSON.stringify(f);
    expect(text).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(text).not.toMatch(/sha256:/);
    expect(text).not.toMatch(/Ada|member-/);
    expect(Object.keys(f).sort()).toEqual(['by_day', 'now', 'totals', 'window']);
    for (const d of f.by_day) expect(Object.keys(d).sort()).toEqual(FIELDS);
  });

  it('gives a database made before the two columns them on open, and opens one that has them again', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quilt-counts-'));
    const path = join(dir, 'tracker.db');
    try {
      const before = new DatabaseSync(path);
      before.exec('create table members (token_hash text primary key, address text not null, key_enc text not null, created_at text not null, name text)');
      before.prepare('insert into members (token_hash, address, key_enc, created_at) values (?, ?, ?, ?)').run('old', addr(key(33)), 'enc', DAY1);
      before.close();
      const upgraded = new Store(path);
      expect(upgraded.memberTimes()).toEqual([{ createdAt: DAY1, firstUsedAt: null, keyTakenAt: null }]);
      upgraded.markMemberUsed('old', DAY2);
      upgraded.close();
      const again = new Store(path);
      expect(again.memberTimes()).toEqual([{ createdAt: DAY1, firstUsedAt: DAY2, keyTakenAt: null }]);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
