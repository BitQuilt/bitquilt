import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash, PieceDef } from '@bitquilt/core';
import * as tracker from '@bitquilt/tracker';
import { parseLink } from '../src/link.js';
import { ownerTurn, takenText } from '../src/owner-turn.js';
import * as client from '../src/propose.js';
import type { Pattern, Quilt } from '../src/quilt.js';
import { runTool } from '../src/tools.js';
import { json, quiltOver, startTracker } from './helpers.js';

/*
 * Proposed pieces from the client's side, over a booted tracker (docs/ext/QX-22.md). The rules the client writes a
 * second time are held to the tracker's answers: a body's faults, the two bounds, the hash a proposed piece has, and
 * the proposals that stand (QX-22 sections 1 and 2). Then a piece proposed, its faults said before anything is
 * signed, and what quilt_read says of it (QX-22 sections 3 and 5); the owner's take by default and by name, with the
 * version it publishes and what the tracker says of each piece after it (QX-22 section 4); and the take in the
 * owner's turn, with its words for the log, which leaves the library's dates as they were.
 */

let server: Server;
let base: string;
let owner: Quilt, a: Quilt, b: Quilt, c: Quilt, second: Quilt;

const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'contradicts'] } },
};
const agree = { verifier: 'agree', requires: ['web' as const], schema, agree: ['verdict'] };

/** A pattern of one family of two statements, under its own slug, with the settings given over the defaults. */
const pattern = (slug: string, settings: Pattern['settings'] = {}): Pattern => ({
  title: 'What a paper says',
  done_when: 'Every statement has a verdict two readers agree on.',
  slug,
  settings: { endgame_at: 1, ...settings },
  pieces: { 'statement/*': { ...agree, count: 2, brief: 'Statement {n}: does the paper say so?' } },
});

const method: PieceDef = { ...agree, brief: 'Does the paper say how the sample was drawn?', inputs: ['statement/*'] };
const funding: PieceDef = { ...agree, brief: 'Does the paper say who paid for the work?' };
const sample: PieceDef = { ...agree, brief: 'Does the paper give the size of its sample?' };
const oracle: PieceDef = { ...agree, verifier: 'oracle:1', brief: 'What would an oracle say of the paper?' };
const other: PieceDef = { ...agree, brief: 'Does the paper name its method at all?' };
const WHY = 'The statements rest on a sample the pattern never asks about.';

const NO_WORK = 'its proposer has no work standing on the problem';
const UNKNOWN_KIND = 'its kind is one this client does not implement';
const NAME_HELD = 'the problem has a piece of that name';
const NO_ROOM = 'the budget has no room for it';

const A_HASH = /^sha256:[0-9a-f]{64}$/;
type StateView = { pieces: { hash: Hash; state: string }[]; superseded?: Hash | null };
const trackerState = (of: Hash) => json<StateView>(`${base}p/${of}/state`);
const address = (q: Quilt) => q.identity!.address;

/**
 * A clock a few seconds ahead. A receipt's stamp can run a millisecond ahead of this process's clock, and a proposal
 * received after the moment a take reads at is passed over.
 */
const later = () => new Date(Date.now() + 5_000).toISOString();

/** What a take says of one proposed piece. */
const said = (r: client.Proposed, by: Quilt, taken: boolean, why: string | null) => ({
  id: r.id,
  name: r.name,
  piece: r.piece,
  by: address(by),
  taken,
  why,
});

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  const mk = quiltOver(base);
  owner = mk(9);
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  c = mk(3, 'anthropic/claude');
  second = mk(10);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the rules the client writes a second time', () => {
  const bodies: unknown[] = [
    { name: 'method', piece: method, why: WHY },
    null,
    'a piece',
    { name: 'Method', piece: method, why: WHY },
    { name: 'statement/3', piece: method, why: WHY },
    { name: 'method', why: WHY },
    { name: 'method', piece: { ...method, count: 2 }, why: WHY },
    { name: 'method', piece: { ...method, data: { paper: 'paper.txt' } }, why: WHY },
    { name: 'method', piece: { ...method, brief: 'word '.repeat(4000) }, why: WHY },
    { name: 'method', piece: { ...method, inputs: ['statement/*', 'method'] }, why: WHY },
    { name: 'method', piece: { ...method, brief: 'Read https://example.org/paper and say.' }, why: WHY },
    { name: 'method', piece: method },
    { name: 'method', piece: method, why: '   ' },
    { name: 'method', piece: method, why: 'so '.repeat(167) },
    { name: 'method', piece: method, why: 'See https://example.org/why for the reason.' },
    { name: 'method', piece: method, why: WHY, stake: 5 },
    { name: 'Method', piece: { ...method, count: 2 }, why: '', more: 1 },
  ];

  it("say a body's faults in the tracker's words and order, and none of a body with none", () => {
    for (const [i, body] of bodies.entries()) {
      const faults = client.proposeBodyProblems(body);
      expect(faults, `body ${i}`).toEqual(tracker.proposeBodyProblems(body));
      expect(faults.length > 0, `body ${i}`).toBe(i > 0);
    }
  });

  it('keep the same two bounds, and name a proposed piece by the same hash', () => {
    expect(client.PROPOSE_WHY_MAX).toBe(tracker.PROPOSE_WHY_MAX);
    expect(client.PROPOSED_MAX).toBe(tracker.PROPOSED_MAX);
    const pieces: [string, PieceDef][] = [
      ['method', method],
      ['sample', method],
      ['method', other],
      ['oracle', oracle],
    ];
    for (const [name, piece] of pieces) {
      expect(client.proposedHash(name, piece)).toMatch(A_HASH);
      expect(client.proposedHash(name, piece)).toBe(tracker.proposedHash(name, piece));
    }
    expect(client.proposedHash('method', method)).not.toBe(client.proposedHash('sample', method));
    expect(client.proposedHash('method', method)).not.toBe(client.proposedHash('method', other));
    const none = {} as PieceDef;
    expect(client.proposedHash('method', none)).toBe(tracker.proposedHash('method', none));
  });
});

describe('a piece proposed', () => {
  let p: Hash;
  let hash: Hash;
  let id: Hash;

  beforeAll(async () => {
    p = (await owner.publish(pattern('paper'))).hash;
  });

  it('is signed and posted beside the problem, its reason trimmed, and answered with the hash the piece has', async () => {
    const r = await a.propose(p, 'method', method, `  ${WHY}  `);
    hash = client.proposedHash('method', method)!;
    id = r.id;
    expect(r).toEqual({
      at: base,
      queued: false,
      id: expect.stringMatching(A_HASH),
      problem: p,
      name: 'method',
      piece: hash,
    });
    expect(await owner.proposals(p)).toEqual([
      {
        id,
        under: p,
        name: 'method',
        hash,
        piece: method,
        why: WHY,
        key: address(a),
        root: address(a),
        at: expect.stringMatching(/^20\d\d-/),
        proposer: null,
        worked: false,
        taken: null,
        pursued: [],
      },
    ]);
  });

  it('has every fault said before anything is signed, and a root proposes a piece once', async () => {
    await expect(a.propose(p, 'statement', method, WHY)).rejects.toThrow(
      '1 problem in the proposed piece, each to fix before it is proposed:\nbody.name: this problem has a family named statement',
    );
    await expect(a.propose(p, 'Method', method, '  ')).rejects.toThrow(
      /^2 problems in the proposed piece, each to fix before it is proposed:\nbody\.name: .+\nbody\.why: text of at most 500 characters$/,
    );
    await expect(a.propose(p, 'sample', { ...method, agree: ['quote'] }, WHY)).rejects.toThrow(
      'body.piece.agree: names fields the schema has',
    );
    await expect(a.propose(p, 'sample', { ...method, inputs: ['nowhere'] }, WHY)).rejects.toThrow(
      'body.piece.inputs: nowhere is not a piece of this problem',
    );
    await expect(a.propose(p, 'method', method, 'Asked a second time.')).rejects.toThrow(
      'the tracker refused the proposed piece: this root already proposed this piece',
    );
    expect((await owner.proposals(p)).map((x) => x.id)).toEqual([id]);
  });

  it('is said by quilt_read under its own heading, its words quoted with the signer named, and listed in the handles', async () => {
    const read = await runTool(owner, 'quilt_read', { problem: p });
    const who = address(a);
    expect(read.text).toContain(
      [
        'Proposed pieces:',
        `A piece proposed under the name "method" (${hash}) by ${who}, with no work standing on this problem, waits: no version of the problem holds it.`,
        `${who} wrote as the reason: "${WHY}"`,
        `${who} wrote this brief: "${method.brief}"`,
        'Its verifier is agree; a square of this kind is ',
      ].join('\n'),
    );
    expect(read.handles).toMatchObject({ problem: p, proposed: [{ id, piece: hash, taken: null }] });
    const bare = (await owner.publish(pattern('paper-bare'))).hash;
    const none = await runTool(owner, 'quilt_read', { problem: bare });
    expect(none.text).not.toContain('Proposed pieces');
    expect(none.handles).toMatchObject({ problem: bare, proposed: [] });
  });
});

describe("the owner's take", () => {
  let p1: Hash, first: Hash;
  let own: client.Proposed, m1: client.Proposed, s: client.Proposed, o: client.Proposed, m2: client.Proposed;
  let newer: Hash, third: Hash, fourth: Hash;

  beforeAll(async () => {
    p1 = (await owner.publish(pattern('paper-one'))).hash;
    first = (await a.open(p1)).state.pieces[0]!.piece.hash;
    await a.return(p1, first, { verdict: 'supports' });
    await b.return(p1, first, { verdict: 'supports' });
    own = await owner.propose(p1, 'own', funding, 'The owner sees a gap in the pattern.');
    m1 = await a.propose(p1, 'method', method, WHY);
    s = await c.propose(p1, 'stranger', sample, 'A reader who did no work here asks for it.');
    o = await a.propose(p1, 'oracle', oracle, 'A kind of check this client has not heard of.');
    m2 = await b.propose(p1, 'method', other, 'The same name, and another question under it.');
  });

  it('starts from a square two readers of different vendors made', async () => {
    expect((await trackerState(p1)).pieces.find((x) => x.hash === first)?.state).toBe('accepted_provisional');
  });

  it('reads the proposals that stand from the signed lines, the same ones the tracker lists', async () => {
    const resolved = (await owner.resolver.resolve(parseLink(p1)))!;
    const { state } = await owner.open(p1);
    const now = later();
    const standing = client.standingProposals(resolved.receipts, state.rootOf, now);
    expect(standing).toEqual(tracker.standingProposals(resolved.receipts, state.rootOf, now));
    expect(standing.map((x) => x.id)).toEqual([own.id, m1.id, s.id, o.id, m2.id]);
    expect((await owner.proposals(p1)).map((x) => x.id)).toEqual(standing.map((x) => x.id));
    expect(m2.piece).not.toBe(m1.piece);
  });

  it("takes its own and a worker's by default, in receipt order, and says why each of the rest is left", async () => {
    const taken = await owner.take(p1, [], later());
    newer = taken.hash!;
    expect(taken).toEqual({
      problem: p1,
      pieces: [
        said(own, owner, true, null),
        said(m1, a, true, null),
        said(s, c, false, NO_WORK),
        said(o, a, false, UNKNOWN_KIND),
        said(m2, b, false, NAME_HELD),
      ],
      hash: expect.stringMatching(A_HASH),
      posted: [base],
      refused: [],
    });
    expect(newer).not.toBe(p1);
  });

  it('publishes a version that follows the problem, the pieces under their names, the settings and squares kept', async () => {
    const before = (await owner.open(p1)).state.envelope.problem;
    const { state } = await owner.open(newer);
    const now = state.envelope.problem;
    expect(now.prev).toBe(p1);
    expect(Object.keys(now.pieces).sort()).toEqual(['method', 'own', 'statement/*']);
    expect(now.pieces.method).toEqual(method);
    expect(now.pieces.own).toEqual(funding);
    expect(now.settings).toEqual(before.settings);
    expect(state.pieces.map((x) => x.piece.hash)).toEqual(expect.arrayContaining([first, own.piece, m1.piece]));
    expect((await trackerState(p1)).superseded).toBe(newer);
    expect((await trackerState(newer)).pieces.find((x) => x.hash === first)?.state).toBe('accepted_provisional');
    expect(owner.library.problems[p1]!.next).toBe(newer);
  });

  it('is said by the tracker at the new version: which version took each piece, and whose work stands', async () => {
    const listed = await owner.proposals(newer);
    expect(listed.map((x) => [x.id, x.under, x.taken, x.worked])).toEqual([
      [own.id, p1, newer, false],
      [m1.id, p1, newer, true],
      [s.id, p1, null, false],
      [o.id, p1, null, true],
      [m2.id, p1, null, true],
    ]);
    // Read at the version the proposals name, the line ends there, and no later version is in it.
    expect((await owner.proposals(p1)).map((x) => x.taken)).toEqual([null, null, null, null, null]);
  });

  it('leaves a replaced problem as it is and says where the work went, and is the owner alone', async () => {
    expect(await owner.take(p1, [], later())).toEqual({
      problem: p1,
      pieces: [],
      hash: newer,
      posted: [],
      refused: [],
    });
    await expect(a.propose(p1, 'more', sample, WHY)).rejects.toThrow(
      `that problem was replaced by its owner; the work is on ${newer}`,
    );
    await expect(a.take(newer, [], later())).rejects.toThrow('only the owner takes a proposed piece');
  });

  it('takes nothing more by default where nothing more is its to take, and publishes nothing', async () => {
    expect(await owner.take(newer, [], later())).toEqual({
      problem: newer,
      pieces: [said(s, c, false, NO_WORK), said(o, a, false, UNKNOWN_KIND), said(m2, b, false, NAME_HELD)],
      hash: null,
      posted: [],
      refused: [],
    });
    expect((await trackerState(newer)).superseded ?? null).toBeNull();
  });

  it('takes by name any piece that waits, found by its name, its hash or its event, but not under a name held', async () => {
    await expect(owner.take(newer, ['nothing'], later())).rejects.toThrow(
      'no proposed piece waits on that problem under nothing',
    );
    const byName = await owner.take(newer, ['stranger'], later());
    third = byName.hash!;
    expect(byName).toEqual({
      problem: newer,
      pieces: [said(s, c, true, null)],
      hash: expect.stringMatching(A_HASH),
      posted: [base],
      refused: [],
    });
    const byHash = await owner.take(third, [o.piece], later());
    fourth = byHash.hash!;
    expect(byHash).toEqual({
      problem: third,
      pieces: [said(o, a, true, null)],
      hash: expect.stringMatching(A_HASH),
      posted: [base],
      refused: [],
    });
    expect(await owner.take(fourth, [m2.id], later())).toEqual({
      problem: fourth,
      pieces: [said(m2, b, false, NAME_HELD)],
      hash: null,
      posted: [],
      refused: [],
    });
    const head = (await owner.open(fourth)).state.envelope.problem;
    expect(Object.keys(head.pieces).sort()).toEqual(['method', 'oracle', 'own', 'statement/*', 'stranger']);
    expect(head.pieces.method).toEqual(method);
    expect((await owner.proposals(fourth)).map((x) => x.taken)).toEqual([newer, newer, third, fourth, null]);
  });

  it('stays inside the budget by default, and raises it to fit a piece taken by name', async () => {
    const p2 = (await owner.publish(pattern('paper-two', { budget: 2 }))).hash;
    const mine = await owner.propose(p2, 'own', funding, 'The owner sees a gap in the pattern.');
    expect(await owner.take(p2, [], later())).toEqual({
      problem: p2,
      pieces: [said(mine, owner, false, NO_ROOM)],
      hash: null,
      posted: [],
      refused: [],
    });
    const named = await owner.take(p2, ['own'], later());
    expect(named.pieces).toEqual([said(mine, owner, true, null)]);
    expect((await owner.open(named.hash!)).state.envelope.problem.settings.budget).toBe(3);
  });

  it('adds a piece two roots proposed once, and says both taken', async () => {
    const p4 = (await owner.publish(pattern('paper-four'))).hash;
    const statement = (await a.open(p4)).state.pieces[0]!.piece.hash;
    await a.return(p4, statement, { verdict: 'contradicts' });
    await b.return(p4, statement, { verdict: 'contradicts' });
    const one = await a.propose(p4, 'method', method, WHY);
    const two = await b.propose(p4, 'method', method, 'The second reader asks the same of it.');
    expect(two.piece).toBe(one.piece);
    const taken = await owner.take(p4, [], later());
    expect(taken.pieces).toEqual([said(one, a, true, null), said(two, b, true, null)]);
    const head = (await owner.open(taken.hash!)).state.envelope.problem;
    expect(Object.keys(head.pieces).sort()).toEqual(['method', 'statement/*']);
    expect((await owner.proposals(taken.hash!)).map((x) => x.taken)).toEqual([taken.hash, taken.hash]);
  });
});

describe("the take in the owner's turn", () => {
  let cold: Hash, quiet: Hash;
  let mine: client.Proposed;
  const turn = (lines: string[]) =>
    ownerTurn(
      second,
      null,
      (l) => lines.push(l),
      () => new Date(Date.now() + 5_000),
    );

  beforeAll(async () => {
    cold = (await second.publish(pattern('cold'))).hash;
    quiet = (await second.publish(pattern('quiet'))).hash;
    mine = await second.propose(cold, 'own', funding, 'The owner sees a gap in the pattern.');
    await c.propose(quiet, 'stranger', sample, 'A reader who did no work here asks for it.');
  });

  it('gives a frozen problem no version, and reports no problem where nothing was taken', async () => {
    expect((await second.freeze(cold)).frozen).toMatch(/^20\d\d-/);
    await expect(second.take(cold, [], later())).rejects.toThrow(/frozen in this home/);
    expect(await second.takeDue(later())).toEqual([]);
    expect((await trackerState(cold)).superseded ?? null).toBeNull();
    expect((await trackerState(quiet)).superseded ?? null).toBeNull();
  });

  it('takes what waits once the problem is thawed, says it in a few words, and takes nothing the turn after', async () => {
    expect(await second.freeze(cold, false)).toEqual({ problem: cold, frozen: null });
    const opened = { cold: second.library.problems[cold]!.last, quiet: second.library.problems[quiet]!.last };
    const lines: string[] = [];
    const t = await turn(lines);
    expect(t.taken).toEqual([
      {
        problem: cold,
        pieces: [said(mine, second, true, null)],
        hash: expect.stringMatching(A_HASH),
        posted: [base],
        refused: [],
      },
    ]);
    expect(takenText(t.taken)).toBe('taken: 1 proposed piece');
    expect(t.said).toContain('taken: 1 proposed piece');
    expect(lines.filter((l) => l.includes('not run'))).toEqual([]);
    expect((await trackerState(cold)).superseded).toBe(t.taken[0]!.hash);
    const again = await turn(lines);
    expect(again.taken).toEqual([]);
    expect(again.said).not.toContain('taken');
    expect(lines.filter((l) => l.includes('not run'))).toEqual([]);
    // The turn's reads are the node's own. The library keeps the time the person last opened each problem, the one
    // replaced and the one read and left, and the version published is noted as of its publishing.
    expect(second.library.problems[cold]).toMatchObject({ last: opened.cold, next: t.taken[0]!.hash });
    expect(second.library.problems[quiet]!.last).toBe(opened.quiet);
    expect(second.library.problems[t.taken[0]!.hash!]!.last > opened.cold).toBe(true);
  });

  it('says nothing of a turn that took nothing, and counts a refusal', () => {
    expect(takenText([])).toBe('');
    expect(takenText([{ problem: cold, pieces: [], hash: null, posted: [], refused: ['the door was shut'] }])).toBe(
      'taken: 0 proposed pieces, 1 refused',
    );
  });
});
