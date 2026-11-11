/**
 * The writer of the fixtures of reading 2: a ledger as a booted tracker's store holds it, the times it is read at, and
 * what the read says at each. docs/history/V2-PLAN.md, phase 2, calls these the law for the port. The ledger's shape,
 * the read of it and the form of what it says are the core's (`ledger.ts` there), and the core's own test holds its
 * `read` to every fixture; what stays here is the writing, which needs a tracker's store. With `QUILT_WRITE_READING=1`
 * the helpers' `boot` writes one for each tracker a test file booted, once the file has run, and one wherever a test
 * keeps a tracker as it stands or a ledger it built by hand. With `QUILT_WRITE_READING=new` only a fixture not yet
 * kept is written. vitest runs `*.test.ts` alone, so this file is no test of its own.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Envelope,
  type Hash,
  IDENTITY_LOG,
  type Ledger,
  type ReadingFixture,
  type Receipt,
  plusHours,
  problemHash,
  readLedger,
  saidOf,
} from '@bitquilt/core';
import { COIN_LOG } from '../src/coin.js';
import type { Store } from '../src/store.js';

export type { Ledger, ReadingFixture };

/** Where the fixtures of reading 2 are kept, beside version 1's. */
export const READING_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/reading-2');

/** The most a fixture's file may hold, in characters; a larger ledger is not kept. */
export const FIXTURE_MAX = 256 * 1024;

/**
 * A booted tracker's store as a fixture, read at its clock and again a thousand hours on, when every window has closed
 * and every lease and seat has run out; null where the store holds no problem or more lines than a fixture can carry.
 * A ledger the read throws on throws here too, and the caller leaves it out.
 */
export function fixtureOf(
  name: string,
  description: string,
  store: Store,
  now: string,
  options: { coin?: unknown; founding?: Record<string, number> },
): ReadingFixture | null {
  const held = store.listEnvelopes();
  if (held.length === 0) return null;
  if (held.reduce((n, e) => n + store.lines(e.hash).length, 0) > 1000) return null;
  const blobs: Record<string, string> = {};
  for (const { envelope } of held)
    for (const h of Object.values(envelope.problem.data)) {
      const b = store.getBlob(h);
      if (b) blobs[h] = Buffer.from(b).toString('base64');
    }
  const ledger: Ledger = {
    identity: store.lines(IDENTITY_LOG),
    problems: held.map(({ envelope }) => ({ envelope, lines: store.lines(problemHash(envelope)) })),
    blobs,
    coin: options.coin ? store.lines(COIN_LOG) : null,
    founding: options.founding ?? {},
    reads: {},
  };
  // The first pass asks the store for each read's length and keeps the answer; the passes after it read the fixture.
  const reads: Record<string, number | null> = {};
  const ask = (_: object, h: string | symbol) =>
    typeof h === 'string' ? (reads[h] = store.blobLength(h as Hash)) : null;
  const asking: Ledger = { ...ledger, reads: new Proxy({}, { get: ask }) };
  const times = [now, plusHours(now, 1000)];
  for (const at of times) saidOf(readLedger(asking, at), asking);
  for (const h of Object.keys(reads).sort()) ledger.reads[h] = reads[h]!;
  return fixtureOver(name, description, ledger, times);
}

/** A ledger as a fixture: what the read says of it at each time, read over the ledger as its JSON gives it back. */
export function fixtureOver(name: string, description: string, ledger: Ledger, times: string[]): ReadingFixture {
  const fixture: ReadingFixture = {
    name,
    description,
    reading: 2,
    ledger: JSON.parse(JSON.stringify(ledger)) as Ledger,
    readings: [],
  };
  fixture.readings = times.map((at) => ({ now: at, expect: saidOf(readLedger(fixture.ledger, at), fixture.ledger) }));
  return fixture;
}

/** One problem's envelope and receipts, built by hand with no tracker, as a ledger with nothing else in it. */
export function ledgerOf(envelope: Envelope, lines: Receipt[]): Ledger {
  return { identity: [], problems: [{ envelope, lines }], blobs: {}, coin: null, founding: {}, reads: {} };
}

/** Whether a fixture of this name is kept already. */
export function kept(name: string): boolean {
  return existsSync(join(READING_DIR, `${name}.json`));
}

/** Writes a fixture under the folder, by its name, and says whether it was small enough to keep. */
export function writeFixture(f: ReadingFixture): boolean {
  const text = `${JSON.stringify(f)}\n`;
  if (text.length > FIXTURE_MAX) return false;
  mkdirSync(READING_DIR, { recursive: true });
  writeFileSync(join(READING_DIR, `${f.name}.json`), text);
  return true;
}
