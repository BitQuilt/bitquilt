/**
 * The JavaScript modules that carry a declaration file beside them (examples/worker-loop.mjs, the house's loop, and
 * scripts/build-window.mjs) and that file. The client's tests compile against the .d.mts, never the .mjs, so nothing
 * else notices when the two part. Here each module's exported names are the values its .d.mts declares: a name added,
 * renamed or dropped on one side fails. The types behind the names are held by the tests that call them.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Every .mjs under examples/ and scripts/ that has a .d.mts beside it. */
const modules = ['examples', 'scripts'].flatMap((dir) => readdirSync(join(root, dir)).filter((f) => f.endsWith('.d.mts')).map((f) => join(root, dir, f.replace(/\.d\.mts$/, '.mjs'))));

/** The names a declaration file exports as values at run time: its functions, constants and classes, and not its types. */
function declaredValues(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const names = new Set<string>();
  for (const s of source.statements) {
    if (ts.isExportDeclaration(s) && !s.isTypeOnly && s.exportClause && ts.isNamedExports(s.exportClause)) {
      for (const e of s.exportClause.elements) if (!e.isTypeOnly) names.add(e.name.text);
      continue;
    }
    if (!ts.canHaveModifiers(s) || !ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if ((ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s)) && s.name) names.add(s.name.text);
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
  }
  return [...names].sort();
}

describe('a module and its declaration file', () => {
  it('are found for the house\'s loop and the window\'s build', () => {
    expect(modules.map((m) => relative(root, m))).toEqual(expect.arrayContaining([join('examples', 'worker-loop.mjs'), join('scripts', 'build-window.mjs')]));
  });

  it.each(modules.map((m) => [relative(root, m), m]))('%s exports the names its .d.mts declares', async (_name, file) => {
    expect(existsSync(file)).toBe(true);
    const exported = Object.keys((await import(pathToFileURL(file).href)) as Record<string, unknown>).sort();
    expect(exported).toEqual(declaredValues(file.replace(/\.mjs$/, '.d.mts')));
  });
});
