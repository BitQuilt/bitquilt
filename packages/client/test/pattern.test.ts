import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { draftEnvelope, patternProblems, patternProblemsText } from '../src/pattern.js';
import type { Pattern } from '../src/quilt.js';
import { hex, quiltOver, startTracker } from './helpers.js';
import { secretFromHex, addressOf } from '@bitquilt/core';

/**
 * A pattern's faults, all at once (pattern.ts): a draft with several things wrong is told every one of them in the
 * checker's words, a sound draft is told nothing, and `publish` refuses with the whole list rather than the first line.
 */
const owner = { secret: secretFromHex(hex(7)), address: addressOf(secretFromHex(hex(7))) };
const hints = { trackers: [], mirrors: [] };
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } };
const sound: Pattern = {
  title: 'Does the paper say what people say it says?', done_when: 'Every statement has a verdict.', slug: 'paper',
  pieces: { 'statement/*': { count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: {s.text}', data: { s: 'statements' }, schema, agree: ['verdict'] } },
  data: { statements: [{ text: 'one' }, { text: 'two' }] },
  gold: { answers: { 'statement/1': { verdict: 'supports' } } },
};

describe('a pattern\'s faults', () => {
  it('are none for a sound draft', () => {
    expect(patternProblems(sound, draftEnvelope(sound, owner, hints))).toEqual([]);
  });
  it('are all named at once, each in the checker\'s words', () => {
    const faulty = {
      ...sound,
      colour: 'blue',
      data: { statements: [{ text: 'one' }] },
      pieces: { 'statement/*': { ...sound.pieces['statement/*']!, brief: 'Statement {n}: {s.text}, see https://example.org/{n}' } },
      gold: { answers: { 'statement/9': { verdict: 'supports' } } },
    } as unknown as Pattern;
    const problems = patternProblems(faulty, draftEnvelope(faulty, owner, hints));
    expect(problems).toContain('colour: not a field of a pattern');
    expect(problems.some((p) => p.startsWith('pieces.statement/*: 2 pieces but data.statements has 1 rows'))).toBe(true);
    expect(problems.some((p) => p.startsWith('pieces.statement/*.brief:'))).toBe(true);
    expect(problems).toContain('gold.answers.statement/9: no such piece');
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(patternProblemsText(problems)).toMatch(/^\d+ problems in the pattern, each to fix before it publishes:\n/);
  });
});

describe('publish', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => ({ server, base } = await startTracker()));
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  it('refuses a faulty draft with the whole list, and takes the sound one', async () => {
    const q = quiltOver(base)(3);
    const faulty = { ...sound, slug: 'Paper Slug!', gold: { answers: { nowhere: { verdict: 'supports' } } } } as Pattern;
    await expect(q.publish(faulty)).rejects.toThrow(/problems in the pattern[\s\S]*gold\.answers\.nowhere: no such piece/);
    const { gold: _gold, ...plain } = sound;
    const r = await q.publish(plain);
    expect(r.posted).toEqual([base]);
  });
});
