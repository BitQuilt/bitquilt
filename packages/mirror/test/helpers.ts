/**
 * What the mirror's tests share: fixed keys, the actor a reveal names, the verdict schema their problems ask for, the
 * bytes a calendar answers with, and a tracker of their own with a store in memory on a free port. Each test file keeps
 * its own clock, envelopes, events and posts, since those differ from file to file. vitest runs `*.test.ts` alone, so
 * this file is no test of its own.
 */
import type { Server } from 'node:http';
import { addressOf } from '@bitquilt/core';
import { Store, type TrackerOptions, createTracker } from '@bitquilt/tracker';

/** A fixed secret key: thirty-one zero bytes and `n`. */
export const key = (n: number): Uint8Array => {
  const k = new Uint8Array(32);
  k[31] = n;
  return k;
};
export const addr = addressOf;

/** The actor a reveal names: the model that did the work, the test's client, and the web. */
export const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });

/** A verdict on a statement: supports or contradicts, and nothing else. */
export const VERDICT = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'contradicts'] } },
};

/**
 * What a calendar answers to a digest in these tests: a few bytes the mirror writes after the head's digest as given.
 */
export const calendarBytes = new Uint8Array([
  0xf0, 0x10, 0x01, 0x02, 0x03, 0x00, 0x83, 0xdf, 0xe3, 0x0d, 0x2e, 0xf9, 0x0c, 0x8e,
]);

/**
 * A tracker at `http://t.test/`, or the `url` a test gives it, with a store in memory, the test's clock and a fixed
 * salt, listening on a free port, with the peers, the coin, the maintainers or the founding standing a test gives it;
 * `base` is where it answers, with its trailing slash, and `store` is its store, which a test writes to as a node's
 * other roles do.
 */
export async function startTracker(
  now: () => string,
  options: Pick<TrackerOptions, 'peers' | 'coin' | 'maintainers' | 'founding'> & { url?: string } = {},
): Promise<{ server: Server; base: string; store: Store }> {
  const store = new Store(':memory:');
  const t = createTracker({ store, now, ipSalt: 's', ...options, url: options.url ?? 'http://t.test/' });
  const server = await t.listen(0);
  const a = server.address();
  return { server, base: typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '', store };
}
