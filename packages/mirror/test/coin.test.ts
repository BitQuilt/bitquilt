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
  newNonce,
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
 * cut at the heads the state names, with the parameters the tracker publishes, and not over the mirror's own chains.
 * So a problem the tracker hides, which its index leaves out and no run of the mirror took, is folded all the same, and
 * an identity event another source gave the mirror and the tracker lacks moves nothing, where folding the mirror's own
 * chains would give another root the coin. A chain the state names that cannot be read whole, or has no line with the
 * named hash, is refused with the chain named, and a tracker whose balances differ is refused (NODE.md section 6);
 * and every credit line on the coin log (the way back) is checked against the deposit the chain holds, and the
 * balances refused where one is not what the chain holds. With no chain to ask, the balances are not kept and the
 * credits alone refuse nothing (AGENTS.md, rule 10): the problems and the coin log are kept, and where the balances
 * reproduce the report says why; balances that do not reproduce are refused all the same.
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
/** Real fetch, with a calendar that answers and, when asked, a doctored /coin/state. */
function fetchWith(doctor: ((body: Record<string, unknown>) => Record<string, unknown>) | null): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://cal.test')) return new Response(calendarBytes, { status: 200 });
    const r = await fetch(input, init);
    if (doctor && url.endsWith('/coin/state'))
      return new Response(JSON.stringify(doctor((await r.json()) as Record<string, unknown>)), {
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
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string, at = base) {
  const ret = { verdict: 'supports' };
  const nonce = newNonce();
  await accepted(`p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece), at);
  await accepted(`p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece), at);
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
      "It folds what the state says the balances were folded over (QX-17 section 6): each problem the home folded, in the home's order, with its chain's head, the identity log's head and the coin log's, and the time the home's layer was folded at.",
    );
    expect(coin).toContain("So the fold is the home's own and not the mirror's.");
    expect(coin).toContain(
      'A problem the home holds is folded whether or not the mirror took it, hidden and replaced ones among them, which the home still serves by hash (QX-6 section 3).',
    );
    expect(coin).toContain('Nothing another source gave the mirror is in it.');
    expect(coin.find((s) => s.startsWith('A chain the state names that cannot be read whole'))).toContain(
      'is refused with the chain named',
    );
    expect(coin.join(' ')).not.toContain('in three ways');
    expect(coin.join(' ')).not.toContain('A head that moved');
    const qx17 = read('docs', 'ext', 'QX-17.md');
    const route = paragraphs(qx17, '6. The reference tracker')
      .join('\n')
      .split('\n')
      .find((l) => l.startsWith('- `GET /coin/state`'))!;
    expect(route).toContain('with `folded`, what the balances were folded over');
    expect(route).toContain('`problems`, each problem the layer folded, every one the tracker holds');
    expect(route).toContain("`identity`, the identity log's head");
    const mirrored = sentences(qx17, '7. The mirror', 'The mirror pulls the coin log');
    expect(mirrored).toContain(
      "It folds the tracker's chains and not its own, since its own lines carry its own hashes and would draw other panels (QX-1 section 4).",
    );
    expect(mirrored.find((s) => s.startsWith('It reads `/coin/state` before the coin log'))).toContain(
      "as the tracker serves it, read whole, verified from its log's hash and cut at the named head",
    );
    const protocol = sentences(read('docs', 'PROTOCOL.md'), 'The mirror', 'The ledger job');
    expect(protocol.find((s) => s.startsWith('The balances are checked over'))).toContain(
      "the home's own chains as the home serves them, cut at the heads its `/coin/state` names",
    );
  });
});
