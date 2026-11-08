import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Hash,
  type Receipt,
  type Unsigned,
  IDENTITY_LOG,
  commitHash,
  eventId,
  hashBytes,
  hashCanonical,
  newNonce,
  problemHash,
  signEvent,
  signObject,
  verifyChain,
} from '@bitquilt/core';
import { mirror } from '../src/mirror.js';
import { VERDICT, addr, by, calendarBytes, key, startTracker } from './helpers.js';

/**
 * The mirror over two real trackers: it writes the layout from one, with chains that verify and names from version
 * events; only grows, and writes the output once the problem is complete; takes the events a second tracker has that it
 * lacks onto its own chain, the union of both (NODE.md section 5); passes over a chain whose pages have no end, keeping
 * what it holds; anchors the head of every chain when asked, keeping a stamp it already has; writes the record document
 * of a problem with a record piece (QX-20) with the tracker's own layer code, the same hash as the tracker states; and
 * as the keeper, reads a node by its held list, keeps a problem its source no longer lists with its chain still
 * growing, and fetches the reads a trace names.
 */
const owner = key(9),
  A = key(1),
  B = key(2);
const cites = new TextEncoder().encode(JSON.stringify([{ s: 'one' }, { s: 'two' }]));
const citesHash = hashBytes(cites);

function envelope(): Envelope {
  const problem: Envelope['problem'] = {
    title: 'A report',
    done_when: 'Done.',
    owner: addr(owner),
    slug: 'report',
    prev: null,
    from: null,
    settings: { challenge_window_h: 0.001, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
    pieces: {
      'cite/*': {
        count: 2,
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

let tick = Date.parse('2026-10-25T09:00:00Z');
const now = () => new Date(tick).toISOString();
function ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash) {
  const u: Unsigned = { quilt: 1, type, key: addr(k), ts: now(), body };
  if (problem) u.problem = problem;
  if (piece) u.piece = piece;
  return signEvent(u, k);
}
const post = (base: string, path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
async function handIn(
  base: string,
  k: Uint8Array,
  problem: Hash,
  piece: Hash,
  ret: Record<string, unknown>,
  model: string,
) {
  const nonce = newNonce();
  expect(
    (await post(base, `p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece))).status,
  ).toBe(202);
  tick += 1000;
  expect(
    (await post(base, `p/${problem}/events`, ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece)))
      .status,
  ).toBe(202);
  tick += 1000;
}

const env = envelope();
const P = problemHash(env);
let one: { server: Server; base: string };
let two: { server: Server; base: string };
let pieces: Hash[];
const out = mkdtempSync(join(tmpdir(), 'bitquilt-mirror-'));

beforeAll(async () => {
  one = await startTracker(now);
  two = await startTracker(now);
  for (const t of [one, two])
    expect(
      (await post(t.base, 'p', { envelope: env, blobs: { [citesHash]: Buffer.from(cites).toString('base64') } }))
        .status,
    ).toBe(201);
  const state = (await (await fetch(`${one.base}p/${P}/state`)).json()) as { pieces: { hash: Hash }[] };
  pieces = state.pieces.map((p) => p.hash);
});
afterAll(async () => {
  await new Promise<void>((r) => one.server.close(() => r()));
  await new Promise<void>((r) => two.server.close(() => r()));
});

// The mirror names a chain's files by its hash, sha256 and a colon, which Windows refuses in a path; the mirror runs on
// Linux, and these tests do too.
describe.skipIf(process.platform === 'win32')('the mirror', () => {
  it('writes the layout from a tracker, with chains that verify and names from version events', async () => {
    expect((await post(one.base, `p/${P}/events`, ev(owner, 'version', { slug: 'report', hash: P }, P))).status).toBe(
      202,
    );
    expect((await post(one.base, 'k/events', ev(owner, 'name', { name: 'Maya' }))).status).toBe(202);
    await handIn(one.base, A, P, pieces[0]!, { verdict: 'supports' }, 'a/x');
    const report = await mirror({ trackers: [one.base], out, now });
    expect(report.refused).toEqual([]);
    expect(report.problems).toEqual([{ hash: P, lines: 3, added: 3, complete: false }]);
    expect(JSON.parse(readFileSync(join(out, 'problems', `${P}.json`), 'utf8'))).toEqual(env);
    expect(new Uint8Array(readFileSync(join(out, 'blobs', citesHash)))).toEqual(cites);
    const lines = readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Receipt);
    expect(verifyChain(lines, P).ok).toBe(true);
    expect(readFileSync(join(out, 'names', addr(owner), 'report'), 'utf8').trim()).toBe(P);
    const identity = readFileSync(join(out, 'ledger', 'identity.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Receipt);
    expect(verifyChain(identity, IDENTITY_LOG).ok).toBe(true);
    expect(JSON.parse(readFileSync(join(out, 'keys.json'), 'utf8'))[addr(owner)].name).toBe('Maya');
    expect(JSON.parse(readFileSync(join(out, 'index.json'), 'utf8')).problems[0].hash).toBe(P);
  });
  it('only grows, and writes the output once the problem is complete', async () => {
    await handIn(one.base, B, P, pieces[0]!, { verdict: 'supports' }, 'b/y');
    await handIn(one.base, A, P, pieces[1]!, { verdict: 'contradicts' }, 'a/x');
    await handIn(one.base, B, P, pieces[1]!, { verdict: 'contradicts' }, 'b/y');
    tick += 60 * 60 * 1000;
    const report = await mirror({ trackers: [one.base], out, now });
    expect(report.refused).toEqual([]);
    expect(report.problems[0]).toEqual({ hash: P, lines: 9, added: 6, complete: true });
    expect(existsSync(join(out, 'outputs', P, 'output.json'))).toBe(true);
    expect(readFileSync(join(out, 'outputs', P, 'hash'), 'utf8')).toMatch(/^sha256:[0-9a-f]{64}\n$/);
  });
  it('takes the events a second tracker has that it lacks onto its own chain, the union of both, and refuses nothing (NODE.md section 5)', async () => {
    await handIn(two.base, B, P, pieces[0]!, { verdict: 'supports' }, 'b/y');
    const report = await mirror({ trackers: [two.base], out, now });
    expect(report.refused).toEqual([]);
    expect(report.sources).toEqual([two.base]);
    expect(report.problems[0]).toMatchObject({ hash: P, lines: 11, added: 2 });
    const lines = readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Receipt);
    expect(lines).toHaveLength(11);
    expect(verifyChain(lines, P).ok).toBe(true);
    // Every line carries the tracker's wrapper and the mirror's own; every event is on the chain once.
    expect(lines.every((l) => l.received.map((w) => w.by).join(',') === 'http://t.test/,mirror')).toBe(true);
    expect(new Set(lines.map((l) => l.event.sig)).size).toBe(11);
    // The two from the second tracker are the last two, in its order, and the mirror's hashes are its own, not the
    // tracker's.
    expect(lines.slice(9).map((l) => l.event.key)).toEqual([addr(B), addr(B)]);
    const theirs = (await (await fetch(`${two.base}p/${P}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    expect(theirs.map((l) => l.hash)).not.toEqual(lines.slice(0, theirs.length).map((l) => l.hash));
  });
  it('passes over a chain whose pages have no end, and keeps the one it holds', async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      if (/\/p\/[^/]+\/events\?since=/.test(String(input)))
        return new Response('', { status: 200, headers: { 'x-quilt-next-since': '1' } });
      return fetch(input, init);
    };
    const report = await mirror({ trackers: [one.base], out, now, fetchImpl });
    expect(report.problems).toEqual([]);
    expect(report.refused).toEqual([]);
    expect(
      readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8')
        .split('\n')
        .filter(Boolean),
    ).toHaveLength(11);
  });
  it('anchors the head of every chain it holds when asked, and keeps a stamp it already has', async () => {
    let posts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      if (String(input) === 'https://cal.test/digest') {
        posts++;
        return new Response(calendarBytes, { status: 200 });
      }
      return fetch(input, init);
    };
    const report = await mirror({
      trackers: [one.base],
      out,
      now,
      anchor: { calendars: ['https://cal.test'] },
      fetchImpl,
    });
    expect(report.anchors?.failed).toEqual([]);
    expect(report.anchors?.stamped.map((a) => a.problem).sort()).toEqual([P, 'identity'].sort());
    const head = JSON.parse(
      readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8')
        .trim()
        .split('\n')
        .pop()!,
    ) as { seq: number; hash: string };
    expect(existsSync(join(out, 'anchors', P, `${head.seq}.ots`))).toBe(true);
    const side = JSON.parse(readFileSync(join(out, 'anchors', P, `${head.seq}.json`), 'utf8')) as {
      hash: string;
      calendar: string;
    };
    expect(side.hash).toBe(head.hash);
    expect(side.calendar).toBe('https://cal.test');
    const again = await mirror({
      trackers: [one.base],
      out,
      now,
      anchor: { calendars: ['https://cal.test'] },
      fetchImpl,
    });
    expect(again.anchors?.kept).toBe(2);
    expect(posts).toBe(2);
  });
  it('writes the record document of a problem with a record piece once the layer calls it complete, with the hash the tracker states (QX-20)', async () => {
    const problem: Envelope['problem'] = {
      title: 'A reading',
      done_when: 'Two readings on the record.',
      owner: addr(owner),
      slug: 'reading',
      prev: null,
      from: null,
      settings: { challenge_window_h: 0.001, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
      pieces: {
        question: { verifier: 'record:2', brief: 'Read the article your way.', schema: VERDICT, agree: ['verdict'] },
      },
      data: {},
    };
    const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
    const R: Envelope = { ...unsigned, sig: signObject(unsigned, owner) };
    const hash = problemHash(R);
    expect((await post(one.base, 'p', { envelope: R })).status).toBe(201);
    const piece = ((await (await fetch(`${one.base}p/${hash}/state`)).json()) as { pieces: { hash: Hash }[] })
      .pieces[0]!.hash;
    await handIn(one.base, A, hash, piece, { verdict: 'supports' }, 'a/x');
    const before = await mirror({ trackers: [one.base], out, now });
    expect(before.errors).toEqual([]);
    expect(existsSync(join(out, 'outputs', hash, 'record.json'))).toBe(false);
    await handIn(one.base, B, hash, piece, { verdict: 'contradicts' }, 'b/y');
    const report = await mirror({ trackers: [one.base], out, now });
    expect(report.errors).toEqual([]);
    // The core writes no output: it holds the piece as unknown. The layer's document is written beside where one would
    // be.
    expect(existsSync(join(out, 'outputs', hash, 'output.json'))).toBe(false);
    const doc = JSON.parse(readFileSync(join(out, 'outputs', hash, 'record.json'), 'utf8')) as {
      quilt: number;
      extension: string;
      pieces: { state: string; readings: { signer: string }[] }[];
    };
    expect(doc).toMatchObject({ quilt: 1, extension: 'QX-20' });
    expect(doc.pieces[0]).toMatchObject({ state: 'recorded' });
    expect(doc.pieces[0]!.readings.map((r) => r.signer)).toEqual([addr(A), addr(B)]);
    const written = readFileSync(join(out, 'outputs', hash, 'record_hash'), 'utf8').trim();
    expect(written).toBe(hashCanonical(doc));
    const state = (await (await fetch(`${one.base}p/${hash}/state`)).json()) as {
      complete: boolean;
      record_output: string | null;
    };
    expect(state.complete).toBe(true);
    expect(state.record_output).toBe(written);
  });
  it('keeps from a node by its held list, keeps a problem its source no longer lists with its chain growing, and fetches the reads a trace names', async () => {
    // A node at an address of its own: it says node: true, lists what tracker one holds, and serves the rest as the
    // tracker does.
    const node = 'http://node.test/';
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(node)) return fetch(input, init);
      const path = url.slice(node.length);
      if (path === '.well-known/quilt')
        return Response.json({
          quilt: 1,
          node: true,
          routes: ['/held', '/p/<hash>', '/p/<hash>/events', '/k/events', '/b/<hash>'],
        });
      if (path === 'held') {
        const idx = (await (await fetch(`${one.base}search?q=`)).json()) as {
          problems: { problem: Hash; title: string; slug: string; owner: string }[];
        };
        return Response.json({
          quilt: 1,
          node: true,
          problems: idx.problems.map((p) => ({
            problem: p.problem,
            title: p.title,
            slug: p.slug,
            owner: p.owner,
            lines: 0,
          })),
        });
      }
      return fetch(one.base + path, init);
    };
    const keep = mkdtempSync(join(tmpdir(), 'bitquilt-keeper-'));
    const first = await mirror({ trackers: [node], out: keep, now, fetchImpl });
    expect(first.errors).toEqual([]);
    expect(first.refused).toEqual([]);
    expect(first.kept).toEqual([]);
    const held = first.problems.map((p) => p.hash);
    expect(held).toContain(P);
    expect(held.length).toBeGreaterThanOrEqual(2);
    expect(
      JSON.parse(readFileSync(join(keep, 'index.json'), 'utf8')).problems.map((p: { tracker: string }) => p.tracker),
    ).toEqual(held.map(() => node));
    // The owner replaces the reading problem with a version: it leaves the tracker's index, and a reading on it still
    // lands on its chain.
    const R = JSON.parse(
      readFileSync(join(keep, 'problems', `${held.find((h) => h !== P)!}.json`), 'utf8'),
    ) as Envelope;
    const rHash = problemHash(R);
    // The brief changes, so the piece is a new one: the old piece's readings are in, and a record takes no more
    // (QX-20).
    const nextProblem: Envelope['problem'] = {
      ...R.problem,
      title: 'A reading, again',
      slug: 'reading',
      prev: rHash,
      pieces: { question: { ...R.problem.pieces.question!, brief: 'Read the article your way, once more.' } },
    };
    const nextUnsigned = { quilt: 1 as const, problem: nextProblem, hints: { trackers: [], mirrors: [] } };
    const N: Envelope = { ...nextUnsigned, sig: signObject(nextUnsigned, owner) };
    expect((await post(one.base, 'p', { envelope: N })).status).toBe(201);
    const nHash = problemHash(N);
    const listed = (
      (await (await fetch(`${one.base}search?q=`)).json()) as { problems: { problem: Hash }[] }
    ).problems.map((p) => p.problem);
    expect(listed).not.toContain(rHash);
    expect(listed).toContain(nHash);
    // A reading on the new version, resting on a page the tracker holds; its trace names the read.
    const nPiece = ((await (await fetch(`${one.base}p/${nHash}/state`)).json()) as { pieces: { hash: Hash }[] })
      .pieces[0]!.hash;
    const page = new TextEncoder().encode('All human beings are born free and equal in dignity and rights.');
    const pageHash = hashBytes(page);
    expect((await fetch(`${one.base}b/${pageHash}`, { method: 'PUT', body: page })).status).toBe(202);
    const ret = { verdict: 'supports' };
    const nonce = newNonce();
    expect(
      (await post(one.base, `p/${nHash}/events`, ev(A, 'commit', { h: commitHash(ret, nonce) }, nHash, nPiece))).status,
    ).toBe(202);
    tick += 1000;
    const reveal = ev(A, 'reveal', { return: ret, nonce, by: by('a/x') }, nHash, nPiece);
    expect((await post(one.base, `p/${nHash}/events`, reveal)).status).toBe(202);
    tick += 1000;
    expect(
      (
        await post(
          one.base,
          `p/${nHash}/events`,
          ev(
            A,
            'trace',
            {
              reveal: eventId(reveal),
              reads: [{ url: 'https://example.org/udhr', hash: pageHash, at: now() }],
              rests: [{ field: 'verdict', read: 0, span: [0, 16] }],
            },
            nHash,
            nPiece,
          ),
        )
      ).status,
    ).toBe(202);
    tick += 1000;
    const second = await mirror({ trackers: [node], out: keep, now, fetchImpl });
    expect(second.errors).toEqual([]);
    expect(second.refused).toEqual([]);
    expect(second.kept).toEqual([]);
    // The replaced problem is still in the index, taken by hash from the source that still serves it; the version is
    // beside it; the read is kept.
    const hashes = second.problems.map((p) => p.hash);
    expect(hashes).toContain(rHash);
    expect(hashes).toContain(nHash);
    expect(
      JSON.parse(readFileSync(join(keep, 'index.json'), 'utf8')).problems.map((p: { hash: Hash }) => p.hash),
    ).toEqual(expect.arrayContaining([P, rHash, nHash]));
    expect(new Uint8Array(readFileSync(join(keep, 'blobs', pageHash)))).toEqual(page);
    // A source that serves nothing of what is held: every problem stays in the index as the files have it, and the run
    // says which.
    const empty = 'http://empty.test/';
    const nothing: typeof fetch = async (input, init) => {
      const url = String(input);
      if (!url.startsWith(empty)) return fetch(input, init);
      const path = url.slice(empty.length);
      if (path === '.well-known/quilt') return Response.json({ quilt: 1, node: true });
      if (path === 'held') return Response.json({ quilt: 1, node: true, problems: [] });
      return new Response('', { status: 404 });
    };
    const third = await mirror({ trackers: [empty], out: keep, now, fetchImpl: nothing });
    expect(third.problems).toEqual([]);
    expect(third.kept.sort()).toEqual(hashes.sort());
    expect(JSON.parse(readFileSync(join(keep, 'index.json'), 'utf8')).problems).toHaveLength(hashes.length);
  });
  it("follows each configured source's peers one hop, so a mirror pointed at one tracker keeps the swarm it names, and not when told not to", async () => {
    const three = await startTracker(now, { peers: [two.base] });
    const swarm = mkdtempSync(join(tmpdir(), 'bitquilt-swarm-'));
    const report = await mirror({ trackers: [three.base], out: swarm, now });
    expect(report.sources).toEqual([three.base, two.base]);
    expect(report.errors).toEqual([]);
    expect(report.problems.map((p) => p.hash)).toContain(P);
    expect(existsSync(join(swarm, 'ledger', `${P}.jsonl`))).toBe(true);
    const alone = await mirror({
      trackers: [three.base],
      out: mkdtempSync(join(tmpdir(), 'bitquilt-alone-')),
      now,
      peers: false,
    });
    expect(alone.sources).toEqual([three.base]);
    expect(alone.problems).toEqual([]);
    await new Promise<void>((r) => three.server.close(() => r()));
  });
});
