/**
 * Says the fixtures of reading 2 again (docs/v2/READING.md section 11): each file's ledger is read at each of its
 * times by the core's `read`, and what the read says is written where the answer was kept. The ledger is left as it
 * is, so every id, time and signature stands, which a second writing by the tracker's tests would replace. It is run
 * only where the answer over the ledgers kept is meant to change, in a pull request that says which answers and why,
 * as the README of `reading-2/` says; a file whose answers stand is not written.
 *
 *   tsx fixtures/say-again.ts
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ReadingFixture, readLedger, saidOf } from '../src/ledger.js';

/** A fixture with what the read says of its ledger now at each of its times, the ledger and the times as they were. */
export function saidAgain(f: ReadingFixture): ReadingFixture {
  const said = (now: string) => ({ now, expect: saidOf(readLedger(f.ledger, now), f.ledger) });
  return { ...f, readings: f.readings.map((r) => said(r.now)) };
}

const dir = join(dirname(fileURLToPath(import.meta.url)), 'reading-2');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .sort();
let written = 0;
for (const file of files) {
  const path = join(dir, file);
  const was = readFileSync(path, 'utf8');
  const now = `${JSON.stringify(saidAgain(JSON.parse(was) as ReadingFixture))}\n`;
  if (now === was) continue;
  writeFileSync(path, now);
  written++;
  console.log(`said again: ${file}`);
}
console.log(`${written} of ${files.length} fixtures said again`);
