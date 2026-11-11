import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, hashBytes, newNonce, problemHash } from '@bitquilt/core';
import { VERDICT_QUOTE, addr, boot, envelope as signed, key } from './helpers.js';

/**
 * The grounds and a judge piece (docs/v2/READING.md section 4): "The grounds set aside no candidate of a `judge:n`
 * piece." Its candidates differ by nature and its panel ranks them, so a candidate that rests on a kept read sets
 * aside no candidate that rests on nothing. Until 11 November 2026 it did: the grounds are read before the sets, when
 * no panel is drawn yet and every judge piece with its candidates in says `disputed`, so one candidate's trace took
 * the other off the piece and the panel seated on the two was gone. This file leaves one ledger that holds both
 * halves: a piece whose panel sits, and one whose panel is void, each with one candidate traced.
 */

const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const TEXT = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['text'],
  properties: { text: { type: 'string' as const, maxLength: 200 } },
};

/** One agree piece, where the two who will be the judges' pool earn their credit. */
const EARNED = signed(owner, 'earned', {
  statement: {
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Does the paper say the effect holds?',
    schema: VERDICT_QUOTE,
    agree: ['verdict'],
  },
});
/** Two judged pieces: a panel of one, which the pool of two seats, and a panel of three, which it cannot. */
const judged = (panel: number, brief: string) => ({
  verifier: `judge:${panel}`,
  candidates: 2,
  requires: ['web' as const],
  brief,
  schema: TEXT,
});
const RANKED = signed(owner, 'ranked', {
  summary: judged(1, 'Summarise the paper in a sentence.'),
  title: judged(3, 'Give the paper a plain title.'),
});
const e = problemHash(EARNED);
const r = problemHash(RANKED);

const t = boot('2026-11-11T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

const enc = new TextEncoder();
const PAGE = 'The paper says the effect holds in every trial. A later section says it does not hold at scale.';
const HOLDS = 'the effect holds in every trial';
const page = hashBytes(enc.encode(PAGE));
const start = enc.encode(PAGE.slice(0, PAGE.indexOf(HOLDS))).length;
const span: [number, number] = [start, start + enc.encode(HOLDS).length];

type Side = { key: Address; aside: boolean; read: { hash: Hash } | null };
type Piece = {
  name: string;
  hash: Hash;
  state: string;
  aside: Address[];
  readings: { key: Address; counts: string; why: string | null }[];
  seams: { field: string; why: string; sides: Side[] }[];
};
type Panel = { piece: Hash; outcome: string; seats: { root: Address }[] };
const pieceOf = async (problem: Hash, name: string) =>
  ((await get(`/p/${problem}/state`)) as { pieces: Piece[] }).pieces.find((x) => x.name === name)!;
const panelsOf = async (problem: Hash) => ((await get(`/p/${problem}/panels`)) as { panels: Panel[] }).panels;
const counted = (p: Piece) => p.readings.map((x) => [x.key, x.counts, x.why]);

/** A commit and its reveal; the reveal's id, which a trace names. */
async function returned(problem: Hash, piece: Hash, k: Uint8Array, model: string, ret: Record<string, unknown>) {
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  return accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
/** A trace that rests the reveal's one field on the passage of the page kept. */
const rested = (k: Uint8Array, problem: Hash, piece: Hash, reveal: Hash) =>
  ev(
    k,
    'trace',
    {
      reveal,
      reads: [{ url: 'https://example.org/paper', hash: page, at: '2026-11-11T11:00:00Z', media: 'text/plain' }],
      rests: [{ field: 'text', read: 0, span }],
    },
    problem,
    piece,
  );

describe('the grounds and a judge piece', () => {
  let summary: Hash, title: Hash;

  beforeAll(async () => {
    for (const env of [EARNED, RANKED]) expect((await post('/p', { envelope: env })).status).toBe(201);
    expect((await fetch(`${t.base}/b/${page}`, { method: 'PUT', body: enc.encode(PAGE) })).ok).toBe(true);
    const statement = (await pieceOf(e, 'statement')).hash;
    summary = (await pieceOf(r, 'summary')).hash;
    title = (await pieceOf(r, 'title')).hash;
    // A and B agree across vendors, so each has a credit and the two are the pool.
    const said = (k: Uint8Array) => ({ verdict: 'supports', quote: `as ${addr(k).slice(0, 6)} read it, it holds` });
    await returned(e, statement, A, 'anthropic/claude', said(A));
    await returned(e, statement, B, 'openai/gpt-5', said(B));
    expect((await pieceOf(e, 'statement')).state).toBe('accepted_provisional');
  });

  it('sets no candidate aside where the panel sits, and the panel stays seated', async () => {
    const first = await returned(r, summary, C, 'anthropic/claude', { text: 'The effect holds in every trial.' });
    await returned(r, summary, D, 'openai/gpt-5', { text: 'The effect holds, though not at scale.' });
    const before = await pieceOf(r, 'summary');
    expect(before.state).toBe('judging');
    expect(counted(before)).toEqual([
      [addr(C), 'counted', null],
      [addr(D), 'counted', null],
    ]);
    await accepted(`/p/${r}/events`, rested(C, r, summary, first));
    const after = await pieceOf(r, 'summary');
    expect(after).toMatchObject({ state: 'judging', aside: [], seams: [] });
    expect(counted(after)).toEqual(counted(before));
    const panel = (await panelsOf(r)).find((x) => x.piece === summary);
    expect(panel).toMatchObject({ outcome: 'open' });
    expect(panel!.seats).toHaveLength(1);
  });

  it('shows the seam where the panel is void, with no side set aside', async () => {
    const first = await returned(r, title, C, 'anthropic/claude', { text: 'An effect that holds.' });
    await returned(r, title, D, 'openai/gpt-5', { text: 'An effect that does not scale.' });
    await accepted(`/p/${r}/events`, rested(C, r, title, first));
    const p = await pieceOf(r, 'title');
    expect(p).toMatchObject({ state: 'disputed', aside: [] });
    expect(counted(p)).toEqual([
      [addr(C), 'kept', 'its panel is void'],
      [addr(D), 'kept', 'its panel is void'],
    ]);
    expect(p.seams).toHaveLength(1);
    expect(p.seams[0]).toMatchObject({ field: 'text', why: 'unknown' });
    expect(p.seams[0]!.sides.map((s) => [s.key, s.aside, s.read?.hash ?? null])).toEqual([
      [addr(C), false, page],
      [addr(D), false, null],
    ]);
  });
});
