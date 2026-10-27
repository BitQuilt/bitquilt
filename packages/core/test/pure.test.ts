/**
 * AGENTS.md, rule 2: "Pure functions, pure inputs. Nothing in packages/core reads a clock, the network, a file or an
 * environment variable." Held here by reading the source: every file under src, except the two scripts conformance.ts
 * and verify.ts, which read fixture files and the command line, carries none of `node:`, `fetch(`, `Date.now` and
 * `process.`, in code or in a comment.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(import.meta.dirname, '..', 'src');
const SCRIPTS = ['conformance.ts', 'verify.ts'];
const IMPURE = ['node:', 'fetch(', 'Date.now', 'process.'];

describe('the core is pure', () => {
  const files = readdirSync(src).filter((f) => f.endsWith('.ts') && !SCRIPTS.includes(f)).sort();
  it('reads the source files', () => {
    expect(files.length).toBeGreaterThan(10);
  });
  for (const f of files) {
    it(`${f} reads no clock, network, file or environment`, () => {
      const text = readFileSync(join(src, f), 'utf8');
      expect(IMPURE.filter((token) => text.includes(token))).toEqual([]);
    });
  }
});
