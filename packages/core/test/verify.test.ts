import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type ReadingFixture, problemHash, reduce } from '../src/index.js';
import { verifyMap } from '../src/verify.js';

/**
 * The verify script's map, which reads a clone of one chain as a ledger of one problem. It holds
 * docs/v2/READING.md section 1, whose ledger is what "a reader holds", with a reader that has no tracker.
 * Each piece has the one state reading 2 gives it. The fixture record-1 is one problem with a record piece, which
 * reading 1 does not know: the map says `recorded` where the fixture does, and reading 1's fold of the chain does not.
 */
const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/reading-2/record-1.json', import.meta.url), 'utf8'),
) as ReadingFixture;
const { envelope, lines } = fixture.ledger.problems[0]!;
const { now, expect: said } = fixture.readings[0]! as {
  now: string;
  expect: { problems: Record<string, { views: { state: string }[]; pieces: Record<string, number> }> };
};
const receipts = [...lines, ...fixture.ledger.identity];

describe('the verify script reads a clone by reading 2 (READING.md section 1)', () => {
  it('gives each piece the one state the reading gives it', () => {
    const map = verifyMap([envelope], new Map(), receipts, now);
    const expected = said.problems[problemHash(envelope)]!;
    const states = Object.fromEntries(
      map.filter((l) => l.startsWith('  ') && !l.startsWith('  dropped')).map((l) => l.trim().split(/\s+/).slice(0, 2)),
    );
    expect(states).toEqual(
      Object.fromEntries(Object.entries(expected.pieces).map(([name, at]) => [name, expected.views[at]!.state])),
    );
    expect(Object.values(states)).toContain('recorded');
    const one = reduce({ envelopes: [envelope], blobs: new Map(), receipts, now });
    expect(one.pieces.map((v) => v.state as string)).not.toContain('recorded');
  });

  it('says a problem the core refuses is refused, with the reason', () => {
    const lacking = { ...envelope, problem: { ...envelope.problem, data: { paper: `sha256:${'0'.repeat(64)}` } } };
    expect(verifyMap([lacking as typeof envelope], new Map(), [], now)[0]).toMatch(/^refused: /);
  });
});
