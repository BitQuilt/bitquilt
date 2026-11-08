/**
 * QX-1 section 4 at the mirror: the seed of a challenge's draw is the hash of its receipt line on the tracker it was
 * posted to, and the mirror keeps a chain of its own (NODE.md section 5). A challenge is posted and seated at a
 * tracker. The tracker's chains as it serves them give the tracker's seed and the tracker's seats to anyone who folds
 * them: the seed from the challenge's line on its problem's log, and the pool from that log, the log of the other
 * problem it carries and its identity log (QX-1 section 3). The challenge's problem's log alone gives the seed and an
 * empty pool, so it seats no panel.
 * The mirror's line for the same challenge keeps the tracker's wrappers and adds its own, so its hash is the mirror's,
 * and the layer folded over the mirror's files seeds from that hash and not the tracker's. QX-1 section 4 says so, and
 * names the section that states the mirror's chain. So the mirror's fold seats another panel: two verdicts decide the
 * challenge at the tracker, the first from a seat the mirror's draw does not seat, and the mirror takes both, refuses
 * nothing, and folds the challenge open. NODE.md section 6 names the draw among the ways the mirror's fold, which the
 * coin's balances are checked over, differs from the home's. The nonces are fixed, so every hash and both draws are
 * the same on every run.
 */
import { mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Hash,
  type Receipt,
  type Unsigned,
  commitHash,
  eventId,
  problemHash,
  signEvent,
  signObject,
} from '@bitquilt/core';
import { challengeLayer, reduceInputOf } from '@bitquilt/tracker';
import { MirrorFiles } from '../src/files.js';
import { mirror } from '../src/mirror.js';
import { VERDICT, addr, by, key, startTracker } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3);
const judges = [key(11), key(12), key(13), key(14), key(15), key(16)];
const secretOf = new Map<string, Uint8Array>(judges.map((k) => [addr(k), k]));

/** The owner's problem of `count` statements, each accepted where two vendors agree on the verdict. */
function envelope(slug: string, count: number): Envelope {
  const problem: Envelope['problem'] = {
    title: `Statements (${slug})`,
    done_when: 'Done.',
    owner: addr(owner),
    slug,
    prev: null,
    from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
    pieces: {
      'statement/*': {
        count,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Statement {n}.',
        schema: VERDICT,
        agree: ['verdict'],
      },
    },
    data: {},
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

let tick = Date.parse('2026-11-08T09:00:00.000Z');
const now = () => new Date(tick).toISOString();
function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem: Hash, piece: Hash) {
  tick += 1000;
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: now(), body, problem, piece };
  return signEvent(u, k);
}

let server: Server;
let base: string;
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
async function accepted(path: string, event: unknown): Promise<void> {
  const r = await post(path, event);
  expect(r.status, await r.clone().text()).toBe(202);
}
let nonces = 0;
/** A nonce of thirty-two hex characters, the next of a count, so the commits and their hashes are fixed. */
const nextNonce = () => (nonces++).toString(16).padStart(32, '0');
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string) {
  const ret = { verdict: 'supports' };
  const nonce = nextNonce();
  await accepted(`p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
async function piecesOf(problem: Hash): Promise<Hash[]> {
  const state = (await (await fetch(`${base}p/${problem}/state`)).json()) as { pieces: { hash: Hash }[] };
  return state.pieces.map((p) => p.hash);
}
/** A log as the tracker serves it: one page holds every line of this test's logs. */
async function served(path: string): Promise<Receipt[]> {
  const text = await (await fetch(`${base}${path}?since=0`)).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Receipt);
}

const elsewhere = envelope('elsewhere', 3);
const Q = problemHash(elsewhere);
const challenged = envelope('challenged', 1);
const P = problemHash(challenged);
let p1: Hash;

beforeAll(async () => {
  ({ server, base } = await startTracker(now));
  expect((await post('p', { envelope: elsewhere })).status).toBe(201);
  expect((await post('p', { envelope: challenged })).status).toBe(201);
  // The pool: six roots with an accepted return on another problem, unrelated to everyone on the challenged piece.
  const pieces = await piecesOf(Q);
  for (const [i, q] of pieces.entries()) {
    await returnOn(Q, q, judges[2 * i]!, 'anthropic/claude');
    await returnOn(Q, q, judges[2 * i + 1]!, 'openai/gpt');
  }
  [p1] = (await piecesOf(P)) as [Hash];
  await returnOn(P, p1, A, 'anthropic/claude');
  await returnOn(P, p1, B, 'openai/gpt');
  await accepted(`p/${P}/events`, ev(C, 'challenge', { stake: 1, ground: 'The source says otherwise.' }, P, p1));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the seed of a challenge at the mirror (QX-1 section 4)', () => {
  it("is read from the tracker's chain as it serves it, and the mirror's own chain seeds another draw", async () => {
    const view = (await (await fetch(`${base}p/${P}/challenges`)).json()) as {
      challenges: { id: Hash; seed: string | null; seats: { root: string }[] }[];
    };
    const [tracked] = view.challenges;
    expect(tracked?.seats).toHaveLength(3);

    // The tracker's chain as it serves it: the challenge's line is the seed, and its fold seats the same panel.
    const lines = await served(`p/${P}/events`);
    const at = lines.find((l) => eventId(l.event) === tracked!.id)!;
    expect(at.hash).toBe(tracked!.seed);
    const identity = await served('k/events');
    const inputs = [
      {
        envelopes: [elsewhere],
        blobs: new Map(),
        receipts: [...(await served(`p/${Q}/events`)), ...identity],
        now: now(),
      },
      { envelopes: [challenged], blobs: new Map(), receipts: [...lines, ...identity], now: now() },
    ];
    const folded = challengeLayer({ problems: inputs, now: now() }).problems.get(P)!.challenges[0]!;
    expect(folded.seed).toBe(tracked!.seed);
    expect(folded.seats.map((s) => s.root)).toEqual(tracked!.seats.map((s) => s.root));
    // The challenge's problem's log alone gives the seed and an empty pool, so it seats no panel (QX-1 section 3).
    const alone = challengeLayer({ problems: [inputs[1]!], now: now() }).problems.get(P)!.challenges[0]!;
    expect(alone.seed).toBe(tracked!.seed);
    expect(alone.seats).toEqual([]);

    // The mirror's chain: the same event and the tracker's wrappers, then the mirror's own, under the mirror's hash.
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-seed-'));
    const report = await mirror({ trackers: [base], out, now });
    expect(report.refused).toEqual([]);
    const store = new MirrorFiles(out);
    const kept = store.lines(P).find((l) => eventId(l.event) === tracked!.id)!;
    expect(kept.received.slice(0, at.received.length)).toEqual(at.received);
    expect(kept.received.at(-1)?.by).toBe('mirror');
    expect(kept.hash).not.toBe(tracked!.seed);
    const mirrored = challengeLayer({
      problems: [reduceInputOf(store, elsewhere, now()), reduceInputOf(store, challenged, now())],
      now: now(),
    }).problems.get(P)!.challenges[0]!;
    expect(mirrored.seed).toBe(kept.hash);
  });

  it("leaves open in the mirror's fold a challenge the tracker decided, by a verdict on a seat its draw does not seat", async () => {
    type Challenge = { id: Hash; outcome: string; seats: { root: string }[] };
    const atTracker = async () =>
      ((await (await fetch(`${base}p/${P}/challenges`)).json()) as { challenges: Challenge[] }).challenges[0]!;
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-draw-'));
    const store = new MirrorFiles(out);
    const atMirror = () =>
      challengeLayer({
        problems: [reduceInputOf(store, elsewhere, now()), reduceInputOf(store, challenged, now())],
        now: now(),
      }).problems.get(P)!.challenges[0]!;

    // The first run keeps the challenge's line, and with it the mirror's own seed and seats.
    expect((await mirror({ trackers: [base], out, now })).refused).toEqual([]);
    const tracked = await atTracker();
    const drawn = tracked.seats.map((s) => s.root);
    const seated: string[] = atMirror().seats.map((s) => s.root);
    const unseated = drawn.filter((r) => !seated.includes(r));
    expect(unseated.length, 'the two draws seat the same panel').toBeGreaterThan(0);

    // Two verdicts decide at the tracker, the first from a seat the mirror's draw does not seat.
    const voters = [...unseated, ...drawn.filter((r) => seated.includes(r))].slice(0, 2);
    for (const root of voters)
      await accepted(
        `p/${P}/events`,
        ev(secretOf.get(root)!, 'verdict', { challenge: tracked.id, for: 'challenger' }, P, p1),
      );
    expect((await atTracker()).outcome).toBe('held');

    // The second run takes both verdicts and refuses nothing, and its fold counts only a voter its draw seats.
    const again = await mirror({ trackers: [base], out, now });
    expect(again.refused).toEqual([]);
    expect(again.problems.find((p) => p.hash === P)?.added).toBe(2);
    const mirrored = atMirror();
    expect(mirrored.outcome).toBe('open');
    expect(mirrored.seats.filter((s) => s.verdict).map((s) => s.root)).toEqual(
      voters.filter((r) => seated.includes(r)),
    );
    expect(mirrored.dropped.map((d) => d.why)).toEqual(
      voters.filter((r) => !seated.includes(r)).map(() => 'not a judge drawn for this challenge'),
    );
  });

  it("says so in QX-1 section 4, with the logs the seed and the pool are read from, and the mirror's own chain", () => {
    const doc = readFileSync(join(root, 'docs', 'ext', 'QX-1.md'), 'utf8').replace(/\r\n/g, '\n');
    const start = doc.indexOf('\n## 4. The seed and the draw\n');
    expect(start).toBeGreaterThan(-1);
    const section = doc.slice(start + 1).split('\n## ')[0]!;
    expect(section).not.toContain('line for line');
    expect(section).toContain('the chains of the tracker the challenge was posted to, as that tracker serves them');
    expect(section).toContain("the seed from the challenge's line on its problem's log (`GET /p/<hash>/events`)");
    expect(section).toContain(
      'the pool from that log, the log of every other problem it carries and its identity log (`GET /k/events`)',
    );
    expect(section).toContain('the mirror keeps one of its own');
    expect(section).toContain('[NODE.md](../NODE.md) section 5');
  });

  it("is named in NODE.md section 6 among the ways the mirror's fold, which the balances are checked over, differs", () => {
    const doc = readFileSync(join(root, 'docs', 'NODE.md'), 'utf8').replace(/\r\n/g, '\n');
    const start = doc.indexOf('\n## 6. The mirror job\n');
    expect(start).toBeGreaterThan(-1);
    const balances = doc
      .slice(start + 1)
      .split('\n## ')[0]!
      .split('\n\n')
      .find((p) => p.startsWith("**The coin's balances.**"))!;
    expect(balances).not.toContain('so the balances reproduce where that is what the home folded');
    expect(balances).toContain('What the mirror folds can differ from what the home folded in three ways.');
    expect(balances).toContain("it folds them over its own chain and not the home's");
    expect(balances).toContain(
      "QX-1 section 4 seeds a challenge's panel from the hash of its line on the tracker that first received it.",
    );
    expect(balances).toContain("reads that hash from the challenge's line in the chain it folds");
    expect(balances).toContain('draws from another seed and can seat another panel');
    expect(balances).toContain('a challenge the home decided can stay open there or be decided otherwise');
  });
});
