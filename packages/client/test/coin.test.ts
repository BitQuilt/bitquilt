import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type Hash, addressOf } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { createMcpServer } from '../src/mcp.js';
import { localRunner, runTool } from '../src/tools.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/worker.js';

/**
 * The coin (QX-17) from the client's side: a key that earned coin from verified squares sees it in quilt_me once the
 * epoch has ended; a pay is escrowed through the tool from coin that has not vested; a transfer and a redeem go through
 * the tools once it has; a key whose free
 * standing cannot cover a stake locks coin on the coin log instead, in one step with the claim; the tools describe and
 * never instruct.
 */
const hex = (n: number) => '00'.repeat(31) + n.toString(16).padStart(2, '0');
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
let server: Server;
let base: string;
let config: Config;
function mk(n: number, model: string, host = 'Claude Code'): Quilt {
  const home = mkdtempSync(join(tmpdir(), `quilt-coin-${n}-`));
  createKey(home, { secretHex: hex(n) });
  return new Quilt({ ...config, model }, loadKey(home), new Resolver(config, home), host);
}
let owner: Quilt, other: Quilt, a: Quilt, b: Quilt;
let p: Hash, q: Hash, r: Hash;

const T0 = '2026-10-27T00:00:00.000Z';
const HOUR = 3_600_000;
let tick = Date.parse(T0) + HOUR;
const coin = {
  genesis: T0, epoch_h: 24, emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 }, vesting_h: 48, infra_bp: 1000, treasury: addressOf(key(7)), unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 }, burn_rate: 50, transfers_from: T0, redeem_from: T0,
};

const pattern = (slug: string, count: number): Pattern => ({
  title: `Does the paper say what people say it says? (${slug})`,
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug,
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?',
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
});

beforeAll(async () => {
  // The tracker's clock is the test's: receipts are stamped with it, and the epoch ends when the test says.
  const tracker = createTracker({ store: new Store(':memory:'), url: 'http://tracker.test/', ipSalt: 's', limits: { keyPerHour: 1000, ipPerHour: 10000 }, now: () => new Date((tick += 1000)).toISOString(), coin });
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

const pieceOf = async (problem: Hash, n: number): Promise<Hash> => (await a.open(problem)).state.pieces[n]!.piece.hash;
const eventsBy = async (problem: Hash, address: string) => (await (await fetch(`${base}p/${problem}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as { event: { type: string; key: string; body: Record<string, unknown> } }).filter((l) => l.event.key === address).map((l) => l.event);

describe('the coin, from the client', () => {
  it('shows coin in quilt_me once an epoch has minted it to the verified squares', async () => {
    // Four points of standing for two gold pieces where no stake rule applies: two a piece, one for each root a miss would dock.
    q = (await other.publish(pattern('elsewhere', 3))).hash;
    for (let i = 0; i < 3; i++) {
      const qi = await pieceOf(q, i);
      await owner.return(q, qi, { verdict: 'supports', quote: 'x' });
      await b.return(q, qi, { verdict: 'supports', quote: 'y' });
    }
    p = (await owner.publish({ ...pattern('golden', 2), gold: { answers: { 'statement/1': { verdict: 'supports', quote: '' }, 'statement/2': { verdict: 'supports', quote: '' } } } })).hash;
    const [p1, p2] = [await pieceOf(p, 0), await pieceOf(p, 1)];
    for (const piece of [p1, p2]) {
      await a.return(p, piece, { verdict: 'supports', quote: 'as read' });
      await b.return(p, piece, { verdict: 'supports', quote: 'as read too' });
      expect((await owner.revealGold(p, piece)).outcome).toBe('match');
    }
    expect((await runTool(a, 'quilt_me', {})).text).toContain('Coin (QX-17): 0 units');
    tick = Date.parse(T0) + 24 * HOUR;
    const me = await runTool(a, 'quilt_me', {});
    expect(me.text).toContain(`Coin (QX-17): 450 units (vested 0, locked 0, escrowed 0, free 450) at ${base}`);
    expect(await a.coin()).toMatchObject({ home: base, balance: 450, free: 450 });
  });

  it('escrows a pay from coin that has not vested yet, through the tool', async () => {
    await expect(a.pay(q, 500, 10)).rejects.toThrow(/free coin 450 is below the pay of 500/);
    const paid = await runTool(a, 'quilt_pay', { problem: q, amount: 100, per_square: 10 });
    expect(paid.text).toContain(`Escrowed 100 units to ${q} at 10 a square; posted to the coin log at ${base}`);
    expect(await a.coin()).toMatchObject({ balance: 450, vested: 0, escrowed: 100, free: 350 });
    await expect(a.pay(q, 0, 10)).rejects.toThrow(/whole amount/);
  });

  it('moves vested coin to an address and takes it off the ledger, through the tools', async () => {
    await expect(a.transfer(b.identity!.address, 50)).rejects.toThrow(/free vested coin 0 is below the transfer of 50/);
    tick = Date.parse(T0) + 72 * HOUR;
    const moved = await runTool(a, 'quilt_transfer', { to: b.identity!.address, amount: 50 });
    expect(moved.text).toContain(`Transferred 50 units to ${b.identity!.address}; posted to the coin log at ${base}`);
    // The escrow on the finished problem came back when its last window closed, before the transfer.
    expect(await a.coin()).toMatchObject({ balance: 400, vested: 400, escrowed: 0, free: 400 });
    expect(await b.coin()).toMatchObject({ balance: 500 });
    await expect(a.transfer(b.identity!.address, 0)).rejects.toThrow(/whole number of units/);
    const out = await runTool(a, 'quilt_redeem', { amount: 20 });
    expect(out.text).toContain(`Redeem of 20 units posted to the coin log at ${base}`);
    expect(await a.coin()).toMatchObject({ balance: 380, free: 380 });
    const r = (await (await fetch(`${base}coin/redeems`)).json()) as { redeems: { root: string; to: string; amount: number }[] };
    expect(r.redeems).toEqual([expect.objectContaining({ root: a.identity!.address, to: a.identity!.address, amount: 20 })]);
  });

  it('locks coin in place of standing when the standing is short, in one step with the claim', async () => {
    r = (await owner.publish({ ...pattern('staked', 1), stake: { min: 4 } })).hash;
    // A has three points of standing and none locked; four are asked. Free coin: 380 units, and a point costs 50 at this door.
    expect(await a.standing()).toMatchObject({ standing: 3, locked: 0, free: 3 });
    const handed = await a.next(r);
    expect(handed.stake).toBe(4);
    expect(handed.lock).toBe('coin');
    expect(handed.posted.queued).toBe(false);
    const mine = await eventsBy(r, a.identity!.address);
    expect(mine.map((e) => e.type)).toEqual(['lock', 'claim']);
    expect(mine[0]!.body).toMatchObject({ kind: 'coin', amount: 4 });
    expect(await a.coin()).toMatchObject({ locked: 200, free: 180 });
    expect(await a.standing()).toMatchObject({ locked: 0, free: 3 });
    const text = (await runTool(b, 'quilt_me', {})).text;
    expect(text).toContain('Coin (QX-17): 500 units');
  });

  it('offers the tools over MCP with text that describes', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcp = createMcpServer(localRunner(() => a));
    await mcp.connect(serverTransport);
    const client = new Client({ name: 'claude-test', version: '0.0.0' });
    await client.connect(clientTransport);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['quilt_pay', 'quilt_transfer', 'quilt_redeem']));
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(/\b(you must|always|never|do not|important|ignore)\b/i);
    const me = await client.callTool({ name: 'quilt_me', arguments: {} });
    expect((me.structuredContent as { text: string }).text).toContain('Coin (QX-17):');
    await client.close();
    await mcp.close();
  });
});
