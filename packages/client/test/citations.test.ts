/**
 * A citation in a comment sits whole on one line (AGENTS.md, The words). The code cites the documents by section, so
 * a search for "QX-19 section 4" or "CORE.md section 6" finds every comment that cites it only when no line break falls
 * inside one. The comments under each package's src and test, the card's sources, scripts and the example workers are
 * read. A citation is a document's name (CORE.md, verifiers.md, RFC 8252) or an extension's number (QX-1) with the
 * part it names: a section, rule, step, item, stage or fix, in either case, by number or by a word for one, a range
 * such as "sections 3 to 6" among them, or with what it is of, as in "section 2 of QX-17" and "stage two of one peer";
 * and after a comma a part named by number or by one of the documents' own headings, quoted or not, as in
 * "APP.md, Search", "section 3, item 9" and "AGENTS.md, the arrows". A section cited without a document's name counts
 * too, as the core cites its own. Each comment line is read joined to the next, and a citation that runs across the
 * join fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SOURCE = /\.(ts|mts|mjs|js|css|sh)$/;

function walk(dir: string, out: string[], kind = SOURCE): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.endsWith('.generated.ts')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out, kind);
    else if (kind.test(name)) out.push(path);
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

/**
 * The names the documents give their parts: each heading, with its number and a trailing date set aside, the bold
 * words that open a paragraph, as CORE.md section 6 names Envelopes and Order, and the few plain words that open a
 * paragraph before a colon, as AGENTS.md names "The arrows". A heading with a colon is named by its first words too,
 * as "PROTOCOL.md, Identity" names "Identity: roots and delegates". Longest first, so the whole of a name is read
 * where a shorter one opens it.
 */
function headings(): string[] {
  const docs = [join(root, 'AGENTS.md'), join(root, 'README.md'), ...walk(join(root, 'docs'), [], /\.md$/)];
  const names = new Set<string>();
  for (const doc of docs) {
    const lines = readFileSync(doc, 'utf8').split('\n');
    for (const [i, line] of lines.entries()) {
      const opens = i === 0 || lines[i - 1]?.trim() === '';
      const title =
        /^#+\s+(?:\d+\.\s+)?(.+)$/.exec(line)?.[1] ??
        /^\*\*([^*]+)\*\*/.exec(line)?.[1] ??
        (opens ? /^([A-Z][\w'-]*(?: [\w'-]+){0,3}):\s/.exec(line)?.[1] : undefined);
      if (title == null) continue;
      const name = title
        .replace(/\s+\([^)]*\)$|,\s+\d.*$/, '')
        .replace(/[.:]$/, '')
        .trim();
      names.add(name);
      names.add(name.replace(/:.*$/, '').trim());
    }
  }
  return [...names].filter((name) => name.length > 1).sort((a, b) => b.length - a.length);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A heading as a pattern, its first letter in either case, since a comment says "one peer" for "One peer". */
function heading(name: string): string {
  const first = name.charAt(0);
  const either =
    first.toUpperCase() === first.toLowerCase() ? escape(first) : `[${first.toUpperCase()}${first.toLowerCase()}]`;
  return either + escape(name.slice(1));
}

const HEADINGS = `(?:${headings().map(heading).join('|')})`;
/** A heading, quoted or not, read to a word's end, so "Order" is not read in "Ordered". */
const HEADING = String.raw`(?:"${HEADINGS}"|${HEADINGS}(?![\w-]))`;
/** A document's name: an RFC by number, a file of the documents, or an extension's number with no file after it. */
const NAME = String.raw`(?:RFC \d+|[A-Za-z][\w-]*\.md|QX-\d+)`;
const PART = String.raw`(?:[Ss]ections?|[Rr]ules?|[Ss]teps?|[Ii]tems?|[Ss]tages?|[Ff]ix(?:es)?)`;
const NUMBER = String.raw`\d+(?:\.\d+)*`;
const NUMBERS = String.raw`${NUMBER}(?:(?:,|,? to|,? and) ${NUMBER})*`;
/** A part by number, or by a word for one, as "stage one" and "stage two" are cited. */
const NUMBERED = String.raw`${PART} (?:${NUMBERS}|(?:one|two|three|four|five)(?![\w-]))`;
/** A part's document or heading after "of", as in "section 2 of QX-17" and "stage two of one peer". */
const OF = String.raw`(?: of (?:${NAME}|${HEADING}))`;
/** A citation: a name with its part, or a part with what it is of or with nothing, then what its comma names. */
const CITATION = new RegExp(
  String.raw`(?:${NAME}(?:,? ${NUMBERED})?|${NUMBERED}${OF}?)(?:, (?:${NUMBERED}|${HEADING}))*`,
  'g',
);

/** The lines of a text where a comment's citation runs onto the next comment line, by line number from 1. */
function splitCitations(text: string, shell = false): number[] {
  const lines = comments(text, shell);
  const found: number[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    const end = lines[i];
    const next = lines[i + 1];
    if (end == null || next == null) continue;
    const joined = `${end} ${next}`;
    const across = [...joined.matchAll(CITATION)].some(
      (match) => match.index < end.length && match.index + match[0].length > end.length + 1,
    );
    if (across) found.push(i + 1);
  }
  return found;
}

describe('a citation sits whole on one line', () => {
  it('knows the parts the code names in words, from the documents', () => {
    const names = headings();
    const headed = ['Envelopes', 'Order', 'One peer', 'The window', 'The mirror', 'Search', 'Identity', 'next'];
    const opened = ['The arrows'];
    for (const name of [...headed, ...opened]) expect(names).toContain(name);
  });

  it.each([
    ['a name, then its section', '// what the layer set aside (QX-19\n// section 4)'],
    ['a document in lower case, then its section', ' * the four kinds (verifiers.md\n * section 1)'],
    ['a name with a comma, then its section', ' * the canonical form (CORE.md,\n * section 2)'],
    ['a name, then its sections', ' * the window (QX-1\n * sections 3 to 6)'],
    ['the word section, then its number', '// the fields that agree (CORE.md section\n// 6)'],
    ['the word Section, then its number', '// the fields that agree (CORE.md Section\n// 6)'],
    ['a section with no name, then its number and a part', '// a piece is named by hash. Section\n// 6, Envelopes: b'],
    ['the word sections, then its range', ' * the verdicts (QX-1 sections\n * 3 to 6)'],
    ['a range broken after to', ' * the verdicts (QX-1 sections 3 to\n *      6; against a gold miss)'],
    ['a range broken after and', ' * the panel (QX-1 sections 4 and\n * 5)'],
    ['a range broken before to', ' * the verdicts (QX-1 sections 3\n * to 6)'],
    ['a section, then of and its name', ' * the vesting (section 2 of\n * QX-17)'],
    ['a name with a comma, then its rule', ' * the protocol reads no chain (AGENTS.md,\n * rule 10)'],
    ['a name, then its item', ' * the launch list (LAUNCH.md\n * item 11)'],
    ['the word item, then its number', ' * the launch list (LAUNCH.md item\n * 11)'],
    ['a section and its item, then the number', ' * the counts (JOURNEY-AUDIT.md section 3, item\n * 9)'],
    ['a section and a comma, then its item', ' * the counts (JOURNEY-AUDIT.md section 3,\n * item 9)'],
    ['a section and a comma, then its step', '// the candidates (Section 7,\n// step 1)'],
    ['a section and a comma, then a heading', '// the receipt (CORE.md section 6,\n// Envelopes)'],
    ['a section with no name and a comma, then a heading', '// receipted first (section 6,\n// Order)'],
    ['a section and a comma, then a heading in lower case', ' * the store (WORKSHOP.md section 2,\n * one peer)'],
    [
      'a heading, then its stage after a second comma',
      ' * one node (WORKSHOP.md section 2, one peer,\n * stage three)',
    ],
    ['a section and a stage broken inside', ' * the loop (WORKSHOP.md section 2, stage\n * one)'],
    ['a name with a comma, then a heading', ' * as a search finds it (APP.md,\n * Search)'],
    ['a quoted heading broken inside', '// the ui:// resource (APP.md, "The\n// window")'],
    ['a heading broken inside', ' * the pull (PROTOCOL.md, The\n * mirror)'],
    ['a name with a comma, then a plain paragraph opener', ' * written out (AGENTS.md,\n * the arrows)'],
    ['a plain paragraph opener broken inside', ' * written out (AGENTS.md, the\n * arrows)'],
    ['a stage by a word, then of and a heading', ' * its own chain (stage two of\n * one peer)'],
    ['the word stage, then its word and what it is of', ' * its own chain (stage\n * two of one peer)'],
    ['an RFC, then its section', ' * the loopback port (RFC 8252\n * section 7.3)'],
    ['an RFC broken before its number', ' * the loopback port (RFC\n * 8252 section 7.3)'],
    ['an extension by its file, then its section', ' * the vesting (docs/ext/QX-17.md\n * section 4)'],
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
      ' * and QX-1.md, then the sentence a brief lacks (QX-19 section 4,',
      ' * sentence.ts), and the reducer (CORE.md section 6,',
      ' * the validation it runs), where the form RFC 8785 is',
      ' * the one a hash reads, as in step one of',
      ' * the three a key takes.',
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
