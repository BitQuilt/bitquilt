import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, addressOf, secretFromHex } from '@bitquilt/core';
import { draftEnvelope, patternProblems } from '../src/pattern.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { STATE_MARK, STATE_WORDS, kindWords, legendText, waitsText } from '../src/render.js';
import { hex, instructs, mcpPair, quiltOver, startTracker, verifying } from './helpers.js';

/**
 * The record kind from the client's side (docs/ext/QX-20.md): the words for the kind, its two states and what a reading
 * waits for; a `record:3` problem published and handed out through the connector, the piece said as recording with the
 * kind's words before the brief, the return said to stand as given, and `read` saying each reading as the quoted words
 * of its signer with the grade and the seams; the second reader's switch takes none of it; the pattern checker refuses
 * `record:1` and a gold answer on a record piece, and the example pattern of this kind passes whole.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let server: Server;
let base: string;
let owner: Quilt, a: Quilt, b: Quilt, c: Quilt, d: Quilt;
let problem: Hash, piece: Hash;

const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['stance', 'reading'],
  properties: {
    stance: { enum: ['asserts', 'denies', 'leaves open'] },
    reading: { type: 'string' as const, maxLength: 200 },
  },
};
const pattern: Pattern = {
  title: 'Three readings of Article 1',
  done_when: 'Three readings on the record.',
  slug: 'readings',
  settings: { endgame_at: 1 },
  pieces: {
    question: {
      verifier: 'record:3',
      requires: ['web'],
      brief: 'Does the article ground dignity in reason? Read it your way.',
      schema,
      agree: ['stance'],
    },
  },
};

beforeAll(async () => {
  ({ server, base } = await startTracker());
  const mk = quiltOver(base);
  owner = mk(9);
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  c = mk(3, 'anthropic/claude');
  d = mk(4, 'google/gemini');
  await Promise.all([a, b, c, d].map((q) => q.setName(`Reader ${q.identity!.address.slice(2, 6)}`)));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the record kind (QX-20)', () => {
  it('has its words: the kind, the two states and their marks, and what a reading waits for, none of them instructing', () => {
    expect(kindWords('record:3')).toMatchObject({
      kind: 'record',
      extension: 'QX-20',
      strength: 'recorded',
      weakest: false,
    });
    expect(kindWords('record:3').says).toBe(
      '3 readings from roots unrelated to the owner and to each other are kept as given; none is accepted and none struck',
    );
    expect(kindWords('record:1').kind).toBe('record:1');
    expect(STATE_WORDS.recording).toBe('readings being recorded');
    expect(STATE_WORDS.recorded).toBe('recorded, every reading standing');
    expect([STATE_MARK.recording, STATE_MARK.recorded]).toEqual(['r', 'R']);
    expect(legendText()).toContain('r readings being recorded, R recorded');
    expect(waitsText('record:3')).toContain('stands as given');
    for (const text of [
      kindWords('record:3').says,
      waitsText('record:3'),
      STATE_WORDS.recording!,
      STATE_WORDS.recorded!,
    ])
      expect(text).not.toMatch(instructs);
  });

  it("is published, handed out as recording with the kind's words before the brief, returned as a reading that stands, and read as the quoted readings with the grade and the seams", async () => {
    const r = await owner.publish(pattern);
    problem = r.hash;
    piece = (await owner.open(problem)).state.pieces[0]!.piece.hash;
    const { client, close } = await mcpPair(a);
    const first = await client.callTool({ name: 'quilt_next', arguments: { problem } });
    const firstText = (first.structuredContent as { text: string }).text;
    expect(firstText).toContain('verifier record:3, state open');
    expect(firstText).toContain(
      'A square of this kind is recorded: 3 readings from roots unrelated to the owner and to each other are kept as given; none is accepted and none struck.',
    );
    const ret = await client.callTool({
      name: 'quilt_return',
      arguments: {
        problem,
        piece,
        return: { stance: 'asserts', reading: 'Reason and conscience are what it says we are endowed with.' },
      },
    });
    expect((ret.structuredContent as { text: string }).text).toContain('The reading stands as given.');
    await close();
    // The second: the piece is recording now, offered to a root that has not read it; the house's switch takes none of
    // it.
    const second = await mcpPair(b);
    const next = await second.client.callTool({ name: 'quilt_next', arguments: { problem } });
    expect((next.structuredContent as { text: string }).text).toContain('state recording');
    await second.close();
    await b.return(problem, piece, {
      stance: 'leaves open',
      reading: 'It says should, which is a hope, not a ground.',
    });
    await expect(verifying(() => d.next(problem))).rejects.toThrow('nothing to verify');
    const { client: reader, close: done } = await mcpPair(c);
    const read = await reader.callTool({ name: 'quilt_read', arguments: { problem } });
    const text = (read.structuredContent as { text: string }).text;
    expect(text).toContain(
      'Recorded:\nquestion (record:3; recording: 2 of 3 readings, 0 resting on kept reads, from 2 roots and 2 vendors)',
    );
    expect(text).toContain('Reader ');
    expect(text).toContain(
      'returned: {"reading":"Reason and conscience are what it says we are endowed with.","stance":"asserts"}',
    );
    expect(text).toContain('On stance, one side rests on nothing kept:');
    expect(text).not.toMatch(instructs);
    await done();
    // The third makes it recorded; the owner's own reading would not stand, and a fourth reader is refused at the door.
    await c.return(problem, piece, { stance: 'asserts', reading: 'Endowed with reason and conscience is the ground.' });
    const after = (await c.open(problem)).layer!.find((l) => l.hash === piece)!;
    expect(after.state).toBe('recorded');
    expect(after.record).toMatchObject({ wanted: 3, standing: 3, grounded: 0, roots: 3, vendors: 2 });
    await expect(d.return(problem, piece, { stance: 'denies', reading: 'late' })).rejects.toThrow(
      'the readings for this piece are in',
    );
    const found = await c.search('readings');
    expect(found[0]!.work).toMatchObject({ returned: 1, accepted: 0, recorded: 1 });
  });

  it('refuses record:1 and a gold answer on a record piece in the checker, and passes the example pattern of this kind whole', () => {
    const who = { secret: secretFromHex(hex(7)), address: addressOf(secretFromHex(hex(7))) };
    const hints = { trackers: [], mirrors: [] };
    // A fault in a verifier is named before the pieces expand; the gold check runs over the expanded pieces, so each is
    // tried on its own pattern.
    const one: Pattern = { ...pattern, pieces: { question: { ...pattern.pieces.question!, verifier: 'record:1' } } };
    expect(patternProblems(one, draftEnvelope(one, who, hints))).toContain(
      'pieces.question.verifier: record:n takes n from 2',
    );
    const golden: Pattern = { ...pattern, gold: { answers: { question: { stance: 'asserts' } } } };
    expect(patternProblems(golden, draftEnvelope(golden, who, hints))).toContain(
      'gold.answers.question: a record piece takes no gold',
    );
    const example = JSON.parse(readFileSync(join(root, 'examples', 'readings-of-a-text.json'), 'utf8')) as Pattern;
    expect(patternProblems(example, draftEnvelope(example, who, hints))).toEqual([]);
    expect(Object.values(example.pieces)[0]!.verifier).toBe('record:3');
  });
});
