import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type Hash, type Receipt, addressOf, secretFromHex } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import {
  AWAY_LOG,
  DEFAULT_CONFIG,
  Quilt,
  Resolver,
  WINDOW_URI_NOW,
  createKey,
  loadKey,
  makeLink,
  type Pattern,
  type SentenceAsk,
} from 'quilt';
import { type Hosted, createHosted } from '../src/hosted.js';
import { answerText, sentenceVendor, vendorSentence } from '../src/sentence.js';

/**
 * The hosted on-ramp beside a tracker: an address handed out with a key the tracker holds, the join page served; the
 * connector served at that address over MCP, declaring the host and marking custody on every event it posts; the key
 * taken home by its address, and a session from one address refused at another; a post to another tracker a link
 * names carries neither the custody secret nor the witness, and where the connector is shared a link that names a
 * private address reaches nothing, for a member or the site's reader; the sheet a browser gets at the same address,
 * with its data beside it; the page of a square, which says what the version its address names recorded, or the
 * earlier version that holds a piece the later one keeps only from it, what each reading rests on (QX-19), read from
 * the same chain as the readings, and where the piece stands after the owner replaced it. And the owners' turn
 * (QX-19 section 4, QX-16): the on-ramp sharpens a hosted owner's brief where two grounded readings read it apart,
 * with the sentence from the vendor its environment names, and passes over a member with nothing to do.
 */
let server: Server;
let base: string;
let problem: string;
let hosted: Hosted;
let pages: Server;
let site: string;
const hostedHome = mkdtempSync(join(tmpdir(), 'hosted-'));
const custodySecret = randomBytes(16).toString('hex');
const store = new Store(':memory:');
const PAGE =
  '<!doctype html><html><body><p>The paper says the effect holds in every trial.</p><p>A later section says it does not hold at scale.</p></body></html>';
const HOLDS = 'the effect holds in every trial';
const NOT_AT_SCALE = 'it does not hold at scale';
const asked: SentenceAsk[] = [];

beforeAll(async () => {
  pages = createServer((req, res) => {
    res.writeHead(req.url === '/paper' ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/paper' ? PAGE : 'no');
  });
  await new Promise<void>((r) => pages.listen(0, '127.0.0.1', () => r()));
  site = `http://127.0.0.1:${(pages.address() as AddressInfo).port}`;
  // A relay nothing listens on: the members' Quilts know it (QX-14) and a search's ask of it fails at once.
  hosted = createHosted({
    store,
    trackerUrl: () => base,
    keySecret: 'test-secret',
    home: hostedHome,
    custodySecret,
    relays: ['ws://127.0.0.1:1'],
    sentence: async (q) => {
      asked.push(q);
      return 'The first section governs, whatever a later one says of scale.';
    },
  });
  const tracker = createTracker({ store, url: 'http://t.test/', ipSalt: 's', custodySecret, extra: hosted.routes });
  server = await tracker.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '';
  const ownerHome = mkdtempSync(join(tmpdir(), 'owner-'));
  createKey(ownerHome, { secretHex: '00'.repeat(31) + '09' });
  const config = { ...DEFAULT_CONFIG, trackers: [base] };
  const owner = new Quilt(config, loadKey(ownerHome), new Resolver(config, ownerHome), 'Claude Code');
  const pattern: Pattern = {
    title: 'Hosted',
    done_when: 'Done.',
    slug: 'hosted',
    pieces: {
      'cite/*': {
        count: 2,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Citation {n}: {cite.s}',
        data: { cite: 'cites' },
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict'],
          properties: { verdict: { enum: ['supports', 'contradicts'] } },
        },
      },
    },
    data: { cites: [{ s: 'one' }, { s: 'two' }] },
  };
  problem = (await owner.publish(pattern)).hash;
});
afterAll(() =>
  Promise.all([new Promise<void>((r) => server.close(() => r())), new Promise<void>((r) => pages.close(() => r()))]),
);

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
    expect(meText).toContain('Relays: ws://127.0.0.1:1');
    const next = await client.callTool({ name: 'quilt_next', arguments: { problem } });
    const handles = (next.structuredContent as { handles: { piece: string; problem: string } }).handles;
    expect(handles.problem).toBe(problem);
    const ret = await client.callTool({
      name: 'quilt_return',
      arguments: { problem, piece: handles.piece, return: { verdict: 'supports' } },
    });
    expect((ret.structuredContent as { text: string }).text).toContain('posted to');
    const lines = (await (await fetch(`${base}p/${problem}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    const mine = lines.filter((l) => l.event.key === address);
    expect(mine.map((l) => l.event.type)).toEqual(['claim', 'commit', 'reveal']);
    expect(mine.every((l) => l.received[0]!.custody === 'hosted' && l.received[0]!.seat === 'ai')).toBe(true);
    // The bare address names no witness (QX-18): only a token from the authorization server brings one.
    expect(mine.every((l) => !('via' in l.received[0]!))).toBe(true);
    // The directory window (APP.md): the card's document is a resource of the same session, and its reader answers over it.
    expect((await client.listResources()).resources.map((r) => r.uri)).toContain(WINDOW_URI_NOW);
    const doc = (await client.readResource({ uri: WINDOW_URI_NOW })).contents[0] as {
      mimeType?: string;
      text?: string;
    };
    expect(doc.mimeType).toBe('text/html;profile=mcp-app');
    expect(doc.text).toContain('<title>Quilt</title>');
    const found = await client.callTool({ name: 'quilt_window_io', arguments: { op: 'search', query: 'hosted' } });
    const rows = (
      JSON.parse((found.content as { text: string }[])[0]!.text) as { rows: { problem: string; link: string }[] }
    ).rows;
    expect(rows.map((r) => r.problem)).toContain(problem);
    expect(rows[0]!.link).toMatch(/^quilt:sha256:/);
    expect(found.structuredContent).toBeUndefined();
    await client.close();
  });
  it('sends the custody secret to its own door alone: a post to a tracker a link names carries none of it', async () => {
    // Another tracker, by a link: it serves what this one serves and refuses every post as down, so each event goes on to this door.
    const posts: Record<string, string | undefined>[] = [];
    const other = createServer((req, res) => {
      if (req.method === 'POST') {
        posts.push({
          custody: req.headers['x-quilt-custody'] as string | undefined,
          via: req.headers['x-quilt-via'] as string | undefined,
        });
        req.resume();
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{"error":"down"}');
        return;
      }
      void fetch(`${base}${req.url!.slice(1)}`).then(async (r) => {
        res.writeHead(r.status, { 'content-type': r.headers.get('content-type') ?? 'text/plain' });
        res.end(Buffer.from(await r.arrayBuffer()));
      });
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()));
    const elsewhere = `http://127.0.0.1:${(other.address() as AddressInfo).port}/`;
    try {
      const joined = (await (await fetch(`${base}join`, { method: 'POST' })).json()) as {
        address: string;
        url: string;
      };
      const client = new Client({ name: 'claude-ai', version: '1.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(joined.url)));
      const next = await client.callTool({
        name: 'quilt_next',
        arguments: { problem: makeLink(problem as Hash, [elsewhere]) },
      });
      const piece = (next.structuredContent as { handles: { piece: string } }).handles.piece;
      await client.callTool({
        name: 'quilt_return',
        arguments: { problem, piece, return: { verdict: 'contradicts' } },
      });
      await client.close();
      expect(posts.length).toBeGreaterThanOrEqual(3);
      expect(posts.every((h) => h.custody === undefined && h.via === undefined)).toBe(true);
      const lines = (await (await fetch(`${base}p/${problem}/events`)).text())
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Receipt);
      const mine = lines.filter((l) => l.event.key === joined.address);
      expect(mine.map((l) => l.event.type)).toEqual(['claim', 'commit', 'reveal']);
      expect(mine.every((l) => l.received[0]!.custody === 'hosted')).toBe(true);
    } finally {
      other.closeAllConnections();
      await new Promise<void>((r) => other.close(() => r()));
    }
  });
  it("reaches no private address a link names where the connector is shared, for a member or the site's reader, and still posts to its own door", async () => {
    let hits = 0;
    const other = createServer((req, res) => {
      hits++;
      req.resume();
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()));
    const elsewhere = `http://127.0.0.1:${(other.address() as AddressInfo).port}/`;
    const before = process.env.QUILT_READS;
    process.env.QUILT_READS = 'public';
    try {
      const joined = (await (await fetch(`${base}join`, { method: 'POST' })).json()) as {
        address: string;
        url: string;
      };
      const client = new Client({ name: 'claude-ai', version: '1.0' });
      await client.connect(new StreamableHTTPClientTransport(new URL(joined.url)));
      const next = await client.callTool({
        name: 'quilt_next',
        arguments: { problem: makeLink(problem as Hash, [elsewhere]) },
      });
      expect((next.structuredContent as { handles: { problem: string } }).handles.problem).toBe(problem);
      await client.close();
      const opened = await fetch(
        `${base}window/io?op=open&link=${encodeURIComponent(makeLink(problem as Hash, [elsewhere], 'by a link'))}`,
      );
      expect(opened.status).toBe(200);
      expect(hits).toBe(0);
      const lines = (await (await fetch(`${base}p/${problem}/events`)).text())
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as Receipt);
      const mine = lines.filter((l) => l.event.key === joined.address);
      expect(mine.map((l) => l.event.type)).toEqual(['claim']);
      expect(mine[0]!.received[0]!.custody).toBe('hosted');
    } finally {
      if (before === undefined) delete process.env.QUILT_READS;
      else process.env.QUILT_READS = before;
      other.closeAllConnections();
      await new Promise<void>((r) => other.close(() => r()));
    }
  });
  it('serves the sheet at the address to a browser, with its data beside it, connected once an AI has been', async () => {
    const page = await fetch(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
    expect(page.headers.get('content-type')).toMatch(/text\/html/);
    const html = await page.text();
    expect(html).toContain('Your Quilt');
    expect(html).not.toMatch(/(src|href)="https?:/);
    // The connector's own GET, asking for an event stream, still meets the transport.
    expect((await fetch(url, { headers: { accept: 'text/event-stream' } })).status).toBe(400);
    const s = (await (await fetch(`${url}/sheet`)).json()) as {
      address: string;
      name: string | null;
      url: string;
      state: string;
      first: { say: string };
      standing: { standing: number } | null;
      coin: unknown;
      groups: { title: string }[];
    };
    expect(s.address).toBe(address);
    // The on-ramp keeps no name for a member; one chosen with quilt_name is an event in the identity log.
    expect(s.name).toBeNull();
    expect(s.url).toBe(url);
    expect(s.state).toBe('connected');
    expect(s.first.say).toBe('Open Quilt and tell me who I am: my address, my standing and my coin.');
    expect(s.standing).toMatchObject({ standing: 1 });
    expect(s.coin).toBeNull();
    expect(s.groups.map((g) => g.title)).toContain('To start');
    expect((await fetch(`${base}mcp/${'0'.repeat(64)}`, { headers: { accept: 'text/html' } })).status).toBe(404);
    expect((await fetch(`${base}mcp/${'0'.repeat(64)}/sheet`)).status).toBe(404);
    // The join page carries the same first sentences and nothing from elsewhere.
    const joinHtml = await (await fetch(`${base}join`)).text();
    expect(joinHtml).toContain('Find me something to do on Quilt.');
    expect(joinHtml).toContain('Explain how Quilt works to me, and how I would add a problem of my own.');
    expect(joinHtml).toContain('claude mcp add --transport http quilt');
    // The add-to-claude.ai link: its address is filled in by the page's script once the address is made, so the document itself links nowhere else.
    expect(joinHtml).toContain('id="claude" class="button" href="#"');
    expect(joinHtml).toContain(
      'https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Quilt&connectorUrl=',
    );
    expect(joinHtml).not.toMatch(/(src|href)="https?:/);
    // The window for a site: the card as a page any site may frame, and its reader beside it, answering the read-only ops alone over this tracker.
    const win = await fetch(`${base}window`);
    expect(win.headers.get('content-type')).toMatch(/text\/html/);
    expect(win.headers.get('content-security-policy')).toContain('frame-ancestors *');
    expect(await win.text()).toContain('<title>Quilt</title>');
    const io = (q: string) => fetch(`${base}window/io?${q}`);
    const totals = (await (await io('op=totals')).json()) as {
      problems: number;
      trackers: { tracker: string; problems: number | null }[];
    };
    expect(totals.problems).toBeGreaterThanOrEqual(1);
    expect(totals.trackers).toEqual([{ tracker: base, problems: totals.problems }]);
    const found = (await (await io('op=search&query=')).json()) as {
      rows: { via: string; link: string; title: string }[];
    };
    expect(found.rows.length).toBeGreaterThanOrEqual(1);
    expect(found.rows[0]).toMatchObject({ via: 'tracker' });
    const opened = (await (await io(`op=open&link=${encodeURIComponent(found.rows[0]!.link)}`)).json()) as {
      title: string;
      pieces: unknown[];
    };
    expect(opened.title).toBe(found.rows[0]!.title);
    expect(opened.pieces.length).toBeGreaterThanOrEqual(1);
    expect(((await (await io('op=phrases')).json()) as { phrases: Record<string, string> }).phrases.take_piece).toBe(
      'Open {link} on Quilt and take a piece.',
    );
    expect((await io('op=me')).status).toBe(404);
    expect((await io(`op=follow&key=0x${'1'.repeat(40)}`)).status).toBe(404);
    // With no token key, there is no authorization server: no witness paragraph, and no connector without an address.
    expect(joinHtml).not.toContain('The witness');
    expect((await fetch(`${base}mcp`, { method: 'POST', body: '{}' })).status).toBe(404);
    expect((await fetch(`${base}.well-known/oauth-protected-resource`)).status).toBe(404);
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
    const r = await fetch(otherUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-session-id': sid,
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
    });
    expect(r.status).toBe(403);
    await client.close();
  });
});

describe('the page of a square', () => {
  /** A Quilt of its own home whose key is the byte `n`, declaring `model`, over this tracker. */
  const mk = (n: number, model: string) => {
    const home = mkdtempSync(join(tmpdir(), 'square-'));
    createKey(home, { secretHex: '00'.repeat(31) + n.toString(16).padStart(2, '0') });
    const config = { ...DEFAULT_CONFIG, trackers: [base], model };
    return new Quilt(config, loadKey(home), new Resolver(config, home), 'Claude Code');
  };
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['verdict'],
    properties: { verdict: { enum: ['supports', 'contradicts'] } },
  };
  /** The verdict resting on a passage of the paper the test serves. */
  const at = (passage: string) => [{ field: 'verdict', url: `${site}/paper`, passage }];
  /** The page at /r/<problem>/<piece>: its status, its content policy and its document. */
  const page = async (h: Hash, piece: Hash) => {
    const r = await fetch(`${base}r/${h}/${piece}`);
    return { status: r.status, csp: r.headers.get('content-security-policy') ?? '', html: await r.text() };
  };

  it('says what the version named recorded, its readings quoted with what each rests on, and where the piece stands after the owner replaced it', async () => {
    const owner = mk(0x21, 'anthropic/claude'),
      a = mk(0x22, 'anthropic/claude'),
      b = mk(0x23, 'openai/gpt-5');
    const families = {
      'claim/*': {
        count: 1,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Claim {n}: does the paper say so?',
        schema,
        agree: ['verdict'],
      },
      'check/*': {
        count: 1,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Check {n}: does the paper say so at scale?',
        schema,
        agree: ['verdict'],
      },
    };
    const p = (
      await owner.publish({
        title: 'What the paper says',
        done_when: 'Every claim has a verdict.',
        slug: 'squared',
        pieces: families,
      } as Pattern)
    ).hash as Hash;
    const pieceOf = async (h: Hash, name: string) =>
      (await a.open(h)).state.pieces.find((x) => x.piece.name === name)!.piece.hash;
    const claim = await pieceOf(p, 'claim/1');
    const check = await pieceOf(p, 'check/1');
    await a.return(p, claim, { verdict: 'supports' }, at(HOLDS));
    await b.return(p, claim, { verdict: 'supports' }, at(HOLDS));
    await a.return(p, check, { verdict: 'supports' }, at(HOLDS));
    await b.return(p, check, { verdict: 'contradicts' }, at(NOT_AT_SCALE));
    const one = await page(p, claim);
    expect(one.status).toBe(200);
    expect(one.csp).toContain("default-src 'none'");
    expect(one.html).toContain(
      '<title>claim/1: verdict &quot;supports&quot;, agreed by AIs from anthropic and openai</title>',
    );
    expect(one.html).toContain(
      '<meta property="og:title" content="claim/1: verdict &quot;supports&quot;, agreed by AIs from anthropic and openai">',
    );
    expect(one.html).toContain(
      'It is accepted by two AIs from different companies, inside the window in which anyone may challenge it. Both readings rest on pages kept here.',
    );
    expect(one.html).toContain(`<h3>${a.identity!.address}</h3>`);
    expect(one.html).toContain(`verdict rests on “${HOLDS}” at <a href="${site}/paper"`);
    expect(one.html).toContain('One of the two readings that accepted the square.');
    expect(one.html).not.toMatch(/<script/i);
    expect(one.html).not.toContain('The owner has replaced');
    // The owner sharpens the check family: the claim keeps its hash in the new version, the check takes a new one.
    const newer = (await owner.sharpen(p, async () => 'Scale is read from the section that reports it.')).hash as Hash;
    expect(newer).toBeTruthy();
    const kept = await page(p, claim);
    expect(kept.html).toContain(
      '<title>claim/1: verdict &quot;supports&quot;, agreed by AIs from anthropic and openai</title>',
    );
    // A version keeps the events of the pieces whose hash it keeps, so the square stands there too.
    expect(kept.html).toContain(
      `In the current version, <code>${newer}</code>, the same piece is accepted by two AIs from different companies`,
    );
    const sharpened = await page(p, check);
    expect(sharpened.html).toContain('<title>check/1: disputed: two readings differ</title>');
    expect(sharpened.html).toContain(
      `and sharpened this piece's brief. In the current version, <code>${newer}</code>, the piece of the same name is <code>${await pieceOf(newer, 'check/1')}</code>`,
    );
    expect(sharpened.html).toContain('Scale is read from the section that reports it.');
    expect((await page(p, `sha256:${'0'.repeat(64)}` as Hash)).status).toBe(404);
    expect((await page(`sha256:${'0'.repeat(64)}` as Hash, claim)).status).toBe(404);
  });

  it('says what each reading rests on from the chain its readings come from: the passage where the bytes are here, the page and its hash where they are gone, and under a later version what the version that holds the piece recorded', async () => {
    const owner = mk(0x31, 'anthropic/claude'),
      a = mk(0x32, 'anthropic/claude'),
      b = mk(0x33, 'openai/gpt-5');
    const family = (brief: string) => ({
      count: 1,
      verifier: 'agree',
      requires: ['web'],
      brief,
      schema,
      agree: ['verdict'],
    });
    const families = {
      'traced/*': family('Traced {n}: does the paper say so?'),
      'bare/*': family('Bare {n}: does the paper say so?'),
      'apart/*': family('Apart {n}: does the paper say so at scale?'),
    };
    const p = (
      await owner.publish({
        title: 'What each reading rests on',
        done_when: 'Every claim has a verdict.',
        slug: 'rests',
        pieces: families,
      } as Pattern)
    ).hash as Hash;
    const pieceOf = async (h: Hash, name: string) =>
      (await a.open(h)).state.pieces.find((x) => x.piece.name === name)!.piece.hash;
    const traced = await pieceOf(p, 'traced/1'),
      bare = await pieceOf(p, 'bare/1'),
      apart = await pieceOf(p, 'apart/1');
    await a.return(p, traced, { verdict: 'supports' }, at(HOLDS));
    await b.return(p, traced, { verdict: 'supports' }, at(HOLDS));
    await a.return(p, bare, { verdict: 'supports' });
    await b.return(p, bare, { verdict: 'supports' });
    await a.return(p, apart, { verdict: 'supports' }, at(HOLDS));
    await b.return(p, apart, { verdict: 'contradicts' }, at(NOT_AT_SCALE));
    // Every trace rests on the one page the test serves, kept under one hash.
    const read = (store.lines(p).find((r) => r.event.type === 'trace')!.event.body as { reads: { hash: Hash }[] })
      .reads[0]!.hash;
    const link = `at <a href="${site}/paper" rel="nofollow noopener">${site}/paper</a>, kept as <code>${read}</code>`;
    const rest = (passage: string) => `verdict rests on “${passage}” ${link}`;
    const GONE = `verdict rests on a passage of the page ${link}; the page's bytes are not held here`;
    const NONE = 'It names no page it rests on.';
    /** What each reading on the page rests on, in the page's order: the items of its list, or the sentence that it names none. */
    const restsOn = (html: string): (string[] | string)[] =>
      html
        .split('<section>')
        .slice(1)
        .map((section) => {
          const list = /<p>What it rests on:<\/p><ul>(.*?)<\/ul>/.exec(section);
          if (list) return [...list[1]!.matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]!);
          return section.includes(`<p class="q">${NONE}</p>`) ? NONE : section;
        });

    // A traced square: each reading quotes the passage of the page this tracker keeps.
    const one = (await page(p, traced)).html;
    expect(one).toContain('Both readings rest on pages kept here.');
    expect(restsOn(one)).toEqual([[rest(HOLDS)], [rest(HOLDS)]]);
    // An untraced square: each reading names no page, and the grade says so.
    const none = (await page(p, bare)).html;
    expect(none).toContain('Neither reading names a page kept here.');
    expect(restsOn(none)).toEqual([NONE, NONE]);
    // The store loses the page's bytes: each rest still names the page and the hash it was kept under, and says the bytes are not held here.
    // The delete is made past the store's methods, so the test counts it as a write: the layer is read again, and the grade is the store's as it now stands.
    const bytes = store.getBlob(read)!;
    store.db.prepare('delete from blobs where hash = ?').run(read);
    store.version += 1;
    try {
      const gone = (await page(p, traced)).html;
      expect(gone).toContain('Neither reading names a page kept here.');
      expect(restsOn(gone)).toEqual([[GONE], [GONE]]);
      // No reading calls the page kept: the grade's own sentence names "a page kept here", so the check reads the readings alone.
      const readings = gone.split('<h2>The readings</h2>')[1]!.split('<h2>The problem</h2>')[0]!;
      expect(readings).toContain(GONE);
      expect(readings).not.toContain('a page kept here');
    } finally {
      store.putBlob(read, bytes);
    }

    // The owner sharpens the apart family: the traced piece keeps its hash in the newer version, and the apart piece's old hash is among the newer version's ancestral pieces.
    const newer = (await owner.sharpen(p, async () => 'Scale is read from the section that reports it.')).hash as Hash;
    // Under the newer version's address, the readings made under the earlier one come from the fold over the whole chain, and so do their rests: the grade and the readings say the same.
    const kept = (await page(newer, traced)).html;
    expect(kept).toContain('Both readings rest on pages kept here.');
    expect(restsOn(kept)).toEqual([[rest(HOLDS)], [rest(HOLDS)]]);
    // The apart piece's old hash under the newer version's address: the page names the version that holds it and says what that version recorded, its state and the readings with their rests, as under that version's own address, and where the piece of the same name stands now.
    const ancestral = (await page(newer, apart)).html;
    const under = (await page(p, apart)).html;
    expect(ancestral).toContain(`of the problem's version <code>${p}</code>.`);
    expect(ancestral).toContain(
      `<p>The version this address names, <code>${newer}</code>, is a later version without this piece. The state and the readings below are the ones <code>${p}</code> recorded.</p>`,
    );
    expect(ancestral).toContain('<p class="state">It is disputed: two readings differ.</p>');
    expect(ancestral).not.toContain('It is open');
    expect(ancestral).toContain('<title>apart/1: disputed: two readings differ</title>');
    expect(restsOn(ancestral)).toEqual([[rest(HOLDS)], [rest(NOT_AT_SCALE)]]);
    expect(restsOn(under)).toEqual([[rest(HOLDS)], [rest(NOT_AT_SCALE)]]);
    expect(ancestral).toContain(
      `In the current version, <code>${newer}</code>, the piece of the same name is <code>${await pieceOf(newer, 'apart/1')}</code>`,
    );
    // Under the older version's own address, the page reads as it did before: no later version is named as the address's.
    expect(under).not.toContain('The version this address names');
    expect(under).toContain('<p class="state">It is disputed: two readings differ.</p>');
  });
});

describe("the owners' turn", () => {
  it("sharpens a hosted owner's brief where two grounded readings read it apart, signed with the key it holds, and passes over a member with nothing to do", async () => {
    // A member publishes through the connector, so the problem is in the home the on-ramp keeps for them.
    const made = (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { address: string; url: string };
    const client = new Client({ name: 'claude-ai', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(made.url)));
    const pattern: Pattern = {
      title: 'Traced',
      done_when: 'Done.',
      slug: 'traced',
      pieces: {
        'statement/*': {
          count: 1,
          verifier: 'agree',
          requires: ['web'],
          brief: 'Statement {n}: does the paper say so?',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['verdict', 'quote'],
            properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string', maxLength: 160 } },
          },
          agree: ['verdict'],
        },
      },
    };
    const published = await client.callTool({ name: 'quilt_publish', arguments: { pattern } });
    const hash = /Published (sha256:[0-9a-f]+)/.exec(
      (published.structuredContent as { text: string }).text,
    )![1]! as Hash;
    await client.close();
    // Two readers of different vendors rest the field on the same page at different places.
    const reader = (n: number, model: string, host: string): Quilt => {
      const home = mkdtempSync(join(tmpdir(), `reader-${n}-`));
      createKey(home, { secretHex: '00'.repeat(31) + `0${n}` });
      const config = { ...DEFAULT_CONFIG, trackers: [base], model };
      return new Quilt(config, loadKey(home), new Resolver(config, home), host);
    };
    const a = reader(1, 'anthropic/claude', 'Claude Code');
    const b = reader(2, 'openai/gpt-5', 'ChatGPT');
    const piece = (await a.open(hash)).state.pieces[0]!.piece.hash;
    await a.return(hash, piece, { verdict: 'supports', quote: 'q' }, [
      { field: 'verdict', url: `${site}/paper`, passage: HOLDS },
    ]);
    await b.return(hash, piece, { verdict: 'contradicts', quote: 'q' }, [
      { field: 'verdict', url: `${site}/paper`, passage: NOT_AT_SCALE },
    ]);
    const state = (await (await fetch(`${base}p/${hash}/state`)).json()) as {
      pieces: { state: string; seams: { why: string }[] }[];
    };
    expect(state.pieces[0]).toMatchObject({ state: 'disputed', seams: [{ why: 'span' }] });
    // The turn: the member's brief sharpened with the sentence, the version published under their key, the line in their log. A member with nothing in their home is passed over, and one who only worked another owner's problem has nothing to say.
    const turns = await hosted.turn();
    const mine = turns.filter((t) => t.said);
    expect(mine.map((t) => t.address)).toEqual([made.address]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ family: 'statement', field: 'verdict', grounded: true });
    expect(mine[0]!.sharpened[0]).toMatchObject({ problem: hash, sentences: [{ kept: true }] });
    expect(mine[0]!.said).toBe('sharpened: 1 published');
    const newer = mine[0]!.sharpened[0]!.hash!;
    const after = (await (await fetch(`${base}p/${hash}/state`)).json()) as { superseded: string | null };
    expect(after.superseded).toBe(newer);
    const receipts = (await (await fetch(`${base}p/${newer}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    expect(receipts.filter((r) => r.event.key === made.address).every((r) => r.received[0]!.custody === 'hosted')).toBe(
      true,
    );
    const memberHash = createHash('sha256')
      .update(/\/mcp\/([0-9a-f]{64})$/.exec(made.url)![1]!)
      .digest('hex');
    expect(readFileSync(join(hostedHome, memberHash, AWAY_LOG), 'utf8')).toContain(' sharpened: 1 published');
    // Nothing more to do: the next turn says nothing for anyone.
    expect((await hosted.turn()).filter((t) => t.said)).toEqual([]);
  });
  it('asks the vendor the environment names, Anthropic first, and reads the text of its answer; with no key there is no way to ask', async () => {
    expect(sentenceVendor({})).toBeNull();
    expect(sentenceVendor({ OPENAI_API_KEY: 'k' })).toMatchObject({ vendor: 'openai', model: 'gpt-6-luna' });
    expect(sentenceVendor({ ANTHROPIC_API_KEY: 'k', OPENAI_API_KEY: 'k', QUILT_SENTENCE_MODEL: 'm' })).toMatchObject({
      vendor: 'anthropic',
      model: 'm',
    });
    expect(answerText('anthropic', { content: [{ type: 'text', text: ' The sentence. ' }] })).toBe('The sentence.');
    expect(answerText('anthropic', { content: [] })).toBeNull();
    expect(
      answerText('openai', { output: [{ type: 'message', content: [{ type: 'output_text', text: 'One.' }] }] }),
    ).toBe('One.');
    expect(answerText('openai', {})).toBeNull();
    expect(vendorSentence({})).toBeNull();
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: init!.headers as Record<string, string>, body: String(init!.body) });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'The first section governs.' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    const ask = vendorSentence({ ANTHROPIC_API_KEY: 'secret-key' }, fake)!;
    const q: SentenceAsk = {
      family: 'statement',
      brief: 'Does it?',
      field: 'verdict',
      piece: 'statement/1',
      grounded: false,
      seam: {
        field: 'verdict',
        why: 'unknown',
        sides: [
          { key: '0xa', value: 'supports', read: null, span: null, passage: null, aside: false },
          { key: '0xb', value: 'contradicts', read: null, span: null, passage: null, aside: false },
        ],
      },
    };
    expect(await ask(q)).toBe('The first section governs.');
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.headers['x-api-key']).toBe('secret-key');
    expect(JSON.parse(calls[0]!.body)).toMatchObject({ model: 'claude-opus-5-5', messages: [{ role: 'user' }] });
    expect(JSON.parse(calls[0]!.body).messages[0].content).toContain('neither rested it on the record');
  });
});
