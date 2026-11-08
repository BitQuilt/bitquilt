import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Event,
  type Hash,
  type Receipt,
  type Unsigned,
  IDENTITY_LOG,
  commitHash,
  eventId,
  hashBytes,
  newNonce,
  nextLine,
  problemHash,
  signEvent,
  signObject,
  verifyChain,
} from '@bitquilt/core';
import { COIN_LOG, challengeLayer, coinLayer, reduceInputOf } from '@bitquilt/tracker';
import { MirrorFiles } from '../src/files.js';
import { mirror } from '../src/mirror.js';
import { VERDICT, addr, by, calendarBytes, key, startTracker } from './helpers.js';

/**
 * The coin at the mirror (QX-17 section 7): the coin log is pulled, verified from the coin log's hash and anchored
 * beside the problems'; the balances the tracker says it computed are kept only where the mirror reproduces them over
 * what the tracker's state says they were folded over (QX-17 section 6), the tracker's own chains as it serves them,
 * cut at the heads the state names, with the parameters the tracker publishes, and not over the mirror's own chains. So
 * a problem the tracker hides, which its index leaves out and no run of the mirror took, is folded all the same, and an
 * identity event another source gave the mirror and the tracker lacks moves nothing, where folding the mirror's own
 * chains would give another root the coin. A state that is not what the run already read from the tracker is refused,
 * though its balances are refolded to match: one that leaves out a problem the tracker served, names a chain at a head
 * below the lines read, or was folded at a time after its own or more than five seconds before it. So is one that names
 * a head off a chain the run read, the identity log's, the coin log's or a problem's, though the tracker serves the
 * fork to every later read: a head within the lines read is cut from them with no second read, and a head past them is
 * read again, and refused where what is read again does not extend them or does not verify. A tracker that takes an
 * event on a problem and one on the coin log after the run read the problem reproduces. The layer is folded at the time
 * the state names, which can be before its own: in a home of its own, a window that closes between the two would
 * release a lock and give back an escrow. Each read a trace names is measured by its bytes, so a reading the home set
 * aside in a dispute is set aside here, and the gold's match and its coin follow. A chain the state names that cannot
 * be read whole, or has no line with the named hash, is refused with the chain named, a read or a data blob the home
 * does not serve as named with its hash named, whatever the mirror holds, and a tracker whose balances differ is
 * refused (NODE.md section 6). A read the home answers that it does not hold, which no line the home wrote names, is
 * left out of the fold, as the home's own fold leaves it out, whether or not the mirror holds it, so a home that keeps
 * a chain without its read reproduces; a read a line the home wrote names, which the home held when it took the line,
 * is refused where the home says it holds none, and so is a data blob, which a home that folds always holds. And every
 * credit line on the coin log (the way back) is checked against the deposit the chain holds, and the balances refused
 * where one is not what the chain holds. A home that holds problems the core refuses names them among the refused, and
 * the mirror, folding them as the home serves them, refuses the same ones and reproduces the balances; a state that
 * names a refused one as folded, or a folded one as refused, is refused (CORE.md section 6). With no chain to ask, the
 * balances are not kept and the credits alone refuse nothing (AGENTS.md, rule 10): the problems and the coin log are
 * kept, and where the balances reproduce the report says why; balances that do not reproduce are refused all the same.
 * QX-17 sections 6 and 7, NODE.md section 6 and PROTOCOL.md, The mirror, say no more than that.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  treasury = key(7),
  reader = key(5),
  maintainer = key(21),
  A2 = key(3);

function envelope(by: Uint8Array = owner, slug = 'statement'): Envelope {
  const problem: Envelope['problem'] = {
    title: `A statement (${slug})`,
    done_when: 'Done.',
    owner: addr(by),
    slug,
    prev: null,
    from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
    pieces: {
      'statement/*': {
        count: 1,
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
  return { ...unsigned, sig: signObject(unsigned, by) };
}

const T0 = '2026-10-27T00:00:00.000Z';
const HOUR = 3_600_000;
let tick = Date.parse(T0) + HOUR;
const now = () => new Date(tick).toISOString();
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
  reader: addr(reader),
};
type Doctor = (body: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
/** Real fetch, with a calendar that answers and, when asked, a doctored /coin/state. */
function fetchWith(doctor: Doctor | null): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://cal.test')) return new Response(calendarBytes, { status: 200 });
    const r = await fetch(input, init);
    if (doctor && url.endsWith('/coin/state'))
      return new Response(JSON.stringify(await doctor((await r.json()) as Record<string, unknown>)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    return r;
  }) as typeof fetch;
}

function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  tick += 1000;
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: now(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}
/** The coin's home every test reads, and a second home that takes P down from its own pages (QX-6). */
let server: Server;
let base: string;
let hidingServer: Server;
let hiding: string;
const post = (path: string, body: unknown, at = base) =>
  fetch(at + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
async function accepted(path: string, event: unknown, at = base): Promise<Hash> {
  const r = await post(path, event, at);
  expect(r.status, await r.clone().text()).toBe(202);
  return ((await r.json()) as { id: Hash }).id;
}
/** A commit and its reveal; the reveal's id, which a trace names. */
async function returnOn(
  problem: Hash,
  piece: Hash,
  k: Uint8Array,
  model: string,
  at = base,
  verdict = 'supports',
): Promise<Hash> {
  const ret = { verdict };
  const nonce = newNonce();
  await accepted(`p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece), at);
  return accepted(`p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece), at);
}
const pieceOf = async (problem: Hash, at: string): Promise<Hash> =>
  ((await (await fetch(`${at}p/${problem}/state`)).json()) as { pieces: { hash: Hash }[] }).pieces[0]!.hash;

const env = envelope();
const P = problemHash(env);
const elsewhere = envelope(A, 'elsewhere');
const Q = problemHash(elsewhere);
let p1: Hash;

/** A home's first epoch: the owner's gold on P's one piece, two workers who agree with it, and the owner's reveal. */
async function verifiedAt(at: string): Promise<void> {
  expect((await post('p', { envelope: env }, at)).status).toBe(201);
  p1 = await pieceOf(P, at);
  // The owner earns the point a gold's share of two asks, on a problem of A's with no gold and so no coin in it.
  expect((await post('p', { envelope: elsewhere }, at)).status).toBe(201);
  const q1 = await pieceOf(Q, at);
  await returnOn(Q, q1, owner, 'anthropic/claude', at);
  await returnOn(Q, q1, B, 'openai/gpt', at);
  const projection = { verdict: 'supports' };
  const nonce = newNonce();
  await accepted(
    `p/${P}/events`,
    ev(owner, 'gold', { commitments: [commitHash({ piece: p1, projection }, nonce)], stake: 2 }, P),
    at,
  );
  await returnOn(P, p1, A, 'anthropic/claude', at);
  await returnOn(P, p1, B, 'openai/gpt', at);
  await accepted(`p/${P}/events`, ev(owner, 'gold_reveal', { projection, nonce }, P, p1), at);
}

beforeAll(async () => {
  ({ server, base } = await startTracker(now, { coin }));
  ({ server: hidingServer, base: hiding } = await startTracker(now, { coin, maintainers: [addr(maintainer)] }));
  await verifiedAt(base);
  await verifiedAt(hiding);
  // The epoch's end, and A's coin locked at the first home.
  tick = Date.parse(T0) + 24 * HOUR + 1000;
  await accepted('coin/events', ev(A, 'lock', { problem: P, piece: p1, amount: 100 }));
  // The second home takes P down: its index leaves P out, and it still serves P by hash and folds it (QX-6 section 3).
  await accepted('k/events', ev(maintainer, 'hide', { id: P, why: 'Taken down here.' }), hiding);
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise<void>((r) => hidingServer.close(() => r()));
});

/** The balances a mirror wrote, with the head and the time they are of. */
const balancesIn = (out: string) =>
  JSON.parse(readFileSync(join(out, 'coin', 'balances.json'), 'utf8')) as {
    head: { seq: number; hash: string } | null;
    at: string;
    balances: Record<string, { balance: number; locked: number; credited: number }>;
  };

type Head = { seq: number; hash: string } | null;
/** A `/coin/state` answer, as far as these tests read it. */
type State = {
  head: Head;
  at: string;
  balances: Record<string, unknown>;
  folded: { at: string; problems: { problem: Hash; head: Head }[]; identity: Head };
};
/** A chain as a home serves it, cut at a head where one is given. */
async function servedLines(url: string, head?: Head): Promise<Receipt[]> {
  const lines = (await (await fetch(url)).text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Receipt);
  return head === undefined ? lines : lines.slice(0, head?.seq ?? 0);
}
/**
 * The balances the tracker's own layer code gives over a home's chains as it serves them, or as `forks` gives one by
 * its address, cut at the heads a state names, the layer at its `folded.at` and the coin at its `at`, with `params` or
 * the coin's parameters, and each read measured by `blobLength` or by none: what a doctored state is refolded to, so
 * that it is false only in what it names.
 */
async function balancesOver(
  at: string,
  state: State,
  {
    blobLength,
    forks = new Map(),
    params = coin,
  }: {
    blobLength?: (hash: Hash) => number | null;
    forks?: Map<string, Receipt[]>;
    params?: typeof coin;
  } = {},
): Promise<Record<string, unknown>> {
  const linesAt = async (url: string, head: Head): Promise<Receipt[]> =>
    forks.get(url)?.slice(0, head?.seq ?? 0) ?? (await servedLines(url, head));
  const envelopes = new Map<Hash, Envelope>();
  const chains = new Map<Hash, Receipt[]>();
  for (const { problem, head } of state.folded.problems) {
    envelopes.set(problem, (await (await fetch(`${at}p/${problem}`)).json()) as Envelope);
    chains.set(problem, await linesAt(`${at}p/${problem}/events`, head));
  }
  const identity = await linesAt(`${at}k/events`, state.folded.identity);
  const coinLines = await linesAt(`${at}coin/events`, state.head);
  const reader = {
    envelopeOf: (h: Hash) => envelopes.get(h) ?? null,
    getBlob: () => null,
    lines: (log: Hash) => (log === IDENTITY_LOG ? identity : (chains.get(log) ?? [])),
  };
  const layer = challengeLayer({
    problems: state.folded.problems.map(({ problem }) =>
      reduceInputOf(reader, envelopes.get(problem)!, state.folded.at),
    ),
    now: state.folded.at,
    coin: coinLines,
    ...(blobLength ? { blobLength } : {}),
  });
  const folded = coinLayer({ layer, params, receipts: coinLines, now: state.at });
  return JSON.parse(JSON.stringify(Object.fromEntries(folded.balances()))) as Record<string, unknown>;
}

describe('the coin at the mirror', () => {
  it("pulls the coin log, reproduces the balances, writes them, and anchors the coin log's head", async () => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-'));
    const report = await mirror({
      trackers: [base],
      out,
      now,
      fetchImpl: fetchWith(null),
      anchor: { calendars: ['http://cal.test'] },
    });
    expect(report.refused).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.coin).toEqual({ lines: 1, added: 1, head: 1, reproduced: true, credits: 0 });
    const lines = readFileSync(join(out, 'ledger', 'coin.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Receipt);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.event.type).toBe('lock');
    expect(verifyChain(lines, COIN_LOG).ok).toBe(true);
    const balances = JSON.parse(readFileSync(join(out, 'coin', 'balances.json'), 'utf8')) as {
      head: { seq: number };
      balances: Record<string, { balance: number; locked: number }>;
    };
    expect(balances.head.seq).toBe(1);
    expect(balances.balances[addr(A)]).toMatchObject({ balance: 450, locked: 100 });
    expect(balances.balances[addr(B)]).toMatchObject({ balance: 450, locked: 0 });
    expect(balances.balances[addr(treasury)]).toMatchObject({ balance: 100 });
    expect(report.anchors?.stamped.map((s) => s.problem)).toContain('coin');
    expect(existsSync(join(out, 'anchors', 'coin', '1.ots'))).toBe(true);
  });

  it('reads the state of a home from before the refused were named as naming none', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-older-'));
    const older: Doctor = (s) => {
      const { refused: _refused, ...folded } = s.folded as Record<string, unknown>;
      return { ...s, folded };
    };
    const report = await mirror({ trackers: [base], out, now, fetchImpl: fetchWith(older) });
    expect(report.refused).toEqual([]);
    expect(report.coin).toMatchObject({ reproduced: true });
  });

  it('refuses a tracker whose balances it cannot reproduce, and keeps none of them', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-bad-'));
    const doctor = (state: Record<string, unknown>) => {
      const balances = state.balances as Record<string, { balance: number }>;
      balances[addr(A)] = { ...balances[addr(A)]!, balance: 451 };
      return state;
    };
    const report = await mirror({ trackers: [base], out, now, fetchImpl: fetchWith(doctor) });
    expect(report.coin).toEqual({ lines: 1, added: 1, head: 1, reproduced: false, credits: 0 });
    expect(report.refused).toEqual([`coin: the balances at head 1 from ${base} do not reproduce here (${addr(A)})`]);
    expect(existsSync(join(out, 'coin', 'balances.json'))).toBe(false);
    expect(existsSync(join(out, 'ledger', 'coin.jsonl'))).toBe(true);
  });

  it('refuses the balances where a chain the state names cannot be read whole, naming the chain', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-unread-'));
    const unread: typeof fetch = async (input, init) =>
      String(input).startsWith(`${base}p/${P}/events`)
        ? new Response('', { status: 503 })
        : fetchWith(null)(input, init);
    const report = await mirror({ trackers: [base], out, now, fetchImpl: unread });
    expect(report.problems.map((p) => p.hash)).toEqual([Q]);
    expect(report.coin).toMatchObject({ lines: 1, head: 1, reproduced: false });
    expect(report.refused).toEqual([`coin: the chain of ${P} from ${base} cannot be read whole`]);
    expect(existsSync(join(out, 'coin', 'balances.json'))).toBe(false);
  });

  it('refuses a state that names a head its served chains do not have, naming the chain', async () => {
    type Named = { problems: { problem: Hash; head: { seq: number; hash: string } }[] };
    let seq = 0;
    const wrongLine = (state: Record<string, unknown>) => {
      const named = (state.folded as Named).problems.find((x) => x.problem === P)!;
      seq = named.head.seq;
      named.head = { seq, hash: '0'.repeat(64) };
      return state;
    };
    const run = (doctor: (state: Record<string, unknown>) => Record<string, unknown>) =>
      mirror({
        trackers: [base],
        out: mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-head-')),
        now,
        fetchImpl: fetchWith(doctor),
      });
    const line = await run(wrongLine);
    expect(seq).toBeGreaterThan(0);
    expect(line.refused).toEqual([
      `coin: the chain of ${P} from ${base} has no line ${seq} with the hash the coin state names`,
    ]);
    expect(line.coin).toMatchObject({ reproduced: false });
    // The coin log's head one line past the log the home serves.
    const beyond = await run((state) => {
      const head = state.head as { seq: number; hash: string };
      return { ...state, head: { ...head, seq: head.seq + 1 } };
    });
    expect(beyond.refused).toEqual([
      `coin: the coin log from ${base} has no line 2 with the hash the coin state names`,
    ]);
    expect(beyond.coin).toEqual({ lines: 1, added: 1, head: 1, reproduced: false });
  });

  it('refuses a state that is not what the run already had from the home, though its balances are refolded to match', async () => {
    const run = (doctor: Doctor) =>
      mirror({
        trackers: [base],
        out: mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-false-')),
        now,
        fetchImpl: fetchWith(doctor),
      });
    // Each doctored state is false only in what it names: its balances are the fold over what it names, and differ
    // from the home's.
    const refolded: { honest: unknown; doctored: unknown }[] = [];
    const refold = async (honest: Record<string, unknown>, doctored: State) => {
      const balances = await balancesOver(base, doctored);
      refolded.push({ honest: honest.balances, doctored: balances });
      return { ...doctored, balances };
    };
    // Q left out, which the home lists and this run took from it.
    const withoutQ = await run((state) => {
      const s = state as unknown as State;
      return refold(state, {
        ...s,
        folded: { ...s.folded, problems: s.folded.problems.filter((x) => x.problem !== Q) },
      });
    });
    expect(withoutQ.problems.map((p) => p.hash).sort()).toEqual([P, Q].sort());
    expect(withoutQ.refused).toEqual([
      `coin: the coin state from ${base} does not name ${Q}, which it served this run`,
    ]);
    expect(withoutQ.coin).toMatchObject({ reproduced: false });
    // P named at its second line, where this run read every line of P from the home before it read the state.
    let read = 0;
    const early = await run(async (state) => {
      const s = state as unknown as State;
      const lines = await servedLines(`${base}p/${P}/events`);
      read = lines.length;
      const second = { seq: 2, hash: lines[1]!.hash! };
      const problems = s.folded.problems.map((x) => (x.problem === P ? { problem: P, head: second } : x));
      return refold(state, { ...s, folded: { ...s.folded, problems } });
    });
    expect(read).toBeGreaterThan(2);
    expect(early.refused).toEqual([
      `coin: the chain of ${P} from ${base} was read to line ${read} this run, and the coin state names line 2`,
    ]);
    expect(early.coin).toMatchObject({ reproduced: false });
    for (const { honest, doctored } of refolded) expect(doctored).not.toEqual(honest);
    // A fold a second after the state's own time, and one six seconds before it.
    for (const lag of [-1000, 6000]) {
      let at = '';
      let folded = '';
      const off = await run((state) => {
        const s = state as unknown as State;
        at = s.at;
        folded = new Date(Date.parse(s.at) - lag).toISOString();
        return { ...state, folded: { ...s.folded, at: folded } };
      });
      expect(off.refused).toEqual([
        `coin: the coin state from ${base} was folded at ${folded}, not at its time ${at} or in the five seconds before it`,
      ]);
      expect(off.coin).toMatchObject({ reproduced: false });
    }
  });

  it('folds a problem the home hides, which its index leaves out and no run of the mirror took', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-hidden-'));
    const report = await mirror({ trackers: [hiding], out, now, fetchImpl: fetchWith(null) });
    expect(report.refused).toEqual([]);
    expect(report.errors).toEqual([]);
    // The mirror takes what the home lists, and so not P, while the home's state names P among what it folded.
    expect(report.problems.map((p) => p.hash)).toEqual([Q]);
    expect(existsSync(join(out, 'problems', `${P}.json`))).toBe(false);
    const state = (await (await fetch(`${hiding}coin/state`)).json()) as {
      folded: { problems: { problem: Hash }[] };
    };
    expect(state.folded.problems.map((x) => x.problem).sort()).toEqual([P, Q].sort());
    // P's verified square minted A's and B's coin, and the balances reproduce over P's chain as the home serves it.
    expect(report.coin).toEqual({ lines: 0, added: 0, head: null, reproduced: true, credits: 0 });
    const kept = balancesIn(out);
    expect(kept.balances[addr(A)]).toMatchObject({ balance: 450 });
    expect(kept.balances[addr(B)]).toMatchObject({ balance: 450 });
    expect(kept.balances[addr(treasury)]).toMatchObject({ balance: 100 });
  });

  it('is not moved by an identity event another source gave the mirror and the home lacks', async () => {
    const other = await startTracker(now);
    try {
      // Another tracker lists a problem of its own, so the mirror takes its identity log, which holds A's rotate to A2.
      expect((await post('p', { envelope: envelope(B, 'other') }, other.base)).status).toBe(201);
      tick += 1000;
      const u: Unsigned = { quilt: 1, type: 'rotate', key: addr(A), ts: now(), body: { to: addr(A2) } };
      const rotate: Event = signEvent({ ...u, sig_to: signObject(u, A2) }, A);
      await accepted('k/events', rotate, other.base);
      const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-other-'));
      const report = await mirror({ trackers: [other.base, base], out, now, fetchImpl: fetchWith(null) });
      expect(report.refused).toEqual([]);
      expect(report.errors).toEqual([]);
      expect(report.coin).toEqual({ lines: 1, added: 1, head: 1, reproduced: true, credits: 0 });
      const store = new MirrorFiles(out);
      expect(store.lines(IDENTITY_LOG).map((l) => eventId(l.event))).toContain(eventId(rotate));
      const kept = balancesIn(out);
      expect(kept.balances[addr(A)]).toMatchObject({ balance: 450, locked: 100 });
      // Folded over the mirror's own chains, A's coin would be A2's, and the home's balances would not reproduce.
      const lines = store.lines(COIN_LOG);
      const own = coinLayer({
        layer: challengeLayer({
          problems: [env, elsewhere].map((e) => reduceInputOf(store, e, kept.at)),
          now: kept.at,
          coin: lines,
        }),
        params: coin,
        receipts: lines,
        now: kept.at,
      }).balances();
      expect(own.has(addr(A))).toBe(false);
      expect(own.get(addr(A2))).toMatchObject({ balance: 450, locked: 100 });
    } finally {
      await new Promise<void>((r) => other.server.close(() => r()));
    }
  });

  describe('with a credit on the coin log', () => {
    // The credit is posted once for the tests below, after the tests above have read a coin log of one line, so
    // each of these holds whether it runs alone or in order.
    beforeAll(async () => {
      await accepted('coin/events', ev(reader, 'credit', { deposit: 1, root: addr(B), amount: 100 }));
    });

    it('checks every credit on the coin log against the chain, and refuses the balances where a credit is not what the chain holds', async () => {
      const chainOf = (amount: number) => ({
        depositAt: async (n: number) => ({ root: addr(B), amount, made: n === 1 }),
      });
      const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-credit-'));
      const report = await mirror({ trackers: [base], out, now, fetchImpl: fetchWith(null), chain: chainOf(100) });
      expect(report.refused).toEqual([]);
      expect(report.coin).toEqual({ lines: 2, added: 2, head: 2, reproduced: true, credits: 1 });
      const balances = JSON.parse(readFileSync(join(out, 'coin', 'balances.json'), 'utf8')) as {
        balances: Record<string, { balance: number; credited: number }>;
      };
      expect(balances.balances[addr(B)]).toMatchObject({ balance: 550, credited: 100 });
      const wrong = await mirror({
        trackers: [base],
        out: mkdtempSync(join(tmpdir(), 'bitquilt-mirror-credit-wrong-')),
        now,
        fetchImpl: fetchWith(null),
        chain: chainOf(99),
      });
      expect(wrong.refused).toEqual([
        `coin: the credit for deposit 1 (100 to ${addr(B)}) is not what the chain holds, at head 2 from ${base}`,
      ]);
      expect(wrong.coin).toMatchObject({ reproduced: false, credits: 1 });
    });

    it('with no chain to ask, keeps the problems and the coin log, refuses nothing, and leaves the balances out with a line that says why', async () => {
      const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-credit-blind-'));
      const blind = await mirror({ trackers: [base], out, now, fetchImpl: fetchWith(null) });
      expect(blind.refused).toEqual([]);
      expect(blind.errors).toEqual([]);
      expect(blind.coin).toEqual({
        lines: 2,
        added: 2,
        head: 2,
        reproduced: null,
        credits: 0,
        notKept: `the balances at head 2 from ${base} are not kept: 1 credit on the ledger and no chain to check it against`,
      });
      expect(existsSync(join(out, 'coin', 'balances.json'))).toBe(false);
      const coinLines = readFileSync(join(out, 'ledger', 'coin.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean);
      expect(coinLines.map((l) => (JSON.parse(l) as Receipt).event.type)).toEqual(['lock', 'credit']);
      for (const h of [P, Q]) {
        expect(existsSync(join(out, 'problems', `${h}.json`))).toBe(true);
        expect(existsSync(join(out, 'ledger', `${h}.jsonl`))).toBe(true);
      }
      const index = JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')) as { problems: { hash: Hash }[] };
      expect(index.problems.map((p) => p.hash).sort()).toEqual([P, Q].sort());
    });

    it('with no chain to ask, still refuses balances that do not reproduce', async () => {
      const doctor = (state: Record<string, unknown>) => {
        const balances = state.balances as Record<string, { balance: number }>;
        balances[addr(A)] = { ...balances[addr(A)]!, balance: balances[addr(A)]!.balance + 1 };
        return state;
      };
      const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-credit-blind-bad-'));
      const report = await mirror({ trackers: [base], out, now, fetchImpl: fetchWith(doctor) });
      expect(report.refused).toEqual([`coin: the balances at head 2 from ${base} do not reproduce here (${addr(A)})`]);
      expect(report.coin).toEqual({ lines: 2, added: 2, head: 2, reproduced: false, credits: 0 });
      expect(existsSync(join(out, 'coin', 'balances.json'))).toBe(false);
    });
  });
});

describe("the fold at the time the home's state names, with each read a trace names measured", () => {
  // A home of its own. A dispute on the piece the owner's gold names is decided there by setting aside the reading that
  // rests on nothing (QX-19 section 4), so the gold's match, and the coin it mints, rest on the read A's trace names.
  // Then a piece that asks a stake (QX-15 section 1) is squared by A, its stake backed by A's coin, and B, and A pays
  // into its problem after the square. When the square's window closes, the layer releases A's lock (QX-15 section 3)
  // and the problem is complete, so its escrow comes back to A (QX-17 section 3): the one at the layer's time, the
  // other at the time each problem is reduced at.
  let disputeServer: Server;
  let home: string;
  const disputed = envelope(owner, 'disputed');
  const D = problemHash(disputed);
  let d1: Hash;
  const staked = envelope(owner, 'staked');
  const W = problemHash(staked);
  const page = new TextEncoder().encode('The statement holds, as the record says.');
  const read = hashBytes(page);
  const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }]));
  const citesHash = hashBytes(cites);
  /** The owner's problem whose pieces read a data blob. */
  function citing(): Envelope {
    const problem: Envelope['problem'] = {
      title: 'Which source',
      done_when: 'Done.',
      owner: addr(owner),
      slug: 'which-source',
      prev: null,
      from: null,
      settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
      pieces: {
        'cite/*': {
          count: 1,
          verifier: 'agree',
          brief: 'Citation {n}: {cite.s}',
          data: { cite: 'cites.json' },
          schema: VERDICT,
          agree: ['verdict'],
        },
      },
      data: { 'cites.json': citesHash },
    };
    const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
    return { ...unsigned, sig: signObject(unsigned, owner) };
  }
  const run = (fetchImpl: typeof fetch) =>
    mirror({ trackers: [home], out: mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-dispute-')), now, fetchImpl });
  const stateAt = async (): Promise<State> => (await (await fetch(`${home}coin/state`)).json()) as State;

  beforeAll(async () => {
    ({ server: disputeServer, base: home } = await startTracker(now, { coin }));
    // Inside the second epoch, whose end mints the square's coin.
    tick = Date.parse(T0) + 24 * HOUR + 10 * 60_000;
    expect((await post('p', { envelope: elsewhere }, home)).status).toBe(201);
    const q1 = await pieceOf(Q, home);
    await returnOn(Q, q1, owner, 'anthropic/claude', home);
    await returnOn(Q, q1, B, 'openai/gpt', home);
    expect((await post('p', { envelope: disputed }, home)).status).toBe(201);
    d1 = await pieceOf(D, home);
    const projection = { verdict: 'supports' };
    const nonce = newNonce();
    await accepted(
      `p/${D}/events`,
      ev(owner, 'gold', { commitments: [commitHash({ piece: d1, projection }, nonce)], stake: 2 }, D),
      home,
    );
    const supports = await returnOn(D, d1, A, 'anthropic/claude', home);
    await returnOn(D, d1, B, 'openai/gpt', home, 'contradicts');
    expect((await fetch(`${home}b/${read}`, { method: 'PUT', body: page })).status).toBe(202);
    const reads = [{ url: 'https://example.org/statement', hash: read, at: T0, media: 'text/plain' }];
    const rests = [{ field: 'verdict', read: 0, span: [0, 13] }];
    await accepted(`p/${D}/events`, ev(A, 'trace', { reveal: supports, reads, rests }, D, d1), home);
    // B's reading rests on nothing and is set aside, so B reads again, agrees, and the gold's reveal matches.
    await returnOn(D, d1, B, 'openai/gpt', home);
    await accepted(`p/${D}/events`, ev(owner, 'gold_reveal', { projection, nonce }, D, d1), home);
    // The epoch's end, and the staked piece squared, A's stake bound to A's coin lock; then A's pay, made after the
    // square and so held for the problem's completion.
    tick = Date.parse(T0) + 48 * HOUR;
    expect((await post('p', { envelope: staked }, home)).status).toBe(201);
    const w1 = await pieceOf(W, home);
    await accepted(`p/${W}/events`, ev(owner, 'stake_rule', { min: 1 }, W), home);
    const coinLock = await accepted('coin/events', ev(A, 'lock', { problem: W, piece: w1, amount: 100 }), home);
    await accepted(`p/${W}/events`, ev(A, 'lock', { kind: 'coin', amount: 1, id: coinLock }, W, w1), home);
    await accepted(`p/${W}/events`, ev(B, 'lock', { kind: 'standing', amount: 1 }, W, w1), home);
    await returnOn(W, w1, A, 'anthropic/claude', home);
    await returnOn(W, w1, B, 'openai/gpt', home);
    await accepted('coin/events', ev(A, 'pay', { problem: W, amount: 100, per_square: 50 }), home);
  });
  afterAll(async () => {
    await new Promise<void>((r) => disputeServer.close(() => r()));
  });

  it('measures each read a trace names, so the reading the home set aside is set aside in the fold', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-measured-'));
    const report = await mirror({ trackers: [home], out, now, fetchImpl: fetchWith(null) });
    expect(report.refused).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.coin).toEqual({ lines: 2, added: 2, head: 2, reproduced: true, credits: 0 });
    const kept = balancesIn(out);
    expect(kept.balances[addr(A)]).toMatchObject({ balance: 450, locked: 100, escrowed: 100 });
    expect(kept.balances[addr(B)]).toMatchObject({ balance: 450 });
    // Measured, the fold is the home's; measuring no read, the dispute stands, the gold's reveal finds no accepted
    // piece, and the epoch mints nothing.
    const state = await stateAt();
    expect(await balancesOver(home, state, { blobLength: (h) => (h === read ? page.length : null) })).toEqual(
      state.balances,
    );
    const unmeasured = await balancesOver(home, state);
    expect(unmeasured[addr(A)]).toBeUndefined();
    expect(unmeasured[addr(B)]).toBeUndefined();
  });

  it('folds the layer at the time the state says it was folded at, before a window closed, and not at its own', async () => {
    // The staked square was made by its last reveal, and its window closes two days on; the five seconds of the home's
    // clock that hold that moment start before it.
    const squared = (await servedLines(`${home}p/${W}/events`)).at(-1)!;
    const closes = Date.parse(squared.received[0]!.at) + 48 * HOUR;
    const before = Math.floor(closes / 5000) * 5000;
    expect(before).toBeLessThan(closes);
    // The home folds its layer before the window closes, keeps it while nothing is written, and answers its state from
    // it as the window closes.
    tick = before;
    expect((await fetch(home)).status).toBe(200);
    tick = closes;
    const state = await stateAt();
    expect(state.folded.at).toBe(new Date(before).toISOString());
    expect(state.at).toBe(new Date(closes).toISOString());
    expect(state.balances[addr(A)]).toMatchObject({ locked: 100, escrowed: 100 });
    const report = await run(fetchWith(null));
    expect(report.refused).toEqual([]);
    expect(report.coin).toMatchObject({ reproduced: true });
    // Folded at the state's own time, the lock is released, the problem is complete, its escrow is A's again, and A's
    // balance is not the home's.
    const atItsTime = await run(
      fetchWith((s) => ({ ...s, folded: { ...(s as unknown as State).folded, at: (s as unknown as State).at } })),
    );
    expect(atItsTime.refused).toEqual([`coin: the balances at head 2 from ${home} do not reproduce here (${addr(A)})`]);
  });

  it('refuses the balances where a read a trace names, or a data blob, is not served as named, whatever the mirror holds, naming its hash', async () => {
    const answering =
      (hash: Hash, status: number, body = '', doctor: Doctor | null = null): typeof fetch =>
      async (input, init) =>
        String(input) === `${home}b/${hash}` ? new Response(body, { status }) : fetchWith(doctor)(input, init);
    const noRead = await run(answering(read, 503));
    expect(noRead.refused).toEqual([`coin: the read ${read} of a trace on ${D} from ${home} cannot be read`]);
    expect(noRead.coin).toMatchObject({ reproduced: false });
    // The home took A's trace, so it held the read then, and a store keeps a blob for good: a 404 for that read is
    // refused, though the state is refolded without the read to match.
    const withoutRead: Doctor = async (s) => ({ ...s, balances: await balancesOver(home, s as unknown as State) });
    const denied = await run(answering(read, 404, '', withoutRead));
    expect(denied.refused).toEqual([
      `coin: the read ${read} of a trace on ${D} from ${home} is not served, and the home's fold rests on it`,
    ]);
    // The home's bytes are read whatever the mirror holds: other bytes under the read's hash are refused where the
    // mirror took the read in an earlier run.
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-other-bytes-'));
    expect((await mirror({ trackers: [home], out, now, fetchImpl: fetchWith(null) })).refused).toEqual([]);
    expect(new MirrorFiles(out).getBlob(read)).toEqual(page);
    const otherBytes = await mirror({ trackers: [home], out, now, fetchImpl: answering(read, 200, 'not the page') });
    expect(otherBytes.refused).toEqual([`coin: the read ${read} of a trace on ${D} from ${home} does not check`]);
    // A data blob is never absent: the core refuses a problem without one, so a home that lacks one cannot fold.
    const cited = citing();
    const C = problemHash(cited);
    const blobs = { [citesHash]: Buffer.from(cites).toString('base64') };
    expect((await post('p', { envelope: cited, blobs }, home)).status).toBe(201);
    const noBlob = await run(answering(citesHash, 503));
    expect(noBlob.refused).toEqual([
      `${C}: a blob from ${home} does not check`,
      `coin: the data blob ${citesHash} of ${C} from ${home} cannot be read`,
    ]);
    expect(noBlob.coin).toMatchObject({ reproduced: false });
    const lacksBlob = await run(answering(citesHash, 404));
    expect(lacksBlob.refused).toEqual([
      `${C}: a blob from ${home} does not check`,
      `coin: the data blob ${citesHash} of ${C} from ${home} is not served, and the home's fold rests on it`,
    ]);
  });
});

describe('a read the home does not hold', () => {
  // Two doors. The dispute of the describe above is decided at `there`, which holds the read A's trace names. The
  // coin's home keeps both problems, their envelopes and chains as `there` serves them, and not the read, as a node
  // with `work` beside `admit` keeps what its Quilt opens (NODE.md section 2), so no line the home wrote names the
  // read. Its fold measures the read as absent, so the dispute stands at the home and the epoch mints nothing for it;
  // the mirror's check leaves the read out as the home's fold does, whether or not the mirror holds it.
  let thereServer: Server;
  let homeServer: Server;
  let there: string;
  let home: string;
  let homeStore: Awaited<ReturnType<typeof startTracker>>['store'];
  const disputed = envelope(owner, 'kept-without-its-read');
  const D = problemHash(disputed);
  const page = new TextEncoder().encode('The statement holds, as the record shows.');
  const read = hashBytes(page);
  const run = (trackers: string[], fetchImpl: typeof fetch = fetchWith(null)) => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-absent-'));
    return mirror({ trackers, out, now, fetchImpl }).then((report) => ({ report, out }));
  };
  /** Real fetch, but the home's `/b/<read>` answers `status`, and its well-known publishes no url where asked. */
  const homeAnswering =
    (status: number, { noUrl = false } = {}): typeof fetch =>
    async (input, init) => {
      const url = String(input);
      if (url === `${home}b/${read}`) return new Response('', { status });
      if (noUrl && url === `${home}.well-known/quilt`) {
        const { url: _url, ...known } = (await (await fetch(input, init)).json()) as Record<string, unknown>;
        return new Response(JSON.stringify(known), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return fetchWith(null)(input, init);
    };
  const stateAt = async (): Promise<State> => (await (await fetch(`${home}coin/state`)).json()) as State;
  /** The home keeps a problem's envelope and chain as `there` serves them, as a node's `work` keeps what it opens. */
  async function keepFromThere(e: Envelope): Promise<void> {
    const h = problemHash(e);
    homeStore.putEnvelope(h, e, now());
    homeStore.appendLines(h, await servedLines(`${there}p/${h}/events`));
  }
  /** A's reveal on a problem's one piece at `at`, and A's trace over the read on it. */
  async function tracedAt(problem: Hash, at: string): Promise<void> {
    const piece = await pieceOf(problem, at);
    const reveal = await returnOn(problem, piece, A, 'anthropic/claude', at);
    const reads = [{ url: 'https://example.org/statement', hash: read, at: T0, media: 'text/plain' }];
    const rests = [{ field: 'verdict', read: 0, span: [0, 13] }];
    await accepted(`p/${problem}/events`, ev(A, 'trace', { reveal, reads, rests }, problem, piece), at);
  }

  beforeAll(async () => {
    ({ server: thereServer, base: there } = await startTracker(now, { url: 'http://there.test/' }));
    const started = await startTracker(now, { coin });
    ({ server: homeServer, base: home, store: homeStore } = started);
    tick = Date.parse(T0) + 24 * HOUR + 10 * 60_000;
    expect((await post('p', { envelope: elsewhere }, there)).status).toBe(201);
    const q1 = await pieceOf(Q, there);
    await returnOn(Q, q1, owner, 'anthropic/claude', there);
    await returnOn(Q, q1, B, 'openai/gpt', there);
    expect((await post('p', { envelope: disputed }, there)).status).toBe(201);
    const d1 = await pieceOf(D, there);
    const projection = { verdict: 'supports' };
    const nonce = newNonce();
    await accepted(
      `p/${D}/events`,
      ev(owner, 'gold', { commitments: [commitHash({ piece: d1, projection }, nonce)], stake: 2 }, D),
      there,
    );
    const supports = await returnOn(D, d1, A, 'anthropic/claude', there);
    await returnOn(D, d1, B, 'openai/gpt', there, 'contradicts');
    expect((await fetch(`${there}b/${read}`, { method: 'PUT', body: page })).status).toBe(202);
    const reads = [{ url: 'https://example.org/statement', hash: read, at: T0, media: 'text/plain' }];
    const rests = [{ field: 'verdict', read: 0, span: [0, 13] }];
    await accepted(`p/${D}/events`, ev(A, 'trace', { reveal: supports, reads, rests }, D, d1), there);
    await returnOn(D, d1, B, 'openai/gpt', there);
    await accepted(`p/${D}/events`, ev(owner, 'gold_reveal', { projection, nonce }, D, d1), there);
    for (const e of [elsewhere, disputed]) await keepFromThere(e);
    // The epoch's end.
    tick = Date.parse(T0) + 48 * HOUR + 60_000;
  });
  afterAll(async () => {
    await new Promise<void>((r) => thereServer.close(() => r()));
    await new Promise<void>((r) => homeServer.close(() => r()));
  });

  it("folds the read as absent where the home answers that it does not hold it, as the home's fold does", async () => {
    expect((await fetch(`${home}b/${read}`)).status).toBe(404);
    const kept = await servedLines(`${home}p/${D}/events`);
    expect(kept.flatMap((l) => l.received.map((w) => w.by))).not.toContain('http://t.test/');
    const state = await stateAt();
    // The read decides the coin: measured, A's square on the dispute is verified and the epoch pays A for it.
    expect(state.balances[addr(A)]).toBeUndefined();
    const measured = await balancesOver(home, state, { blobLength: (h) => (h === read ? page.length : null) });
    expect(measured[addr(A)]).toBeDefined();
    expect(await balancesOver(home, state)).toEqual(state.balances);
    // The mirror takes both problems from the home, which serves no read, and reproduces its balances.
    const alone = await run([home]);
    expect(alone.report.refused).toEqual([]);
    expect(alone.report.coin).toMatchObject({ reproduced: true });
    expect(balancesIn(alone.out).balances).toEqual(state.balances);
    // Taken from `there` first, the mirror holds the read, and still leaves it out of the home's fold.
    const both = await run([there, home]);
    expect(new MirrorFiles(both.out).getBlob(read)).toEqual(page);
    expect(both.report.refused).toEqual([]);
    expect(both.report.coin).toMatchObject({ reproduced: true });
    expect(balancesIn(both.out).balances).toEqual(state.balances);
    // A read the home may lack is still refused where the home cannot be asked for it, and no read may be absent where
    // the home's well-known names no url, since no line can then be told for one the home did not write.
    const failed = await run([home], homeAnswering(503));
    expect(failed.report.refused).toEqual([`coin: the read ${read} of a trace on ${D} from ${home} cannot be read`]);
    const noUrl = await run([home], homeAnswering(404, { noUrl: true }));
    expect(noUrl.report.refused).toEqual([
      `coin: the read ${read} of a trace on ${D} from ${home} is not served, and the home's fold rests on it`,
    ]);
  });

  it('names the problem whose line the home wrote where one read is named on a kept chain and on one the home took', async () => {
    // The home takes a trace over the read on a problem of its own, holding the read; then it keeps from `there` a
    // newer problem whose trace names the same read, which the layer, newest first, folds before the home's own.
    const taken = envelope(owner, 'taken-here');
    const E = problemHash(taken);
    expect((await post('p', { envelope: taken }, home)).status).toBe(201);
    expect((await fetch(`${home}b/${read}`, { method: 'PUT', body: page })).status).toBe(202);
    await tracedAt(E, home);
    const later = envelope(owner, 'kept-later');
    const F = problemHash(later);
    expect((await post('p', { envelope: later }, there)).status).toBe(201);
    await tracedAt(F, there);
    tick += 1000;
    await keepFromThere(later);
    const order = (await stateAt()).folded.problems.map((p) => p.problem);
    expect(order.indexOf(F)).toBeLessThan(order.indexOf(E));
    const denied = await run([home], homeAnswering(404));
    expect(denied.report.refused).toEqual([
      `coin: the read ${read} of a trace on ${E} from ${home} is not served, and the home's fold rests on it`,
    ]);
  });
});

describe('the state held to the chains the run read from the home', () => {
  // A home of its own, its coin's genesis at the start of its own day: two identity lines from keys that hold no coin,
  // the verified square on P and A's coin lock after the epoch's end.
  let heldServer: Server;
  let home: string;
  const start = Date.parse(T0) + 20 * 24 * HOUR;
  const params = { ...coin, genesis: new Date(start).toISOString() };
  const pEvents = () => `${home}p/${P}/events`;
  /**
   * The home, but each chain in `forks` is served as it is on the run's first read of it and as the fork on every
   * later read, and `/coin/state` is answered as `doctor` makes it; `reads` counts the reads of each chain.
   */
  function forking(forks: Map<string, Receipt[]>, doctor: Doctor | null, reads = new Map<string, number>()) {
    const inner = fetchWith(doctor);
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const path = String(input).split('?')[0]!;
      if (path.endsWith('/events')) reads.set(path, (reads.get(path) ?? 0) + 1);
      const fork = forks.get(path);
      if (fork && reads.get(path)! > 1)
        return new Response(fork.map((l) => `${JSON.stringify(l)}\n`).join(''), { status: 200 });
      return inner(input, init);
    }) as typeof fetch;
  }
  const run = (fetchImpl: typeof fetch, out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-held-'))) =>
    mirror({ trackers: [home], out, now, fetchImpl });
  /** A chain's lines chained again from its log's hash, each with the event and the wrappers `edit` gives it. */
  function rechained(lines: Receipt[], genesis: Hash, edit: (l: Receipt) => Pick<Receipt, 'event' | 'received'>) {
    const out: Receipt[] = [];
    for (const l of lines) out.push(nextLine(out, genesis, edit(l)));
    return out;
  }
  /** B's reveal on P, by its place on P's chain. */
  const isBsReveal = (l: Receipt) => l.event.type === 'reveal' && l.event.key === addr(B);
  /** P's chain as the home serves it, with B's reveal received after the epoch's end, which needs no one's key. */
  async function laterReveal(): Promise<Receipt[]> {
    const after = new Date(start + 24 * HOUR + 500).toISOString();
    return rechained(await servedLines(pEvents()), P, (l) => ({
      event: l.event,
      received: isBsReveal(l) ? [{ ...l.received[0]!, at: after }] : l.received,
    }));
  }
  /** The state, but naming the last line of each fork as its chain's head, with its balances refolded over them. */
  async function naming(state: Record<string, unknown>, forks: Map<string, Receipt[]>): Promise<State> {
    const s = state as unknown as State;
    const headOf = (url: string, head: Head): Head => {
      const last = forks.get(url)?.at(-1);
      return last ? { seq: last.seq!, hash: last.hash! } : head;
    };
    const named: State = {
      ...s,
      head: headOf(`${home}coin/events`, s.head),
      folded: {
        ...s.folded,
        identity: headOf(`${home}k/events`, s.folded.identity),
        problems: s.folded.problems.map((x) => ({
          problem: x.problem,
          head: headOf(`${home}p/${x.problem}/events`, x.head),
        })),
      },
    };
    return { ...named, balances: await balancesOver(home, named, { forks, params }) };
  }
  const output = () => ev(B, 'output', { hash: hashBytes(new TextEncoder().encode('an output')) }, P);

  beforeAll(async () => {
    ({ server: heldServer, base: home } = await startTracker(now, { coin: params }));
    tick = start + HOUR;
    for (const [from, to] of [
      [30, 31],
      [32, 33],
    ] as const)
      await accepted(
        'k/events',
        ev(key(from), 'delegate', { to: addr(key(to)), scope: ['claim'], expires: '2027-01-01T00:00:00Z' }),
        home,
      );
    await verifiedAt(home);
    tick = start + 24 * HOUR + 1000;
    await accepted('coin/events', ev(A, 'lock', { problem: P, piece: p1, amount: 100 }), home);
  });
  afterAll(async () => {
    await new Promise<void>((r) => heldServer.close(() => r()));
  });

  it('refuses a head within the lines the run read that is not on them, with no second read, though the state is refolded over its fork', async () => {
    const honest = await run(fetchWith(null));
    expect(honest.refused).toEqual([]);
    expect(honest.coin).toEqual({ lines: 1, added: 1, head: 1, reproduced: true, credits: 0 });
    const truth = (await (await fetch(`${home}coin/state`)).json()) as State;
    expect(truth.balances[addr(A)]).toMatchObject({ balance: 450, locked: 100 });
    // The coin log with its one line another lock of A's, of 50.
    const lock = ev(A, 'lock', { problem: P, piece: p1, amount: 50 });
    const coinFork = new Map([
      [
        `${home}coin/events`,
        rechained(await servedLines(`${home}coin/events`), COIN_LOG, (l) => ({ ...l, event: lock })),
      ],
    ]);
    const doctored: State[] = [];
    const reads = new Map<string, number>();
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-held-fork-'));
    const forkedCoin = await run(
      forking(coinFork, async (s) => doctored[doctored.push(await naming(s, coinFork)) - 1]!, reads),
      out,
    );
    expect(doctored[0]!.balances[addr(A)]).toMatchObject({ balance: 450, locked: 50 });
    expect(forkedCoin.refused).toEqual([
      `coin: the coin log from ${home} has no line 1 with the hash the coin state names`,
    ]);
    expect(forkedCoin.coin).toMatchObject({ reproduced: false });
    expect(reads.get(`${home}coin/events`)).toBe(1);
    expect(existsSync(join(out, 'coin', 'balances.json'))).toBe(false);
    const kept = readFileSync(join(out, 'ledger', 'coin.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean);
    expect(kept.map((l) => (JSON.parse(l) as Receipt).event.body.amount)).toEqual([100]);
    // P's chain with B's reveal received after the epoch's end: the square falls in an epoch that has not ended.
    const later = await laterReveal();
    const pFork = new Map([[pEvents(), later]]);
    const pReads = new Map<string, number>();
    const forkedP = await run(
      forking(pFork, async (s) => doctored[doctored.push(await naming(s, pFork)) - 1]!, pReads),
    );
    expect(doctored[1]!.balances).not.toEqual(truth.balances);
    expect(doctored[1]!.balances[addr(A)]).toBeUndefined();
    expect(forkedP.refused).toEqual([
      `coin: the chain of ${P} from ${home} has no line ${later.length} with the hash the coin state names`,
    ]);
    expect(pReads.get(pEvents())).toBe(1);
  });

  it('refuses a head past the lines the run read on a chain that does not extend them, or does not verify', async () => {
    const lines = await servedLines(pEvents());
    const at = new Date(Date.parse(lines.at(-1)!.received[0]!.at) + 1000).toISOString();
    const by = lines[0]!.received[0]!.by;
    // P's chain one line longer as the check reads it again, with B's reveal received after the epoch's end.
    const later = await laterReveal();
    const extend = new Map([[pEvents(), [...later, nextLine(later, P, { event: output(), received: [{ by, at }] })]]]);
    const reads = new Map<string, number>();
    const forked = await run(forking(extend, (s) => naming(s, extend), reads));
    expect(forked.refused).toEqual([
      `coin: the chain of ${P} from ${home} served to the check does not extend what this run read: line ${lines.findIndex(isBsReveal) + 1} changed`,
    ]);
    expect(forked.coin).toMatchObject({ reproduced: false });
    expect(reads.get(pEvents())).toBe(2);
    // P's chain one line longer as the check reads it again, that line's wrapper changed after its hash was taken.
    const extra = nextLine(lines, P, { event: output(), received: [{ by, at }] });
    const broken = [...lines, { ...extra, received: [{ by, at: new Date(Date.parse(at) + 1000).toISOString() }] }];
    const breaks = new Map([[pEvents(), broken]]);
    const doctored: State[] = [];
    const unverified = await run(forking(breaks, async (s) => doctored[doctored.push(await naming(s, breaks)) - 1]!));
    const truth = (await (await fetch(`${home}coin/state`)).json()) as State;
    expect(doctored[0]!.folded.problems.find((x) => x.problem === P)!.head).toEqual({
      seq: extra.seq,
      hash: extra.hash,
    });
    expect(doctored[0]!.balances).toEqual(truth.balances);
    expect(unverified.refused).toEqual([
      `coin: the chain of ${P} from ${home} does not verify: ${verifyChain(broken, P).problems[0]}`,
    ]);
    expect(unverified.coin).toMatchObject({ reproduced: false });
  });

  it('refuses a state that names the identity log below the lines read, or off them', async () => {
    const identity = await servedLines(`${home}k/events`);
    expect(identity).toHaveLength(2);
    const below = await run(
      fetchWith(async (state) => {
        const s = state as unknown as State;
        const named = { ...s, folded: { ...s.folded, identity: { seq: 1, hash: identity[0]!.hash! } } };
        return { ...named, balances: await balancesOver(home, named, { params }) };
      }),
    );
    expect(below.refused).toEqual([
      `coin: the identity log from ${home} was read to line 2 this run, and the coin state names line 1`,
    ]);
    expect(below.coin).toMatchObject({ reproduced: false });
    // The identity log with its second line received a second later, served to every later read.
    const fork = new Map([
      [
        `${home}k/events`,
        rechained(identity, IDENTITY_LOG, (l) => ({
          event: l.event,
          received:
            l.seq === 2
              ? [{ ...l.received[0]!, at: new Date(Date.parse(l.received[0]!.at) + 1000).toISOString() }]
              : l.received,
        })),
      ],
    ]);
    const off = await run(forking(fork, (s) => naming(s, fork)));
    expect(off.refused).toEqual([
      `coin: the identity log from ${home} has no line 2 with the hash the coin state names`,
    ]);
    expect(off.coin).toMatchObject({ reproduced: false });
  });

  it('reproduces the balances of a home that took an event on P and one on the coin log after the run read P', async () => {
    const read = (await servedLines(pEvents())).length;
    const reads = new Map<string, number>();
    let grown = false;
    const growing: typeof fetch = async (input, init) => {
      if (String(input) === `${home}coin/state` && !grown) {
        grown = true;
        await accepted(`p/${P}/events`, output(), home);
        await accepted('coin/events', ev(B, 'lock', { problem: P, piece: p1, amount: 10 }), home);
      }
      return forking(new Map(), null, reads)(input, init);
    };
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-held-grown-'));
    const report = await run(growing, out);
    expect(grown).toBe(true);
    expect(report.refused).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.coin).toEqual({ lines: 2, added: 2, head: 2, reproduced: true, credits: 0 });
    // P was read before the state and again for the head the state names past it.
    const state = (await (await fetch(`${home}coin/state`)).json()) as State;
    expect(state.folded.problems.find((x) => x.problem === P)!.head!.seq).toBe(read + 1);
    expect(reads.get(pEvents())).toBe(2);
    const kept = balancesIn(out);
    expect(kept.balances).toEqual(state.balances);
    expect(kept.balances[addr(B)]).toMatchObject({ balance: 450, locked: 10 });
  });
});

describe('a problem the home holds and the core refuses', () => {
  // The coin's home holds, beside a problem it lists and one it has taken down, both of which it folds, three the core
  // refuses (CORE.md section 6), as a store can that a node with `work` beside `admit` kept in before it kept a problem
  // only with its data: one without the data blob it names, one not its owner's, and one whose data blob its pieces
  // cannot be read from. Its state names the three among the refused (QX-17 section 6). The mirror took the last with
  // its blob in an earlier run, so it reads that one's chain from the home this run; it folds all five as the home
  // serves them, refuses the same three, and keeps the balances. A state that names a refused one as folded, a folded
  // one as refused, one it listed as refused, or leaves out one it served, is refused; and so is one whose refused
  // problem lacks a data blob the mirror holds, since a home that withholds the blob and one that lacks it look the
  // same.
  let homeServer: Server;
  let home: string;
  const encode = (text: string) => new TextEncoder().encode(text);
  const cites = encode(JSON.stringify([{ s: 'one' }]));
  const others = encode(JSON.stringify([{ s: 'two' }]));
  const notAList = encode('not a list');
  /** A problem whose one piece reads `bytes`, signed by `signer`, its owner's key unless a test says otherwise. */
  function withData(slug: string, bytes: Uint8Array, signer = owner): Envelope {
    const problem: Envelope['problem'] = {
      title: `Which source (${slug})`,
      done_when: 'Done.',
      owner: addr(owner),
      slug,
      prev: null,
      from: null,
      settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
      pieces: {
        'cite/*': {
          count: 1,
          verifier: 'agree',
          brief: 'Citation {n}: {cite.s}',
          data: { cite: 'cites.json' },
          schema: VERDICT,
          agree: ['verdict'],
        },
      },
      data: { 'cites.json': hashBytes(bytes) },
    };
    const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
    return { ...unsigned, sig: signObject(unsigned, signer) };
  }
  const folds = envelope(owner, 'folds-at-the-home');
  const F = problemHash(folds);
  const hidden = envelope(owner, 'taken-down-at-the-home');
  const G = problemHash(hidden);
  const withoutData = withData('without-its-data', cites);
  const X = problemHash(withoutData);
  const notOwners = withData('not-its-owners', others, B);
  const U = problemHash(notOwners);
  const unreadable = withData('not-a-list', notAList);
  const Y = problemHash(unreadable);
  /**
   * A run over the home into a folder that holds Y and its blob, as an earlier run that took Y left it; and X's blob
   * too where `x` is 'blob', as a run that took another problem naming the same blob would, or X and its blob where
   * `x` is 'problem', as a run that took X from another door would.
   */
  const run = (doctor: Doctor | null = null, x: 'none' | 'blob' | 'problem' = 'none') => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-refused-'));
    const files = new MirrorFiles(out);
    files.putBlob(hashBytes(notAList), notAList);
    files.putEnvelope(Y, unreadable);
    if (x !== 'none') files.putBlob(hashBytes(cites), cites);
    if (x === 'problem') files.putEnvelope(X, withoutData);
    return mirror({ trackers: [home], out, now, fetchImpl: fetchWith(doctor) });
  };
  type Named = { problem: Hash; head: Head };
  type Folded = { problems: Named[]; refused: Named[] };
  /** The state with one problem moved from one of its lists to the other, or dropped where `to` is null. */
  const moved =
    (problem: Hash, to: 'problems' | 'refused' | null): Doctor =>
    (s) => {
      const f = s.folded as Folded;
      const entry = [...f.problems, ...f.refused].find((x) => x.problem === problem)!;
      const without = (list: Named[]) => list.filter((x) => x.problem !== problem);
      const folded = { ...f, problems: without(f.problems), refused: without(f.refused) };
      if (to) folded[to] = [...folded[to], entry];
      return { ...s, folded };
    };

  beforeAll(async () => {
    const started = await startTracker(now, { coin, maintainers: [addr(maintainer)] });
    ({ server: homeServer, base: home } = started);
    expect((await post('p', { envelope: folds }, home)).status).toBe(201);
    expect((await post('p', { envelope: hidden }, home)).status).toBe(201);
    await accepted('k/events', ev(maintainer, 'hide', { id: G, why: 'Taken down here.' }), home);
    started.store.putEnvelope(X, withoutData, now());
    started.store.putBlob(hashBytes(others), others);
    started.store.putEnvelope(U, notOwners, now());
    started.store.putBlob(hashBytes(notAList), notAList);
    started.store.putEnvelope(Y, unreadable, now());
  });
  afterAll(async () => {
    await new Promise<void>((r) => homeServer.close(() => r()));
  });

  it('names the three among the refused, and the mirror refuses the same three and keeps the balances', async () => {
    const state = (await (await fetch(`${home}coin/state`)).json()) as { folded: Folded };
    expect(state.folded.problems.map((x) => x.problem).sort()).toEqual([F, G].sort());
    expect(state.folded.refused.map((x) => x.problem).sort()).toEqual([X, U, Y].sort());
    const report = await run();
    expect(report.refused).toEqual([]);
    expect(report.coin).toMatchObject({ reproduced: true });
  });

  it('refuses a state that names a refused problem as folded, a folded one as refused or listed, or leaves out one it served', async () => {
    const asFolded = await run(moved(Y, 'problems'));
    expect(asFolded.refused).toHaveLength(1);
    expect(asFolded.refused[0]).toMatch(
      new RegExp(`^coin: the coin state names ${Y} as folded, and the core refuses it here: .+, from `),
    );
    const asRefused = await run(moved(G, 'refused'));
    expect(asRefused.refused).toEqual([
      `coin: the coin state names ${G} as refused, and the core folds it here, from ${home}`,
    ]);
    const listed = await run(moved(F, 'refused'));
    expect(listed.refused).toEqual([
      `coin: the coin state from ${home} names ${F} as refused, which it listed this run`,
    ]);
    const leftOut = await run(moved(Y, null));
    expect(leftOut.refused).toEqual([`coin: the coin state from ${home} does not name ${Y}, which it served this run`]);
    // A problem the state calls folded cannot lack its data: the home folds none without it.
    const lacking = await run(moved(X, 'problems'));
    expect(lacking.refused).toEqual([
      `coin: the data blob ${hashBytes(cites)} of ${X} from ${home} is not served, and the home's fold rests on it`,
    ]);
  });

  it('refuses a state whose refused problem lacks a data blob the mirror holds, or folds over what the mirror holds', async () => {
    const blob = await run(null, 'blob');
    expect(blob.refused).toEqual([
      `coin: the data blob ${hashBytes(cites)} of ${X} from ${home} is not served, and this mirror holds it`,
    ]);
    expect(blob.coin).toMatchObject({ reproduced: false });
    const problem = await run(null, 'problem');
    expect(problem.refused).toEqual([
      `coin: the coin state from ${home} names ${X} as refused, and it folds over what this mirror holds`,
    ]);
  });
});

describe('an earlier version the home adds that the core refuses', () => {
  // A home lists a version P whose earlier version Q it does not hold, so P folds alone, and the mirror takes P. Then
  // the home puts in its store Q, signed by P's owner, whose data blob its pieces cannot be read from: no line on any
  // chain changes, and the core refuses P's input with Q in it (CORE.md section 6), so the home's fold leaves P out and
  // its state names P and Q among the refused. The mirror holds P, which folds over what it holds, so the state is
  // refused: an earlier version the home adds does not take with it the later one the mirror took.
  let homeServer: Server;
  let home: string;
  const notAList = new TextEncoder().encode('not a list');
  function version(slug: string, prev: Hash | null, data: Record<string, Hash>): Envelope {
    const plain = envelope(owner, slug);
    const problem: Envelope['problem'] = {
      ...plain.problem,
      prev,
      data,
      pieces:
        Object.keys(data).length === 0
          ? plain.problem.pieces
          : {
              'cite/*': {
                count: 1,
                verifier: 'agree',
                brief: 'Citation {n}: {cite.s}',
                data: { cite: 'cites.json' },
                schema: VERDICT,
                agree: ['verdict'],
              },
            },
    };
    const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
    return { ...unsigned, sig: signObject(unsigned, owner) };
  }
  const earlier = version('the-earlier', null, { 'cites.json': hashBytes(notAList) });
  const Qe = problemHash(earlier);
  const later = version('the-later', Qe, {});
  const Pl = problemHash(later);
  let homeStore: Awaited<ReturnType<typeof startTracker>>['store'];

  beforeAll(async () => {
    ({ server: homeServer, base: home, store: homeStore } = await startTracker(now, { coin }));
    homeStore.putEnvelope(Pl, later, now());
  });
  afterAll(async () => {
    await new Promise<void>((r) => homeServer.close(() => r()));
  });

  it('refuses a state that names as refused a later version the mirror took, once the home adds the earlier', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-earlier-'));
    const first = await mirror({ trackers: [home], out, now, fetchImpl: fetchWith(null) });
    expect(first.refused).toEqual([]);
    expect(first.problems.map((p) => p.hash)).toEqual([Pl]);
    homeStore.putBlob(hashBytes(notAList), notAList);
    homeStore.putEnvelope(Qe, earlier, now());
    const state = (await (await fetch(`${home}coin/state`)).json()) as { folded: { refused: { problem: Hash }[] } };
    expect(state.folded.refused.map((x) => x.problem).sort()).toEqual([Pl, Qe].sort());
    const second = await mirror({ trackers: [home], out, now, fetchImpl: fetchWith(null) });
    expect(second.refused).toEqual([
      `coin: the coin state from ${home} names ${Pl} as refused, and it folds over what this mirror holds`,
    ]);
    expect(second.coin).toMatchObject({ reproduced: false });
  });
});

describe('the documents on the coin at the mirror', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const read = (...path: string[]): string => readFileSync(join(root, ...path), 'utf8').replace(/\r\n/g, '\n');
  /** The paragraphs under the heading `title`. */
  function paragraphs(doc: string, title: string): string[] {
    const start = doc.indexOf(`\n## ${title}\n`);
    expect(start, title).toBeGreaterThan(-1);
    return doc
      .slice(start + 1)
      .split('\n## ')[0]!
      .split('\n\n');
  }
  /** The sentences of a paragraph that opens with `opening`, under the heading `title`. */
  function sentences(doc: string, title: string, opening: string): string[] {
    const paragraph = paragraphs(doc, title).find((p) => p.startsWith(opening));
    expect(paragraph, opening).toBeDefined();
    return paragraph!.split(/(?<=\.) (?=[A-Z`])/);
  }

  it('say the reason is given where the balances reproduce, and the credits refuse nothing', () => {
    const node = read('docs', 'NODE.md');
    const coin = sentences(node, '6. The mirror job', "**The coin's balances.**");
    expect(coin).toContain('With no chain to ask, credits on the ledger are no refusal of their own.');
    const notKept = coin.find((s) => s.includes('(`notKept`)'));
    expect(notKept).toMatch(/^Where the balances reproduce, /);
    expect(notKept).toContain('a run that refuses nothing else still commits the coin log');
    expect(coin.find((s) => s.startsWith('A `/coin/state` that cannot be read'))).toContain('no reason is given');
    const binary = sentences(node, '6. The mirror job', '**The binary.**');
    expect(binary.find((s) => s.includes('`coin:` line'))).toContain(
      'Where the coin log holds a credit and the balances reproduce',
    );
    const job = sentences(node, '6. The mirror job', "**The repository's job.**");
    expect(job.find((s) => s.includes('commits the coin log'))).toContain('a run that refuses nothing else');
    const protocol = sentences(read('docs', 'PROTOCOL.md'), 'The mirror', 'The ledger job');
    const blind = protocol.find((s) => s.includes('no chain to check them against'))!;
    expect(blind).toContain('no refusal of its own');
    expect(blind).toContain('a run that refuses nothing else');
    expect(blind).toContain('a line that says why where they reproduce');
  });

  it("say the check folds the home's chains as it serves them, cut at the heads its state names", () => {
    const coin = sentences(read('docs', 'NODE.md'), '6. The mirror job', "**The coin's balances.**");
    expect(coin).toContain(
      "It folds what the state says the balances were folded over (QX-17 section 6): each problem the home folded, in the home's order, with its chain's head, each problem the home says the core refuses, with its chain's head, the identity log's head and the coin log's, and the time the home's layer was folded at.",
    );
    expect(coin).toContain("So the fold is the home's own and not the mirror's.");
    expect(coin).toContain(
      'A problem the home folded is folded here whether or not the mirror took it, hidden and replaced ones among them, since the home serves every problem it holds by hash, a hidden one too (QX-6 section 3).',
    );
    expect(coin).toContain('Nothing another source gave the mirror is in it.');
    const held = coin.find((s) => s.startsWith('The state is held to what the run already had from the home'));
    expect(held).toContain(
      'it names every problem the home listed or served that run, since the home names every problem it holds',
    );
    expect(held).toContain(
      'at a head no earlier than the lines read and on those lines or on a chain that extends them',
    );
    expect(coin.find((s) => s.startsWith('Each of those chains is the home'))).toContain(
      'a chain this run already read from the home is cut from the lines it read where they reach the head, with no second read, and read again only for a head past them, where what is read again must hold every line read before as it was read (`servedTo`)',
    );
    expect(
      coin.find((s) => s.startsWith('A state that is not what the run already had from the home is refused')),
    ).toContain(
      'and an envelope, a data blob or a read the fold rests on that is not served as named, each with its chain or its hash named',
    );
    expect(coin).toContain(
      'A door alone holds every data blob, since it takes no problem without them, and every read a trace on its chains names, since it takes no trace whose read it lacks.',
    );
    const lacked = coin.find((s) => s.startsWith('So a read the home answers `404` for is left out here too'));
    expect(lacked).toContain('whatever the mirror holds, where no line the home wrote names it');
    expect(lacked).toContain('the home held the read of a trace it took, since a store keeps a blob for good');
    const differ = coin.find((s) => s.startsWith('Two things can still make them differ'));
    expect(differ).toContain('a home restarted with other parameters or another founding standing');
    expect(differ).toContain("a read a home with `work` took between its state and the mirror's asking");
    expect(coin.join(' ')).not.toContain('in three ways');
    expect(coin.join(' ')).not.toContain('A head that moved');
    expect(coin.join(' ')).not.toContain('could not fetch');
    const qx17 = read('docs', 'ext', 'QX-17.md');
    const route = paragraphs(qx17, '6. The reference tracker')
      .join('\n')
      .split('\n')
      .find((l) => l.startsWith('- `GET /coin/state`'))!;
    expect(route).toContain('with `folded`, what the balances were folded over');
    expect(route).toContain('`problems`, each problem the layer folded, every one the tracker holds');
    expect(route).toContain("`identity`, the identity log's head");
    expect(route).toContain("a hidden problem's (QX-6 section 3) and a replaced one's among them");
    expect(route).toContain('the fold measures a read it lacks as absent, for which `/b/<hash>` answers `404`');
    expect(route).toContain(
      "computes the coin at its clock's time held to `folded.at` and the five seconds after it, however long the fold took",
    );
    const mirrored = sentences(qx17, '7. The mirror', 'The mirror pulls the coin log');
    expect(mirrored).toContain(
      "It folds the tracker's chains and not its own, since its own lines carry its own hashes and would draw other panels (QX-1 section 4).",
    );
    expect(mirrored.find((s) => s.startsWith('It reads `/coin/state` after the tracker'))).toContain(
      'and before the coin log, so the log it takes holds every line the state names',
    );
    const agree = mirrored.find((s) => s.startsWith('The state must agree with what the mirror already read'));
    expect(agree).toContain('it was folded at its own `at` or up to five seconds before it');
    expect(agree).toContain(
      'at a head no earlier than the lines read and on those lines or on a chain that extends them',
    );
    const computes = mirrored.find((s) => s.startsWith('The mirror then computes the layer itself'));
    expect(computes).toContain(
      "as the tracker serves it, read whole, verified from its log's hash and cut at the named head",
    );
    const protocol = sentences(read('docs', 'PROTOCOL.md'), 'The mirror', 'The ledger job');
    const checked = protocol.findIndex((s) => s.startsWith("The coin's balances are checked over"));
    expect(protocol[checked]).toContain(
      "the home's own chains as the home serves them, cut at the heads its `/coin/state` names",
    );
    // After the refused run and what it costs `main`, not between them.
    expect(protocol[checked - 1]).toBe(
      '`main` then gains nothing from that run, and while the refusal recurs it grows no further.',
    );
  });
});
