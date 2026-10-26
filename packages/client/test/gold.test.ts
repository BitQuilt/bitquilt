import { mkdtempSync, readFileSync } from 'node:fs';
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
import { localRunner, runTool } from '../src/tools.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/worker.js';

/**
 * Gold pieces (QX-16) from the client's side: an owner publishes with the answers to some pieces, which leave the home
 * only as hashes while the projections and nonces stay in the library; attention lists a reveal due once a piece is
 * accepted; the reveal through the tool marks the square verified, or strikes the set on a miss and says so; the
 * summary counts the gold; the tools describe and never instruct.
 */
const hex = (n: number) => '00'.repeat(31) + n.toString(16).padStart(2, '0');
let server: Server;
let base: string;
let config: Config;
const homes = new Map<number, string>();
function mk(n: number, model: string, host = 'Claude Code'): Quilt {
  const home = mkdtempSync(join(tmpdir(), `quilt-gold-${n}-`));
  homes.set(n, home);
  createKey(home, { secretHex: hex(n) });
  return new Quilt({ ...config, model }, loadKey(home), new Resolver(config, home), host);
}
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
  const tracker = createTracker({ store: new Store(':memory:'), url: 'http://tracker.test/', ipSalt: 's', limits: { keyPerHour: 1000, ipPerHour: 10000 } });
  server = await tracker.listen(0);
  const addr = server.address();
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/` : '';
  config = { ...DEFAULT_CONFIG, trackers: [base] };
  owner = mk(9, 'anthropic/claude');
  other = mk(8, 'anthropic/claude');
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

type StateView = { pieces: { hash: Hash; state: string; gold: string | null; verified: boolean }[] };
const trackerState = async (problem: Hash) => (await (await fetch(`${base}p/${problem}/state`)).json()) as StateView;
const pieceOf = async (problem: Hash, n: number): Promise<Hash> => (await a.open(problem)).state.pieces[n]!.piece.hash;

describe('gold pieces, from the client', () => {
  it('publishes with gold: the commitments on the ledger, the answers only in the library, every piece pending, the stake locked', async () => {
    // The owner earns standing on another owner's problem first: a gold's stake is the owner's standing.
    q = (await other.publish(pattern('elsewhere', 1))).hash;
    const q1 = await pieceOf(q, 0);
    await owner.return(q, q1, { verdict: 'supports', quote: 'it says so' });
    await b.return(q, q1, { verdict: 'supports', quote: 'indeed' });
    expect(await owner.standing()).toMatchObject({ standing: 2, free: 2 });
    const r = await owner.publish({ ...pattern('golden', 2), gold: { answers: { 'statement/1': { verdict: 'supports', quote: 'the quote is not committed' }, 'statement/2': { verdict: 'contradicts', quote: 'nor this one' } } } });
    p = r.hash;
    expect(r.refused).toEqual([]);
    expect(r.gold).toEqual({ pieces: 2, stake: 2 });
    const lib = JSON.parse(readFileSync(join(homes.get(9)!, 'library.json'), 'utf8')) as { gold: Record<string, Record<string, { name: string; projection: Record<string, unknown>; nonce: string }>> };
    const kept = Object.values(lib.gold[p]!);
    expect(kept.map((k) => k.name).sort()).toEqual(['statement/1', 'statement/2']);
    expect(kept.find((k) => k.name === 'statement/1')!.projection).toEqual({ verdict: 'supports' });
    expect(kept.every((k) => /^[0-9a-f]{32}$/.test(k.nonce))).toBe(true);
    const events = await (await fetch(`${base}p/${p}/events`)).text();
    expect(events).toContain('"type":"gold"');
    expect(events).not.toContain('contradicts');
    const s = await trackerState(p);
    expect(s.pieces.map((x) => x.gold)).toEqual(['pending', 'pending']);
    expect(await owner.standing()).toMatchObject({ standing: 2, locked: 2, free: 0 });
    const opened = await a.open(p);
    expect(a.summary(p, opened.state, opened.tracker, opened.layer)).toContain('Gold (QX-16): 2 of the pieces have an answer the owner committed to before the work; 0 verified, 0 missed, 2 awaiting the owner\'s reveal.');
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
    const r = (await other.publish(pattern('later', 2))).hash;
    const r1 = await pieceOf(r, 0);
    const committed = await other.commitGold(r, { 'statement/1': { verdict: 'supports', quote: 'kept at home' } });
    expect(committed).toEqual({ pieces: 1, stake: 1 });
    expect((await trackerState(r)).pieces.map((x) => x.gold)).toEqual(['pending', null]);
    const lib = JSON.parse(readFileSync(join(homes.get(8)!, 'library.json'), 'utf8')) as { gold: Record<string, Record<string, { name: string }>> };
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
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcp = createMcpServer(localRunner(() => owner));
    await mcp.connect(serverTransport);
    const client = new Client({ name: 'claude-test', version: '0.0.0' });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('quilt_reveal_gold');
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(/\b(you must|always|never|do not|important|ignore)\b/i);
    expect(JSON.stringify(tools.tools.find((t) => t.name === 'quilt_publish')!.inputSchema)).toContain('"gold"');
    await client.close();
    await mcp.close();
  });
});
