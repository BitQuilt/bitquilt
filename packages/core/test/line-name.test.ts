/**
 * docs/v2/READING.md section 2: "A line is named by the hash of its first version, the one whose `prev` is null. A
 * reader that holds a line part of the way names it by the oldest version its chain reaches." This file holds the
 * name the read gives each problem (`lineName`, `ProblemLayer.line`) to the ledgers kept: every problem of every
 * fixture of reading 2 names a version its own chain reaches, the first where the ledger holds it, and the versions
 * of one line say one name. Then a ledger with a line's first version taken out, where the oldest version left names
 * the line. The second departure of the reading's section 12.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadReadings } from '../src/conformance.js';
import { problemHash } from '../src/envelope.js';
import type { Hash } from '../src/hash.js';
import { readLedger, saidOf } from '../src/ledger.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const readings = loadReadings(join(dir, 'reading-2'));

describe("a line's name", () => {
  it('is the hash of its first version, on every problem of every fixture of reading 2', () => {
    let named = 0;
    let later = 0;
    for (const f of readings) {
      const held = new Map(f.ledger.problems.map((p) => [problemHash(p.envelope), p.envelope] as const));
      for (const r of f.readings)
        for (const [hash, pl] of readLedger(f.ledger, r.now).problems) {
          const chain = pl.fold.chain.map((e) => problemHash(e));
          // The name is the oldest version the chain reaches, and the chain begins at the problem itself.
          expect(chain[0], f.name).toBe(hash);
          expect(pl.line, f.name).toBe(chain[chain.length - 1]);
          const first = held.get(pl.line)!;
          expect(first.problem.owner, f.name).toBe(pl.fold.envelope.problem.owner);
          named++;
          if (first.problem.prev === null) {
            if (pl.line !== hash) later++;
            continue;
          }
          // Where the chain stops short of a null `prev`, the ledger does not hold the version before, or it is not
          // one of this owner's.
          expect(held.get(first.problem.prev as Hash)?.problem.owner, f.name).not.toBe(first.problem.owner);
        }
    }
    expect(named).toBeGreaterThan(400);
    // The versions among the fixtures: problems named by a version before them.
    expect(later).toBeGreaterThan(20);
  });

  it('is one name on every version of a line, and the fixture says it', () => {
    for (const f of readings)
      for (const r of f.readings) {
        const reading = readLedger(f.ledger, r.now);
        const said = saidOf(reading, f.ledger) as { problems: Record<string, { line: Hash }> };
        for (const [hash, pl] of reading.problems) {
          expect(said.problems[hash]!.line, f.name).toBe(pl.line);
          for (const e of pl.fold.chain) {
            const other = reading.problems.get(problemHash(e));
            if (other) expect(other.line, f.name).toBe(pl.line);
          }
        }
      }
  });

  it('is the oldest version the chain reaches, where a reader holds the line part of the way', () => {
    const f = readings.find((x) => x.name === 'carried-1')!;
    const now = f.readings[f.readings.length - 1]!.now;
    const whole = readLedger(f.ledger, now);
    // A version of the fixture that another names as its `prev`, and whose own `prev` is null: the line's first.
    const first = [...whole.problems.values()].find(
      (pl) =>
        pl.fold.envelope.problem.prev === null &&
        [...whole.problems.values()].some((o) => o.line === pl.problem && o !== pl),
    )!;
    const laterOnes = [...whole.problems.values()].filter((pl) => pl.line === first.problem && pl !== first);
    expect(laterOnes.length).toBeGreaterThan(0);
    const part = { ...f.ledger, problems: f.ledger.problems.filter((p) => problemHash(p.envelope) !== first.problem) };
    const read = readLedger(part, now);
    for (const pl of laterOnes) {
      // The chain of each stops at the version made from the first, which is the oldest the reader holds.
      const there = read.problems.get(pl.problem)!;
      const oldest = there.fold.chain[there.fold.chain.length - 1]!;
      expect(oldest.problem.prev).toBe(first.problem);
      expect(there.line).toBe(problemHash(oldest));
    }
    // Versions made from that one still say one name, and it is not the name the whole line has.
    expect(new Set(laterOnes.map((pl) => read.problems.get(pl.problem)!.line)).has(first.problem)).toBe(false);
  });
});
