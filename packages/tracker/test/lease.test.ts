import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, hashCanonical, newNonce } from '@bitquilt/core';
import { VERDICT, addr, boot, envelope, keepReading, key } from './helpers.js';

/**
 * The lease and the window across a line (docs/v2/READING.md section 3, and the third departure of its section 12).
 * "The lease and the window an event is held to are those of the version it names": a claim and a commit run for the
 * lease of the version each names, and a set's window is that of the version the event that completed it names, so
 * each ends at one time on every version of the line. Version 1 holds every event to the settings of the version
 * read, which the core's own state beside a piece still shows. This file leaves the ledger of a line whose two
 * versions differ in both, with a piece of each kind that keeps a window of its own, and keeps it at two points it
 * passes through: where one claim has lapsed and the other runs, and where one window has closed and the other is open.
 */

const owner = key(9),
  elsewhere = key(8),
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
const pieces = {
  one: { ...agree, brief: 'Is the first claim in the paper?' },
  two: { ...agree, brief: 'Is the second claim in the paper?' },
  three: { ...agree, brief: 'Is the third claim in the paper?' },
  four: { ...agree, brief: 'Is the fourth claim in the paper?' },
  five: { ...agree, brief: 'Is the fifth claim in the paper?' },
  told: { verifier: 'attest', requires: [], brief: 'Tell one person of the paper and say so.', schema: TEXT },
  summary: {
    verifier: 'judge:1',
    candidates: 2,
    requires: ['web' as const],
    brief: 'Summarise the paper in a sentence.',
    schema: TEXT,
  },
};

const t = boot('2026-11-11T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Shown = { name: string; hash: Hash; state: string };
type Panel = { outcome: string; seats: { root: Address }[] };
const shown = (problem: Hash, name: string) =>
  (t.tracker.layer().problems.get(problem)!.pieces as Shown[]).find((p) => p.name === name)!;
const stateOf = (problem: Hash, name: string) => shown(problem, name).state;
const hours = (h: number) => {
  t.clock.tick += h * 3600 * 1000;
};

async function publish(e: ReturnType<typeof envelope>): Promise<Hash> {
  const r = await post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
/** A commit and its reveal on a piece, posted to the version named; the return's digest, which a rank names. */
async function returned(problem: Hash, name: string, k: Uint8Array, model: string, ret: Record<string, unknown>) {
  const piece = shown(problem, name).hash;
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
  return hashCanonical(ret);
}
const SUPPORTS = { verdict: 'supports' };

describe('the lease and the window of the version an event names', () => {
  /** The older version: a lease of two hours and a window of forty-eight. The later: ten hours and twenty-four. */
  let OLDER: Hash, LATER: Hash;

  beforeAll(async () => {
    // A problem of another line, whose one square gives the two roots a judge panel is drawn from.
    const q = await publish(envelope(elsewhere, 'elsewhere', { claim: { ...agree, brief: 'Is it so?' } }));
    await returned(q, 'claim', J1, 'anthropic/claude', SUPPORTS);
    await returned(q, 'claim', J2, 'openai/gpt', SUPPORTS);
    OLDER = await publish(envelope(owner, 'paper', pieces));
    const settings = { lease_h: 10, challenge_window_h: 24 };
    LATER = await publish(envelope(owner, 'paper', pieces, { prev: OLDER, title: 'The second', settings }));
  });

  it('holds a claim to the lease of the version it names, on every version of the line', async () => {
    const claim = (k: Uint8Array, v: Hash, name: string) =>
      accepted(`/p/${v}/events`, ev(k, 'claim', { by: by('anthropic/claude') }, v, shown(v, name).hash));
    await claim(A, OLDER, 'one');
    await claim(B, LATER, 'two');
    for (const v of [OLDER, LATER]) expect(stateOf(v, 'one')).toBe('in_flight');
    hours(3);
    // Two hours for the claim that names the older version, ten for the one that names the later.
    for (const v of [OLDER, LATER]) {
      expect(stateOf(v, 'one')).toBe('open');
      expect(stateOf(v, 'two')).toBe('in_flight');
    }
    keepReading(t, 'lease-running', 'Two claims on a line, each held to the lease of the version it names.');
    hours(8);
    for (const v of [OLDER, LATER]) expect(stateOf(v, 'two')).toBe('open');
  });

  it('gives a commit up after twice the lease of the version it names', async () => {
    const piece = shown(OLDER, 'three').hash;
    const h = commitHash(SUPPORTS, newNonce());
    await accepted(`/p/${OLDER}/events`, ev(C, 'commit', { h }, OLDER, piece));
    for (const v of [OLDER, LATER]) expect(stateOf(v, 'three')).toBe('sealed');
    hours(5);
    for (const v of [OLDER, LATER]) expect(stateOf(v, 'three')).toBe('open');
  });

  it('closes a set by the window of the version the event that completed it names', async () => {
    await returned(OLDER, 'four', D, 'anthropic/claude', SUPPORTS);
    await returned(LATER, 'four', E, 'openai/gpt', SUPPORTS);
    await returned(LATER, 'five', F, 'anthropic/claude', SUPPORTS);
    await returned(OLDER, 'five', G, 'openai/gpt', SUPPORTS);
    // An attested piece's window is that of the version its reveal names.
    await returned(LATER, 'told', A, 'anthropic/claude', { text: 'I told a colleague.' });
    // A judged piece's window is that of the version the rank that decided names.
    const first = await returned(OLDER, 'summary', C, 'anthropic/claude', { text: 'The paper makes five claims.' });
    const second = await returned(LATER, 'summary', F, 'openai/gpt', { text: 'Five claims, each with a source.' });
    const [panel] = (await get<{ panels: Panel[] }>(`/p/${LATER}/panels`)).panels;
    const judge = secretOf.get(panel!.seats[0]!.root)!;
    const piece = shown(OLDER, 'summary').hash;
    await accepted(`/p/${OLDER}/events`, ev(judge, 'rank', { ranking: [second, first] }, OLDER, piece));
    for (const v of [OLDER, LATER])
      for (const name of ['four', 'five', 'told', 'summary']) expect(stateOf(v, name)).toBe('accepted_provisional');
    hours(25);
    for (const v of [OLDER, LATER]) {
      // The later version's twenty-four hours, where the completing event names it.
      expect(stateOf(v, 'four')).toBe('accepted');
      expect(stateOf(v, 'told')).toBe('accepted');
      // The older version's forty-eight, where the completing event names that.
      expect(stateOf(v, 'five')).toBe('accepted_provisional');
      expect(stateOf(v, 'summary')).toBe('accepted_provisional');
    }
    keepReading(t, 'lease-windows', 'Four sets on a line, each closed by the window of the version that completed it.');
    hours(24);
    for (const v of [OLDER, LATER]) {
      expect(stateOf(v, 'five')).toBe('accepted');
      expect(stateOf(v, 'summary')).toBe('accepted');
    }
  });
});
