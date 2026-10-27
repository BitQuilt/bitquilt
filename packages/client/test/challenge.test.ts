import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { type Pattern, Quilt } from '../src/quilt.js';
import { instructs, json, mcpPair, quiltOver, startTracker } from './helpers.js';

/**
 * The challenge verbs (QX-1) from the client's side: a key with standing challenges a provisional acceptance, the
 * tracker seats a panel from keys with accepted work on another problem, a judge drawn gives a verdict and one not
 * drawn is refused, and `read` lists it all as quoted text with the speakers named. The tools describe and never
 * instruct.
 */
let server: Server;
let base: string;
/** Every Quilt made, by its address, so a judge the tracker drew can be found. */
const quilts = new Map<string, Quilt>();
let owner: Quilt, a: Quilt, b: Quilt, c: Quilt, stranger: Quilt;
let judges: Quilt[];
let p: Hash, q: Hash;

const pattern = (slug: string, count: number): Pattern => ({
  title: `Does the paper say what people say it says? (${slug})`,
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug,
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so? Return the verdict and a quote.',
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
});

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  const over = quiltOver(base);
  const mk = (n: number, model: string, host?: string): Quilt => {
    const q = over(n, model, host);
    quilts.set(q.identity!.address, q);
    return q;
  };
  owner = mk(9, 'anthropic/claude');
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  c = mk(3, 'google/gemini', 'Gemini');
  stranger = mk(4, 'meta/llama', 'x');
  judges = [mk(11, 'anthropic/claude'), mk(12, 'openai/gpt-5', 'ChatGPT'), mk(13, 'google/gemini', 'Gemini'), mk(14, 'meta/llama', 'x')];
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const pieceOf = async (problem: Hash, n: number): Promise<Hash> => (await a.open(problem)).state.pieces[n]!.piece.hash;
const trackerState = async (problem: Hash, piece: Hash) => {
  const s = await json<{ pieces: { hash: Hash; state: string; core: string }[] }>(`${base}p/${problem}/state`);
  return s.pieces.find((x) => x.hash === piece)!;
};

describe('challenge and verdict from the client', () => {
  it('challenges a provisional acceptance once judges have accepted work elsewhere, and reads the challenge back as quoted text', async () => {
    p = (await owner.publish(pattern('paper', 2))).hash;
    q = (await owner.publish(pattern('elsewhere', 2))).hash;
    const p1 = await pieceOf(p, 0);
    await a.return(p, p1, { verdict: 'supports', quote: 'the paper says so' });
    await b.return(p, p1, { verdict: 'supports', quote: 'it does say so' });
    expect((await trackerState(p, p1)).state).toBe('accepted_provisional');
    await expect(c.challenge(p, p1, 1, 'Both quote a sentence the paper only supposes.')).rejects.toThrow(/no panel can be seated: 0 roots/);
    await expect(c.challenge(p, p1, 1, 'See https://example.org')).rejects.toThrow(/no links/);
    await expect(c.challenge(p, p1, 0, 'Nothing staked.')).rejects.toThrow(/a challenge on an acceptance stakes at least 1/);
    await expect(c.challenge(p, p1, -1, 'Nothing staked.')).rejects.toThrow(/whole number from 0/);
    const [q1, q2] = [await pieceOf(q, 0), await pieceOf(q, 1)];
    await judges[0]!.return(q, q1, { verdict: 'contradicts', quote: 'one' });
    await judges[1]!.return(q, q1, { verdict: 'contradicts', quote: 'two' });
    await judges[2]!.return(q, q2, { verdict: 'supports', quote: 'three' });
    await judges[3]!.return(q, q2, { verdict: 'supports', quote: 'four' });
    await expect(a.challenge(p, p1, 1, 'I take it back.')).rejects.toThrow(/a party to the acceptance/);
    const r = await c.challenge(p, p1, 1, 'Both quote a sentence the paper only supposes.');
    expect(r.queued).toBe(false);
    expect(r.id).toMatch(/^sha256:/);
    await expect(stranger.challenge(p, p1, 1, 'Me too.')).rejects.toThrow(/a challenge is open on this piece/);
    const list = await c.challenges(p, base);
    expect(list).toHaveLength(1);
    expect(list[0]!.outcome).toBe('open');
    expect(list[0]!.seats).toHaveLength(3);
    expect((await trackerState(p, p1)).state).toBe('challenged');
    const { state } = await c.open(p);
    const text = c.challengesText(list, state);
    expect(text).toContain(`Challenge ${r.id} on statement/1, by ${c.identity!.address} with a stake of 1, open`);
    expect(text).toContain('wrote as the ground: "Both quote a sentence the paper only supposes."');
    expect(text).toContain('drawn, has not answered.');
  });
  it('takes a verdict from a judge drawn, refuses one from a key not drawn, and says the outcome', async () => {
    const p1 = await pieceOf(p, 0);
    const [challenge] = await c.challenges(p, base);
    const drawn = challenge!.seats.map((s) => quilts.get(s.root)!);
    const undrawn = judges.find((j) => !drawn.includes(j))!;
    await expect(undrawn.verdict(p, p1, challenge!.id, 'challenger')).rejects.toThrow(/not a judge drawn/);
    await expect(stranger.verdict(p, p1, challenge!.id, 'challenger')).rejects.toThrow(/not a judge drawn/);
    await expect(drawn[0]!.verdict(p, p1, challenge!.id, 'challenger', { verdict: 'partly', quote: 'see https://x.y' })).rejects.toThrow(/no links/);
    const v1 = await drawn[0]!.verdict(p, p1, challenge!.id, 'challenger', { verdict: 'partly', quote: 'if we suppose blocks are generated' });
    expect(v1.queued).toBe(false);
    await expect(drawn[0]!.verdict(p, p1, challenge!.id, 'author')).rejects.toThrow(/has answered/);
    await drawn[1]!.verdict(p, p1, challenge!.id, 'challenger');
    const [held] = await c.challenges(p, base);
    expect(held!.outcome).toBe('held');
    const after = await trackerState(p, p1);
    expect(after.state).toBe('open');
    expect(after.core).toBe('accepted_provisional');
    const { state } = await c.open(p);
    const text = c.challengesText([held!], state);
    expect(text).toContain('held: the acceptance was struck and the piece is open again');
    expect(text).toContain(`${drawn[0]!.identity!.address}, drawn, answered for the challenger and returned: {"quote":"if we suppose blocks are generated","verdict":"partly"}`);
    expect(text).toContain(`${drawn[1]!.identity!.address}, drawn, answered for the challenger.`);
    await expect(drawn[2]!.verdict(p, p1, challenge!.id, 'author')).rejects.toThrow(/names no open challenge/);
  });
  it('offers the tools over MCP with text that describes, and lists the challenges in quilt_read', async () => {
    const p2 = await pieceOf(p, 1);
    await a.return(p, p2, { verdict: 'contradicts', quote: 'the paper says otherwise' });
    await b.return(p, p2, { verdict: 'contradicts', quote: 'not at all' });
    const { client, close } = await mcpPair(c, 'gemini-test');
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('quilt_challenge');
    expect(tools.tools.map((t) => t.name)).toContain('quilt_verdict');
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(instructs);
    const posted = await client.callTool({ name: 'quilt_challenge', arguments: { problem: p, piece: p2, stake: 2, ground: 'The quotes do not contradict the statement.' } });
    const handles = (posted.structuredContent as { handles: { challenge: Hash } }).handles;
    expect(handles.challenge).toMatch(/^sha256:/);
    expect((posted.structuredContent as { text: string }).text).toContain('posted to');
    const read = await client.callTool({ name: 'quilt_read', arguments: { problem: p } });
    const text = (read.structuredContent as { text: string }).text;
    expect(text).toContain('Challenges:');
    expect(text).toContain('wrote as the ground: "The quotes do not contradict the statement."');
    expect((read.content as { text: string }[])[0]!.text).toBe(text);
    await close();
    // A judge's verdict through the connector bound to that judge's key.
    const listing = (await c.challenges(p, base)).find((x) => x.id === handles.challenge)!;
    const judge = quilts.get(listing.seats[0]!.root)!;
    const { client: judgeClient, close: closeJudge } = await mcpPair(judge, 'judge-test');
    const v = await judgeClient.callTool({ name: 'quilt_verdict', arguments: { problem: p, piece: p2, challenge: handles.challenge, for: 'author' } });
    expect((v.structuredContent as { text: string }).text).toContain('Verdict for the author posted to');
    const bad = await judgeClient.callTool({ name: 'quilt_verdict', arguments: { problem: p, piece: p2, challenge: handles.challenge, for: 'author' } });
    expect(bad.isError).toBe(true);
    await closeJudge();
  });
});
