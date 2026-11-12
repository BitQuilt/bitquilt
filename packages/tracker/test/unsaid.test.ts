import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Hash, commitHash, eventId, hashCanonical, newNonce } from '@bitquilt/core';
import { VERDICT, VERDICT_QUOTE, addr, boot, envelope, key } from './helpers.js';

/**
 * The verdicts and the ranks a reader takes for nothing by their signature, their key, their body and their seat,
 * read by reading 2 (docs/v2/READING.md section 7): a verdict is read under its challenge, as a rank is under its
 * panel, and each that does not count is listed there with why. docs/ext/verifiers.md section 2 says of a rank: "A
 * rank counts when its signature is the key's, the key's root holds a live seat (offered, not lapsed, not yet
 * answered) at the rank's receipt, and the ranking is the candidates' digests each once." This tracker's door refuses
 * each of these, so each is written into the store past the door, as a line pulled from a door that asked less would
 * be. The ledger this file leaves holds:
 * - under a challenge on an agree piece, a verdict whose signature is not its key's, one from a delegate whose scope
 *   has no verdict, one that names another piece, one for neither side, one whose return is no object, one whose
 *   return fails the piece's schema, and one from a judge whose seat lapsed;
 * - under a challenge on a check piece, a verdict that carries a return;
 * - under a panel, a rank whose signature is not its key's, one with no digests, one with a digest twice, one from a
 *   delegate whose scope has no rank, one whose digests are not the candidates', a second from a judge who ranked,
 *   and one from a judge whose seat lapsed.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
  F = key(6),
  G = key(7),
  H = key(8);
const judges = [key(11), key(12), key(13), key(14)];
const secretOf = new Map<Address, Uint8Array>(judges.map((k) => [addr(k), k]));
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const, 'shell' as const] });
const pieces = {
  claim: {
    verifier: 'agree',
    requires: ['web' as const],
    schema: VERDICT,
    agree: ['verdict'],
    brief: 'Is the first claim in the paper?',
  },
  lint: {
    verifier: 'check',
    requires: ['shell' as const],
    brief: 'Run the lint.',
    workspace: { repo: 'https://example.org/r', base: 'abc' },
    check: { file: 'lint.sh' },
  },
  summary: {
    verifier: 'judge:3',
    candidates: 2,
    requires: ['web' as const],
    brief: 'Summarise the paper in a sentence.',
    schema: {
      type: 'object' as const,
      additionalProperties: false as const,
      required: ['text'],
      properties: { text: { type: 'string' as const, maxLength: 200 } },
    },
  },
};
/** Where the judges' own work stands: the pool is the roots with an accepted return on another problem. */
const elsewhere = {
  'statement/*': {
    count: 2,
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Statement {n}: does the paper say so?',
    schema: VERDICT_QUOTE,
    agree: ['verdict'],
  },
};

const t = boot('2026-11-12T08:00:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Dropped = { id: Hash; why: string };
type State = { pieces: { name: string; hash: Hash; state: string }[]; dropped: (Dropped & { type: string })[] };
type Seats = { piece: Hash; seats: { root: Address }[]; outcome: string; dropped: Dropped[] };
type Signed = ReturnType<typeof ev>;

describe('the verdicts and the ranks a reader takes for nothing (READING.md section 7)', () => {
  let P: Hash;
  const hashOf = new Map<string, Hash>();
  const events = () => `/p/${P}/events`;
  const publish = async (slug: string, of: Parameters<typeof envelope>[2]): Promise<Hash> => {
    const r = await post('/p', { envelope: envelope(owner, slug, of) });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { hash: Hash }).hash;
  };
  /** A commit and its reveal on a piece of a problem, through the door; the digest of the return. */
  async function reads(problem: Hash, piece: Hash, k: Uint8Array, model: string, ret: Record<string, unknown>) {
    const nonce = newNonce();
    await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
    await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
    return hashCanonical(ret);
  }
  /** An event the door refuses, written into the store past it; its id. */
  async function past(event: Signed): Promise<Hash> {
    expect((await post(events(), event)).status).toBe(400);
    t.store.appendReceipt(P, event, eventId(event), 'http://tracker.test/', event.ts, 'self');
    return eventId(event);
  }
  const state = () => get<State>(`/p/${P}/state`);
  const challengesOf = async () => (await get<{ challenges: Seats[] }>(`/p/${P}/challenges`)).challenges;
  const panelsOf = async () => (await get<{ panels: Seats[] }>(`/p/${P}/panels`)).panels;
  const whys = (list: Dropped[]) => list.map((d) => d.why);
  const seated = (s: Seats) => {
    const drawn = s.seats.map((x) => secretOf.get(x.root)!);
    return [...drawn, judges.find((k) => !drawn.includes(k))!] as [Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  };
  /** A verdict or a rank as its judge signed it, with another's key written over the judge's. */
  const forged = (event: Signed, k: Uint8Array): Signed => ({ ...event, key: addr(k) });
  let verdict: (k: Uint8Array, body: Record<string, unknown>, piece?: string) => Signed;
  let rank: (k: Uint8Array, ranking: Hash[]) => Signed;
  let onClaim: Hash, first: Hash, second: Hash;
  let cj: [Uint8Array, Uint8Array, Uint8Array, Uint8Array], pj: [Uint8Array, Uint8Array, Uint8Array, Uint8Array];

  beforeAll(async () => {
    P = await publish('unsaid', pieces);
    for (const p of (await state()).pieces) hashOf.set(p.name, p.hash);
    verdict = (k, body, piece = 'claim') => ev(k, 'verdict', body, P, hashOf.get(piece)!);
    rank = (k, ranking) => ev(k, 'rank', { ranking }, P, hashOf.get('summary')!);
    await reads(P, hashOf.get('claim')!, A, 'anthropic/claude', { verdict: 'supports' });
    await reads(P, hashOf.get('claim')!, B, 'openai/gpt', { verdict: 'supports' });
    const digest = await reads(P, hashOf.get('lint')!, A, 'anthropic/claude', { patch: 'a change to the lint' });
    for (const k of [C, D])
      await accepted(
        events(),
        ev(k, 'run', { host: 'linux/x64', by: by('openai/gpt'), digest, exit: 0 }, P, hashOf.get('lint')!),
      );
    const Q = await publish('elsewhere', elsewhere);
    const [q1, q2] = (await get<State>(`/p/${Q}/state`)).pieces.map((p) => p.hash) as [Hash, Hash];
    const models = ['anthropic/claude', 'openai/gpt', 'google/gemini', 'meta/llama'];
    for (const [i, k] of judges.entries())
      await reads(Q, i < 2 ? q1 : q2, k, models[i]!, {
        verdict: 'supports',
        quote: `as ${addr(k).slice(0, 6)} read it`,
      });
    // A delegate that may claim for its root and sign nothing else.
    await accepted('/k/events', ev(H, 'delegate', { to: addr(G), scope: ['claim'], expires: '2027-06-01T00:00:00Z' }));
  });

  it('lists under a challenge each verdict it takes for nothing, by its signature, its key and its body', async () => {
    onClaim = await accepted(
      events(),
      ev(E, 'challenge', { stake: 1, ground: 'The paper says less.' }, P, hashOf.get('claim')!),
    );
    cj = seated((await challengesOf())[0]!);
    const [j1, j2] = cj;
    const author = { challenge: onClaim, for: 'author' };
    await past(forged(verdict(j1, author), j2));
    await past(verdict(G, author));
    await past(verdict(j1, author, 'summary'));
    await past(verdict(j1, { challenge: onClaim, for: 'neither' }));
    await past(verdict(j1, { ...author, return: 'supports' }));
    await past(verdict(j1, { ...author, return: { verdict: 'perhaps' } }));
    await accepted(events(), verdict(j1, author));
    const [c] = await challengesOf();
    expect(c!.outcome).toBe('open');
    expect(whys(c!.dropped)).toEqual([
      "signature is not the key's",
      'the key may not sign a verdict',
      'names another problem or piece than its challenge',
      'body.for: one of challenger, author',
      'body.return: an object',
      'return.verdict: one of supports, contradicts',
    ]);
  });

  it('takes for nothing a verdict that carries a return where the piece is a check', async () => {
    const onLint = await accepted(
      events(),
      ev(F, 'challenge', { stake: 1, ground: 'The lint did not run.' }, P, hashOf.get('lint')!),
    );
    const lint = (await challengesOf()).find((c) => c.piece === hashOf.get('lint'))!;
    const [l1] = seated(lint);
    await past(verdict(l1, { challenge: onLint, for: 'author', return: { patch: 'another change' } }, 'lint'));
    const again = (await challengesOf()).find((c) => c.piece === hashOf.get('lint'))!;
    expect(whys(again.dropped)).toEqual(['a verdict on a check or score piece carries no return']);
  });

  it('lists under a panel each rank it takes for nothing, by its signature, its key and its body', async () => {
    const summary = hashOf.get('summary')!;
    first = await reads(P, summary, C, 'google/gemini', { text: 'The paper reports one trial.' });
    second = await reads(P, summary, D, 'meta/llama', { text: 'The paper reports a trial and its limits.' });
    pj = seated((await panelsOf())[0]!);
    const [k1, k2] = pj;
    await past(forged(rank(k1, [first, second]), k2));
    await past(rank(k1, []));
    await past(rank(k1, [first, first]));
    await past(rank(G, [first, second]));
    await past(rank(k1, [first, hashCanonical({ text: 'Another sentence.' })]));
    await accepted(events(), rank(k1, [first, second]));
    await past(rank(k1, [second, first]));
    const [p] = await panelsOf();
    expect(p!.outcome).toBe('open');
    expect(whys(p!.dropped)).toEqual([
      "signature is not the key's",
      'body.ranking: a list of candidate digests, first choice first',
      'body.ranking: each digest once',
      'the key may not sign a rank',
      'body.ranking: the 2 candidate digests, each once',
      'this judge has ranked',
    ]);
    expect((await state()).dropped.length).toBe(6);
  });

  it('takes for nothing the verdict and the rank of a seat that lapsed, and seats the next in the order', async () => {
    // The lease is two hours: the two seats of each panel that gave no answer lapse, and one more is offered.
    t.clock.tick += 2 * 3600_000 + 600_000;
    await past(verdict(cj[1], { challenge: onClaim, for: 'challenger' }));
    await accepted(events(), verdict(cj[3], { challenge: onClaim, for: 'author' }));
    const [c] = await challengesOf();
    expect(c!.outcome).toBe('failed');
    expect(whys(c!.dropped).slice(6)).toEqual(['this seat lapsed']);
    await past(rank(pj[1], [second, first]));
    await accepted(events(), rank(pj[3], [first, second]));
    const [p] = await panelsOf();
    expect(p!.outcome).toBe('decided');
    expect(whys(p!.dropped).slice(6)).toEqual(['this seat lapsed']);
    expect((await state()).pieces.find((x) => x.name === 'summary')!.state).toBe('accepted_provisional');
  });
});
