/**
 * What the tracker's tests share: fixed keys, an envelope signed by its owner, a tracker of its own with a store in
 * memory and a clock the test moves, and the posts and reads against it. Each test file keeps its own pieces, schema
 * and the helpers that differ from these. vitest runs `*.test.ts` alone, so this file is no test of its own.
 */
import { expect } from 'vitest';
import type { Server } from 'node:http';
import { type Envelope, type Hash, type Unsigned, addressOf, signEvent } from '@bitquilt/core';
import { signObject } from '@bitquilt/core';
import { Store } from '../src/store.js';
import { type Tracker, type TrackerOptions, createTracker } from '../src/tracker.js';

/** A fixed secret key: thirty-one zero bytes and `n`. */
export const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
export const addr = addressOf;
/** The settings every test problem uses: a two-day window and a two-hour lease. */
export const SETTINGS: Envelope['problem']['settings'] = { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 100, patch_max: 10000 };

/** An envelope signed by its owner with the settings above, any of them overridden by `extra.settings`; the title and done_when default to the statements the tests pose. */
export function envelope(owner: Uint8Array, slug: string, pieces: Envelope['problem']['pieces'], extra: Partial<Pick<Envelope['problem'], 'title' | 'done_when' | 'data'>> & { settings?: Partial<Envelope['problem']['settings']> } = {}): Envelope {
  const problem: Envelope['problem'] = {
    title: extra.title ?? `Statements (${slug})`, done_when: extra.done_when ?? 'Every statement has a verdict.', owner: addr(owner), slug, prev: null, from: null,
    settings: { ...SETTINGS, ...extra.settings }, pieces, data: extra.data ?? {},
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, owner) };
}

/** A response's JSON, typed as the caller says. */
export async function json<T = unknown>(r: Response | Promise<Response>): Promise<T> {
  return (await (await r).json()) as T;
}

/** A tracker for one test file: its store in memory, its clock the test moves, listening once `listen` has run. */
export interface Booted {
  tracker: Tracker;
  store: Store;
  /** The clock in milliseconds since the epoch: `ev` moves it a second forward before each event, and a test moves it by hand. */
  clock: { tick: number };
  server: Server | null;
  /** Where the server listens, with no trailing slash, once `listen` has run. */
  base: string;
  listen(): Promise<void>;
  close(): Promise<void>;
  post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response>;
  /** A GET's JSON, typed as the caller says. */
  get<T = unknown>(path: string): Promise<T>;
  /** Posts an event and returns its id, failing the test with the answer's text when the status is not 202. */
  accepted(path: string, event: unknown, headers?: Record<string, string>): Promise<Hash>;
  /** Posts an event and returns the refusal's reason, failing the test with the answer's text when the status is not 400. */
  refused(path: string, event: unknown, headers?: Record<string, string>): Promise<string>;
  /** An event signed by the key, dated a second after the last. */
  ev(k: Uint8Array, type: string, body: Record<string, unknown>, problem?: Hash, piece?: Hash): ReturnType<typeof signEvent>;
}

/** A tracker at `http://tracker.test/` whose clock starts at `start`, with a fixed salt and any options the file adds. */
export function boot(start: string, options: Partial<Omit<TrackerOptions, 'store' | 'now' | 'url'>> = {}): Booted {
  const store = new Store(':memory:');
  const clock = { tick: Date.parse(start) };
  const tracker = createTracker({ store, url: 'http://tracker.test/', now: () => new Date(clock.tick).toISOString(), ipSalt: 's', ...options });
  const t: Booted = {
    tracker, store, clock, server: null, base: '',
    async listen() {
      t.server = await tracker.listen(0);
      const a = t.server.address();
      t.base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}` : '';
    },
    close: () => new Promise<void>((r) => (t.server ? t.server.close(() => r()) : r())),
    post: (path, body, headers = {}) => fetch(t.base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } }),
    get: (path) => json(fetch(t.base + path)),
    async accepted(path, event, headers) {
      const r = await t.post(path, event, headers);
      expect(r.status, await r.clone().text()).toBe(202);
      return (await json<{ id: Hash }>(r)).id;
    },
    async refused(path, event, headers) {
      const r = await t.post(path, event, headers);
      expect(r.status, await r.clone().text()).toBe(400);
      return (await json<{ error: string }>(r)).error;
    },
    ev(k, type, body, problem, piece) {
      clock.tick += 1000;
      const u: Unsigned = { quilt: 1, type, key: addr(k), ts: new Date(clock.tick).toISOString(), body };
      if (problem) u.problem = problem;
      if (piece) u.piece = piece;
      return signEvent(u, k);
    },
  };
  return t;
}
