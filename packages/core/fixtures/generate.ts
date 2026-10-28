/**
 * Writes the conformance fixtures (CORE.md section 9) with fixed keys, fixed times and nonces derived from labels, so
 * the files are the same on every run. Each fixture's expectations are asserted here against what the core says before
 * they are written, so the reference implementation cannot quietly lock in a wrong answer. The twenty-four of version 1
 * go in this folder; the fixtures for the clarifications of section 12, written on 27 October 2026 when the Python was
 * aligned to the reference, go in `clarifications/`, and a client conforms to version 1 without them.
 *
 *   tsx fixtures/generate.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Envelope, problemHash } from '../src/envelope.js';
import { type Receipt, type Unsigned, commitHash, signEvent } from '../src/events.js';
import { type Hash, hashBytes, hashText } from '../src/hash.js';
import { type Address, addressOf, signObject } from '../src/keys.js';
import { type Client, next, tieBreak } from '../src/next.js';
import { reduce } from '../src/reduce.js';
import type { Fixture } from '../src/conformance.js';

const here = dirname(fileURLToPath(import.meta.url));
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const owner = key(9), A = key(1), B = key(2), C = key(3), D = key(4), E = key(5), F = key(6), G = key(7), H = key(8), B1 = key(10), A2 = key(11), Z = key(12);
const addr = (k: Uint8Array): Address => addressOf(k);
const T0 = Date.parse('2026-10-24T18:00:00Z');
const t = (minutes: number): string => new Date(T0 + minutes * 60_000).toISOString();
const by = (model: string) => ({ model, client: 'fixture/1', can: ['web' as const, 'shell' as const] });
const nonceOf = (label: string): string => hashText(label).slice('sha256:'.length, 'sha256:'.length + 32);

const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }, { s: 'two' }, { s: 'three' }]));
const citesHash = hashBytes(cites);
const blobs = new Map([[citesHash, cites]]);
const blobsOut = { [citesHash]: Buffer.from(cites).toString('base64') };
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts', 'unreachable'] }, quote: { type: 'string' as const, maxLength: 160 } } };

function envelope(extra: Partial<Envelope['problem']> = {}, settings: Partial<Envelope['problem']['settings']> = {}): Envelope {
  const problem: Envelope['problem'] = {
    title: 'A report', done_when: 'Every citation has a verdict.', owner: addr(owner), slug: 'report', prev: null, from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 100, patch_max: 10000, ...settings },
    pieces: {
      'cite/*': { count: 3, verifier: 'agree', requires: ['web'], brief: 'Citation {n}: {cite.s}', data: { cite: 'cites.json' }, schema, agree: ['verdict'] },
      lint: { verifier: 'check', requires: ['shell'], brief: 'Run the lint.', workspace: { repo: 'https://example.org/r', base: 'abc' }, check: { file: 'lint.sh' } },
      bench: { verifier: 'score', requires: ['shell'], brief: 'Run the bench.', workspace: { repo: 'https://example.org/r', base: 'abc' }, check: { file: 'bench.sh', tolerance: 0.5, better: 'lower' } },
      summary: { verifier: 'judge:5', inputs: ['cite/*'], candidates: 3, brief: 'Summarise {cite/*}.', schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 100 } } } },
      after: { verifier: 'agree', inputs: ['summary'], brief: 'After.', schema },
    },
    data: { 'cites.json': citesHash },
    ...extra,
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: ['https://tracker.example/'], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

const v1 = envelope();
const P = problemHash(v1);
const pieceHash = (env: Envelope, name: string): Hash => reduce({ envelopes: [env], blobs, receipts: [], now: t(0) }).pieces.find((p) => p.piece.name === name)!.piece.hash;
const cite1 = pieceHash(v1, 'cite/1'), cite2 = pieceHash(v1, 'cite/2'), cite3 = pieceHash(v1, 'cite/3'), lint = pieceHash(v1, 'lint'), bench = pieceHash(v1, 'bench');

function ev(k: Uint8Array, type: string, at: string, body: Record<string, unknown>, piece?: Hash, problem: Hash | undefined = piece ? P : undefined, extra: Partial<Unsigned> = {}): Receipt {
  const unsigned: Unsigned = { quilt: 1, type, key: addr(k), ts: at, body, ...extra };
  if (problem) unsigned.problem = problem;
  if (piece) unsigned.piece = piece;
  return { event: signEvent(unsigned, k), received: [{ by: 'https://tracker.example/', at, custody: 'self' }] };
}
function handIn(k: Uint8Array, piece: Hash, minute: number, ret: Record<string, unknown>, model: string, label: string, problem = P): Receipt[] {
  const nonce = nonceOf(label);
  return [ev(k, 'commit', t(minute), { h: commitHash(ret, nonce) }, piece, problem), ev(k, 'reveal', t(minute + 1), { return: ret, nonce, by: by(model) }, piece, problem)];
}

const web: Client = { can: ['web'], model: 'anthropic/claude' };

interface Spec { name: string; description: string; envelopes?: Envelope[]; receipts: Receipt[]; now: string; states: Record<string, string>; dropped?: string[]; complete?: boolean; picks?: { key: Address; client: Client; piece: string | string[] | null }[] }

function build(spec: Spec): Fixture {
  const envelopes = spec.envelopes ?? [v1];
  const state = reduce({ envelopes, blobs, receipts: spec.receipts, now: spec.now });
  const states: Record<string, string> = {};
  for (const v of state.pieces) states[v.piece.name] = v.state;
  for (const [name, want] of Object.entries(spec.states)) if (states[name] !== want) throw new Error(`${spec.name}: ${name} is ${states[name]}, the core says ${want}`);
  const dropped = state.dropped.map((d) => d.why);
  const wantDropped = spec.dropped ?? [];
  if (JSON.stringify([...dropped].sort()) !== JSON.stringify([...wantDropped].sort())) throw new Error(`${spec.name}: dropped ${JSON.stringify(dropped)}, the core says ${JSON.stringify(wantDropped)}`);
  const complete = spec.complete ?? false;
  if (state.complete !== complete) throw new Error(`${spec.name}: complete is ${state.complete}`);
  const picks = (spec.picks ?? []).map((p) => {
    const now = spec.now;
    const got = next(state, p.key, p.client, now)?.piece.name ?? null;
    // A list names the candidates of equal availability and dependents; the core says the tie-break hash picks among them.
    const want = Array.isArray(p.piece)
      ? p.piece.map((n) => state.pieces.find((v) => v.piece.name === n)!.piece).sort((x, y) => (tieBreak(x, p.key, now) < tieBreak(y, p.key, now) ? -1 : 1))[0]!.name
      : p.piece;
    if (got !== want) throw new Error(`${spec.name}: next for ${p.key} is ${got}, the core says ${want}`);
    return { key: p.key, client: p.client, now, piece: want };
  });
  return { name: spec.name, description: spec.description, envelopes, blobs: blobsOut, receipts: spec.receipts, now: spec.now, expect: { states, dropped, complete, output: state.output?.hash ?? null, picks } };
}

const base = { lint: 'open', bench: 'open', summary: 'locked', after: 'locked' };
const fixtures: Spec[] = [];

const claim = ev(A, 'claim', t(0), { by: by('anthropic/claude') }, cite1);
const a1 = handIn(A, cite1, 2, { verdict: 'supports', quote: 'first quote' }, 'anthropic/claude', 'a1');
const b1 = handIn(B, cite1, 5, { verdict: 'supports', quote: 'a different quote' }, 'openai/gpt', 'b1');
fixtures.push({ name: '01-open', description: 'Nothing has happened: every piece without inputs is open, pieces behind an unknown verifier are locked.', receipts: [], now: t(0), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base }, picks: [{ key: addr(A), client: web, piece: ['cite/1', 'cite/2', 'cite/3'] }, { key: addr(B), client: web, piece: ['cite/1', 'cite/2', 'cite/3'] }, { key: addr(A), client: { can: ['shell'], model: 'x/y' }, piece: ['lint', 'bench'] }] });
fixtures.push({ name: '02-in-flight-and-lapsed', description: 'A claim makes a piece in flight for its lease and no longer; a claim is an intent, so the piece is still a candidate for another key.', receipts: [claim], now: t(1), states: { 'cite/1': 'in_flight', 'cite/2': 'open', 'cite/3': 'open', ...base }, picks: [{ key: addr(B), client: web, piece: ['cite/2', 'cite/3'] }, { key: addr(A), client: web, piece: ['cite/2', 'cite/3'] }] });
fixtures.push({ name: '02b-lapsed-claim', description: 'After its lease the claim is no longer live: the piece is open again and counts nothing toward availability.', receipts: [claim], now: t(130), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base }, picks: [{ key: addr(B), client: web, piece: ['cite/1', 'cite/2', 'cite/3'] }] });
fixtures.push({ name: '03-sealed-then-needs-verify', description: 'A commit seals the piece; its reveal makes it need a second production.', receipts: [claim, ...a1], now: t(4), states: { 'cite/1': 'needs_verify', 'cite/2': 'open', 'cite/3': 'open', ...base }, picks: [{ key: addr(A), client: web, piece: ['cite/2', 'cite/3'] }] });
fixtures.push({ name: '04-agreement-provisional-then-accepted', description: 'Two reveals from unrelated roots of different vendors agreeing on the agree fields accept the piece provisionally; after the window it is accepted.', receipts: [claim, ...a1, ...b1], now: t(7), states: { 'cite/1': 'accepted_provisional', 'cite/2': 'open', 'cite/3': 'open', ...base } });
fixtures.push({ name: '05-accepted-after-window', description: 'The same events seen after the window.', receipts: [claim, ...a1, ...b1], now: t(7 + 49 * 60), states: { 'cite/1': 'accepted', 'cite/2': 'open', 'cite/3': 'open', ...base } });

const c2a = handIn(A, cite2, 0, { verdict: 'supports', quote: 'q1' }, 'anthropic/claude', 'c2a');
const c2c = handIn(C, cite2, 2, { verdict: 'supports', quote: 'q2' }, 'anthropic/other', 'c2c');
const c2d = handIn(D, cite2, 4, { verdict: 'contradicts', quote: 'q3' }, 'openai/gpt', 'c2d');
const c2e = handIn(E, cite2, 6, { verdict: 'supports', quote: 'q4' }, 'google/gemini', 'c2e');
fixtures.push({ name: '06-same-vendor-pair', description: 'Two reveals that agree but share a vendor are not an accepting set.', receipts: [...c2a, ...c2c], now: t(5), states: { 'cite/1': 'open', 'cite/2': 'needs_verify', 'cite/3': 'open', ...base } });
fixtures.push({ name: '07-disputed', description: 'Two reveals from unrelated roots that differ on an agree field dispute the piece.', receipts: [...c2a, ...c2c, ...c2d], now: t(7), states: { 'cite/1': 'open', 'cite/2': 'disputed', 'cite/3': 'open', ...base }, picks: [{ key: addr(F), client: { can: ['web'], model: 'meta/llama' }, piece: ['cite/1', 'cite/3'] }] });
fixtures.push({ name: '08-third-settles', description: 'A third reveal, unrelated to every earlier revealer and of another vendor, completes a set with the one it agrees with.', receipts: [...c2a, ...c2c, ...c2d, ...c2e], now: t(9), states: { 'cite/1': 'open', 'cite/2': 'accepted_provisional', 'cite/3': 'open', ...base } });

const delegate = ev(B, 'delegate', t(0), { to: addr(B1), scope: ['claim', 'commit', 'reveal'], expires: t(60 * 24 * 30) });
const one = handIn(B1, cite3, 1, { verdict: 'supports', quote: 'q1' }, 'anthropic/claude', 'd1');
const two = handIn(B, cite3, 3, { verdict: 'supports', quote: 'q2' }, 'openai/gpt', 'd2');
const decline = ev(B1, 'decline', t(5), { reason: 'cannot' }, cite3);
fixtures.push({ name: '09-delegate', description: 'A delegate counts as its root, so a root and its delegate are not two; a delegate signing outside its scope is dropped.', receipts: [delegate, ...one, ...two, decline], now: t(7), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'needs_verify', ...base }, dropped: ['the delegation does not cover this event'] });
const bad = ev(C, 'delegate', t(0), { to: addr(A), scope: ['claim'], expires: t(60) });
fixtures.push({ name: '10-delegate-to-a-key-with-history', description: 'A delegate to a key that has a prior event is dropped.', receipts: [claim, bad], now: t(1), states: { 'cite/1': 'in_flight', 'cite/2': 'open', 'cite/3': 'open', ...base }, dropped: ['the delegate has a prior event'] });

const rotateBody: Unsigned = { quilt: 1, type: 'rotate', key: addr(A), ts: t(0), body: { to: addr(A2) } };
const forged: Receipt = { event: signEvent({ ...rotateBody, sig_to: signObject(rotateBody, Z) }, A), received: [{ by: 'https://tracker.example/', at: t(0) }] };
const good: Receipt = { event: signEvent({ ...rotateBody, sig_to: signObject(rotateBody, A2) }, A), received: [{ by: 'https://tracker.example/', at: t(1) }] };
fixtures.push({ name: '11-rotate-forgery', description: 'A rotate whose second signature does not recover to the new root is dropped; one that does is kept.', receipts: [forged, good], now: t(2), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base }, dropped: ['sig_to does not recover to the new root'] });

const nonce = nonceOf('abandon');
const ret = { verdict: 'supports', quote: 'q' };
const lateCommit = ev(A, 'commit', t(0), { h: commitHash(ret, nonce) }, cite1);
const lateReveal = ev(A, 'reveal', t(60 * 5), { return: ret, nonce, by: by('x/y') }, cite1);
fixtures.push({ name: '12-abandoned-commit', description: 'A commit not revealed within its lease and one more is abandoned; the piece is open again and a late reveal is dropped.', receipts: [lateCommit, lateReveal], now: t(60 * 6), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base }, dropped: ['the commit was abandoned before the reveal'] });
const orphan = ev(A, 'reveal', t(0), { return: ret, nonce, by: by('x/y') }, cite1);
const badCommit = ev(B, 'commit', t(0), { h: commitHash({ verdict: 'maybe', quote: 'q' }, nonce) }, cite1);
const badReveal = ev(B, 'reveal', t(1), { return: { verdict: 'maybe', quote: 'q' }, nonce, by: by('x/y') }, cite1);
fixtures.push({ name: '13-reveal-drops', description: 'A reveal without its commit, and a reveal whose return fails the schema, are dropped.', receipts: [orphan, badCommit, badReveal], now: t(2), states: { 'cite/1': 'sealed', 'cite/2': 'open', 'cite/3': 'open', ...base }, dropped: ['no commit by this key with this hash', 'return.verdict: one of supports, contradicts, unreachable'] });

const patch = handIn(F, lint, 0, { patch: '' }, 'anthropic/claude', 'patch');
const digest = reduce({ envelopes: [v1], blobs, receipts: patch, now: t(2) }).byHash.get(lint)!.reveals[0]!.digest;
const own = ev(F, 'run', t(2), { digest, exit: 0, host: 'darwin', by: by('anthropic/claude') }, lint);
const g = ev(G, 'run', t(3), { digest, exit: 0, host: 'linux', by: by('human') }, lint);
const h = ev(H, 'run', t(5), { digest, exit: 0, host: 'linux', by: by('openai/gpt') }, lint);
fixtures.push({ name: '14-check-author-run-does-not-count', description: 'A run by the patch\'s author is dropped; one other run leaves the check needing a second.', receipts: [...patch, own, g], now: t(6), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', lint: 'needs_verify', bench: 'open', summary: 'locked', after: 'locked' }, dropped: ["a run by the patch's author"] });
fixtures.push({ name: '15-check-accepted', description: 'Two runs with exit 0 by roots unrelated to each other and to the author accept the check.', receipts: [...patch, own, g, h], now: t(6), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', lint: 'accepted_provisional', bench: 'open', summary: 'locked', after: 'locked' }, dropped: ["a run by the patch's author"] });

const bpatch = handIn(F, bench, 0, { patch: '' }, 'anthropic/claude', 'bpatch');
const bdigest = reduce({ envelopes: [v1], blobs, receipts: bpatch, now: t(2) }).byHash.get(bench)!.reveals[0]!.digest;
const s1 = ev(G, 'run', t(2), { digest: bdigest, exit: 0, score: 10.0, host: 'linux', by: by('human') }, bench);
const s2far = ev(H, 'run', t(3), { digest: bdigest, exit: 0, score: 11.0, host: 'linux', by: by('openai/gpt') }, bench);
const s3near = ev(C, 'run', t(4), { digest: bdigest, exit: 0, score: 10.4, host: 'linux', by: by('openai/gpt') }, bench);
fixtures.push({ name: '16-score-outside-tolerance', description: 'Two scores farther apart than the tolerance do not agree.', receipts: [...bpatch, s1, s2far], now: t(5), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', lint: 'open', bench: 'needs_verify', summary: 'locked', after: 'locked' } });
fixtures.push({ name: '17-score-within-tolerance', description: 'Two scores within the tolerance accept the piece.', receipts: [...bpatch, s1, s2far, s3near], now: t(5), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', lint: 'open', bench: 'accepted_provisional', summary: 'locked', after: 'locked' } });

const v2 = envelope({ title: 'A report, week two', prev: P });
fixtures.push({ name: '18-version-carries-over', description: 'A new version along prev keeps the returns made against pieces it still contains.', envelopes: [v2, v1], receipts: [claim, ...a1, ...b1], now: t(7), states: { 'cite/1': 'accepted_provisional', 'cite/2': 'open', 'cite/3': 'open', ...base } });
fixtures.push({ name: '19-version-without-ancestor', description: 'Without the ancestor envelope, events naming it are outside the chain.', envelopes: [v2], receipts: [claim, ...a1, ...b1], now: t(7), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base }, dropped: ['names a problem outside the chain', 'names a problem outside the chain', 'names a problem outside the chain', 'names a problem outside the chain', 'names a problem outside the chain'] });

const allCites = [cite1, cite2, cite3].flatMap((c, i) => [...handIn(A, c, i * 10, { verdict: 'supports', quote: 'qa' }, 'anthropic/claude', `all-a-${i}`), ...handIn(B, c, i * 10 + 2, { verdict: 'supports', quote: 'qb' }, 'openai/gpt', `all-b-${i}`)]);
fixtures.push({ name: '20-verifies-first-and-inputs-rendered', description: 'With every citation accepted, the judge piece is unknown and its dependent locked; a client is offered the only open piece it can do.', receipts: allCites, now: t(60 * 50), states: { 'cite/1': 'accepted', 'cite/2': 'accepted', 'cite/3': 'accepted', lint: 'open', bench: 'open', summary: 'unknown', after: 'locked' }, picks: [{ key: addr(C), client: web, piece: null }, { key: addr(C), client: { can: ['shell'], model: 'x/y' }, piece: ['lint', 'bench'] }] });

const small = envelope({ slug: 'small', pieces: { 'cite/*': { count: 2, verifier: 'agree', brief: 'Citation {n}', schema, agree: ['verdict'] } } }, { endgame_at: 5 });
const SP = problemHash(small);
const sc1 = pieceHash(small, 'cite/1'), sc2 = pieceHash(small, 'cite/2');
const sclaim = ev(A, 'claim', t(0), { by: by('a/x') }, sc1, SP);
fixtures.push({ name: '21-endgame', description: 'When the pieces not yet done are few, live claims count for nothing in availability, so the tie-break decides.', envelopes: [small], receipts: [sclaim], now: t(1), states: { 'cite/1': 'in_flight', 'cite/2': 'open' }, picks: [{ key: addr(B), client: web, piece: ['cite/1', 'cite/2'] }] });
// Three citations: two revealed once by A, one untouched. Verifies outnumber the open, so a key of another vendor is handed one of the two
// needing a second production and not the open piece rarest-first would give; a key of A's vendor is handed one of them too, there being none fresh.
const three = envelope({ slug: 'three', pieces: { 'cite/*': { count: 3, verifier: 'agree', brief: 'Citation {n}', schema, agree: ['verdict'] } } }, { endgame_at: 1 });
const TP = problemHash(three);
const tc1 = pieceHash(three, 'cite/1'), tc2 = pieceHash(three, 'cite/2');
const tfirst = [...handIn(A, tc1, 0, { verdict: 'supports', quote: 'one' }, 'anthropic/claude', 't1a', TP), ...handIn(A, tc2, 2, { verdict: 'supports', quote: 'two' }, 'anthropic/claude', 't2a', TP)];
fixtures.push({ name: '23-verifies-first', description: 'Two of three citations have one reveal each and the third none: the pieces needing a second production outnumber the open, so next hands a key of another vendor one of them rather than the open piece, and a key of the same vendor one of them too.', envelopes: [three], receipts: tfirst, now: t(5), states: { 'cite/1': 'needs_verify', 'cite/2': 'needs_verify', 'cite/3': 'open' }, picks: [{ key: addr(B), client: { can: ['web'], model: 'openai/gpt' }, piece: ['cite/1', 'cite/2'] }, { key: addr(C), client: { can: ['web'], model: 'anthropic/claude' }, piece: ['cite/1', 'cite/2'] }] });

const sdone = [...handIn(A, sc1, 0, { verdict: 'unreachable', quote: 'gone' }, 'a/x', 's1a', SP), ...handIn(B, sc1, 2, { verdict: 'unreachable', quote: 'also gone' }, 'b/y', 's1b', SP), ...handIn(A, sc2, 4, { verdict: 'supports', quote: 'x' }, 'a/x', 's2a', SP), ...handIn(B, sc2, 6, { verdict: 'supports', quote: 'y' }, 'b/y', 's2b', SP)];
fixtures.push({ name: '22-complete-with-output', description: 'Every piece accepted or unreachable: the output exists and has a hash.', envelopes: [small], receipts: sdone, now: t(60 * 50), states: { 'cite/1': 'unreachable', 'cite/2': 'accepted' }, complete: true, picks: [{ key: addr(C), client: web, piece: null }] });

// The clarifications of section 12 (CORE.md), one fixture each, each pinning a sentence the reference and the Python
// read apart until 27 October 2026. None is part of version 1's conformance; a second implementation that reproduces
// them reads every clarified sentence as the reference does.
const clarifications: Spec[] = [];

const ownerSays = handIn(owner, cite1, 0, { verdict: 'contradicts', quote: 'the owner read it otherwise' }, 'anthropic/claude', 'owner-c1');
clarifications.push({ name: 'c01-the-owner-reveal-disputes-but-counts-in-no-set', description: 'The owner is counted in no accepting set and is not otherwise related to anyone: a reveal of the owner\'s that differs from a stranger\'s disputes the piece, and completes nothing.', receipts: [...ownerSays, ...a1], now: t(5), states: { 'cite/1': 'disputed', 'cite/2': 'open', 'cite/3': 'open', ...base }, picks: [{ key: addr(B), client: { can: ['web'], model: 'openai/gpt' }, piece: ['cite/2', 'cite/3'] }] });

const sameVendorB = handIn(B, cite1, 2, { verdict: 'supports', quote: 'b agrees' }, 'anthropic/claude', 'same-b');
const viaDelegate = handIn(B1, cite1, 4, { verdict: 'supports', quote: 'b again, as its delegate'}, 'openai/gpt', 'same-b1');
clarifications.push({ name: 'c02-a-reveal-related-to-an-earlier-reveal-does-not-count', description: 'A reveal counts only when its root is unrelated to the root of every earlier reveal on the piece: a root that has revealed cannot complete a set through its delegate under another vendor, disputed or not.', receipts: [delegate, ...a1, ...sameVendorB, ...viaDelegate], now: t(7), states: { 'cite/1': 'needs_verify', 'cite/2': 'open', 'cite/3': 'open', ...base } });

const declinedUnderV1 = ev(A, 'decline', t(0), { reason: 'cannot' }, cite1);
clarifications.push({ name: 'c03-a-decline-under-the-ancestor-counts', description: 'next counts events on the piece in this chain: a decline made under the ancestor version keeps the piece from the key under the new one.', envelopes: [v2, v1], receipts: [declinedUnderV1], now: t(1), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base }, picks: [{ key: addr(A), client: web, piece: ['cite/2', 'cite/3'] }, { key: addr(B), client: web, piece: ['cite/1', 'cite/2', 'cite/3'] }] });

const oneRevealC2 = handIn(C, cite2, 0, { verdict: 'supports', quote: 'c' }, 'anthropic/claude', 'avail-c');
const twoRevealsC2 = handIn(D, cite2, 2, { verdict: 'supports', quote: 'd' }, 'anthropic/claude', 'avail-d');
const threeC3 = [...handIn(E, cite3, 0, { verdict: 'supports', quote: 'e' }, 'anthropic/claude', 'avail-e'), ...handIn(F, cite3, 2, { verdict: 'supports', quote: 'f' }, 'anthropic/claude', 'avail-f'), ...handIn(G, cite3, 4, { verdict: 'supports', quote: 'g' }, 'anthropic/claude', 'avail-g')];
clarifications.push({ name: 'c04-a-revealed-commit-counts-once-in-availability', description: 'Availability counts unabandoned commits and reveals: a commit that has been revealed is its reveal\'s, not a second unit, so one commit and its reveal weigh one, below two reveals.', receipts: [...a1, ...oneRevealC2, ...twoRevealsC2, ...threeC3], now: t(8), states: { 'cite/1': 'needs_verify', 'cite/2': 'needs_verify', 'cite/3': 'needs_verify', ...base }, picks: [{ key: addr(H), client: { can: ['web'], model: 'meta/llama' }, piece: 'cite/1' }] });

const shortDelegate = ev(B, 'delegate', t(0), { to: addr(B1), scope: ['claim', 'commit', 'reveal'], expires: t(60) });
const bAll = [cite1, cite2, cite3].flatMap((c, i) => handIn(B, c, 1 + 2 * i, { verdict: 'supports', quote: 'b' }, 'openai/gpt', `expiry-${i}`));
clarifications.push({ name: 'c05a-a-delegate-within-its-delegation', description: 'While its delegation lives, a delegate\'s key counts for its root, and is handed nothing its root has revealed on.', receipts: [shortDelegate, ...bAll], now: t(30), states: { 'cite/1': 'needs_verify', 'cite/2': 'needs_verify', 'cite/3': 'needs_verify', ...base }, picks: [{ key: addr(B1), client: web, piece: null }] });
clarifications.push({ name: 'c05b-a-delegate-after-its-delegation-expired', description: 'Once its delegation has expired, the key is related to its old root no longer: relations are judged with delegations as live at the time asked.', receipts: [shortDelegate, ...bAll], now: t(90), states: { 'cite/1': 'needs_verify', 'cite/2': 'needs_verify', 'cite/3': 'needs_verify', ...base }, picks: [{ key: addr(B1), client: web, piece: ['cite/1', 'cite/2', 'cite/3'] }] });

const v2two = envelope({ title: 'A report, week two', prev: P, pieces: { ...v1.problem.pieces, 'cite/*': { ...v1.problem.pieces['cite/*']!, count: 2 } } });
const P2 = problemHash(v2two);
const oldClaims = [1, 2, 3].map((m) => ev(A, 'claim', t(m), { by: by('a/x') }, cite3));
const newClaim = ev(A, 'claim', t(3), { by: by('a/x') }, cite1, P2);
clarifications.push({ name: 'c06-events-on-a-piece-this-version-dropped', description: 'A piece hash counts if any envelope in the chain contains it: events on a piece the ancestor had and this version dropped are folded, not dropped, and its claims count toward the root\'s weight in this chain.', envelopes: [v2two, v1], receipts: [...oldClaims, newClaim], now: t(4), states: { 'cite/1': 'in_flight', 'cite/2': 'open', ...base }, picks: [{ key: addr(B), client: web, piece: 'cite/2' }] });

const onlyLint = envelope({ slug: 'only-lint', pieces: { lint: { verifier: 'check', requires: ['shell'], brief: 'Run the lint.', workspace: { repo: 'https://example.org/r', base: 'abc' }, check: { file: 'lint.sh' } } } });
const LP = problemHash(onlyLint);
const lintOnly = pieceHash(onlyLint, 'lint');
const lintPatch = handIn(F, lintOnly, 0, { patch: '' }, 'anthropic/claude', 'only-patch', LP);
const lintDigest = reduce({ envelopes: [onlyLint], blobs, receipts: lintPatch, now: t(2) }).byHash.get(lintOnly)!.reveals[0]!.digest;
const lintG = ev(G, 'run', t(2), { digest: lintDigest, exit: 0, host: 'linux', by: by('human') }, lintOnly, LP);
const lintH = ev(H, 'run', t(3), { digest: lintDigest, exit: 0, host: 'darwin', image: 'sha256:' + 'ab'.repeat(32), by: by('openai/gpt') }, lintOnly, LP);
clarifications.push({ name: 'c07-a-check-output-carries-host-and-image', description: 'The output of a check piece lists each run\'s signer, exit, host, and score and image where present, with absent values left out.', envelopes: [onlyLint], receipts: [...lintPatch, lintG, lintH], now: t(60 * 50), states: { lint: 'accepted' }, complete: true });

const noteSchema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'note'], properties: { verdict: { enum: ['supports', 'contradicts', 'unreachable'] }, note: { type: 'string' as const, maxLength: 160 } } };
const noted = envelope({ slug: 'noted', pieces: { 'cite/*': { count: 1, verifier: 'agree', brief: 'Citation {n}', schema: noteSchema, agree: ['verdict', 'note'] } } });
const NP = problemHash(noted);
const noteCite = pieceHash(noted, 'cite/1');
const noteA = handIn(A, noteCite, 0, { verdict: 'supports', note: 'unreachable' }, 'a/x', 'note-a', NP);
const noteB = handIn(B, noteCite, 2, { verdict: 'supports', note: 'unreachable' }, 'b/y', 'note-b', NP);
clarifications.push({ name: 'c08-unreachable-in-a-string-field-is-a-word', description: 'A piece is unreachable only where the agreed value unreachable sits in an enum that lists it: the same word in an agreed string field is a word, and the piece is accepted.', envelopes: [noted], receipts: [...noteA, ...noteB], now: t(60 * 50), states: { 'cite/1': 'accepted' }, complete: true });

clarifications.push({ name: 'c09-the-window-closes-at-its-end', description: 'A window runs while now < c + challenge_window_h: at that instant exactly the piece is accepted, no longer provisional.', receipts: [claim, ...a1, ...b1], now: t(6 + 48 * 60), states: { 'cite/1': 'accepted', 'cite/2': 'open', 'cite/3': 'open', ...base } });

clarifications.push({ name: 'c10-a-version-by-any-root', description: 'A version is signed by a root, any root: one from a key that is not the owner is kept.', receipts: [ev(A, 'version', t(0), { slug: 'report', hash: P }, undefined, P)], now: t(1), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base } });

const strayPiece = ('sha256:' + '0'.repeat(64)) as Hash;
const strayClaim = ev(C, 'claim', t(0), { by: by('c/z') }, strayPiece);
const delegateToC = ev(B, 'delegate', t(1), { to: addr(C), scope: ['claim'], expires: t(60) });
clarifications.push({ name: 'c11-a-prior-event-though-dropped-for-what-it-names', description: 'A key has a prior event once an event of its passed shape, signature and standing, whether or not it was then dropped for what it names: a delegate to such a key is dropped.', receipts: [strayClaim, delegateToC], now: t(2), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base }, dropped: ['names a piece the chain does not have', 'the delegate has a prior event'] });

const revokeB1 = ev(B, 'revoke', t(1), { of: addr(B1) });
const cTakesB1 = ev(C, 'delegate', t(2), { to: addr(B1), scope: ['claim'], expires: t(60) });
clarifications.push({ name: 'c12-a-revoked-delegate-stays-a-delegate', description: 'Once delegated to, a key is another root\'s delegate for good, revoked or not: a second root cannot take it on.', receipts: [delegate, revokeB1, cTakesB1], now: t(3), states: { 'cite/1': 'open', 'cite/2': 'open', 'cite/3': 'open', ...base }, dropped: ['the delegate is another root\'s'] });

const claimAsOld = ev(A, 'claim', t(1), { by: by('a/x') }, cite1);
const newRevokesOld = ev(A2, 'revoke', t(2), { of: addr(A) });
const claimAfterRevoke = ev(A, 'claim', t(3), { by: by('a/x') }, cite2);
clarifications.push({ name: 'c13-the-new-root-revokes-the-old', description: 'The old root is a delegate of the new until revoked: after the new root\'s revoke the old key signs nothing, and what it did before stays the new root\'s.', receipts: [good, claimAsOld, newRevokesOld, claimAfterRevoke], now: t(4), states: { 'cite/1': 'in_flight', 'cite/2': 'open', 'cite/3': 'open', ...base }, dropped: ['the delegation does not cover this event'] });

const beforeRotate = handIn(A, cite1, 0, { verdict: 'supports', quote: 'as the old root' }, 'anthropic/claude', 'rot-a');
const afterRotate = handIn(A2, cite1, 4, { verdict: 'supports', quote: 'as the new root' }, 'openai/gpt', 'rot-a2');
const rotateAt2: Receipt = { event: signEvent({ ...rotateBody, ts: t(2), sig_to: signObject({ ...rotateBody, ts: t(2) }, A2) }, A), received: [{ by: 'https://tracker.example/', at: t(2) }] };
clarifications.push({ name: 'c14-a-rotation-relates-what-came-before-to-what-comes-after', description: 'Rotations are judged as they stand at the end of the fold: the old root\'s reveal and the new root\'s are one root\'s, and do not make a set.', receipts: [...beforeRotate, rotateAt2, ...afterRotate], now: t(7), states: { 'cite/1': 'needs_verify', 'cite/2': 'open', 'cite/3': 'open', ...base } });

mkdirSync(join(here), { recursive: true });
mkdirSync(join(here, 'clarifications'), { recursive: true });
let n = 0;
for (const spec of fixtures) {
  const fixture = build(spec);
  writeFileSync(join(here, `${spec.name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  n++;
}
for (const spec of clarifications) {
  const fixture = build(spec);
  writeFileSync(join(here, 'clarifications', `${spec.name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  n++;
}
console.log(`${n} fixtures written`);
