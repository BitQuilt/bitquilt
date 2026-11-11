import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, hashBytes, hashCanonical, newNonce, problemHash } from '@bitquilt/core';
import { VERDICT_QUOTE, addr, boot, envelope as signed, key } from './helpers.js';

/**
 * The grounds before the sets, and with them (docs/v2/READING.md sections 4 to 6): "A reading that rests on nothing,
 * where another on the piece rests on a kept read and the two differ, is set aside", and the sets and standing are
 * read over what remains. Two things follow, and this file leaves one ledger that shows both. A set made by the
 * reading that took a set-aside one's place is credited where it was made, so its two roots are the pool a judge
 * panel on another problem is drawn from: read with the grounds after the sets, that pool was empty and the panel
 * void. And a dispute on a piece that waits on a judged one shows only once the panel has chosen, so the grounds are
 * read again after the sets, and the reading that rests on nothing there is set aside too.
 */

const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  F = key(6);
const secretOf = new Map<Address, Uint8Array>([A, B].map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const TEXT = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['text'],
  properties: { text: { type: 'string' as const, maxLength: 200 } },
};

/** One agree piece, where the two who will be the judges' pool earn their credit. */
const GROUNDED = signed(owner, 'grounded', {
  statement: {
    verifier: 'agree',
    requires: ['web'],
    brief: 'Does the paper say the effect holds?',
    schema: VERDICT_QUOTE,
    agree: ['verdict'],
  },
});
/** A judged piece with a panel of one, and an agree piece that waits on it. */
const CHOSEN = signed(owner, 'chosen', {
  summary: {
    verifier: 'judge:1',
    candidates: 2,
    requires: ['web'],
    brief: 'Summarise the paper in a sentence.',
    schema: TEXT,
  },
  after: {
    verifier: 'agree',
    requires: ['web'],
    inputs: ['summary'],
    brief: 'Does the summary chosen say what the paper says?',
    schema: VERDICT_QUOTE,
    agree: ['verdict'],
  },
});
const g = problemHash(GROUNDED);
const c = problemHash(CHOSEN);

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

type Piece = { name: string; hash: Hash; state: string; aside: Address[] };
type Panel = { outcome: string; winner: Hash | null; seats: { root: Address }[] };
const pieceOf = async (problem: Hash, name: string) =>
  ((await get(`/p/${problem}/state`)) as { pieces: Piece[] }).pieces.find((x) => x.name === name)!;
const panelsOf = async (problem: Hash) => ((await get(`/p/${problem}/panels`)) as { panels: Panel[] }).panels;

/** A commit and its reveal; the reveal's id, which a trace names, and the return's digest, which a rank names. */
async function returned(
  problem: Hash,
  piece: Hash,
  k: Uint8Array,
  model: string,
  ret: Record<string, unknown>,
): Promise<{ reveal: Hash; digest: Hash }> {
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  const reveal = await accepted(
    `/p/${problem}/events`,
    ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece),
  );
  return { reveal, digest: hashCanonical(ret) };
}
const verdict = (k: Uint8Array, said: string) => ({
  verdict: said,
  quote: `as ${addr(k).slice(0, 6)} read it, ${said}`,
});
/** A trace that rests the reveal's verdict on the passage of the page kept. */
const rested = (k: Uint8Array, problem: Hash, piece: Hash, reveal: Hash) =>
  ev(
    k,
    'trace',
    {
      reveal,
      reads: [{ url: 'https://example.org/paper', hash: page, at: '2026-11-11T11:00:00Z', media: 'text/plain' }],
      rests: [{ field: 'verdict', read: 0, span }],
    },
    problem,
    piece,
  );

describe('the grounds, the sets and standing, read together', () => {
  let statement: Hash, summary: Hash, after: Hash;

  beforeAll(async () => {
    for (const e of [GROUNDED, CHOSEN]) expect((await post('/p', { envelope: e })).status).toBe(201);
    expect((await fetch(`${t.base}/b/${page}`, { method: 'PUT', body: enc.encode(PAGE) })).ok).toBe(true);
    statement = (await pieceOf(g, 'statement')).hash;
    summary = (await pieceOf(c, 'summary')).hash;
    after = (await pieceOf(c, 'after')).hash;
  });

  it("credits the set a second reading makes once the first is set aside, and seats another problem's panel from it", async () => {
    const ra = await returned(g, statement, A, 'anthropic/claude', verdict(A, 'supports'));
    await returned(g, statement, B, 'openai/gpt-5', verdict(B, 'contradicts'));
    await accepted(`/p/${g}/events`, rested(A, g, statement, ra.reveal));
    expect(await pieceOf(g, 'statement')).toMatchObject({ state: 'needs_verify', aside: [addr(B)] });
    // B reads again and agrees: the set is A's reading and B's second, and each has a credit from here on.
    await returned(g, statement, B, 'openai/gpt-5', verdict(B, 'supports'));
    expect((await pieceOf(g, 'statement')).state).toBe('accepted_provisional');

    // The candidates on the other problem come after that set, so its two roots are the pool, and one is drawn.
    const first = await returned(c, summary, C, 'anthropic/claude', { text: 'The effect holds in every trial.' });
    const second = await returned(c, summary, D, 'openai/gpt-5', { text: 'The effect holds, though not at scale.' });
    const [panel] = await panelsOf(c);
    expect(panel).toMatchObject({ outcome: 'open', winner: null });
    expect(panel!.seats).toHaveLength(1);
    const judge = panel!.seats[0]!.root;
    expect([addr(A), addr(B)]).toContain(judge);
    await accepted(
      `/p/${c}/events`,
      ev(secretOf.get(judge)!, 'rank', { ranking: [second.digest, first.digest] }, c, summary),
    );
    expect((await panelsOf(c))[0]).toMatchObject({ outcome: 'decided', winner: second.digest });
    expect((await pieceOf(c, 'summary')).state).toBe('accepted_provisional');
  });

  it('sets aside a reading that rests on nothing on a piece that waited on the judged one', async () => {
    expect((await pieceOf(c, 'after')).state).toBe('locked');
    // Past the window of two days, the judged piece is accepted and the piece behind it opens.
    t.clock.tick += 49 * 3600 * 1000;
    expect((await pieceOf(c, 'summary')).state).toBe('accepted');
    expect((await pieceOf(c, 'after')).state).toBe('open');
    const re = await returned(c, after, E, 'anthropic/claude', verdict(E, 'supports'));
    await returned(c, after, F, 'openai/gpt-5', verdict(F, 'contradicts'));
    expect(await pieceOf(c, 'after')).toMatchObject({ state: 'disputed', aside: [] });
    await accepted(`/p/${c}/events`, rested(E, c, after, re.reveal));
    // The dispute shows only once the panel is drawn from the credits, and the grounds are read again after it.
    expect(await pieceOf(c, 'after')).toMatchObject({ state: 'needs_verify', aside: [addr(F)] });
    expect((await pieceOf(c, 'summary')).state).toBe('accepted');
  });
});
