import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { textIssues } from '../src/index.js';

/**
 * Every pattern under examples/ passes the plain-text gate as a tracker applies it at its door: the title, what done
 * looks like, and each family's brief as written, slots and all. A slot whose name reads as a domain ({b.to}) is a
 * link to the gate, and the problem is refused whole; this caught the Bills of Mortality on 27 October 2026.
 */
const dir = join(import.meta.dirname, '..', '..', '..', 'examples');
const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();

describe('the example patterns and the gate', () => {
  it('finds the patterns', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const f of files) {
    it(`${f} passes the gate as written`, () => {
      const d = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { title: string; done_when: string; pieces: Record<string, { brief: string }> };
      const bad: string[] = [];
      const texts: [string, string][] = [['title', d.title], ['done_when', d.done_when], ...Object.entries(d.pieces).map(([n, p]): [string, string] => [`pieces.${n}.brief`, p.brief])];
      for (const [where, text] of texts) {
        const issues = textIssues(text);
        if (issues.length) bad.push(`${where}: ${issues.join(', ')}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
