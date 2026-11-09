/**
 * What the core computes once for what a store hands out frozen (CORE.md sections 2, 3 and 6): an event's id and
 * signer, an envelope's hash, faults and pieces, and a blob's hash for the bytes handed in. Each answer is the answer
 * computed afresh; what is not frozen is computed each time it is asked, so an event or an envelope written to after
 * it was asked about is answered as it now stands; and a frozen problem's pieces follow the blobs handed with it, a
 * blob held later filling the slots it left empty.
 */
import { describe, expect, it } from 'vitest';
import { hashBytes, hashCanonical } from '../src/hash.js';
import { blobProblems, envelopeProblems, expandPieces, problemHash, type Envelope } from '../src/envelope.js';
import { eventId, eventSigner, signEvent, type Event } from '../src/events.js';
import { addressOf } from '../src/keys.js';

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
