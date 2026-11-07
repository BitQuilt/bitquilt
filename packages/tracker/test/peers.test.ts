import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Hash,
  type Receipt,
  IDENTITY_LOG,
  commitHash,
  eventId,
  hashBytes,
  newNonce,
  problemHash,
  verifyChain,
} from '@bitquilt/core';
import { addr, boot, envelope, key } from './helpers.js';

/**
 * Doors fold each other's chains (docs/ext/QX-21.md): two trackers hold one problem, and the second names the first as
 * its peer. Readings on the first are pulled to the second through its own door, its states come out the same, every
 * line carries both doors' wrappers and the chain verifies; a second pull adds nothing; a name on the first's identity
 * log is pulled; a hide the first admits from a maintainer it alone names is refused at the second's door with the
 * reason, so the two differ there and nowhere else; and a peer that does not answer is noted while the rest is pulled.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  M = key(7);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'contradicts'] } },
};
const pieces = {
  'statement/*': {
    count: 2,
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Statement {n}: does the paper say so?',
    schema,
    agree: ['verdict'],
  },
};
const env = envelope(owner, 'paper', pieces, { title: 'Does the paper say so?' });
const P = problemHash(env);

const START = '2026-11-02T12:00:00Z';
const limits = { keyPerHour: 1000, ipPerHour: 10000 };
// The first names M as a maintainer (QX-6); the second names none.
const one = boot(START, { limits, maintainers: [addr(M)] });
let two: ReturnType<typeof boot>;
let s1: Hash, s2: Hash;

type State = { pieces: { hash: Hash; name: string; state: string; reveals: number }[] };
const stateAt = (t: ReturnType<typeof boot>) => t.get<State>(`/p/${P}/state`);

async function returned(
  t: ReturnType<typeof boot>,
  piece: Hash,
  k: Uint8Array,
  model: string,
  verdict: string,
): Promise<void> {
  const ret = { verdict };
  const nonce = newNonce();
  await t.accepted(`/p/${P}/events`, t.ev(k, 'commit', { h: commitHash(ret, nonce) }, P, piece));
  await t.accepted(`/p/${P}/events`, t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, P, piece));
}

beforeAll(async () => {
  await one.listen();
  two = boot(START, { limits, peers: [`${one.base}/`, 'http://127.0.0.1:1/'] });
  await two.listen();
  for (const t of [one, two]) expect((await t.post('/p', { envelope: env })).status).toBe(201);
  const st = await stateAt(one);
  [s1, s2] = [st.pieces[0]!.hash, st.pieces[1]!.hash];
});
afterAll(async () => {
  await one.close();
  await two.close();
});

describe("doors fold each other's chains (QX-21)", () => {
  it('says its peers and the pull in the well-known', async () => {
    const w = await two.get<{ peers: string[]; pull: { extension: string; every_ms: number } | null }>(
      '/.well-known/quilt',
    );
    expect(w.peers).toEqual([`${one.base}/`, 'http://127.0.0.1:1/']);
    expect(w.pull).toEqual({ extension: 'QX-21', every_ms: 300_000 });
    expect((await one.get<{ pull: unknown }>('/.well-known/quilt')).pull).toBeNull();
  });

  it("pulls the readings on its peer through its own door, with both doors' wrappers on every line and the chain verifying, and its states come out the same; a second pull adds nothing", async () => {
    await returned(one, s1, A, 'anthropic/claude', 'supports');
    await returned(one, s1, B, 'openai/gpt-5', 'supports');
    await returned(one, s2, A, 'anthropic/claude', 'contradicts');
    expect((await stateAt(two)).pieces.map((p) => p.state)).toEqual(['open', 'open']);
    // The second's clock is moved past the first's, as two trackers' clocks are never behind each other by the events they take.
    two.clock.tick = one.clock.tick + 60_000;
    const pulls = await two.tracker.pullPeers();
    expect(pulls).toHaveLength(2);
    const [fromOne, fromNobody] = pulls;
    expect(fromOne).toMatchObject({ peer: `${one.base}/`, added: 6, refused: [], errors: [] });
    expect(fromNobody).toMatchObject({ peer: 'http://127.0.0.1:1/', added: 0, refused: [] });
    expect(fromNobody!.errors).toEqual(['http://127.0.0.1:1/: no answer']);
    const mine = await stateAt(two);
    const theirs = await stateAt(one);
    expect(mine.pieces.map((p) => [p.state, p.reveals])).toEqual(theirs.pieces.map((p) => [p.state, p.reveals]));
    expect(mine.pieces.map((p) => p.state)).toEqual(['accepted_provisional', 'needs_verify']);
    const lines = (await (await fetch(`${two.base}/p/${P}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    expect(lines).toHaveLength(6);
    expect(verifyChain(lines, P).ok).toBe(true);
    for (const l of lines) {
      expect(l.received.map((w) => w.by)).toEqual(['http://tracker.test/', 'http://tracker.test/']);
      expect(l.received[0]!.at < l.received[1]!.at).toBe(true);
      expect(l.received[0]!.custody).toBe('self');
      expect(l.received[1]!.custody).toBeUndefined();
    }
    // The lines read the same event ids as the peer's, in the peer's order.
    const peers = (await (await fetch(`${one.base}/p/${P}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    expect(lines.map((l) => l.event.sig)).toEqual(peers.map((l) => l.event.sig));
    expect((await two.tracker.pullPeers())[0]).toMatchObject({ added: 0, refused: [], errors: [] });
  });

  it("takes the reads a peer's trace names before admitting it, so a trace that rests on a page kept at the peer folds here with its page", async () => {
    const text = 'The paper says so, in its first section.';
    const bytes = new TextEncoder().encode(text);
    const page = hashBytes(bytes);
    expect((await fetch(`${one.base}/b/${page}`, { method: 'PUT', body: bytes })).status).toBe(202);
    const lines = (await (await fetch(`${one.base}/p/${P}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    const reveal = lines.find(
      (l) => l.event.type === 'reveal' && l.event.key === addr(A) && l.event.piece === s1,
    )!.event;
    const reads = [{ url: 'https://example.org/paper', hash: page, at: '2026-11-02T11:00:00Z', media: 'text/plain' }];
    await one.accepted(
      `/p/${P}/events`,
      one.ev(
        A,
        'trace',
        { reveal: eventId(reveal), reads, rests: [{ field: 'verdict', read: 0, span: [0, 18] }] },
        P,
        s1,
      ),
    );
    expect((await fetch(`${two.base}/b/${page}`)).status).toBe(404);
    two.clock.tick = one.clock.tick + 60_000;
    const [fromOne] = await two.tracker.pullPeers();
    expect(fromOne).toMatchObject({ added: 1, refused: [], errors: [] });
    expect(new TextDecoder().decode(await (await fetch(`${two.base}/b/${page}`)).arrayBuffer())).toBe(text);
    const mine = (await (await fetch(`${two.base}/p/${P}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    expect(mine.filter((l) => l.event.type === 'trace')).toHaveLength(1);
  });
  it('pulls the identity log first, so a name on the peer is a name here', async () => {
    expect((await one.post('/k/events', one.ev(owner, 'name', { name: 'Ada' }))).status).toBe(202);
    expect((await two.get<{ name: string | null }>(`/k/${addr(owner)}/work`)).name).toBeNull();
    two.clock.tick = one.clock.tick + 60_000;
    expect((await two.tracker.pullPeers())[0]).toMatchObject({ added: 1, refused: [] });
    expect((await two.get<{ name: string | null }>(`/k/${addr(owner)}/work`)).name).toBe('Ada');
    const identity = (await (await fetch(`${two.base}/k/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    expect(verifyChain(identity, IDENTITY_LOG).ok).toBe(true);
  });

  it('refuses at its own door what its peer admitted on a rule it does not share, says why, and folds the rest', async () => {
    await returned(one, s2, B, 'openai/gpt-5', 'contradicts');
    // M takes the problem down on the first, which honours M's key; the second does not, so the same hide is refused here with the reason, and the readings before it are folded.
    await one.accepted('/k/events', one.ev(M, 'hide', { id: P, why: 'Taken down here, to see the doors differ.' }));
    expect((await one.get<{ hidden: unknown }>(`/p/${P}/scrape`)).hidden).not.toBeNull();
    two.clock.tick = one.clock.tick + 60_000;
    const [pull] = await two.tracker.pullPeers();
    expect(pull).toMatchObject({ added: 2, errors: [] });
    expect(pull!.refused).toEqual([
      { id: expect.stringMatching(/^sha256:/), why: "a hide is signed by one of this tracker's maintainers" },
    ]);
    expect((await stateAt(two)).pieces.map((p) => p.state)).toEqual(['accepted_provisional', 'accepted_provisional']);
    expect((await two.get<{ hidden: unknown }>(`/p/${P}/scrape`)).hidden).toBeNull();
    // The same difference a client would have met posting to both: the hide posted to the second's door directly is refused with the same words.
    const direct = await two.post(
      '/k/events',
      two.ev(M, 'hide', { id: P, why: 'Taken down here, to see the doors differ.' }),
    );
    expect(direct.status).toBe(403);
    expect(((await direct.json()) as { error: string }).error).toBe(pull!.refused[0]!.why);
    // Pulled again, nothing is added and the hide is refused again: a refusal is not remembered, since the door's rules may change.
    expect((await two.tracker.pullPeers())[0]).toMatchObject({
      added: 0,
      refused: [{ why: "a hide is signed by one of this tracker's maintainers" }],
    });
  });
});
