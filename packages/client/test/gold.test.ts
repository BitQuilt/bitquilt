import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { AWAY_LOG, NEEDS_AGENT, awayTurn, revealedText } from '../src/away.js';
import { goldDue, windowOpen } from '../src/gold.js';
import type { LayerPiece } from '../src/listings.js';
import type { Library } from '../src/resolver.js';
import { runTool } from '../src/tools.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { instructs, json, mcpPair, quiltOver, startTracker, tempHome } from './helpers.js';

/**
 * Gold pieces (QX-16) from the client's side: an owner publishes with the answers to some pieces, which leave the home
 * only as blind hashes naming no piece while the projections and nonces stay in the library; attention lists a reveal
 * due once a piece is accepted; the reveal through the tool marks the square verified, or strikes the set on a miss and
 * says so; the summary counts the gold; the tools describe and never instruct. And the reveals run with nobody asked
 * (`revealDue`): the away turn reveals every piece whose gold is due before its agent, whether or not one is here, says
 * in its line what the tracker decided, posts nothing twice, and keeps a refusal rather than throwing; `quilt gold due`
 * lists them. What is due follows the window the tracker holds open (`window_open`), under a challenge too, where the
 * core says `unknown` for an attest piece; a tracker that does not say it is read by its states and the core's.
 */
let server: Server;
let base: string;
let owner: Quilt, other: Quilt, a: Quilt, b: Quilt, owner2: Quilt;
let p: Hash, q: Hash;

const pattern = (slug: string, count: number): Pattern => ({
  title: `Does the paper say what people say it says? (${slug})`,
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug,
  settings: { endgame_at: 1 },
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

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  const mk = quiltOver(base);
  owner = mk(9, 'anthropic/claude');
  other = mk(8, 'anthropic/claude');
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  owner2 = mk(7, 'anthropic/claude');
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

type StateView = {
  pieces: { hash: Hash; state: string; gold: string | null; verified: boolean }[];
  gold: { committed: number; pending: number; verified: number; missed: number; overruled: number; lapsed: number };
};
const trackerState = (problem: Hash) => json<StateView>(`${base}p/${problem}/state`);
const pieceOf = async (problem: Hash, n: number): Promise<Hash> => (await a.open(problem)).state.pieces[n]!.piece.hash;

describe('gold pieces, from the client', () => {
  it('publishes with gold: the commitments on the ledger, the answers only in the library, every piece pending, the stake locked', async () => {
    // The owner earns standing on another owner's problem first: a gold's stake is the owner's standing.
    q = (await other.publish(pattern('elsewhere', 3))).hash;
    for (let i = 0; i < 3; i++) {
      const qi = await pieceOf(q, i);
      await owner.return(q, qi, { verdict: 'supports', quote: 'it says so' });
      await b.return(q, qi, { verdict: 'supports', quote: 'indeed' });
    }
    expect(await owner.standing()).toMatchObject({ standing: 4, free: 4 });
    const r = await owner.publish({
      ...pattern('golden', 3),
      gold: {
        answers: {
          'statement/1': { verdict: 'supports', quote: 'the quote is not committed' },
          'statement/2': { verdict: 'contradicts', quote: 'nor this one' },
        },
      },
    });
    p = r.hash;
    expect(r.refused).toEqual([]);
    // Two a piece where no stake rule applies: one for each root a miss would dock.
    expect(r.gold).toEqual({ pieces: 2, stake: 4 });
    const lib = JSON.parse(readFileSync(join(owner.resolver.home, 'library.json'), 'utf8')) as {
      gold: Record<string, Record<string, { name: string; projection: Record<string, unknown>; nonce: string }>>;
    };
    const kept = Object.values(lib.gold[p]!);
    expect(kept.map((k) => k.name).sort()).toEqual(['statement/1', 'statement/2']);
    expect(kept.find((k) => k.name === 'statement/1')!.projection).toEqual({ verdict: 'supports' });
    expect(kept.every((k) => /^[0-9a-f]{32}$/.test(k.nonce))).toBe(true);
    const events = await (await fetch(`${base}p/${p}/events`)).text();
    expect(events).toContain('"type":"gold"');
    expect(events).not.toContain('contradicts');
    const s = await trackerState(p);
    // Blind: the ledger counts two commitments, names no piece in them, and no piece shows one until the reveal.
    const goldLine = events.split('\n').find((l) => l.includes('"type":"gold"'))!;
    for (const x of s.pieces) expect(goldLine).not.toContain(x.hash);
    expect(s.pieces.map((x) => x.gold)).toEqual([null, null, null]);
    expect(s.gold).toEqual({ committed: 2, pending: 2, verified: 0, missed: 0, overruled: 0, lapsed: 0 });
    expect(await owner.standing()).toMatchObject({ standing: 4, locked: 4, free: 0 });
    const opened = await a.open(p);
    expect(a.summary(p, opened.state, opened.tracker, opened.layer, opened.hidden, opened.gold)).toContain(
      "Gold (QX-16): the owner committed answers for 2 of the pieces before the work, without saying which; 0 verified, 0 missed, 2 awaiting the owner's reveal.",
    );
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
    expect(read.text).toContain("1 verified, 0 missed, 1 awaiting the owner's reveal");
    expect(read.text).toContain(
      'statement/1 (verified: the set agreed with the answer the owner committed to before the work)',
    );
  });

  it('commits gold after publishing, on a piece nobody has worked, and refuses one already worked', async () => {
    // The other owner earns a point on the plain third piece of the golden problem: a gold's share is two a piece.
    const p3 = await pieceOf(p, 2);
    await other.return(p, p3, { verdict: 'supports', quote: 'read it' });
    await b.return(p, p3, { verdict: 'supports', quote: 'so did we' });
    expect(await other.standing()).toMatchObject({ standing: 2, free: 2 });
    const r = (await other.publish(pattern('later', 2))).hash;
    const r1 = await pieceOf(r, 0);
    const committed = await other.commitGold(r, { 'statement/1': { verdict: 'supports', quote: 'kept at home' } });
    expect(committed).toEqual({ pieces: 1, stake: 2 });
    expect((await trackerState(r)).pieces.map((x) => x.gold)).toEqual([null, null]);
    expect((await trackerState(r)).gold).toMatchObject({ committed: 1, pending: 1 });
    const lib = JSON.parse(readFileSync(join(other.resolver.home, 'library.json'), 'utf8')) as {
      gold: Record<string, Record<string, { name: string }>>;
    };
    expect(Object.values(lib.gold[r]!).map((k) => k.name)).toEqual(['statement/1']);
    await a.return(r, r1, { verdict: 'supports', quote: 'x' });
    await expect(
      other.commitGold(r, {
        'statement/2': { verdict: 'supports', quote: '' },
        'statement/1': { verdict: 'supports', quote: '' },
      }),
    ).rejects.toThrow(/already worked/);
    await expect(other.commitGold(r, { 'statement/9': { verdict: 'supports', quote: '' } })).rejects.toThrow(
      /no piece named/,
    );
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
    // A struck root's challenge on the miss stakes nothing: 0 passes the client and the door, which on this small
    // tracker then finds no panel to seat.
    await expect(a.challenge(p, p2, -1, 'The gold is wrong.')).rejects.toThrow(/whole number from 0/);
    await expect(a.challenge(p, p2, 0, 'The gold is wrong.')).rejects.toThrow(/no panel can be seated/);
    const { client, close } = await mcpPair(owner);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('quilt_reveal_gold');
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(instructs);
    expect(JSON.stringify(tools.tools.find((t) => t.name === 'quilt_publish')!.inputSchema)).toContain('"gold"');
    expect(JSON.stringify(tools.tools.find((t) => t.name === 'quilt_challenge')!.inputSchema)).toContain('"minimum":0');
    await close();
  });
});

describe('the reveals run with nobody asked', () => {
  let d: Hash;
  const entry = { command: '/opt/quilt', args: ['mcp'], env: {} };
  const nobody = { env: { PATH: '/nonexistent' }, entry, dirs: ['/nonexistent'] };

  it('lists nothing due before a square is accepted, then reveals what is due in the away turn before any agent, and the line says what was decided', async () => {
    // Standing first: four plain squares on another owner's problem, since a gold's stake is two a commitment; a fresh
    // key starts at one.
    const plain = (await a.publish(pattern('plain', 4))).hash;
    for (let i = 0; i < 4; i++) {
      const pi = await pieceOf(plain, i);
      await owner2.return(plain, pi, { verdict: 'supports', quote: 'yes' });
      await b.return(plain, pi, { verdict: 'supports', quote: 'yes' });
    }
    expect(await owner2.standing()).toMatchObject({ standing: 5, free: 5 });
    d = (
      await owner2.publish({
        ...pattern('due', 3),
        gold: {
          answers: {
            'statement/1': { verdict: 'supports', quote: '' },
            'statement/2': { verdict: 'contradicts', quote: '' },
          },
        },
      })
    ).hash;
    expect(await owner2.revealDue(false)).toEqual([]);
    expect(await owner2.revealDue()).toEqual([]);
    const d1 = await pieceOf(d, 0);
    await a.return(d, d1, { verdict: 'supports', quote: 'q' });
    await b.return(d, d1, { verdict: 'supports', quote: 'q' });
    // Due, and listing posts nothing: the tracker still shows no reveal.
    expect(await owner2.revealDue(false)).toEqual([
      { problem: d, piece: d1, name: 'statement/1', outcome: null, error: null },
    ]);
    expect((await trackerState(d)).pieces[0]).toMatchObject({ gold: null, verified: false });
    const home = owner2.resolver.home;
    const turn = await awayTurn({ ...nobody, home, quilt: () => owner2 });
    expect(turn.ran).toBe(false);
    expect(turn.gold).toEqual([{ problem: d, piece: d1, name: 'statement/1', outcome: 'match', error: null }]);
    // The square accepted moved the problem's work, so the same turn announces it again (QX-13 section 3).
    expect(turn.line).toBe(`${NEEDS_AGENT} gold: 1 revealed (1 match); announced: 1`);
    expect(readFileSync(join(home, AWAY_LOG), 'utf8')).toContain(' gold: 1 revealed (1 match)');
    expect((await trackerState(d)).pieces[0]).toMatchObject({ gold: 'match', verified: true });
    expect(await owner2.revealDue(false)).toEqual([]);
    // A turn with nothing due leaves the line as it was and writes nothing.
    const quiet = await awayTurn({ ...nobody, home, quilt: () => owner2 });
    expect(quiet).toMatchObject({ ran: false, gold: [], line: NEEDS_AGENT });
    expect(
      readFileSync(join(home, AWAY_LOG), 'utf8')
        .split('\n')
        .filter((l) => l.includes('gold:')),
    ).toHaveLength(1);
  });

  it('strikes the set on a miss, posts nothing twice, and keeps a refusal with its reason rather than throwing', async () => {
    const d2 = await pieceOf(d, 1);
    const d3 = await pieceOf(d, 2);
    await a.return(d, d2, { verdict: 'supports', quote: 'q' });
    await b.return(d, d2, { verdict: 'supports', quote: 'q' });
    // A commitment the library claims and the ledger never saw: the tracker refuses its reveal, and the run says so and
    // goes on.
    owner2.library.gold![d]![d3] = { name: 'statement/3', projection: { verdict: 'supports' }, nonce: '00'.repeat(16) };
    await a.return(d, d3, { verdict: 'supports', quote: 'q' });
    await b.return(d, d3, { verdict: 'supports', quote: 'q' });
    const run = await owner2.revealDue();
    expect(run).toHaveLength(2);
    expect(run[0]).toEqual({ problem: d, piece: d2, name: 'statement/2', outcome: 'miss', error: null });
    expect(run[1]).toMatchObject({ problem: d, piece: d3, name: 'statement/3', outcome: null });
    expect(run[1]!.error).toMatch(/commitment/);
    expect(revealedText(run)).toBe('gold: 1 revealed (1 miss), 1 refused');
    expect((await trackerState(d)).pieces[1]).toMatchObject({ state: 'open', gold: 'miss', verified: false });
    // The miss is on the ledger, so it is not due again; the refused one is asked again next time, and refused again.
    const again = await owner2.revealDue();
    expect(again.map((r) => [r.name, r.outcome, r.error !== null])).toEqual([['statement/3', null, true]]);
    expect(revealedText([])).toBe('');
  });

  it('is wired as `quilt gold due` from the command line: a home with no gold lists nothing and posts nothing', () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const home = tempHome('quilt-gold-cli-');
    const out = execFileSync(
      process.execPath,
      ['--import', 'tsx', join(root, 'packages', 'client', 'src', 'bin.ts'), 'gold', 'due'],
      { cwd: root, encoding: 'utf8', env: { ...process.env, QUILT_HOME: home, QUILT_TRACKERS: base } },
    );
    expect(JSON.parse(out)).toEqual([]);
  }, 60_000);
});

describe('the gold due, by the window the tracker holds open', () => {
  const problem = `sha256:${'a'.repeat(64)}` as Hash;
  const hashOf = (n: number) => `sha256:${String(n).repeat(64)}` as Hash;
  const kept = (n: number, revealed?: string) => ({
    name: `statement/${n}`,
    projection: { verdict: 'supports' },
    nonce: 'n',
    ...(revealed ? { revealed } : {}),
  });
  const library = {
    gold: {
      [problem]: {
        [hashOf(1)]: kept(1),
        [hashOf(2)]: kept(2),
        [hashOf(3)]: kept(3),
        [hashOf(4)]: kept(4),
        [hashOf(5)]: kept(5, '2026-11-07T12:00:00Z'),
      },
    },
  } as unknown as Library;
  const piece = (n: number, said: Partial<LayerPiece>): LayerPiece =>
    ({ hash: hashOf(n), name: `statement/${n}`, gold: null, ...said }) as LayerPiece;
  const dueOf = (pieces: LayerPiece[]) =>
    goldDue(library, problem, new Map(pieces.map((l) => [l.hash, l]))).map((d) => d.name);

  it('reads window_open where the tracker says it, a challenge open or not, whatever the core says', () => {
    // An attest piece the core does not know: challenged in its window, and challenged once the window has closed.
    expect(windowOpen(piece(1, { state: 'challenged', core: 'unknown', window_open: true }))).toBe(true);
    expect(windowOpen(piece(2, { state: 'challenged', core: 'unknown', window_open: false }))).toBe(false);
    expect(
      dueOf([
        piece(1, { state: 'challenged', core: 'unknown', window_open: true }),
        piece(2, { state: 'challenged', core: 'unknown', window_open: false }),
        piece(3, { state: 'accepted_provisional', core: 'accepted_provisional', window_open: true, gold: 'match' }),
        piece(4, { state: 'accepted', core: 'accepted', window_open: false }),
        piece(5, { state: 'accepted_provisional', core: 'accepted_provisional', window_open: true }),
      ]),
    ).toEqual(['statement/1']);
  });

  it('reads a tracker that does not say window_open by its states, a challenged piece only while the core does not call it final', () => {
    expect(
      dueOf([
        piece(1, { state: 'accepted_provisional', core: 'accepted_provisional' }),
        piece(2, { state: 'challenged', core: 'accepted_provisional' }),
        piece(3, { state: 'challenged', core: 'accepted' }),
        piece(4, { state: 'accepted', core: 'accepted' }),
      ]),
    ).toEqual(['statement/1', 'statement/2']);
  });
});
