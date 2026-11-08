/**
 * docs/CLIENT.md, Writing a client, held to the code it describes. The worked example: fixture 04's first claim, on
 * `cite/1`, its canonical bytes, its id, the EIP-191 digest, `r`, `s`, `v` and the signature, and the commit that binds
 * the reveal after it, are what the core computes, and the signature is the fixture's. The six steps: the requests
 * written under "A first return, in six steps", run in their order against a tracker with each placeholder filled, are
 * answered as the page says, the name taken on the identity log, the offer and next naming one piece, every event taken
 * with the answer the page names and a read put with its own; the trace posted again is refused at row 19 and not
 * answered 409. The second reading: two workers that each take the six steps read different pieces, the request written
 * under "The second reading" hands the second the reading waiting, and their readings make the square; a worker of the
 * first's vendor may be handed it too, the offer reads no `only`, and nothing is handed where no reading waits. When
 * next hands nothing: a piece whose `requires` is not within `can`, one held for another key until the hold's 60
 * seconds pass, one on the key's own problem, one the key has read, one two vendors have made `accepted_provisional`, a
 * record piece whose readings are in, one of a kind this tracker does not define and one that waits on it; the offer's
 * fields and its count; and the two cases next's answer says why, `superseded` on a problem its owner replaced and
 * `unaffordable` on a piece staked beyond the key's free standing, with the offer naming neither. What a 202 does not
 * say: the gate at the reveal and not the commit, with a second commit taking the clean return and no claim needed;
 * `by` held to its lengths and four words and no more, the vendor read before the slash; a name that names no problem;
 * a read put twice and a path that is no hash; a trace on a file; the state's `pieces` and `dropped`; the log's lines,
 * with no id, bare hex and the first `prev` the problem's. The door's checks: each row of the table under "What the
 * door checks, in order" is met by a post that fails that check, with the row's status and one of its sentences; a post
 * that fails several is refused for the earliest, row by row as each is put right, and the bodies hold the order: each
 * post keeps every fault but the one the door named at the post before, so the door's answer is the earliest of the
 * checks it fails; a reveal posted again meets its commit's row rather than 409 where that commit was the key's only
 * one on the piece, and is answered 409 where a commit the key never revealed stays, abandoned or not; and every row is
 * met. Beside the table: the door leaves a reveal's `h` to the reducer, whose drop shows in the state, and next refuses
 * the three sentences the page names. A client that reduces: the problem's log alone leaves out a return posted under
 * an ancestor, and with the ancestor's log it reaches the tracker's state. A peer's events: what a peer admitted is
 * pulled through this door's admission; an event this door's rules refuse, on a problem taken down here or a piece
 * under a stake rule the peer lacks, is named in the pull's report with the sentence a post of it gets here, which is
 * its row's; a second pull passes over what this door holds; and a pull meets no hourly limit, so a door that takes one
 * write an hour from an address takes a peer's four events from one key at once. The well-known fields the page names
 * are in the well-known document, `peers` said as QX-21 says it; each rule the page repeats from PROTOCOL.md's "What
 * the door answers" cites it beside the rule and says what it says; its links reach a file and a heading, and it has no
 * U+2014. docs/README.md says it by its six steps, and names beside it the sections its reading list links. AGENTS.md
 * says what holds each part, the worked example the core and fixture 04, the requests and the table a booted tracker,
 * as the describes here do.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Event,
  type Hash,
  type Receipt,
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
import { type Booted, SETTINGS, addr, boot, envelope, key } from './helpers.js';

const DOCS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs');
const DOC = readFileSync(join(DOCS, 'CLIENT.md'), 'utf8');
const FIXTURE = join(DOCS, '..', 'packages', 'core', 'fixtures', '04-agreement-provisional-then-accepted.json');

const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4),
  E = key(5),
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
/** The requests a section of the page writes, in its order. */
const requestsIn = (heading: string): PageRequest[] =>
  [...section(heading).matchAll(/^```\n([\s\S]*?)^```$/gm)].map((m) => {
    const [line, ...rest] = m[1]!.trimEnd().split('\n');
    const [method, path] = line!.split(' ');
    return {
      method: method!,
      path: path!,
      event: rest.length ? (JSON.parse(rest.join('\n')) as Record<string, unknown>) : null,
    };
  });
const requests = requestsIn('## A first return, in six steps');
/** The path of next as the six steps ask it. */
const nextPath = requests.find((r) => r.path.includes('/next'))!.path;

/** A commit and its reveal by the key on a piece, with no claim before them; the reveal's id. */
async function returned(
  t: Booted,
  problem: Hash,
  k: Uint8Array,
  model: string,
  piece: Hash,
  ret: Record<string, unknown>,
): Promise<Hash> {
  const nonce = newNonce();
  const events = `/p/${problem}/events`;
  await t.accepted(events, t.ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece));
  return t.accepted(events, t.ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece));
}

/** The state's answer, as the page names it. */
interface StateAnswer {
  pieces: { hash: Hash; name: string; state: string; core: string; reveals: number; traces: number }[];
  dropped: { id: Hash; type: string; why: string }[];
}
/** What next answers, as the page names it. */
interface NextAnswer {
  piece: Hash | null;
  state?: string;
  unaffordable: Hash[];
  superseded?: Hash;
}

/** The well-known field `peers` as the page says it, after its name. */
const PEERS =
  "the trackers whose chains this one pulls through its own door (QX-21 section 1). An event a peer admits on a problem both hold reaches this tracker at its next pull, where it goes through this door's own admission: the checks a post meets, without the hourly limits (QX-21 section 2). An event this door holds already is passed over. This door refuses what its own rules refuse though the peer took it, as on a problem taken down here (QX-6) or a piece under a stake rule in force here and not at the peer (QX-15). The pull's report names each event it refused, with the sentence a post gets.";

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
  /** The trace the walk posted at step 6, and where. */
  let traced: { path: string; event: Event } | undefined;
  beforeAll(async () => {
    await walk.listen();
    expect((await walk.post('/p', { envelope: W })).status).toBe(201);
  });
  afterAll(() => walk.close());

  it('writes the requests in the order of the steps', () => {
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /.well-known/quilt',
      'POST /k/events',
      'GET /offer?key=<key>&can=web,files&model=<model>',
      'GET /p/<problem>/next?key=<key>&can=web,files&model=<model>',
      'POST /p/<problem>/events',
      'POST /p/<problem>/events',
      'POST /p/<problem>/events',
      'PUT /b/<read>',
      'POST /p/<problem>/events',
      'POST /p/<problem>/events',
    ]);
    expect(requests.flatMap((r) => (r.event ? [r.event.type] : []))).toEqual([
      'name',
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
      name: 'A worker',
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
        const signed = signEvent(unsigned as unknown as Unsigned, A);
        if (unsigned.type === 'trace') traced = { path, event: signed };
        const res = await walk.post(path, signed);
        const body = (await res.json()) as Record<string, unknown>;
        expect(res.status, `${unsigned.type}: ${JSON.stringify(body)}`).toBe(202);
        expect(Object.keys(body).sort()).toEqual(taken![1]!.split(', ').sort());
        // The id is a hash as CORE.md writes one; the line's hash is bare hex.
        expect(body.id).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(body.hash).toMatch(/^[0-9a-f]{64}$/);
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
        const { pieces, dropped } = await walk.get<StateAnswer>(`/p/${values.problem}/state`);
        expect(pieces.find((p) => p.hash === values.piece)!.traces).toBe(1);
        expect(pieces.find((p) => p.hash === values.piece)!.reveals).toBe(1);
        expect(dropped).toEqual([]);
        values.piece = pieces.find((p) => p.hash !== values.piece)!.hash;
      }
    }
  });

  it("refuses the six steps' trace posted again at row 19, before the door looks for a copy, and not with 409", async () => {
    expect(DOC).toContain(
      'A trace posted again is refused the same way, at row 19, `a trace already names this reveal`, and is not answered `409`.',
    );
    expect(rows.find((r) => r.n === 19)!.status).toBe(400);
    expect(traced, 'the walk posted a trace').toBeDefined();
    const again = await walk.post(traced!.path, traced!.event);
    expect([again.status, await again.json()]).toEqual([400, { error: 'a trace already names this reveal' }]);
  });
});

describe('CLIENT.md, the second reading', () => {
  const t = boot(T0);
  const S = envelope(owner, 'second', {
    'cite/*': { ...cite('Citation {n}: does the page support the claim? Give the verdict and the passage.'), count: 3 },
  });
  const s = problemHash(S);
  const asked = requestsIn('## The second reading');
  /** Next on S as a request the page writes asks it, for the key and the model. */
  const ask = (path: string, k: Uint8Array, model: string): Promise<NextAnswer> =>
    t.get<NextAnswer>(fillPath(path, { problem: s, key: addr(k), model }));
  const state = async (piece: Hash) =>
    (await t.get<StateAnswer>(`/p/${s}/state`)).pieces.find((x) => x.hash === piece)!;
  beforeAll(async () => {
    await t.listen();
    expect((await t.post('/p', { envelope: S })).status).toBe(201);
  });
  afterAll(() => t.close());

  it('writes one request, next with only=verify', () => {
    expect(asked.map((r) => `${r.method} ${r.path}`)).toEqual([
      'GET /p/<problem>/next?key=<key>&can=web,files&model=<model>&only=verify',
    ]);
  });

  it('hands a second worker the reading waiting only when it asks with only=verify, and the two make the square', async () => {
    const second = asked[0]!.path;
    const ret = { verdict: 'supports', quote: 'The page says the claim holds.' };
    // The first worker reads the piece next hands it.
    const x = (await ask(nextPath, A, 'anthropic/claude')).piece!;
    await returned(t, s, A, 'anthropic/claude', x, ret);
    expect((await state(x)).state).toBe('needs_verify');
    // The index's counts name the reading waiting.
    expect(DOC).toContain('whose `counts`, in the index at `GET /`, name `needs_verify` or `disputed`');
    const index = await t.get<{ problems: { problem: Hash; counts: Record<string, number> }[] }>('/');
    expect(index.problems.find((x) => x.problem === s)!.counts).toEqual({ open: 2, needs_verify: 1 });
    // A second worker of another vendor, asking as the six steps ask, is handed an open piece and not the reading.
    expect(DOC).toContain('so two workers that each take the six steps read different pieces and make no square');
    const y = await ask(nextPath, B, 'openai/gpt-5');
    expect(y.piece).not.toBe(x);
    expect(y.state).toBe('open');
    // Asked as the second reading asks, it is handed the reading waiting.
    expect((await ask(second, B, 'openai/gpt-5')).piece).toBe(x);
    // The offer reads no only: it names an open piece first.
    expect(DOC).toContain('the offer reads no `only`');
    const offered = await t.get<{ offers: { state: string }[] }>(
      `/offer?key=${addr(B)}&can=web,files&model=openai/gpt-5&only=verify`,
    );
    expect(offered.offers[0]!.state).toBe('open');
    // Where the open pieces outnumber the readings waiting, a worker of the first's vendor may be handed the piece too.
    t.clock.tick += 60_000;
    expect((await ask(second, C, 'anthropic/claude-2')).piece).toBe(x);
    // The second reading agrees across vendors: the square.
    await returned(t, s, B, 'openai/gpt-5', x, ret);
    expect((await state(x)).state).toBe('accepted_provisional');
    expect(DOC).toContain('Two readings that agree make the piece `accepted_provisional`');
    // With no reading waiting, only=verify hands nothing, and only takes verify alone.
    expect(DOC).toContain('`only` takes `verify` alone');
    expect(await ask(second, B, 'openai/gpt-5')).toEqual({ piece: null, unaffordable: [] });
  });
});

describe('CLIENT.md, when next hands nothing', () => {
  const t = boot(T0);
  const F = envelope(owner, 'files', {
    read: {
      verifier: 'agree',
      requires: ['files'],
      brief: 'Read the file and say whether it supports the claim. Give the verdict and the passage.',
      schema,
      agree: ['verdict'],
    },
  });
  const f = problemHash(F);
  const ask = (k: Uint8Array, can = 'web,files'): Promise<NextAnswer> =>
    t.get<NextAnswer>(`/p/${f}/next?key=${addr(k)}&can=${can}&model=anthropic/claude`);
  const offer = (k: Uint8Array, can = 'web,files') =>
    t.get<{ offer: number; offers: Record<string, unknown>[] }>(
      `/offer?key=${addr(k)}&can=${can}&model=anthropic/claude`,
    );
  const nothing = { piece: null, unaffordable: [] };
  beforeAll(async () => {
    await t.listen();
    expect((await t.post('/p', { envelope: F })).status).toBe(201);
  });
  afterAll(() => t.close());

  it("leaves out a piece whose requires is not within can, and the examples' first problem asks files", async () => {
    expect(DOC).toContain('as `files` is not within `web`');
    const first = JSON.parse(readFileSync(join(DOCS, '..', 'examples', 'first-pattern.json'), 'utf8')) as {
      pieces: Record<string, { requires: string[] }>;
    };
    expect(Object.values(first.pieces).flatMap((p) => p.requires)).toContain('files');
    expect(await ask(A, 'web')).toEqual(nothing);
    expect(await offer(A, 'web')).toEqual({ offer: 1, offers: [] });
  });

  it("leaves out a piece held for another key until the hold's 60 seconds pass", async () => {
    expect(DOC).toContain('holds the piece for this key for 60 seconds, until its reveal or decline');
    expect(DOC).toContain("another key holds it. The worker asks again once the hold's 60 seconds have passed");
    const piece = (await ask(A)).piece!;
    expect(piece).toMatch(/^sha256:/);
    expect(await ask(B)).toEqual(nothing);
    t.clock.tick += 59_000;
    expect(await ask(B)).toEqual(nothing);
    t.clock.tick += 1_000;
    expect((await ask(B)).piece).toBe(piece);
  });

  it('hands and offers the owner nothing on its own problem, and a key nothing on a piece it has read', async () => {
    expect(DOC).toContain('owns the problem, or has a reveal, a run, a live claim or a decline on the piece');
    expect(await ask(owner)).toEqual(nothing);
    expect((await offer(owner)).offers).toEqual([]);
    t.clock.tick += 60_000;
    const piece = (await ask(C)).piece!;
    await returned(t, f, C, 'anthropic/claude', piece, { verdict: 'supports', quote: 'The file says so.' });
    t.clock.tick += 60_000;
    expect(await ask(C)).toEqual(nothing);
  });

  it('answers the offer with its count to the key and the fields the page names', async () => {
    t.clock.tick += 60_000;
    expect(await offer(A, 'web')).toEqual({ offer: 2, offers: [] });
    const { offer: n, offers } = await offer(D);
    expect(n).toBe(1);
    const fields = ['problem', 'title', 'slug', 'owner', 'reason', 'piece', 'name', 'state', 'verifier', 'requires'];
    expect(Object.keys(offers[0]!).sort()).toEqual([...fields, 'lease_h'].sort());
    const said = section('### 2. A piece');
    for (const field of [...fields, 'lease_h']) expect(said, field).toContain(`\`${field}\``);
    expect(said).toContain('`offer` counts');
  });

  it('hands nothing on a piece two vendors have made accepted_provisional', async () => {
    expect(DOC).toContain(
      'its state is none of the five next takes (CORE.md section 7, step 1): it is done, `accepted_provisional`, `accepted` or `unreachable`',
    );
    t.clock.tick += 60_000;
    const piece = (await t.get<NextAnswer>(`/p/${f}/next?key=${addr(B)}&can=web,files&model=openai/gpt-5`)).piece!;
    await returned(t, f, B, 'openai/gpt-5', piece, { verdict: 'supports', quote: 'The file says so.' });
    const { pieces } = await t.get<StateAnswer>(`/p/${f}/state`);
    expect(pieces.find((x) => x.hash === piece)!.core).toBe('accepted_provisional');
    t.clock.tick += 60_000;
    expect(await ask(A)).toEqual(nothing);
    expect(await t.get<NextAnswer>(`/p/${f}/next?key=${addr(A)}&can=web,files&model=meta/llama`)).toEqual(nothing);
    expect((await offer(A)).offers).toEqual([]);
  });

  it('hands nothing on a record piece whose readings are in, one of a kind this tracker does not define, or one that waits on it', async () => {
    expect(DOC).toContain(
      'or, for a record piece, `recorded` (QX-20); it waits on another, `locked`; or its kind is one this tracker does not define, `unknown` (CORE.md section 6);',
    );
    const K = envelope(owner, 'kinds', {
      kept: { ...cite('How does the page read the claim? Give the verdict and the passage.'), verifier: 'record:2' },
      asked: { ...cite('Does the oracle say the page supports the claim?'), verifier: 'oracle' },
      after: { ...cite('Does the page the oracle named support the claim?'), inputs: ['asked'] },
    });
    const k = problemHash(K);
    expect((await t.post('/p', { envelope: K })).status).toBe(201);
    const states = async (): Promise<Record<string, string>> =>
      Object.fromEntries((await t.get<StateAnswer>(`/p/${k}/state`)).pieces.map((x) => [x.name, x.state]));
    const kept = (await t.get<StateAnswer>(`/p/${k}/state`)).pieces.find((x) => x.name === 'kept')!.hash;
    // Before its readings are in, the record piece is handed out; the other two never are.
    expect((await t.get<NextAnswer>(`/p/${k}/next?key=${addr(E)}&can=web,files&model=meta/llama`)).piece).toBe(kept);
    await returned(t, k, A, 'anthropic/claude', kept, { verdict: 'supports', quote: 'The page reads it so.' });
    await returned(t, k, B, 'openai/gpt-5', kept, { verdict: 'contradicts', quote: 'The page reads it otherwise.' });
    expect(await states()).toEqual({ kept: 'recorded', asked: 'unknown', after: 'locked' });
    t.clock.tick += 60_000;
    expect(await t.get<NextAnswer>(`/p/${k}/next?key=${addr(E)}&can=web,files&model=meta/llama`)).toEqual(nothing);
    expect((await offer(E)).offers).toEqual([]);
  });

  it('says why in two cases: superseded names the version that replaced the problem, unaffordable a staked piece', async () => {
    expect(DOC).toContain(
      "Next's answer says why in two cases: `superseded`, beside it, names the version that replaced the problem, where the work now is; and `unaffordable` lists the pieces kept back for a stake the key cannot cover. The offer says neither. For every other reason below, neither answer says why.",
    );
    const first = envelope(owner, 'versions', { cite: cite('Does the page support the claim?') });
    const old = problemHash(first);
    const second = envelope(
      owner,
      'versions',
      { cite: cite('Does the page support the claim? Give the verdict and the passage.') },
      { prev: old },
    );
    const S = envelope(owner, 'stakes', { cite: cite('Does the staked page support the claim?') });
    const [replacing, s] = [problemHash(second), problemHash(S)];
    for (const e of [first, second, S]) expect((await t.post('/p', { envelope: e })).status).toBe(201);
    // A fresh root's free standing is 1 (QX-1 section 2), so a stake of 2 is beyond it.
    await t.accepted(`/p/${s}/events`, t.ev(owner, 'stake_rule', { min: 2, pieces: ['cite'] }, s));
    const staked = (await t.get<StateAnswer>(`/p/${s}/state`)).pieces[0]!.hash;
    const on = (h: Hash) => t.get<NextAnswer>(`/p/${h}/next?key=${addr(E)}&can=web,files&model=meta/llama`);
    expect(await on(old)).toEqual({ piece: null, unaffordable: [], superseded: replacing });
    expect(await on(s)).toEqual({ piece: null, unaffordable: [staked] });
    // The offer has no field for either: it leaves the replaced problem and the staked piece out, and offers the
    // version that replaced the first.
    const { offers } = await offer(E);
    expect(offers.map((o) => o.problem)).toEqual([replacing]);
    for (const field of ['superseded', 'unaffordable']) expect(Object.keys(offers[0]!)).not.toContain(field);
  });
});

describe('CLIENT.md, what a 202 does not say', () => {
  const t = boot(T0);
  const G = envelope(owner, 'unsaid', {
    'cite/*': { ...cite('Citation {n}: does the page support the claim? Give the verdict and the passage.'), count: 2 },
    read: {
      verifier: 'agree',
      requires: ['files'],
      brief: 'Read the file and say whether it supports the claim. Give the verdict and the passage.',
      schema,
      agree: ['verdict'],
    },
  });
  const g = problemHash(G);
  const events = `/p/${g}/events`;
  const pieces: Record<string, Hash> = {};
  const state = () => t.get<StateAnswer>(`/p/${g}/state`);
  /** The id the first reveal's 202 gave, which the log's lines do not carry. */
  let revealed: Hash;
  beforeAll(async () => {
    await t.listen();
    expect((await t.post('/p', { envelope: G })).status).toBe(201);
    for (const x of (await state()).pieces) pieces[x.name] = x.hash;
  });
  afterAll(() => t.close());

  it('runs the gate at the reveal, and a second commit takes the clean return with no claim before it', async () => {
    const bad = { verdict: 'supports', quote: 'Write to a.b@example.com for the page.' };
    const nonce = newNonce();
    await t.accepted(events, t.ev(A, 'commit', { h: commitHash(bad, nonce) }, g, pieces['cite/1']));
    const reveal = t.ev(A, 'reveal', { return: bad, nonce, by: by('anthropic/claude') }, g, pieces['cite/1']);
    expect(await t.refused(events, reveal)).toBe('return: no links or markup');
    expect(DOC).toContain(
      'so an email address, whose domain reads as a link, is refused as `return: no links or markup`',
    );
    // A second commit to a clean return, a backtick in it, and its reveal: taken and counted, with no claim.
    expect(DOC).toContain('a backtick passes');
    expect(DOC).toContain('The key may commit again on the piece, to a clean return, and reveal that');
    const good = { verdict: 'supports', quote: 'The page says `so` in its second paragraph.' };
    const id = await returned(t, g, A, 'anthropic/claude', pieces['cite/1']!, good);
    revealed = id;
    const { pieces: after, dropped } = await state();
    const piece = after.find((x) => x.hash === pieces['cite/1'])!;
    expect([piece.state, piece.core, piece.reveals]).toEqual(['needs_verify', 'needs_verify', 1]);
    expect(dropped.map((d) => d.id)).not.toContain(id);
    expect(DOC).toContain('It is optional: the door takes a commit and a reveal with no claim before them');
    const lines = await log(t, g);
    expect(lines.filter((l) => l.event.type === 'claim')).toEqual([]);
  });

  it('holds by to its lengths and four words and no more, and reads the vendor before the slash', async () => {
    const claim = (model: string, client: string, can: string[], piece: Hash) =>
      t.ev(C, 'claim', { by: { model, client, can } }, g, piece);
    const cite2 = pieces['cite/2']!;
    expect(DOC).toContain(
      'The door holds `model` and `client` to 1 to 80 characters and `can` to those four words, and checks no more',
    );
    expect(await t.refused(events, claim(`a/${'m'.repeat(79)}`, 'worker/1', ['web'], cite2))).toBe(
      'body.by.model: vendor/model or human',
    );
    expect(await t.refused(events, claim('anthropic/claude', 'w'.repeat(81), ['web'], cite2))).toBe(
      'body.by.client: a name',
    );
    expect(await t.refused(events, claim('anthropic/claude', 'worker/1', ['fly'], cite2))).toBe(
      'body.by.can: from web, files, shell, person',
    );
    await t.accepted(events, claim(`a/${'m'.repeat(78)}`, 'w'.repeat(80), ['web'], cite2));
    // No slash, and a can short of the piece's requires: both taken.
    await t.accepted(events, claim('claude', 'worker/1', ['web'], pieces.read!));
    // The reducer counts claude and anthropic/claude as two vendors.
    expect(DOC).toContain('the reducer counts `claude` and `anthropic/claude` as two vendors');
    const ret = { verdict: 'contradicts', quote: 'The page says otherwise.' };
    await returned(t, g, C, 'claude', cite2, ret);
    await returned(t, g, D, 'anthropic/claude', cite2, ret);
    expect((await state()).pieces.find((x) => x.hash === cite2)!.state).toBe('accepted_provisional');
  });

  it('takes a name that names no problem, of 1 to 60 characters', async () => {
    expect(DOC).toContain('`an identity event names no problem`');
    expect(DOC).toContain('The name is 1 to 60 characters and not blank, and `agent: true` beside it');
    expect(await t.refused('/k/events', t.ev(A, 'name', { name: 'A worker' }, g))).toBe(
      'an identity event names no problem',
    );
    for (const name of ['n'.repeat(61), '   '])
      expect(await t.refused('/k/events', t.ev(A, 'name', { name }))).toBe(
        'body.name: a name of at most 60 characters',
      );
    await t.accepted('/k/events', t.ev(A, 'name', { name: 'n'.repeat(60), agent: true }));
  });

  it('answers a read put twice the same, a path that is no hash with no such route, and a trace on a file', async () => {
    const bytes = new TextEncoder().encode('# The core\n\nA claim is an intent, not a lock.\n');
    const read = hashBytes(bytes);
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${t.base}/b/${read}`, { method: 'PUT', body: bytes });
      expect(r.status).toBe(202);
      expect(await r.json()).toEqual({ hash: read, bytes: bytes.length });
    }
    const r = await fetch(`${t.base}/b/${read.slice('sha256:'.length)}`, { method: 'PUT', body: bytes });
    expect([r.status, await r.json()]).toEqual([404, { error: 'no such route' }]);
    expect(DOC).toContain('any other path is `404`, `no such route`');
    // A read of a file: its address in its repository at a commit, and its type.
    const id = await returned(t, g, B, 'openai/gpt-5', pieces.read!, {
      verdict: 'supports',
      quote: 'A claim is an intent, not a lock.',
    });
    const trace = {
      reveal: id,
      reads: [{ url: 'https://example.org/repo/blob/abc123/docs/CORE.md', hash: read, at: T0, media: 'text/markdown' }],
      rests: [{ field: 'verdict', read: 0, span: [12, 45] }],
    };
    await t.accepted(events, t.ev(B, 'trace', trace, g, pieces.read));
    expect((await state()).pieces.find((x) => x.hash === pieces.read)!.traces).toBe(1);
  });

  it('serves the log as lines with no id, bare hex hashes and the first prev the problem in hex', async () => {
    expect(DOC).toContain('one line `{ event, received, seq, prev, hash }` a row');
    expect(DOC).toContain('each `{ by, at, custody }` with what more the tracker vouches for');
    expect(DOC).toContain("the first line's `prev` is the problem's hash without its `sha256:`");
    expect(DOC).toContain("a line's `hash` and `prev`, and the `hash` a post's `202` names, are bare hex");
    const lines = await log(t, g);
    expect(lines[0]!.seq).toBe(1);
    expect(lines[0]!.prev).toBe(g.slice('sha256:'.length));
    for (const [i, l] of lines.entries()) {
      expect(Object.keys(l).sort()).toEqual(['event', 'hash', 'prev', 'received', 'seq']);
      expect(l.hash).toMatch(/^[0-9a-f]{64}$/);
      if (i > 0) expect(l.prev).toBe(lines[i - 1]!.hash);
      expect(Object.keys(l.received[0]!).sort()).toEqual(['at', 'by', 'custody']);
    }
    // A reveal's id is found by recomputing each event's id.
    expect(DOC).toContain("or recomputes each event's id, the hash of the event without `sig` and `sig_to`");
    expect(lines.filter((l) => eventId(l.event) === revealed).map((l) => l.event.type)).toEqual(['reveal']);
  });

  it("names the state's pieces by hash and name, each with its layer's state and the core's, and dropped beside", async () => {
    const answer = await state();
    expect(Array.isArray(answer.pieces) && Array.isArray(answer.dropped)).toBe(true);
    for (const x of answer.pieces)
      for (const k of ['hash', 'name', 'state', 'core', 'reveals', 'traces']) expect(x).toHaveProperty(k);
    const said = section('## After a return');
    for (const k of ['pieces', 'hash', 'name', 'state', 'core', 'reveals', 'traces', 'dropped', '{ id, type, why }'])
      expect(said, k).toContain(`\`${k}\``);
  });
});

/** A problem's log as lines, the first page. */
async function log(t: Booted, problem: Hash): Promise<(Receipt & { seq: number; prev: string; hash: string })[]> {
  const text = await (await fetch(`${t.base}/p/${problem}/events`)).text();
  return text
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as Receipt & { seq: number; prev: string; hash: string });
}

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
    // The bodies hold the order. Through row 16, each post puts right the fault the door named at the one before and
    // keeps every other, so the door answers the earliest check it fails. The first two are not JSON, the first under a
    // problem this tracker does not hold. From the third, the reveal fails rows 5, 6, 8, 9, 11, 14, 15 and 16 at once,
    // and each post after it puts one right; the eighth trades row 11's fault for row 12's, which only a staked piece
    // carries.
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
    const step = async (n: number, path: string, body: string): Promise<void> => meets(n, await raw(door, path, body));
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
    // The door admits before it dedupes: the reveal posted again meets row 16, the key's one commit now revealed.
    expect(DOC).toContain(
      "Where the reveal's commit is the key's only one on the piece, the repeat is refused there, `no unrevealed commit by this key on the piece`, and is not answered `409`.",
    );
    u.ts = now();
    const reveal = signed(A);
    expect((await raw(door, events, reveal)).status).toBe(202);
    meets(16, await raw(door, events, reveal));
  });

  it('answers a reveal posted again 409 where the key has a commit on the piece it never revealed, abandoned or not', async () => {
    expect(DOC).toContain(
      'Where the key has another commit on the piece that it never revealed, as the first is after a second commit (step 4), that one stays unrevealed at the door, abandoned or not, so the repeat passes row 16 and is answered `409`, `already here`.',
    );
    const t = boot(T0);
    await t.listen();
    try {
      expect((await t.post('/p', { envelope: P })).status).toBe(201);
      const reveal = (ret: Record<string, unknown>, nonce: string): string =>
        JSON.stringify(t.ev(D, 'reveal', { return: ret, nonce, by: by('meta/llama') }, p, pieces.cite));
      // Step 4: a commit whose reveal the gate refuses, then a second commit to a clean return, and its reveal.
      const bad = { verdict: 'supports', quote: 'Write to a.b@example.com for the page.' };
      const first = newNonce();
      await t.accepted(events, t.ev(D, 'commit', { h: commitHash(bad, first) }, p, pieces.cite));
      meets(15, await raw(t, events, reveal(bad, first)));
      const good = { verdict: 'supports', quote: 'The page says so.' };
      const second = newNonce();
      await t.accepted(events, t.ev(D, 'commit', { h: commitHash(good, second) }, p, pieces.cite));
      const again = reveal(good, second);
      expect((await raw(t, events, again)).status).toBe(202);
      meets(20, await raw(t, events, again));
      // Two leases on, the first commit is abandoned, and the door still counts it unrevealed.
      t.clock.tick += 2 * SETTINGS.lease_h * 3_600_000 + 1000;
      meets(20, await raw(t, events, again));
    } finally {
      await t.close();
    }
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
    await returned(door, p, A, 'anthropic/claude', pieces.record!, {
      verdict: 'supports',
      quote: 'The page reads it so.',
    });
    await returned(door, p, B, 'openai/gpt-5', pieces.record!, {
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
    const id = await returned(door, p, C, 'google/gemini', pieces.cite!, {
      verdict: 'supports',
      quote: 'The page says so.',
    });
    const read = { url: 'https://example.org/page', hash: hashText('a read not put'), at: T0, media: 'text/plain' };
    const trace = { reveal: id, reads: [read], rests: [{ field: 'quote', read: 0, span: [0, 10] }] };
    meets(19, await raw(door, events, JSON.stringify(door.ev(C, 'trace', trace, p, pieces.cite))));
  });

  it('meets every row', () => {
    expect([...met].sort((a, b) => a - b)).toEqual(rows.map((r) => r.n));
  });

  it("takes a reveal whose return and nonce miss the commit's h, and the reducer drops it, as the state shows", async () => {
    expect(DOC).toContain('It does not check `h`.');
    expect(DOC).toContain('as `no commit by this key with this hash`');
    expect(DOC).toContain("a drop shows in the problem's state, under `dropped`");
    const ret = { verdict: 'supports', quote: 'The page says so.' };
    await door.accepted(events, door.ev(B, 'commit', { h: commitHash(ret, newNonce()) }, p, pieces.cite));
    const id = await door.accepted(
      events,
      door.ev(B, 'reveal', { return: ret, nonce: newNonce(), by: by('openai/gpt-5') }, p, pieces.cite),
    );
    const { dropped } = await door.get<StateAnswer>(`/p/${p}/state`);
    expect(dropped.find((d) => d.id === id)).toEqual({
      id,
      type: 'reveal',
      why: 'no commit by this key with this hash',
    });
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

describe('CLIENT.md, what a client that reduces reads', () => {
  const t = boot(T0);
  /** The family both versions carry, so its piece has one hash in both. */
  const kept = {
    ...cite('Citation {n}: does the page support the claim? Give the verdict and the passage.'),
    count: 1,
  };
  const first = envelope(owner, 'reduced', { 'cite/*': kept });
  const v1 = problemHash(first);
  const more = {
    ...cite('Citation {n}: does the second page support it? Give the verdict and the passage.'),
    count: 1,
  };
  const second = envelope(owner, 'reduced', { 'cite/*': kept, 'more/*': more }, { prev: v1 });
  const v2 = problemHash(second);
  beforeAll(() => t.listen());
  afterAll(() => t.close());

  /** A log read as the page says: newline-delimited lines, each a receipt with its place on the chain. */
  const receipts = async (path: string): Promise<Receipt[]> =>
    (await (await fetch(t.base + path)).text())
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const { event, received } = JSON.parse(l) as Receipt;
        return { event, received };
      });

  it("reads each ancestor's log beside the problem's, since a return under an ancestor counts on the version after it", async () => {
    expect(DOC).toContain(
      'and the logs: `/p/<hash>/events` for the problem and for each ancestor, since a return posted under an ancestor counts on every version after it (CORE.md section 6), and `/k/events`',
    );
    expect(DOC).toContain('(`inputFor` in `packages/tracker/src/tracker.ts`)');
    expect((await t.post('/p', { envelope: first })).status).toBe(201);
    const piece = (await t.get<StateAnswer>(`/p/${v1}/state`)).pieces[0]!.hash;
    const ret = { verdict: 'supports', quote: 'The page says so.' };
    await returned(t, v1, A, 'anthropic/claude', piece, ret);
    await returned(t, v1, B, 'openai/gpt-5', piece, ret);
    expect((await t.post('/p', { envelope: second })).status).toBe(201);
    // The envelopes as the page names them: the problem's at /p/<problem>, and the ancestor's along prev.
    const served = await t.get<Envelope>(`/p/${v2}`);
    expect(served.problem.prev).toBe(v1);
    const envelopes = [served, await t.get<Envelope>(`/p/${served.problem.prev!}`)];
    const now = new Date(t.clock.tick).toISOString();
    const reduced = (logs: Receipt[][]) =>
      reduce({ envelopes, blobs: new Map(), receipts: logs.flat(), now }).byHash.get(piece)!.state;
    const identity = await receipts('/k/events');
    const own = await receipts(`/p/${v2}/events`);
    const ancestor = await receipts(`/p/${v1}/events`);
    expect(ancestor.length).toBeGreaterThan(0);
    expect(reduced([own, ancestor, identity])).toBe('accepted_provisional');
    expect(reduced([own, identity])).toBe('open');
    const { pieces } = await t.get<StateAnswer>(`/p/${v2}/state`);
    expect(pieces.find((x) => x.hash === piece)!.core).toBe('accepted_provisional');
  });
});

describe("CLIENT.md, a peer's events at this door", () => {
  const limits = { keyPerHour: 1000, ipPerHour: 10000 };
  const peer = boot(T0, { limits });
  let here: Booted;
  const Shown = envelope(owner, 'shown', {
    cite: cite('Does the shown page support the claim? Give the verdict and the passage.'),
    staked: cite('Does the staked page support the claim? Give the verdict and the passage.'),
  });
  const Taken = envelope(owner, 'taken', {
    cite: cite('Does the page taken down support the claim? Give the verdict and the passage.'),
  });
  const [shown, taken] = [problemHash(Shown), problemHash(Taken)];
  beforeAll(async () => {
    await peer.listen();
    // This door names M as a maintainer and the peer as its peer; the peer names neither.
    here = boot(T0, { limits, maintainers: [addr(M)], peers: [`${peer.base}/`] });
    await here.listen();
    for (const t of [peer, here])
      for (const e of [Shown, Taken]) expect((await t.post('/p', { envelope: e })).status).toBe(201);
  });
  afterAll(async () => {
    await peer.close();
    await here.close();
  });

  it("takes a peer's events through this door's admission, refuses what its own rules refuse with a post's sentence, and passes over what it holds", async () => {
    expect(DOC).toContain(PEERS);
    // The two rules this door has and the peer does not: a stake on one piece, and the second problem taken down.
    await here.accepted(`/p/${shown}/events`, here.ev(owner, 'stake_rule', { min: 1, pieces: ['staked'] }, shown));
    await here.accepted('/k/events', here.ev(M, 'hide', { id: taken, why: 'Taken down for the test.' }));
    const hashOf = async (problem: Hash, name: string): Promise<Hash> =>
      (await peer.get<StateAnswer>(`/p/${problem}/state`)).pieces.find((x) => x.name === name)!.hash;
    const ret = { verdict: 'supports', quote: 'The page says the claim holds.' };
    const worked: Record<string, { problem: Hash; events: Event[] }> = {};
    for (const [name, problem, piece] of [
      ['cite', shown, 'cite'],
      ['staked', shown, 'staked'],
      ['taken', taken, 'cite'],
    ] as const) {
      const at = await hashOf(problem, piece);
      const nonce = newNonce();
      const events = [
        peer.ev(A, 'commit', { h: commitHash(ret, nonce) }, problem, at),
        peer.ev(A, 'reveal', { return: ret, nonce, by: by('anthropic/claude') }, problem, at),
      ];
      for (const e of events) await peer.accepted(`/p/${problem}/events`, e);
      worked[name] = { problem, events };
    }
    here.clock.tick = peer.clock.tick + 60_000;
    const pull = async () => {
      const [report] = await here.tracker.pullPeers();
      return report!;
    };
    const first = await pull();
    expect(first).toMatchObject({ peer: `${peer.base}/`, added: 2, errors: [] });
    const why = new Map(first.refused.map((r) => [r.id, r.why]));
    expect(why.size).toBe(4);
    // Each refusal is the one a post of the same event gets here, and its row's in the table.
    for (const [name, n] of [
      ['staked', 12],
      ['taken', 10],
    ] as const) {
      const { problem, events } = worked[name]!;
      for (const e of events) {
        const said = why.get(eventId(e))!;
        expect(
          rows.find((r) => r.n === n)!.sentences.some((s) => s.test(said)),
          `${name}: ${said}`,
        ).toBe(true);
        expect((await raw(here, `/p/${problem}/events`, JSON.stringify(e))).error).toBe(said);
      }
    }
    const state = await here.get<StateAnswer>(`/p/${shown}/state`);
    expect(state.pieces.find((x) => x.name === 'cite')!.reveals).toBe(1);
    expect(state.pieces.find((x) => x.name === 'staked')!.reveals).toBe(0);
    // Pulled again, what this door holds is passed over and what it refused is refused again.
    const again = await pull();
    expect(again).toMatchObject({ added: 0, errors: [] });
    expect(new Map(again.refused.map((r) => [r.id, r.why]))).toEqual(why);
  });

  it('takes a pull without the hourly limits, past what a post from one key or one address may do', async () => {
    const tight = boot(T0, { limits: { keyPerHour: 1, ipPerHour: 1 }, peers: [`${peer.base}/`] });
    await tight.listen();
    try {
      expect((await tight.post('/p', { envelope: Shown })).status).toBe(201);
      tight.clock.tick = peer.clock.tick + 60_000;
      // Four events from one key in one pull: the commits and reveals the test before posted at the peer on the
      // first problem's two pieces.
      expect((await tight.tracker.pullPeers())[0]).toMatchObject({ added: 4, refused: [], errors: [] });
      expect((await raw(tight, `/p/${shown}/events`, 'not JSON')).status).toBe(429);
    } finally {
      await tight.close();
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
    // Peers are the trackers whose chains this door pulls (QX-21 section 1); "a peer's events at this door" holds the
    // pull the line says.
    expect(list.find((l) => l.startsWith('- `peers`'))).toBe(`- \`peers\`: ${PEERS}`);
    const qx21 = readFileSync(join(DOCS, 'ext', 'QX-21.md'), 'utf8');
    expect(qx21).toContain(
      "A tracker's peers are the trackers it names (`QUILT_PEERS`, published as `peers` in its well-known document",
    );
    expect(qx21).toContain(
      "Every other event goes through this door's own admission, the same code a `POST` goes through",
    );
    expect(qx21).toContain("What the door refuses is said in the pull's report with the reason, not folded");
  });

  it("cites PROTOCOL.md's What the door answers beside each rule it repeats from there, and says what it says", () => {
    expect(DOC).toContain(
      'Each rule has its home in the document cited beside it, and this page repeats only what a worker needs at the step it is on;',
    );
    const protocol = readFileSync(join(DOCS, 'PROTOCOL.md'), 'utf8');
    const answers = protocol.slice(
      protocol.indexOf('### What the door answers'),
      protocol.indexOf('### The piece next hands over'),
    );
    const cited = '([What the door answers](PROTOCOL.md#what-the-door-answers))';
    // Each pair: the words on this page, and the same rule's words in its home.
    // The page writes a paragraph on one line.
    for (const [here, there] of [
      ['`0x` and 130 lower-case hex characters', '`0x` and 130 lower-case hex characters'],
      ['`202 { id, seq, hash, at }`', '`202 { id, seq, hash, at }`'],
      ['or `409` for an event the door holds already', 'Held already: `409`, `already here`'],
      ['for 60 seconds', 'for 60 seconds'],
      ['`{ "error": "<sentence>" }`', '`{ "error": "<one sentence>" }`'],
      ["Quilt takes a `4xx` other than `429` as the tracker's answer", 'Quilt reads a 4xx but `429` as the answer'],
      ['The page of 500 lines', 'at most 500'],
    ]) {
      const lines = DOC.split('\n').filter((l) => l.includes(here!));
      expect(lines.length, here).toBeGreaterThan(0);
      for (const l of lines) expect(l, here).toContain(cited);
      expect(answers, there).toContain(there);
    }
  });

  it('links only files that exist, and headings they have, its own included', () => {
    const slug = (heading: string): string =>
      heading
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, '')
        .replace(/ /g, '-');
    const links = [...DOC.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]!).filter((l) => !/^https?:/.test(l));
    expect(links.length).toBeGreaterThan(10);
    for (const link of links) {
      const [file, fragment] = link.split('#');
      // A link with no file is to a heading of this page.
      const path = join(DOCS, file || 'CLIENT.md');
      expect(existsSync(path), link).toBe(true);
      if (fragment === undefined) continue;
      const headings = readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => /^#+ /.test(l))
        .map((l) => slug(l.replace(/^#+ /, '')));
      expect(headings, link).toContain(fragment);
    }
  });

  it('is said in docs/README.md by its steps, and named there with what its reading list names', () => {
    const readme = readFileSync(join(DOCS, 'README.md'), 'utf8');
    // Two entries: the first step of the path for someone writing a client, and the page in the list of every document.
    const entries = readme.split('\n').filter((l) => l.includes('[CLIENT.md](CLIENT.md)'));
    expect(entries).toHaveLength(2);
    const steps = /^## A first return, in (\w+) steps$/m.exec(DOC)?.[1];
    expect(steps).toBe('six');
    for (const e of entries) expect(e).toContain(`a first return in ${steps} steps`);
    // The reading list's items, and the headings each links in a document.
    const list = section('## What to read')
      .split('\n')
      .filter((l) => /^\d+\. /.test(l));
    expect(list).toHaveLength(4);
    const anchors = (item: string, file: string): string[] =>
      [...item.matchAll(/\]\(([^)#]+)#([^)]+)\)/g)].filter((m) => m[1] === file).map((m) => m[2]!);
    const sections = (item: string, file: string): string => {
      const n = anchors(item, file).map((a) => /^(\d+)-/.exec(a)![1]!);
      return n.length < 2 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n.at(-1)}`;
    };
    expect(anchors(list[3]!, 'PROTOCOL.md')).toEqual(['routes', 'what-the-door-answers', 'the-piece-next-hands-over']);
    expect(entries.find((e) => e.startsWith('- '))).toContain(
      `Read it with CORE.md sections ${sections(list[0]!, 'CORE.md')}, QX-19 sections ${sections(list[2]!, 'ext/QX-19.md')}, and PROTOCOL.md's routes, what the door answers and the piece next hands over.`,
    );
  });

  it('is named in AGENTS.md by what holds each part, as the describes here hold it', () => {
    expect(readFileSync(join(DOCS, '..', 'AGENTS.md'), 'utf8')).toContain(
      "`docs/CLIENT.md`'s worked example held to the core and fixture 04, and its requests and its table of the door's checks held to a booted tracker, by `packages/tracker/test/client-doc.test.ts`.",
    );
    const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
    const block = (title: string): string => {
      const start = source.indexOf(`describe(${title}, () => {`);
      expect(start, title).toBeGreaterThan(0);
      return source.slice(start, source.indexOf('\ndescribe(', start));
    };
    const worked = block(`"CLIENT.md, fixture 04's first claim, worked"`);
    expect(worked).toContain('readFileSync(FIXTURE');
    expect(worked).not.toContain('boot(');
    for (const title of ["'CLIENT.md, a first return in six steps'", "'CLIENT.md, what the door checks, in order'"])
      expect(block(title)).toContain('boot(T0');
  });

  it('has no em-dash, U+2014', () => {
    expect(DOC.includes(String.fromCharCode(0x2014))).toBe(false);
  });
});
