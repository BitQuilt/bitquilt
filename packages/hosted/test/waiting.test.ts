/**
 * What waits on a root the person holds (PROTOCOL.md, Identity: roots and delegates; CORE.md section 4): an address
 * whose key is a root's delegate publishes nothing itself. The draft its AI made is kept under the member's home,
 * listed at `/mcp/<token>/waiting` as the text the root signs, and published at `/mcp/<token>/waiting/<problem>` when
 * the root's client sends its signature over the envelope and the `version` it signed, with each of the route's
 * refusals; a decline drops it, and so do seven days.
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Address,
  type Envelope,
  type Hash,
  type Unsigned,
  addressOf,
  canonical,
  problemHash,
  secretFromHex,
  signEvent,
  signObject,
} from '@bitquilt/core';
import type { Pattern } from 'quilt';
import { openDoor, quiltOver } from './helpers.js';

let server: Server;
let base: string;
/** Days the on-ramp's clock runs ahead of this machine's, which a test moves. */
let ahead = 0;

const pattern = (slug: string, more: Partial<Pattern> = {}): Pattern => ({
  title: `A problem named ${slug}`,
  done_when: 'Done.',
  slug,
  topics: ['waiting'],
  pieces: {
    'row/*': {
      verifier: 'agree',
      count: 2,
      data: { row: 'rows' },
      brief: 'Say whether this is so: {row.claim}',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['n'],
        properties: { n: { enum: ['so', 'not'] } },
      },
    },
  },
  data: { rows: [{ claim: 'the first' }, { claim: 'the second' }] },
  ...more,
});

beforeAll(async () => {
  ({ server, base } = await openDoor({
    hosted: { now: () => new Date(Date.now() + ahead * 86400000).toISOString() },
  }));
  // A tracker that holds no problem folds no root, so the door holds one before any root is asked for.
  expect((await quiltOver(base, 0x09).publish(pattern('held'))).posted).toHaveLength(1);
});
afterAll(() => server.close());

const held = (n: number) => {
  const secret = secretFromHex(n.toString(16).padStart(64, '0'));
  return { secret, address: addressOf(secret) };
};
type Key = ReturnType<typeof held>;
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const call = (url: string, tool: string, input: Record<string, unknown> = {}) =>
  post(`${url}/tools/${tool}`, { model: 'anthropic/claude-test', input });
/** An address whose key signs for a root the test holds, as the iPhone app makes one at its join. */
async function joined(root: Key): Promise<{ address: Address; url: string }> {
  const made = (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { address: Address; url: string };
  const delegate: Unsigned = {
    quilt: 1,
    type: 'delegate',
    key: root.address,
    ts: new Date().toISOString(),
    body: { to: made.address, scope: ['claim', 'commit', 'reveal'], expires: '2036-01-01T00:00:00.000Z' },
  };
  expect((await post(`${base}k/events`, signEvent(delegate, root.secret))).status).toBe(202);
  return made;
}
interface Waits {
  id: Hash;
  kind: string;
  at: string;
  expires: string;
  root: Address;
  envelope: string;
  topics: string[];
  left: string[];
}
const waiting = async (url: string): Promise<Waits[]> =>
  ((await (await fetch(`${url}/waiting`)).json()) as { waiting: Waits[] }).waiting;
/** The root's answer as its client writes it: the envelope's text signed, and the version of the problem it names. */
function answer(w: Waits, root: Key, over: Partial<Unsigned> = {}, signer = root) {
  const unsigned = JSON.parse(w.envelope) as Omit<Envelope, 'sig'>;
  const version: Unsigned = {
    quilt: 1,
    type: 'version',
    problem: w.id,
    key: root.address,
    ts: new Date().toISOString(),
    body: { slug: unsigned.problem.slug, hash: w.id },
    ...over,
  };
  return { sig: signObject(unsigned, signer.secret), version: signEvent(version, signer.secret) };
}
const titles = async (): Promise<string[]> =>
  ((await (await fetch(`${base}search?q=`)).json()) as { problems: { title: string }[] }).problems.map((p) => p.title);
const errorOf = async (r: Response): Promise<[number, string]> => [
  r.status,
  ((await r.json()) as { error: string }).error,
];

describe("a publish from an address whose key is a root's delegate", () => {
  const root = held(0x71);
  let made: { address: Address; url: string };
  let draft: Waits;

  it('publishes nothing, keeps the draft for the root, and says so', async () => {
    made = await joined(root);
    const said = (await (await call(made.url, 'quilt_publish', { pattern: pattern('waits') })).json()) as {
      text: string;
      handles: { problem: Hash; waiting: Address; posted: string[] };
    };
    expect(said.text).toContain('nothing is published yet');
    expect(said.text).toContain(`signs for the root ${root.address}`);
    expect(said.handles.waiting).toBe(root.address);
    expect(said.handles.posted).toEqual([]);
    expect(await titles()).toEqual(['A problem named held']);
    const list = await waiting(made.url);
    expect(list).toHaveLength(1);
    draft = list[0]!;
    expect([draft.id, draft.kind, draft.root, draft.topics, draft.left]).toEqual([
      said.handles.problem,
      'publish',
      root.address,
      ['waiting'],
      [],
    ]);
    // The text the root signs: canonical JSON of the envelope without its sig, owned by the root, named by its hash.
    const unsigned = JSON.parse(draft.envelope) as Omit<Envelope, 'sig'>;
    expect(canonical(unsigned)).toBe(draft.envelope);
    expect(unsigned.problem.owner).toBe(root.address);
    expect(problemHash(unsigned as Envelope)).toBe(draft.id);
    expect('sig' in unsigned).toBe(false);
    expect(Date.parse(draft.expires) - Date.parse(draft.at)).toBe(7 * 86400000);
  });

  it('keeps the same draft once however often it is drafted, and says what a pattern left off', async () => {
    await call(made.url, 'quilt_publish', { pattern: pattern('waits') });
    expect(await waiting(made.url)).toHaveLength(1);
    const staked = await call(made.url, 'quilt_publish', { pattern: pattern('staked', { stake: { min: 1 } }) });
    expect(((await staked.json()) as { text: string }).text).toContain(
      "The pattern's stake is not posted from a root's approval, and was left off the draft.",
    );
    const list = await waiting(made.url);
    expect(list.map((w) => w.left)).toEqual([['stake'], []]);
  });

  it("refuses an answer that is not the root's, each for its reason, and publishes nothing", async () => {
    const other = held(0x72);
    const at = `${made.url}/waiting/${draft.id}`;
    expect(await errorOf(await post(at, {}))).toEqual([
      400,
      "the root's answer: { sig, version }, or { decline: true }",
    ]);
    expect(await errorOf(await post(at, answer(draft, root, {}, other)))).toEqual([
      400,
      "sig is the root's signature over the envelope as it waits",
    ]);
    const good = answer(draft, root);
    expect(
      await errorOf(
        await post(at, { ...good, version: answer(draft, root, { body: { slug: 'other', hash: draft.id } }).version }),
      ),
    ).toEqual([400, "version is the root's version of this problem: its key, problem, slug and hash"]);
    expect(
      await errorOf(await post(at, { ...good, version: answer(draft, root, { key: other.address }, other).version })),
    ).toEqual([400, "version is the root's version of this problem: its key, problem, slug and hash"]);
    expect(await errorOf(await post(at, { ...good, version: answer(draft, root, {}, other).version }))).toEqual([
      400,
      'version is signed by the root',
    ]);
    expect(
      await errorOf(
        await post(at, { ...good, version: answer(draft, root, { ts: '2026-01-01T00:00:00.000Z' }).version }),
      ),
    ).toEqual([400, "the version's ts is within ten minutes of now"]);
    expect(await errorOf(await post(`${made.url}/waiting/sha256:${'0'.repeat(64)}`, good))).toEqual([
      404,
      'nothing waits here under that hash',
    ]);
    expect((await fetch(at)).status).toBe(405);
    expect((await post(`${made.url}/waiting`, {})).status).toBe(405);
    expect((await fetch(`${base}mcp/${'0'.repeat(64)}/waiting`)).status).toBe(404);
    expect(await titles()).toEqual(['A problem named held']);
    expect(await waiting(made.url)).toHaveLength(2);
  });

  it("publishes the draft once the root signs it: the problem is the root's, under its name, and waits no longer", async () => {
    const r = await post(`${made.url}/waiting/${draft.id}`, answer(draft, root));
    const said = (await r.json()) as { hash: Hash; link: string; posted: string[] };
    expect([r.status, said.hash, said.posted]).toEqual([200, draft.id, [base]]);
    expect(said.link).toContain(`quilt:${draft.id}`);
    const found = (await (await fetch(`${base}search?q=waits`)).json()) as {
      problems: { problem: Hash; owner: Address; pieces: number; topics: string[] }[];
    };
    expect(found.problems.map((p) => [p.problem, p.owner, p.pieces, p.topics])).toEqual([
      [draft.id, root.address, 2, ['waiting']],
    ]);
    // The root's version is kept: the owner's name for the slug leads to the problem.
    expect(await (await fetch(`${base}n/${root.address}/waits`)).json()).toEqual({ hash: draft.id });
    expect((await waiting(made.url)).map((w) => w.left)).toEqual([['stake']]);
    // The same answer again finds nothing waiting, and the same publish again is answered as published.
    expect((await post(`${made.url}/waiting/${draft.id}`, answer(draft, root))).status).toBe(404);
    const again = (await (await call(made.url, 'quilt_publish', { pattern: pattern('waits') })).json()) as {
      text: string;
    };
    expect(again.text).toContain(`Published ${draft.id}`);
    expect(await waiting(made.url)).toHaveLength(1);
  });

  it('drops a draft the root declines, and one that waited seven days', async () => {
    const [staked] = await waiting(made.url);
    const declined = await post(`${made.url}/waiting/${staked!.id}`, { decline: true });
    expect([declined.status, await declined.json()]).toEqual([200, { declined: staked!.id }]);
    expect(await waiting(made.url)).toEqual([]);
    await call(made.url, 'quilt_publish', { pattern: pattern('late') });
    expect(await waiting(made.url)).toHaveLength(1);
    ahead = 8;
    expect(await waiting(made.url)).toEqual([]);
    ahead = 0;
    expect(await waiting(made.url)).toEqual([]);
    expect(await titles()).not.toContain('A problem named late');
  });

  it('keeps nothing for an address that is its own root, which publishes as it always did', async () => {
    const own = (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { url: string };
    const said = (await (await call(own.url, 'quilt_publish', { pattern: pattern('own') })).json()) as { text: string };
    expect(said.text).toContain('Published sha256:');
    expect(await waiting(own.url)).toEqual([]);
  });
});
