import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import type { Pattern, Quilt } from '../src/quilt.js';
import { mapText, summary } from '../src/render.js';
import { quiltOver, startTracker } from './helpers.js';

/**
 * A Quilt that no tracker answers, read by reading 2. docs/v2/READING.md section 1: the read takes a ledger, and
 * section 12, item 10, says the ledger a Quilt holds with no tracker is its one problem. A problem with an `agree`
 * piece and a `record:2` piece is worked through a tracker and opened once, so the home's cache holds its chain. The
 * tracker is then closed, and the Quilt opens the problem again from the cache:
 * - each piece has the state the reading gives it, accepted within its window and recorded, where reading 1's fold of
 *   the same chain calls the record piece unknown;
 * - every word the home's own read says of a piece is the word the tracker said of it while it answered;
 * - the map a model is told is the one the tracker's answer drew, and the summary says no tracker answered.
 */
const verdict = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'refutes'] } },
};
const pattern: Pattern = {
  title: 'A problem read with no tracker',
  done_when: 'One claim checked and two readings on the record.',
  slug: 'read-alone',
  pieces: {
    claim: {
      verifier: 'agree',
      requires: ['web'],
      brief: 'Is the claim in the paper?',
      schema: verdict,
      agree: ['verdict'],
    },
    question: {
      verifier: 'record:2',
      requires: ['web'],
      brief: 'Does the paper ground the claim? Read it your way.',
      schema: verdict,
      agree: ['verdict'],
    },
  },
};

let server: Server | null;
let owner: Quilt, a: Quilt, b: Quilt, reader: Quilt;
let problem: Hash;
const pieceOf = new Map<string, Hash>();

beforeAll(async () => {
  const started = await startTracker();
  server = started.server;
  const mk = quiltOver(started.base);
  owner = mk(9);
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  reader = mk(3, 'google/gemini');
  problem = (await owner.publish(pattern)).hash;
  for (const v of (await owner.open(problem)).state.pieces) pieceOf.set(v.piece.name, v.piece.hash);
  for (const q of [a, b]) await q.return(problem, pieceOf.get('claim')!, { verdict: 'supports' });
  await a.return(problem, pieceOf.get('question')!, { verdict: 'supports' });
  await b.return(problem, pieceOf.get('question')!, { verdict: 'refutes' });
});
const closed = () =>
  new Promise<void>((r) => (server ? server.close(() => r()) : r())).then(() => void (server = null));
afterAll(closed);

describe('a Quilt no tracker answers reads its one problem by reading 2 (READING.md section 1)', () => {
  it('says each piece as the tracker said it, from the chain the home holds', async () => {
    const online = await reader.open(problem);
    expect(online.tracker).not.toBeNull();
    const said = new Map(online.layer!.map((l) => [l.name, l]));
    expect([said.get('claim')!.state, said.get('question')!.state]).toEqual(['accepted_provisional', 'recorded']);
    await closed();

    const alone = await reader.open(problem);
    expect(alone.tracker).toBeNull();
    // Reading 1's fold of the same chain knows no record kind.
    const core = (name: string) => alone.state.byHash.get(pieceOf.get(name)!)!.state;
    expect([core('claim'), core('question')]).toEqual(['accepted_provisional', 'unknown']);
    expect(alone.layer!.map((l) => [l.name, l.state, l.kind])).toEqual([
      ['claim', 'accepted_provisional', 'agree'],
      ['question', 'recorded', 'record'],
    ]);
    for (const l of alone.layer!) expect(said.get(l.name), l.name).toMatchObject(l);
    expect(alone.layer!.find((l) => l.name === 'question')!.readings!.map((r) => r.counts)).toEqual([
      'counted',
      'counted',
    ]);
    expect(alone.gold).toEqual(online.gold);
    expect(mapText(alone.state, alone.layer)).toBe(mapText(online.state, online.layer));
    expect(summary(alone, [])).toContain('Answered from the cache or a mirror.');
  });
});
