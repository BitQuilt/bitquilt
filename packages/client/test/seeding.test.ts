import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { type Pattern, Quilt } from '../src/quilt.js';
import { json, quiltOver, startTracker } from './helpers.js';

/** Quilt's side of QX-4 and QX-5: the seed verb and the standing list, and `next` with no problem named taking the tracker's offer. */
let server: Server;
let base: string;
let owner: Quilt, a: Quilt, b: Quilt;
let problem: Hash;

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'paper-says',
  topics: ['citations'],
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: {claim.text} Return whether the paper says this, with a quote.',
      data: { claim: 'claims' },
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
    'watch/*': {
      count: 1, verifier: 'agree', requires: ['web'], brief: 'Watch {n}: is the paper still where it was?',
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
  data: { claims: [{ text: 'The coin is a chain of signatures.' }, { text: 'Difficulty never changes.' }] },
};

beforeAll(async () => {
  ({ server, base } = await startTracker());
  const mk = quiltOver(base);
  owner = mk(9);
  a = mk(1);
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  problem = (await owner.publish(pattern)).hash;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('seeding and the offer from Quilt', () => {
  // The seeder's test runs first: with nobody seeding, the watch piece is anyone's, and which of three equally rare pieces
  // comes first turns on the hour's tie-break. Once the seeder holds it, the other key can only draw a statement.
  it('seeds a problem: a seed event the tracker counts, the standing list, and the watch piece first', async () => {
    const r = await b.seed(problem, true);
    expect(r.queued).toBe(false);
    expect(Object.keys(b.library.seeding)).toEqual([problem]);
    const scrape = await json<{ seeders: number; last_seeded: string | null }>(`${base}p/${problem}/scrape`);
    expect(scrape.seeders).toBe(1);
    expect(scrape.last_seeded).not.toBeNull();
    const { pick } = await b.next('');
    expect(pick.piece.family).toBe('watch');
    const off = await b.seed(problem, false);
    expect(off.queued).toBe(false);
    expect(b.library.seeding).toEqual({});
    expect((await json<{ seeders: number }>(`${base}p/${problem}/scrape`)).seeders).toBe(0);
  });
  it('takes the tracker\'s offer when no problem is named, and never the key\'s own problem', async () => {
    const { hash, pick, posted } = await a.next('');
    expect(hash).toBe(problem);
    expect(pick.piece.family).toBe('statement');
    expect(posted.queued).toBe(false);
    await expect(owner.next('')).rejects.toThrow(/nothing to do/);
  });
});
