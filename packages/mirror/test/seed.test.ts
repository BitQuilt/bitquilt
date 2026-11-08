/**
 * QX-1 section 4 at the mirror: the seed of a challenge's draw is the hash of its receipt line on the tracker it was
 * posted to, and the mirror keeps a chain of its own (NODE.md section 5). A challenge is posted and seated at a
 * tracker that is the coin's home. The tracker's chains as it serves them give the tracker's seed and the tracker's
 * seats to anyone who folds them: the seed from the challenge's line on its problem's log, and the pool from that log,
 * the logs of the other problems it carries and its identity log (QX-1 section 3). The challenge's problem's log alone
 * gives the seed and an empty pool, so it seats no panel.
 * The mirror's line for the same challenge keeps the tracker's wrappers and adds its own, so its hash is the mirror's,
 * and the layer folded over the mirror's files seeds from that hash and not the tracker's. QX-1 section 4 says so, and
 * names the section that states the mirror's chain. So the mirror's own fold seats another panel: two verdicts decide
 * the challenge at the tracker, the first from a seat the mirror's draw does not seat, and the mirror's own fold leaves
 * the challenge open. The decision struck the accepting set, and with it the coin A locked behind its work there was
 * forfeited (QX-17 section 4). The mirror's check of the coin's balances folds the tracker's own chains as it serves
 * them, cut at the heads its state names (QX-17 section 6), and not the mirror's, so it reproduces the forfeit: the
 * mirror refuses nothing and writes the tracker's balances, while its own published chain keeps its own hashes and its
 * own fold moves no coin. NODE.md section 6 says the check folds the home's chains and draws the home's panel. The
 * nonces are fixed, so every hash and both draws are the same on every run.
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
import { COIN_LOG, challengeLayer, coinLayer, reduceInputOf } from '@bitquilt/tracker';
import { MirrorFiles } from '../src/files.js';
import { mirror } from '../src/mirror.js';
import { VERDICT, addr, by, key, startTracker } from './helpers.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  treasury = key(7);
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

const T0 = '2026-11-08T00:00:00.000Z';
const HOUR = 3_600_000;
let tick = Date.parse(T0) + 9 * HOUR;
const now = () => new Date(tick).toISOString();
/** The coin the tracker carries (QX-17 section 1): an epoch a day from T0, and a point of standing at 100 units. */
const coin = {
  genesis: T0,
  epoch_h: 24,
  emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 },
  vesting_h: 48,
  infra_bp: 1000,
  treasury: addr(treasury),
  unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 },
  burn_rate: 100,
  transfers_from: null,
  redeem_from: null,
};
/** The owner's founding standing (QX-1 section 2), which the owner's gold stakes, as the tracker publishes it. */
const founding = { [addr(owner)]: 10 };
const foundingMap = new Map(Object.entries(founding).map(([a, n]) => [a.toLowerCase(), n]));

function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  tick += 1000;
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: now(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}

let server: Server;
let base: string;
const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
async function accepted(path: string, event: unknown): Promise<Hash> {
  const r = await post(path, event);
  expect(r.status, await r.clone().text()).toBe(202);
  return ((await r.json()) as { id: Hash }).id;
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
const golden = envelope('golden', 1);
const G = problemHash(golden);
const challenged = envelope('challenged', 1);
const P = problemHash(challenged);
let p1: Hash;
let coinLock: Hash;

beforeAll(async () => {
  ({ server, base } = await startTracker(now, { coin, founding }));
  for (const e of [elsewhere, golden, challenged]) expect((await post('p', { envelope: e })).status).toBe(201);
  // The pool: six roots with an accepted return on another problem, unrelated to everyone on the challenged piece.
  const pieces = await piecesOf(Q);
  for (const [i, q] of pieces.entries()) {
    await returnOn(Q, q, judges[2 * i]!, 'anthropic/claude');
    await returnOn(Q, q, judges[2 * i + 1]!, 'openai/gpt');
  }
  // The owner's gold on the golden piece, matched by A and B: a verified square, which mints their coin at the end of
  // the epoch (QX-16, QX-17 section 4).
  const [g1] = (await piecesOf(G)) as [Hash];
  const projection = { verdict: 'supports' };
  const nonce = nextNonce();
  await accepted(
    `p/${G}/events`,
    ev(owner, 'gold', { commitments: [commitHash({ piece: g1, projection }, nonce)], stake: 2 }, G),
  );
  await returnOn(G, g1, A, 'anthropic/claude');
  await returnOn(G, g1, B, 'openai/gpt');
  await accepted(`p/${G}/events`, ev(owner, 'gold_reveal', { projection, nonce }, G, g1));
  // The challenged piece asks a stake of each worker (QX-15): A backs its own with coin once the epoch has paid, and B
  // with standing.
  await accepted(`p/${P}/events`, ev(owner, 'stake_rule', { min: 1 }, P));
  tick = Date.parse(T0) + 24 * HOUR + 1000;
  [p1] = (await piecesOf(P)) as [Hash];
  coinLock = await accepted('coin/events', ev(A, 'lock', { problem: P, piece: p1, amount: 100 }));
  await accepted(`p/${P}/events`, ev(A, 'lock', { kind: 'coin', amount: 1, id: coinLock }, P, p1));
  await accepted(`p/${P}/events`, ev(B, 'lock', { kind: 'standing', amount: 1 }, P, p1));
  await returnOn(P, p1, A, 'anthropic/claude');
  await returnOn(P, p1, B, 'openai/gpt');
  await accepted(`p/${P}/events`, ev(C, 'challenge', { stake: 1, ground: 'The source says otherwise.' }, P, p1));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** The challenge layer over three problems' inputs, as the tracker folds them: with its founding standing. */
const layerOver = (problems: Parameters<typeof challengeLayer>[0]['problems'], coinLines: Receipt[] = []) =>
  challengeLayer({ problems, now: now(), coin: coinLines, founding: foundingMap });

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
    const input = async (e: Envelope) => ({
      envelopes: [e],
      blobs: new Map(),
      receipts: [...(await served(`p/${problemHash(e)}/events`)), ...identity],
      now: now(),
    });
    const inputs = [await input(elsewhere), await input(golden), await input(challenged)];
    const folded = layerOver(inputs, await served('coin/events')).problems.get(P)!.challenges[0]!;
    expect(folded.seed).toBe(tracked!.seed);
    expect(folded.seats.map((s) => s.root)).toEqual(tracked!.seats.map((s) => s.root));
    // The challenge's problem's log alone gives the seed and an empty pool, so it seats no panel (QX-1 section 3).
    const alone = layerOver([inputs[2]!]).problems.get(P)!.challenges[0]!;
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
    const mirrored = layerOver([elsewhere, golden, challenged].map((e) => reduceInputOf(store, e, now()))).problems.get(
      P,
    )!.challenges[0]!;
    expect(mirrored.seed).toBe(kept.hash);
  });

  it("leaves open in the mirror's own fold a challenge the tracker decided, and its check reproduces the forfeit", async () => {
    type Challenge = { id: Hash; seed: string; outcome: string; seats: { root: string }[] };
    type Balance = { balance: number; locked: number; forfeited: number };
    const atTracker = async () =>
      ((await (await fetch(`${base}p/${P}/challenges`)).json()) as { challenges: Challenge[] }).challenges[0]!;
    const stateAtTracker = async () =>
      (await (await fetch(`${base}coin/state`)).json()) as { balances: Record<string, Balance> };
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-draw-'));
    const store = new MirrorFiles(out);
    const ownFold = () =>
      layerOver(
        [elsewhere, golden, challenged].map((e) => reduceInputOf(store, e, now())),
        store.lines(COIN_LOG),
      );
    const atMirror = () => ownFold().problems.get(P)!.challenges[0]!;

    // The first run keeps the challenge's line, and with it the mirror's own seed and seats.
    const first = await mirror({ trackers: [base], out, now });
    expect(first.refused).toEqual([]);
    expect(first.coin).toMatchObject({ reproduced: true });
    const tracked = await atTracker();
    const drawn = tracked.seats.map((s) => s.root);
    const seated: string[] = atMirror().seats.map((s) => s.root);
    const unseated = drawn.filter((r) => !seated.includes(r));
    expect(unseated.length, 'the two draws seat the same panel').toBeGreaterThan(0);
    expect((await stateAtTracker()).balances[addr(A)]).toMatchObject({ balance: 450, locked: 100, forfeited: 0 });

    // Two verdicts decide at the tracker, the first from a seat the mirror's draw does not seat. The set is struck,
    // and A's coin lock is forfeited with the stake it backs: the lock, and as much again from A's unvested coin.
    const voters = [...unseated, ...drawn.filter((r) => seated.includes(r))].slice(0, 2);
    for (const root of voters)
      await accepted(
        `p/${P}/events`,
        ev(secretOf.get(root)!, 'verdict', { challenge: tracked.id, for: 'challenger' }, P, p1),
      );
    expect((await atTracker()).outcome).toBe('held');
    const home = await stateAtTracker();
    expect(home.balances[addr(A)]).toMatchObject({ balance: 250, locked: 0, forfeited: 200 });

    // The second run takes both verdicts and refuses nothing, and its own fold counts only a voter its draw seats.
    const again = await mirror({ trackers: [base], out, now });
    expect(again.refused).toEqual([]);
    expect(again.errors).toEqual([]);
    expect(again.problems.find((p) => p.hash === P)?.added).toBe(2);
    const mirrored = atMirror();
    expect(mirrored.outcome).toBe('open');
    expect(mirrored.seats.filter((s) => s.verdict).map((s) => s.root)).toEqual(
      voters.filter((r) => seated.includes(r)),
    );
    expect(mirrored.dropped.map((d) => d.why)).toEqual(
      voters.filter((r) => !seated.includes(r)).map(() => 'not a judge drawn for this challenge'),
    );

    // The check folded the tracker's chains and not the mirror's: the balances reproduce, forfeit and all, and the
    // mirror writes them, while its own published chain keeps its own hashes and its own fold moves no coin.
    expect(again.coin).toEqual({ lines: 1, added: 0, head: 1, reproduced: true, credits: 0 });
    const written = JSON.parse(readFileSync(join(out, 'coin', 'balances.json'), 'utf8')) as {
      balances: Record<string, Balance>;
    };
    expect(written.balances).toEqual(home.balances);
    const challengeLine = store.lines(P).find((l) => eventId(l.event) === tracked.id)!;
    expect(challengeLine.hash).not.toBe(tracked.seed);
    const own = coinLayer({ layer: ownFold(), params: coin, receipts: store.lines(COIN_LOG), now: now() });
    expect(own.balance(addr(A))).toMatchObject({ balance: 450, locked: 100, forfeited: 0 });
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

  it("is named in NODE.md section 6: the check of the coin's balances draws the home's panel from the home's line", () => {
    const doc = readFileSync(join(root, 'docs', 'NODE.md'), 'utf8').replace(/\r\n/g, '\n');
    const start = doc.indexOf('\n## 6. The mirror job\n');
    expect(start).toBeGreaterThan(-1);
    const balances = doc
      .slice(start + 1)
      .split('\n## ')[0]!
      .split('\n\n')
      .find((p) => p.startsWith("**The coin's balances.**"))!;
    expect(balances).not.toContain('What the mirror folds can differ from what the home folded in three ways.');
    expect(balances).not.toContain('draws from another seed and can seat another panel');
    expect(balances).toContain(
      "A challenge's panel is drawn from the home's line for it, as QX-1 section 4 draws it, and a judge piece's panel from the home's line for its first candidate (verifiers.md section 2), not from the mirror's own lines, whose hashes are the mirror's (section 5, step 3)",
    );
    expect(balances).toContain(
      'so a challenge the home decided is decided in the fold and the forfeits it moved are moved there too',
    );
    expect(balances).toContain(
      "The mirror's own chains, its index and everything it publishes are as section 5 takes them; only the check reads the home's chains.",
    );
  });
});
