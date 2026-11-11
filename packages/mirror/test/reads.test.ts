/**
 * NODE.md section 5, the reads: the reads a chain's traces name are fetched under their hashes where they are not held,
 * and "A read a trace names by anything but a hash, and reads that are not a list, are not fetched, and are no refusal"
 * (`readsNamed` in the core's trace.ts). A tracker holds a trace whose reads are not that, written to its store
 * directly, as a tracker serves one it took before its door held the body to QX-19 section 1; the core's shape reads no
 * trace's body and a core client ignores the event (EXTENSIONS.md, What an extension may do), so a chain that holds it
 * verifies. Its reads name a path that climbs out of the blobs or names a folder, a number or an object, or are not a
 * list, or hold a read that is not an object, each beside a good read the source serves. The mirror's run and a
 * keeper's over a tracker's store each return with nothing refused and nothing thrown, hold the trace on their chain,
 * and take the good read and no other.
 */
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Hash,
  type Receipt,
  type Unsigned,
  eventId,
  hashBytes,
  problemHash,
  signEvent,
  signObject,
  verifyChain,
} from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { keep, mirror } from '../src/mirror.js';
import { VERDICT, addr, key } from './helpers.js';

const NODE = readFileSync(new URL('../../../docs/NODE.md', import.meta.url), 'utf8');
const owner = key(9);

const problem: Envelope['problem'] = {
  title: 'Reads',
  done_when: 'Done.',
  owner: addr(owner),
  slug: 'reads',
  prev: null,
  from: null,
  settings: { challenge_window_h: 1, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
  pieces: { statement: { verifier: 'agree', brief: 'Does the page say so?', schema: VERDICT, agree: ['verdict'] } },
  data: {},
};
const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
const env: Envelope = { ...unsigned, sig: signObject(unsigned, owner) };
const P = problemHash(env);
/** The good read: a page the source holds under its hash, which the trace names after the one that is not a hash. */
const PAGE = new TextEncoder().encode('The page says so.');
const GOOD = hashBytes(PAGE);
const good = { url: 'https://example.org/page', hash: GOOD, at: '2026-11-08T08:00:00Z' };

let tick = Date.parse('2026-11-08T09:00:00Z');
const now = () => new Date(tick).toISOString();

/**
 * A tracker holding the problem, the good read and a trace whose reads are as given, written to its store directly, as
 * a tracker that held it before its door held the body to QX-19 section 1 would serve it.
 */
async function holding(reads: unknown): Promise<{ server: Server; base: string; id: Hash }> {
  const store = new Store(':memory:');
  const t = createTracker({ store, url: 'http://t.test/', now, ipSalt: 's' });
  const server = await t.listen(0);
  const a = server.address();
  const base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '';
  const posted = await fetch(`${base}p`, {
    method: 'POST',
    body: JSON.stringify({ envelope: env, blobs: {} }),
    headers: { 'content-type': 'application/json' },
  });
  expect(posted.status).toBe(201);
  store.putBlob(GOOD, PAGE);
  tick += 1000;
  const u: Unsigned = { quilt: 1, type: 'trace', key: addr(owner), ts: now(), body: { reads }, problem: P };
  const e = signEvent(u, owner);
  store.appendReceipt(P, e, eventId(e), 'http://t.test/', now(), 'self');
  return { server, base, id: eventId(e) };
}

/** Each set of reads, beside the good one or not a list, and whether the good read is there to take. */
const READS: [string, unknown, boolean][] = [
  ['a hash of ..', [{ ...good, hash: '..' }, good], true],
  ['a hash that climbs to the ledger', [{ ...good, hash: '../ledger' }, good], true],
  ['a hash that climbs to the balances', [{ ...good, hash: '../coin/balances.json' }, good], true],
  ['a hash that is a number', [{ ...good, hash: 7 }, good], true],
  ['a hash that is an object', [{ ...good, hash: { a: 1 } }, good], true],
  ['a read that is null', [null, good], true],
  ['a read that is a string', ['../ledger', good], true],
  ['reads that are a number', 5, false],
  ['reads that are an object', { 0: good }, false],
];

describe('the reads a mirror takes (NODE.md section 5)', () => {
  it.each(READS)(
    'takes a trace whose reads hold %s, refuses nothing, and takes the good read alone',
    async (_, reads, takes) => {
      const { server, base, id } = await holding(reads);
      try {
        const out = join(mkdtempSync(join(tmpdir(), 'bitquilt-reads-')), 'mirror');
        const report = await mirror({ trackers: [base], out, now });
        expect(report.refused).toEqual([]);
        expect(report.errors).toEqual([]);
        expect(readdirSync(out)).toContain('index.json');
        const lines = readFileSync(join(out, 'ledger', `${P}.jsonl`), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as Receipt);
        expect(verifyChain(lines, P).ok).toBe(true);
        expect(lines.map((l) => eventId(l.event))).toEqual([id]);
        expect(readdirSync(join(out, 'blobs'))).toEqual(takes ? [GOOD] : []);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
  );

  it.each(READS)(
    "keeps a trace whose reads hold %s in a tracker's store, refusing nothing",
    async (_, reads, takes) => {
      const { server, base, id } = await holding(reads);
      const store = new Store(':memory:');
      try {
        const report = await keep({ store, sources: [base], now });
        expect(report.refused).toEqual([]);
        expect(report.errors).toEqual([]);
        expect(store.lines(P).map((l) => eventId(l.event))).toEqual([id]);
        expect(store.getBlob(GOOD)).toEqual(takes ? PAGE : null);
      } finally {
        store.close();
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
  );

  it('says in NODE.md section 5 that a read named by anything but a hash is not fetched and is no refusal', () => {
    const section = NODE.slice(NODE.indexOf('## 5. The keeper over a store'), NODE.indexOf('## 6. The mirror job'));
    expect(section).toContain(
      "5. **The reads.** The reads a chain's traces name are fetched under their hashes where they are not held. One that does not hash right is refused and not written. A read a trace names by anything but a hash, and reads that are not a list, are not fetched, and are no refusal: the core's shape reads no trace's body and a core client ignores the event (EXTENSIONS.md, What an extension may do), so the chain holds it, and no path is made of its words.",
    );
  });
});
