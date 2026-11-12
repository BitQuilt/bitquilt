import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Address,
  type Envelope,
  type Hash,
  type Unsigned,
  WHY,
  commitHash,
  hashCanonical,
  newNonce,
  plusHours,
  problemHash,
  reduce,
  signEvent,
} from '@bitquilt/core';
import { challengeLayer } from '../src/challenge.js';
import { VERDICT, addr, boot, envelope, keepLedger, key, line } from './helpers.js';
import { ledgerOf } from './reading.js';

/**
 * The reasons no ledger said, through a booted tracker, read by reading 2 (docs/v2/READING.md section 3): "Nothing
 * valid is left off the record, and a reading that does not count says why." The reasons are a closed list, and the
 * section gives each kind's in the order they are asked. This file leaves two ledgers that say six of them, each on
 * a piece of the kind that asks it. The first is what a booted tracker holds. The second is built by hand, since
 * this tracker's door takes nothing on a record piece once its readings are in (docs/ext/QX-20.md section 2) and no
 * candidate once a judge piece's are (QX-2), and the reading reads a ledger whatever door it came
 * through:
 * - `agree`: "and where none of these is true, \"the set was made without it\"", said of a root's second reading,
 *   which agrees with the set and completes none, since "a set is completed only by a reading whose root is
 *   unrelated to the root of every reading before it";
 * - `check`: "every reading is `counted` until a set is made, and from then each but the set's patch says \"the set
 *   was made on another patch\"";
 * - `record:n`: "or else \"the readings the piece asks for stood before it\"";
 * - `judge:n`: "\"the candidates were in before it\", where as many candidates as the piece asks for came before
 *   it; \"an earlier candidate gave the same return\"";
 * - any other verifier: "every reading says \"its piece asks a verifier this reading does not implement\"".
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const, 'shell' as const] });
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const textSchema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['text'],
  properties: { text: { type: 'string' as const, maxLength: 200 } },
};
const summary = {
  verifier: 'judge:3',
  candidates: 2,
  requires: ['web' as const],
  brief: 'Summarise the paper in a sentence.',
  schema: textSchema,
};
const REASONS: Envelope = envelope(owner, 'reasons', {
  changed: { ...agree, brief: 'Is the first claim in the paper?' },
  lint: {
    verifier: 'check',
    requires: ['shell' as const],
    brief: 'Run the lint.',
    workspace: { repo: 'https://example.org/r', base: 'abc' },
    check: { file: 'lint.sh' },
  },
  summary,
  oracle: { ...agree, verifier: 'oracle', brief: 'Is the second claim in the paper?' },
});
/** What another door took: a reading past those a record piece asks for, and a candidate past a judge piece's. */
const PAST: Envelope = envelope(owner, 'past', {
  question: { ...agree, verifier: 'record:2', brief: 'Does the paper ground its claim? Read it your way.' },
  summary,
});

const t = boot('2026-11-11T18:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
beforeAll(() => t.listen());
afterAll(() => t.close());

type Reading = { id: Hash; key: Address; vendor: string; counts: string; why: string | null };
type StatePiece = { name: string; hash: Hash; state: string; readings: Reading[] };
let P: Hash;
const events = () => `/p/${P}/events`;
const answered = async (name: string) =>
  (await t.get<{ pieces: StatePiece[] }>(`/p/${P}/state`)).pieces.find((p) => p.name === name)!;
/** A piece's readings as the state route answers them: who, how each counts, and why. */
const readings = async (name: string) => (await answered(name)).readings.map((r) => [r.key, r.vendor, r.counts, r.why]);
/** A commit and its reveal on a piece; the digest of the return, which a run of a patch names. */
async function reads(name: string, k: Uint8Array, model: string, ret: Record<string, unknown>): Promise<Hash> {
  const piece = (await answered(name)).hash;
  const nonce = newNonce();
  await t.accepted(events(), t.ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
  await t.accepted(events(), t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, piece));
  return hashCanonical(ret);
}
const row = (k: Uint8Array, vendor: string, counts: string, why: string | null = null) => [
  addr(k),
  vendor,
  counts,
  why,
];

describe('the reasons no ledger said (READING.md section 3)', () => {
  beforeAll(async () => {
    const r = await t.post('/p', { envelope: REASONS });
    expect(r.status, await r.clone().text()).toBe(201);
    P = ((await r.json()) as { hash: Hash }).hash;
  });

  it("says of a root's second reading, which agrees with the set, that the set was made without it", async () => {
    await reads('changed', A, 'anthropic/claude', { verdict: 'contradicts' });
    await reads('changed', B, 'openai/gpt', { verdict: 'supports' });
    // A's second reading agrees with B's and completes no set: its root is the root of a reading before it.
    await reads('changed', A, 'anthropic/claude', { verdict: 'supports' });
    expect(await readings('changed')).toEqual([
      row(A, 'anthropic', 'counted'),
      row(B, 'openai', 'counted'),
      row(A, 'anthropic', 'counted'),
    ]);
    await reads('changed', C, 'google/gemini', { verdict: 'supports' });
    expect((await answered('changed')).state).toBe('accepted_provisional');
    expect(await readings('changed')).toEqual([
      row(A, 'anthropic', 'kept', WHY.differs),
      row(B, 'openai', 'counted'),
      row(A, 'anthropic', 'kept', WHY.without),
      row(C, 'google', 'counted'),
    ]);
  });

  it('says of a patch beside the one the runs passed that the set was made on another patch', async () => {
    const lint = (await answered('lint')).hash;
    const digest = await reads('lint', A, 'anthropic/claude', { patch: 'diff --git a/x b/x' });
    await reads('lint', B, 'openai/gpt', { patch: 'diff --git a/y b/y' });
    expect(await readings('lint')).toEqual([row(A, 'anthropic', 'counted'), row(B, 'openai', 'counted')]);
    for (const k of [C, D])
      await t.accepted(
        events(),
        t.ev(k, 'run', { host: 'linux/x64', by: by('google/gemini'), digest, exit: 0 }, P, lint),
      );
    expect((await answered('lint')).state).toBe('accepted_provisional');
    expect(await readings('lint')).toEqual([row(A, 'anthropic', 'counted'), row(B, 'openai', 'kept', WHY.patch)]);
  });

  it('says of a candidate whose return an earlier candidate gave that it is the same', async () => {
    await reads('summary', A, 'anthropic/claude', { text: 'The paper reports one trial.' });
    await reads('summary', B, 'openai/gpt', { text: 'The paper reports one trial.' });
    expect(await readings('summary')).toEqual([row(A, 'anthropic', 'counted'), row(B, 'openai', 'kept', WHY.same)]);
    await reads('summary', C, 'google/gemini', { text: 'The paper reports a trial and its limits.' });
    // With both candidates in a panel is drawn, and it is void, since no root has work elsewhere to seat. A candidate
    // says so, and the reading that was none keeps its own reason.
    expect(await readings('summary')).toEqual([
      row(A, 'anthropic', 'kept', WHY.void),
      row(B, 'openai', 'kept', WHY.same),
      row(C, 'google', 'kept', WHY.void),
    ]);
    // The door takes no candidate past them, so the reason for one is held by the ledger built by hand below.
    const piece = (await answered('summary')).hash;
    const ret = { text: 'The paper is a report.' };
    const nonce = newNonce();
    await t.accepted(events(), t.ev(D, 'commit', { h: commitHash(ret, nonce) }, P, piece));
    const late = t.ev(D, 'reveal', { return: ret, nonce, by: by('mistral/large') }, P, piece);
    expect(await t.refused(events(), late)).toBe('the candidates for this piece are in');
  });

  it('says of a reading on a piece of no kind it knows that the reading does not implement its verifier', async () => {
    await reads('oracle', A, 'anthropic/claude', { verdict: 'supports' });
    expect(await readings('oracle')).toEqual([row(A, 'anthropic', 'kept', WHY.verifier)]);
  });
});

describe('the reasons a ledger from another door says (READING.md section 3)', () => {
  const at = (m: number) => new Date(Date.parse('2026-11-11T18:00:00Z') + m * 60_000).toISOString();
  const problem = problemHash(PAST);
  const hashOf = new Map(
    reduce({ envelopes: [PAST], blobs: new Map(), receipts: [], now: at(0) }).pieces.map((v) => [
      v.piece.name,
      v.piece.hash,
    ]),
  );
  let minute = 0;
  /** A commit and its reveal on a piece, signed and received a minute apart, as a resolver would serve them. */
  function read(name: string, k: Uint8Array, model: string, ret: Record<string, unknown>) {
    const nonce = newNonce();
    const u = (type: string, body: Record<string, unknown>, ts: string): Unsigned => ({
      quilt: 1,
      type,
      problem,
      piece: hashOf.get(name)!,
      key: addr(k),
      ts,
      body,
    });
    const [c, r] = [at(minute++), at(minute++)];
    return [
      line(signEvent(u('commit', { h: commitHash(ret, nonce) }, c), k), c),
      line(signEvent(u('reveal', { return: ret, nonce, by: by(model) }, r), k), r),
    ];
  }

  it('says that the readings stood before one, and that the candidates were in before another', () => {
    const receipts = [
      ...read('question', A, 'anthropic/claude', { verdict: 'supports' }),
      ...read('question', B, 'openai/gpt', { verdict: 'contradicts' }),
      ...read('question', C, 'google/gemini', { verdict: 'supports' }),
      ...read('summary', A, 'anthropic/claude', { text: 'The paper reports one trial.' }),
      ...read('summary', B, 'openai/gpt', { text: 'The paper reports a trial and its limits.' }),
      ...read('summary', C, 'google/gemini', { text: 'The paper is a report.' }),
    ];
    const now = at(60);
    const about =
      'A record piece with a reading past the two it asks for and a judge piece with a reading past its two ' +
      'candidates, built by hand: the reasons a ledger from another door says.';
    keepLedger('reasons-past', about, ledgerOf(PAST, receipts), [now, plusHours(now, 1000)]);
    const pl = challengeLayer({ problems: [{ envelopes: [PAST], blobs: new Map(), receipts, now }], now }).problems.get(
      problem,
    )!;
    const said = (name: string) =>
      pl.byHash.get(hashOf.get(name)!)!.readings.map((r) => [r.key, r.vendor, r.counts, r.why]);
    expect(said('question')).toEqual([
      row(A, 'anthropic', 'counted'),
      row(B, 'openai', 'counted'),
      row(C, 'google', 'kept', WHY.full),
    ]);
    // The panel is void here too, with no root to seat, and the reading past the candidates keeps its own reason.
    expect(said('summary')).toEqual([
      row(A, 'anthropic', 'kept', WHY.void),
      row(B, 'openai', 'kept', WHY.void),
      row(C, 'google', 'kept', WHY.candidates),
    ]);
  });
});
