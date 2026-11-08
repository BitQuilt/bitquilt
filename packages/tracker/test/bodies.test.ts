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
  reduce,
} from '@bitquilt/core';
import { DEPTH_MAX } from '../src/admit.js';
import { reduceInputOf } from '../src/store.js';
import { VERDICT, addr, boot, envelope, key, line } from './helpers.js';

/**
 * PROTOCOL.md, What the door answers: a body a door takes is one its fold can take. An event, an envelope or a data
 * blob read as JSON that nests deeper than sixty-four levels (`DEPTH_MAX`), or holds a field named `__proto__`, is
 * refused with the body named, since the fold reads a body through recursive code deeper in the stack than the door,
 * and JSON makes `__proto__` an own field that an assignment by its name turns into an object's prototype; a peer's
 * line (QX-21) is held to the same, and the door answers every page throughout. The directory row counts what the
 * accepted squares found in objects with no prototype, so a field named `constructor` is counted as any other, a choice
 * named `constructor` too, and nothing is written outside the row. A log is read into the fold line by line, so one
 * longer than a call takes is read whole.
 */
const owner = key(9),
  A = key(1),
  B = key(2);
const limits = { keyPerHour: 1000, ipPerHour: 10000 };
const START = '2026-11-08T12:00:00Z';
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
/** A piece whose answer is one field named `constructor`, agreed on. */
const P = envelope(owner, 'bodies', {
  'statement/*': {
    count: 1,
    verifier: 'agree',
    requires: ['web'],
    brief: 'Statement {n}: does the paper say so?',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['constructor'],
      properties: { constructor: { enum: ['constructor', 'other'] } },
    },
    agree: ['constructor'],
  },
});
const p = problemHash(P);
const piece = reduce({ envelopes: [P], blobs: new Map(), receipts: [], now: START }).pieces[0]!.piece.hash;
const peer = boot(START, { limits });
let t: ReturnType<typeof boot>;

/** A value nested `n` levels deep. */
const nested = (n: number): unknown => {
  let v: unknown = 'x';
  for (let i = 1; i < n; i++) v = [v];
  return v;
};
/** A post of raw JSON text, and what the door answered. */
const posted = async (path: string, text: string) => {
  const r = await fetch(t.base + path, { method: 'POST', body: text, headers: { 'content-type': 'application/json' } });
  return { status: r.status, error: ((await r.json()) as { error?: string }).error };
};

beforeAll(async () => {
  await peer.listen();
  t = boot(START, { limits, peers: [`${peer.base}/`] });
  await t.listen();
  for (const d of [peer, t]) expect((await d.post('/p', { envelope: P })).status).toBe(201);
});
afterAll(async () => {
  await peer.close();
  await t.close();
});

describe('a body nested too deep, or with a field named __proto__', () => {
  it('is refused on an event before its shape, naming the body', async () => {
    expect(DEPTH_MAX).toBe(64);
    const deep = t.ev(A, 'name', { name: 'Ada', more: nested(DEPTH_MAX) });
    expect(await posted('/k/events', JSON.stringify(deep))).toEqual({
      status: 400,
      error: 'event: nested deeper than 64',
    });
    const named = JSON.stringify(t.ev(A, 'name', { name: 'Ada', more: 1 })).replace('"more":', '"__proto__":');
    expect(await posted('/k/events', named)).toEqual({ status: 400, error: 'event: a field named __proto__' });
  });

  it('is refused at publish, in an envelope or a data blob', async () => {
    const schemaNamed = JSON.stringify({
      envelope: envelope(owner, 'named', { 'q/*': { ...P.problem.pieces['statement/*']! } }),
    }).replaceAll('"constructor"', '"__proto__"');
    expect(await posted('/p', schemaNamed)).toEqual({ status: 400, error: 'envelope: a field named __proto__' });
    const deepSchema = envelope(owner, 'deep', {
      'q/*': {
        ...P.problem.pieces['statement/*']!,
        schema: { ...VERDICT, properties: { verdict: nested(DEPTH_MAX) as never } },
      },
    });
    expect(await posted('/p', JSON.stringify({ envelope: deepSchema }))).toEqual({
      status: 400,
      error: 'envelope: nested deeper than 64',
    });
    const bytes = new TextEncoder().encode(JSON.stringify([nested(DEPTH_MAX + 1)]));
    const withBlob = envelope(
      owner,
      'deep-blob',
      { 'q/*': { ...P.problem.pieces['statement/*']!, data: { c: 'c' } } },
      {
        data: { c: hashBytes(bytes) },
      },
    );
    expect(
      await posted(
        '/p',
        JSON.stringify({ envelope: withBlob, blobs: { [hashBytes(bytes)]: Buffer.from(bytes).toString('base64') } }),
      ),
    ).toEqual({ status: 400, error: `blob ${hashBytes(bytes)}: nested deeper than 64` });
    // At the limit, a blob is taken.
    const atLimit = new TextEncoder().encode(JSON.stringify([nested(DEPTH_MAX)]));
    const taken = envelope(
      owner,
      'blob-at-the-limit',
      { 'q/*': { ...P.problem.pieces['statement/*']!, data: { c: 'c' } } },
      {
        data: { c: hashBytes(atLimit) },
      },
    );
    expect(
      (
        await t.post('/p', {
          envelope: taken,
          blobs: { [hashBytes(atLimit)]: Buffer.from(atLimit).toString('base64') },
        })
      ).status,
    ).toBe(201);
    for (const path of ['/', '/search']) expect((await fetch(t.base + path)).status).toBe(200);
  });

  it("is refused on a peer's line, and the door answers throughout (QX-21)", async () => {
    const deep = peer.ev(B, 'claim', { by: by('openai/gpt'), more: nested(DEPTH_MAX) }, p, piece);
    peer.store.appendPulled(p, deep, eventId(deep), [{ by: 'http://peer.test/', at: deep.ts, custody: 'self' }]);
    t.clock.tick = peer.clock.tick + 60_000;
    const [pull] = await t.tracker.pullPeers();
    expect(pull!.refused).toEqual([{ id: eventId(deep), why: 'event: nested deeper than 64' }]);
    for (const path of ['/', '/search', `/p/${p}/state`]) expect((await fetch(t.base + path)).status).toBe(200);
  });
});

describe('what the accepted squares found', () => {
  it('counts a field named constructor as any other, and writes nothing outside the row', async () => {
    for (const [k, model] of [
      [A, 'anthropic/claude'],
      [B, 'openai/gpt'],
    ] as const) {
      const answer = { constructor: 'constructor' };
      const nonce = newNonce();
      await t.accepted(`/p/${p}/events`, t.ev(k, 'commit', { h: commitHash(answer, nonce) }, p, piece));
      await t.accepted(`/p/${p}/events`, t.ev(k, 'reveal', { return: answer, nonce, by: by(model) }, p, piece));
    }
    const rows = await t.get<{ problems: { problem: Hash; work: { found: unknown }; kinds: unknown }[] }>('/');
    const row = rows.problems.find((x) => x.problem === p)!;
    expect(row.work.found).toEqual({ constructor: { constructor: 1 } });
    expect(row.kinds).toEqual({ agree: 1 });
    expect(Object.hasOwn(Object, 'constructor')).toBe(false);
  });
});

describe('a long log', () => {
  it('is read into the fold line by line, longer than one call takes', () => {
    const name = t.ev(A, 'name', { name: 'Ada' });
    const lines: Receipt[] = Array.from({ length: 200_000 }, () => line(name, START));
    const input = reduceInputOf(
      { envelopeOf: () => null, getBlob: () => null, lines: (log) => (log === IDENTITY_LOG ? lines : []) },
      P,
      START,
    );
    expect(input.receipts).toHaveLength(200_000);
    expect(addr(A)).toBe(name.key);
  });
});
