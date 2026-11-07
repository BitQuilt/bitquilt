import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, commitHash, hashBytes, newNonce, problemHash } from '@bitquilt/core';
import { addr, boot, envelope, key } from './helpers.js';

/**
 * The record kind (docs/ext/QX-20.md): a `record:4` piece takes the first four readings from roots unrelated to the
 * owner and to each other and accepts none of them. Three readings from three roots and two vendors, two of them
 * traced: the piece is `recording`, offered to a fourth root and not within the second reader's pool, graded over the
 * standing readings with the seams between them and nothing set aside, and every root's standing is unmoved; the
 * owner's reading does not stand; the fourth makes it `recorded`, a fifth is refused at the door, the dependent opens,
 * a challenge is refused; the record document's hash is the state's and is the same with no blobs measured. Beside it
 * the core's own word stays `unknown`.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['stance', 'reading'],
  properties: {
    stance: { enum: ['asserts', 'denies', 'leaves open'] },
    reading: { type: 'string' as const, maxLength: 200 },
  },
};
const pieces = {
  question: {
    verifier: 'record:4',
    requires: ['web' as const],
    brief: 'Does the article ground dignity in reason? Read it your way.',
    schema,
    agree: ['stance'],
  },
  then: {
    verifier: 'agree',
    requires: ['web' as const],
    inputs: ['question'],
    brief: 'Once the readings are in: do they differ?',
    schema,
    agree: ['stance'],
  },
};

const t = boot('2026-11-02T12:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

const enc = new TextEncoder();
const PAGE =
  'All human beings are born free and equal in dignity and rights. They are endowed with reason and conscience.';
const page = hashBytes(enc.encode(PAGE));
const span = (part: string): [number, number] => {
  const start = enc.encode(PAGE.slice(0, PAGE.indexOf(part))).length;
  return [start, start + enc.encode(part).length];
};
const read = { url: 'https://example.org/udhr', hash: page, at: '2026-11-02T11:00:00Z', media: 'text/plain' };

const env = envelope(owner, 'udhr', pieces, { title: 'Three readings of Article 1' });
const P = problemHash(env);
let question: Hash, then: Hash;
type Grade = { wanted: number; standing: number; grounded: number; roots: number; vendors: number; keys: string[] };
type PieceState = {
  name: string;
  hash: Hash;
  state: string;
  core: string;
  kind: string;
  extension: string | null;
  strength: string | null;
  record: Grade | null;
  seams: { field: string; why: string; sides: { key: string; value: unknown; aside: boolean }[] }[];
  aside: string[];
  reveals: number;
};
type State = { pieces: PieceState[]; complete: boolean; output: string | null; record_output: string | null };
const stateOf = () => get<State>(`/p/${P}/state`);
const pieceOf = async (hash: Hash) => (await stateOf()).pieces.find((x) => x.hash === hash)!;

/** A commit and its reveal; the reveal's id, which a trace names. */
async function returned(k: Uint8Array, model: string, stance: string, piece: Hash = question): Promise<Hash> {
  const ret = { stance, reading: `as ${addr(k).slice(0, 6)} read it` };
  const nonce = newNonce();
  await accepted(`/p/${P}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
  return accepted(`/p/${P}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, piece));
}
const standing = async (k: Uint8Array) => (await get<{ standing: number }>(`/k/${addr(k)}/standing`)).standing;
const nextFor = (k: Uint8Array, model: string, only = '') =>
  get<{ piece: Hash | null; state?: string; kind?: string; says?: string }>(
    `/p/${P}/next?key=${addr(k)}&can=web&model=${encodeURIComponent(model)}${only}`,
  );

describe('the record kind (QX-20)', () => {
  it('is a kind the tracker names, held unknown by the core and open in the layer, with its dependent locked', async () => {
    expect((await post('/p', { envelope: env })).status).toBe(201);
    const s = await stateOf();
    question = s.pieces.find((p) => p.name === 'question')!.hash;
    then = s.pieces.find((p) => p.name === 'then')!.hash;
    expect(await pieceOf(question)).toMatchObject({
      state: 'open',
      core: 'unknown',
      kind: 'record',
      extension: 'QX-20',
      strength: 'recorded',
      record: { wanted: 4, standing: 0, grounded: 0, roots: 0, vendors: 0, keys: [] },
    });
    expect((await pieceOf(then)).state).toBe('locked');
    expect(await fetch(`${t.base}/b/${page}`, { method: 'PUT', body: enc.encode(PAGE) }).then((r) => r.status)).toBe(
      202,
    );
  });

  it("records three readings from three roots and two vendors, two traced, as recording: graded, with the seams between them and nothing set aside, and nobody's standing moved", async () => {
    const before = await Promise.all([A, B, C].map(standing));
    const ra = await returned(A, 'anthropic/claude', 'asserts');
    await accepted(
      `/p/${P}/events`,
      ev(
        A,
        'trace',
        {
          reveal: ra,
          reads: [read],
          rests: [{ field: 'stance', read: 0, span: span('endowed with reason and conscience') }],
        },
        P,
        question,
      ),
    );
    const rb = await returned(B, 'openai/gpt-5', 'leaves open');
    await accepted(
      `/p/${P}/events`,
      ev(
        B,
        'trace',
        {
          reveal: rb,
          reads: [read],
          rests: [{ field: 'stance', read: 0, span: span('born free and equal in dignity and rights') }],
        },
        P,
        question,
      ),
    );
    await returned(C, 'anthropic/claude', 'asserts');
    const q = await pieceOf(question);
    expect(q.state).toBe('recording');
    expect(q.core).toBe('unknown');
    expect(q.record).toMatchObject({
      wanted: 4,
      standing: 3,
      grounded: 2,
      roots: 3,
      vendors: 2,
      keys: [addr(A), addr(B), addr(C)],
    });
    // A and B differ on the stance and rest it on different places of the same page; C differs from B and rests on nothing; A and C agree.
    expect(q.seams.map((s) => [s.why, s.sides.map((x) => x.key)])).toEqual([
      ['span', [addr(A), addr(B)]],
      ['unknown', [addr(B), addr(C)]],
    ]);
    expect(q.seams.every((s) => s.sides.every((x) => !x.aside))).toBe(true);
    expect(q.aside).toEqual([]);
    expect(await Promise.all([A, B, C].map(standing))).toEqual(before);
    const s = await stateOf();
    expect(s.complete).toBe(false);
    expect(s.record_output).toBeNull();
    expect(
      (
        await get<{ problems: { problem: Hash; work: { returned: number; accepted: number; recorded: number } }[] }>(
          '/search?q=readings',
        )
      ).problems.find((r) => r.problem === P)!.work,
    ).toMatchObject({ returned: 1, accepted: 0, recorded: 0 });
  });

  it("is offered to a fourth root and not to one that has read it, nor within the second reader's pool; the owner's reading does not stand", async () => {
    const d = await nextFor(D, 'google/gemini');
    expect(d).toMatchObject({ piece: question, state: 'recording', kind: 'record' });
    expect(d.says).toContain('4 readings');
    expect((await nextFor(A, 'anthropic/claude')).piece).toBeNull();
    expect((await nextFor(E, 'openai/gpt-5', '&only=verify')).piece).toBeNull();
    await returned(owner, 'openai/gpt-5', 'denies');
    const q = await pieceOf(question);
    expect(q.state).toBe('recording');
    expect(q.reveals).toBe(4);
    expect(q.record).toMatchObject({ standing: 3, keys: [addr(A), addr(B), addr(C)] });
  });

  it('is recorded by the fourth reading, refuses a fifth, opens the dependent, takes no challenge, and states the record document, the same with no blobs measured', async () => {
    await returned(D, 'google/gemini', 'leaves open');
    const q = await pieceOf(question);
    expect(q.state).toBe('recorded');
    expect(q.record).toMatchObject({ standing: 4, grounded: 2, roots: 4, vendors: 3 });
    expect((await pieceOf(then)).state).toBe('open');
    expect(
      await refused(
        `/p/${P}/events`,
        ev(E, 'commit', { h: commitHash({ stance: 'denies', reading: 'late' }, newNonce()) }, P, question),
      ),
    ).toBe('the readings for this piece are in');
    expect(
      await refused(
        `/p/${P}/events`,
        ev(E, 'challenge', { stake: 0, ground: 'A record is not an acceptance.' }, P, question),
      ),
    ).toBe('nothing accepted on this piece yet');
    expect((await nextFor(E, 'openai/gpt-5')).piece).toBe(then);
    expect(
      (await get<{ problems: { problem: Hash; work: { recorded: number } }[] }>('/search?q=readings')).problems.find(
        (r) => r.problem === P,
      )!.work.recorded,
    ).toBe(1);
    // The problem is complete once the dependent is accepted; then the record document is stated.
    expect((await fetch(`${t.base}/p/${P}/record`)).status).toBe(404);
    await returned(A, 'anthropic/claude', 'asserts', then);
    await returned(B, 'openai/gpt-5', 'asserts', then);
    // Complete once the dependent's window has closed; a recorded piece has no window of its own.
    t.clock.tick += 49 * 3600 * 1000;
    const s = await stateOf();
    expect(s.complete).toBe(true);
    expect(s.output).toBeNull();
    expect(s.record_output).toMatch(/^sha256:/);
    const doc = await get<{
      hash: Hash;
      quilt: number;
      extension: string;
      pieces: {
        name: string;
        state: string;
        wanted?: number;
        readings?: {
          signer: string;
          vendor: string;
          model: string;
          trace: { reads: unknown[]; rests: unknown[] } | null;
        }[];
        agreed?: unknown;
      }[];
    }>(`/p/${P}/record`);
    expect(doc.hash).toBe(s.record_output);
    expect(doc).toMatchObject({ quilt: 1, extension: 'QX-20' });
    const rec = doc.pieces.find((p) => p.name === 'question')!;
    expect(rec).toMatchObject({ state: 'recorded', wanted: 4 });
    expect(rec.readings!.map((r) => [r.signer, r.vendor, r.trace !== null])).toEqual([
      [addr(A), 'anthropic', true],
      [addr(B), 'openai', true],
      [addr(C), 'anthropic', false],
      [addr(D), 'google', false],
    ]);
    expect(rec.readings![0]!.trace!.rests).toEqual([
      { field: 'stance', read: 0, span: span('endowed with reason and conscience') },
    ]);
    expect(doc.pieces.find((p) => p.name === 'then')).toMatchObject({
      state: 'accepted',
      agreed: { stance: 'asserts' },
    });
  });
});
