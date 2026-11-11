/**
 * docs/v2/READING.md section 11: "A client conforms to reading 2 when it reproduces the state of every fixture of
 * reading 2." Each fixture under `fixtures/reading-2` is a ledger a tracker's test left in a booted tracker, with what
 * the read says of it at two times, and the core's `read` is held here to every one, with nothing of a tracker in the
 * test; `pnpm conform:2` runs the same check as a script. Section 11 expects each fixture of version 1 to stand with
 * its states unchanged too: the read is run over the twenty-four and the clarifications, and every place its answer is
 * not the fixture's is listed below by name, with the reason. The fixtures were written from the tracker's layer
 * as docs/history/V2-PLAN.md, phase 2, says, and the tracker's tests still write them (its `test/reading.ts`).
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blobsOf, checkReading, loadFixtures, loadReadings } from '../src/conformance.js';
import { read } from '../src/read.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const readings = loadReadings(join(dir, 'reading-2'));

describe('the fixtures of reading 2', () => {
  it('are kept, each with a ledger and two readings of it', () => {
    expect(readings.length).toBeGreaterThan(40);
    for (const f of readings) {
      expect(f.reading, f.name).toBe(2);
      expect(f.ledger.problems.length, f.name).toBeGreaterThan(0);
      expect(f.readings.length, f.name).toBe(2);
    }
  });

  it.each(readings.map((f) => [f.name, f] as const))('%s: the read says what the fixture keeps', (_, f) => {
    expect(checkReading(f)).toEqual([]);
  });

  it('says where a read differs, by the time and the place', () => {
    const f = structuredClone(readings[0]!);
    const expect0 = f.readings[0]!.expect as { refused: Record<string, string> };
    expect0.refused = { 'sha256:00': 'a reason no read gave' };
    expect(checkReading(f)).toEqual([
      `at ${f.readings[0]!.now}, /refused/sha256:00: nothing, expected "a reason no read gave"`,
    ]);
  });
});

/**
 * Where the read's answer over a fixture of version 1 is not the fixture's, by the fixture's name and the piece's:
 * the state the read says. Each is a kind version 1 calls `unknown` and reading 2 decides (verifiers.md section 1),
 * so the read opens the piece and what waited on it, as the public tracker does today.
 */
const APART: Record<string, Record<string, string>> = {
  // `summary` is a `judge:5` piece (QX-2): version 1 says `unknown`, and the read opens it for candidates.
  '20-verifies-first-and-inputs-rendered': { summary: 'open' },
};

describe('the fixtures of version 1, read by reading 2', () => {
  const fixtures = [...loadFixtures(dir), ...loadFixtures(join(dir, 'clarifications'))];

  it('are the twenty-four and the clarifications', () => {
    expect(fixtures.length).toBe(24 + 15);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s: each piece says the state the fixture expects', (_, f) => {
    const input = { envelopes: f.envelopes, blobs: blobsOf(f), receipts: f.receipts, now: f.now };
    const reading = read({ problems: [input], now: f.now });
    expect([...reading.refused.keys()]).toEqual([]);
    const pl = [...reading.problems.values()][0]!;
    const apart: Record<string, string> = {};
    for (const p of pl.pieces) if (p.state !== f.expect.states[p.name]) apart[p.name] = p.state;
    expect(apart).toEqual(APART[f.name] ?? {});
    expect(Object.keys(f.expect.states).sort()).toEqual(pl.pieces.map((p) => p.name).sort());
    expect(pl.complete).toBe(f.expect.complete);
    expect(pl.fold.output?.hash ?? null).toBe(f.expect.output);
  });
});
