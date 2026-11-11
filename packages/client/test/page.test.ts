import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { createPage } from '../src/page.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { windowAnswer } from '../src/window.js';
import type { MapPiece, PagePiece, ProblemMap } from '../src/window-answers.js';
import { baseOf, hex, json, quiltOver, startTracker, tempHome } from './helpers.js';

/**
 * The page: what a person at http://localhost:3978/ does. They search, open a problem, take the rarest piece and hand
 * a return back as a person (the same key as their AI's, model `human`, capability `person`), and a piece an AI of
 * another vendor returned before them is accepted by their agreement. The owner's gold (QX-16) is offered for reveal on
 * the pieces the owner's turn reveals (gold.ts, goldDue): an accepting set stands and its window is open, as the
 * tracker's `window_open` says. Once the window has closed the tracker refuses the reveal, and the page no longer
 * offers it, a challenge open on the piece or not (APP.md, "Standing, gold and the coin on the page"). Each piece on
 * the page's map has the fields the window's map has, and a few of its own.
 */
let tracker: Server;
let page: Server;
let base: string;
let site: string;
let config: Config;
/**
 * The person's home, kept by name: the page's Quilt and the person's are built over it, and a later test opens it
 * again.
 */
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
      count: 3,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: {claim.text} Return whether the paper says this, with a quote.',
      data: { claim: 'claims' },
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'quote'],
        properties: {
          verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] },
          quote: { type: 'string', maxLength: 160 },
        },
      },
      agree: ['verdict'],
    },
  },
  data: {
    claims: [
      { text: 'The coin is a chain of signatures.' },
      { text: 'Difficulty never changes.' },
      { text: 'Headers are about 80 bytes.' },
    ],
  },
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
  it("gives each piece on its map the fields the window's map gives it, the same for a kind this client knows", async () => {
    // One type for the piece on a problem's map (window-answers.ts, MapPiece): the page's /api/open and the window's
    // open each add their own fields to it, and for a kind this client implements the shared fields agree.
    const shared = [
      'hash',
      'name',
      'verifier',
      'kind',
      'strength',
      'weakest',
      'attested',
      'state',
      'stake',
      'gold',
      'verified',
      'inherited',
    ] as const satisfies readonly (keyof MapPiece)[];
    const pick = (p: object) => Object.fromEntries(shared.map((k) => [k, (p as Record<string, unknown>)[k]]));
    const onPage = (await api(`/api/open?link=${problem}`)).body.pieces as PagePiece[];
    const map = (await windowAnswer(new Quilt(config, loadKey(homeA), new Resolver(config, homeA)), {
      op: 'open',
      link: problem,
    })) as ProblemMap;
    expect(onPage.map(pick)).toEqual(map.pieces.map(pick));
    expect(Object.keys(onPage[0]!).sort()).toEqual([...shared, 'says', 'requires', 'mine_gold', 'gold_due'].sort());
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
  it("takes the return as a person and the piece is accepted on the two vendors' agreement", async () => {
    const refused = await api('/api/return', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem, piece: verifying, return: { verdict: 'supports', quote: 'see https://x.y/z' } }),
    });
    expect(refused.status).toBe(400);
    expect(String(refused.body.error)).toMatch(/no links/);
    const r = await api('/api/return', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        problem,
        piece: verifying,
        return: { verdict: 'supports', quote: 'We define an electronic coin as a chain of digital signatures.' },
      }),
    });
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

describe("the reveal of the owner's gold the page offers", () => {
  // A tracker on the test's clock, so a window can close; the page's key owns a problem with gold on three of its
  // pieces.
  const HOUR = 3_600_000;
  let tick = Date.now();
  let goldTracker: Server;
  let goldBase: string;
  let goldPage: Server;
  let goldSite: string;
  let mine: Quilt, vendor: Quilt, worker: Quilt, other: Quilt;
  let golden: Hash;
  const statements = (slug: string, count: number): Pattern => ({
    title: `Does the paper say so? (${slug})`,
    done_when: 'Every statement has a verdict agreed by two vendors.',
    slug,
    pieces: {
      'statement/*': {
        count,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Statement {n}: does the paper say so? Return the verdict and a quote.',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict', 'quote'],
          properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string', maxLength: 160 } },
        },
        agree: ['verdict'],
      },
    },
  });
  type Row = { hash: Hash; name: string; state: string; gold: string | null; mine_gold: boolean; gold_due: boolean };
  const rows = async (): Promise<Row[]> => {
    const r = await fetch(`${goldSite}/api/open?link=${golden}`);
    return ((await r.json()) as { pieces: Row[] }).pieces;
  };
  const due = async () => (await rows()).filter((x) => x.gold_due).map((x) => x.name);

  beforeAll(async () => {
    ({ server: goldTracker, base: goldBase } = await startTracker({
      limits: { keyPerHour: 1000, ipPerHour: 10000 },
      now: () => new Date((tick += 1000)).toISOString(),
    }));
    const mk = quiltOver(goldBase);
    mine = mk(4, 'anthropic/claude');
    vendor = mk(2, 'openai/gpt-5', 'ChatGPT');
    worker = mk(5, 'anthropic/claude');
    other = mk(6, 'anthropic/claude');
    goldPage = await createPage({ quilt: mine, person: mine, resolver: mine.resolver }).listen(0);
    goldSite = baseOf(goldPage).slice(0, -1);
    // Standing first, since each blind commitment stakes two: five squares on another owner's problem bring the page's
    // key to six.
    const elsewhere = (await other.publish(statements('elsewhere', 5))).hash;
    for (const v of (await mine.open(elsewhere)).state.pieces) {
      await mine.return(elsewhere, v.piece.hash, { verdict: 'supports', quote: 'it says so' });
      await vendor.return(elsewhere, v.piece.hash, { verdict: 'supports', quote: 'indeed' });
    }
    expect(await mine.standing()).toMatchObject({ standing: 6, free: 6 });
    const answers = {
      'statement/1': { verdict: 'supports', quote: '' },
      'statement/2': { verdict: 'supports', quote: '' },
      'statement/3': { verdict: 'supports', quote: '' },
    };
    const published = await mine.publish({ ...statements('golden', 4), gold: { answers } });
    expect(published.refused).toEqual([]);
    expect(published.gold).toEqual({ pieces: 3, stake: 6 });
    golden = published.hash;
  });
  afterAll(async () => {
    await new Promise<void>((r) => goldPage.close(() => r()));
    await new Promise<void>((r) => goldTracker.close(() => r()));
  });

  it('offers nothing before a piece is accepted, though the gold is committed here', async () => {
    const before = await rows();
    expect(before.map((x) => x.mine_gold)).toEqual([true, true, true, false]);
    expect(await due()).toEqual([]);
  });
  it('offers the reveal while the window is open, and the reveal it offers is the one the tracker takes', async () => {
    const [p1, p2] = (await rows()).map((x) => x.hash);
    for (const piece of [p1!, p2!]) {
      await worker.return(golden, piece, { verdict: 'supports', quote: 'as the paper says' });
      await vendor.return(golden, piece, { verdict: 'supports', quote: 'the paper says so' });
    }
    expect((await rows()).slice(0, 2).map((x) => x.state)).toEqual(['accepted_provisional', 'accepted_provisional']);
    expect(await due()).toEqual(['statement/1', 'statement/2']);
    // The page and the owner's turn read one rule.
    expect((await mine.revealDue(false)).map((d) => d.name)).toEqual(await due());
    const revealed = await fetch(`${goldSite}/api/reveal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ problem: golden, piece: p1 }),
    });
    expect(revealed.status).toBe(200);
    expect(((await revealed.json()) as { outcome: string }).outcome).toBe('match');
    expect(await due()).toEqual(['statement/2']);
  });
  it("offers no reveal once the window has closed, where the tracker refuses it and the owner's turn reveals nothing", async () => {
    tick += 49 * HOUR;
    const second = (await rows())[1]!;
    expect(second).toMatchObject({
      name: 'statement/2',
      state: 'accepted',
      gold: null,
      mine_gold: true,
      gold_due: false,
    });
    expect(await due()).toEqual([]);
    expect(await mine.revealDue(false)).toEqual([]);
    await expect(mine.revealGold(golden, second.hash)).rejects.toThrow(/the window has closed/);
  });
  it('offers the reveal on a challenged piece while its window is open, and none once it closes with the panel still sitting', async () => {
    // Four judges with accepted work on another problem, and a challenger with the point a new root begins with.
    const mk = quiltOver(goldBase);
    const judges = [
      mk(11, 'anthropic/claude'),
      mk(12, 'openai/gpt-5', 'ChatGPT'),
      mk(13, 'google/gemini', 'Gemini'),
      mk(14, 'meta/llama', 'x'),
    ];
    const challenger = mk(7, 'google/gemini', 'Gemini');
    const pool = (await other.publish(statements('pool', 2))).hash;
    const [q1, q2] = (await other.open(pool)).state.pieces.map((v) => v.piece.hash);
    await judges[0]!.return(pool, q1!, { verdict: 'supports', quote: 'one' });
    await judges[1]!.return(pool, q1!, { verdict: 'supports', quote: 'two' });
    await judges[2]!.return(pool, q2!, { verdict: 'contradicts', quote: 'three' });
    await judges[3]!.return(pool, q2!, { verdict: 'contradicts', quote: 'four' });
    const third = (await rows())[2]!;
    await worker.return(golden, third.hash, { verdict: 'supports', quote: 'as the paper says' });
    await vendor.return(golden, third.hash, { verdict: 'supports', quote: 'the paper says so' });
    const acceptedAt = tick;
    const tracked = async () =>
      (
        await json<{ pieces: { hash: Hash; state: string; window_open: boolean }[] }>(`${goldBase}p/${golden}/state`)
      ).pieces.find((x) => x.hash === third.hash)!;
    // Half an hour before the window closes, a challenge: the piece is challenged, its window open, and the reveal due.
    tick = acceptedAt + 47.5 * HOUR;
    await challenger.challenge(golden, third.hash, 1, 'Both quote the abstract, which the paper itself takes back.');
    expect(await tracked()).toMatchObject({ state: 'challenged', window_open: true });
    expect(await due()).toEqual(['statement/3']);
    expect((await mine.revealDue(false)).map((d) => d.name)).toEqual(['statement/3']);
    // Half an hour after, the panel still sits and the piece is still challenged, but the window has closed.
    tick = acceptedAt + 48.5 * HOUR;
    expect(await tracked()).toMatchObject({ state: 'challenged', window_open: false });
    expect((await rows())[2]).toMatchObject({
      name: 'statement/3',
      state: 'challenged',
      gold: null,
      mine_gold: true,
      gold_due: false,
    });
    expect(await due()).toEqual([]);
    expect(await mine.revealDue(false)).toEqual([]);
    await expect(mine.revealGold(golden, third.hash)).rejects.toThrow(/the window has closed/);
  });
  it('draws the reveal from the mark the API sets, with no list of states of its own', async () => {
    const html = await (await fetch(`${goldSite}/`)).text();
    expect(html).toContain('return x.gold_due;');
    expect(html).not.toMatch(/x\.state === '(accepted|accepted_provisional|challenged)'/);
  });
});

describe('the sheet the menu bar draws', () => {
  it('lists what it holds at /held and serves the identity log at /k/events, for a mirror or another node to pull from', async () => {
    const held = await api('/held');
    expect(held.status).toBe(200);
    const list = held.body as {
      quilt: number;
      node: boolean;
      problems: { problem: string; title: string; slug: string; owner: string; lines: number }[];
    };
    expect(list.quilt).toBe(1);
    expect(list.node).toBe(true);
    const mine = list.problems.find((p) => p.problem === problem)!;
    expect(mine).toMatchObject({ title: pattern.title, slug: pattern.slug, owner: owner.identity!.address });
    expect(mine.lines).toBeGreaterThan(0);
    const identity = await fetch(`${site}/k/events`);
    expect(identity.headers.get('content-type')).toContain('x-ndjson');
    const lines = (await identity.text())
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { event: { type: string } });
    expect(Array.isArray(lines)).toBe(true);
    const known = (await api('/.well-known/quilt')).body as { node: boolean; routes: string[] };
    expect(known.node).toBe(true);
    expect(known.routes).toEqual(expect.arrayContaining(['/held', '/k/events']));
  });
  it('is in the no-connector state until an AI connects through this node, and connected after, with the phrases that fit', async () => {
    const before = await api('/api/phrases');
    expect(before.status).toBe(200);
    expect(before.body.state).toBe('no_connector');
    expect((before.body.first as { say: string }).say).toBe(
      'Open Quilt and tell me who I am: my address, my standing and my coin.',
    );
    expect(before.body.groups).toEqual([]);
    expect((before.body.templates as Record<string, string>).take_piece).toBe('Open {link} on Quilt and take a piece.');
    const said = await api('/api/connector', { method: 'POST', body: JSON.stringify({ host: 'Claude Desktop' }) });
    expect((said.body.connector as { host: string }).host).toBe('Claude Desktop');
    const after = await api('/api/phrases');
    expect(after.body.state).toBe('connected');
    const groups = after.body.groups as { title: string; phrases: { say: string; problem?: { hash: string } }[] }[];
    expect(groups.map((g) => g.title)).toContain('To start');
    expect(groups.find((g) => g.title === 'Opened lately')?.phrases.some((p) => p.problem?.hash === problem)).toBe(
      true,
    );
    // A tool run through the node is the connector's latest, under the host that ran it.
    const first = (after.body.connector as { last: string }).last;
    await api('/api/tool/quilt_me', { method: 'POST', body: JSON.stringify({ input: {}, host: 'ChatGPT' }) });
    const later = await api('/api/phrases');
    expect((later.body.connector as { host: string }).host).toBe('ChatGPT');
    expect((later.body.connector as { last: string }).last >= first).toBe(true);
    // A search result carries its link, for a phrase about it.
    const found = await api('/api/search?q=citations');
    expect((found.body.problems as { link: string }[])[0]!.link).toMatch(/^quilt:sha256:/);
  });
});
