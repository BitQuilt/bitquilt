/**
 * The programs and the roles each runs (the table at the head of packages/node/src/node.ts): a row for each program
 * that runs a role, the four whose packages declare them as binaries and the client's `quilt serve`, in the table's
 * order. bitquilt-node's binary alone calls `start`, and each of the others calls the first part its row names, which
 * `start` runs too, so the table says of each program what its code does.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

/** Each program the table names, with the file its code starts in. */
const PROGRAMS: [string, string][] = [
  ['bitquilt-node', 'packages/node/src/bin.ts'],
  ['bitquilt-tracker', 'packages/tracker/src/bin.ts'],
  ['bitquilt-hosted', 'packages/hosted/src/bin.ts'],
  ['bitquilt-mirror', 'packages/mirror/src/bin.ts'],
  ['quilt serve', 'packages/client/src/bin.ts'],
];

/** The table's rows, each program with the words of its row joined across its lines. */
function rows(): [string, string][] {
  const head = read('packages/node/src/node.ts').split('*/')[0]!;
  const out: [string, string][] = [];
  for (const line of head.split('\n')) {
    const row = /^ \* {3}(bitquilt-\w+|quilt serve)\s{2,}(.+)$/.exec(line);
    const more = /^ \* {21}(\S.*)$/.exec(line);
    if (row) out.push([row[1]!, row[2]!]);
    else if (more && out.length) out[out.length - 1]![1] += ` ${more[1]}`;
  }
  return out;
}

describe('the programs and their roles', () => {
  it('has a row for each program that runs a role, as the packages declare their binaries', () => {
    expect(rows().map(([name]) => name)).toEqual(PROGRAMS.map(([name]) => name));
    for (const [name, file] of PROGRAMS.slice(0, 4)) {
      const pkg = JSON.parse(read(`${file.split('/src/')[0]}/package.json`)) as { bin: Record<string, string> };
      expect(pkg.bin[name], name).toBe('./src/bin.ts');
    }
    expect(read('packages/client/src/bin.ts')).toContain("case 'serve': {");
  });

  it('has bitquilt-node alone call start, and each other program the first part its row names', () => {
    expect(read('packages/node/src/bin.ts')).toMatch(/\bstart\(/);
    const node = read('packages/node/src/node.ts');
    for (const [name, words] of rows().slice(1)) {
      const file = PROGRAMS.find(([n]) => n === name)![1];
      const part = /`(\w+)`/.exec(words)![1]!;
      expect(read(file), name).not.toMatch(/\bstart\(/);
      expect(read(file), `${name} calls ${part}`).toMatch(new RegExp(`\\b${part}\\(`));
      if (part !== 'mirror') expect(node, `start runs ${part}`).toMatch(new RegExp(`\\b${part}\\(`));
    }
    expect(node, 'start runs the pull mirror runs').toMatch(/\bkeepSwarm\(/);
  });
});
