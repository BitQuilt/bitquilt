import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Hash,
  type PieceAnswers,
  type Said,
  commitHash,
  leftOut,
  newNonce,
  tally,
} from '@bitquilt/core';
import { VERDICT_QUOTE, addr, boot, envelope, key } from './helpers.js';

/**
 * A problem's answers, by who gave them (QX-24 section 3; docs/PROTOCOL.md, Routes: `/p/<hash>/answers`). The route
 * lists each piece that has a reading, its answers in the order the first reading of each was received, and under
 * each answer every reading that says it with its root, its key, its vendor and how it counts: a reading alone on
 * its piece, which no other listing of the problem shows, a set of two with a third kept beside it, and two that
 * differ. A reader's list never reaches the tracker (QX-24 section 2): the reader tells the answers again over the
 * listing with the core's `tally`, and this file does so as a reader would.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT_QUOTE, agree: ['verdict'] };
const PAPER: Envelope = envelope(owner, 'answers', {
  first: { ...agree, brief: 'Is the first claim in the paper?' },
  second: { ...agree, brief: 'Is the second claim in the paper?' },
  third: { ...agree, brief: 'Is the third claim in the paper?' },
  fourth: { ...agree, brief: 'Is the fourth claim in the paper?' },
});

const t = boot('2026-11-16T12:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
beforeAll(() => t.listen());
afterAll(() => t.close());

type Listed = Said & { signer: string | null };
interface Answers {
  problem: Hash;
  pieces: (Omit<PieceAnswers, 'answers'> & {
    answers: { says: Record<string, unknown> | null; roots: number; vendors: number; readings: Listed[] }[];
  })[];
}
let P: Hash;
const pieces = new Map<string, Hash>();
const post = (e: unknown) => t.accepted(`/p/${P}/events`, e);
const answers = () => t.get<Answers>(`/p/${P}/answers`);
async function read(name: string, k: Uint8Array, model: string, verdict: string): Promise<Hash> {
  const piece = pieces.get(name)!;
  const ret = { verdict, quote: `as ${model} read it` };
  const nonce = newNonce();
  await post(t.ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
  return post(t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, piece));
}

describe("a problem's answers, by who gave them", () => {
  beforeAll(async () => {
    const r = await t.post('/p', { envelope: PAPER });
    expect(r.status, await r.clone().text()).toBe(201);
    P = ((await r.json()) as { hash: Hash }).hash;
    for (const p of (await t.get<{ pieces: { name: string; hash: Hash }[] }>(`/p/${P}/state`)).pieces)
      pieces.set(p.name, p.hash);
  });

  it('lists nothing of a problem nobody has read, and the well-known document names the extension', async () => {
    expect((await answers()).pieces).toEqual([]);
    expect((await t.get<{ answers: unknown }>('/.well-known/quilt')).answers).toEqual({ extension: 'QX-24' });
  });

  it('lists a reading alone on its piece, with the key that signed it', async () => {
    const id = await read('third', A, 'anthropic/claude', 'contradicts');
    const listed = (await answers()).pieces;
    expect(listed.map((p) => [p.name, p.state, p.readings, p.left_out])).toEqual([['third', 'needs_verify', 1, 0]]);
    const [answer] = listed[0]!.answers;
    expect(answer!.says).toEqual({ verdict: 'contradicts' });
    expect([answer!.roots, answer!.vendors]).toEqual([1, 1]);
    expect(answer!.readings).toEqual([
      expect.objectContaining({
        id,
        key: addr(A),
        root: addr(A),
        signer: null,
        vendor: 'anthropic',
        model: 'anthropic/claude',
        counts: 'counted',
        why: null,
        return: { verdict: 'contradicts', quote: 'as anthropic/claude read it' },
      }),
    ]);
  });

  it('sets a set of two and a reading kept beside it under one answer, and two that differ under two', async () => {
    await read('first', A, 'anthropic/claude', 'supports');
    await read('first', B, 'openai/gpt', 'supports');
    await read('first', C, 'google/gemini', 'supports');
    await read('second', B, 'openai/gpt', 'contradicts');
    await read('second', A, 'anthropic/claude', 'supports');
    const listed = (await answers()).pieces;
    // The problem's file order, and only the pieces that have a reading.
    expect(listed.map((p) => p.name)).toEqual(['first', 'second', 'third']);
    const first = listed[0]!;
    expect(first.state).toBe('accepted_provisional');
    expect(first.answers).toHaveLength(1);
    expect(first.answers[0]!.readings.map((r) => [r.root, r.counts, r.why])).toEqual([
      [addr(A), 'counted', null],
      [addr(B), 'counted', null],
      [addr(C), 'kept', 'the set was made before it'],
    ]);
    expect([first.answers[0]!.roots, first.answers[0]!.vendors]).toEqual([3, 3]);
    // Two answers on the piece two read apart, the first received first, and neither ranked.
    const second = listed[1]!;
    expect(second.state).toBe('disputed');
    expect(second.answers.map((a) => [a.says, a.readings.map((r) => r.root)])).toEqual([
      [{ verdict: 'contradicts' }, [addr(B)]],
      [{ verdict: 'supports' }, [addr(A)]],
    ]);
  });

  it('is told again by a reader who leaves a key out, and the tracker is never told the list', async () => {
    const listed = (await answers()).pieces;
    const without = leftOut([addr(B)]);
    const again = listed.map((p) => {
      const said = p.answers.flatMap((a) => a.readings);
      return { name: p.name, ...tally(p.verifier === 'agree' ? VERDICT_QUOTE : undefined, ['verdict'], said, without) };
    });
    // The set on the first piece was made with the key left out: two readings remain, of two roots and two vendors.
    expect(again.map((p) => [p.name, p.readings, p.left_out])).toEqual([
      ['first', 2, 1],
      ['second', 1, 1],
      ['third', 1, 0],
    ]);
    expect(again[0]!.answers[0]!.readings.map((r) => r.root)).toEqual([addr(A), addr(C)]);
    expect([again[0]!.answers[0]!.roots, again[0]!.answers[0]!.vendors]).toEqual([2, 2]);
    // The piece two read apart has one answer for this reader.
    expect(again[1]!.answers.map((a) => a.says)).toEqual([{ verdict: 'supports' }]);
    // A query on the route changes nothing of what it lists.
    expect((await t.get<Answers>(`/p/${P}/answers?without=${addr(B)}`)).pieces).toEqual(listed);
  });

  it('answers 404 for a problem not held here and 405 for a post', async () => {
    expect((await fetch(`${t.base}/p/sha256:${'0'.repeat(64)}/answers`)).status).toBe(404);
    expect((await fetch(`${t.base}/p/${P}/answers`, { method: 'POST' })).status).toBe(405);
  });
});
