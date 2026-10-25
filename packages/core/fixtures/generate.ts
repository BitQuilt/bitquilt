/**
 * Writes the conformance fixtures (CORE.md section 9) with fixed keys, fixed times and nonces derived from labels, so
 * the files are the same on every run. Each fixture's expectations are asserted here against what the core says before
 * they are written, so the reference implementation cannot quietly lock in a wrong answer.
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
const sdone = [...handIn(A, sc1, 0, { verdict: 'unreachable', quote: 'gone' }, 'a/x', 's1a', SP), ...handIn(B, sc1, 2, { verdict: 'unreachable', quote: 'also gone' }, 'b/y', 's1b', SP), ...handIn(A, sc2, 4, { verdict: 'supports', quote: 'x' }, 'a/x', 's2a', SP), ...handIn(B, sc2, 6, { verdict: 'supports', quote: 'y' }, 'b/y', 's2b', SP)];
fixtures.push({ name: '22-complete-with-output', description: 'Every piece accepted or unreachable: the output exists and has a hash.', envelopes: [small], receipts: sdone, now: t(60 * 50), states: { 'cite/1': 'unreachable', 'cite/2': 'accepted' }, complete: true, picks: [{ key: addr(C), client: web, piece: null }] });

mkdirSync(join(here), { recursive: true });
let n = 0;
for (const spec of fixtures) {
  const fixture = build(spec);
  writeFileSync(join(here, `${spec.name}.json`), JSON.stringify(fixture, null, 2) + '\n');
  n++;
}
console.log(`${n} fixtures written`);
