/**
 * docs/history/V2-PLAN.md, phase 2, the layer written down: "The tracker's layer, as it is, is run over every fixture
 * and over the ledgers its own tests build, and what it says is kept as fixtures. These are the law for the port."
 * Each fixture under `packages/core/fixtures/reading-2` is a ledger a tracker's test left in a booted tracker, with
 * what the layer says of it at two times, and the layer is held here to every one. docs/v2/READING.md section 11
 * expects each fixture of version 1 to stand with its states unchanged: the layer is run over the twenty-four and the
 * clarifications, and every place its answer is not the fixture's is listed below by name, with the reason.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { blobsOf, loadFixtures } from '../../core/src/conformance.js';
import { challengeLayer } from '../src/challenge.js';
import { READING_DIR, expectOf, layerOver, loadReadings } from './reading.js';

const readings = loadReadings();

describe('the fixtures of reading 2', () => {
  it('are kept, each with a ledger and two readings of it', () => {
    expect(readings.length).toBeGreaterThan(40);
    for (const f of readings) {
      expect(f.reading, f.name).toBe(2);
      expect(f.ledger.problems.length, f.name).toBeGreaterThan(0);
      expect(f.readings.length, f.name).toBe(2);
    }
  });

  it.each(readings.map((f) => [f.name, f] as const))('%s: the layer says what the fixture keeps', (_, f) => {
    for (const r of f.readings) {
      const said = JSON.parse(JSON.stringify(expectOf(layerOver(f.ledger, r.now), f.ledger)));
      expect(said, `${f.name} at ${r.now}`).toEqual(r.expect);
    }
  });
});

/**
 * Where the layer's answer over a fixture of version 1 is not the fixture's, by the fixture's name and the piece's:
 * the state the layer says. Each is a kind the core calls `unknown` and an extension decides (verifiers.md section 1),
 * so the layer opens the piece and what waited on it, as it does at the public tracker today.
 */
const APART: Record<string, Record<string, string>> = {
  // `summary` is a `judge:5` piece (QX-2): version 1 says `unknown`, and the layer opens it for candidates.
  '20-verifies-first-and-inputs-rendered': { summary: 'open' },
};

describe('the fixtures of version 1, read by the layer', () => {
  const v1 = join(READING_DIR, '..');
  const fixtures = [...loadFixtures(v1), ...loadFixtures(join(v1, 'clarifications'))];

  it('are the twenty-four and the clarifications', () => {
    expect(fixtures.length).toBe(24 + 15);
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s: each piece says the state the fixture expects', (_, f) => {
    const input = { envelopes: f.envelopes, blobs: blobsOf(f), receipts: f.receipts, now: f.now };
    const layer = challengeLayer({ problems: [input], now: f.now });
    expect([...layer.refused.keys()]).toEqual([]);
    const pl = [...layer.problems.values()][0]!;
    const apart: Record<string, string> = {};
    for (const p of pl.pieces) if (p.state !== f.expect.states[p.name]) apart[p.name] = p.state;
    expect(apart).toEqual(APART[f.name] ?? {});
    expect(Object.keys(f.expect.states).sort()).toEqual(pl.pieces.map((p) => p.name).sort());
    expect(pl.complete).toBe(f.expect.complete);
    expect(pl.fold.output?.hash ?? null).toBe(f.expect.output);
  });
});
