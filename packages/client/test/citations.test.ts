/**
 * A citation in a comment sits whole on one line (AGENTS.md, The words). The code cites the documents by section, so
 * a search for "QX-19 section 4" or "CORE.md section 6" finds every comment that cites it only when no line break falls
 * inside one. The comments under each package's src and test, the card's sources, scripts and the example workers are
 * read. A citation is a document's name (CORE.md, verifiers.md) or an extension's number (QX-1) with the part it
 * names: a section or sections, a rule, a step or a fix, by number, a range such as "sections 3 to 6" among them, or
 * after a comma a part named in words, as in "APP.md, Search". A comment line that ends inside one and goes on with
 * the rest on the next comment line fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE = /\.(ts|mts|mjs|js|css|sh)$/;

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
 * Each line's comment text with its marker set aside, or null where the line is not a comment. A shell script's
 * comments open with `#`; in the other sources `#` opens a private name and not a comment. A line that opens with `//`
 * or a star is a comment, and so is every line of a block opened at the start of a line, up to the line that closes
 * it, with or without a leading star, as in window.css.
 */
function comments(text: string, shell: boolean): (string | null)[] {
  let inBlock = false;
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (shell) return trimmed.startsWith('#') ? trimmed.replace(/^#+\s*/, '') : null;
    const opens = trimmed.startsWith('/*');
    if (!inBlock && !opens && !/^(\/\/|\*)/.test(trimmed)) return null;
    if (opens && !trimmed.slice(2).includes('*/')) inBlock = true;
    else if (inBlock && trimmed.includes('*/')) inBlock = false;
    return trimmed
      .replace(/^(\/\/+|\/\*+|\*(?!\/))\s*/, '')
      .replace(/\s*\*\/$/, '')
      .trimEnd();
  });
}

const NAME = String.raw`(?:QX-\d+|[A-Za-z][\w-]*\.md)`;
const PART = String.raw`(?:sections?|rules?|steps?|fix(?:es)?)`;
const NUMBER = String.raw`\d+(?:\.\d+)*`;
const JOIN = String.raw`(?:,| to|, to| and|, and)`;

/** Where a citation can break, as the end of one comment line and the start of the next. */
const SPLITS: [end: RegExp, next: RegExp][] = [
  // "(QX-1" then "sections 3 to 6)", "(CORE.md," then "section 2)"
  [new RegExp(`${NAME},?$`), new RegExp(`^${PART} \\d`)],
  // "(APP.md," then "Search)": a document's name and a comma, with the part it names in words
  [/[\w-]\.md,$/, /^\S/],
  // "(CORE.md section" then "6)", "(QX-1 sections" then "3 to 6)"
  [new RegExp(`\\b${PART}$`), /^\d/],
  // "(QX-1 sections 3 to" then "6)", "(QX-1 sections 4 and" then "5)"
  [new RegExp(`\\b${PART} ${NUMBER}(?:${JOIN} ${NUMBER})*${JOIN}$`), /^\d/],
  // "(QX-1 sections 3" then "to 6)"
  [new RegExp(`\\b${PART} ${NUMBER}$`), /^(?:to|and) \d/],
];

/** The lines of a text where a comment's citation runs onto the next comment line, by line number from 1. */
function splitCitations(text: string, shell = false): number[] {
  const lines = comments(text, shell);
  const found: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const end = lines[i];
    const next = lines[i + 1];
    if (end == null || next == null) continue;
    if (SPLITS.some(([e, n]) => e.test(end) && n.test(next))) found.push(i + 1);
  }
  return found;
}

describe('a citation sits whole on one line', () => {
  it.each([
    ['a name, then its section', '// what the layer set aside (QX-19\n// section 4)'],
    ['a document in lower case, then its section', ' * the four kinds (verifiers.md\n * section 1)'],
    ['a name with a comma, then its section', ' * the canonical form (CORE.md,\n * section 2)'],
    ['a name, then its sections', ' * the window (QX-1\n * sections 3 to 6)'],
    ['the word section, then its number', '// the fields that agree (CORE.md section\n// 6)'],
    ['the word sections, then its range', ' * the verdicts (QX-1 sections\n * 3 to 6)'],
    ['a range broken after to', ' * the verdicts (QX-1 sections 3 to\n *      6; against a gold miss)'],
    ['a range broken after and', ' * the panel (QX-1 sections 4 and\n * 5)'],
    ['a range broken before to', ' * the verdicts (QX-1 sections 3\n * to 6)'],
    ['a name with a comma, then its rule', ' * the protocol reads no chain (AGENTS.md,\n * rule 10)'],
    ['a name with a comma, then a part in words', ' * as a search finds it (APP.md,\n * Search)'],
    ['a block with no leading star', '/* the narrow frame (QX-19\n   section 4) */'],
  ])('finds %s', (_, text) => {
    expect(splitCitations(text)).toEqual([1]);
  });

  it('finds one in a shell script, where # opens a comment', () => {
    expect(splitCitations('# the key (QX-17\n# section 5)', true)).toEqual([1]);
  });

  it('passes a citation whole on one line, and a name or a section with nothing of a citation after it', () => {
    const text = [
      ' * the version that replaced it (QX-19 section 4), on one line,',
      ' * 2 more, and the verdicts (QX-1 sections 3 to 6; against a gold miss, QX-16 section 4)',
      ' * 6 of them, then the window (QX-1)',
      ' * section 2 of a list that names no document, and the two documents CORE.md',
      ' * and QX-1.md',
    ].join('\n');
    expect(splitCitations(text)).toEqual([]);
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
