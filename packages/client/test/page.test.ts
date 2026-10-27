import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { createPage } from '../src/page.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { baseOf, hex, quiltOver, startTracker, tempHome } from './helpers.js';

/**
 * The page: what a person at http://localhost:3978/ does. They search, open a problem, take the rarest piece and hand
 * a return back as a person (the same key as their AI's, model `human`, capability `person`), and a piece an AI of
 * another vendor returned before them is accepted by their agreement.
 */
let tracker: Server;
let page: Server;
let base: string;
let site: string;
let config: Config;
/** The person's home, kept by name: the page's Quilt and the person's are built over it, and a later test opens it again. */
const homeA = tempHome('quilt-a-');
let owner: Quilt, b: Quilt;
let problem: Hash;
let verifying: Hash;

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'paper-says',
  topics: ['citations', 'reading'],
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 3, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: {claim.text} Return whether the paper says this, with a quote.',
      data: { claim: 'claims' },
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
  data: { claims: [{ text: 'The coin is a chain of signatures.' }, { text: 'Difficulty never changes.' }, { text: 'Headers are about 80 bytes.' }] },
};

const api = async (path: string, init?: RequestInit) => {
  const r = await fetch(`${site}${path}`, init);
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  ({ server: tracker, base } = await startTracker());
  config = { ...DEFAULT_CONFIG, trackers: [base] };
  const mk = quiltOver(base);
  owner = mk(9);
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  // As `quilt serve` builds it: the AI's Quilt and the person's share the key and the resolver.
  createKey(homeA, { secretHex: hex(1) });
  const resolver = new Resolver(config, homeA);
  const quilt = new Quilt(config, loadKey(homeA), resolver, 'Claude Code');
  const person = Quilt.asPerson(config, loadKey(homeA), resolver);
  page = await createPage({ quilt, person, resolver }).listen(0);
  site = baseOf(page).slice(0, -1);
  problem = (await owner.publish(pattern)).hash;
});
afterAll(async () => {
  await new Promise<void>((r) => page.close(() => r()));
  await new Promise<void>((r) => tracker.close(() => r()));
});

describe('the page', () => {
  it('refuses a port already taken as a rejection, so a second copy of quilt goes on without its page', async () => {
    const taken = page.address();
    const port = typeof taken === 'object' && taken ? taken.port : 0;
    const resolver = new Resolver(config, homeA);
    const quilt = new Quilt(config, loadKey(homeA), resolver, 'Claude Code');
    await expect(createPage({ quilt, person: quilt, resolver }).listen(port)).rejects.toThrow(/EADDRINUSE/);
  });
  it('serves one self-contained document that loads nothing from elsewhere', async () => {
    const r = await fetch(`${site}/`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    const html = await r.text();
    expect(html).toContain('<title>Quilt</title>');
    expect(html).not.toMatch(/<(script|link|img)[^>]+(src|href)=["']https?:/i);
    expect(html).not.toContain('innerHTML');
  });
  it('finds the problem by a topic and opens it as the map', async () => {
    const found = await api(`/api/search?q=reading`);
    expect((found.body.problems as { problem: string }[]).map((p) => p.problem)).toEqual([problem]);
    const opened = await api(`/api/open?link=${problem}`);
    expect(opened.status).toBe(200);
    expect(opened.body.title).toBe('Does the paper say what people say it says?');
    expect((opened.body.pieces as { state: string }[]).map((p) => p.state)).toEqual(['open', 'open', 'open']);
    expect(opened.body.summary).toContain('titled it:');
  });
  it('hands the person a piece another vendor already returned, as a verification, with the brief rendered', async () => {
    // The other vendor works the whole problem first; every piece then waits for a second vendor.
    const briefs = new Map<string, string>();
    for (let i = 0; i < 3; i++) {
      const { pick } = await b.next(problem);
      briefs.set(pick.piece.hash, pick.brief);
      await b.return(problem, pick.piece.hash, { verdict: 'supports', quote: 'a chain of digital signatures' });
    }
    const pick = await api(`/api/next?problem=${problem}`);
    expect(pick.status, JSON.stringify(pick.body)).toBe(200);
    expect(briefs.has(pick.body.piece as string)).toBe(true);
    expect(pick.body.brief).toBe(briefs.get(pick.body.piece as string));
    expect(pick.body.brief).toMatch(/^Statement \d: /);
    verifying = pick.body.piece as Hash;
    expect(pick.body.agree).toEqual(['verdict']);
    expect((pick.body.posted as { queued: boolean }).queued).toBe(false);
    const { state } = await b.open(problem);
    const view = state.byHash.get(verifying)!;
    expect(view.state).toBe('needs_verify');
    expect(view.claims.some((c) => c.by.model === 'human' && c.by.can.includes('person'))).toBe(true);
  });
  it('takes the return as a person and the piece is accepted on the two vendors\' agreement', async () => {
    const refused = await api('/api/return', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problem, piece: verifying, return: { verdict: 'supports', quote: 'see https://x.y/z' } }) });
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/no links/);
    const r = await api('/api/return', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ problem, piece: verifying, return: { verdict: 'supports', quote: 'We define an electronic coin as a chain of digital signatures.' } }) });
    expect(r.status).toBe(200);
    expect((r.body.commit as { queued: boolean }).queued).toBe(false);
    expect((r.body.reveal as { queued: boolean }).queued).toBe(false);
    const { state } = await b.open(problem);
    const view = state.byHash.get(verifying)!;
    expect(view.state).toBe('accepted_provisional');
    expect(view.reveals.map((r) => r.by.model).sort()).toEqual(['human', 'openai/gpt-5']);
    const opened = await api(`/api/open?link=${problem}`);
    expect(opened.body.accepted).toContain('"verdict":"supports"');
    expect(opened.body.accepted).toContain(loadKey(homeA)!.address);
    // The next take is another piece: the accepted one is done, and a key is never handed a piece it has a reveal on.
    const again = await api(`/api/next?problem=${problem}`);
    expect(again.body.piece).not.toBe(verifying);
  });
});
