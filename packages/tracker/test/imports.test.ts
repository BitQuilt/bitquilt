/**
 * The tracker's files load one another without a cycle (AGENTS.md, The shape of it), so the layer reads from the
 * bottom up: sortition.ts, verifiers.ts, stake.ts, gold.ts, standing.ts, then challenge.ts, each loading only files
 * before it. A file takes a type from a later one with `import type`, which loads nothing. Under verbatimModuleSyntax
 * an import of inline types alone still loads its module, so it counts here as a load. The layer's admissions sit in
 * the files of the rules they check, and each returns its part of the one Layer, a type, so moving them there added no
 * load.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const files = readdirSync(src)
  .filter((f) => f.endsWith('.ts'))
  .sort();

/** The tracker's own files a source loads: every import and re-export from './' but those marked `type` whole. */
function loads(text: string): string[] {
  const source = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest);
  const out: string[] = [];
  for (const s of source.statements) {
    const loaded =
      (ts.isImportDeclaration(s) && !s.importClause?.isTypeOnly) || (ts.isExportDeclaration(s) && !s.isTypeOnly);
    const from = loaded ? (s as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier : undefined;
    if (from && ts.isStringLiteral(from) && from.text.startsWith('./'))
      out.push(from.text.slice(2).replace(/\.js$/, '.ts'));
  }
  return out;
}

const graph = new Map(files.map((f) => [f, loads(readFileSync(join(src, f), 'utf8'))]));

/** The first cycle found, as the files around it with the first repeated at the end, or null where there is none. */
function cycle(): string[] | null {
  const done = new Set<string>();
  const path: string[] = [];
  const visit = (f: string): string[] | null => {
    const at = path.indexOf(f);
    if (at >= 0) return [...path.slice(at), f];
    if (done.has(f)) return null;
    path.push(f);
    for (const g of graph.get(f) ?? []) {
      const found = visit(g);
      if (found) return found;
    }
    path.pop();
    done.add(f);
    return null;
  };
  for (const f of files) {
    const found = visit(f);
    if (found) return found;
  }
  return null;
}

/** The layer's files from the bottom up. */
const LAYER = ['sortition.ts', 'verifiers.ts', 'stake.ts', 'gold.ts', 'standing.ts', 'challenge.ts'];

describe("the tracker's files as they load", () => {
  it('reads every file and finds the layer loading its rules', () => {
    expect(files).toEqual(expect.arrayContaining([...LAYER, 'tracker.ts', 'coin.ts', 'trace.ts']));
    expect(graph.get('challenge.ts')).toEqual(expect.arrayContaining(LAYER.slice(0, -1)));
  });

  it('form no cycle', () => {
    expect(cycle()).toBeNull();
  });

  it('read the layer from the bottom up, each file loading only those before it', () => {
    for (const [i, f] of LAYER.entries()) {
      const later = LAYER.slice(i + 1);
      expect(
        graph.get(f)!.filter((g) => later.includes(g)),
        f,
      ).toEqual([]);
    }
  });

  it('count an import of inline types alone as a load, and an import type as none', () => {
    expect(loads("import { type Layer } from './challenge.js';")).toEqual(['challenge.ts']);
    expect(loads("import type { Layer } from './challenge.js';")).toEqual([]);
    expect(loads("export { type Layer } from './challenge.js';")).toEqual(['challenge.ts']);
    expect(loads("export type { Layer } from './challenge.js';")).toEqual([]);
    expect(loads("import { reduce } from '@bitquilt/core';")).toEqual([]);
  });
});
