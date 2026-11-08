import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROLES } from '../src/node.js';

/**
 * docs/NODE.md held to the code it describes: the roles its first table names are the node's own, in the node's order;
 * each program its table of programs names is an executable a package declares, or a command `quilt` answers; every
 * executable of the four packages that keep a store is in that table; the doors the compose file runs are the node,
 * with the roles section 7 names for each; and every name it says a program reads from the environment is one
 * `.env.example` lists. A role, a program or a name added to the code or dropped from it shows here until the document
 * says so.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...path: string[]): string => readFileSync(join(root, ...path), 'utf8').replace(/\r\n/g, '\n');
const doc = read('docs', 'NODE.md');

/** The first cell of each row of the first table under the heading `title`, its backticks taken off. */
function firstCells(title: string): string[] {
  const start = doc.indexOf(`\n## ${title}\n`);
  expect(start, title).toBeGreaterThan(-1);
  const section = doc.slice(start + 1).split('\n## ')[0]!;
  const lines = section.split('\n');
  const table = lines.slice(lines.findIndex((l) => l.startsWith('|')));
  const end = table.findIndex((l) => !l.startsWith('|'));
  // The header row and the rule under it are not rows.
  const rows = (end < 0 ? table : table.slice(0, end)).slice(2);
  return rows.map((r) => r.split('|')[1]!.trim().replace(/`/g, ''));
}

/** The executables each package declares in its package.json, by package folder. */
function executables(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const pkg of readdirSync(join(root, 'packages'))) {
    const json = JSON.parse(read('packages', pkg, 'package.json')) as { bin?: Record<string, string> };
    out.set(pkg, Object.keys(json.bin ?? {}));
  }
  return out;
}

describe('docs/NODE.md', () => {
  it('names the roles the node has, in its order', () => {
    expect(firstCells('1. Roles')).toEqual([...ROLES]);
  });

  it('names programs that exist, and every program of the packages that keep a store', () => {
    const programs = firstCells('7. The programs');
    const bins = executables();
    const all = [...bins.values()].flat();
    const quilt = read('packages', 'client', 'src', 'bin.ts');
    for (const p of programs) {
      const [bin, command] = p.split(' ');
      expect(all, p).toContain(bin);
      if (command) expect(quilt, p).toContain(`case '${command}':`);
    }
    for (const pkg of ['node', 'tracker', 'hosted', 'mirror']) {
      for (const bin of bins.get(pkg) ?? []) expect(programs, pkg).toContain(bin);
    }
  });

  it('says the compose file runs the node for both doors, with the roles each is given', () => {
    const said =
      /The compose file runs `bitquilt-node` for both doors on the host: `([^`]+)` for the public tracker and `([^`]+)` for the second/.exec(
        doc,
      );
    expect(said).not.toBeNull();
    const compose = read('deploy', 'docker-compose.yml');
    const services = compose
      .slice(compose.indexOf('\nservices:\n'))
      .split(/\n {2}(?=[\w-]+:\n)/)
      .slice(1);
    const nodes = services
      .filter((body) => body.includes('"@bitquilt/node", "start"'))
      .map((body) => [body.split(':')[0], /\n\s+QUILT_ROLES: (\S+)/.exec(body)?.[1]]);
    expect(nodes).toEqual([
      ['tracker', said![1]],
      ['tracker-two', said![2]],
    ]);
  });

  it('says a program reads only names that .env.example lists', () => {
    const listed = read('.env.example');
    const named = doc.matchAll(/`((?:QUILT|BITQUILT)_[A-Z_]+|ANTHROPIC_API_KEY|OPENAI_API_KEY)\b/g);
    const names = [...new Set([...named].map((m) => m[1]!))];
    expect(names.length).toBeGreaterThan(20);
    for (const name of names) expect(listed, name).toMatch(new RegExp(`\\b${name}\\b`));
  });
});
