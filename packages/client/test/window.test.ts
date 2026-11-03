import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type Hash } from '@bitquilt/core';
import { buildWindow } from '../../../scripts/build-window.mjs';
import { createMcpServer } from '../src/mcp.js';
import { say } from '../src/phrases.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { type Library, publicLibrary } from '../src/resolver.js';
import { localRunner } from '../src/tools.js';
import { WINDOW_HTML } from '../src/window.generated.js';
import { WINDOW_OPS, WINDOW_PHRASES, WINDOW_READ_OPS, WINDOW_URI, WINDOW_URI_NOW, windowAnswer } from '../src/window.js';
import { instructs, mcpPair, quiltOver, startTracker, tempHome } from './helpers.js';

/**
 * The directory window (APP.md, "The window"), held to rules 3 and 6: the connector serves it as an MCP app, one
 * document at a ui:// resource whose address carries its hash, named by the tools that show it and by no other; the
 * app-only reader behind it is hidden from the model by its visibility and answers each op as JSON text with nothing
 * in structuredContent; the model-visible tools' text passes the words' rule; the document loads nothing from another
 * server and its sources set text with textContent; the generated file matches its sources; and a run while away
 * offers neither the window nor its reader.
 */
let server: Server;
let base: string;
let owner: Quilt, a: Quilt, b: Quilt;
let problem: Hash;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?', done_when: 'Every statement has a verdict.', slug: 'paper-says', topics: ['reading'],
  pieces: { 'statement/*': { count: 3, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } }, agree: ['verdict'] } },
};

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  const mk = quiltOver(base);
  owner = mk(9, 'anthropic/claude');
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  problem = (await owner.publish(pattern)).hash;
  const piece = (await a.open(problem)).state.pieces[0]!.piece.hash;
  await b.return(problem, piece, { verdict: 'supports' });
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const text = (r: unknown): string => ((r as { content: { type: string; text: string }[] }).content[0]?.text ?? '');

describe('the directory window', () => {
  it('is built from its sources into the generated file the connector serves', async () => {
    expect(await buildWindow()).toBe(WINDOW_HTML);
    expect(WINDOW_URI_NOW).toBe(`ui://quilt/window.${createHash('sha256').update(WINDOW_HTML).digest('hex').slice(0, 10)}.html`);
    expect(WINDOW_HTML).toContain('<title>Quilt</title>');
    // Rule 6, as page.test.ts holds the page: nothing loaded from another server, and the sources set text and never markup.
    expect(WINDOW_HTML).not.toMatch(/<(script|link|img)[^>]+(src|href)=["']https?:/i);
    expect(WINDOW_HTML).not.toMatch(/\bhref=["']https?:/i);
    for (const f of ['window.ts', 'window.css']) {
      const source = readFileSync(join(root, 'packages', 'client', 'window', f), 'utf8');
      for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write']) expect(source).not.toContain(bad);
    }
  });

  it('names the card on the tools that show it and on no other, hides the reader from the model, and describes in every word', async () => {
    const { client, close } = await mcpPair(a);
    const tools = (await client.listTools()).tools;
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    const ui = (name: string) => (by[name]?._meta as { ui?: { resourceUri?: string; visibility?: string[] } } | undefined)?.ui;
    const card = ['quilt_window', 'quilt_search', 'quilt_open', 'quilt_read'];
    for (const name of card) expect(ui(name), name).toMatchObject({ resourceUri: WINDOW_URI_NOW });
    expect(ui('quilt_window_io')).toMatchObject({ resourceUri: WINDOW_URI_NOW, visibility: ['app'] });
    for (const t of tools) {
      // quilt_next holds a piece as a side effect, so the card is not on it: a card that could show it would take pieces by being drawn.
      if (![...card, 'quilt_window_io'].includes(t.name)) expect(ui(t.name), t.name).toBeUndefined();
      expect(t.description ?? '').not.toMatch(instructs);
    }
    const resources = (await client.listResources()).resources;
    expect(resources.map((r) => r.uri).sort()).toEqual([WINDOW_URI, WINDOW_URI_NOW].sort());
    for (const r of resources) expect(r.mimeType).toBe('text/html;profile=mcp-app');
    const doc = (await client.readResource({ uri: WINDOW_URI_NOW })).contents[0] as { mimeType: string; text: string; _meta?: unknown };
    expect(doc).toMatchObject({ mimeType: 'text/html;profile=mcp-app', text: WINDOW_HTML });
    expect((await client.readResource({ uri: WINDOW_URI })).contents[0]).toMatchObject({ uri: WINDOW_URI, text: WINDOW_HTML });
    await close();
  });

  it('answers quilt_window with who this client is as text and a handle, the same text in both places', async () => {
    const { client, close } = await mcpPair(a);
    const r = await client.callTool({ name: 'quilt_window', arguments: {} });
    const sc = r.structuredContent as { text: string; handles: { window: { address: string; name: string | null; trackers: string[]; host: string | null; view: string; query: string | null; link: string | null } } };
    expect(text(r)).toBe(sc.text);
    expect(sc.text).toContain(a.identity!.address);
    expect(sc.text).not.toMatch(instructs);
    expect(sc.handles.window).toMatchObject({ address: a.identity!.address, trackers: [base], view: 'search', query: null, link: null });
    const asked = await client.callTool({ name: 'quilt_window', arguments: { query: 'paper' } });
    expect((asked.structuredContent as { handles: { window: { query: string } } }).handles.window.query).toBe('paper');
    // The search's handles carry the query, so the card shown beside it opens on the same search.
    const searched = await client.callTool({ name: 'quilt_search', arguments: { query: 'paper' } });
    expect((searched.structuredContent as { handles: { problems: string[]; query: string } }).handles).toMatchObject({ problems: [problem], query: 'paper' });
    await close();
  });

  it('reads for the card: a search with a link on every row, who this client is with the phrases its buttons send, and the swarm\'s totals counted once per problem, as JSON text and nothing else', async () => {
    const { client, close } = await mcpPair(a);
    const io = async (op: string, more: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name: 'quilt_window_io', arguments: { op, ...more } });
      expect(r.structuredContent).toBeUndefined();
      expect(r.isError ?? false).toBe(false);
      return JSON.parse(text(r)) as Record<string, unknown>;
    };
    const found = await io('search', { query: 'paper' });
    const rows = found.rows as { problem: string; title: string; owner: string; pieces: number; counts: Record<string, number>; link: string; via: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ problem, title: pattern.title, owner: owner.identity!.address, pieces: 3, counts: { open: 2, needs_verify: 1 }, via: 'tracker' });
    expect(rows[0]!.link).toMatch(/^quilt:sha256:/);
    expect(rows[0]!.link).toContain(`dn=${pattern.slug}`);
    expect(JSON.stringify(found)).not.toContain('brief');
    const me = await io('me');
    expect(me).toMatchObject({ address: a.identity!.address, model: 'anthropic/claude', trackers: [base], problems: 1 });
    expect((me.standing as { standing: number }).standing).toBe(1);
    const phrases = me.phrases as Record<string, string>;
    expect(Object.keys(phrases).sort()).toEqual([...WINDOW_PHRASES].sort());
    for (const name of WINDOW_PHRASES) {
      expect(phrases[name]).toBe(say(name, { link: '{link}' }));
      expect(phrases[name]).not.toMatch(instructs);
    }
    expect(phrases.take_piece).toBe('Open {link} on Quilt and take a piece.');
    // The phrases alone, for the card on a site: the same templates, with no person around them.
    expect(await io('phrases')).toEqual({ op: 'phrases', phrases });
    const totals = await io('totals');
    expect(totals).toEqual({ op: 'totals', problems: 1, pieces: 3, counts: { open: 2, needs_verify: 1 }, trackers: [{ tracker: base, problems: 1 }] });
    // The same door under two names, as two doors folding each other look to a client that names both: each problem is counted once, by hash, and each place says what it lists.
    const alias = base.replace('127.0.0.1', 'localhost');
    const both = quiltOver(base, { trackers: [base, alias] })(3);
    expect(await windowAnswer(both, { op: 'totals' })).toEqual({ op: 'totals', problems: 1, pieces: 3, counts: { open: 2, needs_verify: 1 }, trackers: [{ tracker: base, problems: 1 }, { tracker: alias, problems: 1 }] });
    // The problem's map as the tracker's layer holds it, each piece with its kind, grade and readers, and no brief.
    const opened = await io('open', { link: problem });
    expect(opened).toMatchObject({ problem, title: pattern.title, done_when: pattern.done_when, slug: pattern.slug, owner: owner.identity!.address, owner_name: null, tracker: base, complete: false, seeders: 0, seeding: false, readers: 1, vendors: ['openai'] });
    const pieces = opened.pieces as { name: string; state: string; core: string; kind: string; strength: string; reveals: number; traced: string | null; seams: number }[];
    expect(pieces.map((x) => [x.name, x.state, x.reveals])).toEqual([['statement/1', 'needs_verify', 1], ['statement/2', 'open', 0], ['statement/3', 'open', 0]]);
    expect(pieces[0]).toMatchObject({ kind: 'agree', strength: 'agreed', traced: null, seams: 0 });
    expect(JSON.stringify(opened)).not.toContain('does the paper say so');
    expect((opened.link as string).startsWith('quilt:sha256:')).toBe(true);
    // The library: names and counts, what the node serves, and no gold answer in it.
    const lib = await io('library');
    expect(Object.keys(lib.problems as object)).toEqual([problem]);
    expect((lib.problems as Record<string, { link: string; title: string }>)[problem]).toMatchObject({ title: pattern.title });
    expect((lib.serving as { problems: number }).problems).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(lib)).not.toMatch(/projection|nonce/);
    // The hot list: a key followed, with its standing, kept in this home's library alone, and dropped again.
    expect(await io('hot')).toEqual({ op: 'hot', keys: [] });
    const followed = await io('follow', { key: owner.identity!.address, on: true, name: 'the owner' });
    const keys = followed.keys as { key: string; name: string; standing: number | null; since: string }[];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ key: owner.identity!.address, name: 'the owner' });
    expect(typeof keys[0]!.standing).toBe('number');
    expect(a.library.follows).toEqual({ [owner.identity!.address]: { name: 'the owner', since: keys[0]!.since } });
    expect(((await io('follow', { key: owner.identity!.address, on: false })).keys as unknown[])).toEqual([]);
    const refused = await client.callTool({ name: 'quilt_window_io', arguments: { op: 'follow', key: 'not-an-address', on: true } });
    expect(refused.isError).toBe(true);
    expect(WINDOW_OPS).toEqual(['search', 'open', 'library', 'hot', 'follow', 'me', 'totals', 'phrases']);
    expect(WINDOW_READ_OPS).toEqual(['search', 'open', 'totals', 'phrases']);
    await close();
  });

  it('shows the library to the page as names and counts, with the gold\'s answers left in the home', () => {
    const library: Library = { problems: {}, pieces: {}, seeding: {}, gold: { 'sha256:p': { 'sha256:a': { name: 'x/1', projection: { v: 1 }, nonce: 'n', revealed: '2026-11-02T00:00:00Z' }, 'sha256:b': { name: 'x/2', projection: { v: 2 }, nonce: 'm' } } } };
    const shown = publicLibrary(library, { problems: 2, ledgers: 1, blobs: 0, bytes: 10 });
    expect(shown.gold).toEqual({ 'sha256:p': { committed: 2, revealed: 1 } });
    expect(shown.serving).toEqual({ problems: 2, ledgers: 1, blobs: 0, bytes: 10 });
    expect(JSON.stringify(shown)).not.toMatch(/projection|nonce/);
    expect(a.resolver.serving().problems).toBeGreaterThanOrEqual(1);
  });

  it('offers neither the window nor its reader, and no resource, to a run while away', async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const away = createMcpServer(localRunner(() => a), { away: join(tempHome('quilt-window-away-'), 'away.json') });
    await away.connect(serverTransport);
    const client = new Client({ name: 'away-test', version: '0.0.0' });
    await client.connect(clientTransport);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('quilt_search');
    expect(names).not.toContain('quilt_window');
    expect(names).not.toContain('quilt_window_io');
    expect(await client.listResources().then((r) => r.resources.length, () => 0)).toBe(0);
    await client.close();
    await away.close();
  });
});
