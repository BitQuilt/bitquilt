/**
 * One meaning per name (AGENTS.md, The names): in each package, an exported name is declared in one file. Two files of
 * one package that export the same name give it two meanings, and an import of it does not say which. Every .ts file
 * under each package's src is read, and the client's window with the client's; the overloads of one function are one
 * declaration. A name may stand in two packages, as listings.ts copies the tracker's shapes for the client.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const packages = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'src')));

/** The names each package still declares in two files, each renamed by a commit of its own. */
const READS_TWO_WAYS: Record<string, string[]> = {
  tracker: ['Admission: src/challenge.ts, src/trace.ts'],
  client: [
    'Found: src/quilt.ts, src/render.ts',
    'Kept: src/pool.ts, src/resolver.ts',
    'goldText: src/away.ts, src/render.ts',
  ],
};

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** The names a file declares with export: its functions, classes, interfaces, types, enums and variables. */
function exported(file: string): Set<string> {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const names = new Set<string>();
  for (const s of source.statements) {
    if (!ts.canHaveModifiers(s) || !ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    const named =
      ts.isFunctionDeclaration(s) ||
      ts.isClassDeclaration(s) ||
      ts.isInterfaceDeclaration(s) ||
      ts.isTypeAliasDeclaration(s) ||
      ts.isEnumDeclaration(s);
    if (named && s.name) names.add(s.name.text);
    if (ts.isVariableStatement(s))
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
  }
  return names;
}

/** Each name that more than one file of the package declares, with those files, in name order. */
function declaredTwice(pkg: string): string[] {
  const base = join(root, 'packages', pkg);
  const dirs = ['src', ...(pkg === 'client' ? ['window'] : [])].map((d) => join(base, d)).filter(existsSync);
  const where = new Map<string, string[]>();
  for (const file of dirs.flatMap((d) => walk(d, [])))
    for (const name of exported(file))
      where.set(name, [...(where.get(name) ?? []), relative(base, file).split(sep).join('/')]);
  return [...where]
    .filter(([, files]) => files.length > 1)
    .map(([name, files]) => `${name}: ${files.sort().join(', ')}`)
    .sort();
}

describe('one meaning per name', () => {
  it('reads every package', () => {
    expect(packages).toEqual(expect.arrayContaining(['core', 'tracker', 'client', 'hosted', 'node', 'mirror', 'coin']));
  });

  it.each(packages)('packages/%s declares each exported name in one file', (pkg) => {
    expect(declaredTwice(pkg)).toEqual(READS_TWO_WAYS[pkg] ?? []);
  });
});
