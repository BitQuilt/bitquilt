import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Address,
  type Envelope,
  type Hash,
  commitHash,
  hashBytes,
  newNonce,
  passageIn,
  problemHash,
  problemTraces,
  readsNamed,
  signEvent,
  traceBodyProblems,
} from '@bitquilt/core';
import { addr, boot, envelope as signed, key, layerOf } from './helpers.js';

/**
 * The trace (QX-19) at the tracker's door and in its layer: a read is kept under its hash and served, refused when it
 * does not hash right or weighs too much; a trace is kept from the key that revealed and refused from another key, on a
 * reveal not kept, on a read not held, on a span past the read or past the limit, on a field the return lacks, with no
 * reads, and twice on one reveal; an accepted square is graded none, one and both as the traces arrive; a disputed
 * piece's seams say why the two readings differ, source, span, reading or unknown, with each side's passage, and the
 * seams go out with the piece when next hands it over; the well-known document names the extension. And the seam
 * decides itself (section 4): a reading that rests on nothing where the other rests on the record is set aside, the
 * piece goes back out with the seam and the same key may read it again, a late trace lifts the set-aside, nothing is
 * set aside where neither side rests on anything, every pair is judged where a piece has three readings, and a problem
 * its owner replaced hands out nothing and leaves the index. A body whose read time Date.parse cannot read, or whose
 * read or span is not a whole number from 0, is refused with the same words as one with no field at all. The reads a
 * trace names are its hashes in its order, one at a time; a read that is not an object or whose hash is not a hash,
 * and reads that are not a list, name none, and no other event names any. What the state shows of each piece's traces
 * is `problemTraces` over the layer: the seams over the layer's fold for a piece it calls disputed and over the core's
 * for one where it set a reading aside.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict', 'quote'],
  properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 200 } },
};

function envelope(slug: string, count: number): Envelope {
  return signed(owner, slug, {
    'statement/*': {
      count,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: does the paper say so?',
      schema,
      agree: ['verdict'],
    },
  });
}

const t = boot('2026-11-02T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

const enc = new TextEncoder();
const PAGE = 'The paper says the effect holds in every trial. A later section says it does not hold at scale.';
const OTHER = 'A different page, which says the effect was never seen at all.';
const HOLDS = 'the effect holds in every trial';
const NOT_AT_SCALE = 'it does not hold at scale';
const NEVER = 'the effect was never seen at all';
/** A passage's span in a text, in bytes. */
const span = (text: string, part: string): [number, number] => {
  const start = enc.encode(text.slice(0, text.indexOf(part))).length;
  return [start, start + enc.encode(part).length];
};
const read = (hash: Hash) => ({
  url: 'https://example.org/paper',
  hash,
  at: '2026-11-02T11:00:00Z',
  media: 'text/plain',
});

let p: Hash;
const pieces: Record<string, Hash> = {};
let page: Hash, other: Hash;

async function put(bytes: Uint8Array, hash = hashBytes(bytes)): Promise<Response> {
  return fetch(`${t.base}/b/${hash}`, { method: 'PUT', body: bytes });
}
/** A commit and its reveal; the reveal's id, which a trace names. */
async function returned(piece: Hash, k: Uint8Array, model: string, verdict: string): Promise<Hash> {
  const ret = { verdict, quote: `as ${addr(k).slice(0, 6)} read it` };
  const nonce = newNonce();
  await accepted(`/p/${p}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, p, piece));
  return accepted(`/p/${p}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, p, piece));
}
const trace = (k: Uint8Array, piece: Hash, reveal: Hash, reads: unknown[], rests: unknown[]) =>
  ev(k, 'trace', { reveal, reads, rests }, p, piece);
type PieceState = {
  name: string;
  hash: Hash;
  state: string;
  traces: number;
  traced: string | null;
  seams: {
    field: string;
    why: string;
    sides: {
      key: Address;
      value: unknown;
      span: [number, number] | null;
      passage: string | null;
      read: { hash: Hash } | null;
    }[];
  }[];
};
const pieceOf = async (piece: Hash) =>
  ((await get(`/p/${p}/state`)) as { pieces: PieceState[] }).pieces.find((x) => x.hash === piece)!;

beforeAll(async () => {
  const e = envelope('traced', 5);
  p = problemHash(e);
  expect((await post('/p', { envelope: e })).status).toBe(201);
  for (const x of ((await get(`/p/${p}/state`)) as { pieces: PieceState[] }).pieces) pieces[x.name] = x.hash;
});

describe('reads as blobs', () => {
  it('keeps a blob under its hash and serves it, and refuses one that does not hash right or weighs too much', async () => {
    const bytes = enc.encode(PAGE);
    page = hashBytes(bytes);
    const r = await put(bytes);
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ hash: page, bytes: bytes.length });
    expect(new TextDecoder().decode(await (await fetch(`${t.base}/b/${page}`)).arrayBuffer())).toBe(PAGE);
    const wrong = await put(enc.encode(OTHER), page);
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: 'the bytes do not match the hash' });
    const heavy = await put(new Uint8Array(1024 * 1024 + 1));
    expect(heavy.status).toBe(413);
    other = hashBytes(enc.encode(OTHER));
    expect((await put(enc.encode(OTHER))).status).toBe(202);
    expect(((await get('/.well-known/quilt')) as { trace: unknown }).trace).toEqual({
      extension: 'QX-19',
      blob_max: 1024 * 1024,
    });
  });
});

describe('the trace body (section 1)', () => {
  const body = (r: Record<string, unknown>, x: Record<string, unknown>) => ({
    reveal: hashBytes(enc.encode('a reveal')),
    reads: [{ ...read(hashBytes(enc.encode(PAGE))), ...r }],
    rests: [{ field: 'verdict', read: 0, span: [0, 3], ...x }],
  });
  it('takes a read time Date.parse reads and whole numbers from 0, and refuses the rest with the same words', () => {
    expect(traceBodyProblems(body({}, {}))).toEqual([]);
    expect(traceBodyProblems(body({ at: '2026-11-02' }, { span: [0, 1] }))).toEqual([]);
    for (const at of ['yesterday', '', 1730000000000, null])
      expect(traceBodyProblems(body({ at }, {}))).toEqual(['read 0: url, hash and at']);
    for (const r of [-1, 0.5, '0', null, 1])
      expect(traceBodyProblems(body({}, { read: r }))).toEqual(['rest 0: read out of range']);
    for (const span of [
      [-1, 3],
      [0.5, 3],
      [0, '3'],
      [0, Number.POSITIVE_INFINITY],
    ])
      expect(traceBodyProblems(body({}, { span }))).toEqual([
        'rest 0: span is [start, end) with end at most 2000 past start',
      ]);
  });
});

describe('the reads a trace names', () => {
  const named = (type: string, body: Record<string, unknown>) =>
    readsNamed(signEvent({ quilt: 1, type, key: addr(A), ts: '2026-11-02T12:00:00Z', body }, A));
  it('are the hashes in its order, one at a time, each a hash, and none on another event', () => {
    const h = hashBytes(enc.encode(PAGE));
    const g = hashBytes(enc.encode(`${PAGE} again`));
    expect([...named('trace', { reads: [read(h), read(g), read(h)] })]).toEqual([h, g, h]);
    // A read that is not an object, or whose hash is not a hash, names nothing, and the reads after it are named.
    for (const hash of ['not a hash', '..', '../ledger', 7, { a: 1 }, null, undefined])
      expect([...named('trace', { reads: [read(h), { ...read(g), hash }, read(g)] })]).toEqual([h, g]);
    expect([...named('trace', { reads: [null, 7, 'x', [read(h)], read(g)] })]).toEqual([g]);
    // Reads that are not a list name nothing, and nothing is thrown.
    for (const reads of [5, 'reads', {}, { 0: read(h) }, null, true])
      expect([...named('trace', { reads })]).toEqual([]);
    expect([...named('trace', {})]).toEqual([]);
    expect([...named('reveal', { reads: [read(h)] })]).toEqual([]);
  });
});

describe('a trace at the door, and the grade of a square', () => {
  it('keeps a trace from the key that revealed, grades the square as the traces arrive, and refuses the rest with the reason', async () => {
    const piece = pieces['statement/1']!;
    const ra = await returned(piece, A, 'anthropic/claude', 'supports');
    const rb = await returned(piece, B, 'openai/gpt-5', 'supports');
    expect(await pieceOf(piece)).toMatchObject({ state: 'accepted_provisional', traces: 0, traced: 'none', seams: [] });
    const rest = { field: 'verdict', read: 0, span: span(PAGE, HOLDS) };
    // Not the key that revealed; a reveal the piece does not have; a read not held; spans outside the read and past the
    // limit; a field the return lacks; no reads.
    expect(await refused(`/p/${p}/events`, trace(C, piece, ra, [read(page)], [rest]))).toBe(
      "body.reveal: the id of this key's reveal on the piece",
    );
    expect(
      await refused(`/p/${p}/events`, trace(A, piece, hashBytes(enc.encode('elsewhere')), [read(page)], [rest])),
    ).toBe("body.reveal: the id of this key's reveal on the piece");
    expect(
      await refused(`/p/${p}/events`, trace(A, piece, ra, [read(hashBytes(enc.encode('never put')))], [rest])),
    ).toBe('read 0: no such blob here; put it first');
    expect(
      await refused(
        `/p/${p}/events`,
        trace(A, piece, ra, [read(page)], [{ field: 'verdict', read: 0, span: [10, PAGE.length + 5] }]),
      ),
    ).toBe('rest 0: span outside the read');
    expect(
      await refused(
        `/p/${p}/events`,
        trace(A, piece, ra, [read(page)], [{ field: 'verdict', read: 0, span: [0, 2001] }]),
      ),
    ).toBe('rest 0: span is [start, end) with end at most 2000 past start');
    expect(
      await refused(`/p/${p}/events`, trace(A, piece, ra, [read(page)], [{ field: 'source', read: 0, span: [0, 5] }])),
    ).toBe('rest 0: source is not a field of the return');
    expect(
      await refused(`/p/${p}/events`, trace(A, piece, ra, [read(page)], [{ field: 'verdict', read: 1, span: [0, 5] }])),
    ).toBe('rest 0: read out of range');
    expect(await refused(`/p/${p}/events`, trace(A, piece, ra, [], [rest]))).toBe('body.reads: 1 to 16 reads');
    expect(await refused(`/p/${p}/events`, trace(A, piece, ra, [read(page)], []))).toBe('body.rests: 1 to 64 rests');
    expect(await pieceOf(piece)).toMatchObject({ traces: 0, traced: 'none' });
    // A's trace: the square rests on a kept read on one side.
    await accepted(`/p/${p}/events`, trace(A, piece, ra, [read(page)], [rest]));
    expect(await pieceOf(piece)).toMatchObject({ traces: 1, traced: 'one' });
    expect(await refused(`/p/${p}/events`, trace(A, piece, ra, [read(page)], [rest]))).toBe(
      'a trace already names this reveal',
    );
    // B's trace rests the quote and not the agreed field: kept, and the square still one-sided until the verdict rests
    // on something.
    await accepted(`/p/${p}/events`, trace(B, piece, rb, [read(page)], [{ field: 'quote', read: 0, span: [0, 9] }]));
    expect(await pieceOf(piece)).toMatchObject({ traces: 2, traced: 'one' });
  });

  it('grades both when both reveals rest the agreed field on a kept read', async () => {
    const piece = pieces['statement/2']!;
    const ra = await returned(piece, A, 'anthropic/claude', 'supports');
    const rb = await returned(piece, B, 'openai/gpt-5', 'supports');
    await accepted(
      `/p/${p}/events`,
      trace(A, piece, ra, [read(page)], [{ field: 'verdict', read: 0, span: span(PAGE, HOLDS) }]),
    );
    await accepted(
      `/p/${p}/events`,
      trace(
        B,
        piece,
        rb,
        [read(page), read(other)],
        [
          { field: 'verdict', read: 0, span: span(PAGE, HOLDS) },
          { field: 'quote', read: 1, span: [0, 16] },
        ],
      ),
    );
    expect(await pieceOf(piece)).toMatchObject({ state: 'accepted_provisional', traces: 2, traced: 'both', seams: [] });
    // The directory row counts the accepted squares by grade (APP.md, Search).
    const row = (
      (await get('/search?q=traced')) as {
        problems: { problem: Hash; work: { accepted: number; traced: { both: number; one: number; none: number } } }[];
      }
    ).problems.find((r) => r.problem === p)!;
    expect(row.work.traced.both).toBeGreaterThanOrEqual(1);
    expect(row.work.traced.both + row.work.traced.one + row.work.traced.none).toBeLessThanOrEqual(row.work.accepted);
  });
});

describe('seams', () => {
  it('says why two readings differ: different reads, the same read at different spans, the same span read two ways, and a side with nothing', async () => {
    const source = pieces['statement/3']!;
    const ra3 = await returned(source, A, 'anthropic/claude', 'supports');
    const rb3 = await returned(source, B, 'openai/gpt-5', 'contradicts');
    await accepted(
      `/p/${p}/events`,
      trace(A, source, ra3, [read(page)], [{ field: 'verdict', read: 0, span: span(PAGE, HOLDS) }]),
    );
    await accepted(
      `/p/${p}/events`,
      trace(B, source, rb3, [read(other)], [{ field: 'verdict', read: 0, span: span(OTHER, NEVER) }]),
    );
    const s3 = await pieceOf(source);
    expect(s3.state).toBe('disputed');
    expect(s3.traced).toBeNull();
    expect(s3.seams).toEqual([
      {
        field: 'verdict',
        why: 'source',
        sides: [
          { key: addr(A), value: 'supports', read: read(page), span: span(PAGE, HOLDS), passage: HOLDS, aside: false },
          {
            key: addr(B),
            value: 'contradicts',
            read: read(other),
            span: span(OTHER, NEVER),
            passage: NEVER,
            aside: false,
          },
        ],
      },
    ]);

    const spans = pieces['statement/4']!;
    const ra4 = await returned(spans, A, 'anthropic/claude', 'supports');
    const rb4 = await returned(spans, B, 'openai/gpt-5', 'contradicts');
    await accepted(
      `/p/${p}/events`,
      trace(A, spans, ra4, [read(page)], [{ field: 'verdict', read: 0, span: span(PAGE, HOLDS) }]),
    );
    await accepted(
      `/p/${p}/events`,
      trace(B, spans, rb4, [read(page)], [{ field: 'verdict', read: 0, span: span(PAGE, NOT_AT_SCALE) }]),
    );
    expect((await pieceOf(spans)).seams).toMatchObject([
      { field: 'verdict', why: 'span', sides: [{ passage: HOLDS }, { passage: NOT_AT_SCALE }] },
    ]);

    const reading = pieces['statement/5']!;
    const ra5 = await returned(reading, A, 'anthropic/claude', 'supports');
    const rb5 = await returned(reading, B, 'openai/gpt-5', 'contradicts');
    const sentence: [number, number] = [0, span(PAGE, HOLDS)[1] + 1];
    await accepted(
      `/p/${p}/events`,
      trace(A, reading, ra5, [read(page)], [{ field: 'verdict', read: 0, span: span(PAGE, HOLDS) }]),
    );
    // The same read, no trace yet on B's side: unknown; then B's overlapping span: a reading.
    expect((await pieceOf(reading)).seams).toMatchObject([
      {
        field: 'verdict',
        why: 'unknown',
        sides: [{ passage: HOLDS }, { key: addr(B), read: null, span: null, passage: null }],
      },
    ]);
    await accepted(
      `/p/${p}/events`,
      trace(B, reading, rb5, [read(page)], [{ field: 'verdict', read: 0, span: sentence }]),
    );
    expect((await pieceOf(reading)).seams).toMatchObject([
      { field: 'verdict', why: 'reading', sides: [{ passage: HOLDS }, { passage: PAGE.slice(0, sentence[1]) }] },
    ]);
  });

  it('hands the seams over with a disputed piece, and nothing with one that is not', async () => {
    const handed = (await get(`/p/${p}/next?key=${addr(C)}&can=web&model=meta/llama`)) as {
      piece: Hash;
      state: string;
      seams: { why: string }[];
    };
    expect(handed.state).toBe('disputed');
    expect(handed.seams.length).toBeGreaterThan(0);
    expect(['source', 'span', 'reading']).toContain(handed.seams[0]!.why);
    const fresh = envelope('plain', 1);
    expect((await post('/p', { envelope: fresh })).status).toBe(201);
    const plain = (await get(`/p/${problemHash(fresh)}/next?key=${addr(C)}&can=web&model=meta/llama`)) as {
      piece: Hash;
      state: string;
      seams: unknown[];
    };
    expect(plain).toMatchObject({ state: 'open', seams: [] });
  });
});

describe('a seam decides itself (section 4)', () => {
  let pa: Hash;
  const ps: Record<string, Hash> = {};
  type StatePiece = PieceState & { core: string; aside: Address[] };
  const stateOf = async (problem: Hash, piece: Hash) =>
    ((await get(`/p/${problem}/state`)) as { pieces: StatePiece[] }).pieces.find((x) => x.hash === piece)!;
  async function returnedOn(problem: Hash, piece: Hash, k: Uint8Array, model: string, verdict: string): Promise<Hash> {
    const ret = { verdict, quote: `as ${addr(k).slice(0, 6)} read it, ${verdict}` };
    const nonce = newNonce();
    await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
    return accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
  }
  const rested = (k: Uint8Array, problem: Hash, piece: Hash, reveal: Hash, at: [number, number]) =>
    ev(k, 'trace', { reveal, reads: [read(page)], rests: [{ field: 'verdict', read: 0, span: at }] }, problem, piece);

  beforeAll(async () => {
    const e = envelope('aside', 3);
    pa = problemHash(e);
    expect((await post('/p', { envelope: e })).status).toBe(201);
    for (const x of ((await get(`/p/${pa}/state`)) as { pieces: PieceState[] }).pieces) ps[x.name] = x.hash;
  });

  it('lifts the set-aside when the trace arrives, and sets nothing aside where neither side rests on anything', async () => {
    // First, so that afterwards every piece of the problem needs a second reading and next hands statement/1 and
    // nothing open.
    const x = ps['statement/2']!;
    const ra = await returnedOn(pa, x, A, 'anthropic/claude', 'supports');
    const rb = await returnedOn(pa, x, B, 'openai/gpt-5', 'contradicts');
    await accepted(`/p/${pa}/events`, rested(A, pa, x, ra, span(PAGE, HOLDS)));
    expect(await stateOf(pa, x)).toMatchObject({ state: 'needs_verify', aside: [addr(B)] });
    // The key's own list of readings says so (the directory's hot list, and a person's squares).
    expect(
      ((await get(`/k/${addr(B)}/work`)) as { readings: { piece: Hash; aside: boolean }[] }).readings.find(
        (r) => r.piece === x,
      )!.aside,
    ).toBe(true);
    expect(
      ((await get(`/k/${addr(A)}/work`)) as { readings: { piece: Hash; aside: boolean }[] }).readings.find(
        (r) => r.piece === x,
      )!.aside,
    ).toBe(false);
    await accepted(`/p/${pa}/events`, rested(B, pa, x, rb, [0, span(PAGE, HOLDS)[1] + 1]));
    const s = await stateOf(pa, x);
    expect(s).toMatchObject({ state: 'disputed', core: 'disputed', aside: [] });
    expect(s.seams).toMatchObject([{ why: 'reading', sides: [{ aside: false }, { aside: false }] }]);
    const y = ps['statement/3']!;
    await returnedOn(pa, y, A, 'anthropic/claude', 'supports');
    await returnedOn(pa, y, B, 'openai/gpt-5', 'contradicts');
    expect(await stateOf(pa, y)).toMatchObject({
      state: 'disputed',
      aside: [],
      seams: [{ why: 'unknown', sides: [{ aside: false }, { aside: false }] }],
    });
  });

  it('sets aside the reading that rests on nothing where the other rests on the record, hands the piece back with the seam, and takes a second reading from the same key', async () => {
    const x = ps['statement/1']!;
    const ra = await returnedOn(pa, x, A, 'anthropic/claude', 'supports');
    await returnedOn(pa, x, B, 'openai/gpt-5', 'contradicts');
    await accepted(`/p/${pa}/events`, rested(A, pa, x, ra, span(PAGE, HOLDS)));
    const s = await stateOf(pa, x);
    expect(s).toMatchObject({ state: 'needs_verify', core: 'disputed', aside: [addr(B)], traced: null });
    expect(s.seams).toMatchObject([
      {
        field: 'verdict',
        why: 'unknown',
        sides: [
          { key: addr(A), passage: HOLDS, aside: false },
          { key: addr(B), passage: null, aside: true },
        ],
      },
    ]);
    // B's commit is unrevealed in the layer's fold, so B is a candidate again, and is handed the piece with the seam.
    const handed = (await get(`/p/${pa}/next?key=${addr(B)}&can=web&model=openai/gpt-5`)) as {
      piece: Hash | null;
      state: string;
      seams: { sides: { aside: boolean }[] }[];
    };
    expect(handed).toMatchObject({ piece: x, state: 'needs_verify' });
    expect(handed.seams[0]!.sides.map((side) => side.aside)).toEqual([false, true]);
    // B reads again and agrees: the set is A's reading and B's second; the square is graded one; the core still calls
    // the piece disputed.
    await returnedOn(pa, x, B, 'openai/gpt-5', 'supports');
    expect(await stateOf(pa, x)).toMatchObject({
      state: 'accepted_provisional',
      core: 'disputed',
      aside: [addr(B)],
      traced: 'one',
    });
  });

  it("hands the piece back within the second reader's pool, asked with only=verify, where the open pieces outnumber it and the core's order would hand an open one", async () => {
    const e = envelope('pool', 5);
    const pp = problemHash(e);
    expect((await post('/p', { envelope: e })).status).toBe(201);
    const x = ((await get(`/p/${pp}/state`)) as { pieces: PieceState[] }).pieces.find(
      (v) => v.name === 'statement/1',
    )!.hash;
    const ra = await returnedOn(pp, x, A, 'anthropic/claude', 'supports');
    await returnedOn(pp, x, B, 'openai/gpt-5', 'contradicts');
    await accepted(`/p/${pp}/events`, rested(A, pp, x, ra, span(PAGE, HOLDS)));
    expect(await stateOf(pp, x)).toMatchObject({ state: 'needs_verify', aside: [addr(B)] });
    // Four open pieces and one needing a reading: next alone hands B an open piece, as the core orders them.
    const plain = (await get(`/p/${pp}/next?key=${addr(B)}&can=web&model=openai/gpt-5`)) as {
      piece: Hash | null;
      state: string;
    };
    expect(plain.state).toBe('open');
    expect(plain.piece).not.toBe(x);
    // Within the pool, the piece whose reading was set aside comes back to B with its seam.
    const pooled = (await get(`/p/${pp}/next?key=${addr(B)}&can=web&model=openai/gpt-5&only=verify`)) as {
      piece: Hash | null;
      state: string;
      seams: { sides: { aside: boolean }[] }[];
    };
    expect(pooled).toMatchObject({ piece: x, state: 'needs_verify' });
    expect(pooled.seams[0]!.sides.map((side) => side.aside)).toEqual([false, true]);
    // A word other than verify is refused.
    expect((await fetch(`${t.base}/p/${pp}/next?key=${addr(B)}&can=web&model=openai/gpt-5&only=all`)).status).toBe(400);
    // B reads again with the seam in hand, rests the reading on the record this time, and still differs: the layer
    // calls the piece disputed between the two readings that stand, and the seam is theirs, B's first still set aside.
    const rb = await returnedOn(pp, x, B, 'openai/gpt-5', 'contradicts');
    await accepted(`/p/${pp}/events`, rested(B, pp, x, rb, span(PAGE, NOT_AT_SCALE)));
    const s = await stateOf(pp, x);
    expect(s).toMatchObject({ state: 'disputed', core: 'disputed', aside: [addr(B)] });
    expect(s.seams).toMatchObject([
      {
        field: 'verdict',
        why: 'span',
        sides: [
          { key: addr(A), passage: HOLDS, aside: false },
          { key: addr(B), passage: NOT_AT_SCALE, aside: false },
        ],
      },
    ]);
  });

  it('judges every pair where a piece has three readings: a third that rests on the record sets aside each earlier one that rests on nothing, and the piece is folded with what stands', async () => {
    // A verdict with three values, so a third reading can differ from both before it.
    const three = {
      ...schema,
      properties: { ...schema.properties, verdict: { enum: ['supports', 'contradicts', 'silent'] } },
    };
    const e = signed(owner, 'third', {
      'statement/*': {
        count: 3,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Statement {n}: does the paper say so?',
        schema: three,
        agree: ['verdict'],
      },
    });
    const pt = problemHash(e);
    expect((await post('/p', { envelope: e })).status).toBe(201);
    const named = ((await get(`/p/${pt}/state`)) as { pieces: PieceState[] }).pieces;
    // The live shape: two readings that rest on nothing differ, and a third that differs from both rests on the record.
    // Each earlier reading loses its pair with the third and is set aside; the third stands alone, so the piece needs
    // its second reading, and the keys set aside may give it. Over the core's fold the seams are the three pairs, and a
    // side is set aside wherever its reading is.
    const x = named.find((v) => v.name === 'statement/1')!.hash;
    await returnedOn(pt, x, A, 'anthropic/claude', 'supports');
    await returnedOn(pt, x, B, 'openai/gpt-5', 'contradicts');
    const rc = await returnedOn(pt, x, C, 'anthropic/claude', 'silent');
    expect(await stateOf(pt, x)).toMatchObject({ state: 'disputed', core: 'disputed', aside: [] });
    await accepted(`/p/${pt}/events`, rested(C, pt, x, rc, span(PAGE, NOT_AT_SCALE)));
    const s = await stateOf(pt, x);
    expect(s).toMatchObject({ state: 'needs_verify', core: 'disputed', aside: [addr(A), addr(B)], traced: null });
    expect(s.seams).toMatchObject([
      {
        field: 'verdict',
        why: 'unknown',
        sides: [
          { key: addr(A), passage: null, aside: true },
          { key: addr(B), passage: null, aside: true },
        ],
      },
      {
        field: 'verdict',
        why: 'unknown',
        sides: [
          { key: addr(A), passage: null, aside: true },
          { key: addr(C), passage: NOT_AT_SCALE, aside: false },
        ],
      },
      {
        field: 'verdict',
        why: 'unknown',
        sides: [
          { key: addr(B), passage: null, aside: true },
          { key: addr(C), passage: NOT_AT_SCALE, aside: false },
        ],
      },
    ]);
    const handed = (await get(`/p/${pt}/next?key=${addr(B)}&can=web&model=openai/gpt-5&only=verify`)) as {
      piece: Hash | null;
      state: string;
    };
    expect(handed).toMatchObject({ piece: x, state: 'needs_verify' });
    // B reads again with the seams in hand and agrees with C: the set is theirs, across vendors, graded one.
    await returnedOn(pt, x, B, 'openai/gpt-5', 'silent');
    expect(await stateOf(pt, x)).toMatchObject({
      state: 'accepted_provisional',
      core: 'disputed',
      aside: [addr(A), addr(B)],
      traced: 'one',
    });
    // The other shape the layer decides: the third reading rests on the record, agrees with the first and differs from
    // the second, both of which rest on nothing. The second loses its pair and is set aside; the first and the third
    // agree but share a vendor, so the piece needs its second reading.
    const y = named.find((v) => v.name === 'statement/2')!.hash;
    await returnedOn(pt, y, A, 'anthropic/claude', 'supports');
    await returnedOn(pt, y, B, 'openai/gpt-5', 'contradicts');
    const ry = await returnedOn(pt, y, C, 'anthropic/claude', 'supports');
    await accepted(`/p/${pt}/events`, rested(C, pt, y, ry, span(PAGE, HOLDS)));
    const sy = await stateOf(pt, y);
    expect(sy).toMatchObject({ state: 'needs_verify', core: 'disputed', aside: [addr(B)] });
    expect(sy.seams).toMatchObject([
      {
        field: 'verdict',
        why: 'unknown',
        sides: [
          { key: addr(A), passage: null, aside: false },
          { key: addr(B), passage: null, aside: true },
        ],
      },
      {
        field: 'verdict',
        why: 'unknown',
        sides: [
          { key: addr(B), passage: null, aside: true },
          { key: addr(C), passage: HOLDS, aside: false },
        ],
      },
    ]);
    // And the shape the core decides on its own: a third reading that agrees with the other vendor's is the set, no
    // layer needed.
    const z = named.find((v) => v.name === 'statement/3')!.hash;
    await returnedOn(pt, z, A, 'anthropic/claude', 'supports');
    await returnedOn(pt, z, B, 'openai/gpt-5', 'contradicts');
    await returnedOn(pt, z, C, 'anthropic/claude', 'contradicts');
    expect(await stateOf(pt, z)).toMatchObject({
      state: 'accepted_provisional',
      core: 'accepted_provisional',
      aside: [],
    });
  });

  it('hands nothing on a problem its owner replaced with a newer version, says so in the state, and leaves it out of the index', async () => {
    const e = signed(
      owner,
      'aside',
      {
        'statement/*': {
          count: 3,
          verifier: 'agree',
          requires: ['web'],
          brief: 'Statement {n}: does the paper say so? The later section governs.',
          schema,
          agree: ['verdict'],
        },
      },
      { prev: pa },
    );
    expect((await post('/p', { envelope: e })).status).toBe(201);
    const newer = problemHash(e);
    expect(((await get(`/p/${pa}/state`)) as { superseded: Hash | null }).superseded).toBe(newer);
    expect(((await get(`/p/${newer}/state`)) as { superseded: Hash | null }).superseded).toBeNull();
    expect(await get(`/p/${pa}/next?key=${addr(C)}&can=web&model=meta/llama`)).toMatchObject({
      piece: null,
      superseded: newer,
    });
    const listed = ((await get('/search')) as { problems: { problem: Hash }[] }).problems.map((x) => x.problem);
    expect(listed).toContain(newer);
    expect(listed).not.toContain(pa);
  });
});

describe('the traces the state shows', () => {
  it("are problemTraces over the tracker's layer, for every piece of every problem here", async () => {
    const shown = { pieces: 0, traced: 0, seams: 0 };
    for (const [hash, pl] of layerOf(t).problems) {
      const read = problemTraces(
        pl,
        (h) => t.store.blobLength(h),
        (h, s) => passageIn(t.store.getBlob(h), s),
      );
      const state = await get<{ pieces: (PieceState & { record: unknown })[] }>(`/p/${hash}/state`);
      expect(
        state.pieces.map((x) => ({ traces: x.traces, traced: x.traced, seams: x.seams, record: x.record })),
      ).toEqual(
        pl.fold.pieces.map((v) => {
          const x = read.get(v.piece.hash)!;
          return { traces: x.traces.length, traced: x.traced, seams: x.seams, record: x.record };
        }),
      );
      for (const x of read.values()) {
        shown.pieces += 1;
        if (x.traced) shown.traced += 1;
        if (x.seams.length) shown.seams += 1;
      }
    }
    expect(shown.traced).toBeGreaterThan(0);
    expect(shown.seams).toBeGreaterThan(0);
  });
});
