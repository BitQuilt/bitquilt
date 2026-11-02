import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import { runTool } from '../src/tools.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { drawText, fetchRead, locate, privateHost } from '../src/trace.js';
import { instructs, json, mcpPair, quiltOver, startTracker } from './helpers.js';

/**
 * The trace (QX-19) from the client's side: a page is drawn to text without its scripts, styles and tags, and a passage
 * is found in it by its words, in bytes; a return with rests fetches the page once, keeps its text on the tracker under
 * its hash, posts the trace with the span, and says what rests on what; a rest whose page cannot be read, whose passage
 * is not on it or whose field the return lacks is left out and said, and with nothing left nothing is posted; the
 * square's grade and the seams of a disputed piece reach the model as text with each side's passage quoted and its
 * signer named, through quilt_read and quilt_next; the tools' words describe.
 */
let server: Server;
let base: string;
let pages: Server;
let site: string;
let owner: Quilt, a: Quilt, b: Quilt, c: Quilt;
let p: Hash;
const pieces: Hash[] = [];
const enc = new TextEncoder();

const PAGE_TEXT = 'The paper says the effect holds in every trial. A later section says it does not hold at scale.';
const HOLDS = 'the effect holds in every trial';
const NOT_AT_SCALE = 'it does not hold at scale';
const HTML = '<!doctype html><html><head><title>Paper</title><style>p{color:red}</style><script>alert("x")</script></head><body><h1>The paper &amp; its claims</h1>'
  + '<p>The paper says the effect <b>holds</b> in every   trial.</p>\n<p>A later section says it does not hold at scale.</p><!-- a note --></body></html>';

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?', done_when: 'Every statement has a verdict agreed by two vendors.', slug: 'traced',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 3, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so? Return the verdict and a quote.',
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
};

type StateView = { pieces: { hash: Hash; state: string; traces: number; traced: string | null }[] };
const trackerState = () => json<StateView>(`${base}p/${p}/state`);

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  pages = createServer((req, res) => {
    if (req.url === '/paper') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HTML);
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('no such page');
    }
  });
  await new Promise<void>((r) => pages.listen(0, '127.0.0.1', () => r()));
  site = `http://127.0.0.1:${(pages.address() as AddressInfo).port}`;
  const mk = quiltOver(base);
  owner = mk(9, 'anthropic/claude');
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  c = mk(3, 'google/gemini');
  p = (await owner.publish(pattern)).hash;
  for (const v of (await a.open(p)).state.pieces) pieces.push(v.piece.hash);
});
afterAll(async () => {
  await new Promise<void>((r) => pages.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
});

describe('drawing a page and finding a passage', () => {
  it('draws HTML to text without scripts, styles, tags or comments, reads entities, and finds a passage by its words in bytes', () => {
    const text = drawText(HTML, 'text/html; charset=utf-8');
    expect(text).toBe('Paper The paper & its claims The paper says the effect holds in every trial. A later section says it does not hold at scale.');
    expect(text).not.toMatch(/alert|color|<|-->/);
    const start = enc.encode(text.slice(0, text.indexOf(HOLDS))).length;
    expect(locate(text, HOLDS)).toEqual([start, start + HOLDS.length]);
    expect(locate(text, 'The Effect  HOLDS in every trial')).toEqual([start, start + HOLDS.length]);
    expect(locate(text, 'never seen at all')).toBeNull();
    expect(locate(text, '   ')).toBeNull();
    expect(drawText('plain   words\n\nhere', 'text/plain')).toBe('plain words here');
  });
});

describe('a return with rests', () => {
  it('fetches the page once, keeps its text on the tracker under its hash, posts the trace with the span, and the square is graded as the traces arrive', async () => {
    const piece = pieces[0]!;
    const r = await a.return(p, piece, { verdict: 'supports', quote: 'holds in every trial' }, [
      { field: 'verdict', url: `${site}/paper`, passage: HOLDS },
      { field: 'quote', url: `${site}/paper`, passage: 'words that are not on the page' },
    ]);
    expect(r.trace).toMatchObject({ reads: 1, rested: ['verdict'], missing: [{ field: 'quote', url: `${site}/paper`, why: 'the passage is not on the page as fetched' }] });
    expect(r.trace!.posted).toMatchObject({ queued: false, at: base });
    // Not accepted yet, so no grade; one trace kept.
    expect((await trackerState()).pieces[0]).toMatchObject({ state: 'needs_verify', traces: 1, traced: null });
    // The read on the tracker is the drawn text, and the span is the passage, in bytes.
    const events = await (await fetch(`${base}p/${p}/events`)).text();
    const line = events.split('\n').find((l) => l.includes('"type":"trace"'))!;
    const body = (JSON.parse(line) as { event: { body: { reveal: Hash; reads: { url: string; hash: Hash; media: string }[]; rests: { field: string; read: number; span: [number, number] }[] } } }).event.body;
    expect(body.reads).toHaveLength(1);
    expect(body.reads[0]).toMatchObject({ url: `${site}/paper`, media: 'text/plain' });
    expect(body.rests).toEqual([{ field: 'verdict', read: 0, span: body.rests[0]!.span }]);
    const bytes = new Uint8Array(await (await fetch(`${base}b/${body.reads[0]!.hash}`)).arrayBuffer());
    const kept = new TextDecoder().decode(bytes);
    expect(kept).toContain(PAGE_TEXT);
    expect(kept).not.toContain('alert');
    expect(new TextDecoder().decode(bytes.subarray(...body.rests[0]!.span))).toBe(HOLDS);
    // The second vendor, through the tool: the text says where the trace went and what rests on what.
    const tool = await runTool(b, 'quilt_return', { problem: p, piece, return: { verdict: 'supports', quote: 'q' }, rests: [{ field: 'verdict', url: `${site}/paper`, passage: NOT_AT_SCALE }, 'not a rest'] });
    expect(tool.text).toContain(`Trace posted to ${base}: verdict rests on 1 kept read (QX-19).`);
    expect(tool.handles.trace).toEqual({ reads: 1, rested: ['verdict'], missing: [] });
    expect((await trackerState()).pieces[0]).toMatchObject({ state: 'accepted_provisional', traces: 2, traced: 'both' });
    const read = await runTool(a, 'quilt_read', { problem: p });
    expect(read.text).toContain('statement/1 (rests on kept reads on both sides),');
    expect(read.text).toContain('A kept read is what a return rests on (QX-19)');
  });

  it('leaves out what cannot be placed and says why, posts nothing with nothing left, and says nothing of traces where none were asked', async () => {
    const piece = pieces[1]!;
    const r = await a.return(p, piece, { verdict: 'supports', quote: 'q' }, [
      { field: 'verdict', url: `${site}/missing`, passage: 'x' },
      { field: 'source', url: `${site}/paper`, passage: 'x' },
      { field: 'quote', url: 'ftp://example.org/paper', passage: 'x' },
    ]);
    expect(r.trace).toEqual({ posted: null, reads: 0, rested: [], missing: [
      { field: 'verdict', url: `${site}/missing`, why: 'the page answered 404' },
      { field: 'source', url: `${site}/paper`, why: 'not a field of the return' },
      { field: 'quote', url: 'ftp://example.org/paper', why: 'not an http or https URL' },
    ] });
    expect((await trackerState()).pieces[1]).toMatchObject({ traces: 0 });
    const tool = await runTool(b, 'quilt_return', { problem: p, piece, return: { verdict: 'supports', quote: 'q' } });
    expect(tool.text).not.toContain('race');
    expect(tool.handles.trace).toBeNull();
    expect((await trackerState()).pieces[1]).toMatchObject({ state: 'accepted_provisional', traces: 0, traced: 'none' });
    const read = await runTool(a, 'quilt_read', { problem: p });
    expect(read.text).toContain('statement/2 (rests on no kept read),');
  });

  it('shows the seams of a disputed piece in quilt_read, with each side quoted and named, and hands them over with quilt_next', async () => {
    const piece = pieces[2]!;
    await a.return(p, piece, { verdict: 'supports', quote: 'q' }, [{ field: 'verdict', url: `${site}/paper`, passage: HOLDS }]);
    await b.return(p, piece, { verdict: 'contradicts', quote: 'q' }, [{ field: 'verdict', url: `${site}/paper`, passage: NOT_AT_SCALE }]);
    expect((await trackerState()).pieces[2]).toMatchObject({ state: 'disputed', traces: 2, traced: null });
    const read = await runTool(a, 'quilt_read', { problem: p });
    expect(read.text).toContain('statement/3 is disputed');
    expect(read.text).toContain(`On verdict, the same read, at different places: ${a.identity!.address} rests it on "${HOLDS}" at ${site}/paper (sha256:`);
    expect(read.text).toContain(`${b.identity!.address} rests it on "${NOT_AT_SCALE}" at ${site}/paper (sha256:`);
    const handed = await runTool(c, 'quilt_next', { problem: p });
    expect(handed.handles.piece).toBe(piece);
    expect(handed.text).toContain('On verdict, the same read, at different places:');
    expect(handed.text).toContain(`rests it on "${HOLDS}" at`);
  });

  it('fetches nothing at a private address where the connector is shared (QUILT_READS=public), and says so', async () => {
    const before = process.env.QUILT_READS;
    process.env.QUILT_READS = 'public';
    try {
      expect(privateHost('localhost')).toBe(true);
      expect(privateHost('10.1.2.3')).toBe(true);
      expect(privateHost('172.20.0.5')).toBe(true);
      expect(privateHost('[::1]')).toBe(true);
      expect(privateHost('fe80::1')).toBe(true);
      expect(privateHost('example.org')).toBe(false);
      expect(privateHost('8.8.8.8')).toBe(false);
      const got = await fetchRead(`${site}/paper`, '2026-11-02T12:00:00Z');
      expect(got).toEqual({ why: 'a private address, which this connector does not fetch' });
    } finally {
      if (before === undefined) delete process.env.QUILT_READS;
      else process.env.QUILT_READS = before;
    }
  });

  it('describes in the tools\' words, with rests on quilt_return', async () => {
    const { client, close } = await mcpPair(a);
    const tools = await client.listTools();
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(instructs);
    expect(JSON.stringify(tools.tools.find((t) => t.name === 'quilt_return')!.inputSchema)).toContain('"rests"');
    expect(tools.tools.find((t) => t.name === 'quilt_next')!.description).toContain('QX-19');
    await close();
  });
});
