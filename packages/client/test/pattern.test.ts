import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { draftEnvelope, patternProblems, patternProblemsText } from '../src/pattern.js';
import type { Pattern } from '../src/quilt.js';
import { hex, quiltOver, startTracker } from './helpers.js';
import { secretFromHex, addressOf, canonicalBytes } from '@bitquilt/core';

/**
 * A pattern's faults, all at once (pattern.ts): a draft with several things wrong is told every one of them in the
 * checker's words, a sound draft is told nothing, what a door refuses beyond the core's checks is told too, the
 * bounds on what a fold costs counted as the door counts them, and `publish` refuses with the whole list rather than
 * the first line.
 */
const owner = { secret: secretFromHex(hex(7)), address: addressOf(secretFromHex(hex(7))) };
const hints = { trackers: [], mirrors: [] };
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'contradicts'] } },
};
const sound: Pattern = {
  title: 'Does the paper say what people say it says?',
  done_when: 'Every statement has a verdict.',
  slug: 'paper',
  pieces: {
    'statement/*': {
      count: 2,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: {s.text}',
      data: { s: 'statements' },
      schema,
      agree: ['verdict'],
    },
  },
  data: { statements: [{ text: 'one' }, { text: 'two' }] },
  gold: { answers: { 'statement/1': { verdict: 'supports' } } },
};

describe("a pattern's faults", () => {
  it('are none for a sound draft', () => {
    expect(patternProblems(sound, draftEnvelope(sound, owner, hints))).toEqual([]);
  });
  it("are all named at once, each in the checker's words", () => {
    const faulty = {
      ...sound,
      colour: 'blue',
      data: { statements: [{ text: 'one' }] },
      pieces: {
        'statement/*': {
          ...sound.pieces['statement/*']!,
          brief: 'Statement {n}: {s.text}, see https://example.org/{n}',
        },
      },
      gold: { answers: { 'statement/9': { verdict: 'supports' } } },
    } as unknown as Pattern;
    const problems = patternProblems(faulty, draftEnvelope(faulty, owner, hints));
    expect(problems).toContain('colour: not a field of a pattern');
    expect(problems.some((p) => p.startsWith('pieces.statement/*: 2 pieces but data.statements has 1 rows'))).toBe(
      true,
    );
    expect(problems.some((p) => p.startsWith('pieces.statement/*.brief:'))).toBe(true);
    expect(problems).toContain('gold.answers.statement/9: no such piece');
    expect(problems.length).toBeGreaterThanOrEqual(3);
    expect(patternProblemsText(problems)).toMatch(/^\d+ problems in the pattern, each to fix before it publishes:\n/);
  });
});

describe("a door's bounds", () => {
  it('are named by the checker in the door own words, so a pattern it passes is one a door takes', () => {
    const big = {
      ...sound,
      settings: { ...sound.settings, budget: 1e9, lease_h: 2e6 },
      data: undefined,
      pieces: {
        'statement/*': {
          ...sound.pieces['statement/*']!,
          count: 10_001,
          data: { s: 'constructor' },
          agree: ['toString'],
        },
      },
      gold: undefined,
    } as unknown as Pattern;
    const problems = patternProblems(big, draftEnvelope(big, owner, hints));
    expect(problems).toEqual(
      expect.arrayContaining([
        'problem.pieces.statement/*.agree: names fields the schema has',
        'problem.pieces.statement/*.data: constructor is not a blob of this problem',
        'problem.settings.lease_h: at most 1000000 hours',
        'problem.pieces: 10001 pieces after expansion, over the 10000 a door takes',
      ]),
    );
  });
});

describe("a door's bounds on what a fold costs", () => {
  it('are named by the checker as the door counts them: links, data blobs and the bytes the pieces expand to', () => {
    const MB = 1024 * 1024;
    const long = { ...sound.pieces['statement/*']!, count: 10_000, brief: `${'Read it again. '.repeat(240)}{n}` };
    const heavy = {
      ...sound,
      settings: { budget: 1e9 },
      pieces: {
        'statement/*': { ...long, data: undefined },
        'a/*': { ...sound.pieces['statement/*']!, count: 1001, inputs: ['b/*'], brief: 'A {n}.', data: undefined },
        'b/*': { ...sound.pieces['statement/*']!, count: 1000, brief: 'B {n}.', data: { s: 'statements' } },
      },
      data: { statements: Array.from({ length: 17 }, (_, i) => `${i}`.padEnd(MB, 'r')) },
      gold: undefined,
    } as unknown as Pattern;
    const drafted = draftEnvelope(heavy, owner, hints);
    const data = [...drafted.blobs.values()].reduce((n, b) => n + b.length, 0);
    const pieces = drafted.problem.pieces;
    const expanded =
      10_000 * canonicalBytes(pieces['statement/*']!).length +
      1001 * canonicalBytes(pieces['a/*']!).length +
      1000 * canonicalBytes(pieces['b/*']!).length;
    expect(patternProblems(heavy, drafted)).toEqual(
      expect.arrayContaining([
        'problem.pieces: inputs that make 1001000 links, over the 1000000 a door takes',
        `problem.data: blobs of ${data} bytes, over the ${16 * MB} a door takes`,
        `problem.pieces: expand to as much as ${expanded} bytes, over the ${32 * MB} a door takes`,
      ]),
    );
    // A slot written many times counts its blob as many times.
    const slots = {
      ...sound,
      pieces: { 'statement/*': { ...sound.pieces['statement/*']!, brief: '{s.text} '.repeat(17) } },
      data: { statements: ['x'.padEnd(MB, 'r'), 'y'.padEnd(MB, 'r')] },
      gold: undefined,
    } as unknown as Pattern;
    const blob = [...draftEnvelope(slots, owner, hints).blobs.values()][0]!.length;
    const def = canonicalBytes(draftEnvelope(slots, owner, hints).problem.pieces['statement/*']!).length;
    expect(patternProblems(slots, draftEnvelope(slots, owner, hints))).toContain(
      `problem.pieces: expand to as much as ${2 * def + 17 * blob} bytes, over the ${32 * MB} a door takes`,
    );
  });
});

describe('publish', () => {
  let server: Server;
  let base: string;
  beforeAll(async () => ({ server, base } = await startTracker()));
  afterAll(() => new Promise<void>((r) => server.close(() => r())));
  it('refuses a faulty draft with the whole list, and takes the sound one', async () => {
    const q = quiltOver(base)(3);
    const faulty = {
      ...sound,
      slug: 'Paper Slug!',
      gold: { answers: { nowhere: { verdict: 'supports' } } },
    } as Pattern;
    await expect(q.publish(faulty)).rejects.toThrow(
      /problems in the pattern[\s\S]*gold\.answers\.nowhere: no such piece/,
    );
    const { gold: _gold, ...plain } = sound;
    const r = await q.publish(plain);
    expect(r.posted).toEqual([base]);
  });
});
