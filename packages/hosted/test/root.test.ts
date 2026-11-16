/**
 * A root the person holds, over an address the on-ramp holds the key of (PROTOCOL.md, Identity: roots and delegates;
 * CORE.md section 4): a `delegate` from the root, posted before the address's key has signed, makes that key the
 * root's delegate, and the sheet names the root; `/mcp/<token>/rotate` signs a rotation as the old root where the
 * caller signed it as the new, with each of its refusals, and what the address did is the new root's; a root's
 * `revoke` ends the key; and a Quilt of a person's own that signs for another root publishes nothing. What an address
 * does with a publish that waits on its root is waiting.test.ts's.
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Address,
  type Event,
  type Unsigned,
  addressOf,
  secretFromHex,
  signEvent,
  signObject,
} from '@bitquilt/core';
import type { Pattern } from 'quilt';
import { openDoor, quiltOver } from './helpers.js';

let server: Server;
let base: string;
let problem: string;

/** A pattern of one piece, under a slug. */
const pattern = (slug: string): Pattern => ({
  title: `A problem named ${slug}`,
  done_when: 'Done.',
  slug,
  pieces: {
    one: {
      verifier: 'agree',
      brief: 'Say one.',
      schema: { type: 'object', additionalProperties: false, required: ['n'], properties: { n: { enum: ['one'] } } },
    },
  },
});

beforeAll(async () => {
  ({ server, base } = await openDoor());
  // Every problem's input carries the identity log, and a tracker that holds no problem folds no root: a key's
  // standing answers the key itself. So the door holds one problem before any root is asked for.
  const published = await quiltOver(base, 0x09).publish(pattern('held'));
  expect(published.posted).toHaveLength(1);
  problem = published.hash;
});
afterAll(() => server.close());

/** A key the person holds, by a byte. */
const held = (n: number) => {
  const secret = secretFromHex(n.toString(16).padStart(64, '0'));
  return { secret, address: addressOf(secret) };
};
const join = async (): Promise<{ address: Address; url: string }> =>
  (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { address: Address; url: string };
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const rootOf = async (address: Address): Promise<Address> =>
  ((await (await fetch(`${base}k/${address}/standing`)).json()) as { root: Address }).root;
const call = (url: string, tool: string, input: Record<string, unknown> = {}) =>
  post(`${url}/tools/${tool}`, { model: 'anthropic/claude-test', input });
const identity = (
  type: string,
  key: Address,
  body: Record<string, unknown>,
  ts = new Date().toISOString(),
): Unsigned => ({
  quilt: 1,
  type,
  key,
  ts,
  body,
});
/** A rotation as the person's client writes it: signed by the new root in `sig_to`, and not yet by the old. */
const rotation = (from: Address, to: ReturnType<typeof held>, ts?: string): Unsigned => {
  const unsigned = identity('rotate', from, { to: to.address }, ts);
  return { ...unsigned, sig_to: signObject(unsigned as unknown as Record<string, unknown>, to.secret) };
};
describe('a root the person holds, delegating to the address', () => {
  it("a delegate posted before the address's key signs makes that key the root's, and the sheet says so", async () => {
    const root = held(0x51);
    const made = await join();
    expect(await rootOf(made.address)).toBe(made.address);
    const event = signEvent(
      identity('delegate', root.address, {
        to: made.address,
        scope: ['claim', 'commit', 'reveal', 'name'],
        expires: '2036-01-01T00:00:00.000Z',
      }),
      root.secret,
    );
    expect((await post(`${base}k/events`, event)).status).toBe(202);
    expect(await rootOf(made.address)).toBe(root.address);
    const sheet = (await (await fetch(`${made.url}/sheet`)).json()) as {
      address: Address;
      standing: { root: Address };
    };
    expect(sheet.address).toBe(made.address);
    expect(sheet.standing.root).toBe(root.address);
  });

  it("a return made through the address is signed by its key and is the root's reading", async () => {
    const root = held(0x55);
    const made = await join();
    await post(
      `${base}k/events`,
      signEvent(
        identity('delegate', root.address, {
          to: made.address,
          scope: ['claim', 'commit', 'reveal'],
          expires: '2036-01-01T00:00:00.000Z',
        }),
        root.secret,
      ),
    );
    const handed = (await (await call(made.url, 'quilt_next', { problem })).json()) as { handles: { piece: string } };
    const returned = await call(made.url, 'quilt_return', {
      problem,
      piece: handed.handles.piece,
      return: { n: 'one' },
    });
    expect(((await returned.json()) as { text: string }).text).toContain('posted to');
    const work = (await (await fetch(`${base}k/${made.address}/work`)).json()) as {
      root: Address;
      readings: { piece: string }[];
    };
    expect(work.root).toBe(root.address);
    expect(work.readings.map((r) => r.piece)).toEqual([handed.handles.piece]);
    // The piece's record names the root the reading counts for, and the key that signed it.
    const state = JSON.stringify(await (await fetch(`${base}p/${problem}/state`)).json());
    expect(state).toContain(root.address);
    expect(state).toContain(made.address);
  });

  it("a delegate posted after the address's key has signed is taken by the door and counted by nobody", async () => {
    const root = held(0x52);
    const made = await join();
    expect((await call(made.url, 'quilt_name', { name: 'Signed First' })).status).toBe(200);
    const event = signEvent(
      identity('delegate', root.address, { to: made.address, scope: ['claim'], expires: '2036-01-01T00:00:00.000Z' }),
      root.secret,
    );
    expect((await post(`${base}k/events`, event)).status).toBe(202);
    expect(await rootOf(made.address)).toBe(made.address);
  });

  it("the root's revoke ends the key, which then counts for itself and signs for nobody", async () => {
    const root = held(0x53);
    const made = await join();
    await post(
      `${base}k/events`,
      signEvent(
        identity('delegate', root.address, { to: made.address, scope: ['name'], expires: '2036-01-01T00:00:00.000Z' }),
        root.secret,
      ),
    );
    expect(await rootOf(made.address)).toBe(root.address);
    expect(
      (await post(`${base}k/events`, signEvent(identity('revoke', root.address, { of: made.address }), root.secret)))
        .status,
    ).toBe(202);
    expect(await rootOf(made.address)).toBe(made.address);
  });

  it("a Quilt of a person's own that signs for another root publishes nothing, and the refusal names the root", async () => {
    const root = held(0x54);
    const own = quiltOver(base, 0x56);
    await post(
      `${base}k/events`,
      signEvent(
        identity('delegate', root.address, {
          to: own.identity!.address,
          scope: ['claim'],
          expires: '2036-01-01T00:00:00.000Z',
        }),
        root.secret,
      ),
    );
    await expect(own.publish(pattern('from-a-delegate'))).rejects.toThrow(
      `This key signs for the root ${root.address}, which is held elsewhere, and a problem is published by a root (CORE.md section 4). Nothing was posted.`,
    );
    const listed = (await (await fetch(`${base}search?q=`)).json()) as { problems: { title: string }[] };
    expect(listed.problems.map((p) => p.title)).toEqual(['A problem named held']);
  });
});

describe('/mcp/<token>/rotate', () => {
  it("signs a rotation as the old root, and what the address did becomes the new root's", async () => {
    const root = held(0x61);
    const made = await join();
    // The address has signed, so no delegation would take it (CORE.md section 4); a rotation does.
    expect((await call(made.url, 'quilt_name', { name: 'Old Root' })).status).toBe(200);
    const said = await post(`${made.url}/rotate`, rotation(made.address, root));
    expect(said.status).toBe(200);
    const answer = (await said.json()) as { id: string; root: Address };
    expect(answer.root).toBe(root.address);
    expect(await rootOf(made.address)).toBe(root.address);
    const log = await (await fetch(`${base}k/events`)).text();
    const lines = log
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { event: Event });
    const kept = lines.map((l) => l.event).find((e) => e.type === 'rotate' && e.key === made.address);
    expect(kept?.sig_to).toBeDefined();
    expect(kept?.sig).toBeDefined();
    // The old root is a delegate of the new until revoked, and the new root's revoke is taken.
    expect(
      (await post(`${base}k/events`, signEvent(identity('revoke', root.address, { of: made.address }), root.secret)))
        .status,
    ).toBe(202);
  });

  it('refuses what is not a rotation of this address written now and signed by the new root', async () => {
    const root = held(0x62);
    const other = held(0x63);
    const made = await join();
    const elsewhere = await join();
    const refused = async (body: unknown, status = 400) =>
      expect((await post(`${made.url}/rotate`, body)).status).toBe(status);
    await refused('not an event');
    await refused({ ...rotation(made.address, root), sig: `0x${'11'.repeat(65)}` });
    await refused({ ...rotation(made.address, root), type: 'revoke' });
    await refused(rotation(elsewhere.address, root));
    await refused({ ...rotation(made.address, root), sig_to: rotation(made.address, other).sig_to });
    await refused(rotation(made.address, root, '2026-01-01T00:00:00.000Z'));
    const { sig_to: _none, ...unsigned } = rotation(made.address, root);
    await refused(unsigned);
    expect((await fetch(`${made.url}/rotate`)).status).toBe(405);
    expect((await post(`${base}mcp/${'0'.repeat(64)}/rotate`, rotation(made.address, root))).status).toBe(404);
    expect(await rootOf(made.address)).toBe(made.address);
  });

  it('answers the same rotation sent again as it answered the first, for a caller that lost the answer', async () => {
    const root = held(0x64);
    const made = await join();
    const event = rotation(made.address, root);
    const first = await post(`${made.url}/rotate`, event);
    const again = await post(`${made.url}/rotate`, event);
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(await again.json()).toEqual(await first.json());
    expect(await rootOf(made.address)).toBe(root.address);
  });
});
