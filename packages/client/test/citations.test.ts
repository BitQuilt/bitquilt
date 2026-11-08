/**
 * The code's citations of the documents (AGENTS.md, The words). The code cites the documents by section, and two rules
 * keep a citation worth following. It sits whole on one line, so a search for "QX-19 section 4" or "CORE.md section 6"
 * finds every comment that cites it only when no line break falls inside one. And it names a part its document has:
 * the document is there, each section it names by number is a numbered heading of it, and what it names after a comma
 * is a part of that section, or of the document where it names no section. The comments read are those of each
 * package's sources, tests, page, card and fixture writer, the deploy files, the contracts, the scripts and the
 * examples, so a comment a new test or document brings is read the day it lands.
 *
 * A citation is a document's name (CORE.md, verifiers.md, docs/ext/QX-21.md, RFC 8252) or an extension's number
 * (QX-1) with the part it names: a section, rule, step, item, stage or fix, in either case, by number or by a word for
 * one, a range such as "QX-1 sections 3 to 6" among them, or with what it is of, as in "section 2 of QX-17"; and after
 * a comma a part by number or by its name, as in "CORE.md section 7, step 1" and "APP.md, Search". A section cited
 * without a document's name is of the first document the file's header names, as the core's files name CORE.md. An
 * extension's number names the document its row in the registry links. A record under docs/history/ is named by its
 * path there, so a reader takes it for a record of its day and not a rule. An RFC is another body's document, and is
 * not followed.
 *
 * The words after a comma run to the next mark, such as a comma, a colon or a closing parenthesis. They are a part's
 * name, and held to it, where they are quoted, where they follow a document's name alone, as in
 * "AGENTS.md, the arrows", where they open with a capital letter after a part or an extension's number, as in
 * "CORE.md section 6, Roots and delegates", and where the whole of them is one of the documents' own names in any
 * case, as in "CORE.md section 4, the event line". After a part's comma, or an extension's number alone, words in
 * lower case that are not the whole of such a name are prose and pass, even where they open with one, as in
 * "QX-19 section 4, next hands the piece on", and so does a file's name, as in "QX-19 section 4, sentence.ts". So a
 * title a comment cites in lower case after a part is held while its heading keeps its name, as CORE.md's do, the
 * core being frozen.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CommentSyntax, codeFiles, commentLines, repoRoot as root, syntaxOf } from './helpers.js';

/** A path from the root, with forward slashes on every system. */
const fromRoot = (path: string): string => relative(root, path).split(sep).join('/');

/** Where the repository keeps Markdown, as docs.test.ts reads it: the two files at its root, and the folders walked. */
const FOLDERS = ['docs', 'examples', 'deploy', 'apps', 'impl', 'packages', 'site'];

/** Every Markdown file under a folder, by its path from the root; dependencies, builds and hidden folders left out. */
function markdownUnder(folder: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist')
        markdownUnder(path, out);
    } else if (entry.name.endsWith('.md')) out.push(path);
  }
  return out;
}

/** A heading of a document: its level, its number where it is numbered, its name, and the lines it spans. */
interface Heading {
  level: number;
  number: string | null;
  name: string;
  start: number;
  end: number;
}

/** A document as the citations read it: its path from the root, its lines with fenced blocks blanked, its headings. */
interface Doc {
  path: string;
  lines: string[];
  headings: Heading[];
}

/** A name as a comment cites it: code marks, a closing parenthesis or date, and closing punctuation set aside. */
function bare(name: string): string {
  return name
    .replace(/`/g, '')
    .replace(/\s+\([^)]*\)$|,\s+\d.*$/, '')
    .replace(/[.:]$/, '')
    .trim();
}

/**
 * A document by its path from the root. A heading inside a fenced block is an example and not a part, so the block's
 * lines are blanked; each heading spans the lines up to the next heading of its level or above, so a section holds its
 * subsections, as QX-11 section 7 holds 7.2.
 */
function readDoc(path: string): Doc {
  let fenced = false;
  const lines = readFileSync(join(root, path), 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => {
      if (/^(```|~~~)/.test(line)) fenced = !fenced;
      return fenced || /^(```|~~~)/.test(line) ? '' : line;
    });
  const headings: Heading[] = [];
  for (const [i, line] of lines.entries()) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const numbered = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(m[2]!);
    const name = bare(numbered?.[2] ?? m[2]!);
    headings.push({ level: m[1]!.length, number: numbered?.[1] ?? null, name, start: i, end: lines.length });
  }
  for (const [j, h] of headings.entries()) {
    const next = headings.slice(j + 1).find((later) => later.level <= h.level);
    if (next) h.end = next.start;
  }
  return { path, lines, headings };
}

const DOCS = new Map(
  ['README.md', 'AGENTS.md', ...FOLDERS.flatMap((folder) => markdownUnder(folder))].map((p) => [p, readDoc(p)]),
);

/**
 * The names a document gives its parts within lines [start, end): each heading, and the part of one before a colon,
 * as "PROTOCOL.md, Identity" names "Identity: roots and delegates"; the bold words that open a paragraph or a list
 * item, as CORE.md section 6 names Envelopes and CORE.md section 11 the stamp; and the few plain words that open a
 * paragraph before a colon, as AGENTS.md names "The arrows".
 */
function namesIn(doc: Doc, start = 0, end = doc.lines.length): string[] {
  const names: string[] = [];
  for (let i = start; i < end; i++) {
    const line = doc.lines[i]!;
    const opens = i === 0 || doc.lines[i - 1]!.trim() === '';
    const title =
      /^#{1,6}\s+(?:\d+(?:\.\d+)*\.?\s+)?(.+?)\s*#*\s*$/.exec(line)?.[1] ??
      /^\s*(?:[-*]\s+|\d+\.\s+)?\*\*([^*]+)\*\*/.exec(line)?.[1] ??
      (opens ? /^([A-Z][\w'-]*(?: [\w'-]+){0,3}):\s/.exec(line)?.[1] : undefined);
    if (title == null) continue;
    const name = bare(title);
    names.push(name, name.replace(/:.*$/, '').trim());
  }
  return names.filter((name) => name.length > 1);
}

/** The numbers of the list items within lines [start, end), as AGENTS.md numbers its rules. */
function itemsIn(doc: Doc, start: number, end: number): Set<string> {
  const items = new Set<string>();
  for (let i = start; i < end; i++) {
    const m = /^\s*(\d+)\.\s/.exec(doc.lines[i]!);
    if (m) items.add(m[1]!);
  }
  return items;
}

/** Every name the documents give a part, longest first, so the whole of a name is read where a shorter one opens it. */
function headings(): string[] {
  const names = new Set([...DOCS.values()].flatMap((doc) => namesIn(doc)));
  return [...names].sort((a, b) => b.length - a.length);
}

/** Each extension's number, with the document its row in docs/EXTENSIONS.md links under ext/, or null for none. */
const REGISTRY = new Map<string, string | null>();
for (const line of readFileSync(join(root, 'docs', 'EXTENSIONS.md'), 'utf8').split('\n')) {
  const row = /^\|\s*(QX-\d+)\s*\|/.exec(line);
  const link = /\]\((ext\/[^)#\s]+\.md)\)/.exec(line)?.[1];
  if (row) REGISTRY.set(row[1]!, link ? `docs/${link}` : null);
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A heading as a pattern, its first letter in either case, since a comment says "one peer" for "One peer". */
function heading(name: string): string {
  const first = name.charAt(0);
  const either =
    first.toUpperCase() === first.toLowerCase() ? escape(first) : `[${first.toUpperCase()}${first.toLowerCase()}]`;
  return either + escape(name.slice(1));
}

const NAMES = headings();
const HEADINGS = `(?:${NAMES.map(heading).join('|')})`;
/** A heading, quoted or not, read to a word's end, so "Order" is not read in "Ordered". */
const HEADING = String.raw`(?:"${HEADINGS}"|${HEADINGS}(?![\w-]))`;
/** A document's name: an RFC by number, a file of the documents, or an extension's number with no file after it. */
const NAME = String.raw`(?:RFC \d+|[A-Za-z][\w-]*\.md|QX-\d+)`;
const PART = String.raw`(?:[Ss]ections?|[Rr]ules?|[Ss]teps?|[Ii]tems?|[Ss]tages?|[Ff]ix(?:es)?)`;
const NUMBER = String.raw`\d+(?:\.\d+)*`;
const NUMBERS = String.raw`${NUMBER}(?:(?:,|,? to|,? and) ${NUMBER})*`;
/** A part by number, or by a word for one, as "stage one" and "stage two" are cited. */
const WORDS = String.raw`(?:one|two|three|four|five)(?![\w-])`;
const NUMBERED = String.raw`${PART} (?:${NUMBERS}|${WORDS})`;
/** A part's document or heading after "of", as in "section 2 of QX-17" and "stage two of one peer". */
const OF = String.raw`(?: of (?:${NAME}|${HEADING}))`;
/** A citation: a name with its part, or a part with what it is of or with nothing, then what its comma names. */
const CITATION = new RegExp(
  String.raw`(?:${NAME}(?:,? ${NUMBERED})?|${NUMBERED}${OF}?)(?:, (?:${NUMBERED}|${HEADING}))*`,
  'g',
);

/** The lines of a text where a comment's citation runs onto the next comment line, by line number from 1. */
function splitCitations(text: string, syntax: CommentSyntax = 'slash'): number[] {
  const lines = commentLines(text, syntax);
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

/** What a citation names inside its sections, or inside its document: a part by number, or a part by its name. */
type Within = { part: string; numbers: string[] } | { title: string };

/** A citation as a comment writes it, before its document is looked up. */
interface Cited {
  /** The citation's own text. */
  text: string;
  /** The document's name as written, or null for a section cited without one. */
  name: string | null;
  /** The sections it names by number, empty where it names none. */
  sections: string[];
  /** What it names after a comma, in order, each inside what came before it. */
  within: Within[];
}

/** A document's name with a path before it, as "docs/ext/QX-21.md" and "fixtures/README.md" are cited. */
const PATHED = String.raw`(?:[\w.-]+\/)*[A-Za-z][\w-]*\.md|QX-\d+|RFC \d+`;
/** Numbers in a list or a range, which ends in "and" or "to", so a date after a comma is not read as a number. */
const DIGITS = String.raw`${NUMBER}(?:(?:, ${NUMBER})*(?:,? and|,? to) ${NUMBER})*(?![\w-])`;
const START = new RegExp(String.raw`(?<![\w./-])(${PATHED})(?![\w-])|(?<![\w-])([Ss]ections?) (${DIGITS})`, 'g');
const NUMBERED_AT = (lead: string) => new RegExp(String.raw`^${lead}(${PART}) (${DIGITS}|${WORDS})`);
const FIRST_PART = NUMBERED_AT(',? ');
const NEXT_PART = NUMBERED_AT(', ');
const OF_NAME = new RegExp(String.raw`^ of (${PATHED})(?![\w-])`);
/** Where a name after a comma ends: at a stop mark or the line's end, not at a file's dot, so "next.ts" is no name. */
const STOP = String.raw`(?=\s*(?:[);:,"(]|\.(?!\w)|$))`;
/** After a comma, the whole of one of the documents' names, up to the next stop mark, in either case. */
const NAMED_AT = new RegExp(String.raw`^, (?!(?:${PATHED})(?![\w-]))(${NAMES.map(escape).join('|')})${STOP}`, 'i');
/** After a document's comma, the words up to where a name would end, where they are not another document's name. */
const CLAIMED = new RegExp(String.raw`^, (?!(?:${PATHED})(?![\w-]))([^);:,."(]+)`);
/**
 * After a part's comma, or an extension's number alone, words that open with a capital letter, up to where a name
 * would end: a title, not prose.
 */
const TITLED = new RegExp(String.raw`^, (?!(?:${PATHED})(?![\w-]))([A-Z][^);:,."(]*)`);

/** A part's word in the singular and in lower case: "Sections" is "section", "fixes" is "fix". */
const singular = (part: string): string =>
  part
    .toLowerCase()
    .replace(/^fixes$/, 'fix')
    .replace(/s$/, '');

/** The numbers a part names, a range "3 to 6" read as every number in it. */
function numbers(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/,? and |, /)) {
    const range = /^(\d+) to (\d+)$/.exec(piece);
    if (!range) out.push(...piece.split(/,? to /));
    else for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(String(n));
  }
  return out;
}

/** The citations in one comment line, in the order they stand. */
function citationsIn(text: string): Cited[] {
  const out: Cited[] = [];
  const start = new RegExp(START);
  for (let m = start.exec(text); m; m = start.exec(text)) {
    const cited: Cited = { text: '', name: m[1] ?? null, sections: m[1] ? [] : numbers(m[3]!), within: [] };
    let at = m.index + m[0].length;
    if (cited.name) {
      const part = FIRST_PART.exec(text.slice(at));
      const quoted = /^ "([^"]+)"/.exec(text.slice(at));
      if (part && singular(part[1]!) === 'section') cited.sections = numbers(part[2]!);
      else if (part) cited.within.push({ part: singular(part[1]!), numbers: numbers(part[2]!) });
      else if (quoted) cited.within.push({ title: quoted[1]! });
      at += (part ?? quoted)?.[0].length ?? 0;
    } else {
      const of = OF_NAME.exec(text.slice(at));
      if (of) cited.name = of[1]!;
      at += of?.[0].length ?? 0;
    }
    for (;;) {
      const rest = text.slice(at);
      const part = NEXT_PART.exec(rest);
      const found = part ?? /^, "([^"]+)"/.exec(rest) ?? NAMED_AT.exec(rest);
      const afterPart = cited.sections.length > 0 || cited.within.length > 0;
      const extension = /^QX-\d+$/.test(cited.name ?? '');
      const claim = afterPart || extension ? TITLED : cited.name?.endsWith('.md') ? CLAIMED : null;
      const match = found ?? claim?.exec(rest) ?? null;
      if (!match) break;
      if (part) cited.within.push({ part: singular(part[1]!), numbers: numbers(part[2]!) });
      else cited.within.push({ title: match[1]!.trim() });
      at += match[0].length;
    }
    cited.text = text.slice(m.index, at);
    out.push(cited);
    start.lastIndex = at;
  }
  return out;
}

/** The document a name cites from a file, or why it cites none; null for a number with no document of its own. */
function lookUp(name: string, from: string): Doc | null | string {
  if (/^QX-\d+$/.test(name)) {
    if (!REGISTRY.has(name)) return `${name} is no number the registry assigns`;
    const path = REGISTRY.get(name);
    return path ? (DOCS.get(path) ?? `the registry links ${name} to ${path}, which is not there`) : null;
  }
  const found = [...DOCS.keys()].filter((path) => path === name || path.endsWith(`/${name}`));
  let path = found.length === 1 ? found[0] : undefined;
  for (let dir = dirname(from); !path && found.length > 1; dir = dirname(dir)) {
    path = found.find((p) => p === (dir === '.' ? name : `${dir}/${name}`));
    if (dir === '.') break;
  }
  if (!path) return found.length ? `${name} names ${found.length} documents` : `no document is at ${name}`;
  if (path.startsWith('docs/history/') && !name.includes('history/'))
    return `${name} is a dated record, named by its path ${path}`;
  return DOCS.get(path)!;
}

/** Why a citation names no part its document has, or null where it does. `home` is what a bare section is of. */
function wrongWith(cited: Cited, from: string, home: string | null): string | null {
  const name = cited.name ?? home;
  if (name == null) return "a section with no document's name, in a file whose header names no document";
  if (name.startsWith('RFC ')) return null;
  const doc = lookUp(name, from);
  if (typeof doc === 'string') return doc;
  if (doc == null) return cited.sections.length || cited.within.length ? `${name} has no document of its own` : null;
  let scopes = [{ where: doc.path, start: 0, end: doc.lines.length }];
  if (cited.sections.length) {
    scopes = [];
    for (const n of cited.sections) {
      const h = doc.headings.find((section) => section.number === n);
      if (!h) return `${doc.path} has no section ${n}`;
      scopes.push({ where: `${doc.path} section ${n}`, start: h.start, end: h.end });
    }
  }
  const where = () => scopes.map((s) => s.where).join(' or ');
  for (const w of cited.within) {
    if ('title' in w) {
      const title = bare(w.title).toLowerCase();
      const named = (n: string) => n.toLowerCase() === title || n.replace(/:.*$/, '').trim().toLowerCase() === title;
      const inScope = (line: number) => scopes.some((s) => line >= s.start && line < s.end);
      const headed = doc.headings.filter((h) => inScope(h.start) && named(h.name));
      if (headed.length)
        scopes = headed.map((h) => ({ where: `${doc.path}, "${h.name}"`, start: h.start, end: h.end }));
      else if (!scopes.some((s) => namesIn(doc, s.start, s.end).some(named)))
        return `${where()} has no part named "${w.title}"`;
    } else {
      for (const n of w.numbers) {
        const has = (s: { start: number; end: number }) =>
          w.part === 'stage'
            ? new RegExp(String.raw`\bstage ${n}\b`, 'i').test(doc.lines.slice(s.start, s.end).join('\n'))
            : itemsIn(doc, s.start, s.end).has(n);
        if (!scopes.some(has)) return `${where()} has no ${w.part} ${n}`;
      }
    }
  }
  return null;
}

/** The first document a file's header names, the opening run of its comment lines: what its bare sections are of. */
function homeOf(lines: (string | null)[], from: string): string | null {
  const first = lines.findIndex((line) => line != null);
  if (first < 0) return null;
  const end = lines.findIndex((line, i) => i > first && line == null);
  const header = lines.slice(first, end < 0 ? undefined : end).join(' ');
  for (const { name } of citationsIn(header)) {
    const doc = name && !name.startsWith('RFC ') ? lookUp(name, from) : null;
    if (doc && typeof doc === 'object') return name;
  }
  return null;
}

/** What is wrong with each citation in a comment line, cited from a file whose bare sections are of `home`. */
function wrongIn(text: string, from = 'packages/client/src/quilt.ts', home: string | null = null): string[] {
  return citationsIn(text).flatMap((cited) => {
    const why = wrongWith(cited, from, home);
    return why ? [`${cited.text}: ${why}`] : [];
  });
}

describe('a citation sits whole on one line', () => {
  it('knows the parts the code names in words, from the documents', () => {
    const names = headings();
    const headed = ['Envelopes', 'Order', 'One peer', 'The window', 'The mirror', 'Search', 'Identity', 'next'];
    const opened = ['The arrows', 'The stamp'];
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
    expect(splitCitations('# the key (QX-17\n# section 5)', 'hash')).toEqual([1]);
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
    const files = codeFiles();
    expect(files.length).toBeGreaterThan(200);
    const split = files.flatMap((file) =>
      splitCitations(readFileSync(file, 'utf8'), syntaxOf(basename(file))!).map((line) => `${fromRoot(file)}:${line}`),
    );
    expect(split).toEqual([]);
  });
});

describe('a citation names a part its document has', () => {
  it.each([
    ['a section by number', '// the seam (QX-19 section 4)'],
    ['sections by a range and a list', '// the verdicts (QX-1 sections 3 to 6; CORE.md sections 4, 6 and 11)'],
    ['a section and a part it names in bold', '// the receipt (CORE.md section 6, Envelopes)'],
    ['a section and its title', '// the line (CORE.md section 4, the event line)'],
    ['a section and its step', '// the candidates (CORE.md section 7, step 1)'],
    ['a section and a heading inside it', '// the panel (verifiers.md section 2, judge:n)'],
    ['a document and a heading, in lower case', '// as a search finds it (APP.md, search)'],
    ['a document and a heading quoted', '// the card (APP.md, "The window")'],
    ['a document and a heading before its colon', '// a root (PROTOCOL.md, Identity)'],
    ['a document and a list item named in bold', '// the stamp (CORE.md, the stamp)'],
    ['a document and a plain paragraph opener', '// written out (AGENTS.md, the arrows)'],
    ['a document and its rule', '// one door (AGENTS.md, rule 10)'],
    ['a document, a heading and its step', '// the default (docs/DEPLOY.md, "Bringing it up, in order", step 5)'],
    ['a section of an extension', '// the vesting (section 2 of QX-17)'],
    ['an extension by its file and its sections', '// the pull (docs/ext/QX-21.md, sections 2 and 5)'],
    ['a verifier kind by its number', '// the rank (QX-2 section 2)'],
    ['a record by its path', '// the funnel (docs/history/JOURNEY-AUDIT.md section 3, item 9)'],
    ['a list of documents', '// the kinds (CORE.md, verifiers.md, RFC 8252)'],
    ['an RFC, which is not followed', '// the port (RFC 8252 section 7.3)'],
    ['a number with no document of its own, named alone', '// the stamp (QX-7)'],
    ['a section, then words that name no part', '// the gate (CORE.md section 11, and the stamp at the door)'],
    ['a section, then a file after its comma', '// the sentence a brief lacks (QX-19 section 4, sentence.ts)'],
    ['a section, then a file whose name opens with a part', '// the hand-out (QX-19 section 4, next.ts)'],
    ['a section, then prose that opens with a name', '// the hand-out (QX-19 section 4, next hands the piece on)'],
    ['a section, then prose that opens with a heading', '// the hash (CORE.md section 2, order of the keys)'],
    ['a section, its title, then prose', '// the fold (CORE.md section 6, Roots and delegates, and the Drop list)'],
  ])('passes %s', (_, text) => {
    expect(wrongIn(text)).toEqual([]);
  });

  it.each([
    ['a section the document lacks', '// the seam (QX-19 section 9)', 'docs/ext/QX-19.md has no section 9'],
    ['a range past the last section', '// (QX-1 sections 9 to 11)', 'docs/ext/QX-1.md has no section 11'],
    [
      'a part named in another section',
      '// the receipt (CORE.md section 5, Envelopes)',
      'docs/CORE.md section 5 has no part named "Envelopes"',
    ],
    [
      'a part of another document',
      '// what a tracker hands (CORE.md, assisted next)',
      'docs/CORE.md has no part named "assisted next"',
    ],
    ['a heading quoted that is not there', '// (APP.md, "The windows")', 'docs/APP.md has no part named "The windows"'],
    ['a name after a comma that is no part', '// (APP.md, the card)', 'docs/APP.md has no part named "the card"'],
    [
      'a title after a section that names nothing',
      '// (QX-11 section 7, The vanished part)',
      'docs/ext/QX-11.md section 7 has no part named "The vanished part"',
    ],
    [
      'a title after a section that only opens with a name',
      '// the receipt (CORE.md section 6, Envelopes order)',
      'docs/CORE.md section 6 has no part named "Envelopes order"',
    ],
    [
      'a title after a document that only opens with a heading',
      '// the card (APP.md, The window manager)',
      'docs/APP.md has no part named "The window manager"',
    ],
    [
      "a title after an extension's number alone",
      '// the root (QX-11, The vanished part)',
      'docs/ext/QX-11.md has no part named "The vanished part"',
    ],
    ['a rule past the last', '// (AGENTS.md, rule 11)', 'AGENTS.md has no rule 11'],
    ['a step of the wrong heading', '// (docs/DEPLOY.md, "The walk", step 10)', 'has no step 10'],
    ['a document moved away', '// the default (docs/LAUNCH.md step 5)', 'no document is at docs/LAUNCH.md'],
    [
      'a record named as if it were a rule',
      '// the funnel (JOURNEY-AUDIT.md section 3, item 9)',
      'JOURNEY-AUDIT.md is a dated record, named by its path docs/history/JOURNEY-AUDIT.md',
    ],
    ['a number the registry lacks', '// (QX-99)', 'QX-99 is no number the registry assigns'],
    ['a section of a number with no document', '// (QX-7 section 2)', 'QX-7 has no document of its own'],
  ])('finds %s', (_, text, why) => {
    const wrong = wrongIn(text);
    expect(wrong).toHaveLength(1);
    expect(wrong[0]).toContain(why);
  });

  it("reads a section with no document's name as of the first document the file's header names", () => {
    const header = commentLines('/**\n * The reducer (CORE.md section 6), and QX-19.\n */\nconst x = 1;', 'slash');
    expect(homeOf(header, 'packages/core/src/reduce.ts')).toBe('CORE.md');
    expect(wrongIn('// the hash (section 3)', 'packages/core/src/reduce.ts', 'CORE.md')).toEqual([]);
    expect(wrongIn('// the order (section 6, Order)', 'packages/core/src/reduce.ts', 'CORE.md')).toEqual([]);
    expect(wrongIn('// (section 13)', 'packages/core/src/reduce.ts', 'CORE.md')).toEqual([
      'section 13: docs/CORE.md has no section 13',
    ]);
    expect(wrongIn('// (section 4)', 'packages/core/src/reduce.ts', null)[0]).toContain("no document's name");
  });

  it('finds every citation in the code naming a part its document has', () => {
    const wrong: string[] = [];
    let read = 0;
    for (const file of codeFiles()) {
      const from = fromRoot(file);
      const syntax = syntaxOf(basename(file))!;
      const text = readFileSync(file, 'utf8');
      const home = homeOf(commentLines(text, syntax), from);
      for (const [i, line] of commentLines(text, syntax, true).entries()) {
        if (line == null) continue;
        for (const cited of citationsIn(line)) {
          read++;
          const why = wrongWith(cited, from, home);
          if (why) wrong.push(`${from}:${i + 1}: ${cited.text}: ${why}`);
        }
      }
    }
    expect(read).toBeGreaterThan(900);
    expect(wrong).toEqual([]);
  });
});
