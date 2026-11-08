import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Hash,
  type Receipt,
  IDENTITY_LOG,
  chainLines,
  commitHash,
  eventId,
  hashBytes,
  newNonce,
  problemHash,
  signEvent,
  stamp,
  verifyChain,
} from '@bitquilt/core';
import { Refusal } from '../src/http.js';
import { type PullDoor, pullPeers } from '../src/peers.js';
import { Store } from '../src/store.js';
import { VERDICT, addr, boot, envelope, key } from './helpers.js';

/**
 * Doors fold each other's chains (docs/ext/QX-21.md): two trackers hold one problem, and the second names the first as
 * its peer. Readings on the first are pulled to the second through its own door, its states come out the same, every
 * line carries both doors' wrappers and the chain verifies; a second pull adds nothing; a name on the first's identity
 * log is pulled; a hide the first admits from a maintainer it alone names is refused at the second's door with the
 * reason, so the two differ there and nowhere else; and a peer that does not answer is noted while the rest is pulled.
 * A human piece's seat is read from the peer's wrappers as the layer reads it (verifiers.md section 2): a reveal whose
 * wrapper says `seat: person` or `custody: hosted` is pulled, and one that says neither is refused. The stamp a door
 * asks of a name (CORE.md section 11) is asked of a pulled name as of a posted one, as QX-21 section 2 says, and so is
 * the envelope's rule a door holds a version's slug to: a version the peer took under a slug that climbs out of a
 * folder is refused with the words a post of it gets, and the owner's version after it is pulled and names the problem.
 * A trace the peer took whose reads are not a list, hold a read that is not an object, or name a read by anything but a
 * hash asks the peer for no read and is refused with the words a post of it gets, and the pull goes on past it. The
 * pull reaches the tracker that runs it through the `PullDoor` it is handed (peers.ts): the door's admission decides
 * each event, a refusal is said with its reason and a failure is noted, and a line admitted carries the peer's wrapper
 * with the door's after it.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  M = key(7);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const pieces = {
  'statement/*': {
    count: 2,
    verifier: 'agree',
    requires: ['web' as const],
    brief: 'Statement {n}: does the paper say so?',
    schema: VERDICT,
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
    // The second's clock is moved past the first's, as two trackers' clocks are never behind each other by the events
    // they take.
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
    // M takes the problem down on the first, which honours M's key; the second does not, so the same hide is refused
    // here with the reason, and the readings before it are folded.
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
    // The same difference a client would have met posting to both: the hide posted to the second's door directly is
    // refused with the same words.
    const direct = await two.post(
      '/k/events',
      two.ev(M, 'hide', { id: P, why: 'Taken down here, to see the doors differ.' }),
    );
    expect(direct.status).toBe(403);
    expect(((await direct.json()) as { error: string }).error).toBe(pull!.refused[0]!.why);
    // Pulled again, nothing is added and the hide is refused again: a refusal is not remembered, since the door's rules
    // may change.
    expect((await two.tracker.pullPeers())[0]).toMatchObject({
      added: 0,
      refused: [{ why: "a hide is signed by one of this tracker's maintainers" }],
    });
  });
});

describe("a human piece's seat, read from the peer's wrappers (QX-21 section 2)", () => {
  it("pulls a human piece's reveal where the peer's wrapper says seat: person or custody: hosted, and refuses one that says neither", async () => {
    const PEER = 'http://peer.test/';
    const H = envelope(
      owner,
      'vote',
      {
        vote: {
          verifier: 'human',
          requires: ['web'],
          brief: 'Does the paper say so? A person answers.',
          schema: VERDICT,
          agree: ['verdict'],
        },
      },
      { title: 'A vote' },
    );
    const PH = problemHash(H);
    let lines: Receipt[] = [];
    const peerFetch = (async (input: string | URL | Request) => {
      const u = String(input);
      if (u === `${PEER}.well-known/quilt`) return Response.json({ quilt: 1 });
      if (u.startsWith(`${PEER}p/${PH}/events`)) return new Response(lines.map((l) => JSON.stringify(l)).join('\n'));
      if (u.startsWith(`${PEER}k/events`)) return new Response('');
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const here = boot(START, { limits, peers: [PEER], fetchImpl: peerFetch });
    await here.listen();
    try {
      expect((await here.post('/p', { envelope: H })).status).toBe(201);
      const vote = (await here.get<State>(`/p/${PH}/state`)).pieces[0]!.hash;
      // Three keys commit and reveal at the peer, whose wrappers say a person's seat, the on-ramp's custody with the
      // seat it writes, and nothing about the seat.
      const C = key(3);
      const seats: [Uint8Array, string, Record<string, string>][] = [
        [A, 'anthropic/claude', { seat: 'person' }],
        [B, 'openai/gpt-5', { custody: 'hosted', seat: 'ai' }],
        [C, 'google/gemini', {}],
      ];
      const receipts: Receipt[] = [];
      const reveals: Hash[] = [];
      for (const [k, model, seat] of seats) {
        const ret = { verdict: 'supports' };
        const nonce = newNonce();
        const commit = here.ev(k, 'commit', { h: commitHash(ret, nonce) }, PH, vote);
        receipts.push({ event: commit, received: [{ by: PEER, at: commit.ts, custody: 'self' }] });
        const reveal = here.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, PH, vote);
        receipts.push({ event: reveal, received: [{ by: PEER, at: reveal.ts, custody: 'self', ...seat }] });
        reveals.push(eventId(reveal));
      }
      lines = chainLines(receipts, PH);
      here.clock.tick += 60_000;
      const [pull] = await here.tracker.pullPeers();
      expect(pull).toEqual({
        peer: PEER,
        added: 5,
        refused: [{ id: reveals[2], why: "a human piece takes a return from a person's seat" }],
        errors: [],
      });
      // The two seats a person's are the accepting set, as the layer counts them.
      expect((await here.get<State>(`/p/${PH}/state`)).pieces[0]!.state).toBe('accepted_provisional');
    } finally {
      await here.close();
    }
  });
});

describe("a pulled version's slug, by the envelope's rule (QX-21 section 2, CORE.md section 2)", () => {
  it('refuses a version its peer took whose slug is not a slug, with the reason a post of it gets, and pulls the rest', async () => {
    const PEER = 'http://peer.test/';
    const V = envelope(owner, 'versions', pieces, { title: 'Versions' });
    const PV = problemHash(V);
    let lines: Receipt[] = [];
    const peerFetch = (async (input: string | URL | Request) => {
      const u = String(input);
      if (u === `${PEER}.well-known/quilt`) return Response.json({ quilt: 1 });
      if (u.startsWith(`${PEER}p/${PV}/events`)) return new Response(lines.map((l) => JSON.stringify(l)).join('\n'));
      if (u.startsWith(`${PEER}k/events`)) return new Response('');
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const here = boot(START, { limits, peers: [PEER], fetchImpl: peerFetch });
    await here.listen();
    try {
      expect((await here.post('/p', { envelope: V })).status).toBe(201);
      // The peer's chain: a version under a slug that climbs out of a folder, then one under the problem's own slug.
      const climbs = here.ev(owner, 'version', { slug: '../../x', hash: PV }, PV);
      const good = here.ev(owner, 'version', { slug: 'versions', hash: PV }, PV);
      lines = chainLines(
        [climbs, good].map((event) => ({ event, received: [{ by: PEER, at: event.ts, custody: 'self' }] })),
        PV,
      );
      here.clock.tick += 60_000;
      const said = 'body.slug: lower-case letters, digits and hyphens, at most 64';
      const [pull] = await here.tracker.pullPeers();
      expect(pull).toEqual({ peer: PEER, added: 1, refused: [{ id: eventId(climbs), why: said }], errors: [] });
      expect(here.store.lines(PV).map((l) => l.event.sig)).toEqual([good.sig]);
      expect(await here.get<{ hash: Hash }>(`/n/${addr(owner)}/versions`)).toEqual({ hash: PV });
      // The same words a post of it gets at this door.
      const direct = await here.post(`/p/${PV}/events`, climbs);
      expect([direct.status, ((await direct.json()) as { error: string }).error]).toEqual([400, said]);
    } finally {
      await here.close();
    }
  });
});

describe("a pulled trace's reads, as its body states them (QX-21 section 2)", () => {
  it('asks the peer for no read a trace names by anything but a hash, refuses each such trace as a post of it is refused, and pulls the rest', async () => {
    const PEER = 'http://peer.test/';
    const T = envelope(owner, 'traces', pieces, { title: 'Traces' });
    const PT = problemHash(T);
    let lines: Receipt[] = [];
    const asked: string[] = [];
    const peerFetch = (async (input: string | URL | Request) => {
      const u = String(input);
      if (u === `${PEER}.well-known/quilt`) return Response.json({ quilt: 1 });
      if (u.startsWith(`${PEER}p/${PT}/events`)) return new Response(lines.map((l) => JSON.stringify(l)).join('\n'));
      if (u.startsWith(`${PEER}k/events`)) return new Response('');
      asked.push(u);
      return new Response('', { status: 404 });
    }) as typeof fetch;
    const here = boot(START, { limits, peers: [PEER], fetchImpl: peerFetch });
    await here.listen();
    try {
      expect((await here.post('/p', { envelope: T })).status).toBe(201);
      const piece = (await here.get<State>(`/p/${PT}/state`)).pieces[0]!.hash;
      const read = { url: 'https://example.org/page', hash: '..', at: START };
      const rests = [{ field: 'verdict', read: 0, span: [0, 4] }];
      // The peer's chain: traces whose reads are not a list, hold a read that is null, or name a read by a path, a
      // number or an object; then the owner's version, which this door takes.
      const traces = [5, [null], [read], [{ ...read, hash: 7 }], [{ ...read, hash: { a: 1 } }]].map((reads) =>
        here.ev(owner, 'trace', { reveal: PT, reads, rests }, PT, piece),
      );
      const version = here.ev(owner, 'version', { slug: 'traces', hash: PT }, PT);
      lines = chainLines(
        [...traces, version].map((event) => ({ event, received: [{ by: PEER, at: event.ts, custody: 'self' }] })),
        PT,
      );
      here.clock.tick += 60_000;
      const said = ['body.reads: 1 to 16 reads', ...Array(4).fill('read 0: url, hash and at')];
      const [pull] = await here.tracker.pullPeers();
      expect(pull).toEqual({
        peer: PEER,
        added: 1,
        refused: traces.map((t, i) => ({ id: eventId(t), why: said[i] })),
        errors: [],
      });
      expect(asked).toEqual([]);
      expect(here.store.lines(PT).map((l) => l.event.sig)).toEqual([version.sig]);
      // The same words a post of each gets at this door.
      for (const [i, t] of traces.entries()) {
        const direct = await here.post(`/p/${PT}/events`, t);
        expect([direct.status, ((await direct.json()) as { error: string }).error]).toEqual([400, said[i]]);
      }
      const doc = readFileSync(new URL('../../../docs/ext/QX-21.md', import.meta.url), 'utf8');
      expect(doc).toContain(
        'one that does not hash right is not kept, a read named by anything but a hash is not asked for, and the trace is refused as its own rule refuses it.',
      );
    } finally {
      await here.close();
    }
  });
});

describe('the stamp asked of a pulled name (QX-21 section 2, CORE.md section 11)', () => {
  it('refuses a name its peer took without the stamp this door asks, with the reason a post of it gets, and pulls a stamped one', async () => {
    const BITS = 8;
    const peer = boot(START, { limits });
    await peer.listen();
    const strict = boot(START, { limits, stamp: { name: BITS }, peers: [`${peer.base}/`] });
    await strict.listen();
    try {
      const plain = peer.ev(A, 'name', { name: 'Ada' });
      await peer.accepted('/k/events', plain);
      peer.clock.tick += 1000;
      const unsigned = {
        quilt: 1 as const,
        type: 'name',
        key: addr(B),
        ts: new Date(peer.clock.tick).toISOString(),
        body: { name: 'Bea' },
      };
      const stamped = signEvent(stamp(unsigned, BITS)!, B);
      await peer.accepted('/k/events', stamped);
      strict.clock.tick = peer.clock.tick + 60_000;
      const said = `a name event here carries a stamp of ${BITS} bits`;
      const [pull] = await strict.tracker.pullPeers();
      expect(pull).toEqual({
        peer: `${peer.base}/`,
        added: 1,
        refused: [{ id: eventId(plain), why: said }],
        errors: [],
      });
      expect(strict.store.lines(IDENTITY_LOG).map((l) => l.event.sig)).toEqual([stamped.sig]);
      // The same words a post of it gets at this door.
      const direct = await strict.post('/k/events', plain);
      expect([direct.status, ((await direct.json()) as { error: string }).error]).toEqual([400, said]);
      const doc = readFileSync(new URL('../../../docs/ext/QX-21.md', import.meta.url), 'utf8');
      expect(doc).toContain(
        'and the stamp this door asks of a name (CORE.md section 11), which the event carries, so a name the peer took without it is refused here as a post of it would be.',
      );
      expect(doc).toContain('The rate limits are not applied:');
    } finally {
      await peer.close();
      await strict.close();
    }
  });
});

describe('the pull through the door it is handed (peers.ts)', () => {
  it("reaches the tracker that runs it through its PullDoor alone: the door's admission decides each event, a refusal is said with why, a failure is noted, and a line admitted carries both wrappers", async () => {
    // One more name on the first's identity log, from a key whose event this door fails on.
    await one.accepted('/k/events', one.ev(A, 'name', { name: 'Grace' }));
    const store = new Store(':memory:');
    const admitted: string[] = [];
    const noted: string[] = [];
    const door: PullDoor = {
      store,
      url: 'http://elsewhere.test/',
      now: () => '2026-11-03T09:00:00.000Z',
      fetchImpl: fetch,
      peers: [one.base],
      admit: async (log, event, personSeat) => {
        admitted.push(`${log.kind} ${event.type} ${personSeat}`);
        if (event.type === 'hide') throw new Refusal(403, 'not a maintainer here');
        if (event.key === addr(A)) throw new Error('the door failed');
        return { chain: IDENTITY_LOG, word: { seen: true } };
      },
      noteAppended: (log, event, at) => noted.push(`${log.kind} ${event.type} ${at}`),
    };
    const [report] = await pullPeers(door);
    expect(admitted).toEqual(['identity name false', 'identity hide false', 'identity name false']);
    expect(report).toEqual({
      peer: `${one.base}/`,
      added: 1,
      refused: [{ id: expect.stringMatching(/^sha256:/), why: 'not a maintainer here' }],
      errors: [`${one.base}/k/events: the door failed`],
    });
    const lines = store.lines(IDENTITY_LOG);
    expect(lines.map((l) => [l.event.type, l.event.key])).toEqual([['name', addr(owner)]]);
    const theirs = lines[0]!.received[0]!;
    expect(theirs.by).toBe('http://tracker.test/');
    expect(lines[0]!.received[1]).toEqual({ by: 'http://elsewhere.test/', at: '2026-11-03T09:00:00.000Z', seen: true });
    expect(noted).toEqual([`identity name ${theirs.at}`]);
    store.close();
  });
});
