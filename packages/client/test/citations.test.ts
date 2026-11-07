import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A citation in a comment sits whole on one line (AGENTS.md, "The words"). The code cites the documents by section, so
 * a search for "QX-19 section 4" or "CORE.md section 6" finds every comment that cites it only when no line break falls
 * inside one. The comments under each package's src and test, the card's sources, scripts and the example workers are
 * read. A comment line that ends with a document's name and goes on with "section" and its number, or ends with
 * "section" and goes on with the number, fails here.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE = /\.(ts|mts|mjs|js|css|sh)$/;
const COMMENT = /^\s*(\/\/+|\/\*+|\*)/;
const MARKER = /^\s*(\/\/+|\/\*+|\*)\s*/;
const SHELL_COMMENT = /^\s*#/;
const SHELL_MARKER = /^\s*#+\s*/;

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.endsWith('.generated.ts')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (SOURCE.test(name)) out.push(path);
  }
  return out;
}

function sources(): string[] {
  const dirs = [join(root, 'packages', 'client', 'window'), join(root, 'scripts'), join(root, 'examples')];
  for (const pkg of readdirSync(join(root, 'packages'))) {
    for (const sub of ['src', 'test']) {
      const dir = join(root, 'packages', pkg, sub);
      if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) dirs.push(dir);
    }
  }
  return dirs.flatMap((dir) => walk(dir, []));
}

/**
 * The lines of a text where a comment's citation runs onto the next comment line, by line number from 1. A shell
 * script's comments open with `#`; in the other sources `#` opens a private name and not a comment.
 */
function splitCitations(text: string, shell = false): number[] {
  const comment = shell ? SHELL_COMMENT : COMMENT;
  const marker = shell ? SHELL_MARKER : MARKER;
  const lines = text.split('\n');
  const found: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!comment.test(lines[i]!) || !comment.test(lines[i + 1]!)) continue;
    const end = lines[i]!.trimEnd();
    const next = lines[i + 1]!.replace(marker, '');
    const nameThenSection = /(QX-\d+|[A-Z]+\.md)$/.test(end) && /^section \d/.test(next);
    const sectionThenNumber = /\bsection$/.test(end) && /^\d/.test(next);
    if (nameThenSection || sectionThenNumber) found.push(i + 1);
  }
  return found;
}

describe('a citation sits whole on one line', () => {
  it('finds a citation split either way', () => {
    const text = [
      '// what the layer set aside (QX-19',
      '// section 4), and the fields that agree (CORE.md section',
      '// 6).',
      ' * the version that replaced it (QX-19 section 4), on one line',
      ' * section 2 of a list that names no document',
    ].join('\n');
    expect(splitCitations(text)).toEqual([1, 2]);
    expect(splitCitations('# the key (QX-17\n# section 5)', true)).toEqual([1]);
  });

  it('finds no comment in the code that splits one', () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(100);
    const split = files.flatMap((file) =>
      splitCitations(readFileSync(file, 'utf8'), file.endsWith('.sh')).map((line) => `${relative(root, file)}:${line}`),
    );
    expect(split).toEqual([]);
  });
});
