import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Address, Hash } from '@bitquilt/core';
import type { Pattern, Quilt } from '../src/quilt.js';
import { answersText } from '../src/render.js';
import { runTool } from '../src/tools.js';
import { instructs, quiltOver, startTracker } from './helpers.js';

/**
 * A problem's answers by who gave them, and the keys a home leaves out, from the client's side (docs/ext/QX-24.md):
 * quilt_read tells every answer on the record under Answers by key, a piece read once among them with its return in
 * full, each answer as quoted words with the address, name and model of each key that gave it and why a reading
 * counts for nothing; quilt_leave_out leaves a key out of this home's reads, by its root or by the key that signed,
 * with nothing signed or posted, and the next read tells the answers again without it and says what it left out;
 * quilt_me lists the keys left out with the reason given; the key comes back when asked; and another home's read is
 * as it was, since the list is one home's own.
 */
let server: Server;
let base: string;
let owner: Quilt, a: Quilt, b: Quilt, c: Quilt;
let problem: Hash;
const pieces = new Map<string, Hash>();

const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict', 'quote'],
  properties: {
    verdict: { enum: ['supports', 'contradicts', 'unclear'] },
    quote: { type: 'string' as const, maxLength: 200 },
  },
};
const piece = (brief: string) => ({ verifier: 'agree', requires: ['web' as const], brief, schema, agree: ['verdict'] });
const pattern: Pattern = {
  title: 'Does the paper say it',
  done_when: 'Every claim has a verdict.',
  slug: 'answers',
  pieces: {
    first: piece('Is the first claim in the paper?'),
    second: piece('Is the second claim in the paper?'),
    third: piece('Is the third claim in the paper?'),
  },
};

beforeAll(async () => {
  ({ server, base } = await startTracker());
  const mk = quiltOver(base);
  owner = mk(9);
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  c = mk(3, 'google/gemini');
  await a.setName('Ada');
  await b.setName('Bo');
  problem = (await owner.publish(pattern)).hash;
  for (const v of (await owner.open(problem)).state.pieces) pieces.set(v.piece.name, v.piece.hash);
  const give = (q: Quilt, name: string, verdict: string) =>
    q.return(problem, pieces.get(name)!, { verdict, quote: `as ${q.config.model} read it` });
  await give(a, 'first', 'supports');
  await give(b, 'first', 'supports');
  await give(c, 'first', 'supports');
  await give(b, 'second', 'contradicts');
  await give(a, 'second', 'supports');
  await give(c, 'third', 'unclear');
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const A = () => a.identity!.address;
const B = () => b.identity!.address;
const C = () => c.identity!.address;
/** The Answers by key section of a read, between its heading and the next section's. */
async function answers(q: Quilt): Promise<string> {
  const text = (await runTool(q, 'quilt_read', { problem })).text;
  const from = text.indexOf('Answers by key:\n');
  expect(from, text).toBeGreaterThan(-1);
  return text.slice(from + 'Answers by key:\n'.length, text.indexOf('\n\nChallenges:'));
}

describe("a problem's answers by who gave them (QX-24)", () => {
  it('tells every answer on the record with each key that gave it, a piece read once with its return in full', async () => {
    expect(await answers(a)).toBe(
      [
        'first (accepted within the window): 3 readings, 1 answer.',
        `Ada, ${A()} (anthropic/claude, this key); Bo, ${B()} (openai/gpt-5); ${C()} (google/gemini, kept: the set was made before it) returned, 3 keys of 3 vendors behind it: {"verdict":"supports"}`,
        '',
        'second (disputed): 2 readings, 2 answers.',
        `Bo, ${B()} (openai/gpt-5) returned, 1 key of 1 vendor behind it: {"verdict":"contradicts"}`,
        `Ada, ${A()} (anthropic/claude, this key) returned, 1 key of 1 vendor behind it: {"verdict":"supports"}`,
        '',
        'third (read, with no square yet): 1 reading, 1 answer.',
        `${C()} (google/gemini) returned, 1 key of 1 vendor behind it: {"verdict":"unclear"}`,
        `${C()} returned in full: {"quote":"as google/gemini read it","verdict":"unclear"}`,
      ].join('\n'),
    );
    expect(await answers(a)).not.toMatch(instructs);
  });

  it('says nothing of answers where no piece has a reading, and where no tracker lists them', async () => {
    const fresh = (await owner.publish({ ...pattern, slug: 'unread', title: 'Nobody read it' })).hash;
    expect((await runTool(a, 'quilt_read', { problem: fresh })).text).not.toContain('Answers by key');
    const { state } = await owner.open(problem);
    expect(answersText([], state)).toBe('');
    expect(a.answersText(null, state)).toBe('');
  });
});

describe('the keys a home leaves out (QX-24 section 2)', () => {
  it('leaves a key out with nothing signed or posted, and the next read tells the answers again without it', async () => {
    const before = (await (await fetch(`${base}p/${problem}/events`)).text()).length;
    const said = await runTool(a, 'quilt_leave_out', { key: B(), why: 'its quotes are not in the paper' });
    expect(said.text).toBe(
      `Left out ${B()}: this home's reads tell a problem's answers without the readings this key signed or that count for it. Nothing was signed or posted, and its readings stay on the record for every other reader. This home's reads now leave out 1 key.`,
    );
    expect(said.text).not.toMatch(instructs);
    expect(said.handles).toEqual({ key: B(), left_out: [B()] });
    expect((await (await fetch(`${base}p/${problem}/events`)).text()).length).toBe(before);
    expect(await answers(a)).toBe(
      [
        'first (accepted within the window): 2 readings, 1 answer; 1 reading left out.',
        `Ada, ${A()} (anthropic/claude, this key); ${C()} (google/gemini, kept: the set was made before it) returned, 2 keys of 2 vendors behind it: {"verdict":"supports"}`,
        '',
        'second (disputed): 1 reading, 1 answer; 1 reading left out.',
        `Ada, ${A()} (anthropic/claude, this key) returned, 1 key of 1 vendor behind it: {"verdict":"supports"}`,
        '',
        'third (read, with no square yet): 1 reading, 1 answer.',
        `${C()} (google/gemini) returned, 1 key of 1 vendor behind it: {"verdict":"unclear"}`,
        `${C()} returned in full: {"quote":"as google/gemini read it","verdict":"unclear"}`,
        '',
        `Left out of these answers, as this home asked: Bo, ${B()} (2 readings). The state beside each piece and the sections above are the tracker's own count, which leaves no key out.`,
      ].join('\n'),
    );
  });

  it('is one home’s own: another home reads every key, and quilt_me lists what this one leaves out', async () => {
    expect(await answers(c)).toContain(`Bo, ${B()} (openai/gpt-5)`);
    expect((await runTool(a, 'quilt_me', {})).text).toContain(
      `Keys this home's reads leave out (QX-24): ${B()}, of which was said: "its quotes are not in the paper"`,
    );
    expect((await runTool(c, 'quilt_me', {})).text).not.toContain('leave out');
  });

  it('knows the key whatever capitals it is written in, and leaves a whole piece untold where its one reader is out', async () => {
    await a.leaveOut(C().toLowerCase() as Address, true);
    const told = await answers(a);
    expect(told).not.toContain('third');
    expect(told).toContain(`${C()} (2 readings)`);
    await a.leaveOut(C(), false);
    expect(Object.keys(a.leftOut())).toEqual([B()]);
  });

  it('brings a key back, and refuses what is not an address', async () => {
    const said = await runTool(a, 'quilt_leave_out', { key: B(), back: true });
    expect(said.text).toBe(
      `Brought back ${B()}: its readings are told again in this home's reads. This home's reads now leave out 0 keys.`,
    );
    expect(await answers(a)).toContain(`Bo, ${B()} (openai/gpt-5)`);
    await expect(runTool(a, 'quilt_leave_out', { key: 'Bo' })).rejects.toThrow(
      'key: an address with its checksum, 0x and forty characters',
    );
  });
});
