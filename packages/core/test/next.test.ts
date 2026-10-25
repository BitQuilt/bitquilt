import { describe, expect, it } from 'vitest';
import { type Envelope, problemHash } from '../src/envelope.js';
import { type Receipt, type Unsigned, commitHash, newNonce, signEvent } from '../src/events.js';
import { type Hash, hashBytes } from '../src/hash.js';
import { type Address, addressOf, signObject } from '../src/keys.js';
import { next, tieBreak } from '../src/next.js';
import { reduce } from '../src/reduce.js';

const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const owner = key(9), A = key(1), B = key(2), C = key(3);
const addr = (k: Uint8Array): Address => addressOf(k);
const T0 = Date.parse('2026-10-24T18:00:00Z');
const t = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const, 'shell' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } };
const blobs = new Map<Hash, Uint8Array>();

function envelope(pieces: Envelope['problem']['pieces'], endgame_at = 1): Envelope {
  const problem: Envelope['problem'] = {
    title: 'T', done_when: 'D', owner: addr(owner), slug: 'p', prev: null, from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at, budget: 100, patch_max: 1000 }, pieces, data: {},
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}
const three = envelope({
  'cite/*': { count: 3, verifier: 'agree', requires: ['web'], brief: 'Citation {n}', schema, agree: ['verdict'] },
  lint: { verifier: 'check', requires: ['shell'], brief: 'Lint.', workspace: { repo: 'r', base: 'b' }, check: { file: 'f' } },
  summary: { verifier: 'agree', inputs: ['cite/*'], brief: 'From: {cite/*}', schema },
});
const P = problemHash(three);
const st = (receipts: Receipt[], now: string, env = three) => reduce({ envelopes: [env], blobs, receipts, now });
const hashOf = (name: string, env = three) => st([], t(0), env).pieces.find((p) => p.piece.name === name)!.piece.hash;
function ev(k: Uint8Array, type: string, at: string, body: Record<string, unknown>, piece?: Hash, problem = P): Receipt {
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: at, body };
  if (piece) { u.piece = piece; u.problem = problem; }
  return { event: signEvent(u, k), received: [{ by: 'https://t.example/', at }] };
}
function handIn(k: Uint8Array, piece: Hash, at: string, ret: Record<string, unknown>, model: string, problem = P): Receipt[] {
  const nonce = newNonce();
  const later = new Date(Date.parse(at) + 60_000).toISOString();
  return [ev(k, 'commit', at, { h: commitHash(ret, nonce) }, piece, problem), ev(k, 'reveal', later, { return: ret, nonce, by: by(model) }, piece, problem)];
}
const web = { can: ['web' as const], model: 'anthropic/claude' };

describe('next', () => {
  it('hands two keys at one instant the pieces their tie-break hashes choose, and one key the same piece within the hour', () => {
    const s = st([], t(0));
    const pa = next(s, addr(A), web, t(0))!;
    const pb = next(s, addr(B), web, t(0))!;
    const cites = s.pieces.filter((v) => v.piece.family === 'cite').map((v) => v.piece);
    const expectFor = (k: Address) => [...cites].sort((x, y) => (tieBreak(x, k, t(0)) < tieBreak(y, k, t(0)) ? -1 : 1))[0]!.hash;
    expect(pa.piece.hash).toBe(expectFor(addr(A)));
    expect(pb.piece.hash).toBe(expectFor(addr(B)));
    expect(next(s, addr(A), web, t(30))!.piece.hash).toBe(pa.piece.hash);
    expect(pa.lease_h).toBe(2);
    expect(pa.agree).toEqual(['verdict']);
  });
  it('respects what a client can do and what a key has already touched', () => {
    const s = st([], t(0));
    expect(next(s, addr(A), { can: ['shell'], model: 'x/y' }, t(0))!.piece.name).toBe('lint');
    expect(next(s, addr(A), { can: ['files'], model: 'x/y' }, t(0))).toBeNull();
    const c1 = hashOf('cite/1'), c2 = hashOf('cite/2'), c3 = hashOf('cite/3');
    const mine = [...handIn(A, c1, t(0), { verdict: 'supports' }, 'a/x'), ...handIn(A, c2, t(0), { verdict: 'supports' }, 'a/x'), ev(A, 'decline', t(0), { reason: 'cannot' }, c3)];
    expect(next(st(mine, t(1)), addr(A), web, t(1))).toBeNull();
    expect(next(st(mine, t(1)), addr(owner), web, t(1))).toBeNull();
    expect(next(st(mine, t(1)), addr(B), web, t(1))).not.toBeNull();
  });
  it('prefers the rarest piece, and a claim counts as an intent, not a lock', () => {
    const c1 = hashOf('cite/1'), c2 = hashOf('cite/2'), c3 = hashOf('cite/3');
    const claims = [ev(A, 'claim', t(0), { by: by('a/x') }, c1), ev(A, 'claim', t(0), { by: by('a/x') }, c2)];
    const s = st(claims, t(1));
    expect(next(s, addr(B), web, t(1))!.piece.hash).toBe(c3);
    const all = [...claims, ev(A, 'claim', t(0), { by: by('a/x') }, c3)];
    expect(next(st(all, t(1)), addr(B), web, t(1))!.state).toBe('in_flight');
  });
  it('offers a second production first when verifies outnumber the open, from another vendor', () => {
    const c1 = hashOf('cite/1'), c2 = hashOf('cite/2'), c3 = hashOf('cite/3');
    const three = [...handIn(A, c1, t(0), { verdict: 'supports' }, 'anthropic/claude'), ...handIn(B, c2, t(0), { verdict: 'supports' }, 'openai/gpt'), ...handIn(B, c3, t(0), { verdict: 'supports' }, 'openai/gpt')];
    const s = st(three, t(2));
    expect(s.pieces.filter((v) => v.state === 'needs_verify')).toHaveLength(3);
    const pick = next(s, addr(C), { can: ['web'], model: 'anthropic/other' }, t(2))!;
    expect(pick.state).toBe('needs_verify');
    expect([c2, c3]).toContain(pick.piece.hash);
    const openai = next(s, addr(C), { can: ['web'], model: 'openai/other' }, t(2))!;
    expect(openai.piece.hash).toBe(c1);
  });
  it('in endgame, live claims count for nothing', () => {
    const env = envelope({ 'cite/*': { count: 2, verifier: 'agree', brief: 'C {n}', schema } }, 5);
    const p = problemHash(env);
    const c1 = hashOf('cite/1', env), c2 = hashOf('cite/2', env);
    const claim = ev(A, 'claim', t(0), { by: by('a/x') }, c1, p);
    const s = st([claim], t(1), env);
    const tieWins = tieBreak(s.pieces[0]!.piece, addr(B), t(1)) < tieBreak(s.pieces[1]!.piece, addr(B), t(1)) ? c1 : c2;
    expect(next(s, addr(B), web, t(1))!.piece.hash).toBe(tieWins);
    const notEndgame = envelope({ 'cite/*': { count: 2, verifier: 'agree', brief: 'C {n}', schema } }, 1);
    const p2 = problemHash(notEndgame);
    const s2 = st([ev(A, 'claim', t(0), { by: by('a/x') }, hashOf('cite/1', notEndgame), p2)], t(1), notEndgame);
    expect(next(s2, addr(B), web, t(1))!.piece.hash).toBe(hashOf('cite/2', notEndgame));
  });
  it('fills input slots with the accepted returns as quoted text once the inputs are accepted', () => {
    const c1 = hashOf('cite/1'), c2 = hashOf('cite/2'), c3 = hashOf('cite/3');
    const receipts = [c1, c2, c3].flatMap((c) => [...handIn(A, c, t(0), { verdict: 'supports' }, 'a/x'), ...handIn(B, c, t(1), { verdict: 'supports' }, 'b/y')]);
    const s = st(receipts, t(60 * 49));
    expect(s.pieces.filter((v) => v.piece.family === 'cite').every((v) => v.state === 'accepted')).toBe(true);
    const pick = next(s, addr(C), { can: [], model: 'c/z' }, t(60 * 49))!;
    expect(pick.piece.name).toBe('summary');
    expect(pick.brief).toContain(`cite/1, by ${addr(A)}: {"verdict":"supports"}`);
    expect(pick.brief.split('\n')).toHaveLength(6);
  });
});
