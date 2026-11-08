/**
 * QX-1 section 4 at the mirror: the seed of a challenge's draw is the hash of its receipt line on the tracker it was
 * posted to, and the mirror keeps a chain of its own (NODE.md section 5). A challenge is posted and seated at a
 * tracker. The tracker's chain as it serves it gives the tracker's seed and the tracker's seats to anyone who folds it.
 * The mirror's line for the same challenge keeps the tracker's wrappers and adds its own, so its hash is the mirror's,
 * and the layer folded over the mirror's files seeds from that hash and not the tracker's. QX-1 section 4 says so, and
 * names the section that states the mirror's chain.
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
  newNonce,
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
const judges = [key(11), key(12), key(13), key(14)];

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
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string) {
  const ret = { verdict: 'supports' };
  const nonce = newNonce();
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

const elsewhere = envelope('elsewhere', 2);
const Q = problemHash(elsewhere);
const challenged = envelope('challenged', 1);
const P = problemHash(challenged);
let p1: Hash;

beforeAll(async () => {
  ({ server, base } = await startTracker(now));
  expect((await post('p', { envelope: elsewhere })).status).toBe(201);
  expect((await post('p', { envelope: challenged })).status).toBe(201);
  // The pool: four roots with an accepted return on another problem, unrelated to everyone on the challenged piece.
  const [q1, q2] = await piecesOf(Q);
  await returnOn(Q, q1!, judges[0]!, 'anthropic/claude');
  await returnOn(Q, q1!, judges[1]!, 'openai/gpt');
  await returnOn(Q, q2!, judges[2]!, 'anthropic/claude');
  await returnOn(Q, q2!, judges[3]!, 'openai/gpt');
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

  it("says so in QX-1 section 4, and names the section that states the mirror's own chain", () => {
    const doc = readFileSync(join(root, 'docs', 'ext', 'QX-1.md'), 'utf8').replace(/\r\n/g, '\n');
    const start = doc.indexOf('\n## 4. The seed and the draw\n');
    expect(start).toBeGreaterThan(-1);
    const section = doc.slice(start + 1).split('\n## ')[0]!;
    expect(section).not.toContain('line for line');
    expect(section).toContain('the chain of the tracker the challenge was posted to, as that tracker serves it');
    expect(section).toContain('the mirror keeps one of its own');
    expect(section).toContain('[NODE.md](../NODE.md) section 5');
  });
});
