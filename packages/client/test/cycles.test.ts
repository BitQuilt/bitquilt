/**
 * The client's files import one another without a loop at run time. The files that take the Door (door.ts) import
 * nothing of quilt.ts's at run time, at most a type, so they make no loop with it; and the owner's turn (owner-turn.ts)
 * imports types alone, so the away run and the on-ramp can import it without the away run coming back round; the agent
 * CLIs (agents.ts) and the schedule (schedule.ts) take nothing of the away run, so `quilt sharpen` asks an agent
 * without it. Under verbatimModuleSyntax only `import type` and `export type` are erased when the code runs, so a loop
 * of those is only the type checker's to follow. An import whose every name is marked `type` keeps its line and loads
 * its file, so it is an edge here like any other.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const read = (file: string): string => readFileSync(join(src, file), 'utf8');

/**
 * Whether an import or export is erased when the code runs: a whole `import type` or `export type`, and nothing else,
 * since verbatimModuleSyntax keeps `import { type A }` as `import {}` and `export { type A }` as `export {}`.
 */
function typesAlone(s: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isImportDeclaration(s)) return !!s.importClause?.isTypeOnly;
  return s.isTypeOnly;
}

/** The files of the same folder a source imports at run time. */
function importsOf(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest);
  const to: string[] = [];
  for (const s of source.statements) {
    if (!ts.isImportDeclaration(s) && !ts.isExportDeclaration(s)) continue;
    const spec = s.moduleSpecifier && ts.isStringLiteral(s.moduleSpecifier) ? s.moduleSpecifier.text : null;
    if (!spec?.startsWith('./') || typesAlone(s)) continue;
    to.push(spec.slice(2).replace(/\.js$/, '.ts'));
  }
  return to;
}

/** Each file of the client's src, with the files of the same folder it imports at run time. */
function edges(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of readdirSync(src).filter((f) => f.endsWith('.ts'))) out.set(file, importsOf(file, read(file)));
  return out;
}

/** Each loop found by a walk from every file, as the files in order with the first again at the end. */
function loops(graph: Map<string, string[]>): string[] {
  const found: string[] = [];
  const seen = new Map<string, 'walking' | 'done'>();
  const path: string[] = [];
  const walk = (file: string): void => {
    seen.set(file, 'walking');
    path.push(file);
    for (const next of graph.get(file) ?? []) {
      if (seen.get(next) === 'walking') found.push([...path.slice(path.indexOf(next)), next].join(' -> '));
      else if (!seen.has(next)) walk(next);
    }
    path.pop();
    seen.set(file, 'done');
  };
  for (const file of graph.keys()) if (!seen.has(file)) walk(file);
  return found;
}

describe("the client's imports", () => {
  it('read every file, the Quilt and the extension files among them', () => {
    expect([...edges().keys()]).toEqual(
      expect.arrayContaining(['quilt.ts', 'stake.ts', 'sharpen.ts', 'owner-turn.ts', 'away.ts']),
    );
  });

  it('count an import of names each marked type as an edge, and a whole import type or export type as none', () => {
    const planted = [
      "import type { A } from './a.js';",
      "import { type B } from './b.js';",
      "import { type C, type D } from './c.js';",
      "export type { E } from './e.js';",
      "export { type F } from './f.js';",
      "import { G } from './g.js';",
    ].join('\n');
    expect(importsOf('planted.ts', planted)).toEqual(['b.ts', 'c.ts', 'f.ts', 'g.ts']);
  });

  it('make no loop at run time', () => {
    expect(loops(edges())).toEqual([]);
  });

  it('give the files that take the Door nothing of the Quilt at run time, at most a type', () => {
    const graph = edges();
    const taking = [...graph.keys()].filter((f) => f !== 'quilt.ts' && /from '\.\/door\.js'/.test(read(f))).sort();
    expect(taking).toEqual(['coin.ts', 'gold.ts', 'propose.ts', 'sharpen.ts', 'stake.ts', 'trace.ts']);
    for (const file of taking) expect(graph.get(file), file).not.toContain('quilt.ts');
  });

  it('give the owner-turn file types alone, so the away run and the on-ramp import it without a loop', () => {
    expect(edges().get('owner-turn.ts')).toEqual([]);
  });

  it('give the agent CLIs no file of the client and the schedule the agent CLIs alone, so neither takes the away run', () => {
    const graph = edges();
    expect(graph.get('agents.ts')).toEqual([]);
    expect(graph.get('schedule.ts')).toEqual(['agents.ts']);
    expect(graph.get('away.ts')).toEqual(expect.arrayContaining(['agents.ts', 'schedule.ts']));
  });
});
