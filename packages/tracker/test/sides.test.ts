import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, eventId, hashBytes, newNonce } from '@bitquilt/core';
import { VERDICT_QUOTE, addr, boot, envelope, key } from './helpers.js';

const ASIDE = 'it rests on nothing where another reading rests on the record';

/**
 * The sides of a seam, and where the grounds are read (docs/v2/READING.md section 4): "The grounds are read on an
 * `agree` or a `human` piece, at each version of its line, where that version's fold calls the piece `disputed`. A
 * piece locked at a version has no reading set aside there." And: "The sides are every two readings no decision
 * struck, from roots unrelated to each other, that differ on an agreed field, the owner's among them. A `human` piece
 * is `disputed` over the readings from a person's seat alone, and once it is, every such pair on it is the sides of a
 * seam, seated or not." The ledger this file leaves holds each:
 * - a piece with a reading set aside at the version where it is open, and none at a later version of its line, where
 *   the piece it waits on was written again and has no set, so the piece is locked there;
 * - an `agree` piece where the owner's reading rests on a kept read and another's on nothing, which is set aside;
 * - a `human` piece two people read apart, each on a kept read, with a reading from no person's seat that rests on
 *   nothing, which is set aside as a side of the one it differs from;
 * - a `human` piece one person read, with a reading from no person's seat that differs: no dispute, and nothing set
 *   aside.
 * This tracker's door takes no return on a `human` piece from a seat that is no person's, so each such reading is
 * written into the store past the door, and the reading reads a ledger whatever door it came through.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  P1 = key(21),
  P2 = key(22),
  Z = key(23);
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT_QUOTE, agree: ['verdict'] };
const human = { ...agree, verifier: 'human', requires: ['person' as const] };
const first = { ...agree, brief: 'Does the paper say the effect holds?' };
const second = { ...agree, inputs: ['first'], brief: 'Does the paper say the effect holds at scale?' };
const WAITS = envelope(owner, 'waits', { first, second });
const SIDES = envelope(owner, 'sides', {
  owned: { ...agree, brief: 'Does the paper say the effect holds in every trial?' },
  vote: { ...human, brief: 'Read the paper yourself: does the effect hold?' },
  quiet: { ...human, brief: 'Read the paper yourself: does the effect hold at scale?' },
});

const t = boot('2026-11-11T21:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

const enc = new TextEncoder();
const PAGE = 'The paper says the effect holds in every trial. A later section says it does not hold at scale.';
const page = hashBytes(enc.encode(PAGE));
const spanOf = (words: string): [number, number] => {
  const start = enc.encode(PAGE.slice(0, PAGE.indexOf(words))).length;
  return [start, start + enc.encode(words).length];
};
const HOLDS = spanOf('the effect holds in every trial');
const NOT = spanOf('it does not hold at scale');

type Reading = { key: Address; counts: string; why: string | null };
type Piece = { name: string; hash: Hash; state: string; aside: Address[]; readings: Reading[] };
const pieceOf = async (problem: Hash, name: string) =>
  (await get<{ pieces: Piece[] }>(`/p/${problem}/state`)).pieces.find((x) => x.name === name)!;
const said = (p: Piece) => p.readings.map((r) => [r.key, r.counts, r.why]);
const by = (model: string) => ({
  model,
  client: 'test/0',
  can: model === 'human' ? ['person' as const, 'web' as const] : ['web' as const],
});
const verdict = (k: Uint8Array, word: string) => ({ verdict: word, quote: `as ${addr(k).slice(0, 6)} read it` });
const publish = async (e: ReturnType<typeof envelope>): Promise<Hash> => {
  const r = await post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
};
/** A commit and its reveal through the door; the reveal's id, which a trace names. */
async function returned(problem: Hash, piece: Hash, k: Uint8Array, model: string, word: string): Promise<Hash> {
  const nonce = newNonce();
  const ret = verdict(k, word);
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  return accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
/** A commit and its reveal on a `human` piece from no person's seat, written past the door, which refuses it. */
async function unseated(problem: Hash, piece: Hash, k: Uint8Array, word: string): Promise<Hash> {
  const nonce = newNonce();
  const ret = verdict(k, word);
  const commit = ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece);
  const reveal = ev(k, 'reveal', { return: ret, nonce, by: by('anthropic/claude') }, problem, piece);
  await accepted(`/p/${problem}/events`, commit);
  expect(await refused(`/p/${problem}/events`, reveal)).toBe("a human piece takes a return from a person's seat");
  t.store.appendReceipt(problem, reveal, eventId(reveal), 'http://tracker.test/', reveal.ts, 'self');
  return eventId(reveal);
}
/** A trace that rests the reveal's verdict on a passage of the page kept. */
const rested = (k: Uint8Array, problem: Hash, piece: Hash, reveal: Hash, span: [number, number]) =>
  accepted(
    `/p/${problem}/events`,
    ev(
      k,
      'trace',
      {
        reveal,
        reads: [{ url: 'https://example.org/paper', hash: page, at: '2026-11-11T20:00:00Z', media: 'text/plain' }],
        rests: [{ field: 'verdict', read: 0, span }],
      },
      problem,
      piece,
    ),
  );

describe('where the grounds are read, and the sides of a seam (READING.md section 4)', () => {
  let V1: Hash, S: Hash;
  beforeAll(async () => {
    V1 = await publish(WAITS);
    S = await publish(SIDES);
    expect((await fetch(`${t.base}/b/${page}`, { method: 'PUT', body: enc.encode(PAGE) })).ok).toBe(true);
  });

  it('sets a reading aside at the version where its piece is open, and at none where the piece is locked', async () => {
    const one = (await pieceOf(V1, 'first')).hash;
    const two = (await pieceOf(V1, 'second')).hash;
    await returned(V1, one, A, 'anthropic/claude', 'supports');
    await returned(V1, one, B, 'openai/gpt', 'supports');
    t.clock.tick += 49 * 3600 * 1000;
    const rc = await returned(V1, two, C, 'anthropic/claude', 'contradicts');
    await returned(V1, two, D, 'openai/gpt', 'supports');
    await rested(C, V1, two, rc, NOT);
    expect(await pieceOf(V1, 'second')).toMatchObject({ state: 'needs_verify', aside: [addr(D)] });
    // The owner writes the first piece again. The second keeps its hash, and at the new version it waits on a piece
    // with no set, so it is locked there and the grounds are not read on it.
    const V2 = await publish(
      envelope(
        owner,
        'waits',
        { first: { ...first, brief: 'Does the paper say the effect holds? Quote it.' }, second },
        { prev: V1 },
      ),
    );
    const later = await pieceOf(V2, 'second');
    expect(later.hash).toBe(two);
    expect(later).toMatchObject({ state: 'locked', aside: [] });
    expect(said(later)).toEqual([
      [addr(C), 'counted', null],
      [addr(D), 'counted', null],
    ]);
    const before = await pieceOf(V1, 'second');
    expect(before).toMatchObject({ state: 'needs_verify', aside: [addr(D)] });
    expect(said(before)).toEqual([
      [addr(C), 'counted', null],
      [addr(D), 'aside', ASIDE],
    ]);
  });

  it("sets aside a reading that rests on nothing where the owner's rests on a kept read", async () => {
    const owned = (await pieceOf(S, 'owned')).hash;
    const ro = await returned(S, owned, owner, 'anthropic/claude', 'supports');
    await returned(S, owned, E, 'openai/gpt', 'contradicts');
    await rested(owner, S, owned, ro, HOLDS);
    const p = await pieceOf(S, 'owned');
    expect(p).toMatchObject({ state: 'needs_verify', aside: [addr(E)] });
    expect(said(p)).toEqual([
      [addr(owner), 'kept', 'its root is related to the owner'],
      [addr(E), 'aside', ASIDE],
    ]);
  });

  it("sets aside, on a human piece two people read apart, a reading from no person's seat that rests on nothing", async () => {
    const vote = (await pieceOf(S, 'vote')).hash;
    const r1 = await returned(S, vote, P1, 'human', 'supports');
    const r2 = await returned(S, vote, P2, 'human', 'contradicts');
    await rested(P1, S, vote, r1, HOLDS);
    await rested(P2, S, vote, r2, NOT);
    expect(await pieceOf(S, 'vote')).toMatchObject({ state: 'disputed', aside: [] });
    await unseated(S, vote, Z, 'contradicts');
    const p = await pieceOf(S, 'vote');
    expect(p).toMatchObject({ state: 'disputed', aside: [addr(Z)] });
    expect(said(p)).toEqual([
      [addr(P1), 'counted', null],
      [addr(P2), 'counted', null],
      [addr(Z), 'aside', ASIDE],
    ]);
  });

  it("reads no dispute, and sets nothing aside, where one person's reading and one from no seat differ", async () => {
    const quiet = (await pieceOf(S, 'quiet')).hash;
    await returned(S, quiet, P1, 'human', 'supports');
    const rz = await unseated(S, quiet, Z, 'contradicts');
    await rested(Z, S, quiet, rz, NOT);
    const p = await pieceOf(S, 'quiet');
    expect(p).toMatchObject({ state: 'needs_verify', aside: [] });
    expect(said(p)).toEqual([
      [addr(P1), 'counted', null],
      [addr(Z), 'kept', "it is not from a person's seat"],
    ]);
  });
});
