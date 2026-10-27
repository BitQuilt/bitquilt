import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, type Receipt, type Unsigned, addressOf, commitHash, newNonce, problemHash, signEvent, signObject, verifyChain } from '@bitquilt/core';
import { COIN_LOG, Store, createTracker } from '@bitquilt/tracker';
import { mirror } from '../src/mirror.js';

/**
 * The coin at the mirror (QX-17 section 7): the coin log is pulled, verified from the coin log's hash and anchored
 * beside the problems'; the balances the tracker says it computed are kept only where the mirror reproduces them from
 * the receipts it holds and the parameters the tracker publishes; a tracker whose balances differ is refused; and every
 * credit line on the coin log (the way back) is checked against the deposit the chain holds, or the balances are refused.
 */
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const owner = key(9), A = key(1), B = key(2), treasury = key(7), reader = key(5);
const addr = addressOf;
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } };

function envelope(by: Uint8Array = owner, slug = 'statement'): Envelope {
  const problem: Envelope['problem'] = {
    title: `A statement (${slug})`, done_when: 'Done.', owner: addr(by), slug, prev: null, from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
    pieces: { 'statement/*': { count: 1, verifier: 'agree', requires: ['web'], brief: 'Statement {n}.', schema, agree: ['verdict'] } },
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
  genesis: T0, epoch_h: 24, emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 }, vesting_h: 48, infra_bp: 1000, treasury: addr(treasury), unit: 1000,
  weights: { cross_vendor: 2, same_vendor: 1, attest: 0 }, burn_rate: 100, transfers_from: null, redeem_from: null, reader: addr(reader),
};
const calendarBytes = new Uint8Array([0xf0, 0x10, 0x01, 0x02, 0x03, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e]);
/** Real fetch, with a calendar that answers and, when asked, a doctored /coin/state. */
function fetchWith(doctor: ((body: Record<string, unknown>) => Record<string, unknown>) | null): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://cal.test')) return new Response(calendarBytes, { status: 200 });
    const r = await fetch(input, init);
    if (doctor && url.endsWith('/coin/state')) return new Response(JSON.stringify(doctor((await r.json()) as Record<string, unknown>)), { status: 200, headers: { 'content-type': 'application/json' } });
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
let server: Server;
let base: string;
const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
async function accepted(path: string, event: unknown): Promise<Hash> {
  const r = await post(path, event);
  expect(r.status, await r.clone().text()).toBe(202);
  return ((await r.json()) as { id: Hash }).id;
}
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string, verdict = 'supports') {
  const ret = { verdict };
  const nonce = newNonce();
  await accepted(`p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}

const env = envelope();
const P = problemHash(env);
const elsewhere = envelope(A, 'elsewhere');
const Q = problemHash(elsewhere);
let p1: Hash;

beforeAll(async () => {
  const t = createTracker({ store: new Store(':memory:'), url: 'http://t.test/', now, ipSalt: 's', coin });
  server = await t.listen(0);
  const a = server.address();
  base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '';
  expect((await post('p', { envelope: env })).status).toBe(201);
  p1 = ((await (await fetch(`${base}p/${P}/state`)).json()) as { pieces: { hash: Hash }[] }).pieces[0]!.hash;
  // The owner earns the point a gold's share of two asks, on a problem of A's with no gold and so no coin in it.
  expect((await post('p', { envelope: elsewhere })).status).toBe(201);
  const q1 = ((await (await fetch(`${base}p/${Q}/state`)).json()) as { pieces: { hash: Hash }[] }).pieces[0]!.hash;
  await returnOn(Q, q1, owner, 'anthropic/claude');
  await returnOn(Q, q1, B, 'openai/gpt');
  // The owner's gold on the one piece, two workers who agree with it, the reveal, and the epoch's end.
  const projection = { verdict: 'supports' };
  const nonce = newNonce();
  await accepted(`p/${P}/events`, ev(owner, 'gold', { commitments: [commitHash({ piece: p1, projection }, nonce)], stake: 2 }, P));
  await returnOn(P, p1, A, 'anthropic/claude');
  await returnOn(P, p1, B, 'openai/gpt');
  await accepted(`p/${P}/events`, ev(owner, 'gold_reveal', { projection, nonce }, P, p1));
  tick = Date.parse(T0) + 24 * HOUR + 1000;
  await accepted('coin/events', ev(A, 'lock', { problem: P, piece: p1, amount: 100 }));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the coin at the mirror', () => {
  it('pulls the coin log, reproduces the balances, writes them, and anchors the coin log\'s head', async () => {
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-coin-'));
    const report = await mirror({ trackers: [base], out, now, fetchImpl: fetchWith(null), anchor: { calendars: ['http://cal.test'] } });
    expect(report.refused).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.coin).toEqual({ lines: 1, added: 1, head: 1, reproduced: true, credits: 0 });
    const lines = readFileSync(join(out, 'ledger', 'coin.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.event.type).toBe('lock');
    expect(verifyChain(lines, COIN_LOG).ok).toBe(true);
    const balances = JSON.parse(readFileSync(join(out, 'coin', 'balances.json'), 'utf8')) as { head: { seq: number }; balances: Record<string, { balance: number; locked: number }> };
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

  it('checks every credit on the coin log against the chain, and refuses the balances where a credit is not what the chain holds or there is no chain to ask', async () => {
    await accepted('coin/events', ev(reader, 'credit', { deposit: 1, root: addr(B), amount: 100 }));
    const chainOf = (amount: number) => ({ depositAt: async (n: number) => ({ root: addr(B), amount, made: n === 1 }) });
    const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-credit-'));
    const report = await mirror({ trackers: [base], out, now, fetchImpl: fetchWith(null), chain: chainOf(100) });
    expect(report.refused).toEqual([]);
    expect(report.coin).toEqual({ lines: 2, added: 2, head: 2, reproduced: true, credits: 1 });
    const balances = JSON.parse(readFileSync(join(out, 'coin', 'balances.json'), 'utf8')) as { balances: Record<string, { balance: number; credited: number }> };
    expect(balances.balances[addr(B)]).toMatchObject({ balance: 550, credited: 100 });
    const wrong = await mirror({ trackers: [base], out: mkdtempSync(join(tmpdir(), 'bitquilt-mirror-credit-wrong-')), now, fetchImpl: fetchWith(null), chain: chainOf(99) });
    expect(wrong.refused).toEqual([`coin: the credit for deposit 1 (100 to ${addr(B)}) is not what the chain holds, at head 2 from ${base}`]);
    expect(wrong.coin).toMatchObject({ reproduced: false, credits: 1 });
    const blind = await mirror({ trackers: [base], out: mkdtempSync(join(tmpdir(), 'bitquilt-mirror-credit-blind-')), now, fetchImpl: fetchWith(null) });
    expect(blind.refused).toEqual([`coin: 1 credit on the ledger and no chain to check them against, at head 2 from ${base}`]);
    expect(blind.coin).toMatchObject({ reproduced: false, credits: 1 });
  });
});
