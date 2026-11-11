/**
 * The closed list of reasons a reading counts for nothing, which docs/v2/READING.md section 3 asks each reading to
 * say. The fixtures' README writes the words out, so a second implementation says them with no sight of this code,
 * and this test holds the README's list to `WHY`, each word there and no other. Section 3 gives each kind the order
 * its reasons are asked in, and this test holds that part to the list too: every reason is said there in its words.
 */
import { readFileSync } from 'node:fs';
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
  expect(section).toContain(`thirteen of the twenty`);
  expect(listed.length).toBe(20);
});

it('READING.md section 3 says every reason of the closed list where it gives the order they are asked in', () => {
  const section = reading.split('## 3. The record')[1]!.split('\n## ')[0]!;
  expect(Object.values(WHY).filter((why) => !section.includes(why))).toEqual([]);
});
