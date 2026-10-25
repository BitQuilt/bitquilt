import { mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { type Hash, hashCanonical } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { createMcpServer } from '../src/mcp.js';
import { createPage } from '../src/page.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt, kindWords, waitsText } from '../src/worker.js';

/**
 * The three verifier kinds from the client's side (docs/ext/verifiers.md): a person's AI is handed an attest piece of
 * the app's own promotion pattern, told what kind it is and how weak, and its record is accepted at once; a judge piece
 * takes two candidates, the tracker seats the three keys with work elsewhere, one ranks through the connector, one
 * through the page's form where they are a seated judge, and the majority's first choice is accepted; `read` says it
 * all as quoted text with the kinds and their strengths, and every tool describes.
 */
const hex = (n: number) => '00'.repeat(31) + n.toString(16).padStart(2, '0');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let server: Server;
let page: Server;
let base: string;
let site: string;
let config: Config;
let owner: Quilt, a: Quilt, b: Quilt, c: Quilt, j11: Quilt, j12: Quilt, j13: Quilt;
let tell: Hash, judged: Hash, elsewhere: Hash;

function mk(n: number, model: string, host = 'Claude Code'): Quilt {
  const home = mkdtempSync(join(tmpdir(), `quilt-${n}-`));
  createKey(home, { secretHex: hex(n) });
  return new Quilt({ ...config, model }, loadKey(home), new Resolver(config, home), host);
}
const verdictSchema = { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string', maxLength: 160 } } } as const;
const agreePattern: Pattern = {
  title: 'Statements elsewhere', done_when: 'Every statement has a verdict.', slug: 'elsewhere', settings: { endgame_at: 1 },
  pieces: { 'statement/*': { count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema: verdictSchema as unknown as Pattern['pieces'][string]['schema'], agree: ['verdict'] } },
};
const judgePattern: Pattern = {
  title: 'One sentence for the front page', done_when: 'A panel has picked the sentence.', slug: 'one-sentence', settings: { endgame_at: 1 },
  pieces: { sentence: { verifier: 'judge:3', candidates: 2, requires: ['web'], brief: 'Say what BitQuilt is in one sentence.', schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 200 } } } as unknown as Pattern['pieces'][string]['schema'] } },
};
const trackerState = async (problem: Hash, piece: Hash) => {
  const s = (await (await fetch(`${base}p/${problem}/state`)).json()) as { pieces: { hash: Hash; state: string; core: string; attested: boolean; strength: string | null }[] };
  return s.pieces.find((x) => x.hash === piece)!;
};
const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${site}${path}`, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};
const instructs = /\b(you must|always|never|do not|important|ignore)\b/i;

beforeAll(async () => {
  const tracker = createTracker({ store: new Store(':memory:'), url: 'http://tracker.test/', ipSalt: 's', limits: { keyPerHour: 1000, ipPerHour: 10000 } });
  server = await tracker.listen(0);
  const addr = server.address();
  base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/` : '';
  config = { ...DEFAULT_CONFIG, trackers: [base] };
  owner = mk(9, 'anthropic/claude');
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  c = mk(3, 'google/gemini', 'Gemini');
  j12 = mk(12, 'openai/gpt-5', 'ChatGPT');
  j13 = mk(13, 'google/gemini', 'Gemini');
  // Judge 11 is the person at the page: their AI's Quilt and their own share the key and the resolver, as quilt serve builds it.
  const home = mkdtempSync(join(tmpdir(), 'quilt-11-'));
  createKey(home, { secretHex: hex(11) });
  const resolver = new Resolver(config, home);
  j11 = new Quilt(config, loadKey(home), resolver, 'Claude Code');
  const person = new Quilt({ ...config, model: 'human', can: ['person', 'web', 'files'] }, loadKey(home), resolver, 'human');
  page = await createPage({ quilt: j11, person, resolver }).listen(0);
  const p = page.address();
  site = typeof p === 'object' && p ? `http://127.0.0.1:${p.port}` : '';
  // The three judges earn their credits on a problem of the core's kind first.
  elsewhere = (await owner.publish(agreePattern)).hash;
  const [s1, s2] = (await a.open(elsewhere)).state.pieces.map((v) => v.piece.hash) as [Hash, Hash];
  await j11.return(elsewhere, s1, { verdict: 'supports', quote: 'one' });
  await j12.return(elsewhere, s1, { verdict: 'supports', quote: 'two' });
  await j13.return(elsewhere, s2, { verdict: 'contradicts', quote: 'three' });
  await j11.return(elsewhere, s2, { verdict: 'contradicts', quote: 'four' });
});
afterAll(async () => {
  await new Promise<void>((r) => page.close(() => r()));
  await new Promise<void>((r) => server.close(() => r()));
});

describe('the kinds in words', () => {
  it('says how each kind earns a square and that attest is the weakest', () => {
    expect(kindWords('attest')).toMatchObject({ kind: 'attest', extension: 'QX-10', strength: 'attested', weakest: true });
    expect(kindWords('judge:3')).toMatchObject({ kind: 'judge', extension: 'QX-2', strength: 'judged' });
    expect(kindWords('human')).toMatchObject({ kind: 'human', extension: 'QX-3', strength: 'agreed' });
    expect(kindWords('agree')).toMatchObject({ kind: 'agree', extension: null, strength: 'agreed' });
    expect(kindWords('oracle').strength).toBe('unknown');
    expect(waitsText('attest')).toContain('accepted at once');
    expect(waitsText('judge:3')).toContain('candidate');
    expect(waitsText(undefined)).toContain('verifier');
  });
});

describe('an attest piece of the promotion pattern', () => {
  it('publishes examples/tell-someone.json, hands a person\'s AI an attest piece with its kind and weakness said, and accepts the record at once', async () => {
    const pattern = JSON.parse(readFileSync(join(root, 'examples', 'tell-someone.json'), 'utf8')) as Pattern;
    const published = await owner.publish(pattern);
    expect(published.refused).toEqual([]);
    tell = published.hash;
    const { hash, pick, posted, author } = await a.next(tell);
    expect(hash).toBe(tell);
    expect(pick.piece.verifier).toBe('attest');
    expect(pick.brief).toMatch(/^Telling \d+ of twenty\./);
    expect(posted.queued).toBe(false);
    const text = a.pieceText(hash, pick, author);
    expect(text).toContain('verifier attest');
    expect(text).toContain('A square of this kind is attested: the actor\'s own signed record is accepted at once and may be challenged for the window; the weakest kind.');
    expect(text).toContain(`The author, ${owner.identity!.address}, wrote this brief: "Telling`);
    const r = await a.return(tell, pick.piece.hash, { who: 'the editor of a newsletter about open protocols', how: 'message', when: '2026-10-25', said: 'That BitQuilt is a protocol for problems published as patterns of pieces, each return a signed event.' });
    expect(r.reveal.queued).toBe(false);
    expect(r.waits).toBe('The record is accepted at once as the actor\'s own word, marked attested, and may be challenged for the window.');
    expect(await trackerState(tell, pick.piece.hash)).toMatchObject({ state: 'accepted_provisional', core: 'unknown', attested: true, strength: 'attested' });
    // Read back: the map shows the tracker's state where the core says unknown, the kinds line says the strength, and the record is quoted with its signer.
    const opened = await c.open(tell);
    expect(opened.layer).not.toBeNull();
    const summary = c.summary(opened.hash, opened.state, opened.tracker, opened.layer);
    expect(summary).toContain('Kinds: 20 attest (attested: the actor\'s own signed record is accepted at once and may be challenged for the window; the weakest kind).');
    expect(summary).toMatch(/\n[.p]{20}\n/);
    expect(summary).toContain('1 accepted provisional');
    expect(c.summary(opened.hash, opened.state, opened.tracker)).toMatch(/\n\?{20}\n/);
    const accepted = c.acceptedText(opened.state, opened.layer);
    expect(accepted).toContain(`(attest; attested, the actor's own word), ${a.identity!.address} returned: {"how":"message","said":"That BitQuilt`);
    expect(c.acceptedText(opened.state)).toBe('Nothing accepted yet.');
  });

  it('shows the kind and its strength on the page, with the attested square marked', async () => {
    const opened = await api(`/api/open?link=${tell}`);
    expect(opened.status).toBe(200);
    const pieces = opened.body.pieces as { state: string; core: string; verifier: string; strength: string; weakest: boolean; attested: boolean }[];
    expect(pieces).toHaveLength(20);
    expect(pieces.every((p) => p.verifier === 'attest' && p.strength === 'attested' && p.weakest)).toBe(true);
    expect(pieces.filter((p) => p.attested && p.state === 'accepted_provisional' && p.core === 'unknown')).toHaveLength(1);
    expect(opened.body.kinds).toContain('20 attest (attested');
    expect(opened.body.judging).toEqual([]);
  });
});

describe('a judge piece', () => {
  let piece: Hash;
  let first: Hash, second: Hash;
  it('takes two candidates, then seats the three keys with work elsewhere, and reads the candidates blind', async () => {
    judged = (await owner.publish(judgePattern)).hash;
    const pa = await a.next(judged);
    piece = pa.pick.piece.hash;
    expect(pa.pick.piece.verifier).toBe('judge:3');
    expect(a.pieceText(judged, pa.pick, pa.author)).toContain('A square of this kind is judged: a panel of 3 drawn by sortition ranks the candidates');
    const ra = { text: 'A torrent where the pieces are made, not copied.' };
    const rb = { text: 'Problems published as patterns of pieces, each return signed.' };
    first = hashCanonical(ra);
    second = hashCanonical(rb);
    expect((await a.return(judged, piece, ra)).waits).toContain('a candidate');
    expect((await trackerState(judged, piece)).state).toBe('needs_verify');
    const pb = await b.next(judged);
    expect(pb.pick.piece.hash).toBe(piece);
    await b.return(judged, piece, rb);
    expect(await trackerState(judged, piece)).toMatchObject({ state: 'judging', core: 'unknown', strength: 'judged' });
    await expect(c.next(judged)).rejects.toThrow(/nothing for this key/);
    const panels = await c.panels(judged, base);
    expect(panels).toHaveLength(1);
    expect(panels[0]!.outcome).toBe('open');
    expect(panels[0]!.seats.map((s) => s.root).sort()).toEqual([j11, j12, j13].map((j) => j.identity!.address).sort());
    const { state } = await c.open(judged);
    const text = c.panelsText(panels, state);
    expect(text).toContain('Panel on sentence (judge:3, 2 of 3 decide), sitting: the candidates are in and the judges drawn are ranking them.');
    expect(text).toContain(`A candidate returned, as digest ${first}: {"text":"A torrent where the pieces are made, not copied."}`);
    expect(text).not.toContain(a.identity!.address);
    expect(text).toContain(`${j12.identity!.address}, drawn, has not ranked.`);
    await expect(c.rank(judged, piece, [first, second])).rejects.toThrow(/not a judge drawn/);
    await expect(j12.rank(judged, piece, [first])).rejects.toThrow(/2 candidate digests/);
    await expect(j12.rank(judged, piece, [first, first])).rejects.toThrow(/each digest once/);
  });

  it('takes one rank through the connector and one through the page\'s form where the person is a seated judge, and accepts the majority\'s first choice', async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const mcp = createMcpServer(() => j12);
    await mcp.connect(st);
    const client = new Client({ name: 'judge-test', version: '0.0.0' });
    await client.connect(ct);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('quilt_rank');
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(instructs);
    const read = await client.callTool({ name: 'quilt_read', arguments: { problem: judged } });
    const readText = (read.structuredContent as { text: string }).text;
    expect(readText).toContain('Panels:');
    expect(readText).toContain('A candidate returned, as digest');
    expect(readText).toContain('Kinds: 1 judge:3 (judged:');
    expect((read.content as { text: string }[])[0]!.text).toBe(readText);
    const ranked = await client.callTool({ name: 'quilt_rank', arguments: { problem: judged, piece, ranking: [first, second] } });
    expect(ranked.isError).not.toBe(true);
    expect((ranked.structuredContent as { text: string }).text).toContain('Ranking posted to');
    expect((ranked.structuredContent as { handles: { rank: string } }).handles.rank).toMatch(/^sha256:/);
    const again = await client.callTool({ name: 'quilt_rank', arguments: { problem: judged, piece, ranking: [second, first] } });
    expect(again.isError).toBe(true);
    await client.close();
    await mcp.close();
    // The page: the person at it is drawn, so the problem view carries the panel with its candidates, and the form posts the ranking.
    const opened = await api(`/api/open?link=${judged}`);
    const judging = opened.body.judging as { piece: Hash; name: string; candidates: { digest: Hash; return: Record<string, unknown> }[] }[];
    expect(judging).toHaveLength(1);
    expect(judging[0]!.piece).toBe(piece);
    expect(judging[0]!.candidates.map((x) => x.digest).sort()).toEqual([first, second].sort());
    const refused = await api('/api/rank', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problem: judged, piece, ranking: [first] }) });
    expect(refused.status).toBe(400);
    const posted = await api('/api/rank', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problem: judged, piece, ranking: [first, second] }) });
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    expect(posted.body.queued).toBe(false);
    expect(await trackerState(judged, piece)).toMatchObject({ state: 'accepted_provisional', core: 'unknown', strength: 'judged', attested: false });
    await expect(j13.rank(judged, piece, [second, first])).rejects.toThrow(/the panel has decided/);
    const after = await api(`/api/open?link=${judged}`);
    expect(after.body.judging).toEqual([]);
    expect((after.body.pieces as { state: string }[])[0]!.state).toBe('accepted_provisional');
    // Decided, the panel names the candidates' signers, and the winner is said.
    const panels = await c.panels(judged, base);
    const { state, layer } = await c.open(judged);
    const text = c.panelsText(panels, state);
    expect(text).toContain('decided: the candidate a majority ranked first is accepted');
    expect(text).toContain(`${a.identity!.address}, ranked first by the majority, returned, as digest ${first}:`);
    expect(text).toContain(`${j12.identity!.address}, drawn, ranked: ${first}, ${second}.`);
    expect(text).toContain(`${j13.identity!.address}, drawn, has not ranked.`);
    expect(c.acceptedText(state, layer)).toContain(`sentence (judge:3; judged as the tracker holds it), ${a.identity!.address} returned:`);
  });

  it('hands the kind and its strength to the AI as handles beside the text', async () => {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const mcp = createMcpServer(() => c);
    await mcp.connect(st);
    const client = new Client({ name: 'gemini-test', version: '0.0.0' });
    await client.connect(ct);
    const next = await client.callTool({ name: 'quilt_next', arguments: { problem: tell } });
    const handles = (next.structuredContent as { handles: { verifier: string; kind: string; strength: string; weakest: boolean; piece: Hash } }).handles;
    expect(handles).toMatchObject({ verifier: 'attest', kind: 'attest', strength: 'attested', weakest: true });
    expect((next.structuredContent as { text: string }).text).toContain('A square of this kind is attested');
    const returned = await client.callTool({ name: 'quilt_return', arguments: { problem: tell, piece: handles.piece, return: { who: 'a maintainer of a tracker', how: 'conversation', when: '2026-10-25', said: 'That the pieces are made, not copied.' } } });
    expect((returned.structuredContent as { text: string }).text).toContain('accepted at once as the actor\'s own word');
    await client.close();
    await mcp.close();
  });
});
