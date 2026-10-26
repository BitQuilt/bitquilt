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
import { localRunner, runTool } from '../src/tools.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/worker.js';

/**
 * Stake at the door (QX-15) from the client's side: an owner publishes a pattern with a stake and the tracker shows it on
 * every piece; a fresh key is handed nothing it cannot cover; a key with standing is handed a piece after a lock of that
 * much standing, posted before the claim in one step; quilt_me says what is locked and what is free; the owner changes
 * the rule later and nobody else can; the tools describe and never instruct.
 */
const hex = (n: number) => '00'.repeat(31) + n.toString(16).padStart(2, '0');
let server: Server;
let base: string;
let config: Config;
function mk(n: number, model: string, host = 'Claude Code'): Quilt {
  const home = mkdtempSync(join(tmpdir(), `quilt-stake-${n}-`));
  createKey(home, { secretHex: hex(n) });
  return new Quilt({ ...config, model }, loadKey(home), new Resolver(config, home), host);
}
let owner: Quilt, a: Quilt, b: Quilt, fresh: Quilt;
let p: Hash, q: Hash;

const pattern = (slug: string, count: number): Pattern => ({
  title: `Does the paper say what people say it says? (${slug})`,
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug,
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?',
      schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } },
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
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  fresh = mk(3, 'google/gemini', 'Gemini');
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

type StateView = { stake_rule: { min: number; pieces: string[] | null } | null; pieces: { hash: Hash; stake: number }[] };
const trackerState = async (problem: Hash) => (await (await fetch(`${base}p/${problem}/state`)).json()) as StateView;
const typesBy = async (problem: Hash, address: string) => (await (await fetch(`${base}p/${problem}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as { event: { type: string; key: string } }).filter((l) => l.event.key === address).map((l) => l.event.type);

describe('stake at the door, from the client', () => {
  it('publishes a pattern with a stake, which the tracker shows on every piece and the summary says', async () => {
    const r = await owner.publish({ ...pattern('staked', 2), stake: { min: 2 } });
    p = r.hash;
    expect(r.refused).toEqual([]);
    const s = await trackerState(p);
    expect(s.stake_rule).toEqual({ min: 2, pieces: null });
    expect(s.pieces.map((x) => x.stake)).toEqual([2, 2]);
    const opened = await a.open(p);
    expect(opened.layer?.map((l) => l.stake)).toEqual([2, 2]);
    expect(a.summary(p, opened.state, opened.tracker, opened.layer)).toContain('Stake asked (QX-15): 2 of the pieces ask 2 of a key\'s standing');
  });

  it('hands a fresh key nothing it cannot cover, and says why', async () => {
    await expect(fresh.next(p)).rejects.toThrow(/asks a stake this key's free standing cannot cover/);
    expect(await typesBy(p, fresh.identity!.address)).toEqual([]);
    const me = await runTool(fresh, 'quilt_me', {});
    expect(me.text).toContain(`Standing: 1 (locked 0, free 1) at ${base}`);
  });

  it('locks then claims for a key with standing, in one step, and quilt_me says what is locked', async () => {
    q = (await owner.publish(pattern('elsewhere', 1))).hash;
    const q1 = (await a.open(q)).state.pieces[0]!.piece.hash;
    await a.return(q, q1, { verdict: 'supports' });
    await b.return(q, q1, { verdict: 'supports' });
    expect(await a.standing()).toMatchObject({ tracker: base, standing: 2, locked: 0, free: 2, locks: [] });
    const r = await a.next(p);
    expect(r.stake).toBe(2);
    expect(r.posted.queued).toBe(false);
    expect(await typesBy(p, a.identity!.address)).toEqual(['lock', 'claim']);
    expect(a.pieceText(p, r.pick, 'the owner', r.stake)).toContain('It asks a stake of 2 (QX-15): that much of this key\'s standing is locked behind the claim');
    const s = await a.standing();
    expect(s).toMatchObject({ standing: 2, locked: 2, free: 0 });
    expect(s!.locks).toEqual([{ problem: p, piece: r.pick.piece.hash, amount: 2, at: expect.any(String) }]);
    const me = await runTool(a, 'quilt_me', {});
    expect(me.text).toContain(`Standing: 2 (locked 2, free 0) at ${base}; locks: 2 on ${r.pick.piece.hash} of ${p}`);
    // The other piece is beyond what is free now.
    await expect(a.next(p)).rejects.toThrow(/free standing cannot cover/);
    const next = await runTool(b, 'quilt_next', { problem: p });
    expect(next.text).toContain('after a lock of 2');
    expect(next.handles.stake).toBe(2);
  });

  it('lets the owner change the rule and nobody else, and the tools describe', async () => {
    await expect(a.stakeRule(p, 1)).rejects.toThrow(/the owner alone sets a stake rule/);
    await expect(owner.stakeRule(p, -1)).rejects.toThrow(/whole number/);
    await owner.stakeRule(p, 0);
    expect((await trackerState(p)).stake_rule).toEqual({ min: 0, pieces: null });
    await owner.stakeRule(p, 1, ['statement']);
    expect((await trackerState(p)).stake_rule).toEqual({ min: 1, pieces: ['statement'] });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcp = createMcpServer(localRunner(() => fresh));
    await mcp.connect(serverTransport);
    const client = new Client({ name: 'gemini-test', version: '0.0.0' });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(/\b(you must|always|never|do not|important|ignore)\b/i);
    const publish = tools.tools.find((t) => t.name === 'quilt_publish')!;
    expect(JSON.stringify(publish.inputSchema)).toContain('"stake"');
    const me = await client.callTool({ name: 'quilt_me', arguments: {} });
    expect((me.structuredContent as { text: string }).text).toContain('Standing: 1 (locked 0, free 1)');
    await client.close();
    await mcp.close();
  });
});
