import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkFixture, loadFixtures } from '../src/conformance.js';

const fixtures = loadFixtures(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures'));

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
