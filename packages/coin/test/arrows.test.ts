/**
 * The arrows between the packages (AGENTS.md, "The shape of it"): the core imports nothing from the repository; the
 * tracker, the client and the coin import the core; hosted imports the tracker and the client; the mirror imports the
 * tracker, and its binary the coin; the node imports the tracker, the client, hosted and the mirror. Nothing in the
 * tracker or the core knows the coin package exists. Held here by reading every import in every package, by package
 * name and by relative path. A package's code outside its tests imports only what its arrow names, and the core, which
 * every package rests on. A test may cross an arrow, as the client's listings.test-d.ts does to hold its copies to the
 * tracker's types, so the tests are held to two rules alone: packages/mirror/src/bin.ts is the one file that imports
 * the coin, and nothing in packages/core imports from outside it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..', '..', '..');
const packages = join(repo, 'packages');

/** What each package's code may import from the repository besides the core, by folder, as AGENTS.md states it. */
const ARROWS: Record<string, string[]> = {
  core: [],
  tracker: [],
  client: [],
  coin: [],
  hosted: ['tracker', 'client'],
  mirror: ['tracker'],
  node: ['tracker', 'client', 'hosted', 'mirror'],
};
/** The one file that imports the coin package: the mirror's binary, which hands the mirror the chain as an argument. */
const COIN_DOOR = 'packages/mirror/src/bin.ts';
/** Written by scripts/build-window.mjs and never committed: the window as one string of markup, with no imports. */
const GENERATED = 'window.generated.ts';
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

const folders = readdirSync(packages).filter((f) => statSync(join(packages, f)).isDirectory());
const byName = new Map(
  folders.map((f) => [
    (JSON.parse(readFileSync(join(packages, f, 'package.json'), 'utf8')) as { name: string }).name,
    f,
  ]),
);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === GENERATED) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.[cm]?[jt]s$/.test(name)) out.push(path);
  }
  return out;
}

/** A file's place in the repository, with forward slashes. */
const shown = (path: string): string => relative(repo, path).split(sep).join('/');

/** The package folder an import reaches, `outside` for the rest of the repository, null for a library or a built-in. */
function reached(file: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    const parts = shown(resolve(dirname(file), specifier)).split('/');
    return parts[0] === 'packages' && parts[1] ? parts[1] : 'outside';
  }
  const scoped = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!;
  return byName.get(scoped) ?? null;
}

interface Import {
  file: string;
  from: string;
  test: boolean;
  to: string;
}

const imports: Import[] = folders.flatMap((from) =>
  walk(join(packages, from), []).flatMap((path) => {
    const file = shown(path);
    const test = file.startsWith(`packages/${from}/test/`);
    return [...readFileSync(path, 'utf8').matchAll(SPECIFIER)]
      .map((m) => reached(path, m[1]!))
      .filter((to): to is string => to !== null && to !== from)
      .map((to) => ({ file, from, test, to }));
  }),
);

describe('the arrows between the packages', () => {
  it('reads every package and finds imports between them', () => {
    expect(folders.length).toBe(Object.keys(ARROWS).length);
    expect(imports.filter((i) => !i.test).length).toBeGreaterThan(30);
  });

  it('names an arrow for every package', () => {
    expect(folders.filter((f) => !(f in ARROWS))).toEqual([]);
  });

  it("imports only along the package's arrow outside the tests", () => {
    const crossing = imports
      .filter((i) => !i.test && i.to !== 'core' && !ARROWS[i.from]!.includes(i.to))
      .filter((i) => !(i.file === COIN_DOOR && i.to === 'coin'))
      .map((i) => `${i.file} imports ${i.to}`);
    expect(crossing).toEqual([]);
  });

  it('finds the coin imported by the mirror binary and nowhere else', () => {
    const importing = [...new Set(imports.filter((i) => i.to === 'coin').map((i) => i.file))];
    expect(importing).toEqual([COIN_DOOR]);
  });

  it('finds nothing in the core or the tracker that imports the coin', () => {
    const knowing = imports.filter((i) => (i.from === 'core' || i.from === 'tracker') && i.to === 'coin');
    expect(knowing.map((i) => `${i.file} imports ${i.to}`)).toEqual([]);
  });

  it('finds nothing in the core that imports from the repository outside it', () => {
    expect(imports.filter((i) => i.from === 'core').map((i) => `${i.file} imports ${i.to}`)).toEqual([]);
  });
});
