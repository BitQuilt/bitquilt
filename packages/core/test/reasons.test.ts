/**
 * The closed list of reasons a reading counts for nothing, which docs/v2/READING.md section 3 asks each reading to
 * say. The fixtures' README writes the words out, so a second implementation says them with no sight of this code,
 * and this test holds the README's list to `WHY`, each word there and no other. The README says which reasons no
 * fixture holds, and this test holds that to the fixtures: a reason is marked there where no answer kept says it.
 * Section 3 gives each kind the order its reasons are asked in, and this test holds that part to the list too:
 * every reason is said there in its words.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { WHY } from '../src/readings.js';

const here = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(here, '../fixtures/reading-2/README.md'), 'utf8');
const reading = readFileSync(join(here, '../../../docs/v2/READING.md'), 'utf8');

it("the fixtures' README lists every reason of the closed list, and no other", () => {
  const section = readme.split('## The reasons')[1]!.split('\n## ')[0]!;
  const listed = [...section.matchAll(/^- "([^"]+)"/gm)].map((m) => m[1]!);
  expect(listed).toEqual(Object.values(WHY));
  expect(listed.length).toBe(20);
});

it("the README marks the reasons no fixture holds, and they are the ones no fixture's answer says", () => {
  const section = readme.split('## The reasons')[1]!.split('\n## ')[0]!;
  const unheld = [...section.matchAll(/^- "([^"]+)", which no fixture holds$/gm)].map((m) => m[1]!);
  const dir = join(here, '../fixtures/reading-2');
  const said = new Set<string>();
  const walk = (o: unknown): void => {
    if (Array.isArray(o)) for (const v of o) walk(v);
    else if (o !== null && typeof o === 'object') {
      const { counts, why } = o as { counts?: unknown; why?: unknown };
      if (typeof counts === 'string' && typeof why === 'string') said.add(why);
      for (const v of Object.values(o)) walk(v);
    }
  };
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')))
    walk((JSON.parse(readFileSync(join(dir, f), 'utf8')) as { readings: unknown }).readings);
  expect(unheld).toEqual(Object.values(WHY).filter((why) => !said.has(why)));
  expect(section).toContain('all twenty');
});

it('READING.md section 3 says every reason of the closed list where it gives the order they are asked in', () => {
  const section = reading.split('## 3. The record')[1]!.split('\n## ')[0]!;
  expect(Object.values(WHY).filter((why) => !section.includes(why))).toEqual([]);
});
