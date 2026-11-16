/**
 * The answers of a piece, by who gave them, and the keys a reader leaves out (QX-24 sections 1 and 2): the readings
 * that agree on the agree fields are one answer, in the order the first of each was received and none ranked above
 * another; a reading struck or set aside is listed and counted in neither the roots nor the vendors; a reading whose
 * root or key a reader names is left out, whatever capitals the address is written in, and the answers are told
 * again over the rest; and where a piece has no schema, two returns are one answer where they have one hash.
 */
import { describe, expect, it } from 'vitest';
import type { Address, Hash, Schema } from '../src/index.js';
import { type Said, leftOut, tally } from '../src/index.js';

const SCHEMA: Schema = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'quote'],
  properties: { verdict: { enum: ['supports', 'contradicts', 'unclear'] }, quote: { type: 'string', maxLength: 300 } },
};
const address = (n: number) => `0x${n.toString(16).padStart(2, '0').repeat(20)}` as Address;
let n = 0;
/** A reading by a root, signed by the root's own key unless another is named. */
function said(root: number, vendor: string, verdict: string, over: Partial<Said> = {}): Said {
  n += 1;
  const ret = { verdict, quote: `quote ${n}` };
  return {
    id: `sha256:${n.toString(16).padStart(64, '0')}` as Hash,
    key: address(root),
    root: address(root),
    vendor,
    model: `${vendor}/model`,
    at: `2026-11-16T12:00:${String(n).padStart(2, '0')}.000Z`,
    counts: 'counted',
    why: null,
    digest: `sha256:${verdict.padEnd(64, '0')}` as Hash,
    return: ret,
    ...over,
  };
}

describe('the answers of a piece', () => {
  it('sets the readings that agree beside each other, in the order the first of each was received', () => {
    const a = said(1, 'anthropic', 'contradicts');
    const b = said(2, 'openai', 'supports');
    const c = said(3, 'google', 'supports');
    const d = said(4, 'anthropic', 'contradicts');
    const t = tally(SCHEMA, ['verdict'], [a, b, c, d]);
    expect(t.readings).toBe(4);
    expect(t.left_out).toBe(0);
    expect(t.answers.map((x) => x.says)).toEqual([{ verdict: 'contradicts' }, { verdict: 'supports' }]);
    expect(t.answers.map((x) => x.readings.map((r) => r.id))).toEqual([
      [a.id, d.id],
      [b.id, c.id],
    ]);
    // Two roots of one vendor behind the first answer, two roots of two vendors behind the second; neither leads
    // for it.
    expect(t.answers.map((x) => [x.roots, x.vendors])).toEqual([
      [2, 1],
      [2, 2],
    ]);
  });

  it('agrees on every required field where the piece names no agree fields', () => {
    const a = said(1, 'anthropic', 'supports', { return: { verdict: 'supports', quote: 'one' } });
    const b = said(2, 'openai', 'supports', { return: { verdict: 'supports', quote: 'two' } });
    expect(tally(SCHEMA, undefined, [a, b]).answers).toHaveLength(2);
    expect(tally(SCHEMA, ['verdict'], [a, b]).answers).toHaveLength(1);
  });

  it('lists a reading struck or set aside and counts it in neither the roots nor the vendors', () => {
    const a = said(1, 'anthropic', 'supports');
    const b = said(2, 'openai', 'supports', { counts: 'struck', why: 'a challenge held against its set' });
    const c = said(3, 'google', 'supports', { counts: 'aside', why: 'it rests on nothing' });
    const d = said(4, 'anthropic', 'supports', { counts: 'kept', why: 'the set was made before it' });
    const [answer] = tally(SCHEMA, ['verdict'], [a, b, c, d]).answers;
    expect(answer!.readings).toHaveLength(4);
    expect([answer!.roots, answer!.vendors]).toEqual([2, 1]);
  });

  it('counts a root once however many of its keys signed', () => {
    const a = said(1, 'anthropic', 'supports');
    const b = said(1, 'openai', 'supports', { key: address(9) });
    const [answer] = tally(SCHEMA, ['verdict'], [a, b]).answers;
    expect([answer!.roots, answer!.vendors]).toEqual([1, 2]);
  });

  it('takes two returns as one answer by their hash where the piece has no schema', () => {
    const a = said(1, 'anthropic', 'supports', { return: null });
    const b = said(2, 'openai', 'supports', { return: null });
    const c = said(3, 'google', 'unclear', { return: null });
    const t = tally(undefined, undefined, [a, b, c]);
    expect(t.answers.map((x) => x.readings.length)).toEqual([2, 1]);
    expect(t.answers.map((x) => x.says)).toEqual([null, null]);
  });
});

describe('the keys a reader leaves out', () => {
  it('leaves out a reading by its root or by the key that signed it, and tells the answers again', () => {
    const a = said(1, 'anthropic', 'supports');
    const b = said(2, 'openai', 'contradicts');
    const c = said(3, 'google', 'contradicts', { key: address(8) });
    const d = said(4, 'mistral', 'supports');
    const all = [a, b, c, d];
    // The root of one, and the delegate key of another.
    const t = tally(SCHEMA, ['verdict'], all, leftOut([address(2), address(8)]));
    expect(t.left_out).toBe(2);
    expect(t.readings).toBe(2);
    expect(t.answers.map((x) => x.says)).toEqual([{ verdict: 'supports' }]);
    expect(t.answers[0]!.readings.map((r) => r.id)).toEqual([a.id, d.id]);
    // The list given changes nothing of the readings handed in.
    expect(tally(SCHEMA, ['verdict'], all).answers).toHaveLength(2);
  });

  it('knows an address whatever capitals it is written in', () => {
    const a = said(0xab, 'anthropic', 'supports');
    expect(tally(SCHEMA, ['verdict'], [a], leftOut([a.root.toUpperCase().replace('0X', '0x')])).readings).toBe(0);
    expect(tally(SCHEMA, ['verdict'], [a], leftOut([a.root.toLowerCase()])).readings).toBe(0);
  });

  it('answers nothing where every reading is left out', () => {
    const a = said(1, 'anthropic', 'supports');
    expect(tally(SCHEMA, ['verdict'], [a], leftOut([a.root]))).toEqual({ answers: [], readings: 0, left_out: 1 });
  });
});
