/**
 * AGENTS.md, The words, held to the tests that read the documents. Every test file of a package whose code names a
 * Markdown file, as a string it reads, is named in that section: a document under docs/, a README or AGENTS.md itself.
 * So a test added to pin a document's sentence or table is named there by what it holds, beside the document it
 * reads. And every test the section names is a file that exists. A test is named by its path from the root, or by its
 * name alone after a path under its package earlier in the same line, as "`packages/mirror/test/coin.test.ts` and
 * `seed.test.ts`" names two of the mirror's; a name alone with no such path before it names a test some package has.
 * What the section says each test holds is held by review.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { repoRoot as root } from './helpers.js';

const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const exists = (path: string): boolean => existsSync(join(root, path));

const PACKAGES = readdirSync(join(root, 'packages')).filter((p) => exists(`packages/${p}/package.json`));

/** Every source under a package's test folder, by its path from the root. */
function testFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(join(root, dir))) {
      const path = `${dir}/${name}`;
      if (statSync(join(root, path)).isDirectory()) walk(path);
      else if (/\.(ts|mts)$/.test(name)) out.push(path);
    }
  };
  for (const p of PACKAGES) if (exists(`packages/${p}/test`)) walk(`packages/${p}/test`);
  return out.sort();
}

/** A test's file name: a name that ends in `.test.ts` or `.test-d.ts`. */
const TEST = /^[\w.-]+\.test(?:-d)?\.ts$/;

/**
 * The Markdown files a source's code names: each string or template whose text, with no space or colon, ends in `.md`,
 * as a document's path from the root, a path up to it from the test's own folder, or the `'.md'` a walk of the
 * documents filters by. A name in a comment, or in a sentence a test quotes, is not read.
 */
function markdownNamed(path: string): string[] {
  const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) text = node.templateSpans.at(-1)!.literal.text;
    if (text !== null && /^[^\s:]*\.md$/.test(text)) out.push(text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

/** The lines of AGENTS.md's The words, up to the next heading. */
function theWords(): string[] {
  const lines = read('AGENTS.md').split('\n');
  const start = lines.indexOf('## The words');
  expect(start, '## The words').toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** A test the section names: the path it resolves to, or its name alone where no path before it says its package. */
interface Named {
  written: string;
  path: string | null;
  name: string;
}

/**
 * The tests a line names, in its order. A name alone takes the package of the last path under `packages/` the line
 * gave before it, of a test or of anything else in that package.
 */
function namedIn(line: string): Named[] {
  const out: Named[] = [];
  let pkg: string | null = null;
  for (const m of line.matchAll(/`([^`]+)`/g)) {
    const token = m[1]!;
    const under = /^packages\/([\w-]+)(?:\/|$)/.exec(token);
    const name = token.split('/').at(-1)!;
    if (TEST.test(name)) {
      if (under) out.push({ written: token, path: token, name });
      else if (!token.includes('/'))
        out.push({ written: token, path: pkg ? `packages/${pkg}/test/${name}` : null, name });
    }
    if (under) pkg = under[1]!;
  }
  return out;
}

const NAMED = theWords().flatMap(namedIn);
const TESTS = testFiles();

/** The tests a name alone with no package before it could be: each package's test of that name. */
const anyOf = (name: string): string[] => TESTS.filter((t) => t.split('/').at(-1) === name);

describe('the tests that read the documents (AGENTS.md, The words)', () => {
  const readers = TESTS.filter((t) => markdownNamed(t).length > 0);

  it('finds the tests that read a document, a README or AGENTS.md, in every package that has one', () => {
    expect(readers.length).toBeGreaterThan(20);
    for (const t of [
      'packages/client/test/docs.test.ts',
      'packages/tracker/test/protocol-table.test.ts',
      'packages/hosted/test/onramp-table.test.ts',
      'packages/mirror/test/seed.test.ts',
      'packages/node/test/doc.test.ts',
      'packages/client/test/names.test.ts',
    ])
      expect(readers, t).toContain(t);
    expect(readers).not.toContain('packages/client/test/comment-width.test.ts');
  });

  it('names each of them in The words', () => {
    const named = new Set(NAMED.flatMap((n) => (n.path ? [n.path] : anyOf(n.name).length === 1 ? anyOf(n.name) : [])));
    expect(readers.filter((t) => !named.has(t))).toEqual([]);
  });

  it('names only tests that exist', () => {
    expect(NAMED.length).toBeGreaterThan(30);
    const gone = NAMED.filter((n) => (n.path ? !exists(n.path) : anyOf(n.name).length === 0)).map((n) => n.written);
    expect(gone).toEqual([]);
  });

  it('reads a name alone in the package a path before it on its line names, and the names a test reads', () => {
    expect(namedIn('by `packages/mirror/test/coin.test.ts` and `seed.test.ts`').map((n) => n.path)).toEqual([
      'packages/mirror/test/coin.test.ts',
      'packages/mirror/test/seed.test.ts',
    ]);
    expect(namedIn('the page in `packages/client/page/index.html`, held by `page.test.ts`')[0]!.path).toBe(
      'packages/client/test/page.test.ts',
    );
    expect(namedIn('`awayPrompt` in `away.ts`, held by `away.test.ts`')[0]!.path).toBeNull();
    expect(namedIn('held by `packages/tracker/test`, which asserts many')).toEqual([]);
    expect(markdownNamed('packages/hosted/test/redeem.test.ts')).toEqual(['COIN.md', 'PROTOCOL.md']);
    expect(markdownNamed('packages/client/test/citations.test.ts')).toContain('.md');
  });
});
