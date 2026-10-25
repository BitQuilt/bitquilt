import { describe, expect, it } from 'vitest';
import { type Envelope, problemHash } from '../src/envelope.js';
import { type Event, type Receipt, type Unsigned, commitHash, newNonce, signEvent } from '../src/events.js';
import { type Hash, hashBytes } from '../src/hash.js';
import { type Address, addressOf, signObject } from '../src/keys.js';
import { reduce } from '../src/reduce.js';

const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const owner = key(9);
const A = key(1), B = key(2), C = key(3), D = key(4), E = key(5), F = key(6), G = key(7), H = key(8), B1 = key(10), A2 = key(11), Z = key(12);
const addr = (k: Uint8Array): Address => addressOf(k);
const T0 = Date.parse('2026-10-24T18:00:00Z');
const t = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const, 'shell' as const] });

const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }, { s: 'two' }, { s: 'three' }]));
const citesHash = hashBytes(cites);
const blobs = new Map([[citesHash, cites]]);
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts', 'unreachable'] }, quote: { type: 'string' as const, maxLength: 160 } } };

function envelope(extra: Partial<Envelope['problem']> = {}): Envelope {
  const problem: Envelope['problem'] = {
    title: 'A report', done_when: 'Every citation has a verdict.', owner: addr(owner), slug: 'report', prev: null, from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 100, patch_max: 10000 },
    pieces: {
      'cite/*': { count: 3, verifier: 'agree', requires: ['web'], brief: 'Citation {n}: {cite.s}', data: { cite: 'cites.json' }, schema, agree: ['verdict'] },
      lint: { verifier: 'check', requires: ['shell'], brief: 'Run the lint.', workspace: { repo: 'https://example.org/r', base: 'abc' }, check: { file: 'lint.sh' } },
      summary: { verifier: 'judge:5', inputs: ['cite/*'], candidates: 3, brief: 'Summarise.', schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 100 } } } },
      after: { verifier: 'agree', inputs: ['summary'], brief: 'After.', schema },
    },
    data: { 'cites.json': citesHash },
    ...extra,
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

const v1 = envelope();
const P = problemHash(v1);
const pieceHash = (env: Envelope, name: string): Hash => {
  const s = reduce({ envelopes: [env], blobs, receipts: [], now: t(0) });
  return s.pieces.find((p) => p.piece.name === name)!.piece.hash;
};
const cite1 = pieceHash(v1, 'cite/1'), cite2 = pieceHash(v1, 'cite/2'), cite3 = pieceHash(v1, 'cite/3'), lint = pieceHash(v1, 'lint');

function ev(k: Uint8Array, type: string, at: string, body: Record<string, unknown>, piece?: Hash, problem: Hash | undefined = piece ? P : undefined, extra: Partial<Unsigned> = {}): Receipt {
  const unsigned: Unsigned = { quilt: 1, type, key: addr(k), ts: at, body, ...extra };
  if (problem) unsigned.problem = problem;
  if (piece) unsigned.piece = piece;
  return { event: signEvent(unsigned, k), received: [{ by: 'https://t.example/', at }] };
}
function handIn(k: Uint8Array, piece: Hash, at: string, ret: Record<string, unknown>, model: string): Receipt[] {
  const nonce = newNonce();
  return [ev(k, 'commit', at, { h: commitHash(ret, nonce) }, piece), ev(k, 'reveal', t(Date.parse(at) / 60_000 - T0 / 60_000 + 1), { return: ret, nonce, by: by(model) }, piece)];
}
const states = (receipts: Receipt[], now: string, envelopes: Envelope[] = [v1]) => {
  const s = reduce({ envelopes, blobs, receipts, now });
  return { s, of: (name: string) => s.pieces.find((p) => p.piece.name === name)!.state };
};

describe('the reducer', () => {
  it('moves a piece through its states as sets of events grow, and accepts after the window', () => {
    const claim = ev(A, 'claim', t(0), { by: by('anthropic/claude') }, cite1);
    expect(states([], t(1)).of('cite/1')).toBe('open');
    expect(states([claim], t(1)).of('cite/1')).toBe('in_flight');
    expect(states([claim], t(130)).of('cite/1')).toBe('open');
    const a = handIn(A, cite1, t(2), { verdict: 'supports', quote: 'first quote' }, 'anthropic/claude');
    expect(states([claim, a[0]!], t(3)).of('cite/1')).toBe('sealed');
    expect(states([claim, ...a], t(4)).of('cite/1')).toBe('needs_verify');
    const b = handIn(B, cite1, t(5), { verdict: 'supports', quote: 'a different quote' }, 'openai/gpt');
    const { s, of } = states([claim, ...a, ...b], t(7));
    expect(of('cite/1')).toBe('accepted_provisional');
    expect(s.byHash.get(cite1)!.accepting?.kind).toBe('agree');
    expect(states([claim, ...a, ...b], t(7 + 49 * 60)).of('cite/1')).toBe('accepted');
    expect(s.dropped).toEqual([]);
  });
  it('does not accept a same-vendor pair, marks a dispute, and lets a third from another vendor settle it', () => {
    const a = handIn(A, cite2, t(0), { verdict: 'supports', quote: 'q1' }, 'anthropic/claude');
    const c = handIn(C, cite2, t(2), { verdict: 'supports', quote: 'q2' }, 'anthropic/other');
    expect(states([...a, ...c], t(5)).of('cite/2')).toBe('needs_verify');
    const d = handIn(D, cite2, t(4), { verdict: 'contradicts', quote: 'q3' }, 'openai/gpt');
    expect(states([...a, ...c, ...d], t(7)).of('cite/2')).toBe('disputed');
    const e = handIn(E, cite2, t(6), { verdict: 'supports', quote: 'q4' }, 'google/gemini');
    const { s, of } = states([...a, ...c, ...d, ...e], t(9));
    expect(of('cite/2')).toBe('accepted_provisional');
    const set = s.byHash.get(cite2)!.accepting!;
    expect(set.kind === 'agree' && set.reveals.map((r) => r.root)).toEqual([addr(A), addr(E)]);
  });
  it('treats a delegate as its root, and drops a delegate signing outside its scope', () => {
    const delegate = ev(B, 'delegate', t(0), { to: addr(B1), scope: ['claim', 'commit', 'reveal'], expires: t(60 * 24 * 30) });
    const one = handIn(B1, cite3, t(1), { verdict: 'supports', quote: 'q1' }, 'anthropic/claude');
    const two = handIn(B, cite3, t(3), { verdict: 'supports', quote: 'q2' }, 'openai/gpt');
    const decline = ev(B1, 'decline', t(5), { reason: 'cannot' }, cite3);
    const { s, of } = states([delegate, ...one, ...two, decline], t(7));
    expect(of('cite3'.replace('cite3', 'cite/3'))).toBe('needs_verify');
    expect(s.dropped.map((d) => d.why)).toContain('the delegation does not cover this event');
    const stranger = handIn(C, cite3, t(6), { verdict: 'supports', quote: 'q3' }, 'openai/gpt');
    expect(states([delegate, ...one, ...two, ...stranger], t(9)).of('cite/3')).toBe('accepted_provisional');
  });
  it('accepts a check on a revealed patch with two runs by roots unrelated to each other and to the author', () => {
    const patch = handIn(F, lint, t(0), { patch: '' }, 'anthropic/claude');
    const digest = states(patch, t(2)).s.byHash.get(lint)!.reveals[0]!.digest;
    const own = ev(F, 'run', t(2), { digest, exit: 0, host: 'darwin', by: by('anthropic/claude') }, lint);
    const g = ev(G, 'run', t(3), { digest, exit: 0, host: 'linux', by: by('human') }, lint);
    const wrong = ev(H, 'run', t(4), { digest: hashBytes(new Uint8Array([1])), exit: 0, host: 'linux', by: by('human') }, lint);
    const h = ev(H, 'run', t(5), { digest, exit: 0, host: 'linux', by: by('openai/gpt') }, lint);
    let r = states([...patch, own, g, wrong], t(6));
    expect(r.of('lint')).toBe('needs_verify');
    expect(r.s.dropped.map((d) => d.why)).toEqual(expect.arrayContaining(["a run by the patch's author", 'the digest is no revealed return of the piece']));
    r = states([...patch, own, g, wrong, h], t(6));
    expect(r.of('lint')).toBe('accepted_provisional');
    expect(r.s.byHash.get(lint)!.accepting?.kind).toBe('check');
  });
  it('drops a rotate whose second signature is not the new root\'s, and records a good one', () => {
    const forged: Unsigned = { quilt: 1, type: 'rotate', key: addr(A), ts: t(0), body: { to: addr(A2) } };
    const bad = { event: signEvent({ ...forged, sig_to: signObject(forged, Z) }, A), received: [{ by: 'https://t.example/', at: t(0) }] };
    const good = { event: signEvent({ ...forged, sig_to: signObject(forged, A2) }, A), received: [{ by: 'https://t.example/', at: t(1) }] };
    let s = reduce({ envelopes: [v1], blobs, receipts: [bad], now: t(2) });
    expect(s.rotations.size).toBe(0);
    expect(s.dropped[0]!.why).toBe('sig_to does not recover to the new root');
    s = reduce({ envelopes: [v1], blobs, receipts: [good], now: t(2) });
    expect(s.rotations.get(addr(A))).toBe(addr(A2));
  });
  it('drops a reveal without its commit, a reveal that fails the schema, and a commit abandoned before its reveal', () => {
    const nonce = newNonce();
    const ret = { verdict: 'supports', quote: 'q' };
    const orphan = ev(A, 'reveal', t(0), { return: ret, nonce, by: by('x/y') }, cite1);
    expect(states([orphan], t(1)).s.dropped[0]!.why).toBe('no commit by this key with this hash');
    const commit = ev(A, 'commit', t(0), { h: commitHash({ verdict: 'maybe', quote: 'q' }, nonce) }, cite1);
    const badReveal = ev(A, 'reveal', t(1), { return: { verdict: 'maybe', quote: 'q' }, nonce, by: by('x/y') }, cite1);
    expect(states([commit, badReveal], t(2)).s.dropped[0]!.why).toMatch(/return.verdict: one of/);
    const late = ev(A, 'commit', t(0), { h: commitHash(ret, nonce) }, cite1);
    const lateReveal = ev(A, 'reveal', t(60 * 5), { return: ret, nonce, by: by('x/y') }, cite1);
    expect(states([late, lateReveal], t(60 * 6)).s.dropped[0]!.why).toBe('the commit was abandoned before the reveal');
    expect(states([late], t(60 * 5)).of('cite/1')).toBe('open');
  });
  it('treats an unknown verifier as unknown, keeps its dependents locked, and computes no output', () => {
    const { s, of } = states([], t(0));
    expect(of('summary')).toBe('locked');
    expect(of('after')).toBe('locked');
    expect(s.output).toBeNull();
    expect(s.byHash.get(cite1)!.dependents).toBe(1);
    const odd = envelope({ slug: 'odd', pieces: { judge: { verifier: 'judge:3', candidates: 3, brief: 'Judge.', schema }, dependent: { verifier: 'agree', inputs: ['judge'], brief: 'After.', schema } } });
    const r = reduce({ envelopes: [odd], blobs, receipts: [], now: t(0) });
    expect(r.pieces.map((p) => p.state)).toEqual(['unknown', 'locked']);
    expect(r.output).toBeNull();
  });
  it('carries a return across versions by piece hash, and assembles an output when every piece is done', () => {
    const a = handIn(A, cite1, t(0), { verdict: 'supports', quote: 'q1' }, 'anthropic/claude');
    const b = handIn(B, cite1, t(2), { verdict: 'supports', quote: 'q2' }, 'openai/gpt');
    const v2 = envelope({ title: 'A report, week two', prev: P });
    expect(pieceHash(v2, 'cite/1')).toBe(cite1);
    const { of } = states([...a, ...b], t(5), [v2, v1]);
    expect(of('cite/1')).toBe('accepted_provisional');
    expect(states([...a, ...b], t(5), [v2]).of('cite/1')).toBe('open');

    const small = envelope({ slug: 'small', pieces: { 'cite/*': { count: 1, verifier: 'agree', brief: 'Citation {n}', schema, agree: ['verdict'] } } });
    const sp = problemHash(small);
    const h1 = pieceHash(small, 'cite/1');
    const mk = (k: Uint8Array, at: string, ret: Record<string, unknown>, model: string) => {
      const nonce = newNonce();
      const later = new Date(Date.parse(at) + 60_000).toISOString();
      return [ev(k, 'commit', at, { h: commitHash(ret, nonce) }, h1, sp), ev(k, 'reveal', later, { return: ret, nonce, by: by(model) }, h1, sp)];
    };
    const done = reduce({ envelopes: [small], blobs, receipts: [...mk(A, t(0), { verdict: 'unreachable', quote: 'gone' }, 'a/x'), ...mk(B, t(1), { verdict: 'unreachable', quote: 'also gone' }, 'b/y')], now: t(60 * 50) });
    expect(done.pieces[0]!.state).toBe('unreachable');
    expect(done.complete).toBe(true);
    expect(done.output).not.toBeNull();
    const doc = done.output!.document as { pieces: { agreed: Record<string, unknown>; evidence: { signer: string; quote: string }[] }[] };
    expect(doc.pieces[0]!.agreed).toEqual({ verdict: 'unreachable' });
    expect(doc.pieces[0]!.evidence.map((e) => e.quote)).toEqual(['gone', 'also gone']);
  });
});
