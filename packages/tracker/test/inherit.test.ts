import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, canonical, commitHash, newNonce } from '@bitquilt/core';
import { type Layer, challengeLayer } from '../src/challenge.js';
import { linesFromLayer } from '../src/coin.js';
import { reduceInputOf } from '../src/store.js';
import { recordOutput } from '../src/trace.js';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * A fork inherits squares (docs/ext/QX-23.md), in the layer and at the door. QX-23 section 1: a fork reaches the line
 * of the problem it came from, a later version among it, and what that problem reaches, so a fork of a fork reaches
 * the root, a problem never reaches a version of itself, and a ring of `from` is walked once. QX-23 section 2: a
 * piece the fork keeps is `inherited` where a square stands on it in reach, with the problem and the state there, the
 * furthest along and of equals the first; a piece the fork changed inherits nothing, a piece with a square of the
 * fork's own or one `locked` says its own state, a reader that does not hold the source says `open`, a square struck
 * at the source is gone from the fork, and the door refuses a challenge on a piece with no set of its own.
 * QX-23 section 3: a provisional square is shown and is not yet done, a final one opens the dependent, next never
 * hands an inherited piece, and the brief of the dependent carries the source's returns. QX-23 section 4: a fork
 * complete by inheritance has no output of the core's and has its record document, each inherited piece's entry
 * naming the problem. QX-23 section 5: the well-known document names the extension, the index counts the state under
 * its own name, and every root's standing, every lock and the coin's lines are the same with and without the forks.
 * A challenge at the fork on a set of the fork's own, on a dependent the inherited inputs opened, is taken by the door
 * and, held, strikes the set and moves the standing of its roots and its challenger as a held challenge does at a
 * source (QX-1 section 6). The seams beside an inherited piece are between the fork's own readings that stand: none
 * under one reading or where they agree, one where two differ, and none with a reading a held challenge struck. Last,
 * a maintainer's hide of the source moves nothing on the fork.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  forker = key(5),
  second = key(6),
  third = key(7),
  X = key(17),
  Y = key(18),
  treasury = key(20),
  M = key(21);
const judges = [key(11), key(12), key(13), key(14)];
const lockers = [key(15), key(16)];
/** The fork's own pair on the piece a challenge strikes there, its challenger, and a key that reads the piece after. */
const forkPair = [key(22), key(23)];
const forkChallenger = key(24),
  late = key(25);
/** The keys that work at the sources alone, whose standing no fork may move. */
const atSources = [owner, A, B, C, ...judges, ...lockers];
const everyone = [...atSources, forker, second, third, X, Y, M, ...forkPair, forkChallenger, late];
const secretOf = new Map<Address, Uint8Array>(everyone.map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const ASKED = 'Do the statements hold together? ';
const paper = {
  'statement/*': { ...agree, count: 2, brief: 'Statement {n}: does the paper say so?' },
  summary: { ...agree, brief: `${ASKED}{statement/*}`, inputs: ['statement/*'] },
};
/** The same pattern with the statements asked another way: other hashes, under the summary as it was. */
const reworded = {
  'statement/*': { ...agree, count: 2, brief: 'Statement {n}: is it in the paper, word for word?' },
  summary: paper.summary,
};
const one = { ...agree, brief: 'Is the first claim in the paper?' };
const two = { ...agree, brief: 'Is the second claim in the paper?' };
const three = { ...agree, brief: 'Is the third claim in the paper?' };
const extra = { ...agree, brief: 'Is there a claim the pattern left out?' };
const whole = {
  finding: { ...agree, brief: 'Does the paper report a finding?' },
  reading: { ...agree, verifier: 'record:2', brief: 'What does the paper leave unsaid? Read it your way.' },
};

const T0 = '2026-11-10T12:00:00.000Z';
const HOUR = 3_600_000;
/** The coin's parameters, for the lines the problem logs give it (QX-17 section 3); this tracker carries no coin. */
const params = {
  genesis: T0,
  epoch_h: 24,
  emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 1, floor_per_epoch: 400, max_per_weight: 50 },
  vesting_h: 48,
  infra_bp: 1000,
  treasury: addr(treasury),
  unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 },
  burn_rate: 10,
  burn_indexed: true,
  window_max_h: 48,
  transfers_from: T0,
  redeem_from: null,
};

const t = boot(T0, { maintainers: [addr(M)], limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

async function publish(e: Envelope): Promise<Hash> {
  const r = await post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
type Mark = { problem: Hash; state: string } | null;
type PieceState = {
  name: string;
  hash: Hash;
  state: string;
  core: string;
  inherited: Mark;
  seams: { field: string; sides: { key: Address; aside: boolean }[] }[];
};
type State = { pieces: PieceState[]; complete: boolean; output: string | null; record_output: string | null };
const stateOf = (problem: Hash) => get<State>(`/p/${problem}/state`);
const pieceOf = async (problem: Hash, name: string) => (await stateOf(problem)).pieces.find((p) => p.name === name)!;
/** A piece's state and its mark, which is most of what these tests read. */
const shown = async (problem: Hash, name: string) => {
  const { state, inherited } = await pieceOf(problem, name);
  return { state, inherited };
};
const known = new Map<Hash, Record<string, Hash>>();
/** A piece's hash on a problem, by its name. */
async function hashOf(problem: Hash, name: string): Promise<Hash> {
  if (!known.has(problem))
    known.set(problem, Object.fromEntries((await stateOf(problem)).pieces.map((p) => [p.name, p.hash])));
  return known.get(problem)![name]!;
}
/** A commit and its reveal on a piece of a problem, by the piece's name. */
async function returned(problem: Hash, name: string, k: Uint8Array, model: string, verdict = 'supports') {
  const piece = await hashOf(problem, name);
  const ret = { verdict };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
/** The two readers of the sources agree on a piece: a square, provisional until its window closes. */
async function squared(problem: Hash, name: string, pair: Uint8Array[] = [A, B]): Promise<void> {
  await returned(problem, name, pair[0]!, 'anthropic/claude');
  await returned(problem, name, pair[1]!, 'openai/gpt');
}
type Challenges = { challenges: { id: Hash; outcome: string; struck: Hash[]; seats: { root: Address }[] }[] };
const challengeOf = async (problem: Hash, id: Hash) =>
  (await get<Challenges>(`/p/${problem}/challenges`)).challenges.find((c) => c.id === id)!;
/** QX-1 section 6: "Held: two verdicts `for: challenger`." The first two seats the challenge drew give them. */
async function held(problem: Hash, name: string, id: Hash): Promise<void> {
  const piece = await hashOf(problem, name);
  for (const seat of (await challengeOf(problem, id)).seats.slice(0, 2))
    await accepted(
      `/p/${problem}/events`,
      ev(secretOf.get(seat.root)!, 'verdict', { challenge: id, for: 'challenger' }, problem, piece),
    );
  expect((await challengeOf(problem, id)).outcome).toBe('held');
}
const standingOf = (ks: Uint8Array[]) => ks.map((k) => t.tracker.layer().standing(addr(k)));
type Handed = { piece: Hash | null; name?: string; state?: string; brief?: string };
const nextFor = (problem: Hash, k: Uint8Array, model: string) =>
  get<Handed>(`/p/${problem}/next?key=${addr(k)}&can=web&model=${encodeURIComponent(model)}`);
const nowIso = () => new Date(t.clock.tick).toISOString();
/** The layer over the problems of the store a reader holds, at the tracker's clock. */
function layerOver(holds: (e: { hash: Hash; envelope: Envelope }) => boolean): Layer {
  const now = nowIso();
  const problems = t.store
    .listEnvelopes()
    .filter(holds)
    .map((e) => reduceInputOf(t.store, e.envelope, now));
  return challengeLayer({ problems, now, blobLength: (h: Hash) => t.store.blobLength(h) });
}
/** A reader that holds no fork: the problems whose envelope names no `from`. */
const noFork = (e: { envelope: Envelope }) => e.envelope.problem.from === null;

/**
 * QX-23 section 5: "An inherited square earns nothing and moves nothing." The layer over the problems that name no
 * `from`, and the layer over every problem, at one clock: the sources' pieces, every lock, the standing of every key
 * that works at the sources, and the lines the problem logs give the coin, the same in both.
 */
function unmovedByForks(): void {
  const now = nowIso();
  const without = layerOver(noFork);
  const withForks = layerOver(() => true);
  expect(withForks.problems.size).toBeGreaterThan(without.problems.size);
  for (const k of atSources) expect(withForks.standing(addr(k)), addr(k)).toBe(without.standing(addr(k)));
  for (const [hash, pl] of without.problems) {
    expect(withForks.problems.get(hash)!.pieces).toEqual(pl.pieces);
    expect(withForks.problems.get(hash)!.locks).toEqual(pl.locks);
  }
  const lines = (layer: Layer) => linesFromLayer(layer, params, now);
  const sources = new Set<string>(without.problems.keys());
  const ofSources = (ls: { problem?: string }[]) => ls.filter((l) => l.problem !== undefined && sources.has(l.problem));
  expect(ofSources(lines(withForks).lines)).toEqual(lines(without).lines);
  expect(ofSources(lines(withForks).verified)).toEqual(lines(without).verified);
}

// The sources, each by one owner, and the forks, each published before any work of its own.
let S: Hash, Q: Hash, T: Hash, U: Hash, R: Hash, V1: Hash;
let F: Hash, G: Hash, FF: Hash, FT: Hash, FU: Hash, FR: Hash, FV: Hash, FC: Hash, FS: Hash;
/** What a held challenge moved at a source no fork reads into: each root of the struck set, then the challenger. */
let movedAtSource: number[];

beforeAll(async () => {
  S = await publish(envelope(owner, 'paper', paper, { title: 'What one paper says' }));
  Q = await publish(envelope(owner, 'elsewhere', { 'claim/*': { ...agree, count: 2, brief: 'Claim {n}: is it so?' } }));
  T = await publish(envelope(owner, 'struck', { claim: { ...agree, brief: 'Does the paper name its sample?' } }));
  U = await publish(envelope(owner, 'staked', { seat: { ...agree, brief: 'Does the paper name its funder?' } }));
  R = await publish(envelope(owner, 'whole', whole));
  V1 = await publish(envelope(owner, 'versions', { one, two }));
  // Two squares on another problem seat the panel a challenge draws (QX-1 section 3).
  await squared(Q, 'claim/1', [judges[0]!, judges[1]!]);
  await squared(Q, 'claim/2', [judges[2]!, judges[3]!]);
  // A staked piece, worked behind two locks (QX-15).
  await accepted(`/p/${U}/events`, ev(owner, 'stake_rule', { min: 1 }, U));
  for (const k of lockers)
    await accepted(`/p/${U}/events`, ev(k, 'lock', { kind: 'standing', amount: 1 }, U, await hashOf(U, 'seat')));
  await squared(U, 'seat', lockers);
  for (const name of ['statement/1', 'statement/2']) await squared(S, name);
  await squared(T, 'claim');
  await squared(R, 'finding');
  await squared(R, 'reading');
  await squared(V1, 'one');

  F = await publish(envelope(forker, 'paper-pursued', paper, { from: S }));
  G = await publish(envelope(second, 'paper-reworded', reworded, { from: S }));
  FF = await publish(envelope(third, 'paper-again', paper, { from: F }));
  FT = await publish(
    envelope(forker, 'struck-pursued', { claim: { ...agree, brief: 'Does the paper name its sample?' } }, { from: T }),
  );
  FU = await publish(
    envelope(forker, 'staked-pursued', { seat: { ...agree, brief: 'Does the paper name its funder?' } }, { from: U }),
  );
  FR = await publish(envelope(forker, 'whole-pursued', whole, { from: R }));
  FV = await publish(envelope(forker, 'versions-pursued', { one, two, extra }, { from: V1 }));
  FC = await publish(envelope(forker, 'paper-challenged', paper, { from: S }));
  FS = await publish(envelope(second, 'paper-seamed', paper, { from: S }));
});

describe("a fork while the source's squares are provisional (QX-23 sections 2 and 3)", () => {
  it('is an extension the tracker names', async () => {
    expect((await get<{ inherit: unknown }>('/.well-known/quilt')).inherit).toEqual({ extension: 'QX-23' });
  });

  it('shows a kept piece as inherited, with the problem where the square stands and its state there', async () => {
    const s = await stateOf(F);
    for (const name of ['statement/1', 'statement/2']) {
      const piece = s.pieces.find((p) => p.name === name)!;
      expect(piece.hash).toBe(await hashOf(S, name));
      expect(piece).toMatchObject({
        state: 'inherited',
        core: 'open',
        inherited: { problem: S, state: 'accepted_provisional' },
      });
    }
    expect(await shown(FU, 'seat')).toEqual({
      state: 'inherited',
      inherited: { problem: U, state: 'accepted_provisional' },
    });
    // The source's own pieces carry no mark.
    expect(await shown(S, 'statement/1')).toEqual({ state: 'accepted_provisional', inherited: null });
  });

  it('holds the dependent locked, the fork not complete, and hands nothing', async () => {
    const s = await stateOf(F);
    expect(s.pieces.find((p) => p.name === 'summary')).toMatchObject({
      state: 'locked',
      core: 'locked',
      inherited: null,
    });
    expect(s.complete).toBe(false);
    // QX-23 section 3: "The tracker's next never hands over an inherited piece".
    expect((await nextFor(F, X, 'google/gemini')).piece).toBeNull();
    expect((await stateOf(FR)).complete).toBe(false);
    expect((await fetch(`${t.base}/p/${FR}/record`)).status).toBe(404);
  });

  it('counts the state under its own name on the index, and no square as the fork’s own work', async () => {
    type Row = {
      problem: Hash;
      from: Hash | null;
      counts: Record<string, number>;
      work: { accepted: number };
      complete: boolean;
    };
    const row = (await get<{ problems: Row[] }>('/')).problems.find((p) => p.problem === F)!;
    expect(row.from).toBe(S);
    expect(row.counts).toEqual({ inherited: 2, locked: 1 });
    expect(row.work.accepted).toBe(0);
    expect(row.complete).toBe(false);
  });

  it('inherits nothing on a piece the fork changed, and never on a piece its own state locks', async () => {
    expect(await hashOf(G, 'statement/1')).not.toBe(await hashOf(S, 'statement/1'));
    expect(await hashOf(G, 'summary')).toBe(await hashOf(S, 'summary'));
    for (const name of ['statement/1', 'statement/2'])
      expect(await shown(G, name)).toEqual({ state: 'open', inherited: null });
    expect(await shown(G, 'summary')).toEqual({ state: 'locked', inherited: null });
    // The changed piece is open work on the fork, and next hands it.
    expect((await nextFor(G, X, 'google/gemini')).name).toMatch(/^statement\//);
  });

  it('reaches the root through a fork of a fork, and the mark names the root', async () => {
    for (const name of ['statement/1', 'statement/2'])
      expect(await shown(FF, name)).toEqual({
        state: 'inherited',
        inherited: { problem: S, state: 'accepted_provisional' },
      });
    expect(await shown(FF, 'summary')).toEqual({ state: 'locked', inherited: null });
  });

  it('says open where the reader does not hold the source', () => {
    const alone = layerOver((e) => e.hash === F).problems.get(F)!;
    expect(alone.pieces.map((p) => [p.name, p.state, p.inherited])).toEqual([
      ['statement/1', 'open', null],
      ['statement/2', 'open', null],
      ['summary', 'locked', null],
    ]);
    expect(alone.complete).toBe(false);
  });

  it("answers a challenge on a piece with no set of its own with the door's ordinary refusal", async () => {
    const piece = await hashOf(F, 'statement/1');
    const challenge = ev(C, 'challenge', { stake: 1, ground: 'The sentence quoted is not in the paper.' }, F, piece);
    expect(await refused(`/p/${F}/events`, challenge)).toBe('nothing accepted on this piece yet');
  });

  it('moves no standing, no lock and no line of the coin', () => {
    unmovedByForks();
    // The staked piece: both locks stand at the source, and the fork holds none.
    const layer = t.tracker.layer();
    expect(layer.problems.get(U)!.locks).toHaveLength(2);
    expect(layer.problems.get(FU)!.locks).toHaveLength(0);
    for (const k of [forker, second, third, X, Y]) expect(layer.standing(addr(k))).toBe(1);
  });
});

describe('a square challenged and struck at the source (QX-23 section 2)', () => {
  it('shows the challenged square while the panel sits, and is gone from the fork once the challenge is held', async () => {
    const piece = await hashOf(T, 'claim');
    expect(await shown(FT, 'claim')).toEqual({
      state: 'inherited',
      inherited: { problem: T, state: 'accepted_provisional' },
    });
    const ground = 'The sentence quoted is not in the paper.';
    const before = standingOf([A, B, C]);
    const id = await accepted(`/p/${T}/events`, ev(C, 'challenge', { stake: 1, ground }, T, piece));
    expect((await shown(T, 'claim')).state).toBe('challenged');
    expect(await shown(FT, 'claim')).toEqual({ state: 'inherited', inherited: { problem: T, state: 'challenged' } });
    unmovedByForks();
    await held(T, 'claim', id);
    expect((await shown(T, 'claim')).state).toBe('open');
    // QX-1 section 6: "Each root of the accepting set loses one and its point for the set."
    movedAtSource = standingOf([A, B, C]).map((n, i) => n - before[i]!);
    expect(movedAtSource).toEqual([-2, -2, 1]);
    // QX-23 section 2: "Where a challenge or the owner's gold strikes the set at the source, the square is gone from
    // every fork at the next read".
    expect(await pieceOf(FT, 'claim')).toMatchObject({ state: 'open', core: 'open', inherited: null });
    unmovedByForks();
  });
});

describe('a fork once the windows at the source have closed (QX-23 sections 3 and 4)', () => {
  it('names the final square, opens the dependent, and still says open where the source is not held', async () => {
    t.clock.tick += 49 * HOUR;
    for (const name of ['statement/1', 'statement/2'])
      expect(await shown(F, name)).toEqual({ state: 'inherited', inherited: { problem: S, state: 'accepted' } });
    expect(await pieceOf(F, 'summary')).toMatchObject({ state: 'open', core: 'locked', inherited: null });
    expect((await stateOf(F)).complete).toBe(false);
    const alone = layerOver((e) => e.hash === F).problems.get(F)!;
    expect(alone.pieces.map((p) => p.state)).toEqual(['open', 'open', 'locked']);
    unmovedByForks();
  });

  it("hands the dependent over, its brief carrying the source's returns with their signers", async () => {
    const handed = await nextFor(F, X, 'google/gemini');
    expect(handed).toMatchObject({ piece: await hashOf(F, 'summary'), name: 'summary', state: 'open' });
    const lines = ['statement/1', 'statement/2'].flatMap((name) =>
      [A, B].map((k) => `${name}, by ${addr(k)}: ${canonical({ verdict: 'supports' })}`),
    );
    expect(handed.brief).toBe(ASKED + lines.join('\n'));
    // The source's own summary is filled by the core, and the two briefs are the same text.
    expect((await nextFor(S, X, 'google/gemini')).brief).toBe(handed.brief);
  });

  it('is complete by inheritance with no output of the core, and has its record document', async () => {
    const s = await stateOf(FR);
    expect(s.pieces.map((p) => [p.name, p.state, p.inherited])).toEqual([
      ['finding', 'inherited', { problem: R, state: 'accepted' }],
      ['reading', 'inherited', { problem: R, state: 'recorded' }],
    ]);
    const pl = t.tracker.layer().problems.get(FR)!;
    expect(pl.complete).toBe(true);
    expect(pl.fold.complete).toBe(false);
    const out = recordOutput(pl)!;
    expect(s).toMatchObject({ complete: true, output: null, record_output: out.hash });
    const pieces = [
      { name: 'finding', piece: await hashOf(FR, 'finding'), state: 'inherited', inherited: R },
      { name: 'reading', piece: await hashOf(FR, 'reading'), state: 'inherited', inherited: R },
    ];
    expect(out.document).toMatchObject({ problem: FR, pieces });
    expect(await get(`/p/${FR}/record`)).toMatchObject({ hash: out.hash, problem: FR, pieces });
    // The source is complete on its own, with its readings in its own document.
    const source = await stateOf(R);
    expect(source.complete).toBe(true);
    expect(source.record_output).not.toBe(out.hash);
    // A reader that does not hold the source has no document for the fork.
    expect(recordOutput(layerOver((e) => e.hash === FR).problems.get(FR)!)).toBeNull();
  });
});

describe("the fork's own work on a piece it inherits (QX-23 section 2)", () => {
  it('still says inherited under one reading, and its own state once its own readings make a set', async () => {
    await returned(F, 'statement/1', X, 'google/gemini');
    expect(await pieceOf(F, 'statement/1')).toMatchObject({
      state: 'inherited',
      core: 'needs_verify',
      inherited: { problem: S, state: 'accepted' },
    });
    await returned(F, 'statement/1', Y, 'meta/llama');
    expect(await pieceOf(F, 'statement/1')).toMatchObject({
      state: 'accepted_provisional',
      core: 'accepted_provisional',
      inherited: null,
    });
  });

  it('still says inherited where its own readings differ, with the seam between them beside it', async () => {
    await returned(F, 'statement/2', X, 'google/gemini', 'supports');
    await returned(F, 'statement/2', Y, 'meta/llama', 'contradicts');
    const piece = await pieceOf(F, 'statement/2');
    expect(piece).toMatchObject({ state: 'inherited', core: 'disputed', inherited: { problem: S, state: 'accepted' } });
    expect(piece.seams.map((s) => s.field)).toEqual(['verdict']);
  });

  it('makes a square of its own on the dependent the inherited inputs opened, and earns as on any problem', async () => {
    await returned(F, 'summary', X, 'google/gemini');
    await returned(F, 'summary', Y, 'meta/llama');
    expect(await pieceOf(F, 'summary')).toMatchObject({ state: 'accepted_provisional', inherited: null });
    // The fork's own sets earn what they earn where the reader holds the fork alone: nothing more by the source.
    const now = nowIso();
    const alone = layerOver((e) => e.hash === F);
    const all = layerOver(() => true);
    for (const k of [X, Y]) {
      expect(all.standing(addr(k))).toBe(alone.standing(addr(k)));
      expect(all.standing(addr(k))).toBe(3);
    }
    const ofFork = (layer: Layer) => linesFromLayer(layer, params, now).lines.filter((l) => l.problem === F);
    expect(ofFork(all)).toEqual(ofFork(alone));
    expect(ofFork(all)).toHaveLength(2);
    unmovedByForks();
  });
});

describe("a challenge at the fork on a set of the fork's own (QX-23 sections 2 and 3)", () => {
  const ground = 'The statements do not hold together as the set says.';
  let id: Hash;
  let before: number[];

  it('is taken by the door on a dependent the inherited inputs opened, and the piece says challenged', async () => {
    expect(await pieceOf(FC, 'summary')).toMatchObject({ state: 'open', core: 'locked', inherited: null });
    expect(standingOf([...forkPair, forkChallenger])).toEqual([1, 1, 1]);
    await squared(FC, 'summary', forkPair);
    expect(await pieceOf(FC, 'summary')).toMatchObject({
      state: 'accepted_provisional',
      core: 'locked',
      inherited: null,
    });
    before = standingOf([...forkPair, forkChallenger]);
    expect(before).toEqual([2, 2, 1]);
    const piece = await hashOf(FC, 'summary');
    id = await accepted(`/p/${FC}/events`, ev(forkChallenger, 'challenge', { stake: 1, ground }, FC, piece));
    expect(await pieceOf(FC, 'summary')).toMatchObject({ state: 'challenged', core: 'locked', inherited: null });
    const open = await challengeOf(FC, id);
    expect(open.outcome).toBe('open');
    expect(open.seats).toHaveLength(3);
    unmovedByForks();
  });

  it('strikes the set once the challenge is held, and the piece says its own state again', async () => {
    await held(FC, 'summary', id);
    // QX-1 section 6: "The set's events, the two reveals with their commits".
    expect((await challengeOf(FC, id)).struck).toHaveLength(4);
    const pl = t.tracker.layer().problems.get(FC)!;
    const piece = await hashOf(FC, 'summary');
    expect(pl.core.byHash.get(piece)!.reveals).toHaveLength(2);
    expect(pl.fold.byHash.get(piece)).toMatchObject({ accepting: null, reveals: [] });
    expect(await pieceOf(FC, 'summary')).toMatchObject({ state: 'open', core: 'locked', inherited: null });
    // The inputs are inherited as they were, and next hands the piece again.
    for (const name of ['statement/1', 'statement/2'])
      expect(await shown(FC, name)).toEqual({ state: 'inherited', inherited: { problem: S, state: 'accepted' } });
    expect((await nextFor(FC, late, 'google/gemini')).name).toBe('summary');
  });

  it('moves the standing of the set and the challenger as a held challenge does at a source', () => {
    const after = standingOf([...forkPair, forkChallenger]);
    expect(after).toEqual([0, 0, 2]);
    expect(after.map((n, i) => n - before[i]!)).toEqual(movedAtSource);
  });

  it('moves nothing at the source: its pieces, its keys, every lock and the coin as with no fork held', async () => {
    unmovedByForks();
    expect(await shown(S, 'summary')).toEqual({ state: 'open', inherited: null });
    for (const name of ['statement/1', 'statement/2'])
      expect(await shown(S, name)).toEqual({ state: 'accepted', inherited: null });
  });
});

describe('several squares in reach (QX-23 sections 1 and 2)', () => {
  it('names the furthest along, a final square at the root over a provisional one at the fork between', async () => {
    expect(await shown(F, 'statement/1')).toEqual({ state: 'accepted_provisional', inherited: null });
    expect(await shown(FF, 'statement/1')).toEqual({
      state: 'inherited',
      inherited: { problem: S, state: 'accepted' },
    });
    expect(await shown(FF, 'statement/2')).toEqual({
      state: 'inherited',
      inherited: { problem: S, state: 'accepted' },
    });
    // The summary has a square at the fork between and none at the root.
    expect(await shown(S, 'summary')).toEqual({ state: 'open', inherited: null });
    expect(await shown(FF, 'summary')).toEqual({
      state: 'inherited',
      inherited: { problem: F, state: 'accepted_provisional' },
    });
  });

  it('names the first in the order of reach among equals, and never a piece its own state locks', async () => {
    await squared(S, 'summary');
    expect(await shown(S, 'summary')).toEqual({ state: 'accepted_provisional', inherited: null });
    expect(await shown(FF, 'summary')).toEqual({
      state: 'inherited',
      inherited: { problem: F, state: 'accepted_provisional' },
    });
    // The fork that changed the statements keeps the summary, which has a square at the source now, and its own state
    // there is locked behind its own statements.
    expect(await shown(G, 'summary')).toEqual({ state: 'locked', inherited: null });
  });
});

describe('versions, and a ring of from (QX-23 section 1)', () => {
  let V2: Hash, V3: Hash, FV2: Hash;

  it('reaches a square made on a later version of the source, the earlier version first among equals', async () => {
    expect(await shown(FV, 'one')).toEqual({ state: 'inherited', inherited: { problem: V1, state: 'accepted' } });
    expect(await shown(FV, 'two')).toEqual({ state: 'open', inherited: null });
    V2 = await publish(envelope(owner, 'versions', { one, two, three }, { prev: V1 }));
    await squared(V2, 'two');
    expect(await shown(V2, 'one')).toEqual({ state: 'accepted', inherited: null });
    expect(await shown(V2, 'two')).toEqual({ state: 'accepted_provisional', inherited: null });
    expect(await shown(FV, 'two')).toEqual({
      state: 'inherited',
      inherited: { problem: V2, state: 'accepted_provisional' },
    });
    expect(await shown(FV, 'one')).toEqual({ state: 'inherited', inherited: { problem: V1, state: 'accepted' } });
    expect(await shown(FV, 'extra')).toEqual({ state: 'open', inherited: null });
  });

  it('lets a version of the source take a piece back from its fork, and reaches no version of itself', async () => {
    await returned(FV, 'extra', X, 'google/gemini');
    await returned(FV, 'extra', Y, 'meta/llama');
    expect(await shown(FV, 'extra')).toEqual({ state: 'accepted_provisional', inherited: null });
    V3 = await publish(envelope(owner, 'versions', { one, two, three, extra }, { prev: V2, from: FV }));
    expect(await shown(V3, 'extra')).toEqual({
      state: 'inherited',
      inherited: { problem: FV, state: 'accepted_provisional' },
    });
    // Its own line's squares are its own, carried by its chain, and the piece nobody answered is open.
    expect(await shown(V3, 'one')).toEqual({ state: 'accepted', inherited: null });
    expect(await shown(V3, 'two')).toEqual({ state: 'accepted_provisional', inherited: null });
    expect(await shown(V3, 'three')).toEqual({ state: 'open', inherited: null });
  });

  it('walks a ring of from once, and both problems answer', async () => {
    FV2 = await publish(envelope(forker, 'versions-pursued', { one, two, extra }, { prev: FV, from: V3 }));
    // The fork's later version names the source's later version first, and its own line's square stays its own.
    expect(await shown(FV2, 'one')).toEqual({ state: 'inherited', inherited: { problem: V3, state: 'accepted' } });
    expect(await shown(FV2, 'two')).toEqual({
      state: 'inherited',
      inherited: { problem: V3, state: 'accepted_provisional' },
    });
    expect(await shown(FV2, 'extra')).toEqual({ state: 'accepted_provisional', inherited: null });
    // The source's later version still reads the fork's line, the earlier version first.
    expect(await shown(V3, 'extra')).toEqual({
      state: 'inherited',
      inherited: { problem: FV, state: 'accepted_provisional' },
    });
    expect(await shown(V3, 'three')).toEqual({ state: 'open', inherited: null });
  });
});

describe("the seams between the fork's own readings on an inherited piece (QX-23 section 2)", () => {
  const inherited = { problem: '' as Hash, state: 'accepted' };

  it('shows none under one reading, and the seam once two differ, on a piece the core calls locked', async () => {
    t.clock.tick += 49 * HOUR;
    inherited.problem = S;
    expect(await shown(S, 'summary')).toEqual({ state: 'accepted', inherited: null });
    expect(await pieceOf(FS, 'summary')).toMatchObject({ state: 'inherited', core: 'locked', inherited, seams: [] });
    await returned(FS, 'summary', X, 'google/gemini', 'supports');
    expect(await pieceOf(FS, 'summary')).toMatchObject({ state: 'inherited', core: 'locked', inherited, seams: [] });
    await returned(FS, 'summary', Y, 'meta/llama', 'contradicts');
    const piece = await pieceOf(FS, 'summary');
    // QX-23 section 2: "where they differ, the piece still says `inherited` and the seams between the fork's own
    // readings are shown beside it".
    expect(piece).toMatchObject({ state: 'inherited', core: 'locked', inherited });
    expect(piece.seams.map((s) => [s.field, s.sides.map((side) => [side.key, side.aside])])).toEqual([
      [
        'verdict',
        [
          [addr(X), false],
          [addr(Y), false],
        ],
      ],
    ]);
  });

  it('shows none where the readings agree and make no set', async () => {
    // Two readings of one vendor agree and accept nothing (CORE.md section 6).
    await returned(FS, 'statement/1', X, 'google/gemini');
    await returned(FS, 'statement/1', Y, 'google/gemini');
    expect(await pieceOf(FS, 'statement/1')).toMatchObject({
      state: 'inherited',
      core: 'needs_verify',
      inherited,
      seams: [],
    });
  });

  it('shows none with a reading a held challenge struck, which the core still holds', async () => {
    // The set the challenge struck on this fork said supports, and a reading after it differs from both.
    await returned(FC, 'summary', late, 'google/gemini', 'contradicts');
    const pl = t.tracker.layer().problems.get(FC)!;
    const piece = await hashOf(FC, 'summary');
    expect(pl.core.byHash.get(piece)!.reveals).toHaveLength(3);
    expect(pl.fold.byHash.get(piece)!.reveals.map((rv) => rv.key)).toEqual([addr(late)]);
    expect(await pieceOf(FC, 'summary')).toMatchObject({ state: 'inherited', core: 'locked', inherited, seams: [] });
  });
});

describe('a hide of the source (QX-23 section 1)', () => {
  it('moves nothing on the fork: the reach reads every problem the tracker holds, a hidden one among them', async () => {
    const before = await stateOf(F);
    await accepted('/k/events', ev(M, 'hide', { id: S, why: 'Taken down for the test.' }));
    expect((await get<{ hidden: unknown }>(`/p/${S}/state`)).hidden).not.toBeNull();
    const after = await stateOf(F);
    expect(after.pieces).toEqual(before.pieces);
    expect(after.complete).toBe(before.complete);
    expect(await shown(FF, 'statement/2')).toEqual({
      state: 'inherited',
      inherited: { problem: S, state: 'accepted' },
    });
  });
});
