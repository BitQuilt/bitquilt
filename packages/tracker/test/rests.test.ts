import { describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Hash,
  type Receipt,
  type Unsigned,
  commitHash,
  eventId,
  hashBytes,
  newNonce,
  problemHash,
  reduce,
  signEvent,
} from '@bitquilt/core';
import { passageIn, restsOf } from '../src/trace.js';
import { addr, envelope, key, line } from './helpers.js';

/**
 * What a reading rests on (QX-19), as `restsOf` reads it from the receipts, the rule the square page shows: each field
 * of a reading's trace with the page, the hash it was kept under and the passage as text; the page and its hash with
 * no passage where the bytes are not held; nothing for a reading with no trace, or for a trace another key posted on
 * it; the first trace where one reveal is named twice; and for a reading made under an earlier version, its trace on
 * that version's log, found when the receipts are every version's of the chain the view was folded from and missed
 * when they are the later version's log alone.
 */
const owner = key(9),
  A = key(1),
  B = key(2);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'contradicts'] } },
};
const family = (brief: string) => ({
  count: 1,
  verifier: 'agree',
  requires: ['web' as const],
  brief,
  schema,
  agree: ['verdict'],
});
const at = (m: number) => new Date(Date.parse('2026-11-07T08:00:00Z') + m * 60_000).toISOString();

const enc = new TextEncoder();
const PAGE = 'The paper says the effect holds in every trial. A later section says it does not hold at scale.';
const HOLDS = 'the effect holds in every trial';
const NOT_AT_SCALE = 'it does not hold at scale';
const page = enc.encode(PAGE);
const kept = hashBytes(page);
const URL = 'https://example.org/paper';
/** A passage's span in the page, in bytes. */
const span = (part: string): [number, number] => {
  const start = enc.encode(PAGE.slice(0, PAGE.indexOf(part))).length;
  return [start, start + enc.encode(part).length];
};
/** The page's bytes where `held`, as a store that keeps them would read a passage. */
const passage = (held: boolean) => (h: Hash, s: [number, number]) => passageIn(held && h === kept ? page : null, s);

/** The first version, its claim and check pieces; the second, which keeps the claim and sharpens the check. */
const first: Envelope = envelope(owner, 'rests', {
  'claim/*': family('Claim {n}: does the paper say so?'),
  'check/*': family('Check {n}: does it hold at scale?'),
});
const p1 = problemHash(first);
const second: Envelope = envelope(
  owner,
  'rests',
  {
    'claim/*': family('Claim {n}: does the paper say so?'),
    'check/*': family('Check {n}: is scale read from the section that reports it?'),
  },
  { prev: p1 },
);
const pieces = reduce({ envelopes: [first], blobs: new Map(), receipts: [], now: at(0) }).pieces;
const claim = pieces.find((v) => v.piece.name === 'claim/1')!.piece.hash;
const check = pieces.find((v) => v.piece.name === 'check/1')!.piece.hash;

let minute = 0;
/** A commit and its reveal on a piece of the first version, as lines; the reveal's id, which a trace names. */
function returned(k: Uint8Array, piece: Hash, model: string, verdict: string): { lines: Receipt[]; reveal: Hash } {
  const ret = { verdict };
  const nonce = newNonce();
  const u = (type: string, body: Record<string, unknown>): Unsigned => ({
    quilt: 1,
    type,
    problem: p1,
    piece,
    key: addr(k),
    ts: at(++minute),
    body,
  });
  const commit = signEvent(u('commit', { h: commitHash(ret, nonce) }), k);
  const reveal = signEvent(u('reveal', { return: ret, nonce, by: by(model) }), k);
  return { lines: [line(commit, commit.ts), line(reveal, reveal.ts)], reveal: eventId(reveal) };
}
/** A trace by the key on a reveal, resting the verdict on a passage of the page. */
function traced(k: Uint8Array, piece: Hash, reveal: Hash, part: string): Receipt {
  const e = signEvent(
    {
      quilt: 1,
      type: 'trace',
      problem: p1,
      piece,
      key: addr(k),
      ts: at(++minute),
      body: {
        reveal,
        reads: [{ url: URL, hash: kept, at: at(0) }],
        rests: [{ field: 'verdict', read: 0, span: span(part) }],
      },
    },
    k,
  );
  return line(e, e.ts);
}
const rested = (part: string, held = true) => ({
  field: 'verdict',
  url: URL,
  hash: kept,
  span: span(part),
  passage: held ? part : null,
});

describe('what a reading rests on', () => {
  const a = returned(A, claim, 'anthropic/claude', 'supports');
  const b = returned(B, claim, 'openai/gpt-5', 'supports');
  const c = returned(A, check, 'anthropic/claude', 'supports');
  const d = returned(B, check, 'openai/gpt-5', 'contradicts');
  const log1 = [
    ...a.lines,
    ...b.lines,
    traced(A, claim, a.reveal, HOLDS),
    ...c.lines,
    ...d.lines,
    traced(A, check, c.reveal, HOLDS),
    traced(B, check, d.reveal, NOT_AT_SCALE),
  ];
  const fold = reduce({ envelopes: [first], blobs: new Map(), receipts: log1, now: at(60) });
  const claimView = fold.byHash.get(claim)!;
  const ra = claimView.reveals[0]!,
    rb = claimView.reveals[1]!;

  it("gives each field of a reading's trace with the page, its hash and the passage, and nothing for a reading with no trace", () => {
    const rests = restsOf(claimView, log1, passage(true));
    expect(rests(ra)).toEqual([rested(HOLDS)]);
    expect(rests(rb)).toEqual([]);
  });

  it('names the page and its hash with no passage where the bytes are not held', () => {
    expect(restsOf(claimView, log1, passage(false))(ra)).toEqual([rested(HOLDS, false)]);
  });

  it('keeps the first trace where one reveal is named twice', () => {
    const twice = [...log1, traced(A, claim, a.reveal, NOT_AT_SCALE)];
    const view = reduce({ envelopes: [first], blobs: new Map(), receipts: twice, now: at(60) }).byHash.get(claim)!;
    expect(restsOf(view, twice, passage(true))(view.reveals[0]!)).toEqual([rested(HOLDS)]);
  });

  it('takes no trace from a key that did not make the reveal it names', () => {
    // B's reading has no trace of its own, so A's trace on it would be the only one there.
    const foreign = [...log1, traced(A, claim, b.reveal, NOT_AT_SCALE)];
    const view = reduce({ envelopes: [first], blobs: new Map(), receipts: foreign, now: at(60) }).byHash.get(claim)!;
    expect(view.reveals[1]!.key).toBe(addr(B));
    expect(restsOf(view, foreign, passage(true))(view.reveals[1]!)).toEqual([]);
  });

  it("finds a reading made under an earlier version on that version's log, where the receipts are every version's of the chain", () => {
    const later = reduce({ envelopes: [second, first], blobs: new Map(), receipts: log1, now: at(60) });
    // The claim keeps its hash in the later version; the check's old hash is the later version's ancestral piece.
    const keptClaim = later.byHash.get(claim)!;
    const old = later.ancestral.get(check)!;
    expect(old.reveals).toHaveLength(2);
    const chain = restsOf(keptClaim, log1, passage(true));
    expect(keptClaim.reveals.map(chain)).toEqual([[rested(HOLDS)], []]);
    const ancestral = restsOf(old, log1, passage(true));
    expect(old.reveals.map(ancestral)).toEqual([[rested(HOLDS)], [rested(NOT_AT_SCALE)]]);
    // Nothing was posted to the later version's own log, so read alone it finds no rest beside the same readings.
    const own: Receipt[] = [];
    const alone = restsOf(keptClaim, own, passage(true));
    expect(keptClaim.reveals.map(alone)).toEqual([[], []]);
  });
});
