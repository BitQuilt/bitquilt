import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type Envelope, type Hash, commitHash, newNonce } from '@bitquilt/core';
import { TENTH } from '../src/seeding.js';
import { VERDICT_QUOTE, addr, boot, envelope as signed, key } from './helpers.js';

/**
 * QX-4 and QX-5 at the tracker: seeders and the last seed read off `seed` events; a watch piece offered to a seeder
 * first and kept from others for its lease; and the offer: the problems of people who have worked for the asker
 * first, the rest rarest first, every tenth offer a newcomer's, and never the asker's own; a door's first seeder,
 * whose seeded problems lead the offer to a key with no accepted work and no other; and the one rule the offer shares
 * with assisted next (QX-5 section 4), so it names and holds no human piece for an AI's client and no judge piece
 * whose panel ran out.
 */
const A = key(1),
  O1 = key(2),
  O2 = key(3),
  O3 = key(4),
  X = key(5),
  S = key(6),
  B = key(7);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });

function envelope(owner: Uint8Array, slug: string, count: number, watch = 0): Envelope {
  const pieces: Envelope['problem']['pieces'] = {
    'statement/*': {
      count,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: does the paper say so?',
      schema: VERDICT_QUOTE,
      agree: ['verdict'],
    },
  };
  if (watch)
    pieces['watch/*'] = {
      count: watch,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Watch {n}: is the paper still where it was, and does it still say so?',
      schema: VERDICT_QUOTE,
      agree: ['verdict'],
    };
  return signed(owner, slug, pieces);
}

const HOUR = 3_600_000;
const t = boot('2026-10-26T09:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { clock, ev, post, get, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

async function publish(e: Envelope): Promise<Hash> {
  const r = await post('/p', { envelope: e, blobs: {} });
  expect(r.status, await r.clone().text()).toBe(201);
  return ((await r.json()) as { hash: Hash }).hash;
}
async function pieceNamed(problem: Hash, name: string): Promise<Hash> {
  const s = (await get(`/p/${problem}/state`)) as { pieces: { hash: Hash; name: string }[] };
  return s.pieces.find((p) => p.name === name)!.hash;
}
/** A commit and its reveal from one key, agreeing on `verdict`. */
async function returnOn(problem: Hash, piece: Hash, k: Uint8Array, model: string) {
  const ret = { verdict: 'supports', quote: `as ${addr(k).slice(0, 6)} read it` };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  await accepted(`/p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}
const nextFor = async (problem: Hash, k: Uint8Array) =>
  (await get(`/p/${problem}/next?key=${addr(k)}&can=web&model=meta/llama`)) as { piece: Hash | null; name?: string };
type Offer = { problem: Hash; owner: Address; reason: string; name: string };
const offerFor = async (k: Uint8Array) =>
  (await get(`/offer?key=${addr(k)}&can=web&model=meta/llama`)) as { offer: number; offers: Offer[] };

let PA: Hash, P1: Hash, P2: Hash, P3: Hash;

describe('the offer (QX-5)', () => {
  it("puts the problems of those who worked for the asker first, the rest rarest first, and never the asker's own", async () => {
    PA = await publish(envelope(A, 'by-a', 2));
    P1 = await publish(envelope(O1, 'by-o1', 3, 1));
    P2 = await publish(envelope(O2, 'by-o2', 3));
    P3 = await publish(envelope(O3, 'by-o3', 3));
    // O1 and X work for A: an accepting set on A's problem. O3 and X work on O1's: O3 has accepted work, but not for A.
    const pa1 = await pieceNamed(PA, 'statement/1');
    await returnOn(PA, pa1, O1, 'anthropic/claude');
    await returnOn(PA, pa1, X, 'openai/gpt');
    const p11 = await pieceNamed(P1, 'statement/1');
    await returnOn(P1, p11, O3, 'anthropic/claude');
    await returnOn(P1, p11, X, 'openai/gpt');
    const o = await offerFor(A);
    expect(o.offer).toBe(1);
    expect(o.offers.map((x) => x.problem)).not.toContain(PA);
    expect(o.offers[0]!.problem).toBe(P1);
    expect(o.offers[0]!.reason).toBe('reciprocal');
    expect(
      o.offers
        .slice(1)
        .map((x) => x.problem)
        .sort(),
    ).toEqual([P2, P3].sort());
    expect(o.offers.slice(1).every((x) => x.reason === 'rarest')).toBe(true);
    // A problem with no piece for the asker is left out: X has revealed on every problem it could be offered here
    // except its own... X owns nothing, so all four are its candidates.
    const ox = await offerFor(X);
    expect(ox.offers.map((x) => x.problem).sort()).toEqual([PA, P1, P2, P3].sort());
  });
  it("gives every tenth offer to a newcomer's problem", async () => {
    let last: { offer: number; offers: Offer[] } | null = null;
    for (let i = 2; i <= TENTH; i++) last = await offerFor(A);
    expect(last!.offer).toBe(TENTH);
    expect(last!.offers[0]!.problem).toBe(P2);
    expect(last!.offers[0]!.reason).toBe('newcomer');
    const after = await offerFor(A);
    expect(after.offer).toBe(TENTH + 1);
    expect(after.offers[0]!.problem).toBe(P1);
  });
  it('refuses a key without its checksum and a capability it does not know', async () => {
    expect(((await get(`/offer?key=${addr(A).toLowerCase()}&can=web`)) as { error: string }).error).toMatch(/checksum/);
    expect(((await get(`/offer?key=${addr(A)}&can=flying`)) as { error: string }).error).toMatch(/can:/);
  });
});

describe('seeding (QX-4)', () => {
  it('counts seeders and keeps the last seed from seed events, and refuses a malformed one', async () => {
    const before = (await get(`/p/${P1}/scrape`)) as { seeders: number; last_seeded: string | null };
    expect(before.seeders).toBe(0);
    expect(before.last_seeded).toBeNull();
    const r = await post(`/p/${P1}/events`, ev(S, 'seed', { on: 'yes' }, P1));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/body\.on/);
    await accepted(`/p/${P1}/events`, ev(S, 'seed', { on: true }, P1));
    const seededAt = new Date(clock.tick).toISOString();
    const on = (await get(`/p/${P1}/scrape`)) as { seeders: number; last_seeded: string | null };
    expect(on.seeders).toBe(1);
    expect(on.last_seeded).toBe(seededAt);
    const listed = ((await get('/search?q=by-o1')) as { problems: { seeders: number; last_seeded: string | null }[] })
      .problems[0]!;
    expect(listed.seeders).toBe(1);
    expect(listed.last_seeded).toBe(seededAt);
  });
  it('hands a seeder the watch piece first and keeps it from others for its lease', async () => {
    const watch = await pieceNamed(P1, 'watch/1');
    expect((await nextFor(P1, S)).piece).toBe(watch);
    expect((await nextFor(P1, B)).piece).not.toBe(watch);
    clock.tick += 3 * HOUR;
    const seen = new Set<Hash>();
    for (let i = 0; i < 4; i++) {
      const n = await nextFor(P1, B);
      if (!n.piece) break;
      seen.add(n.piece);
      if (n.piece === watch) break;
      await accepted(`/p/${P1}/events`, ev(B, 'decline', { reason: 'no_time' }, P1, n.piece));
    }
    expect(seen.has(watch)).toBe(true);
  });
  it('a seed off ends the seeding and leaves the last seed as it was', async () => {
    const was = (await get(`/p/${P1}/scrape`)) as { last_seeded: string | null };
    await accepted(`/p/${P1}/events`, ev(S, 'seed', { on: false }, P1));
    const off = (await get(`/p/${P1}/scrape`)) as { seeders: number; last_seeded: string | null };
    expect(off.seeders).toBe(0);
    expect(off.last_seeded).toBe(was.last_seeded);
    const wk = (await get('/.well-known/quilt')) as { seeding: string; reciprocity: string; routes: string[] };
    expect(wk.seeding).toBe('QX-4');
    expect(wk.reciprocity).toBe('QX-5');
    expect(wk.routes).toContain('/offer');
  });
});

describe("a door's first seeder (QX-5 section 2)", () => {
  const FIRST = key(8),
    N = key(9),
    W = key(10),
    O4 = key(11),
    O5 = key(12);
  const u = boot('2026-10-26T09:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 }, firstSeeder: addr(FIRST) });
  beforeAll(() => u.listen());
  afterAll(() => u.close());
  const publishHere = async (e: Envelope): Promise<Hash> =>
    ((await (await u.post('/p', { envelope: e, blobs: {} })).json()) as { hash: Hash }).hash;
  const offerHere = async (k: Uint8Array) =>
    (await u.get(`/offer?key=${addr(k)}&can=web&model=meta/llama`)) as { offer: number; offers: Offer[] };

  it('offers a key with no accepted work what the first seeder seeds before the rest, and a key with accepted work the usual order', async () => {
    const P = await publishHere(envelope(O4, 'first-p', 3));
    const Q = await publishHere(envelope(O5, 'first-q', 3));
    // Rarest first with nothing done: the problem with the oldest last event, P, leads.
    expect((await offerHere(N)).offers.map((o) => [o.problem, o.reason])).toEqual([
      [P, 'rarest'],
      [Q, 'rarest'],
    ]);
    await u.accepted(`/p/${Q}/events`, u.ev(FIRST, 'seed', { on: true }, Q));
    expect((await offerHere(N)).offers.map((o) => [o.problem, o.reason])).toEqual([
      [Q, 'first'],
      [P, 'rarest'],
    ]);
    // N earns an accepted square on Q: the rule no longer applies to it, and Q, now the less rare, comes second.
    const q1 = ((await u.get(`/p/${Q}/state`)) as { pieces: { hash: Hash; name: string }[] }).pieces.find(
      (p) => p.name === 'statement/1',
    )!.hash;
    for (const [k, model] of [
      [N, 'anthropic/claude'],
      [W, 'openai/gpt'],
    ] as const) {
      const ret = { verdict: 'supports', quote: `as ${addr(k).slice(0, 6)} read it` };
      const nonce = newNonce();
      await u.accepted(`/p/${Q}/events`, u.ev(k, 'commit', { h: commitHash(ret, nonce) }, Q, q1));
      await u.accepted(`/p/${Q}/events`, u.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, Q, q1));
    }
    expect((await offerHere(N)).offers.map((o) => [o.problem, o.reason])).toEqual([
      [P, 'rarest'],
      [Q, 'rarest'],
    ]);
    // A fresh key is still led to what the first seeder seeds.
    expect((await offerHere(key(13))).offers[0]).toMatchObject({ problem: Q, reason: 'first' });
  });
});

describe('the offer leaves out what assisted next leaves out (QX-5 section 4)', () => {
  const OWN = key(14),
    AI = key(15),
    PERSON = key(16),
    C1 = key(17),
    C2 = key(18);
  const v = boot('2026-10-26T09:00:00Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
  beforeAll(() => v.listen());
  afterAll(() => v.close());
  const textSchema = {
    type: 'object' as const,
    additionalProperties: false as const,
    required: ['text'],
    properties: { text: { type: 'string' as const, maxLength: 200 } },
  };
  const vote = {
    verifier: 'human',
    requires: ['web' as const],
    brief: 'Does the paper say so? A person answers.',
    schema: VERDICT_QUOTE,
    agree: ['verdict'],
  };
  const publishHere = async (e: Envelope): Promise<Hash> =>
    ((await (await v.post('/p', { envelope: e, blobs: {} })).json()) as { hash: Hash }).hash;
  const pieceHere = async (problem: Hash, name: string) =>
    (
      (await v.get(`/p/${problem}/state`)) as {
        pieces: { hash: Hash; name: string; state: string; panel: string | null }[];
      }
    ).pieces.find((p) => p.name === name)!;
  const offerAs = async (k: Uint8Array, can: string, model: string) =>
    ((await v.get(`/offer?key=${addr(k)}&can=${can}&model=${model}`)) as { offers: Offer[] }).offers.map((o) => [
      o.problem,
      o.name,
    ]);
  const nextAs = async (problem: Hash, k: Uint8Array, can: string, model: string) =>
    (await v.get(`/p/${problem}/next?key=${addr(k)}&can=${can}&model=${model}`)) as {
      piece: Hash | null;
      name?: string;
    };

  it('names and holds no human piece for a client that declares no person, and offers it to one that does', async () => {
    const H = await publishHere(signed(OWN, 'a-person-answers', { vote }));
    const M = await publishHere(
      signed(OWN, 'a-person-or-a-model', {
        vote,
        statement: {
          verifier: 'agree',
          requires: ['web'],
          brief: 'Does the paper say so?',
          schema: VERDICT_QUOTE,
          agree: ['verdict'],
        },
      }),
    );
    // Next hands an AI's client nothing on H and the statement on M. The offer names the same, so H is left out.
    expect((await nextAs(H, AI, 'web', 'meta/llama')).piece).toBeNull();
    expect((await nextAs(M, AI, 'web', 'meta/llama')).name).toBe('statement');
    expect(await offerAs(AI, 'web', 'meta/llama')).toEqual([[M, 'statement']]);
    // The AI's next and offer held the statement on M and nothing on H, so a person's offer names the vote on both.
    expect(await offerAs(PERSON, 'web,person', 'human')).toEqual([
      [H, 'vote'],
      [M, 'vote'],
    ]);
  });

  it('names no judge piece whose panel ran out, as next hands none', async () => {
    const J = await publishHere(
      signed(OWN, 'a-panel-ranks', {
        summary: {
          verifier: 'judge:3',
          candidates: 2,
          requires: ['web'],
          brief: 'Summarise the paper in a sentence.',
          schema: textSchema,
        },
      }),
    );
    const summary = (await pieceHere(J, 'summary')).hash;
    // Two candidates from unrelated roots, and no root here with accepted work to sit on a panel: the panel runs out at
    // once.
    for (const [k, model, text] of [
      [C1, 'anthropic/claude', 'A torrent where the pieces are made.'],
      [C2, 'openai/gpt', 'Problems as patterns of pieces.'],
    ] as const) {
      const nonce = newNonce();
      await v.accepted(`/p/${J}/events`, v.ev(k, 'commit', { h: commitHash({ text }, nonce) }, J, summary));
      await v.accepted(`/p/${J}/events`, v.ev(k, 'reveal', { return: { text }, nonce, by: by(model) }, J, summary));
    }
    expect(await pieceHere(J, 'summary')).toMatchObject({ state: 'disputed', panel: 'void' });
    expect((await nextAs(J, AI, 'web', 'meta/llama')).piece).toBeNull();
    expect((await offerAs(AI, 'web', 'meta/llama')).map(([problem]) => problem)).not.toContain(J);
  });
});
