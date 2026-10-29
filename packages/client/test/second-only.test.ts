import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { type Pattern, Quilt } from '../src/quilt.js';
import { json, quiltOver, startTracker } from './helpers.js';

/**
 * The house second opinion from the client's side (docs/DEPLOY.md): with QUILT_NEXT_ONLY=verify, `next` takes only a
 * piece another vendor has returned, in needs_verify or disputed, and never an open one; where every reveal is its own
 * vendor's it claims nothing and says so; without the variable, `next` takes anything as before.
 */
let server: Server;
let base: string;
let owner: Quilt, claude: Quilt, house: Quilt, other: Quilt, gemini: Quilt;
let p: Hash, q: Hash;
let s1: Hash, s2: Hash, q1: Hash, q2: Hash;

const pattern = (slug: string): Pattern => ({
  title: `Does the paper say what people say it says? (${slug})`,
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug,
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?',
      schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } },
      agree: ['verdict'],
    },
  },
});

/** The call made with the second opinion's switch set, and the switch unset again whatever happens. */
async function verifying<T>(f: () => Promise<T>): Promise<T> {
  process.env.QUILT_NEXT_ONLY = 'verify';
  try {
    return await f();
  } finally {
    delete process.env.QUILT_NEXT_ONLY;
  }
}

const trackerState = async (problem: Hash, piece: Hash) => (await json<{ pieces: { hash: Hash; state: string }[] }>(`${base}p/${problem}/state`)).pieces.find((x) => x.hash === piece)!.state;
const eventsBy = async (problem: Hash, address: string) => (await (await fetch(`${base}p/${problem}/events`)).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { event: { type: string; key: string } }).filter((l) => l.event.key.toLowerCase() === address.toLowerCase()).map((l) => l.event.type);

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  const mk = quiltOver(base);
  owner = mk(9, 'anthropic/claude');
  claude = mk(1, 'anthropic/claude');
  house = mk(2, 'openai/gpt-6-luna', 'ChatGPT');
  other = mk(3, 'openai/other', 'ChatGPT');
  gemini = mk(4, 'google/gemini', 'Gemini');
  p = (await owner.publish(pattern('first'))).hash;
  q = (await owner.publish(pattern('second'))).hash;
  [s1, s2] = (await claude.open(p)).state.pieces.map((v) => v.piece.hash) as [Hash, Hash];
  [q1, q2] = (await claude.open(q)).state.pieces.map((v) => v.piece.hash) as [Hash, Hash];
  // On the first problem, one piece returned by Claude and one open; on the second, one returned by another OpenAI key and one open.
  await claude.return(p, s1, { verdict: 'supports' });
  await other.return(q, q1, { verdict: 'supports' });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('next with QUILT_NEXT_ONLY=verify', () => {
  it('takes the piece another vendor returned and not the open one, and its return accepts the piece', async () => {
    expect(await trackerState(p, s1)).toBe('needs_verify');
    expect(await trackerState(p, s2)).toBe('open');
    const { pick, posted } = await verifying(() => house.next(p));
    expect(pick.piece.hash).toBe(s1);
    expect(pick.state).toBe('needs_verify');
    expect(posted.queued).toBe(false);
    // The open piece was not touched: no claim on it, and nothing from the house on it.
    expect(await trackerState(p, s2)).toBe('open');
    expect(await eventsBy(p, house.identity!.address)).toEqual(['claim']);
    const r = await house.return(p, s1, { verdict: 'supports' });
    expect(r.waits).toContain('Two vendors agree');
    expect(await trackerState(p, s1)).toBe('accepted_provisional');
  });

  it('claims nothing once every piece left is open, and says there is nothing to verify', async () => {
    await expect(verifying(() => house.next(p))).rejects.toThrow(/nothing to verify/);
    expect(await trackerState(p, s2)).toBe('open');
  });

  it('claims nothing where the only reveal is from its own vendor, and says so', async () => {
    expect(await trackerState(q, q1)).toBe('needs_verify');
    await expect(verifying(() => house.next(q))).rejects.toThrow(/nothing to verify on that problem/);
    expect(await trackerState(q, q1)).toBe('needs_verify');
    expect(await trackerState(q, q2)).toBe('open');
    expect(await eventsBy(q, house.identity!.address)).toEqual([]);
  });

  it('takes a disputed piece whose readings are from other vendors, and leaves one its own vendor read', async () => {
    await claude.return(q, q2, { verdict: 'supports' });
    await gemini.return(q, q2, { verdict: 'contradicts' });
    expect(await trackerState(q, q2)).toBe('disputed');
    const { pick } = await verifying(() => house.next(q));
    expect(pick.piece.hash).toBe(q2);
    expect(pick.state).toBe('disputed');
  });
});

describe('next without the variable', () => {
  it('takes anything, the open piece included', async () => {
    expect(process.env.QUILT_NEXT_ONLY).toBeUndefined();
    expect(await trackerState(p, s2)).toBe('open');
    const { pick } = await house.next(p);
    expect(pick.piece.hash).toBe(s2);
    expect(pick.state).toBe('open');
    expect(await trackerState(p, s2)).toBe('in_flight');
  });
});
