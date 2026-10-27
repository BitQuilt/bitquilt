import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type Receipt, addressOf, secretFromHex } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { DEFAULT_CONFIG, Quilt, Resolver, createKey, loadKey, type Pattern } from 'quilt';
import { createHosted } from '../src/hosted.js';

/**
 * The hosted on-ramp beside a tracker: an address handed out with a key the tracker holds, the join page served; the
 * connector served at that address over MCP, declaring the host and marking custody on every event it posts; the key
 * taken home by its address, and a session from one address refused at another.
 */
let server: Server;
let base: string;
let problem: string;
const custodySecret = randomBytes(16).toString('hex');
const store = new Store(':memory:');

beforeAll(async () => {
  const hosted = createHosted({ store, trackerUrl: () => base, keySecret: 'test-secret', home: mkdtempSync(join(tmpdir(), 'hosted-')), custodySecret });
  const tracker = createTracker({ store, url: 'http://t.test/', ipSalt: 's', custodySecret, extra: hosted.routes });
  server = await tracker.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '';
  const ownerHome = mkdtempSync(join(tmpdir(), 'owner-'));
  createKey(ownerHome, { secretHex: '00'.repeat(31) + '09' });
  const config = { ...DEFAULT_CONFIG, trackers: [base] };
  const owner = new Quilt(config, loadKey(ownerHome), new Resolver(config, ownerHome), 'Claude Code');
  const pattern: Pattern = { title: 'Hosted', done_when: 'Done.', slug: 'hosted', pieces: { 'cite/*': { count: 2, verifier: 'agree', requires: ['web'], brief: 'Citation {n}: {cite.s}', data: { cite: 'cites' }, schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } } } }, data: { cites: [{ s: 'one' }, { s: 'two' }] } };
  problem = (await owner.publish(pattern)).hash;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the hosted on-ramp', () => {
  let url: string;
  let address: string;
  it('hands out an address with a key it holds', async () => {
    const r = await fetch(`${base}join`, { method: 'POST' });
    expect(r.status).toBe(201);
    const j = (await r.json()) as { address: string; url: string };
    address = j.address;
    url = j.url;
    expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(url).toMatch(/\/mcp\/[0-9a-f]{64}$/);
    expect((await fetch(`${base}join`)).headers.get('content-type')).toMatch(/text\/html/);
    expect((await fetch(`${base}mcp/${'0'.repeat(64)}`, { method: 'POST', body: '{}' })).status).toBe(404);
  });
  it('serves the connector at that address over MCP, declaring the host and marking custody on every event', async () => {
    const client = new Client({ name: 'claude-ai', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('quilt_next');
    const me = await client.callTool({ name: 'quilt_me', arguments: {} });
    const meText = (me.structuredContent as { text: string }).text;
    expect(meText).toContain(`Address: ${address}`);
    expect(meText).toContain('Declares: anthropic/claude-ai');
    const next = await client.callTool({ name: 'quilt_next', arguments: { problem } });
    const handles = (next.structuredContent as { handles: { piece: string; problem: string } }).handles;
    expect(handles.problem).toBe(problem);
    const ret = await client.callTool({ name: 'quilt_return', arguments: { problem, piece: handles.piece, return: { verdict: 'supports' } } });
    expect((ret.structuredContent as { text: string }).text).toContain('posted to');
    const lines = (await (await fetch(`${base}p/${problem}/events`)).text()).trim().split('\n').map((l) => JSON.parse(l) as Receipt);
    const mine = lines.filter((l) => l.event.key === address);
    expect(mine.map((l) => l.event.type)).toEqual(['claim', 'commit', 'reveal']);
    expect(mine.every((l) => l.received[0]!.custody === 'hosted' && l.received[0]!.seat === 'ai')).toBe(true);
    await client.close();
  });
  it('lets the person take the key home, and refuses a session from another address', async () => {
    const k = (await (await fetch(`${url}/key`)).json()) as { address: string; secret: string };
    expect(k.address).toBe(address);
    expect(addressOf(secretFromHex(k.secret))).toBe(address);
    const other = (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { url: string };
    const otherUrl = other.url;
    const client = new Client({ name: 'claude-ai', version: '1.0' });
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);
    const sid = transport.sessionId!;
    const r = await fetch(otherUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'mcp-session-id': sid, accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }) });
    expect(r.status).toBe(403);
    await client.close();
  });
});
