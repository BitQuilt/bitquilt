import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Event,
  type Hash,
  type Unsigned,
  PIECE_EVENT_TYPES,
  newNonce,
  problemHash,
  signEvent,
  signObject,
  stamp,
} from '@bitquilt/core';
import { CHALLENGE_EVENTS } from '../src/challenge.js';
import { GOLD_EVENTS } from '../src/gold.js';
import { STAKE_EVENTS } from '../src/stake.js';
import { TRACE_EVENTS } from '../src/trace.js';
import { RANK_EVENTS } from '../src/verifiers.js';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * The door by event type (PROTOCOL.md, The tracker; CORE.md sections 4 and 11; the events section of each extension):
 * each type a log takes reaches its own check, and the log takes no other. On a problem's log the core's piece events,
 * its version and output, the announce (QX-13) and the seed (QX-4), and each type an extension's set names, are let
 * past the allow-list: each is answered by its own check in that check's words, or taken where its shape is the whole
 * of it. An identity event there is sent to the identity log, and any other type is one this tracker does not carry,
 * a name every object inherits among them. Before any type's check, the allow-list comes first, then the problem the
 * event names, then a problem taken down. On the identity log its five types are let past, a name to the stamp asked
 * here and a hide to the maintainers' keys; any other type is told what the log takes, and that comes before an event
 * naming a problem is told it names none.
 */
const owner = key(9),
  A = key(1),
  M = key(21),
  I1 = key(31),
  I2 = key(32),
  I3 = key(33),
  I4 = key(34),
  I5 = key(35);
const by = { model: 'openai/gpt', client: 'test/0', can: ['web' as const] };
const statement = (brief: string) => ({
  statement: { verifier: 'agree', requires: ['web' as const], brief, schema: VERDICT, agree: ['verdict'] },
});
const env = envelope(owner, 'door', statement('Does the paper say so?'));
const P = problemHash(env);
const down = envelope(owner, 'down', statement('Does the other paper say so?'));
const Q = problemHash(down);
/** A problem held nowhere, a piece no problem here has, and a hash that names nothing. */
const ELSEWHERE = `sha256:${'e'.repeat(64)}` as Hash;
const NO_PIECE = `sha256:${'f'.repeat(64)}` as Hash;
const ANY = `sha256:${'a'.repeat(64)}` as Hash;
/** The bits of the stamp this tracker asks of a name. */
const BITS = 8;

const t = boot('2026-11-07T09:00:00Z', {
  limits: { keyPerHour: 1000, ipPerHour: 10000 },
  stamp: { name: BITS },
  maintainers: [addr(M)],
});
const { ev, post } = t;
let S: Hash;
beforeAll(async () => {
  await t.listen();
  for (const e of [env, down]) expect((await post('/p', { envelope: e, blobs: {} })).status).toBe(201);
  S = (await t.get<{ pieces: { hash: Hash }[] }>(`/p/${P}/state`)).pieces[0]!.hash;
  expect((await answer('/k/events', ev(M, 'hide', { id: Q, why: 'Taken down for the test.' }))).status).toBe(202);
});
afterAll(() => t.close());

/** What the door answers a post: its status, and why where it refuses. */
async function answer(path: string, event: unknown): Promise<{ status: number; error?: string }> {
  const r = await post(path, event);
  const body = (await r.json()) as { error?: string };
  return body.error === undefined ? { status: r.status } : { status: r.status, error: body.error };
}
const refusal = (error: string, status = 400) => ({ status, error });
const TAKEN = { status: 202 };

/** An event unsigned, dated a second after the last, as `ev` dates it. */
function unsigned(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash): Unsigned {
  t.clock.tick += 1000;
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: new Date(t.clock.tick).toISOString(), body };
  if (problem) u.problem = problem;
  return u;
}
/** A rotate from one key to another, with the new key's `sig_to` (CORE.md section 4). */
function rotate(from: Uint8Array, to: Uint8Array, problem?: Hash): Event {
  const u = unsigned(from, 'rotate', { to: addr(to) }, problem);
  return signEvent({ ...u, sig_to: signObject(u, to) }, from);
}
/** A name stamped to the bits asked here (CORE.md section 11). */
const stamped = (k: Uint8Array, name: string): Event => signEvent(stamp(unsigned(k, 'name', { name }), BITS)!, k);

/**
 * One post for each type a problem's log takes, made so that the type's own check answers it: the refusal that check
 * gives, or taken where the type's shape is the whole of it.
 */
const problemRows: [type: string, event: () => Event, answered: { status: number; error?: string }][] = [
  ['claim', () => ev(A, 'claim', { by }, P, NO_PIECE), refusal('names a piece this problem does not have')],
  ['commit', () => ev(A, 'commit', { h: ANY }, P, NO_PIECE), refusal('names a piece this problem does not have')],
  [
    'reveal',
    () => ev(A, 'reveal', { return: { verdict: 'supports' }, nonce: newNonce(), by }, P, S),
    refusal('no unrevealed commit by this key on the piece'),
  ],
  [
    'decline',
    () => ev(A, 'decline', { reason: 'cannot' }, P, NO_PIECE),
    refusal('names a piece this problem does not have'),
  ],
  [
    'run',
    () => ev(A, 'run', { digest: ANY, exit: 0, host: 'linux/amd64', by }, P, S),
    refusal('the digest is no revealed return of the piece'),
  ],
  ['version', () => ev(owner, 'version', { slug: 'door', hash: P }, P), TAKEN],
  ['output', () => ev(A, 'output', { hash: ANY }, P), TAKEN],
  [
    'announce',
    () =>
      ev(owner, 'announce', { title: 'Another title', slug: 'door', done_when: env.problem.done_when, topics: [] }, P),
    refusal("announce: title, slug and done_when are the envelope's"),
  ],
  ['seed', () => ev(A, 'seed', {}, P), refusal('body.on: true or false')],
  [
    'challenge',
    () => ev(A, 'challenge', { stake: 1, ground: 'It is wrong.' }, P),
    refusal('a challenge names a problem and a piece'),
  ],
  [
    'verdict',
    () => ev(A, 'verdict', { challenge: ANY, for: 'author' }, P),
    refusal('a verdict names a problem and a piece'),
  ],
  ['rank', () => ev(A, 'rank', { ranking: [] }, P), refusal('a rank names a problem and a piece')],
  ['stake_rule', () => ev(owner, 'stake_rule', { min: 1 }, P, S), refusal('a stake rule names a problem and no piece')],
  ['lock', () => ev(A, 'lock', { kind: 'standing', amount: 1 }, P), refusal('a lock names a problem and a piece')],
  [
    'gold',
    () => ev(owner, 'gold', { commitments: [ANY], stake: 2 }, P, S),
    refusal('a gold names a problem and no piece'),
  ],
  [
    'gold_reveal',
    () => ev(owner, 'gold_reveal', { projection: {}, nonce: newNonce() }, P),
    refusal('a gold reveal names a problem and a piece'),
  ],
  [
    'trace',
    () => ev(A, 'trace', { reveal: ANY, reads: [], rests: [] }, P),
    refusal('a trace names a problem and a piece'),
  ],
];

/** One event of each type the identity log takes, naming the problem given, if any. */
const identityOf: Record<string, (problem?: Hash) => Event> = {
  name: (problem) => signEvent(unsigned(A, 'name', { name: 'Ada' }, problem), A),
  delegate: (problem) =>
    signEvent(
      unsigned(I1, 'delegate', { to: addr(I2), scope: ['claim'], expires: '2027-01-01T00:00:00Z' }, problem),
      I1,
    ),
  revoke: (problem) => signEvent(unsigned(I1, 'revoke', { of: addr(I2) }, problem), I1),
  rotate: (problem) => rotate(I3, I4, problem),
  hide: (problem) => signEvent(unsigned(A, 'hide', { id: ANY, why: 'Spam.' }, problem), A),
};

describe("a problem's log", () => {
  it("lets past the core's piece and problem events, the announce, the seed and each extension's set", () => {
    expect(problemRows.map(([type]) => type)).toEqual([
      ...PIECE_EVENT_TYPES,
      'version',
      'output',
      'announce',
      'seed',
      ...CHALLENGE_EVENTS,
      ...RANK_EVENTS,
      ...STAKE_EVENTS,
      ...GOLD_EVENTS,
      ...TRACE_EVENTS,
    ]);
  });

  it.each(problemRows)('answers a %s from its own check', async (_type, event, answered) => {
    expect(await answer(`/p/${P}/events`, event())).toEqual(answered);
  });

  it('sends each identity event to the identity log', async () => {
    for (const [type, of] of Object.entries(identityOf))
      expect(await answer(`/p/${P}/events`, of(P)), type).toEqual(refusal('identity events go to the identity log'));
  });

  it("carries no other type, a coin log's or a name every object inherits", async () => {
    for (const type of ['nonsense', 'pay', 'burn', 'credit', 'constructor', 'toString', 'hasOwnProperty', '__proto__'])
      expect(await answer(`/p/${P}/events`, ev(A, type, {}, P)), type).toEqual(
        refusal(`this tracker does not carry ${type} events`),
      );
  });

  it('asks the allow-list, then the problem named, then whether the problem is taken down', async () => {
    expect(await answer(`/p/${P}/events`, ev(A, 'nonsense', {}, ELSEWHERE))).toEqual(
      refusal('this tracker does not carry nonsense events'),
    );
    expect(await answer(`/p/${P}/events`, ev(A, 'seed', { on: true }, ELSEWHERE))).toEqual(
      refusal('post an event under the problem it names'),
    );
    expect(await answer(`/p/${Q}/events`, ev(A, 'nonsense', {}, Q))).toEqual(
      refusal('this tracker does not carry nonsense events'),
    );
    expect(await answer(`/p/${Q}/events`, identityOf.name!(Q))).toEqual(
      refusal('identity events go to the identity log'),
    );
    expect(await answer(`/p/${Q}/events`, ev(A, 'seed', { on: true }, P))).toEqual(
      refusal('post an event under the problem it names'),
    );
    expect(await answer(`/p/${Q}/events`, ev(A, 'seed', { on: true }, Q))).toEqual(
      refusal('this problem is taken down here', 410),
    );
  });
});

describe('the identity log', () => {
  it('holds a name to the stamp asked here', async () => {
    expect(await answer('/k/events', identityOf.name!())).toEqual(
      refusal(`a name event here carries a stamp of ${BITS} bits`),
    );
    expect(await answer('/k/events', stamped(I5, 'Eve'))).toEqual(TAKEN);
  });

  it('takes a delegate, a revoke and a rotate on their shape alone', async () => {
    for (const type of ['delegate', 'revoke', 'rotate'])
      expect(await answer('/k/events', identityOf[type]!()), type).toEqual(TAKEN);
  });

  it("takes a hide well formed and from a maintainer's key", async () => {
    expect(await answer('/k/events', ev(M, 'hide', { why: 'Spam.' }))).toEqual(
      refusal('body.id: an event id or a problem hash'),
    );
    expect(await answer('/k/events', identityOf.hide!())).toEqual(
      refusal("a hide is signed by one of this tracker's maintainers", 403),
    );
    expect(await answer('/k/events', ev(M, 'hide', { id: ANY, why: 'Spam.' }))).toEqual(TAKEN);
  });

  it('says what it takes to any other type, before it says an identity event names no problem', async () => {
    const takes = 'the identity log takes name, delegate, revoke, rotate and hide';
    for (const type of ['seed', 'pay', 'nonsense', 'constructor', 'toString', 'hasOwnProperty', '__proto__'])
      expect(await answer('/k/events', ev(A, type, {}, P)), type).toEqual(refusal(takes));
    expect(await answer('/k/events', ev(A, 'claim', { by }, P, S))).toEqual(refusal(takes));
    expect(await answer('/k/events', ev(owner, 'version', { slug: 'door', hash: P }, P))).toEqual(refusal(takes));
    for (const [type, of] of Object.entries(identityOf))
      expect(await answer('/k/events', of(P)), type).toEqual(refusal('an identity event names no problem'));
    expect(await answer('/k/events', ev(A, 'name', { name: 'Ada' }, undefined, NO_PIECE))).toEqual(
      refusal('an identity event names no problem'),
    );
  });
});
