/**
 * The Door (door.ts): the narrow set of effects a Quilt builds from its own signing, posting and reading and hands to
 * the files that work through it. The files door.ts's header names are the files that take it, and AGENTS.md names the
 * same, so a reader who asks where the home's key is used beyond quilt.ts finds every place. Both once said two files
 * where three took it. Each act of those files that a caller reaches through the Quilt keeps a method of its own name
 * on the Quilt, one line that hands over the door, so the work reads in the extension's file and no caller changes
 * when it moves there.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');
const named = (text: string, pattern: RegExp): string[] => [...text.matchAll(pattern)].map((m) => m[1]!).sort();

/** The files of the client's src that import the Door, the Quilt's own file aside. */
const taking = readdirSync(src)
  .filter(
    (f) => f.endsWith('.ts') && f !== 'quilt.ts' && /from '\.\/door\.js'/.test(readFileSync(join(src, f), 'utf8')),
  )
  .sort();

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(file, readFileSync(join(src, file), 'utf8'), ts.ScriptTarget.Latest, true);

/** The functions a file exports. */
function exportedFunctions(file: string): string[] {
  return parse(file)
    .statements.filter(
      (s): s is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(s) &&
        !!s.name &&
        !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    )
    .map((s) => s.name!.text);
}

/** The Quilt's methods, by name, with their bodies. */
function quiltMethods(): Map<string, ts.Block> {
  const quilt = parse('quilt.ts').statements.find(
    (s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'Quilt',
  )!;
  const out = new Map<string, ts.Block>();
  for (const m of quilt.members)
    if (ts.isMethodDeclaration(m) && ts.isIdentifier(m.name) && m.body) out.set(m.name.text, m.body);
  return out;
}

describe('the Door', () => {
  it('goes to the files its header and AGENTS.md name, and to no other', () => {
    expect(taking).toEqual(['coin.ts', 'gold.ts', 'sharpen.ts', 'stake.ts', 'trace.ts']);
    const header = readFileSync(join(src, 'door.ts'), 'utf8');
    expect(named(header.slice(0, header.indexOf(': ')), /\((\w+\.ts)\)/g)).toEqual(taking);
    const agents = readFileSync(join(here, '..', '..', '..', 'AGENTS.md'), 'utf8');
    const clause = agents.slice(0, agents.indexOf('through the `Door` in `door.ts`'));
    expect(named(clause.slice(clause.lastIndexOf(';')), /`(\w+\.ts)`/g)).toEqual(taking);
  });

  it('leaves the Quilt a one-line method of the same name for each act a caller reaches through it', () => {
    const acts = new Set(taking.flatMap(exportedFunctions));
    const methods = quiltMethods();
    const kept = [...methods.keys()].filter((name) => acts.has(name)).sort();
    expect(kept).toEqual(
      expect.arrayContaining(['commitGold', 'freeze', 'pay', 'revealGold', 'sharpen', 'sharpenDue', 'stakeRule']),
    );
    for (const name of kept) {
      const body = methods.get(name)!.statements;
      expect(body, name).toHaveLength(1);
      const only = body[0]!;
      const call = ts.isReturnStatement(only) ? only.expression : undefined;
      expect(call && ts.isCallExpression(call), name).toBe(true);
      const { expression, arguments: args } = call as ts.CallExpression;
      const callee = ts.isPropertyAccessExpression(expression) ? expression.name.text : expression.getText();
      expect(callee, name).toBe(name);
      expect(args[0]?.getText(), name).toBe('this.door');
    }
  });
});
