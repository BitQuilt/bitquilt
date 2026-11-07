/**
 * One meaning per name (AGENTS.md, The names): in each package, an exported name is declared in one file. Two files of
 * one package that export the same name give it two meanings, and an import of it does not say which. Every .ts file
 * under each package's src is read but a generated one, and the client's window with the client's; the overloads of
 * one function are one declaration. A name may stand in two packages, as listings.ts copies the tracker's shapes for
 * the client. The one short name AGENTS.md fixes is held too: wherever the tracker and the mirror bind `pl`, the type
 * checker finds a ProblemLayer.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const packages = readdirSync(join(root, 'packages')).filter((p) => existsSync(join(root, 'packages', p, 'src')));

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (name.endsWith('.ts') && !name.endsWith('.generated.ts')) out.push(path);
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
    expect(declaredTwice(pkg)).toEqual([]);
  });
});

/** Each place the files under `dirs` bind `name`, as the file, the line and the type, with undefined taken off. */
function bindings(name: string, dirs: string[]): string[] {
  const base = ts.readConfigFile(join(root, 'tsconfig.base.json'), ts.sys.readFile).config as object;
  const { options } = ts.parseJsonConfigFileContent(base, ts.sys, root);
  const files = dirs.flatMap((d) => walk(join(root, d), []));
  // Without the node types: no binding asked about needs them, and the check stays quick beside the tests that post.
  const program = ts.createProgram(files, { ...options, noEmit: true, types: [] });
  const checker = program.getTypeChecker();
  const out: string[] = [];
  for (const file of files) {
    const source = program.getSourceFile(file)!;
    const visit = (node: ts.Node): void => {
      const { parent } = node;
      const bound =
        ts.isIdentifier(node) &&
        node.text === name &&
        (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent)) &&
        parent.name === node;
      if (bound) {
        const type = checker.typeToString(checker.getNonNullableType(checker.getTypeAtLocation(node)));
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        out.push(`${relative(root, file).split(sep).join('/')}:${line} ${type}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

describe('the short name AGENTS.md fixes', () => {
  it('says pl is a ProblemLayer', () => {
    expect(readFileSync(join(root, 'AGENTS.md'), 'utf8')).toContain(
      'in the tracker and the mirror, `pl` is a `ProblemLayer` wherever it is bound',
    );
  });

  it('finds a ProblemLayer wherever the tracker and the mirror bind pl', () => {
    const found = bindings('pl', ['packages/tracker/src', 'packages/mirror/src']);
    expect(found.length).toBeGreaterThan(20);
    expect(found.filter((b) => !b.endsWith(' ProblemLayer'))).toEqual([]);
  });
});
