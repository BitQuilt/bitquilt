import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type Envelope, problemHash } from '../src/envelope.js';
import { type Receipt, type Unsigned, commitHash, newNonce, signEvent } from '../src/events.js';
import { type Address, addressOf, signObject } from '../src/keys.js';
import { next } from '../src/next.js';
import { reduce } from '../src/reduce.js';

/**
 * The core reads the three extension verifier kinds (human, judge:n, attest; docs/ext/verifiers.md) as `unknown`, and
 * nothing that happens on such a piece changes that: not two people agreeing, not a candidate revealed, not an actor's
 * record. Its dependents stay locked, it is never offered, and the problem has no output. The extension decides on top
 * in the tracker; here is the floor it stands on, and the fixtures that fix it.
 */
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const owner = key(9), A = key(1), B = key(2), C = key(3);
const addr = (k: Uint8Array): Address => addressOf(k);
const T0 = Date.parse('2026-10-25T12:00:00Z');
const t = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const, 'person' as const] });
const verdict = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };
const text = { type: 'object' as const, additionalProperties: false as const, required: ['text'], properties: { text: { type: 'string' as const, maxLength: 200 } } };
const told = { type: 'object' as const, additionalProperties: false as const, required: ['who', 'how'], properties: { who: { type: 'string' as const, maxLength: 120 }, how: { enum: ['conversation', 'message'] } } };

const problem: Envelope['problem'] = {
  title: 'Three kinds the core does not know', done_when: 'Each is accepted by its own kind, elsewhere.', owner: addr(owner), slug: 'kinds', prev: null, from: null,
  settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
  pieces: {
    vote: { verifier: 'human', requires: ['person'], brief: 'Does the paper say so? A person answers.', schema: verdict, agree: ['verdict'] },
    summary: { verifier: 'judge:3', candidates: 2, requires: ['web'], brief: 'Summarise the paper.', schema: text },
    told: { verifier: 'attest', requires: [], brief: 'Tell one person and record it.', schema: told },
    after: { verifier: 'agree', requires: ['web'], inputs: ['told'], brief: 'Did they answer?', schema: verdict, agree: ['verdict'] },
    plain: { verifier: 'agree', requires: ['web'], brief: 'A piece of the core\'s own kind.', schema: verdict, agree: ['verdict'] },
  },
  data: {},
};
const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
const envelope: Envelope = { ...unsigned, sig: signObject(unsigned, owner) };
const P = problemHash(envelope);
const empty = reduce({ envelopes: [envelope], blobs: new Map(), receipts: [], now: t(0) });
const pieceOf = (name: string) => empty.pieces.find((v) => v.piece.name === name)!.piece.hash;

function line(k: Uint8Array, type: string, minute: number, body: Record<string, unknown>, piece: string, received: Record<string, unknown> = {}): Receipt {
  const u: Unsigned = { quilt: 1, type, problem: P, piece: piece as `sha256:${string}`, key: addr(k), ts: t(minute), body };
  return { event: signEvent(u, k), received: [{ by: 'https://tracker.example/', at: t(minute), custody: 'self', ...received }] };
}
function handIn(k: Uint8Array, piece: string, minute: number, ret: Record<string, unknown>, model: string, received: Record<string, unknown> = {}): Receipt[] {
  const nonce = newNonce();
  return [line(k, 'commit', minute, { h: commitHash(ret, nonce) }, piece), line(k, 'reveal', minute + 1, { return: ret, nonce, by: by(model) }, piece, received)];
}

describe('the core and the extension kinds', () => {
  it('holds every extension kind as unknown with nothing on it, locks what waits on one, and offers none of them', () => {
    const states = Object.fromEntries(empty.pieces.map((v) => [v.piece.name, v.state]));
    expect(states).toEqual({ vote: 'unknown', summary: 'unknown', told: 'unknown', after: 'locked', plain: 'open' });
    expect(next(empty, addr(A), { can: ['web', 'person'], model: 'human' }, t(0))?.piece.name).toBe('plain');
  });

  it('keeps them unknown however the pieces are worked: two people agreeing, candidates revealed, a record attested, inside and after the window', () => {
    const receipts = [
      ...handIn(A, pieceOf('vote'), 0, { verdict: 'supports', quote: 'I read it.' }, 'human', { seat: 'person' }),
      ...handIn(B, pieceOf('vote'), 2, { verdict: 'supports', quote: 'So did I.' }, 'human', { custody: 'hosted', seat: 'person' }),
      ...handIn(A, pieceOf('summary'), 4, { text: 'A torrent where the pieces are made.' }, 'anthropic/claude'),
      ...handIn(B, pieceOf('summary'), 6, { text: 'Problems as patterns of pieces.' }, 'openai/gpt'),
      line(C, 'rank', 8, { ranking: [] }, pieceOf('summary')),
      ...handIn(C, pieceOf('told'), 10, { who: 'a maintainer of a tracker', how: 'conversation' }, 'google/gemini'),
      ...handIn(A, pieceOf('plain'), 12, { verdict: 'supports', quote: 'q1' }, 'anthropic/claude'),
      ...handIn(B, pieceOf('plain'), 14, { verdict: 'supports', quote: 'q2' }, 'openai/gpt'),
    ];
    for (const now of [t(20), t(60 * 50)]) {
      const state = reduce({ envelopes: [envelope], blobs: new Map(), receipts, now });
      const states = Object.fromEntries(state.pieces.map((v) => [v.piece.name, v.state]));
      expect(states).toEqual({ vote: 'unknown', summary: 'unknown', told: 'unknown', after: 'locked', plain: now === t(20) ? 'accepted_provisional' : 'accepted' });
      for (const name of ['vote', 'summary', 'told']) expect(state.byHash.get(pieceOf(name))!.accepting).toBeNull();
      // The reveals themselves are valid and folded; only the verifier is unknown. The rank is an event of no core type, passed over.
      expect(state.byHash.get(pieceOf('vote'))!.reveals).toHaveLength(2);
      expect(state.byHash.get(pieceOf('summary'))!.reveals).toHaveLength(2);
      expect(state.byHash.get(pieceOf('told'))!.reveals).toHaveLength(1);
      expect(state.dropped).toEqual([]);
      expect(state.complete).toBe(false);
      expect(state.output).toBeNull();
      expect(next(state, addr(C), { can: ['web', 'person'], model: 'human' }, now)).toBeNull();
    }
  });

  it('is fixed by the conformance fixtures, which still hold the judge piece unknown and its dependent locked', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
    const names = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    expect(names).toHaveLength(23);
    const twenty = JSON.parse(readFileSync(join(dir, '20-verifies-first-and-inputs-rendered.json'), 'utf8')) as { expect: { states: Record<string, string> } };
    expect(twenty.expect.states.summary).toBe('unknown');
    expect(twenty.expect.states.after).toBe('locked');
    const first = JSON.parse(readFileSync(join(dir, '01-open.json'), 'utf8')) as { envelopes: { problem: { pieces: Record<string, { verifier: string }> } }[] };
    expect(first.envelopes[0]!.problem.pieces.summary!.verifier).toBe('judge:5');
  });
});
