/**
 * CORE.md section 9: the fixtures are the conformance test, and this library passes its own. Each fixture under
 * `fixtures/` is one test, named by its description, and so is each under `fixtures/clarifications/`, the sentences of
 * section 12 pinned one by one; `pnpm conform` runs the same check as a script.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkFixture, loadFixtures } from '../src/conformance.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixtures = loadFixtures(dir);
const clarifications = loadFixtures(join(dir, 'clarifications'));

describe('the conformance fixtures', () => {
  it('are at least the cases CORE.md section 9 lists', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(20);
  });
  for (const f of fixtures) {
    it(`${f.name}: ${f.description}`, () => {
      expect(checkFixture(f)).toEqual([]);
    });
  }
});

describe('the clarifications of section 12', () => {
  it('pin each sentence the two implementations once read apart', () => {
    expect(clarifications.length).toBeGreaterThanOrEqual(14);
  });
  for (const f of clarifications) {
    it(`${f.name}: ${f.description}`, () => {
      expect(checkFixture(f)).toEqual([]);
    });
  }
});
