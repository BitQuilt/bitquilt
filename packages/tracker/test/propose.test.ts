import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Address,
  type Hash,
  type PieceDef,
  commitHash,
  expandPieces,
  newNonce,
  problemHash,
  signEvent,
} from '@bitquilt/core';
import {
  PROPOSED_MAX,
  PROPOSE_WHY_MAX,
  type ProposalView,
  proposeBodyProblems,
  proposedHash,
  standingProposals,
} from '../src/propose.js';
import { VERDICT, addr, boot, envelope, key, line } from './helpers.js';

/**
 * Proposed pieces (docs/ext/QX-22.md). Any key puts one piece beside a problem with a `propose` event, and the door
 * takes it where its body is section 1's and a version that took the piece would pass at publish, each fault of the
 * piece said of `body.piece` and each bound of the door in the door's own words, with room made for the one piece in
 * the budget. The proposals that stand are listed in receipt order as their signed events, a root's second proposal
 * of one piece refused in words and not answered as already here, two roots' proposals of one piece and two pieces
 * under one name side by side, and the problem's state as it was. Beside each the tracker says the name its root
 * chose, whether that root's work stands on the problem (an accepting set, or a reading on a record piece), the
 * version that took the piece, read over the chain of the version asked and no further, and the forks that pursue
 * it, a fork found over its own chain and left out once it is taken down or replaced. The piece's hash is the hash
 * it has in the version that takes it. Last, `standingProposals` over receipts made by hand.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(6),
  forker = key(5),
  M = key(21);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const pieces = {
  'statement/*': { ...agree, count: 2, brief: 'Statement {n}: does the paper say so?' },
  summary: { ...agree, brief: 'Do the statements hold together?', inputs: ['statement/*'] },
  reading: { ...agree, verifier: 'record:2', brief: 'What does the paper leave unsaid? Read it your way.' },
};
/** The piece the work found missing, as an envelope would write it. */
const method: PieceDef = { ...agree, brief: 'Does the paper say how the sample was drawn?', inputs: ['statement/*'] };
const WHY = 'The statements rest on a sample the pattern never asks about.';
const good = { name: 'method', piece: method, why: WHY };

const t = boot('2026-11-09T12:00:00Z', { maintainers: [addr(M)], limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

const env = envelope(owner, 'paper', pieces, { title: 'What one paper says' });
const P = problemHash(env);
const H = proposedHash('method', method)!;
const hashes: Record<string, Hash> = {};

async function publish(e: ReturnType<typeof envelope>): Promise<Hash> {
  const r = await post('/p', { envelope: e });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
/** A proposal posted and taken: its id and the time on its receipt. */
async function proposed(k: Uint8Array, body: Record<string, unknown>, under: Hash = P) {
  const r = await post(`/p/${under}/events`, ev(k, 'propose', body, under));
  expect(r.status, await r.clone().text()).toBe(202);
  return (await r.json()) as { id: Hash; at: string };
}
/** A commit and its reveal on a piece of the first version. */
async function returned(k: Uint8Array, model: string, piece: Hash): Promise<void> {
  const ret = { verdict: 'supports' };
  const nonce = newNonce();
  await accepted(`/p/${P}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
  await accepted(`/p/${P}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, piece));
}
type Listed = { problem: Hash; now: string; proposals: ProposalView[] };
const listed = (problem: Hash = P) => get<Listed>(`/p/${problem}/proposals`);
/** One field of each row, in the order listed. */
const each = async <K extends keyof ProposalView>(field: K, problem: Hash = P) =>
  (await listed(problem)).proposals.map((p) => p[field]);
type State = { now: string; pieces: { name: string; hash: Hash; state: string }[] };
const stateOf = (problem: Hash = P) => get<State>(`/p/${problem}/state`);

beforeAll(async () => {
  expect(await publish(env)).toBe(P);
  for (const x of (await stateOf()).pieces) hashes[x.name] = x.hash;
  await accepted('/k/events', ev(A, 'name', { name: 'Ada' }));
});

describe('a proposed piece at the door (QX-22 sections 1 and 2)', () => {
  it('is an extension the tracker names with its two bounds', async () => {
    expect((await get<{ propose: unknown }>('/.well-known/quilt')).propose).toEqual({
      extension: 'QX-22',
      piece_max: 16384,
      why_max: 500,
    });
    expect([PROPOSED_MAX, PROPOSE_WHY_MAX]).toEqual([16384, 500]);
  });

  it('is taken from any key and listed as signed, and the state of the problem is as it was', async () => {
    expect(await listed()).toEqual({ problem: P, now: new Date(t.clock.tick).toISOString(), proposals: [] });
    const before = await stateOf();
    const { id, at } = await proposed(A, good);
    expect(at).toBe(new Date(t.clock.tick).toISOString());
    expect(await listed()).toEqual({
      problem: P,
      now: at,
      proposals: [
        {
          id,
          under: P,
          name: 'method',
          hash: H,
          piece: method,
          why: WHY,
          key: addr(A),
          root: addr(A),
          at,
          proposer: 'Ada',
          worked: false,
          taken: null,
          pursued: [],
        },
      ],
    });
    expect({ ...(await stateOf()), now: null }).toEqual({ ...before, now: null });
  });

  const { schema: _schema, agree: _agree, ...bare } = method;
  const refusals: [string, Record<string, unknown>, string][] = [
    [
      'a name that is no slug',
      { ...good, name: 'Method' },
      'body.name: lower-case letters, digits and hyphens, at most 64',
    ],
    [
      'a name in a family',
      { ...good, name: 'statement/3' },
      'body.name: lower-case letters, digits and hyphens, at most 64',
    ],
    ['no piece', { name: 'method', why: WHY }, 'body.piece: an object'],
    [
      'a family',
      { ...good, piece: { ...method, count: 2 } },
      'body.piece.count: a proposal is one piece and has no count',
    ],
    [
      'data',
      { ...good, piece: { ...method, data: { paper: 'paper.txt' } } },
      'body.piece.data: a proposed piece draws on no data',
    ],
    [
      'a piece over the size',
      { ...good, piece: { ...method, brief: 'word '.repeat(4000) } },
      'body.piece: at most 16384 bytes as canonical JSON',
    ],
    [
      'a piece that waits on itself',
      { ...good, piece: { ...method, inputs: ['statement/*', 'method'] } },
      'body.piece.inputs: a proposed piece does not wait on itself',
    ],
    [
      'a link in the brief',
      { ...good, piece: { ...method, brief: 'Read https://example.org/paper and say.' } },
      'body.piece.brief: no links or markup',
    ],
    ['no reason', { name: 'method', piece: method }, 'body.why: text of at most 500 characters'],
    ['a blank reason', { ...good, why: '   ' }, 'body.why: text of at most 500 characters'],
    ['a reason over the length', { ...good, why: 'so '.repeat(167) }, 'body.why: text of at most 500 characters'],
    [
      'a link in the reason',
      { ...good, why: 'See https://example.org/why for the reason.' },
      'body.why: no links or markup',
    ],
    ['a field a proposal has not', { ...good, stake: 5 }, 'body.stake: not a field of a proposal'],
    ['the name of a piece', { ...good, name: 'summary' }, 'body.name: this problem has a piece named summary'],
    ['the name of a family', { ...good, name: 'statement' }, 'body.name: this problem has a family named statement'],
    // The piece's own faults, the envelope's and the door's, said of `body.piece`.
    ['a piece of no kind', { ...good, piece: { ...method, verifier: '' } }, 'body.piece.verifier: a kind'],
    ['a brief that is no text', { ...good, piece: { ...method, brief: 7 } }, 'body.piece.brief: text'],
    ['a piece with no schema', { ...good, piece: bare }, 'body.piece.schema: required'],
    [
      'an input the problem has not',
      { ...good, piece: { ...method, inputs: ['nowhere'] } },
      'body.piece.inputs: nowhere is not a piece of this problem',
    ],
    [
      'a lease past what a door takes',
      { ...good, piece: { ...method, lease_h: 2_000_000 } },
      'body.piece.lease_h: at most 1000000 hours',
    ],
    [
      'a field a piece has not',
      { ...good, piece: { ...method, colour: 'red' } },
      'body.piece.colour: not a field of a piece',
    ],
    [
      'agree fields the schema has not',
      { ...good, piece: { ...method, agree: ['quote'] } },
      'body.piece.agree: names fields the schema has',
    ],
  ];
  it.each(refusals)('refuses %s', async (_what, body, why) => {
    expect(await refused(`/p/${P}/events`, ev(C, 'propose', body, P))).toBe(why);
  });

  it('refuses a proposal that names a piece, and holds the body to its shape whatever the door asked first', async () => {
    expect(await refused(`/p/${P}/events`, ev(C, 'propose', good, P, hashes.summary))).toBe(
      'a proposal names a problem and no piece',
    );
    expect(proposeBodyProblems('a piece')).toEqual(['body: an object']);
    expect(proposeBodyProblems(good)).toEqual([]);
    expect(proposeBodyProblems({ ...good, why: 'so '.repeat(166) })).toEqual([]);
    expect(proposeBodyProblems({ name: 'Method', piece: { ...method, count: 2 }, why: '', more: 1 })).toEqual([
      'body.name: lower-case letters, digits and hyphens, at most 64',
      'body.piece.count: a proposal is one piece and has no count',
      'body.why: text of at most 500 characters',
      'body.more: not a field of a proposal',
    ]);
    expect((await each('id')).length).toBe(1);
  });

  it('makes room for the one piece in the budget, and says a bound of the door in the door own words', async () => {
    const row = { ...agree, count: 1000, brief: 'Row {n}: does it hold?' };
    const wide = await publish(envelope(owner, 'wide', { 'row/*': row }, { settings: { budget: 1000 } }));
    const over = { ...method, inputs: Array<string>(1001).fill('row/*') };
    expect(await refused(`/p/${wide}/events`, ev(C, 'propose', { ...good, piece: over }, wide))).toBe(
      'problem.pieces: inputs that make 1001000 links, over the 1000000 a door takes',
    );
    await proposed(C, { ...good, piece: { ...method, inputs: ['row/*'] } }, wide);
    expect(await each('name', wide)).toEqual(['method']);
  });

  it('refuses a root its second proposal of one piece in words, and keeps what others propose beside it', async () => {
    const again = ev(A, 'propose', { ...good, why: 'Said again, in other words.' }, P);
    expect(await refused(`/p/${P}/events`, again)).toBe('this root already proposed this piece');
    const second = ev(B, 'propose', { ...good, why: 'The second reader missed it too.' }, P);
    await accepted(`/p/${P}/events`, second);
    // The door admits before it dedupes: the same event again is refused as the root's second, not answered 409.
    expect(await refused(`/p/${P}/events`, second)).toBe('this root already proposed this piece');
    const other = { ...method, brief: 'Does the paper name who drew the sample?' };
    await proposed(C, { name: 'method', piece: other, why: 'The method is a person here, not a procedure.' });
    const rows = (await listed()).proposals;
    expect(rows.map((p) => [p.root, p.name, p.hash])).toEqual([
      [addr(A), 'method', H],
      [addr(B), 'method', H],
      [addr(C), 'method', proposedHash('method', other)],
    ]);
    expect(rows.map((p) => p.proposer)).toEqual(['Ada', null, null]);
    expect(rows[2]!.hash).not.toBe(H);
  });
});

describe('what the tracker says of each proposal (QX-22 section 3)', () => {
  it('says whose work stands on the problem: a root of an accepting set, or of a reading on a record piece', async () => {
    await proposed(D, { name: 'scale', piece: { ...method, brief: 'Does the paper say at what scale?' }, why: WHY });
    await proposed(owner, { name: 'limits', piece: { ...method, brief: 'Does the paper name its limits?' }, why: WHY });
    await proposed(E, {
      name: 'unsaid',
      piece: { ...method, brief: 'Does the paper say what it left out?' },
      why: WHY,
    });
    expect(await each('worked')).toEqual([false, false, false, false, false, false]);
    await returned(A, 'anthropic/claude', hashes['statement/1']!);
    await returned(B, 'openai/gpt-5', hashes['statement/1']!);
    await returned(E, 'google/gemini', hashes.reading!);
    const state = await stateOf();
    expect(state.pieces.find((x) => x.name === 'statement/1')!.state).toBe('accepted_provisional');
    expect(state.pieces.find((x) => x.name === 'reading')!.state).toBe('recording');
    expect((await listed()).proposals.map((p) => [p.root, p.worked])).toEqual([
      [addr(A), true],
      [addr(B), true],
      [addr(C), false],
      [addr(D), false],
      [addr(owner), false],
      [addr(E), true],
    ]);
  });

  let v2: Hash, v3: Hash;
  it('names the version that took a piece, read over the chain of the version asked, under the hash proposed', async () => {
    const taking = envelope(owner, 'paper', { ...pieces, method }, { title: 'What one paper says', prev: P });
    expect(expandPieces(taking.problem, new Map()).find((x) => x.name === 'method')!.hash).toBe(H);
    v2 = await publish(taking);
    expect((await stateOf(v2)).pieces.find((x) => x.name === 'method')!.hash).toBe(H);
    // Both proposals of the piece are taken, the other piece under its name is not, and the work still stands.
    const rows = (await listed(v2)).proposals;
    expect(rows.map((p) => [p.under, p.name, p.taken])).toEqual([
      [P, 'method', v2],
      [P, 'method', v2],
      [P, 'method', null],
      [P, 'scale', null],
      [P, 'limits', null],
      [P, 'unsaid', null],
    ]);
    expect(rows.map((p) => p.worked)).toEqual([true, true, false, false, false, true]);
    // A read at the first version says nothing of a later one.
    expect(await each('taken')).toEqual([null, null, null, null, null, null]);

    // A proposal under the first version is listed at the head; one under the head is not listed at the first.
    const sample = { ...method, brief: 'Does the paper give the size of the sample?' };
    await proposed(D, { name: 'sample', piece: sample, why: WHY });
    const { id: atHead } = await proposed(
      A,
      { name: 'source', piece: { ...sample, brief: 'Whose data is it?' }, why: WHY },
      v2,
    );
    // The first version's chain does not hold the head's proposals, so its door takes the same one again, and the
    // head's read passes the later of the two over.
    await proposed(A, { name: 'source', piece: { ...sample, brief: 'Whose data is it?' }, why: WHY });
    expect(await each('name')).toEqual(['method', 'method', 'method', 'scale', 'limits', 'unsaid', 'sample', 'source']);
    const head = (await listed(v2)).proposals;
    expect(head.map((p) => p.name)).toEqual([
      'method',
      'method',
      'method',
      'scale',
      'limits',
      'unsaid',
      'sample',
      'source',
    ]);
    expect(head.at(-1)).toMatchObject({ id: atHead, under: v2, taken: null });
    expect(head.at(-2)).toMatchObject({ under: P, name: 'sample' });
    // The head's door knows the name the version took.
    expect(await refused(`/p/${v2}/events`, ev(C, 'propose', good, v2))).toBe(
      'body.name: this problem has a piece named method',
    );

    // A piece taken and later dropped keeps the version that took it.
    v3 = await publish(envelope(owner, 'paper', pieces, { title: 'What one paper says', prev: v2 }));
    expect((await each('taken', v3)).slice(0, 3)).toEqual([v2, v2, null]);
  });

  it('names the forks that pursue a piece, each at its head, and none taken down or replaced', async () => {
    const pursuing = (problem: Hash) => each('pursued', problem);
    const first = await publish(envelope(forker, 'paper-pursued', { ...pieces, method }, { from: P }));
    await publish(envelope(D, 'paper-apart', pieces, { from: v2 }));
    expect((await pursuing(v3)).slice(0, 3)).toEqual([[first], [first], []]);
    // The fork names the first version, which the read at any version of the line has on its line.
    expect((await pursuing(P)).slice(0, 3)).toEqual([[first], [first], []]);
    expect((await pursuing(v3)).slice(3).flat()).toEqual([]);

    // The fork's own next version leaves `from` out, and is the fork listed from then on.
    const head = await publish(envelope(forker, 'paper-pursued', { ...pieces, method }, { prev: first, title: 'On' }));
    expect((await pursuing(v3)).slice(0, 3)).toEqual([[head], [head], []]);

    const hide = await post('/k/events', ev(M, 'hide', { id: head, why: 'The brief names a private person.' }));
    expect(hide.status, await hide.clone().text()).toBe(202);
    expect((await pursuing(v3)).flat()).toEqual([]);
  });
});

describe('the proposals that stand, over receipts made by hand (QX-22 section 2)', () => {
  const at = (s: number) => `2026-11-09T13:00:${String(s).padStart(2, '0')}.000Z`;
  const made = (k: Uint8Array, body: Record<string, unknown>, s: number, more: { type?: string; piece?: Hash } = {}) =>
    line(signEvent({ quilt: 1, type: 'propose', problem: P, key: addr(k), ts: at(s), body, ...more }, k), at(s));
  const own = (k: Address) => k;
  const receipts = [
    made(A, good, 1),
    made(A, { ...good, why: 'Again.' }, 2),
    made(B, good, 3),
    made(C, { ...good, name: 'Method' }, 4),
    made(C, good, 5, { piece: H }),
    made(C, good, 6, { type: 'claim' }),
    made(D, { ...good, name: 'later' }, 7),
    made(C, good, 50),
  ];

  it('is the well-formed propose events in receipt order, the first of one root for one piece', () => {
    const standing = standingProposals([...receipts].reverse(), own, at(10));
    expect(standing.map((p) => [p.key, p.name, p.at])).toEqual([
      [addr(A), 'method', at(1)],
      [addr(B), 'method', at(3)],
      [addr(D), 'later', at(7)],
    ]);
    expect(standing[0]).toMatchObject({ under: P, hash: H, piece: method, why: WHY, root: addr(A) });
    expect(standing[2]!.hash).toBe(proposedHash('later', method));
    // Once its receipt's time has come, the last one stands too.
    expect(standingProposals(receipts, own, at(50)).map((p) => p.key)).toEqual([addr(A), addr(B), addr(D), addr(C)]);
  });

  it('counts a key for its root, so two keys of one root propose a piece once', () => {
    const rootOf = (k: Address) => (k === addr(B) ? addr(A) : k);
    expect(standingProposals(receipts, rootOf, at(10)).map((p) => [p.key, p.root])).toEqual([
      [addr(A), addr(A)],
      [addr(D), addr(D)],
    ]);
  });
});
