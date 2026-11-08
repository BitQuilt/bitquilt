/**
 * The tracker's files load one another without a cycle (AGENTS.md, The shape of it), so the layer reads from the
 * bottom up: sortition.ts, verifiers.ts, stake.ts, gold.ts, standing.ts, then challenge.ts, each loading only files
 * before it. A file takes a type from a later one with `import type`, which loads nothing. Under verbatimModuleSyntax
 * an import of inline types alone still loads its module, so it counts here as a load. The layer's admissions sit in
 * the files of the rules they check, and each returns its part of the one Layer, a type, so moving them there added no
 * load. The door's jobs (tracker.ts, Context) are admit.ts, which takes a post, views.ts, which answers a read, and
 * hand.ts, which hands a key a piece: tracker.ts loads each, and each takes the tracker's context from it as a type
 * alone. Each names the part of the context it reads in its `Reads`. views.ts and hand.ts leave `exactly` out of
 * theirs, so a read cannot ask for the layer built afresh, and they load nothing of the door. None of the three keeps a
 * value that changes at the top of its module, so what a tracker keeps from one request to the next is its context's,
 * one per tracker (kept-layer.test.ts and coin-home.test.ts hold that as it runs).
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

/** The members of the context a job's `Reads` names: the string literals of its `Pick<Context, ...>`. */
function readsOf(text: string): string[] {
  const source = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest);
  for (const s of source.statements) {
    if (!ts.isTypeAliasDeclaration(s) || s.name.text !== 'Reads' || !ts.isTypeReferenceNode(s.type)) continue;
    const [context, members] = s.type.typeArguments ?? [];
    if (!context || context.getText(source) !== 'Context' || !members) return [];
    const literals = ts.isUnionTypeNode(members) ? members.types : [members];
    return literals.flatMap((t) => (ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal) ? [t.literal.text] : []));
  }
  return [];
}

/**
 * What a source keeps at the top of its module that can change: a `let` or a `var`, or a Map, Set or WeakMap made
 * there.
 */
function kept(text: string): string[] {
  const source = ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest);
  const out: string[] = [];
  for (const s of source.statements) {
    if (!ts.isVariableStatement(s)) continue;
    const mutable = !(s.declarationList.flags & ts.NodeFlags.Const);
    for (const d of s.declarationList.declarations) {
      const made = d.initializer && ts.isNewExpression(d.initializer) ? d.initializer.expression.getText(source) : '';
      if (mutable || ['Map', 'Set', 'WeakMap'].includes(made)) out.push(d.name.getText(source));
    }
  }
  return out;
}

/** The door's jobs, each a file that takes the tracker's context. */
const JOBS = ['admit.ts', 'views.ts', 'hand.ts'];
const text = (f: string): string => readFileSync(join(src, f), 'utf8');

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

describe("the door's jobs", () => {
  it('are each loaded by tracker.ts, and take its context as a type alone', () => {
    expect(graph.get('tracker.ts')).toEqual(expect.arrayContaining(JOBS));
    for (const f of [...JOBS, 'peers.ts']) expect(graph.get(f), f).not.toContain('tracker.ts');
    for (const f of JOBS) expect(text(f), f).toMatch(/^import type \{ Context \} from '\.\/tracker\.js';$/m);
  });

  it("each name the part of the context they read, the views' and the hand-out's without exactly", () => {
    const reads = new Map(JOBS.map((f) => [f, readsOf(text(f))]));
    for (const [f, members] of reads) expect(members, f).toEqual(expect.arrayContaining(['store', 'now', 'layer']));
    expect(reads.get('admit.ts')).toContain('exactly');
    expect(reads.get('views.ts')).not.toContain('exactly');
    expect(reads.get('hand.ts')).not.toContain('exactly');
  });

  it('load nothing of the door where they answer a read or hand out a piece', () => {
    expect(graph.get('views.ts')).not.toContain('admit.ts');
    expect(graph.get('hand.ts')).not.toContain('admit.ts');
  });

  it('keep nothing that changes at the top of their modules', () => {
    for (const f of JOBS) expect(kept(text(f)), f).toEqual([]);
    expect(kept('let homeRate = null;\nconst memo = new WeakMap();\nconst MAX = 4;')).toEqual(['homeRate', 'memo']);
  });
});
