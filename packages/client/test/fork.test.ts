/**
 * The fork a client publishes, over a booted tracker: the client's sentence of QX-23 section 5, with the proposed
 * pieces of QX-22 it adds (docs/ext/QX-23.md, docs/ext/QX-22.md). A plain fork names the problem as its `from`, has no
 * `prev` and this home's key as its owner, and keeps every piece and the data as they are, so each piece has on the
 * fork the hash it had on the problem. Each proposed piece named, by its name, its hash or its propose event's id, is
 * on the fork under its proposal's name and hash, with the budget raised to fit, and the tracker then lists the fork
 * as pursuing that proposal (QX-22 section 3). A name no standing proposal answers to, and a second piece under a
 * name the fork holds, are said before anything is signed or posted. The owner's own fork is the door's to refuse, a
 * version the owner replaced is forked as it was, and the command line prints what the Quilt's `fork` answers.
 */
import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash, PieceDef } from '@bitquilt/core';
import { type Config, DEFAULT_CONFIG, createKey, loadKey } from '../src/config.js';
import { parseLink } from '../src/link.js';
import * as client from '../src/propose.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { hex, json, quiltOver, startTracker, tempHome } from './helpers.js';

let server: Server;
let base: string;
let owner: Quilt, a: Quilt, b: Quilt, forker: Quilt, second: Quilt, third: Quilt;
/** How many requests the forker's Quilt has posted. */
let posts = 0;

const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'contradicts'] } },
};
const agree = { verifier: 'agree', requires: ['web' as const], schema, agree: ['verdict'] };

/** A pattern of one family of two statements over two rows of data, with two pieces of room and its topics. */
const pattern: Pattern = {
  title: 'What a paper says',
  done_when: 'Every statement has a verdict two readers agree on.',
  slug: 'paper-forked',
  topics: ['papers', 'replication'],
  settings: { endgame_at: 1, budget: 2 },
  pieces: {
    'statement/*': { ...agree, count: 2, data: { claim: 'claims' }, brief: 'Statement {n}: {claim.text} Is it so?' },
  },
  data: { claims: [{ text: 'The sample was drawn at random.' }, { text: 'The effect held a year on.' }] },
};

const method: PieceDef = { ...agree, brief: 'Does the paper say how the sample was drawn?', inputs: ['statement/*'] };
const funding: PieceDef = { ...agree, brief: 'Does the paper say who paid for the work?' };
const rival: PieceDef = { ...agree, brief: 'Does the paper name its method at all?' };
const WHY = 'The statements rest on a sample the pattern never asks about.';

const A_HASH = /^sha256:[0-9a-f]{64}$/;
type StateView = { pieces: { hash: Hash; state: string }[] };
type IndexView = { problems: { problem: Hash; from: Hash | null; owner: string; topics: string[]; pieces: number }[] };
type Listed = { id: Hash; pursued: Hash[] };
const trackerState = (of: Hash) => json<StateView>(`${base}p/${of}/state`);
const index = async () => (await json<IndexView>(base)).problems;
/** What the tracker says pursues each proposal on a problem, by the propose event's id. */
const pursued = async (of: Hash) =>
  Object.fromEntries(
    (await json<{ proposals: Listed[] }>(`${base}p/${of}/proposals`)).proposals.map((x) => [x.id, x.pursued]),
  );
const address = (q: Quilt) => q.identity!.address;
const sorted = (hashes: Hash[]) => [...hashes].sort();

/**
 * A clock a few seconds ahead. A receipt's stamp can run a millisecond ahead of this process's clock, and a proposal
 * received after the moment a fork reads at is passed over.
 */
const later = () => new Date(Date.now() + 5_000).toISOString();

/** What a fork says of one proposed piece it added. */
const said = (r: client.Proposed, by: Quilt) => ({ id: r.id, name: r.name, piece: r.piece, by: address(by) });

let p: Hash;
let kept: Hash[];
let m: client.Proposed, f: client.Proposed, r2: client.Proposed;
let plain: client.Forked, withMethod: client.Forked;

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  const mk = quiltOver(base);
  owner = mk(9);
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  second = mk(5);
  third = mk(6);
  // The forker's Quilt counts what it posts, so a refusal before anything is signed is seen to post nothing.
  const config: Config = { ...DEFAULT_CONFIG, trackers: [base] };
  const home = tempHome('quilt-forker-');
  createKey(home, { secretHex: hex(4) });
  const counting: typeof fetch = (input, init) => {
    if (init?.method === 'POST') posts += 1;
    return fetch(input, init);
  };
  forker = new Quilt(config, loadKey(home), new Resolver(config, home, counting), 'Claude Code');

  p = (await owner.publish(pattern)).hash;
  kept = (await owner.open(p)).state.pieces.map((v) => v.piece.hash);
  m = await a.propose(p, 'method', method, WHY);
  f = await b.propose(p, 'funding', funding, WHY);
  r2 = await b.propose(p, 'method', rival, WHY);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("a fork under this home's key (QX-23 section 5)", () => {
  it('publishes a plain fork: `from` the problem, no `prev`, this key the owner, and every piece under its hash', async () => {
    const was = (await forker.open(p)).state;
    plain = await forker.fork(p);
    expect(plain).toEqual({
      from: p,
      hash: expect.stringMatching(A_HASH),
      link: expect.stringContaining('quilt:sha256:'),
      kept: 2,
      added: [],
      posted: [base],
      refused: [],
    });
    expect(plain.hash).not.toBe(p);
    expect(parseLink(plain.link!).hash).toBe(plain.hash);

    // The envelope is the problem's with three fields changed, so the title, the slug, the settings, the pieces and
    // the data are as they were.
    const { state } = await forker.open(plain.hash!);
    expect(state.envelope.problem).toEqual({ ...was.envelope.problem, owner: address(forker), prev: null, from: p });
    expect(was.envelope.problem.owner).toBe(address(owner));

    // Every piece is on the fork under the name and the hash it had, its brief filled from the same rows.
    expect(kept).toHaveLength(2);
    expect(state.pieces.map((v) => [v.piece.name, v.piece.hash, v.piece.brief])).toEqual(
      was.pieces.map((v) => [v.piece.name, v.piece.hash, v.piece.brief]),
    );
    expect(state.pieces[0]!.piece.brief).toContain('The sample was drawn at random.');
    expect((await trackerState(plain.hash!)).pieces.map((x) => x.hash)).toEqual(kept);

    // The tracker lists it as a fork of the problem, under the topics of the owner's announce.
    const row = (await index()).find((x) => x.problem === plain.hash);
    expect(row).toMatchObject({ from: p, owner: address(forker), pieces: 2 });
    expect(sorted(row!.topics as Hash[])).toEqual(['papers', 'replication']);

    // A fork replaces nothing: this home's library holds both, and notes no version in the problem's place.
    expect(forker.library.problems[p]?.next).toBeUndefined();
    expect(forker.library.problems[plain.hash!]).toMatchObject({ slug: 'paper-forked', trackers: [base] });
    // It holds no proposed piece, so it pursues none.
    expect(await pursued(p)).toEqual({ [m.id]: [], [f.id]: [], [r2.id]: [] });
  });

  it('adds a proposed piece named, under its name and the hash the proposal has, and the tracker lists the fork', async () => {
    withMethod = await forker.fork(p, ['method'], later());
    expect(withMethod).toEqual({
      from: p,
      hash: expect.stringMatching(A_HASH),
      link: expect.stringContaining('quilt:sha256:'),
      kept: 2,
      added: [said(m, a)],
      posted: [base],
      refused: [],
    });
    expect(m.piece).toBe(client.proposedHash('method', method));

    const { state } = await forker.open(withMethod.hash!);
    const now = state.envelope.problem;
    expect([now.owner, now.prev, now.from]).toEqual([address(forker), null, p]);
    // The piece is the proposal's, as proposed, beside the pieces kept; the budget is raised to hold it.
    expect(now.pieces).toEqual({ ...pattern.pieces, method });
    expect(now.settings).toEqual({ ...(await owner.open(p)).state.envelope.problem.settings, budget: 3 });
    expect(sorted(state.pieces.map((v) => v.piece.hash))).toEqual(sorted([...kept, m.piece]));
    expect(state.pieces.find((v) => v.piece.name === 'method')!.piece.hash).toBe(m.piece);
    expect(sorted((await trackerState(withMethod.hash!)).pieces.map((x) => x.hash))).toEqual(
      sorted([...kept, m.piece]),
    );

    // QX-22 section 3: the forks of the line whose envelopes hold a piece of that hash.
    expect(await pursued(p)).toEqual({ [m.id]: [withMethod.hash], [f.id]: [], [r2.id]: [] });
  });

  it("finds a piece by its propose event's id or its hash, the second piece of a name among them", async () => {
    const forked = await second.fork(p, [r2.piece, f.id], later());
    // In receipt order, whatever order the names came in.
    expect(forked.added).toEqual([said(f, b), said(r2, b)]);
    const { state } = await second.open(forked.hash!);
    expect(state.envelope.problem.pieces).toEqual({ ...pattern.pieces, funding, method: rival });
    expect(state.envelope.problem.settings.budget).toBe(4);
    expect(sorted(state.pieces.map((v) => v.piece.hash))).toEqual(sorted([...kept, f.piece, r2.piece]));
    expect(await pursued(p)).toEqual({ [m.id]: [withMethod.hash], [f.id]: [forked.hash], [r2.id]: [forked.hash] });
  });

  it('says each fault before anything is signed or posted', async () => {
    const held = (await index()).length;
    const library = Object.keys(forker.library.problems).sort();
    const before = posts;
    expect(before).toBeGreaterThan(0);

    await expect(forker.fork(p, ['nothing'], later())).rejects.toThrow(
      'no proposed piece stands on that problem under nothing',
    );
    // A piece of the problem's own is no proposed piece, by its name or by its hash.
    await expect(forker.fork(p, ['statement/1'], later())).rejects.toThrow(
      'no proposed piece stands on that problem under statement/1',
    );
    await expect(forker.fork(p, [kept[0]!], later())).rejects.toThrow(
      `no proposed piece stands on that problem under ${kept[0]}`,
    );

    // Every fault at once: two names nothing answers to, and two pieces proposed under one name, of which a fork
    // holds one. One fault publishes nothing, the pieces that fit among it.
    const faults = await forker.fork(p, [m.piece, 'nothing', r2.id, 'funding', 'nor-this'], later()).then(
      () => '',
      (e: Error) => e.message,
    );
    expect(faults.split('\n')).toEqual([
      'no proposed piece stands on that problem under nothing',
      'no proposed piece stands on that problem under nor-this',
      'method: the problem has a piece of that name',
    ]);

    expect(posts).toBe(before);
    expect((await index()).length).toBe(held);
    expect(Object.keys(forker.library.problems).sort()).toEqual(library);
    expect(await pursued(p)).toMatchObject({ [m.id]: [withMethod.hash] });
  });

  it("leaves the owner's own fork to the door, which refuses it in its own words", async () => {
    const held = (await index()).length;
    const forked = await owner.fork(p);
    expect(forked).toEqual({
      from: p,
      hash: null,
      link: null,
      kept: 2,
      added: [],
      posted: [],
      refused: [`${base}: from: by the same owner; a version sets prev`],
    });
    expect((await index()).length).toBe(held);
    expect(owner.library.problems[p]?.next).toBeUndefined();
  });

  it('forks the version named as it was, where its owner has since published another', async () => {
    const taken = await owner.take(p, ['funding'], later());
    expect(taken.hash).toMatch(A_HASH);
    const forked = await third.fork(p, ['method'], later());
    expect(forked).toMatchObject({ from: p, kept: 2, added: [said(m, a)], posted: [base], refused: [] });
    const { state } = await third.open(forked.hash!);
    expect([state.envelope.problem.owner, state.envelope.problem.from]).toEqual([address(third), p]);
    expect(Object.keys(state.envelope.problem.pieces)).toEqual(['statement/*', 'method']);
    // The line's head lists both forks that hold the piece, sorted, and the version that took the other piece.
    expect((await pursued(taken.hash!))[m.id]).toEqual(sorted([withMethod.hash!, forked.hash!]));
  });

  it('is wired as `quilt fork` from the command line, which prints what the fork answers', async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const home = tempHome('quilt-fork-cli-');
    createKey(home, { secretHex: hex(7) });
    // The tracker answers from this process, so the command runs beside it and not in its way.
    const quilt = (...args: string[]) =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', join(root, 'packages', 'client', 'src', 'bin.ts'), 'fork', ...args],
        { cwd: root, encoding: 'utf8', env: { ...process.env, QUILT_HOME: home, QUILT_TRACKERS: base } },
      );
    const held = (await index()).length;

    // A fault is the one line the command prints, and nothing is published.
    const refused = await quilt(p, 'nothing').then(
      () => null,
      (e: { code: number; stdout: string; stderr: string }) => e,
    );
    expect(refused).toMatchObject({ code: 1, stdout: '' });
    expect(refused!.stderr.trim().split('\n').at(-1)).toBe('no proposed piece stands on that problem under nothing');
    expect((await index()).length).toBe(held);

    const { stdout } = await quilt(`${base}p/${p}`, 'funding');
    const printed = JSON.parse(stdout) as client.Forked;
    expect(printed).toEqual({
      from: p,
      hash: expect.stringMatching(A_HASH),
      link: expect.stringContaining('quilt:sha256:'),
      kept: 2,
      added: [said(f, b)],
      posted: [base],
      refused: [],
    });
    expect(Object.keys(printed)).toEqual(['from', 'hash', 'link', 'kept', 'added', 'posted', 'refused']);
    const row = (await index()).find((x) => x.problem === printed.hash);
    expect(row).toMatchObject({ from: p, pieces: 3 });
  }, 60_000);
});
