import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type Hash } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { createMcpServer } from '../src/mcp.js';
import { localRunner } from '../src/tools.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/worker.js';

const hex = (n: number) => '00'.repeat(31) + n.toString(16).padStart(2, '0');
let server: Server;
let base: string;
let config: Config;
const homes = { owner: mkdtempSync(join(tmpdir(), 'quilt-owner-')), a: mkdtempSync(join(tmpdir(), 'quilt-a-')), b: mkdtempSync(join(tmpdir(), 'quilt-b-')) };
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
  const tracker = createTracker({ store: new Store(':memory:'), url: 'http://tracker.test/', ipSalt: 's' });
  server = await tracker.listen(0);
  const addr = server.address();
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/` : '';
  config = { ...DEFAULT_CONFIG, trackers: [base] };
  createKey(homes.owner, { secretHex: hex(9) });
  createKey(homes.a, { secretHex: hex(1) });
  createKey(homes.b, { secretHex: hex(2) });
  owner = new Quilt({ ...config, name: 'Maya' }, loadKey(homes.owner), new Resolver(config, homes.owner), 'Claude Code');
  a = new Quilt(config, loadKey(homes.a), new Resolver(config, homes.a), 'Claude Code');
  b = new Quilt({ ...config, model: 'openai/gpt-5' }, loadKey(homes.b), new Resolver(config, homes.b), 'ChatGPT');
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('Quilt against a tracker', () => {
  it('publishes a pattern as a signed envelope with its blobs, announces it, and names it', async () => {
    const r = await owner.publish(pattern);
    problem = r.hash;
    expect(r.posted).toEqual([base]);
    expect(r.refused).toEqual([]);
    expect(r.link).toMatch(/^quilt:sha256:/);
    const found = await a.search('ai-safety');
    expect(found.map((p) => p.problem)).toEqual([problem]);
    const named = await (await fetch(`${base}n/${owner.identity!.address}/report-2026`)).json();
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
    const { pick, posted, author } = await a.next(problem);
    expect(pick.piece.family).toBe('cite');
    expect(posted.queued).toBe(false);
    expect(a.pieceText(problem, pick, author)).toContain('wrote this brief: "Citation');
    const state = await (await fetch(`${base}p/${problem}/state`)).json();
    expect(state.pieces.find((p: { hash: string }) => p.hash === pick.piece.hash).state).toBe('in_flight');
  });
  it('hands a return back as a commit then a reveal, and a second vendor\'s return accepts the piece', async () => {
    const { state } = await a.open(problem);
    const piece = state.pieces.find((v) => v.state === 'in_flight')!.piece.hash;
    const r = await a.return(problem, piece, { verdict: 'supports', quote: 'the model was found to' });
    expect(r.commit.queued).toBe(false);
    expect(r.reveal.queued).toBe(false);
    let s = await (await fetch(`${base}p/${problem}/state`)).json();
    expect(s.pieces.find((p: { hash: string }) => p.hash === piece).state).toBe('needs_verify');
    await expect(a.return(problem, piece, { verdict: 'supports', quote: 'see https://x.y/z' })).rejects.toThrow(/no links/);
    const r2 = await b.return(problem, piece, { verdict: 'supports', quote: 'a different twenty words' });
    expect(r2.reveal.queued).toBe(false);
    s = await (await fetch(`${base}p/${problem}/state`)).json();
    expect(s.pieces.find((p: { hash: string }) => p.hash === piece).state).toBe('accepted_provisional');
    const opened = await b.open(problem);
    expect(b.acceptedText(opened.state)).toContain(`cite/`);
    expect(b.acceptedText(opened.state)).toContain('returned: {"quote":"a different twenty words","verdict":"supports"}');
  });
  it('queues events while no tracker answers and posts them when one does', async () => {
    let up = false;
    const flaky: typeof fetch = (input, init) => (up ? fetch(input, init) : Promise.reject(new Error('down')));
    const home = mkdtempSync(join(tmpdir(), 'quilt-q-'));
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
    const s = await (await fetch(`${base}p/${problem}/state`)).json();
    expect(s.pieces.find((p: { hash: string }) => p.hash === piece).state).toBe('needs_verify');
  });
});

describe('the connector over MCP', () => {
  it('lists tools whose text describes and never instructs, and answers with quoted text and handles', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMcpServer(localRunner(() => a));
    await server.connect(serverTransport);
    const client = new Client({ name: 'claude-test', version: '0.0.0' });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(['quilt_challenge', 'quilt_decline', 'quilt_me', 'quilt_name', 'quilt_next', 'quilt_open', 'quilt_publish', 'quilt_rank', 'quilt_read', 'quilt_return', 'quilt_search', 'quilt_seed', 'quilt_verdict']);
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(/\b(you must|always|never|do not|important|ignore)\b/i);
    const me = await client.callTool({ name: 'quilt_me', arguments: {} });
    expect((me.structuredContent as { text: string }).text).toContain(a.identity!.address);
    const opened = await client.callTool({ name: 'quilt_open', arguments: { link: problem } });
    const text = (opened.structuredContent as { text: string; handles: { problem: string } }).text;
    expect(text).toContain('titled it: "Does the report say what its sources say?"');
    expect((opened.structuredContent as { handles: { problem: string } }).handles.problem).toBe(problem);
    expect((opened.content as { text: string }[])[0]!.text).toBe(text);
    const read = await client.callTool({ name: 'quilt_read', arguments: { problem } });
    expect((read.structuredContent as { text: string }).text).toContain('Accepted so far:');
    await client.close();
    await server.close();
  });
});
