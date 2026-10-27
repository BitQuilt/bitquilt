import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { runTool } from '../src/tools.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { instructs, json, mcpPair, quiltOver, startTracker } from './helpers.js';

/**
 * Gold pieces (QX-16) from the client's side: an owner publishes with the answers to some pieces, which leave the home
 * only as blind hashes naming no piece while the projections and nonces stay in the library; attention lists a reveal due once a piece is
 * accepted; the reveal through the tool marks the square verified, or strikes the set on a miss and says so; the
 * summary counts the gold; the tools describe and never instruct.
 */
let server: Server;
let base: string;
let owner: Quilt, other: Quilt, a: Quilt, b: Quilt;
let p: Hash, q: Hash;

const pattern = (slug: string, count: number): Pattern => ({
  title: `Does the paper say what people say it says? (${slug})`,
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug,
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so? Return the verdict and a quote.',
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
});

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  const mk = quiltOver(base);
  owner = mk(9, 'anthropic/claude');
  other = mk(8, 'anthropic/claude');
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

type StateView = { pieces: { hash: Hash; state: string; gold: string | null; verified: boolean }[]; gold: { committed: number; pending: number; verified: number; missed: number; overruled: number; lapsed: number } };
const trackerState = (problem: Hash) => json<StateView>(`${base}p/${problem}/state`);
const pieceOf = async (problem: Hash, n: number): Promise<Hash> => (await a.open(problem)).state.pieces[n]!.piece.hash;

describe('gold pieces, from the client', () => {
  it('publishes with gold: the commitments on the ledger, the answers only in the library, every piece pending, the stake locked', async () => {
    // The owner earns standing on another owner's problem first: a gold's stake is the owner's standing.
    q = (await other.publish(pattern('elsewhere', 3))).hash;
    for (let i = 0; i < 3; i++) {
      const qi = await pieceOf(q, i);
      await owner.return(q, qi, { verdict: 'supports', quote: 'it says so' });
      await b.return(q, qi, { verdict: 'supports', quote: 'indeed' });
    }
    expect(await owner.standing()).toMatchObject({ standing: 4, free: 4 });
    const r = await owner.publish({ ...pattern('golden', 3), gold: { answers: { 'statement/1': { verdict: 'supports', quote: 'the quote is not committed' }, 'statement/2': { verdict: 'contradicts', quote: 'nor this one' } } } });
    p = r.hash;
    expect(r.refused).toEqual([]);
    // Two a piece where no stake rule applies: one for each root a miss would dock.
    expect(r.gold).toEqual({ pieces: 2, stake: 4 });
    const lib = JSON.parse(readFileSync(join(owner.resolver.home, 'library.json'), 'utf8')) as { gold: Record<string, Record<string, { name: string; projection: Record<string, unknown>; nonce: string }>> };
    const kept = Object.values(lib.gold[p]!);
    expect(kept.map((k) => k.name).sort()).toEqual(['statement/1', 'statement/2']);
    expect(kept.find((k) => k.name === 'statement/1')!.projection).toEqual({ verdict: 'supports' });
    expect(kept.every((k) => /^[0-9a-f]{32}$/.test(k.nonce))).toBe(true);
    const events = await (await fetch(`${base}p/${p}/events`)).text();
    expect(events).toContain('"type":"gold"');
    expect(events).not.toContain('contradicts');
    const s = await trackerState(p);
    // Blind: the ledger counts two commitments, names no piece in them, and no piece shows one until the reveal.
    const goldLine = events.split('\n').find((l) => l.includes('"type":"gold"'))!;
    for (const x of s.pieces) expect(goldLine).not.toContain(x.hash);
    expect(s.pieces.map((x) => x.gold)).toEqual([null, null, null]);
    expect(s.gold).toEqual({ committed: 2, pending: 2, verified: 0, missed: 0, overruled: 0, lapsed: 0 });
    expect(await owner.standing()).toMatchObject({ standing: 4, locked: 4, free: 0 });
    const opened = await a.open(p);
    expect(a.summary(p, opened.state, opened.tracker, opened.layer, opened.hidden, opened.gold)).toContain('Gold (QX-16): the owner committed answers for 2 of the pieces before the work, without saying which; 0 verified, 0 missed, 2 awaiting the owner\'s reveal.');
  });

  it('lists a reveal due once the piece is accepted, reveals it through the tool, and the square is verified', async () => {
    const p1 = await pieceOf(p, 0);
    expect((await owner.attention()).items.filter((i) => i.why === 'gold')).toEqual([]);
    await a.return(p, p1, { verdict: 'supports', quote: 'as the paper says' });
    await b.return(p, p1, { verdict: 'supports', quote: 'the paper says so' });
    const due = (await owner.attention()).items.filter((i) => i.why === 'gold');
    expect(due.map((i) => i.piece)).toEqual([p1]);
    expect(due[0]!.name).toBe('statement/1');
    const r = await runTool(owner, 'quilt_reveal_gold', { problem: p, piece: p1 });
    expect(r.text).toContain('Gold on statement/1 revealed; posted to');
    expect(r.text).toContain('the square is verified');
    expect(r.handles.outcome).toBe('match');
    expect((await trackerState(p)).pieces[0]).toMatchObject({ gold: 'match', verified: true });
    expect((await owner.attention()).items.filter((i) => i.why === 'gold')).toEqual([]);
    const read = await runTool(a, 'quilt_read', { problem: p });
    expect(read.text).toContain('1 verified, 0 missed, 1 awaiting the owner\'s reveal');
    expect(read.text).toContain('statement/1 (verified: the set agreed with the answer the owner committed to before the work)');
  });

  it('commits gold after publishing, on a piece nobody has worked, and refuses one already worked', async () => {
    // The other owner earns a point on the plain third piece of the golden problem: a gold's share is two a piece.
    const p3 = await pieceOf(p, 2);
    await other.return(p, p3, { verdict: 'supports', quote: 'read it' });
    await b.return(p, p3, { verdict: 'supports', quote: 'so did we' });
    expect(await other.standing()).toMatchObject({ standing: 2, free: 2 });
    const r = (await other.publish(pattern('later', 2))).hash;
    const r1 = await pieceOf(r, 0);
    const committed = await other.commitGold(r, { 'statement/1': { verdict: 'supports', quote: 'kept at home' } });
    expect(committed).toEqual({ pieces: 1, stake: 2 });
    expect((await trackerState(r)).pieces.map((x) => x.gold)).toEqual([null, null]);
    expect((await trackerState(r)).gold).toMatchObject({ committed: 1, pending: 1 });
    const lib = JSON.parse(readFileSync(join(other.resolver.home, 'library.json'), 'utf8')) as { gold: Record<string, Record<string, { name: string }>> };
    expect(Object.values(lib.gold[r]!).map((k) => k.name)).toEqual(['statement/1']);
    await a.return(r, r1, { verdict: 'supports', quote: 'x' });
    await expect(other.commitGold(r, { 'statement/2': { verdict: 'supports', quote: '' }, 'statement/1': { verdict: 'supports', quote: '' } })).rejects.toThrow(/already worked/);
    await expect(other.commitGold(r, { 'statement/9': { verdict: 'supports', quote: '' } })).rejects.toThrow(/no piece named/);
  });

  it('strikes the set on a miss and says so, refuses a reveal with nothing kept, and the tools describe', async () => {
    const p2 = await pieceOf(p, 1);
    await a.return(p, p2, { verdict: 'supports', quote: 'we read it so' });
    await b.return(p, p2, { verdict: 'supports', quote: 'so did we' });
    await expect(a.revealGold(p, p2)).rejects.toThrow(/no gold kept here/);
    const r = await owner.revealGold(p, p2);
    expect(r.outcome).toBe('miss');
    expect((await trackerState(p)).pieces[1]).toMatchObject({ state: 'open', gold: 'miss', verified: false });
    await expect(owner.revealGold(p, p2)).rejects.toThrow(/the gold on this piece is revealed/);
    // A struck root's challenge on the miss stakes nothing: 0 passes the client and the door, which on this small tracker then finds no panel to seat.
    await expect(a.challenge(p, p2, -1, 'The gold is wrong.')).rejects.toThrow(/whole number from 0/);
    await expect(a.challenge(p, p2, 0, 'The gold is wrong.')).rejects.toThrow(/no panel can be seated/);
    const { client, close } = await mcpPair(owner);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('quilt_reveal_gold');
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(instructs);
    expect(JSON.stringify(tools.tools.find((t) => t.name === 'quilt_publish')!.inputSchema)).toContain('"gold"');
    expect(JSON.stringify(tools.tools.find((t) => t.name === 'quilt_challenge')!.inputSchema)).toContain('"minimum":0');
    await close();
  });
});
