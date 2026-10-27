import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { hex, instructs, json, mcpPair, quiltOver, startTracker, tempHome } from './helpers.js';

/**
 * The whole of BitQuilt from the client's side, against one tracker: an owner publishes a pattern as a signed envelope
 * with its blobs and announces it; another key opens it, is handed the rarest piece with the author's brief quoted,
 * and hands a return back as a commit then a reveal, which a second vendor's return accepts; events written while no
 * tracker answers wait in the queue and go out when one does; and the connector over MCP lists tools whose text
 * describes, and answers with quoted text and handles.
 */
let server: Server;
let base: string;
let config: Config;
let owner: Quilt, a: Quilt, b: Quilt;
let problem: Hash;

const pattern: Pattern = {
  title: 'Does the report say what its sources say?',
  done_when: 'Every citation has a verdict with a quote.',
  slug: 'report-2026',
  topics: ['citations', 'ai-safety'],
  settings: { endgame_at: 1 },
  pieces: {
    'cite/*': {
      count: 3, verifier: 'agree', requires: ['web'], brief: 'Citation {n}: {cite.sentence} Return the verdict and a quote.',
      data: { cite: 'cites' },
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
  data: { cites: [{ sentence: 'Evaluations underestimate capabilities.' }, { sentence: 'Models generalise across languages.' }, { sentence: 'Training data is mostly English.' }] },
};

beforeAll(async () => {
  ({ server, base } = await startTracker());
  config = { ...DEFAULT_CONFIG, trackers: [base] };
  const mk = quiltOver(base);
  owner = quiltOver(base, { name: 'Maya' })(9);
  a = mk(1);
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** A piece's state as the tracker's layer shows it. */
const trackerState = async (piece: string) => (await json<{ pieces: { hash: string; state: string }[] }>(`${base}p/${problem}/state`)).pieces.find((p) => p.hash === piece)!.state;

describe('Quilt against a tracker', () => {
  it('publishes a pattern as a signed envelope with its blobs, announces it, and names it', async () => {
    const r = await owner.publish(pattern);
    problem = r.hash;
    expect(r.posted).toEqual([base]);
    expect(r.refused).toEqual([]);
    expect(r.link).toMatch(/^quilt:sha256:/);
    const found = await a.search('ai-safety');
    expect(found.map((p) => p.problem)).toEqual([problem]);
    const named = await json<{ hash: string }>(`${base}n/${owner.identity!.address}/report-2026`);
    expect(named.hash).toBe(problem);
  });
  it('opens the problem and says it as the owner\'s quoted words with the map', async () => {
    const { hash, state, tracker } = await a.open(problem);
    expect(hash).toBe(problem);
    expect(tracker).toBe(base);
    expect(state.pieces.map((v) => v.state)).toEqual(['open', 'open', 'open']);
    const text = a.summary(hash, state, tracker);
    expect(text).toContain('titled it: "Does the report say what its sources say?"');
    expect(text).toContain('...\n3 open');
  });
  it('is handed the rarest piece with the author\'s brief quoted, and claims it', async () => {
    const { pick, posted, owner: by } = await a.next(problem);
    expect(pick.piece.family).toBe('cite');
    expect(posted.queued).toBe(false);
    expect(a.pieceText(problem, pick, by)).toContain('wrote this brief: "Citation');
    expect(await trackerState(pick.piece.hash)).toBe('in_flight');
  });
  it('hands a return back as a commit then a reveal, and a second vendor\'s return accepts the piece', async () => {
    const { state } = await a.open(problem);
    const piece = state.pieces.find((v) => v.state === 'in_flight')!.piece.hash;
    const r = await a.return(problem, piece, { verdict: 'supports', quote: 'the model was found to' });
    expect(r.commit.queued).toBe(false);
    expect(r.reveal.queued).toBe(false);
    expect(await trackerState(piece)).toBe('needs_verify');
    await expect(a.return(problem, piece, { verdict: 'supports', quote: 'see https://x.y/z' })).rejects.toThrow(/no links/);
    const r2 = await b.return(problem, piece, { verdict: 'supports', quote: 'a different twenty words' });
    expect(r2.reveal.queued).toBe(false);
    expect(await trackerState(piece)).toBe('accepted_provisional');
    const opened = await b.open(problem);
    expect(b.acceptedText(opened.state)).toContain(`cite/`);
    expect(b.acceptedText(opened.state)).toContain('returned: {"quote":"a different twenty words","verdict":"supports"}');
  });
  it('queues events while no tracker answers and posts them when one does', async () => {
    let up = false;
    const flaky: typeof fetch = (input, init) => (up ? fetch(input, init) : Promise.reject(new Error('down')));
    const home = tempHome('quilt-q-');
    createKey(home, { secretHex: hex(3) });
    const c = new Quilt({ ...config, model: 'google/gemini' }, loadKey(home), new Resolver(config, home, flaky), 'x');
    const { state } = await a.open(problem);
    const piece = state.pieces.find((v) => v.state === 'open')!.piece.hash;
    const r = await c.return(problem, piece, { verdict: 'contradicts', quote: 'nothing of the kind' });
    expect(r.commit.queued).toBe(true);
    expect(r.reveal.queued).toBe(true);
    expect(c.resolver.queued()).toBe(2);
    up = true;
    expect(await c.resolver.flush()).toEqual({ sent: 2, left: 0 });
    expect(await trackerState(piece)).toBe('needs_verify');
  });
});

describe('the connector over MCP', () => {
  it('lists tools whose text describes and never instructs, and answers with quoted text and handles', async () => {
    const { client, close } = await mcpPair(a);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['quilt_challenge', 'quilt_decline', 'quilt_me', 'quilt_name', 'quilt_next', 'quilt_open', 'quilt_pay', 'quilt_publish', 'quilt_rank', 'quilt_read', 'quilt_redeem', 'quilt_return', 'quilt_reveal_gold', 'quilt_search', 'quilt_seed', 'quilt_transfer', 'quilt_verdict']);
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(instructs);
    const me = await client.callTool({ name: 'quilt_me', arguments: {} });
    expect((me.structuredContent as { text: string }).text).toContain(a.identity!.address);
    const opened = await client.callTool({ name: 'quilt_open', arguments: { link: problem } });
    const text = (opened.structuredContent as { text: string; handles: { problem: string } }).text;
    expect(text).toContain('titled it: "Does the report say what its sources say?"');
    expect((opened.structuredContent as { handles: { problem: string } }).handles.problem).toBe(problem);
    expect((opened.content as { text: string }[])[0]!.text).toBe(text);
    const read = await client.callTool({ name: 'quilt_read', arguments: { problem } });
    expect((read.structuredContent as { text: string }).text).toContain('Accepted so far:');
    await close();
  });
});
