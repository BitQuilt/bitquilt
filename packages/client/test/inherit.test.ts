/**
 * A fork's inherited squares from the client's side, over a booted tracker on the test's own clock
 * (docs/ext/QX-23.md). QX-23 section 3: next never hands an inherited piece, a piece that waits on an inherited input
 * stays locked while the square at the source is provisional and opens once it is final, and the client that takes it
 * renders the brief itself from the source's chain, the source's returns as quoted text with each signer's address.
 * QX-23 section 5: Quilt's map marks the inherited pieces and names the problem their squares stand on, its own pick
 * leaves them out, and where the tracker hands over a piece the core holds locked behind one, Quilt takes it on the
 * tracker's word; the claim, the commit and the reveal on it are admitted as on any piece. A client that cannot read
 * the source itself does not take the piece, whatever the tracker names. The card's reader carries each piece's mark,
 * and what is read of the fork counts the inherited squares beside its own and not among them.
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import { type Config, DEFAULT_CONFIG, createKey, loadKey } from '../src/config.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { runTool } from '../src/tools.js';
import { windowAnswer } from '../src/window.js';
import { hex, json, quiltOver, startTracker, tempHome } from './helpers.js';

let server: Server;
let base: string;
let owner: Quilt, a: Quilt, b: Quilt, forker: Quilt, c: Quilt, d: Quilt, blind: Quilt;

const HOUR = 3_600_000;
/** The tracker's clock: a second on with each reading of it, and moved by hand to close a window or lapse a hold. */
let tick = Date.now();

const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'contradicts'] } },
};
const agree = { verifier: 'agree', requires: ['web' as const], schema, agree: ['verdict'] };
const ASKED = 'Do the statements hold together? ';

/** Two statements, and a summary that waits on both and takes their returns into its brief. */
const pattern: Pattern = {
  title: 'What a paper says, summed',
  done_when: 'Every statement has a verdict, and the summary has one.',
  slug: 'paper-summed',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': { ...agree, count: 2, brief: 'Statement {n}: does the paper say so?' },
    summary: { ...agree, brief: `${ASKED}{statement/*}`, inputs: ['statement/*'] },
  },
};

type StateView = { pieces: { name: string; hash: Hash; state: string; core: string; inherited: unknown }[] };
type NextAnswer = { piece: Hash | null; name?: string; state?: string; brief?: string };
const NOTHING = 'nothing for this key on that problem right now';
const address = (q: Quilt) => q.identity!.address;
const trackerState = async (of: Hash) => (await json<StateView>(`${base}p/${of}/state`)).pieces;
/** The tracker's own assisted next for a Quilt's key, asked as the Quilt asks it. */
const trackerNext = (of: Hash, q: Quilt) =>
  json<NextAnswer>(
    `${base}p/${of}/next?key=${address(q)}&can=${q.config.can.join(',')}&model=${encodeURIComponent(q.model())}`,
  );
/** What quilt_open says of the fork to a model, line by line. */
const opened = async (q: Quilt) => (await runTool(q, 'quilt_open', { link: fork })).text.split('\n');
const inheritedLine = (states: string) =>
  `Inherited (QX-23): for 2 of the pieces the square stands on a problem this fork came from: on ${p}, ${states}. Their returns are on the record there, and none is counted among this problem's own accepted squares.`;

let p: Hash, fork: Hash;
let s1: Hash, s2: Hash, summary: Hash;
/** What the blind client's fetch saw: the pieces the tracker's next named it, and the requests for the source. */
const seen = { named: [] as (Hash | null)[], refused: 0 };

beforeAll(async () => {
  ({ server, base } = await startTracker({
    limits: { keyPerHour: 1000, ipPerHour: 10000 },
    now: () => new Date((tick += 1000)).toISOString(),
  }));
  const mk = quiltOver(base);
  owner = mk(9);
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  forker = mk(4);
  c = mk(5, 'anthropic/claude');
  d = mk(6, 'openai/gpt-5', 'ChatGPT');

  p = (await owner.publish(pattern)).hash;
  const pieces = (await owner.open(p)).state.pieces;
  const hashOf = (name: string) => pieces.find((v) => v.piece.name === name)!.piece.hash;
  [s1, s2, summary] = [hashOf('statement/1'), hashOf('statement/2'), hashOf('summary')];

  // Both statements accepted at the source, each by two vendors, inside their windows.
  for (const piece of [s1, s2]) for (const q of [a, b]) await q.return(p, piece, { verdict: 'supports' });
  fork = (await forker.fork(p)).hash!;

  // A client in a home of its own that no place answers for the source: every request naming the source's hash is
  // answered 404, and every other goes to the tracker as it is.
  const config: Config = { ...DEFAULT_CONFIG, trackers: [base], model: 'anthropic/claude' };
  const home = tempHome('quilt-blind-');
  createKey(home, { secretHex: hex(7) });
  const withoutSource: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes(p)) {
      seen.refused += 1;
      return new Response(JSON.stringify({ error: 'no such problem here' }), { status: 404 });
    }
    const answered = await fetch(input, init);
    if (url.includes('/next?')) seen.named.push(((await answered.clone().json()) as NextAnswer).piece);
    return answered;
  };
  blind = new Quilt(config, loadKey(home), new Resolver(config, home, withoutSource), 'Claude Code');
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("a fork while the source's squares are provisional (QX-23 section 3)", () => {
  it('keeps every piece under its hash, and the source has its two squares', async () => {
    expect(fork).not.toBe(p);
    expect((await c.open(fork)).state.pieces.map((v) => v.piece.hash)).toEqual([s1, s2, summary]);
    expect((await trackerState(p)).map((x) => x.state)).toEqual([
      'accepted_provisional',
      'accepted_provisional',
      'locked',
    ]);
  });

  it('marks the kept pieces inherited in the map a model reads, and names the problem their squares stand on', async () => {
    const lines = await opened(c);
    expect(lines[0]).toBe(`Problem ${fork}`);
    expect(lines.slice(3, 7)).toEqual([
      '3 pieces, version 1 along prev.',
      '^^l',
      '2 inherited, 1 locked',
      inheritedLine('2 accepted provisional'),
    ]);
    expect(lines.find((l) => l.startsWith('Legend: '))).toContain(
      '^ inherited, its square standing on a problem the fork came from',
    );
  });

  it("hands nothing: the tracker names no piece, and the map's pick leaves out the inherited pieces", async () => {
    // This client's own fold holds the two statements open and would hand one over.
    expect((await c.open(fork)).state.pieces.map((v) => v.state)).toEqual(['open', 'open', 'locked']);
    expect((await trackerNext(fork, c)).piece).toBeNull();
    await expect(c.next(fork)).rejects.toThrow(NOTHING);
    expect((await trackerState(fork)).map((x) => x.state)).toEqual(['inherited', 'inherited', 'locked']);
  });
});

describe("a fork once the source's windows have closed (QX-23 sections 3 and 5)", () => {
  /** The tracker's own answer for the key that then takes the piece. */
  let named: NextAnswer;

  beforeAll(() => {
    tick += 49 * HOUR;
  });

  it('says the squares are final where they stand, and the piece that waited on them open', async () => {
    expect((await opened(c)).slice(4, 7)).toEqual(['^^.', '2 inherited, 1 open', inheritedLine('2 accepted')]);
    // The card's reader carries the mark on each inherited piece and none on the other.
    const card = await windowAnswer(c, { op: 'open', link: fork });
    expect(card.op === 'open' && card.pieces.map((x) => [x.name, x.state, x.core, x.inherited])).toEqual([
      ['statement/1', 'inherited', 'open', { problem: p, state: 'accepted' }],
      ['statement/2', 'inherited', 'open', { problem: p, state: 'accepted' }],
      ['summary', 'open', 'locked', null],
    ]);
  });

  it("does not take the piece on the tracker's word where it cannot read the source itself", async () => {
    await expect(blind.next(fork)).rejects.toThrow(NOTHING);
    // The tracker named the piece, and this client asked for the source and was not answered.
    expect(seen.named).toEqual([summary]);
    expect(seen.refused).toBeGreaterThan(0);
    // Nothing was claimed: the piece is as it was.
    expect((await trackerState(fork)).map((x) => x.state)).toEqual(['inherited', 'inherited', 'open']);
    expect(blind.library.pieces[summary]).toBeUndefined();
    // The tracker holds what it named for that key a minute, which passes before another key asks.
    tick += 10 * 60_000;
  });

  it("is handed the piece that waited, never an inherited one, its brief rendered here and equal to the tracker's own", async () => {
    named = await trackerNext(fork, c);
    expect(named).toMatchObject({ piece: summary, name: 'summary', state: 'open' });

    // This client's own fold still holds the piece locked: the pick is on the tracker's word.
    expect((await c.open(fork)).state.byHash.get(summary)!.state).toBe('locked');
    const handed = await c.next(fork);
    expect(handed.hash).toBe(fork);
    expect(handed.pick.piece).toMatchObject({ name: 'summary', hash: summary });
    expect(handed.pick.state).toBe('open');

    // The source's returns fill the slot as quoted text, each with its signer's address, in the source's order.
    const said = (name: string, by: Quilt) => `${name}, by ${address(by)}: {"verdict":"supports"}`;
    expect(handed.pick.brief).toBe(
      ASKED +
        [said('statement/1', a), said('statement/1', b), said('statement/2', a), said('statement/2', b)].join('\n'),
    );
    expect(handed.pick.brief).toBe(named.brief);
    // What a model reads of the piece quotes that brief as the author's, the returns inside it.
    expect(c.pieceText(fork, handed.pick, handed.owner, handed.stake)).toContain(`wrote this brief: "${named.brief}"`);

    // The claim was admitted at the door.
    expect(handed.posted).toEqual({ at: base, queued: false });
    expect(c.library.pieces[summary]).toMatchObject({ problem: fork, name: 'summary', what: 'claimed' });
    expect((await trackerState(fork)).map((x) => x.state)).toEqual(['inherited', 'inherited', 'in_flight']);
  });

  it("has its commit and its reveal admitted, and a second vendor's reading makes a square of the fork's own", async () => {
    const first = await c.return(fork, summary, { verdict: 'supports' });
    expect(first.commit).toEqual({ at: base, queued: false });
    expect(first.reveal).toEqual({ at: base, queued: false });
    expect((await trackerState(fork)).map((x) => x.state)).toEqual(['inherited', 'inherited', 'needs_verify']);

    // The second reader is handed the same piece the same way, with the same brief.
    tick += 10 * 60_000;
    const handed = await d.next(fork);
    expect(handed.pick.piece.hash).toBe(summary);
    expect(handed.pick.state).toBe('needs_verify');
    expect(handed.pick.brief).toBe(named.brief);
    expect(handed.posted).toEqual({ at: base, queued: false });
    const second = await d.return(fork, summary, { verdict: 'supports' });
    expect(second.commit).toEqual({ at: base, queued: false });
    expect(second.reveal).toEqual({ at: base, queued: false });
    expect(second.waits).toContain('Two vendors agree');

    // The fork's own square is counted under its own state, beside the inherited ones and not among them.
    expect((await opened(c)).slice(4, 7)).toEqual([
      '^^p',
      '2 inherited, 1 accepted provisional',
      inheritedLine('2 accepted'),
    ]);
    const read = (await runTool(c, 'quilt_read', { problem: fork })).text;
    expect(read.split('\n').slice(4, 7)).toEqual([
      '^^p',
      '2 inherited, 1 accepted provisional',
      inheritedLine('2 accepted'),
    ]);
    // What was accepted on the fork is the fork's own piece alone.
    const accepted = read.split('\n\n').find((part) => part.startsWith('Accepted so far'))!;
    expect(accepted).toContain('summary');
    expect(accepted).not.toContain('statement/1');
  });

  it('is handed nothing more: the inherited pieces stay out of every pick', async () => {
    tick += 10 * 60_000;
    expect((await trackerNext(fork, blind)).piece).toBeNull();
    await expect(a.next(fork)).rejects.toThrow(NOTHING);
  });
});
