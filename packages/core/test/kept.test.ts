/**
 * What the core computes once for what a store hands out frozen through every level (CORE.md sections 2, 3 and 6),
 * and not for a value frozen at its top alone, which may still be written to below: an event's id and
 * signer, an envelope's hash, faults and pieces, and a blob's hash for the bytes handed in. Each answer is the answer
 * computed afresh; what is not frozen is computed each time it is asked, so an event or an envelope written to after
 * it was asked about is answered as it now stands; and a frozen problem's pieces follow the blobs handed with it, a
 * blob held later filling the slots it left empty. A line whose event is not an object is answered as it was before
 * anything was kept, and the fold passes over it; a blob's bytes rewritten after they were checked are checked again,
 * unless their holder fixed them (`fixedBytes`).
 */
import { describe, expect, it } from 'vitest';
import { hashBytes, hashCanonical } from '../src/hash.js';
import {
  blobProblems,
  envelopeProblems,
  expandPieces,
  fixedBytes,
  problemHash,
  type Envelope,
} from '../src/envelope.js';
import { eventId, eventSigner, signEvent, type Event } from '../src/events.js';
import { addressOf, signObject } from '../src/keys.js';
import { reduce } from '../src/reduce.js';

/** A copy made read-only through every level, as a store hands out what it keeps. */
function frozen<T>(value: T): T {
  const copy = structuredClone(value);
  const left: unknown[] = [copy];
  while (left.length) {
    const v = left.pop();
    if (v === null || typeof v !== 'object') continue;
    Object.freeze(v);
    for (const x of Object.values(v)) left.push(x);
  }
  return copy;
}

const secret = new Uint8Array(32);
secret[31] = 5;
const key = addressOf(secret);
/** Two citations, as one blob. */
const cites = new TextEncoder().encode(
  JSON.stringify([
    { sentence: 'Evaluations underestimate capabilities.', source: 'Chen et al. 2025' },
    { sentence: 'Models generalise across languages.', source: 'Okafor 2024' },
  ]),
);
const blobs = new Map([[hashBytes(cites), cites]]);
/** A problem of two citations drawn from that blob, its brief leaving a return slot as written. */
const sample: Envelope = {
  quilt: 1,
  problem: {
    title: 'Does the report say what its sources say?',
    done_when: 'Every citation has a verdict.',
    owner: '0x4E5f9B1a2C3d4E5f6A7B8C9D0E1F2A3b4c5D6E7f',
    slug: 'report-2026',
    prev: null,
    from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 10, budget: 100, patch_max: 100000 },
    pieces: {
      'cite/*': {
        count: 2,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Citation {n}: {cite.sentence} Source: {cite.source} Return the verdict. {other.thing} stays.',
        data: { cite: 'cites.json' },
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict'],
          properties: { verdict: { enum: ['supports', 'contradicts'] } },
        },
        agree: ['verdict'],
      },
    },
    data: { 'cites.json': hashBytes(cites) },
  },
  hints: { trackers: [], mirrors: [] },
  sig: `0x${'00'.repeat(65)}`,
};
const event = (name: string): Event =>
  signEvent({ quilt: 1, type: 'name', key, ts: '2026-11-09T12:00:00Z', body: { name } }, secret);

describe('an event', () => {
  it('frozen, has the id and signer computed afresh, each time it is asked', () => {
    const e = frozen(event('Kept'));
    const { sig: _s, ...rest } = e;
    for (let i = 0; i < 2; i++) {
      expect(eventId(e)).toBe(hashCanonical(rest));
      expect(eventSigner(e)).toBe(key);
    }
  });
  it('not frozen, is asked again as it now stands', () => {
    const e = event('Before');
    const before = eventId(e);
    (e.body as Record<string, unknown>).name = 'After';
    expect(eventId(e)).not.toBe(before);
    expect(eventId(e)).toBe(eventId({ ...e, body: { name: 'After' } }));
    expect(eventSigner(e)).not.toBe(key);
  });
});

describe('a value frozen at its top alone', () => {
  it('is asked again as it now stands below: an event whose return changed, an envelope whose brief changed', () => {
    const e = event('Shallow');
    const shallow = { ...e, body: Object.freeze({ name: 'Shallow', note: { by: 'one' } }) } as unknown as Event;
    Object.freeze(shallow);
    const before = eventId(shallow);
    ((shallow.body as { note: { by: string } }).note as { by: string }).by = 'another';
    expect(eventId(shallow)).not.toBe(before);
    const envelope: Envelope = structuredClone(sample);
    Object.freeze(envelope);
    Object.freeze(envelope.problem);
    const hash = problemHash(envelope);
    const pieces = expandPieces(envelope.problem, blobs);
    envelope.problem.pieces['cite/*']!.brief = 'Another brief {n}.';
    expect(problemHash(envelope)).not.toBe(hash);
    expect(expandPieces(envelope.problem, blobs)[0]!.brief).toBe('Another brief 1.');
    expect(expandPieces(envelope.problem, blobs)).not.toBe(pieces);
  });
});

describe('a line whose event is not an object', () => {
  it('has the id and signer it had before anything was kept, and the fold passes over it', () => {
    // As before: the id of what is left of the value without `sig` and `sig_to`, and no signer.
    for (const [e, rest] of [
      [1, {}],
      [true, {}],
      ['x', { 0: 'x' }],
    ] as const) {
      expect(eventId(e as unknown as Event)).toBe(hashCanonical(rest));
      expect(eventSigner(e as unknown as Event)).toBeNull();
    }
    const owner = new Uint8Array(32);
    owner[31] = 9;
    const unsigned = { ...sample, problem: { ...sample.problem, owner: addressOf(owner) } };
    const { sig: _sig, ...rest } = unsigned;
    const signed = frozen({ ...rest, sig: signObject(rest as Record<string, unknown>, owner) }) as Envelope;
    for (const e of [1, 'x', true] as unknown as Event[]) {
      const state = reduce({
        envelopes: [signed],
        blobs,
        receipts: [{ event: e, received: [{ by: 'http://tracker.test/', at: '2026-11-09T12:00:00.000Z' }] }],
        now: '2026-11-09T12:00:01.000Z',
      });
      expect(state.pieces).toHaveLength(2);
      expect(state.dropped).toEqual([]);
    }
  });
});

describe('an envelope', () => {
  it('frozen, has the hash, faults and pieces computed afresh, the pieces once for the same blobs', () => {
    const e = frozen(sample);
    expect(problemHash(e)).toBe(problemHash(sample));
    expect(problemHash(e)).toBe(problemHash(e));
    expect(envelopeProblems(e)).toEqual(envelopeProblems(sample));
    const pieces = expandPieces(e.problem, blobs);
    expect(pieces).toEqual(expandPieces(sample.problem, blobs));
    expect(expandPieces(e.problem, blobs)).toBe(pieces);
    expect(Object.isFrozen(pieces[0])).toBe(true);
  });
  it('frozen, has its pieces made again when other bytes are handed in, a blob held later filling its slots', () => {
    const e = frozen(sample);
    const without = expandPieces(e.problem, new Map());
    expect(without[0]!.brief).toBe('Citation 1:  Source:  Return the verdict. {other.thing} stays.');
    const filled = expandPieces(e.problem, blobs);
    expect(filled).not.toBe(without);
    expect(filled[0]!.brief).toContain('Evaluations underestimate capabilities.');
    const same = new Map([...blobs].map(([h, b]) => [h, Uint8Array.from(b)] as const));
    expect(expandPieces(e.problem, same)).not.toBe(filled);
    expect(expandPieces(e.problem, same)).toEqual(filled);
  });
  it('not frozen, is asked again as it now stands', () => {
    const e: Envelope = structuredClone(sample);
    const before = problemHash(e);
    expect(expandPieces(e.problem, blobs)).not.toBe(expandPieces(e.problem, blobs));
    e.problem.title = 'Another title';
    expect(problemHash(e)).not.toBe(before);
    e.problem.slug = 'Not A Slug';
    expect(envelopeProblems(e).some((x) => x.startsWith('problem.slug'))).toBe(true);
  });
});

describe("a blob's hash", () => {
  it('is checked again for bytes rewritten after they were checked, unless their holder fixed them', () => {
    const h = hashBytes(new TextEncoder().encode('[{"s":"one"}]'));
    const p = { ...sample.problem, data: { 'rows.json': h } };
    const buffer = new TextEncoder().encode('[{"s":"one"}]');
    const given = new Map([[h, buffer]]);
    expect(blobProblems(p, given)).toEqual([]);
    buffer.set(new TextEncoder().encode('[{"s":"two"}]'));
    expect(blobProblems(p, given)).toEqual(['blob rows.json: does not match its hash']);
    const fixed = fixedBytes(new TextEncoder().encode('[{"s":"one"}]'));
    expect(blobProblems(p, new Map([[h, fixed]]))).toEqual([]);
    expect(blobProblems(p, new Map([[h, fixedBytes(new Uint8Array([1]))]]))).toEqual([
      'blob rows.json: does not match its hash',
    ]);
  });
  it('is checked against the bytes handed in, once for the same bytes and again for others', () => {
    const e = frozen(sample);
    const h = Object.values(sample.problem.data)[0]!;
    const right = new Map([...blobs]);
    const wrong = new Map([[h, new Uint8Array([1])]]);
    expect(blobProblems(e.problem, right)).toEqual([]);
    expect(blobProblems(e.problem, wrong)).toEqual(['blob cites.json: does not match its hash']);
    expect(blobProblems(e.problem, right)).toEqual([]);
    expect(hashBytes(wrong.get(h)!)).not.toBe(h);
  });
});
