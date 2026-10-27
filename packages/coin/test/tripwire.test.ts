import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One door to the chain: `packages/coin/src/chain.ts` is the only file in the repository that imports the RPC
 * library, as the rally's gateway is the only file that imports a model SDK. Every `.ts` file under `packages/*\/src`
 * and `packages/*\/test` is read, and any other that imports or requires it fails this test.
 */
const here = dirname(fileURLToPath(import.meta.url));
const packages = join(here, '..', '..');
const DOOR = join('packages', 'coin', 'src', 'chain.ts');
const RPC_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]viem(?:\/[^'"]*)?['"]/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

describe('one door to the chain', () => {
  it('finds the RPC library imported in chain.ts and nowhere else', () => {
    const files: string[] = [];
    for (const pkg of readdirSync(packages)) {
      for (const sub of ['src', 'test']) {
        const dir = join(packages, pkg, sub);
        try {
          if (statSync(dir).isDirectory()) walk(dir, files);
        } catch {
          continue;
        }
      }
    }
    expect(files.length).toBeGreaterThan(10);
    const importing = files.filter((f) => readFileSync(f, 'utf8').split('\n').some((line) => RPC_IMPORT.test(line))).map((f) => relative(join(packages, '..'), f).split(sep).join('/'));
    expect(importing).toEqual([DOOR.split(sep).join('/')]);
  });
});
