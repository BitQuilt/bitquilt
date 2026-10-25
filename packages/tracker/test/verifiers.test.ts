import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { type Address, type Envelope, type Hash, type Receipt, type Unsigned, addressOf, commitHash, hashCanonical, newNonce, problemHash, reduce, signEvent, signObject } from '@bitquilt/core';
import { Store } from '../src/store.js';
import { createTracker } from '../src/tracker.js';
import { challengeLayer } from '../src/challenge.js';
import { describeKind, kindOf } from '../src/verifiers.js';

/**
 * The three verifier kinds the core does not know (docs/ext/verifiers.md), as the tracker's layer decides them: an
 * `attest` piece accepted at once on the actor's own record, marked attested, and struck by a challenge; a `human`
 * piece accepted only when both reveals come from a person's seat; a `judge:3` piece whose candidates a panel of three
 * ranks, decided by two first choices. Beside each, the core's own word stays `unknown`.
 */
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const owner = key(9), A = key(1), B = key(2), C = key(3), D = key(4), E = key(5);
const judges = [key(11), key(12), key(13), key(14)];
const persons = [key(21), key(22)];
const addr = addressOf;
const secretOf = new Map<Address, Uint8Array>([owner, A, B, C, D, E, ...judges, ...persons].map((k) => [addr(k), k]));
const by = (model: string, can: ('web' | 'person')[] = ['web']) => ({ model, client: 'test/0', can });
const verdictSchema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };
const toldSchema = { type: 'object' as const, additionalProperties: false as const, required: ['who', 'how', 'said'], properties: { who: { type: 'string' as const, maxLength: 120 }, how: { enum: ['conversation', 'message', 'post'] }, said: { type: 'string' as const, maxLength: 300 } } };
const textSchema = { type: 'object' as const, additionalProperties: false as const, required: ['text'], properties: { text: { type: 'string' as const, maxLength: 200 } } };

function sign(problem: Envelope['problem']): Envelope {
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}
const settings = { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 100, patch_max: 10000 };
/** Two agree pieces for the judges to earn credits on. */
const Q = sign({ title: 'Statements elsewhere', done_when: 'Every statement has a verdict.', owner: addr(owner), slug: 'elsewhere', prev: null, from: null, settings, data: {}, pieces: {
  'statement/*': { count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema: verdictSchema, agree: ['verdict'] },
} });
/** One piece of each kind, and an agree piece locked behind the attested one. */
const P = sign({ title: 'Three kinds', done_when: 'Each piece is accepted by its own kind.', owner: addr(owner), slug: 'kinds', prev: null, from: null, settings, data: {}, pieces: {
  told: { verifier: 'attest', requires: [], brief: 'Tell one person about the problem and record whom, how and what you said.', schema: toldSchema },
  vote: { verifier: 'human', requires: ['web'], brief: 'Does the paper say so? A person answers.', schema: verdictSchema, agree: ['verdict'] },
  summary: { verifier: 'judge:3', candidates: 2, requires: ['web'], brief: 'Summarise the paper in a sentence.', schema: textSchema },
  after: { verifier: 'agree', requires: ['web'], inputs: ['told'], brief: 'Once someone was told: did they answer?', schema: verdictSchema, agree: ['verdict'] },
} });
const q = problemHash(Q);
const p = problemHash(P);

let server: Server;
let base: string;
const store = new Store(':memory:');
let tick = Date.parse('2026-10-25T12:00:00Z');
const CUSTODY = 'custody-test';
const tracker = createTracker({ store, url: 'http://tracker.test/', now: () => new Date(tick).toISOString(), ipSalt: 's', limits: { keyPerHour: 1000, ipPerHour: 10000 }, custodySecret: CUSTODY });

beforeAll(async () => {
  server = await tracker.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } });
const get = async (path: string) => (await fetch(base + path)).json();
function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  tick += 1000;
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: new Date(tick).toISOString(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}
async function refused(path: string, event: unknown, headers: Record<string, string> = {}): Promise<string> {
  const r = await post(path, event, headers);
  expect(r.status, await r.clone().text()).toBe(400);
  return ((await r.json()) as { error: string }).error;
}
async function accepted(path: string, event: unknown, headers: Record<string, string> = {}): Promise<Hash> {
  const r = await post(path, event, headers);
  expect(r.status, await r.clone().text()).toBe(202);
  return ((await r.json()) as { id: Hash }).id;
}
/** A commit and its reveal from one key. */
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string, ret: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ commit: Hash; reveal: Hash; digest: Hash }> {
  const nonce = newNonce();
  const commit = await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece), headers);
  const reveal = await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model, model === 'human' ? ['person', 'web'] : ['web']) }, problem, piece), headers);
  return { commit, reveal, digest: hashCanonical(ret) };
}
interface PieceState { name: string; hash: Hash; state: string; core: string; kind: string | null; extension: string | null; strength: string | null; weakest: boolean; attested: boolean; panel: string | null; challenge: Hash | null }
const stateOf = async (problem: Hash): Promise<PieceState[]> => ((await get(`/p/${problem}/state`)) as { pieces: PieceState[] }).pieces;
const pieceOf = async (problem: Hash, name: string): Promise<PieceState> => (await stateOf(problem)).find((x) => x.name === name)!;
interface Panel { piece: Hash; outcome: string; winner: Hash | null; candidates: { digest: Hash; return: Record<string, unknown>; root?: Address }[]; seats: { root: Address; lapsed_at: string | null; rank: { ranking: Hash[] } | null }[]; dropped: { why: string }[] }
const panelsOf = async (problem: Hash) => ((await get(`/p/${problem}/panels`)) as { panels: Panel[] }).panels;
const nextFor = async (problem: Hash, k: Uint8Array, can: string, model = 'meta/llama') => (await get(`/p/${problem}/next?key=${addr(k)}&can=${can}&model=${encodeURIComponent(model)}`)) as { piece: Hash | null; verifier?: string; strength?: string; weakest?: boolean };

let told: Hash, vote: Hash, summary: Hash, after: Hash;

describe('the verifier kinds in words', () => {
  it('names each kind, its registry number and its strength, and parses judge:n', () => {
    expect(kindOf('judge:5')).toEqual({ kind: 'judge', panel: 5 });
    expect(kindOf('judge:0')).toBeNull();
    expect(kindOf('oracle')).toBeNull();
    expect(describeKind('attest')).toMatchObject({ kind: 'attest', extension: 'QX-10', strength: 'attested', weakest: true });
    expect(describeKind('human')).toMatchObject({ kind: 'human', extension: 'QX-3', strength: 'agreed', weakest: false });
    expect(describeKind('judge:3')).toMatchObject({ kind: 'judge', extension: 'QX-2', strength: 'judged', panel: 3 });
    expect(describeKind('agree')).toMatchObject({ kind: 'agree', extension: null, strength: 'agreed' });
    expect(describeKind('oracle')).toMatchObject({ kind: null, strength: null });
  });
});

describe('the verifier kinds at the tracker', () => {
  it('advertises the kinds, holds each piece open where the core says unknown, and keeps the dependent of an attest piece locked', async () => {
    const w = await get('/.well-known/quilt');
    expect(w.verifiers).toEqual({ human: 'QX-3', 'judge:n': 'QX-2', attest: 'QX-10', judge_seed: 'first-candidate-receipt' });
    expect(w.routes).toContain('/p/<hash>/panels');
    expect((await post('/p', { envelope: Q })).status).toBe(201);
    expect((await post('/p', { envelope: P })).status).toBe(201);
    const s = await stateOf(p);
    const byName = Object.fromEntries(s.map((x) => [x.name, x]));
    told = byName.told!.hash; vote = byName.vote!.hash; summary = byName.summary!.hash; after = byName.after!.hash;
    expect(byName.told).toMatchObject({ state: 'open', core: 'unknown', kind: 'attest', extension: 'QX-10', strength: 'attested', weakest: true, attested: false });
    expect(byName.vote).toMatchObject({ state: 'open', core: 'unknown', kind: 'human', extension: 'QX-3', strength: 'agreed' });
    expect(byName.summary).toMatchObject({ state: 'open', core: 'unknown', kind: 'judge', extension: 'QX-2', strength: 'judged', panel: null });
    expect(byName.after).toMatchObject({ state: 'locked', core: 'locked', kind: 'agree', extension: null, strength: 'agreed' });
    // The judges earn their credits elsewhere first.
    const [q1, q2] = (await stateOf(q)).map((x) => x.hash) as [Hash, Hash];
    await returnOn(q, q1, judges[0]!, 'anthropic/claude', { verdict: 'supports', quote: 'one' });
    await returnOn(q, q1, judges[1]!, 'openai/gpt', { verdict: 'supports', quote: 'two' });
    await returnOn(q, q2, judges[2]!, 'google/gemini', { verdict: 'contradicts', quote: 'three' });
    await returnOn(q, q2, judges[3]!, 'meta/llama', { verdict: 'contradicts', quote: 'four' });
    expect((await pieceOf(q, 'statement/1')).state).toBe('accepted_provisional');
  });

  it('accepts an attest piece at once on the actor\'s own record, marks it attested, and credits no standing', async () => {
    const r = await returnOn(p, told, A, 'anthropic/claude', { who: 'the editor of a newsletter about open protocols', how: 'message', said: 'That BitQuilt is a torrent where the pieces are made, not copied.' });
    expect(r.reveal).toMatch(/^sha256:/);
    const view = await pieceOf(p, 'told');
    expect(view).toMatchObject({ state: 'accepted_provisional', core: 'unknown', attested: true, weakest: true });
    // As the core has it, a dependent unlocks on accepted, not on provisional: the window has to close first (the pure layer below).
    expect((await pieceOf(p, 'after'))).toMatchObject({ state: 'locked', core: 'locked' });
    expect(tracker.layer().standing(addr(A))).toBe(1);
    // What is left for an AI: the judge piece; the human piece is kept for a person, the attested one is taken, the agree one waits.
    const offered = await nextFor(p, D, 'web');
    expect(offered.piece).toBe(summary);
    expect(offered).toMatchObject({ verifier: 'judge:3', strength: 'judged', weakest: false });
  });

  it('lets a challenge strike the attested acceptance like any other, and the piece is open again', async () => {
    const id = await accepted(`/p/${p}/events`, ev(C, 'challenge', { stake: 1, ground: 'No such message reached that editor.' }, p, told));
    expect((await pieceOf(p, 'told')).state).toBe('challenged');
    expect((await pieceOf(p, 'told')).challenge).toBe(id);
    const list = (await get(`/p/${p}/challenges`)) as { challenges: { id: Hash; seats: { root: Address }[]; outcome: string; struck: Hash[] }[] };
    const c = list.challenges.find((x) => x.id === id)!;
    expect(c.seats).toHaveLength(3);
    for (const s of c.seats.slice(0, 2)) await accepted(`/p/${p}/events`, ev(secretOf.get(s.root)!, 'verdict', { challenge: id, for: 'challenger' }, p, told));
    const held = ((await get(`/p/${p}/challenges`)) as { challenges: { id: Hash; outcome: string; struck: Hash[] }[] }).challenges.find((x) => x.id === id)!;
    expect(held.outcome).toBe('held');
    expect(held.struck).toHaveLength(2);
    expect(await pieceOf(p, 'told')).toMatchObject({ state: 'open', core: 'unknown', attested: false });
    expect((await pieceOf(p, 'after')).state).toBe('locked');
    expect(tracker.layer().standing(addr(A))).toBe(1);
    expect(tracker.layer().standing(addr(C))).toBe(2);
  });

  it('takes a human piece\'s return only from a person\'s seat, and accepts it when two people agree', async () => {
    const ret = { verdict: 'supports', quote: 'as a person read it' };
    const nonce = newNonce();
    await accepted(`/p/${p}/events`, ev(B, 'commit', { h: commitHash(ret, nonce) }, p, vote));
    expect(await refused(`/p/${p}/events`, ev(B, 'reveal', { return: ret, nonce, by: by('openai/gpt') }, p, vote))).toBe('a human piece takes a return from a person\'s seat');
    // On a problem of one human piece, a client that declared no person is handed nothing; a person is handed the piece.
    const H = sign({ title: 'A vote alone', done_when: 'Two people agree.', owner: addr(owner), slug: 'vote-alone', prev: null, from: null, settings, data: {}, pieces: {
      vote: { verifier: 'human', requires: ['web'], brief: 'Does the paper say so? A person answers.', schema: verdictSchema, agree: ['verdict'] },
    } });
    expect((await post('/p', { envelope: H })).status).toBe(201);
    const h = problemHash(H);
    expect((await nextFor(h, E, 'web')).piece).toBeNull();
    expect(await nextFor(h, E, 'web,person', 'human')).toMatchObject({ piece: (await stateOf(h))[0]!.hash, verifier: 'human', strength: 'agreed' });
    // A person at the page declares the model human; a member at a seat the tracker holds posts through its connector.
    await returnOn(p, vote, persons[0]!, 'human', { verdict: 'supports', quote: 'I read the sentence myself.' });
    expect((await pieceOf(p, 'vote')).state).toBe('needs_verify');
    await returnOn(p, vote, persons[1]!, 'openai/gpt', { verdict: 'supports', quote: 'So did I.' }, { 'x-quilt-custody': CUSTODY });
    expect(await pieceOf(p, 'vote')).toMatchObject({ state: 'accepted_provisional', core: 'unknown', kind: 'human', attested: false });
    expect(tracker.layer().standing(addr(persons[0]!))).toBe(2);
  });

  it('seats a panel of three on a judge piece once its candidates are in, and accepts the candidate two of them rank first', async () => {
    const a = await returnOn(p, summary, A, 'anthropic/claude', { text: 'A torrent where the pieces are made, not copied.' });
    expect((await pieceOf(p, 'summary')).state).toBe('needs_verify');
    expect(await panelsOf(p)).toEqual([]);
    const b = await returnOn(p, summary, B, 'openai/gpt', { text: 'Problems as patterns of pieces, each return signed.' });
    expect(await pieceOf(p, 'summary')).toMatchObject({ state: 'judging', core: 'unknown', panel: 'open' });
    expect((await nextFor(p, E, 'web')).piece).not.toBe(summary);
    const [panel] = await panelsOf(p);
    expect(panel!.outcome).toBe('open');
    expect(panel!.candidates.map((c) => c.digest).sort()).toEqual([a.digest, b.digest].sort());
    expect(panel!.candidates.every((c) => c.root === undefined)).toBe(true);
    expect(panel!.seats).toHaveLength(3);
    const drawn = panel!.seats.map((s) => s.root);
    const pool = judges.map(addr);
    for (const d of drawn) expect(pool).toContain(d);
    const undrawn = pool.find((j) => !drawn.includes(j))!;
    // No third candidate once the panel sits; no rank from outside the panel or naming the wrong digests.
    const nonce = newNonce();
    const late = { text: 'Late.' };
    await accepted(`/p/${p}/events`, ev(C, 'commit', { h: commitHash(late, nonce) }, p, summary));
    expect(await refused(`/p/${p}/events`, ev(C, 'reveal', { return: late, nonce, by: by('google/gemini') }, p, summary))).toBe('the candidates for this piece are in');
    expect(await refused(`/p/${p}/events`, ev(secretOf.get(undrawn)!, 'rank', { ranking: [a.digest, b.digest] }, p, summary))).toBe('not a judge drawn for this piece');
    expect(await refused(`/p/${p}/events`, ev(secretOf.get(drawn[0]!)!, 'rank', { ranking: [a.digest] }, p, summary))).toBe('body.ranking: the 2 candidate digests, each once');
    expect(await refused(`/p/${p}/events`, ev(secretOf.get(drawn[0]!)!, 'rank', { ranking: [a.digest, a.digest] }, p, summary))).toBe('body.ranking: each digest once');
    expect(await refused(`/p/${p}/events`, ev(E, 'rank', { ranking: [a.digest, b.digest] }, p, told))).toBe('no panel sits on this piece');
    await accepted(`/p/${p}/events`, ev(secretOf.get(drawn[0]!)!, 'rank', { ranking: [a.digest, b.digest] }, p, summary));
    expect(await refused(`/p/${p}/events`, ev(secretOf.get(drawn[0]!)!, 'rank', { ranking: [b.digest, a.digest] }, p, summary))).toBe('this judge has ranked');
    await accepted(`/p/${p}/events`, ev(secretOf.get(drawn[1]!)!, 'rank', { ranking: [b.digest, a.digest] }, p, summary));
    expect((await pieceOf(p, 'summary')).state).toBe('judging');
    await accepted(`/p/${p}/events`, ev(secretOf.get(drawn[2]!)!, 'rank', { ranking: [a.digest, b.digest] }, p, summary));
    const [decided] = await panelsOf(p);
    expect(decided!.outcome).toBe('decided');
    expect(decided!.winner).toBe(a.digest);
    expect(decided!.candidates.find((c) => c.digest === a.digest)!.root).toBe(addr(A));
    expect(decided!.seats.filter((s) => s.rank).map((s) => s.rank!.ranking[0])).toEqual([a.digest, b.digest, a.digest]);
    expect(await pieceOf(p, 'summary')).toMatchObject({ state: 'accepted_provisional', core: 'unknown', kind: 'judge', panel: 'decided' });
    expect(await refused(`/p/${p}/events`, ev(secretOf.get(drawn[2]!)!, 'rank', { ranking: [a.digest, b.digest] }, p, summary))).toBe('the panel has decided');
    expect(tracker.layer().standing(addr(A))).toBe(2);
    expect(tracker.layer().standing(addr(B))).toBe(1);
    const scrape = await get(`/p/${p}/scrape`);
    expect(scrape.panels).toBe(1);
    expect(scrape.counts).toMatchObject({ accepted_provisional: 2 });
  });
});

describe('the pure layer', () => {
  /** A receipt as a resolver would serve it, with what it says about the seat. */
  const line = (event: ReturnType<typeof signEvent>, at: string, received: Record<string, unknown> = {}): Receipt => ({ event, received: [{ by: 'https://t.example/', at, custody: 'self', ...received }], hash: hashCanonical([event.sig, at]) });
  const t = (m: number) => new Date(Date.parse('2026-10-25T08:00:00Z') + m * 60_000).toISOString();
  const H = sign({ title: 'A vote', done_when: 'Two people agree.', owner: addr(owner), slug: 'vote', prev: null, from: null, settings, data: {}, pieces: {
    vote: { verifier: 'human', requires: ['person'], brief: 'Does the paper say so?', schema: verdictSchema, agree: ['verdict'] },
  } });
  const h = problemHash(H);
  const piece = reduce({ envelopes: [H], blobs: new Map(), receipts: [], now: t(0) }).pieces[0]!.piece.hash;
  const handIn = (k: Uint8Array, minute: number, model: string, received: Record<string, unknown>): Receipt[] => {
    const ret = { verdict: 'supports', quote: `by ${addr(k).slice(0, 6)}` };
    const nonce = newNonce();
    const u = (type: string, body: Record<string, unknown>, at: string): Unsigned => ({ quilt: 1, type, problem: h, piece, key: addr(k), ts: at, body });
    return [line(signEvent(u('commit', { h: commitHash(ret, nonce) }, t(minute)), k), t(minute)), line(signEvent(u('reveal', { return: ret, nonce, by: by(model) }, t(minute + 1)), k), t(minute + 1), received)];
  };
  const stateWith = (receipts: Receipt[]) => challengeLayer({ problems: [{ envelopes: [H], blobs: new Map(), receipts, now: t(30) }], now: t(30) }).problems.get(h)!.byHash.get(piece)!;

  it('counts a human piece\'s reveal only from a seat the receipt or the client declares a person\'s, and the core says unknown throughout', () => {
    const selfAi = [...handIn(A, 0, 'anthropic/claude', {}), ...handIn(B, 5, 'openai/gpt', {})];
    expect(stateWith(selfAi)).toMatchObject({ state: 'needs_verify', core: 'unknown' });
    const oneSeat = [...handIn(A, 0, 'anthropic/claude', { seat: 'person' }), ...handIn(B, 5, 'openai/gpt', {})];
    expect(stateWith(oneSeat).state).toBe('needs_verify');
    const twoSeats = [...handIn(A, 0, 'anthropic/claude', { seat: 'person' }), ...handIn(B, 5, 'openai/gpt', { custody: 'hosted' })];
    expect(stateWith(twoSeats)).toMatchObject({ state: 'accepted_provisional', core: 'unknown', kind: { kind: 'human', extension: 'QX-3' } });
    const twoPeople = [...handIn(A, 0, 'human', {}), ...handIn(B, 5, 'human', {})];
    expect(stateWith(twoPeople).state).toBe('accepted_provisional');
    const related = [...handIn(A, 0, 'human', {}), ...handIn(A, 5, 'human', {})];
    expect(stateWith(related).state).toBe('needs_verify');
  });

  it('unlocks what waits on an attested piece once its window has closed, where the core keeps it locked', () => {
    const T = sign({ title: 'Told, then asked', done_when: 'Someone was told and answered.', owner: addr(owner), slug: 'told-then', prev: null, from: null, settings, data: {}, pieces: {
      told: { verifier: 'attest', requires: [], brief: 'Tell one person and record it.', schema: toldSchema },
      after: { verifier: 'agree', requires: ['web'], inputs: ['told'], brief: 'Did they answer?', schema: verdictSchema, agree: ['verdict'] },
    } });
    const th = problemHash(T);
    const [toldPiece, afterPiece] = reduce({ envelopes: [T], blobs: new Map(), receipts: [], now: t(0) }).pieces.map((v) => v.piece.hash) as [Hash, Hash];
    const ret = { who: 'a maintainer of a tracker', how: 'conversation', said: 'That the pieces are made, not copied.' };
    const nonce = newNonce();
    const u = (type: string, body: Record<string, unknown>, at: string): Unsigned => ({ quilt: 1, type, problem: th, piece: toldPiece, key: addr(A), ts: at, body });
    const receipts = [line(signEvent(u('commit', { h: commitHash(ret, nonce) }, t(0)), A), t(0)), line(signEvent(u('reveal', { return: ret, nonce, by: by('anthropic/claude') }, t(1)), A), t(1))];
    const at = (now: string) => challengeLayer({ problems: [{ envelopes: [T], blobs: new Map(), receipts, now }], now }).problems.get(th)!;
    const inside = at(t(10));
    expect(inside.byHash.get(toldPiece)).toMatchObject({ state: 'accepted_provisional', core: 'unknown', attested: true });
    expect(inside.byHash.get(afterPiece)).toMatchObject({ state: 'locked', core: 'locked' });
    const closed = at(t(49 * 60));
    expect(closed.byHash.get(toldPiece)).toMatchObject({ state: 'accepted', core: 'unknown' });
    expect(closed.byHash.get(afterPiece)).toMatchObject({ state: 'open', core: 'locked' });
    expect(closed.fold.complete).toBe(false);
    expect(closed.core.complete).toBe(false);
  });
});
