import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, hashCanonical, newNonce } from '@bitquilt/core';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * One record for a line (docs/v2/READING.md sections 2 and 3, and the first departure of its section 12). "A line is
 * the versions of one problem under one owner: two problems are of one line where their chains along `prev` share a
 * version", and "For each line and each piece of it, the record is every event that names the piece and a version of
 * the line". So an older version's map shows the work posted to a later version on a piece it keeps, two versions
 * made from the same one share a record, and a rank or a seed that names one version is read at each. A piece only
 * another version holds is no piece of this one, the core's own state of a piece is still version 1's, read over the
 * version's own chain, and "A fork, which names another owner's problem in `from`, begins a line of its own". This
 * file leaves one ledger that shows each.
 */

const owner = key(9),
  elsewhere = key(8),
  forker = key(7),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  F = key(6),
  G = key(10),
  J1 = key(11),
  J2 = key(12);
const secretOf = new Map<Address, Uint8Array>([J1, J2].map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const TEXT = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['text'],
  properties: { text: { type: 'string' as const, maxLength: 200 } },
};
const one = { ...agree, brief: 'Is the first claim in the paper?' };
const two = { ...agree, brief: 'Is the second claim in the paper?' };
const three = { ...agree, brief: 'Is the third claim in the paper?' };
const four = { ...agree, brief: 'Is the fourth claim in the paper?' };
/** A judged piece with a panel of one. */
const summary = {
  verifier: 'judge:1',
  candidates: 2,
  requires: ['web' as const],
  brief: 'Summarise the paper in a sentence.',
  schema: TEXT,
};

const t = boot('2026-11-11T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Shown = { name: string; hash: Hash; state: string; core: string };
type Panel = { outcome: string; winner: Hash | null; seats: { root: Address }[] };
const pieces = (problem: Hash): Shown[] => t.tracker.layer().problems.get(problem)!.pieces as Shown[];
const shown = (problem: Hash, name: string) => pieces(problem).find((p) => p.name === name);
const stateOf = (problem: Hash, name: string) => shown(problem, name)!.state;
const panelsOf = async (problem: Hash) => (await get<{ panels: Panel[] }>(`/p/${problem}/panels`)).panels;

async function publish(e: ReturnType<typeof envelope>): Promise<Hash> {
  const r = await post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
/** A commit and its reveal on a piece, posted to the version named; the return's digest, which a rank names. */
async function returned(problem: Hash, name: string, k: Uint8Array, model: string, ret: Record<string, unknown>) {
  const piece = shown(problem, name)!.hash;
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
  return hashCanonical(ret);
}
const SUPPORTS = { verdict: 'supports' };

describe('one record for a line', () => {
  let V1: Hash, V2: Hash, SIDE: Hash, FORK: Hash;

  beforeAll(async () => {
    // A problem of another line, whose one square gives the two roots a judge panel is drawn from.
    const q = await publish(envelope(elsewhere, 'elsewhere', { claim: { ...agree, brief: 'Is it so?' } }));
    await returned(q, 'claim', J1, 'anthropic/claude', SUPPORTS);
    await returned(q, 'claim', J2, 'openai/gpt', SUPPORTS);
    V1 = await publish(envelope(owner, 'paper', { one, two, summary }));
    V2 = await publish(envelope(owner, 'paper', { one, two, summary, three }, { prev: V1, title: 'The second' }));
    SIDE = await publish(envelope(owner, 'paper', { one, two, four }, { prev: V1, title: 'Beside the second' }));
    FORK = await publish(envelope(forker, 'paper-again', { one, two }, { from: V1 }));
  });

  it('shows on an older version the work posted to a later one on a piece it keeps', async () => {
    await returned(V1, 'one', A, 'anthropic/claude', SUPPORTS);
    await returned(V2, 'one', B, 'openai/gpt', SUPPORTS);
    for (const v of [V1, V2, SIDE]) expect(stateOf(v, 'one')).toBe('accepted_provisional');
    // The core's state is version 1's: the older version's own chain holds one of the two readings.
    expect(shown(V1, 'one')!.core).toBe('needs_verify');
    expect(shown(V2, 'one')!.core).toBe('accepted_provisional');
  });

  it('keeps a piece only a later version holds off the older version, which is not complete for it', async () => {
    await returned(V2, 'three', C, 'anthropic/claude', SUPPORTS);
    await returned(V2, 'three', D, 'openai/gpt', SUPPORTS);
    expect(stateOf(V2, 'three')).toBe('accepted_provisional');
    expect(shown(V1, 'three')).toBeUndefined();
    expect(shown(SIDE, 'three')).toBeUndefined();
  });

  it('begins a line of its own at a fork, whose readings are on no record but its own', async () => {
    await returned(V1, 'two', D, 'openai/gpt', SUPPORTS);
    await returned(FORK, 'two', C, 'anthropic/claude', SUPPORTS);
    // Two readings that agree, of two vendors, and no set: one names the line and the other the fork.
    expect(stateOf(V1, 'two')).toBe('needs_verify');
    expect(stateOf(V2, 'two')).toBe('needs_verify');
    expect(stateOf(FORK, 'two')).toBe('needs_verify');
  });

  it('gives two versions made from the same one a record they share', async () => {
    // The second reading names the version beside the second, and the set is on each version that keeps the piece.
    await returned(SIDE, 'two', E, 'anthropic/claude', SUPPORTS);
    for (const v of [V1, V2, SIDE]) expect(stateOf(v, 'two')).toBe('accepted_provisional');
    await returned(SIDE, 'four', F, 'anthropic/claude', SUPPORTS);
    await returned(SIDE, 'four', G, 'openai/gpt', SUPPORTS);
    expect(stateOf(SIDE, 'four')).toBe('accepted_provisional');
    expect(shown(V2, 'four')).toBeUndefined();
  });

  it('reads a rank that names one version on each version that keeps the piece', async () => {
    const first = await returned(V1, 'summary', C, 'anthropic/claude', { text: 'The paper makes three claims.' });
    const second = await returned(V2, 'summary', F, 'openai/gpt', { text: 'Three claims, each with a source.' });
    // The candidates are the line's, one posted to each version, so each version seats the one panel.
    const [older] = await panelsOf(V1);
    const [later] = await panelsOf(V2);
    expect(older).toMatchObject({ outcome: 'open', winner: null });
    expect(older!.seats).toHaveLength(1);
    expect(later!.seats).toEqual(older!.seats);
    const judge = older!.seats[0]!.root;
    const piece = shown(V2, 'summary')!.hash;
    await accepted(`/p/${V2}/events`, ev(secretOf.get(judge)!, 'rank', { ranking: [second, first] }, V2, piece));
    for (const v of [V1, V2]) {
      expect((await panelsOf(v))[0]).toMatchObject({ outcome: 'decided', winner: second });
      expect(stateOf(v, 'summary')).toBe('accepted_provisional');
    }
  });

  it('counts a seed that names a later version on the older one', async () => {
    const seeders = async (v: Hash) => (await get<{ seeders: number }>(`/p/${v}/scrape`)).seeders;
    expect(await seeders(V1)).toBe(0);
    await accepted(`/p/${V2}/events`, ev(A, 'seed', { on: true }, V2));
    for (const v of [V1, V2, SIDE]) expect(await seeders(v)).toBe(1);
    expect(await seeders(FORK)).toBe(0);
  });

  it('completes the older version once the windows close on work posted across its line', async () => {
    t.clock.tick += 49 * 3600 * 1000;
    for (const name of ['one', 'two', 'summary']) expect(stateOf(V1, name)).toBe('accepted');
    const complete = async (v: Hash) => (await get<{ complete: boolean }>(`/p/${v}/state`)).complete;
    expect(await complete(V1)).toBe(true);
    expect(await complete(V2)).toBe(true);
    expect(await complete(SIDE)).toBe(true);
  });
});
