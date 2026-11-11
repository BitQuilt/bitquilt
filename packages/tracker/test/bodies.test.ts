import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, type Receipt, commitHash, eventId, hashBytes, newNonce, problemHash, reduce } from '@bitquilt/core';
import { DEPTH_MAX, PIECES_MAX } from '../src/admit.js';
import { reduceInputOf } from '@bitquilt/core';
import { VERDICT, addr, boot, envelope, key, line } from './helpers.js';

/**
 * PROTOCOL.md, What the door answers: a body a door takes is one its fold can take. An event, an envelope or a data
 * blob read as JSON that nests deeper than sixty-four levels (`DEPTH_MAX`), or holds a field named `__proto__`, is
 * refused with the body named, a blob held already as well as one sent, and an event ten thousand levels deep too,
 * since the fold reads a body through recursive code deeper in the stack than the door, and JSON makes `__proto__` an
 * own field that an assignment by its name turns into an object's prototype. A peer's line (QX-21) whose event or
 * wrapper is over the bound is refused and the lines after it pulled, a chain too deep to verify is left whole and
 * said, a peer whose pull fails is noted and the next is pulled,
 * and the door answers every page throughout. Where the core looks a name up with `in`, the door asks for the
 * problem's own: an `agree` or `required` field, a data slot's blob and a return's field that only every object has
 * are refused in the core's words. A family over ten thousand pieces (`PIECES_MAX`) is refused before it is expanded.
 * The directory row counts what the accepted squares found in objects with no prototype, so a field named
 * `constructor` is counted as any other, a choice named `constructor` too, and nothing is written outside the row. A
 * log is read into the fold line by line, so one longer than a call takes is read whole.
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
    // Ten thousand levels, deeper than the core's canonical form reads.
    const far = JSON.stringify(t.ev(A, 'name', { name: 'Ada', more: 'deep' })).replace(
      '"deep"',
      `${'['.repeat(10_000)}"x"${']'.repeat(10_000)}`,
    );
    expect(await posted('/k/events', far)).toEqual({ status: 400, error: 'event: nested deeper than 64' });
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
    // A blob with a field named __proto__, and a deep blob held already, put first and named after.
    const protoBytes = new TextEncoder().encode('[{"__proto__":{"text":"x"}}]');
    const withProto = envelope(
      owner,
      'proto-blob',
      { 'q/*': { ...P.problem.pieces['statement/*']!, data: { c: 'c' } } },
      {
        data: { c: hashBytes(protoBytes) },
      },
    );
    expect(
      await posted(
        '/p',
        JSON.stringify({
          envelope: withProto,
          blobs: { [hashBytes(protoBytes)]: Buffer.from(protoBytes).toString('base64') },
        }),
      ),
    ).toEqual({ status: 400, error: `blob ${hashBytes(protoBytes)}: a field named __proto__` });
    const held = new TextEncoder().encode(JSON.stringify([nested(DEPTH_MAX + 1), 1]));
    expect((await fetch(`${t.base}/b/${hashBytes(held)}`, { method: 'PUT', body: held })).status).toBe(202);
    const naming = envelope(
      owner,
      'held-blob',
      { 'q/*': { ...P.problem.pieces['statement/*']!, data: { c: 'c' } } },
      {
        data: { c: hashBytes(held) },
      },
    );
    expect(await posted('/p', JSON.stringify({ envelope: naming }))).toEqual({
      status: 400,
      error: `blob ${hashBytes(held)}: nested deeper than 64`,
    });
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

  it("refuses a peer's line whose event or wrapper is over the bound, pulls the lines after it, and the door answers (QX-21)", async () => {
    const deep = peer.ev(B, 'claim', { by: by('openai/gpt'), more: nested(DEPTH_MAX) }, p, piece);
    peer.store.appendPulled(p, deep, eventId(deep), [{ by: 'http://peer.test/', at: deep.ts, custody: 'self' }]);
    const proto = peer.ev(key(4), 'claim', { by: by('openai/gpt') }, p, piece);
    peer.store.appendPulled(p, proto, eventId(proto), [
      { ['__proto__']: { seat: 'person' }, by: 'http://peer.test/', at: proto.ts, custody: 'self' } as never,
    ]);
    const honest = peer.ev(key(5), 'claim', { by: by('anthropic/claude') }, p, piece);
    await peer.accepted(`/p/${p}/events`, honest);
    t.clock.tick = peer.clock.tick + 60_000;
    const [pull] = await t.tracker.pullPeers();
    expect(pull!.refused).toEqual([
      { id: eventId(deep), why: 'event: nested deeper than 64' },
      { id: eventId(proto), why: 'received: a field named __proto__' },
    ]);
    expect(pull!.errors).toEqual([]);
    const held = (await (await fetch(`${t.base}/p/${p}/events`)).text()).trim().split('\n');
    expect(held.map((l) => (JSON.parse(l) as { event: { sig: string } }).event.sig)).toContain(honest.sig);
    for (const path of ['/', '/search', `/p/${p}/state`]) expect((await fetch(t.base + path)).status).toBe(200);
  });

  it('notes in its report a peer whose chain is too deep to verify, malformed, or more than a call takes, and pulls the next', async () => {
    const far = `{"event":{"type":"name","more":${'['.repeat(20_000)}"x"${']'.repeat(20_000)}},"received":[]}`;
    const many = Array.from({ length: 130_000 }, () => '{}').join('\n');
    const pages: Record<string, string> = {
      'http://deep.test/k/events?since=0': far,
      'http://broken.test/k/events?since=0': '{"event":',
      'http://many.test/k/events?since=0': many,
    };
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.endsWith('/.well-known/quilt')) return new Response('{}');
      return url in pages ? new Response(pages[url]) : new Response('', { status: 404 });
    }) as typeof fetch;
    const peers = ['http://deep.test/', 'http://broken.test/', 'http://many.test/'];
    const u = boot(START, { limits, peers, fetchImpl });
    const pulls = await u.tracker.pullPeers();
    expect(pulls).toHaveLength(3);
    expect(pulls[0]!.errors[0]).toMatch(/^http:\/\/deep\.test\/k\/events: chain cannot be verified: /);
    expect(pulls[1]!.errors[0]).toMatch(/^http:\/\/broken\.test\/: /);
    expect(pulls[2]!.errors[0]).toMatch(/^http:\/\/many\.test\/k\/events: chain does not verify: /);
  });
});

describe('a name the core looks up with in', () => {
  it('is refused at publish where it is not the problem own, and a family over the piece ceiling is refused before it is expanded', async () => {
    const q = P.problem.pieces['statement/*']!;
    const publishing = async (e: ReturnType<typeof envelope>) => posted('/p', JSON.stringify({ envelope: e }));
    expect(
      await publishing(
        envelope(owner, 'agree-inherited', { 'q/*': { ...q, schema: VERDICT, agree: ['constructor'] } }),
      ),
    ).toEqual({
      status: 400,
      error: 'problem.pieces.q/*.agree: names fields the schema has',
    });
    expect(
      await publishing(
        envelope(owner, 'required-inherited', {
          'q/*': { ...q, schema: { ...VERDICT, required: ['verdict', 'toString'] }, agree: ['verdict'] },
        }),
      ),
    ).toEqual({ status: 400, error: 'problem.pieces.q/*.schema: required names toString, which is not a property' });
    expect(await publishing(envelope(owner, 'blob-inherited', { 'q/*': { ...q, data: { c: 'valueOf' } } }))).toEqual({
      status: 400,
      error: 'problem.pieces.q/*.data: valueOf is not a blob of this problem',
    });
    expect(
      await publishing(
        envelope(owner, 'too-many', { 'q/*': { ...q, count: PIECES_MAX + 1 } }, { settings: { budget: 1e9 } }),
      ),
    ).toEqual({
      status: 400,
      error: `problem.pieces: ${PIECES_MAX + 1} pieces after expansion, over the ${PIECES_MAX} a door takes`,
    });
  });

  it('is refused on a return where it is not one of the schema own fields', async () => {
    const answer = { constructor: 'constructor', toString: { note: 'held under a name every object has' } };
    const nonce = newNonce();
    await t.accepted(`/p/${p}/events`, t.ev(key(3), 'commit', { h: commitHash(answer, nonce) }, p, piece));
    expect(
      await t.refused(
        `/p/${p}/events`,
        t.ev(key(3), 'reveal', { return: answer, nonce, by: by('anthropic/claude') }, p, piece),
      ),
    ).toBe('return.toString: not a field of the schema');
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
    const input = reduceInputOf({ envelopeOf: () => null, getBlob: () => null, lines: () => lines }, P, START);
    expect(input.receipts).toHaveLength(400_000);
    expect(addr(A)).toBe(name.key);
  });
});
