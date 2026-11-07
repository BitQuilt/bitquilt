/**
 * docs/CLIENT.md, Writing a client, held to the code it describes. The worked example: fixture 04's first claim, on
 * `cite/1`, its canonical bytes, its id, the EIP-191 digest, `r`, `s`, `v` and the signature, and the commit that binds
 * the reveal after it, are what the core computes, and the signature is the fixture's. The six steps: the requests
 * written under "A first return, in six steps", run in their order against a tracker with each placeholder filled, are
 * answered as the page says, the offer and next naming one piece, every event taken with the answer the page names and
 * a read put with its own. The door's checks: each row of the table under "What the door checks, in order" is met by a
 * post that fails that check, with the row's status and one of its sentences; a post that fails several is refused for
 * the earliest, row by row as each is put right; a reveal posted again meets its commit's row rather than 409; and
 * every row is met. Beside the table: the door leaves a reveal's `h` to the reducer, and next refuses the three
 * sentences the page names. The well-known fields the page names are in the well-known document, its links reach a
 * file and a heading, and it has no U+2014.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Event,
  type Hash,
  type ReduceInput,
  type Unsigned,
  canonical,
  commitHash,
  eventId,
  hashBytes,
  hashText,
  newNonce,
  personalHash,
  problemHash,
  recoverSigner,
  reduce,
  signEvent,
  signMessage,
  signedBytes,
} from '@bitquilt/core';
import { type Booted, addr, boot, envelope, key } from './helpers.js';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs');
const DOC = readFileSync(join(DOCS, 'CLIENT.md'), 'utf8');
const FIXTURE = join(DOCS, '..', 'packages', 'core', 'fixtures', '04-agreement-provisional-then-accepted.json');

const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  M = key(8);
const T0 = '2026-11-07T12:00:00Z';
/** The schema of fixture 04's `cite` family, which the page's return is written for. */
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict', 'quote'],
  properties: {
    verdict: { enum: ['supports', 'contradicts', 'unreachable'] },
    quote: { type: 'string' as const, maxLength: 160 },
  },
};
const cite = (brief: string) => ({
  verifier: 'agree',
  requires: ['web' as const],
  brief,
  schema,
  agree: ['verdict'],
});
const by = (model: string, can: string[] = ['web']) => ({ model, client: 'worker/1', can });

/** The page's text under a heading, to the next heading of the same level or above. */
function section(heading: string): string {
  const lines = DOC.split('\n');
  const at = lines.indexOf(heading);
  if (at < 0) throw new Error(`CLIENT.md has no heading ${heading}`);
  const level = heading.indexOf(' ');
  const end = lines.findIndex((l, i) => i > at && /^#+ /.test(l) && l.indexOf(' ') <= level);
  return lines.slice(at + 1, end < 0 ? undefined : end).join('\n');
}

/** The names a text gives in backticks. */
const named = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** A sentence as the page writes it, as a pattern: `N` stands for a number and `<type>` for a word. */
function pattern(sentence: string): RegExp {
  const escaped = sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\bN\b/g, '\\d+').replace('<type>', '\\S+')}$`);
}

/** A row of the door's table: its number, its status, and the sentences it is refused with. */
interface Row {
  n: number;
  status: number;
  sentences: RegExp[];
}
const rows: Row[] = section('## What the door checks, in order')
  .split('\n')
  .filter((l) => l.startsWith('|'))
  .slice(2)
  .map((l) => {
    const [n, , status, refused] = l
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    return { n: Number(n), status: Number(status), sentences: named(refused!).map(pattern) };
  });

/** What the door answered: its status and its sentence. */
interface Answer {
  status: number;
  error?: string;
}
async function raw(t: Booted, path: string, body: string): Promise<Answer> {
  const r = await fetch(t.base + path, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
  const text = await r.text();
  return r.status >= 400
    ? { status: r.status, error: (JSON.parse(text) as { error: string }).error }
    : { status: r.status };
}
const met = new Set<number>();
/** That the answer is the row's: its status, and one of its sentences. */
function meets(n: number, a: Answer): void {
  const row = rows.find((r) => r.n === n);
  expect(row, `row ${n}`).toBeDefined();
  expect(a.status, `row ${n}: ${a.error}`).toBe(row!.status);
  expect(
    row!.sentences.some((s) => s.test(a.error ?? '')),
    `row ${n} names "${a.error}"`,
  ).toBe(true);
  met.add(n);
}

/** A placeholder's value, or a failure naming it. */
function valueOf(name: string, values: Record<string, unknown>): unknown {
  if (!(name in values)) throw new Error(`CLIENT.md asks for <${name}>, which the test does not fill`);
  return values[name];
}
/** The page's JSON with each placeholder filled. */
function fill(value: unknown, values: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const m = /^<([a-z]+)>$/.exec(value);
    return m ? valueOf(m[1]!, values) : value;
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, values));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, values)]));
  return value;
}
const fillPath = (path: string, values: Record<string, unknown>): string =>
  path.replace(/<([a-z]+)>/g, (_, name: string) => String(valueOf(name, values)));

/** A request the page writes: its method and path, and the event it posts, where it posts one. */
interface PageRequest {
  method: string;
  path: string;
  event: Record<string, unknown> | null;
}
const requests: PageRequest[] = [...section('## A first return, in six steps').matchAll(/^```\n([\s\S]*?)^```$/gm)].map(
  (m) => {
    const [line, ...rest] = m[1]!.trimEnd().split('\n');
    const [method, path] = line!.split(' ');
    return {
      method: method!,
      path: path!,
      event: rest.length ? (JSON.parse(rest.join('\n')) as Record<string, unknown>) : null,
    };
  },
);

describe("CLIENT.md, fixture 04's first claim, worked", () => {
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Omit<ReduceInput, 'blobs'> & {
    blobs: Record<string, string>;
  };
  const [claim, commit, reveal] = fixture.receipts.map((r) => r.event) as [Event, Event, Event];

  it("prints the bytes, id, digest and signature the core computes, and the signature is the fixture's", () => {
    expect(claim.type).toBe('claim');
    const blobs = new Map(Object.entries(fixture.blobs).map(([h, b]) => [h as Hash, Buffer.from(b, 'base64')]));
    const state = reduce({ ...fixture, blobs });
    expect(state.byHash.get(claim.piece!)!.piece.name).toBe('cite/1');
    expect(DOC).toContain("opens with a claim on `cite/1` by the fixtures' key 1");
    const bytes = signedBytes(claim as unknown as Record<string, unknown>);
    expect(DOC).toContain(`   ${new TextDecoder().decode(bytes)}\n`);
    expect(DOC).toContain(`these ${bytes.length} bytes`);
    expect(DOC).toContain(`\`${eventId(claim)}\``);
    expect('\x19Ethereum Signed Message:\n'.length).toBe(26);
    expect(DOC).toContain(
      `the 26 bytes \`\\x19Ethereum Signed Message:\\n\`, then the length in decimal, \`${bytes.length}\``,
    );
    expect(DOC).toContain(`\`${Buffer.from(personalHash(bytes)).toString('hex')}\``);
    const sig = signMessage(bytes, A);
    expect(sig).toBe(claim.sig);
    expect(DOC).toContain(`\`r\` is \`${sig.slice(2, 66)}\`, \`s\` is \`${sig.slice(66, 130)}\``);
    expect(parseInt(sig.slice(130), 16)).toBe(28);
    expect(DOC).toContain(`so \`v\` is 28, \`${sig.slice(130)}\``);
    expect(DOC).toContain(`\`${sig}\`, the fixture's \`sig\``);
    expect(recoverSigner(claim as unknown as Record<string, unknown>)).toBe(addr(A));
    expect(DOC).toContain(`\`${addr(A)}\``);
  });

  it('binds the commit to the reveal after it as the page says', () => {
    expect([commit.type, reveal.type]).toEqual(['commit', 'reveal']);
    const ret = reveal.body.return as Record<string, unknown>;
    const nonce = reveal.body.nonce as string;
    expect(commitHash(ret, nonce)).toBe(commit.body.h);
    expect(DOC).toContain(`\`${canonical(ret)}\` followed by the nonce \`${nonce}\``);
    expect(DOC).toContain(`\`${commit.body.h as string}\`, the commit's \`h\``);
  });
});

describe('CLIENT.md, a first return in six steps', () => {
  const walk = boot(T0);
  const W = envelope(owner, 'walk', {
    'cite/*': { ...cite('Citation {n}: does the page support the claim? Give the verdict and the passage.'), count: 2 },
  });
  const page = new TextEncoder().encode('A sentence of the page that the verdict rests on. '.repeat(12));
  beforeAll(async () => {
    await walk.listen();
    expect((await walk.post('/p', { envelope: W })).status).toBe(201);
  });
  afterAll(() => walk.close());

  it('writes the requests in the order of the steps', () => {
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /.well-known/quilt',
      'GET /offer?key=<key>&can=web&model=<model>',
      'GET /p/<problem>/next?key=<key>&can=web&model=<model>',
      'POST /p/<problem>/events',
      'POST /p/<problem>/events',
      'POST /p/<problem>/events',
      'PUT /b/<read>',
      'POST /p/<problem>/events',
      'POST /p/<problem>/events',
    ]);
    expect(requests.flatMap((r) => (r.event ? [r.event.type] : []))).toEqual([
      'claim',
      'commit',
      'reveal',
      'trace',
      'decline',
    ]);
  });

  it('is answered as the page says at every step, with the placeholders filled', async () => {
    const taken = /answers every event it takes with `202 \{ ([a-z, ]+) \}`/.exec(DOC);
    const kept = /The answer is `202 \{ ([a-z, ]+) \}`/.exec(DOC);
    expect(taken, "the page names an event's answer").not.toBeNull();
    expect(kept, "the page names a read's answer").not.toBeNull();
    const values: Record<string, unknown> = {
      key: addr(A),
      model: 'anthropic/claude',
      client: 'worker/1',
      nonce: newNonce(),
      quote: 'A sentence of the page that the verdict rests on.',
      url: 'https://example.org/page',
      read: hashBytes(page),
    };
    const reveal = requests.find((r) => r.event?.type === 'reveal')!.event as { body: { return: unknown } };
    values.h = commitHash(fill(reveal.body.return, values), values.nonce as string);
    const answers: Record<string, unknown>[] = [];
    for (const r of requests) {
      const path = fillPath(r.path, values);
      if (r.method === 'GET') {
        const res = await fetch(walk.base + path);
        expect(res.status, path).toBe(200);
        answers.push((await res.json()) as Record<string, unknown>);
      } else if (r.method === 'PUT') {
        const res = await fetch(walk.base + path, { method: 'PUT', body: page });
        expect(res.status, path).toBe(202);
        const body = (await res.json()) as Record<string, unknown>;
        expect(Object.keys(body).sort()).toEqual(kept![1]!.split(', ').sort());
        expect(body).toEqual({ hash: values.read, bytes: page.length });
      } else {
        walk.clock.tick += 1000;
        values.ts = values.at = new Date(walk.clock.tick).toISOString();
        // The `sig` is left out and made last, over the rest, as the page says.
        const { sig, ...rest } = r.event!;
        expect(sig).toBe('<sig>');
        const unsigned = fill(rest, values) as Record<string, unknown>;
        const res = await walk.post(path, signEvent(unsigned as unknown as Unsigned, A));
        const body = (await res.json()) as Record<string, unknown>;
        expect(res.status, `${unsigned.type}: ${JSON.stringify(body)}`).toBe(202);
        expect(Object.keys(body).sort()).toEqual(taken![1]!.split(', ').sort());
        if (unsigned.type === 'reveal') values.reveal = body.id;
      }
      // Step 2: the offer names the problem and the piece, and next on the problem names the same piece.
      if (r.path.startsWith('/offer')) {
        const first = (answers.at(-1) as { offers: { problem: Hash; piece: Hash }[] }).offers[0]!;
        expect(first.problem).toBe(problemHash(W));
        values.problem = first.problem;
        values.piece = first.piece;
      }
      if (r.path.includes('/next')) {
        const handed = answers.at(-1) as { piece: Hash; brief: string; schema: unknown };
        expect(handed.piece).toBe(values.piece);
        expect(handed.schema).toEqual(schema);
        expect(handed.brief).toMatch(/^Citation [12]: does the page support the claim\?/);
      }
      // The decline gives back the piece the walk did not take.
      if (r.event?.type === 'trace') {
        const { pieces } = await walk.get<{ pieces: { hash: Hash; traces: number }[] }>(`/p/${values.problem}/state`);
        expect(pieces.find((p) => p.hash === values.piece)!.traces).toBe(1);
        values.piece = pieces.find((p) => p.hash !== values.piece)!.hash;
      }
    }
  });
});

describe('CLIENT.md, what the door checks, in order', () => {
  const door = boot(T0, { limits: { keyPerHour: 1000, ipPerHour: 10000 }, maintainers: [addr(M)] });
  const P = envelope(owner, 'door', {
    cite: cite('Does the page support the claim? Give the verdict and the passage.'),
    staked: cite('Does the second page support the claim? Give the verdict and the passage.'),
    person: { ...cite('Does the page read as fair to you? Give the verdict and the passage.'), verifier: 'human' },
    record: { ...cite('How does the page read the claim? Give the verdict and the passage.'), verifier: 'record:2' },
    lint: {
      verifier: 'check',
      requires: ['shell' as const],
      brief: 'Run the lint.',
      workspace: { repo: 'https://example.org/r', base: 'abc' },
      check: { file: 'lint.sh' },
    },
  });
  const Q = envelope(owner, 'other', { cite: cite('Does the other page support the claim?') });
  const H = envelope(owner, 'hidden', { cite: cite('Does the hidden page support the claim?') });
  const [p, q, h] = [problemHash(P), problemHash(Q), problemHash(H)];
  const pieces: Record<string, Hash> = {};
  const events = `/p/${p}/events`;
  /** A commit and its reveal by the key on a piece of P; the reveal's id. */
  async function returned(k: Uint8Array, model: string, piece: Hash, ret: Record<string, unknown>): Promise<Hash> {
    const nonce = newNonce();
    await door.accepted(events, door.ev(k, 'commit', { h: commitHash(ret, nonce) }, p, piece));
    return door.accepted(events, door.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, p, piece));
  }
  beforeAll(async () => {
    await door.listen();
    for (const e of [P, Q, H]) expect((await door.post('/p', { envelope: e })).status).toBe(201);
    for (const x of (await door.get<{ pieces: { name: string; hash: Hash }[] }>(`/p/${p}/state`)).pieces)
      pieces[x.name] = x.hash;
    await door.accepted(events, door.ev(owner, 'stake_rule', { min: 1, pieces: ['staked'] }, p));
  });
  afterAll(() => door.close());

  it('has a row for each of the twenty checks, numbered in order, each with a status and a sentence', () => {
    expect(rows.map((r) => r.n)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    for (const r of rows) {
      expect(r.status, `row ${r.n}`).toBeGreaterThanOrEqual(400);
      expect(r.sentences.length, `row ${r.n}`).toBeGreaterThan(0);
    }
  });

  it('refuses a post that fails several checks for the earliest, row by row as each is put right', async () => {
    const ret = { verdict: 'maybe', quote: 'Read it at https://example.org/page' };
    const nonce = newNonce();
    const now = () => new Date((door.clock.tick += 1000)).toISOString();
    const u: Unsigned = {
      quilt: 1,
      type: 'Reveal',
      problem: q,
      piece: hashText('no such piece'),
      key: addr(A),
      ts: 'yesterday',
      body: { return: ret, nonce, by: by('anthropic/claude') },
    };
    const signed = (k: Uint8Array): string =>
      JSON.stringify(signEvent({ ...u, body: { ...u.body, return: { ...ret } } }, k));
    const seen: number[] = [];
    const step = async (n: number, path: string, body: string): Promise<void> => {
      meets(n, await raw(door, path, body));
      seen.push(n);
    };
    await step(1, `/p/${hashText('no such problem')}/events`, 'not JSON');
    await step(4, events, 'not JSON');
    await step(5, events, signed(B));
    u.ts = now();
    await step(6, events, signed(B));
    await step(8, events, signed(A));
    u.type = 'reveal';
    await step(9, events, signed(A));
    u.problem = p;
    await step(11, events, signed(A));
    u.piece = pieces.staked!;
    await step(12, events, signed(A));
    u.piece = pieces.cite!;
    await step(14, events, signed(A));
    ret.verdict = 'supports';
    await step(15, events, signed(A));
    ret.quote = 'The page says the claim holds.';
    await step(16, events, signed(A));
    const commit = JSON.stringify(door.ev(A, 'commit', { h: commitHash(ret, nonce) }, p, pieces.cite));
    expect((await raw(door, events, commit)).status).toBe(202);
    await step(20, events, commit);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    // The door admits before it dedupes: the reveal posted again meets its commit's check, the commit now revealed.
    expect(DOC).toContain('so a reveal posted again meets row 16, its commit revealed, and is not answered `409`');
    u.ts = now();
    const reveal = signed(A);
    expect((await raw(door, events, reveal)).status).toBe(202);
    meets(16, await raw(door, events, reveal));
  });

  it("counts the address's writes and the key's posts before it reads the event", async () => {
    const tight = boot(T0, { limits: { keyPerHour: 1, ipPerHour: 4 } });
    await tight.listen();
    try {
      expect((await tight.post('/p', { envelope: P })).status).toBe(201);
      const claim = (k: Uint8Array, piece: Hash) => tight.ev(k, 'claim', { by: by('anthropic/claude') }, p, piece);
      await tight.accepted(events, claim(A, pieces.cite!));
      meets(7, await raw(tight, events, JSON.stringify(claim(A, hashText('no such piece')))));
      meets(11, await raw(tight, events, JSON.stringify(claim(B, hashText('no such piece')))));
      meets(2, await raw(tight, events, 'not JSON'));
    } finally {
      await tight.close();
    }
  });

  it('refuses a body over 4 MB before it reads it', async () => {
    meets(3, await raw(door, events, 'x'.repeat(4 * 1024 * 1024 + 1)));
  });

  it('refuses a post on a problem taken down before it looks for the piece', async () => {
    await door.accepted('/k/events', door.ev(M, 'hide', { id: h, why: 'Taken down for the test.' }));
    meets(
      10,
      await raw(
        door,
        `/p/${h}/events`,
        JSON.stringify(
          door.ev(
            A,
            'reveal',
            { return: {}, nonce: newNonce(), by: by('anthropic/claude') },
            h,
            hashText('no such piece'),
          ),
        ),
      ),
    );
  });

  it('refuses work on a record piece whose readings are in before it reads the return', async () => {
    await returned(A, 'anthropic/claude', pieces.record!, { verdict: 'supports', quote: 'The page reads it so.' });
    await returned(B, 'openai/gpt-5', pieces.record!, {
      verdict: 'contradicts',
      quote: 'The page reads it otherwise.',
    });
    const off = { verdict: 'maybe', quote: 'Read it at https://example.org/page' };
    meets(
      13,
      await raw(
        door,
        events,
        JSON.stringify(
          door.ev(C, 'reveal', { return: off, nonce: newNonce(), by: by('google/gemini') }, p, pieces.record),
        ),
      ),
    );
  });

  it("refuses a reveal on a human piece from a seat that is not a person's", async () => {
    const ret = { verdict: 'supports', quote: 'It reads as fair.' };
    const nonce = newNonce();
    await door.accepted(events, door.ev(A, 'commit', { h: commitHash(ret, nonce) }, p, pieces.person));
    const reveal = door.ev(A, 'reveal', { return: ret, nonce, by: by('anthropic/claude') }, p, pieces.person);
    meets(17, await raw(door, events, JSON.stringify(reveal)));
  });

  it('refuses a run that names no revealed return', async () => {
    const run = {
      digest: hashText('no such patch'),
      exit: 0,
      host: 'linux/x64',
      by: by('anthropic/claude', ['shell']),
    };
    meets(18, await raw(door, events, JSON.stringify(door.ev(A, 'run', run, p, pieces.lint))));
  });

  it('refuses a trace that names a read the tracker does not hold', async () => {
    const id = await returned(C, 'google/gemini', pieces.cite!, { verdict: 'supports', quote: 'The page says so.' });
    const read = { url: 'https://example.org/page', hash: hashText('a read not put'), at: T0, media: 'text/plain' };
    const trace = { reveal: id, reads: [read], rests: [{ field: 'quote', read: 0, span: [0, 10] }] };
    meets(19, await raw(door, events, JSON.stringify(door.ev(C, 'trace', trace, p, pieces.cite))));
  });

  it('meets every row', () => {
    expect([...met].sort((a, b) => a - b)).toEqual(rows.map((r) => r.n));
  });

  it("takes a reveal whose return and nonce miss the commit's h, and the reducer drops it", async () => {
    expect(DOC).toContain('It does not check `h`.');
    expect(DOC).toContain('as `no commit by this key with this hash`');
    const ret = { verdict: 'supports', quote: 'The page says so.' };
    await door.accepted(events, door.ev(B, 'commit', { h: commitHash(ret, newNonce()) }, p, pieces.cite));
    const id = await door.accepted(
      events,
      door.ev(B, 'reveal', { return: ret, nonce: newNonce(), by: by('openai/gpt-5') }, p, pieces.cite),
    );
    const dropped = door.tracker.reduceProblem(p)!.dropped.find((d) => d.id === id);
    expect(dropped?.why).toBe('no commit by this key with this hash');
  });

  it('refuses at next the three sentences the page names', async () => {
    const asked = `key=${addr(A)}&can=web&model=anthropic/claude`;
    for (const [query, sentence] of [
      [`key=${addr(A).toLowerCase()}&can=web`, 'key: an address with its checksum'],
      [`key=${addr(A)}&can=fly`, 'can: from web, files, shell, person'],
      [`${asked}&only=all`, 'only: verify, or left out'],
    ] as const) {
      expect(DOC).toContain(`\`${sentence}\``);
      const r = await fetch(`${door.base}/p/${p}/next?${query}`);
      expect(r.status, query).toBe(400);
      expect(await r.json()).toEqual({ error: sentence });
    }
  });
});

describe('CLIENT.md, what it names and links', () => {
  it('names well-known fields the well-known document has, the coin included', async () => {
    const t = boot(T0);
    await t.listen();
    const known = await t.get<Record<string, unknown>>('/.well-known/quilt');
    await t.close();
    const list = section('### 1. A key')
      .split('\n')
      .filter((l) => l.startsWith('- `'));
    const fields = list.flatMap((l) => named(l.slice(0, l.indexOf(':'))));
    expect(fields).toEqual([
      'routes',
      'limits.keyPerHour',
      'limits.ipPerHour',
      'stamp.name',
      'trace.blob_max',
      'peers',
      'coin',
    ]);
    for (const f of fields) {
      let at: unknown = known;
      for (const part of f.split('.')) {
        expect(at !== null && typeof at === 'object' && part in at, f).toBe(true);
        at = (at as Record<string, unknown>)[part];
      }
    }
  });

  it('links only files that exist, and headings they have', () => {
    const slug = (heading: string): string =>
      heading
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .replace(/ /g, '-');
    const links = [...DOC.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((l) => !/^https?:/.test(l));
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      const [file, fragment] = link.split('#');
      const path = join(DOCS, file!);
      expect(existsSync(path), link).toBe(true);
      if (fragment === undefined) continue;
      const headings = readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => /^#+ /.test(l))
        .map((l) => slug(l.replace(/^#+ /, '')));
      expect(headings, link).toContain(fragment);
    }
  });

  it('has no em-dash, U+2014', () => {
    expect(DOC.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});
