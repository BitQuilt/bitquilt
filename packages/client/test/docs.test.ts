import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The documents' links (AGENTS.md, "The words"; docs/README.md): every relative link in the repository's Markdown, the
 * documents under docs/ and the READMEs beside the code, resolves to a file or a folder that exists, and a link that
 * names a heading (`#...`) names one the file has, by the anchor GitHub gives it. A document moved, renamed or retitled
 * strands no link. A link to another site is not followed, and text inside code is not a link. The registry in
 * docs/EXTENSIONS.md links each document under docs/ext/ from its number's row. A path the same Markdown writes in code
 * marks, outside the dated records under docs/history/, which are kept as written, names a file or a folder that
 * exists, its letters' case as written: a path that opens with a folder at the root, or a file at the root. A name
 * alone is a file at the root where it is one of the root's files or one the documents write bare, which the test
 * lists, so a file moved from the root fails where a document still writes it; any other dot and a word, as `.mcpb`,
 * is a file's extension, and any other name alone may be a file below the root, which only its path names. A line
 * after a colon or a heading after `#` is not part of the path, and a pattern with `<...>`, `{...}` or `*` is not a
 * path. A path written on purpose that the repository does not keep is excepted by name, with the reason beside it.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Where the repository keeps Markdown: the two files at its root, and the folders walked for more. */
const ROOT_FILES = ['README.md', 'AGENTS.md'];
const FOLDERS = ['docs', 'examples', 'deploy', 'apps', 'impl', 'packages', 'site'];

/** A file by its path from the root, with forward slashes on every system, its line ends as LF. */
const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const exists = (path: string): boolean => existsSync(join(root, path));

/** Every Markdown file under a folder, by its path from the root; dependencies, builds and hidden folders left out. */
function markdownUnder(folder: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, folder), { withFileTypes: true })) {
    const path = `${folder}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      out.push(...markdownUnder(path));
    } else if (entry.name.endsWith('.md')) out.push(path);
  }
  return out;
}

const files = [...ROOT_FILES, ...FOLDERS.flatMap(markdownUnder)].sort();

/** A file's text with its fenced blocks taken out: a heading or a link written there is an example. */
function unfenced(text: string): string {
  return text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '');
}

/**
 * A file's prose: its text unfenced, and its inline code taken out as well, since a link written there is an example.
 * A heading keeps its inline code, which is part of its anchor, so headings are read from the unfenced text.
 */
function prose(text: string): string {
  return unfenced(text).replace(/`[^`\n]*`/g, '');
}

/** The anchor GitHub gives a heading: its text as shown, lower case, punctuation dropped, each space a hyphen. */
function anchorOf(heading: string): string {
  return heading
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Every anchor a Markdown file's headings give, a repeated one numbered as GitHub numbers it. */
function anchorsIn(file: string): Set<string> {
  const seen = new Map<string, number>();
  const out = new Set<string>();
  for (const line of unfenced(read(file)).split('\n')) {
    const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const base = anchorOf(m[1]!);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n === 0 ? base : `${base}-${n}`);
  }
  return out;
}

interface Link {
  from: string;
  target: string;
  /** Where the link points, from the root, with forward slashes. */
  path: string;
  anchor: string | null;
}

/** Every relative link in a file: where it points from the root, and the heading it names, if any. */
function linksIn(file: string): Link[] {
  const out: Link[] = [];
  for (const m of prose(read(file)).matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
    const target = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) continue;
    const hash = target.indexOf('#');
    const ref = hash < 0 ? target : target.slice(0, hash);
    const anchor = hash < 0 ? null : decodeURIComponent(target.slice(hash + 1));
    const path = ref === '' ? file : posix.join(posix.dirname(file), decodeURIComponent(ref));
    out.push({ from: file, target, path, anchor });
  }
  return out;
}

const links = files.flatMap(linksIn);
const where = (l: Link): string => `${l.from}: ${l.target}`;

/**
 * The folders at the root a path in code marks opens with, written out and not read from the disk, so a folder renamed
 * or removed is still read and its old paths fail where a document writes them. A test holds every folder the
 * repository keeps at the root to this list, so a new one is read too.
 */
const TOP = [
  '.github',
  'apps',
  'contracts',
  'deploy',
  'docs',
  'examples',
  'impl',
  'mirror',
  'packages',
  'scripts',
  'site',
];

/** The folders at the root the repository keeps: every one but a dot folder and those .gitignore names. */
function rootFolders(): string[] {
  const ignored = new Set([...read('.gitignore').matchAll(/^([\w.-]+)\/$/gm)].map((m) => m[1]!));
  return readdirSync(root)
    .filter((name) => !name.startsWith('.') && !ignored.has(name))
    .filter((name) => statSync(join(root, name)).isDirectory())
    .sort();
}

/** The files at the root, by name. */
const ROOT_NAMES = new Set(
  readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name),
);

/**
 * The paths written on purpose that the repository does not keep, each with the reason. The documents name them as
 * they are on the machine or in the repository that keeps them.
 */
const NOT_KEPT: Record<string, string> = {
  'deploy/.env': 'the host writes it from deploy/env.example, and .gitignore keeps it out',
  'docs/SWARM.md': "a file of the maintainers' Workshop repository, which docs/README.md names in words",
  'docs/DESIGN.md': "a file of the maintainers' Workshop repository, which docs/README.md names in words",
};

/**
 * The files at the root the documents write by name alone. A name here is read as a path whether or not the root has
 * it, so a file moved from the root fails where a document still writes it bare, until the document or this list
 * changes. A test below holds the list to the root files the documents write bare, no more and no less.
 */
const BARE = ['.env.example', 'Dockerfile', 'README.md', 'vitest.config.ts'];

/**
 * Whether a name with no slash is a file at the root: one the documents write bare, or one of the root's files, its dot
 * files among them. Any other dot and a word, as `.p8`, `.mcpb` or `.d.ts`, is a file's extension, and any other name
 * alone may be a file below the root, which only its path names.
 */
const atRoot = (name: string, names: ReadonlySet<string> = ROOT_NAMES): boolean =>
  BARE.includes(name) || names.has(name);

/** The names a code mark writes alone, with no slash: a line after a colon and a heading after `#` set aside. */
const bareIn = (mark: string): string[] =>
  mark
    .split(/\s+/)
    .filter((word) => word !== '' && !word.includes('/'))
    .map((word) => word.replace(/[:#].*$/, '').replace(/[.,;]+$/, ''));

/** A path opens with a folder at the root, with no letter, slash, dot or `@` before it, as a site's address has. */
const OPENS = new RegExp(`(?<![\\w./@-])(?:${TOP.map((t) => t.replace('.', '\\.')).join('|')})/[^\\s\`'"(),;]*`, 'g');

/**
 * The repository paths one code mark writes, from the root, the root's files given by name: a line after a colon and a
 * heading after `#` set aside, and a trailing slash with them. A pattern is no path.
 */
function pathsOf(mark: string, names: ReadonlySet<string> = ROOT_NAMES): string[] {
  const words = [...mark.matchAll(OPENS)].map((m) => m[0]);
  for (const name of bareIn(mark)) if (atRoot(name, names)) words.push(name);
  return words
    .filter((word) => !/[<>{}*]/.test(word))
    .map((word) =>
      word
        .replace(/#.*$/, '')
        .replace(/:\d+(?:-\d+)?$/, '')
        .replace(/[.:]+$/, '')
        .replace(/\/$/, ''),
    );
}

/** A path in code marks: the file that writes it, and the path from the root. */
interface Named {
  from: string;
  path: string;
}

/** A file's code marks outside its fenced blocks, which hold commands and examples. */
const marksIn = (file: string): string[] => [...unfenced(read(file)).matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!);

/** Every repository path a file writes in code marks. */
const pathsIn = (file: string): Named[] =>
  marksIn(file).flatMap((mark) => pathsOf(mark).map((path) => ({ from: file, path })));

/** Whether a path names a file or a folder here, each part's case as written, as a checkout on Linux reads it. */
function present(path: string): boolean {
  let dir = root;
  for (const part of path.split('/')) {
    if (!existsSync(dir) || !statSync(dir).isDirectory() || !readdirSync(dir).includes(part)) return false;
    dir = join(dir, part);
  }
  return true;
}

const kept = files.filter((f) => !f.startsWith('docs/history/'));
const named = kept.flatMap(pathsIn);

describe("the documents' links", () => {
  it('reads every document and README, the ones the documents name among them', () => {
    const named = ['README.md', 'AGENTS.md', 'docs/README.md', 'docs/NODE.md', 'docs/ext/QX-11.md'];
    for (const f of [...named, 'docs/history/README.md', 'examples/README.md']) expect(files).toContain(f);
    expect(links.length).toBeGreaterThan(200);
  });

  it('resolves every relative link to a file or a folder that exists', () => {
    expect(links.filter((l) => !exists(l.path)).map(where)).toEqual([]);
  });

  it('names, in a link with a heading, a heading the Markdown file has', () => {
    const isMarkdown = (l: Link): boolean =>
      l.path.endsWith('.md') && exists(l.path) && statSync(join(root, l.path)).isFile();
    const named = links.filter((l) => l.anchor !== null && isMarkdown(l));
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((l) => !anchorsIn(l.path).has(l.anchor!)).map(where)).toEqual([]);
  });

  it('gives a heading the anchor GitHub gives it', () => {
    expect(anchorOf('6. The mirror job')).toBe('6-the-mirror-job');
    expect(anchorOf("7. The coin log's head on Ethereum")).toBe('7-the-coin-logs-head-on-ethereum');
    expect(anchorOf('`QUILT_COIN` and [QX-17](ext/QX-17.md)')).toBe('quilt_coin-and-qx-17');
    expect(anchorOf('Bringing it up, in order')).toBe('bringing-it-up-in-order');
  });

  it('reads a heading with its inline code, as GitHub does', () => {
    const anchors = anchorsIn('docs/ext/verifiers.md');
    for (const a of ['human-qx-3', 'judgen-qx-2', 'attest-qx-10']) expect(anchors).toContain(a);
    expect(anchors).not.toContain('qx-3');
  });

  it('links every document under docs/ext from the registry, each numbered one from its own row', () => {
    const registry = read('docs/EXTENSIONS.md');
    const rows = registry.split('\n').filter((l) => /^\| QX-\d+ \|/.test(l));
    for (const name of readdirSync(join(root, 'docs', 'ext')).filter((n) => n.endsWith('.md'))) {
      expect(registry, name).toContain(`(ext/${name})`);
      const number = /^(QX-\d+)\.md$/.exec(name)?.[1];
      if (!number) continue;
      const row = rows.find((r) => r.startsWith(`| ${number} |`));
      expect(row, name).toContain(`(ext/${name})`);
    }
  });
});

describe("the documents' paths in code marks", () => {
  it('reads every path in code marks outside the dated records, those of the code and the deploy among them', () => {
    expect(named.length).toBeGreaterThan(300);
    const paths = (from: string): string[] => named.filter((n) => n.from === from).map((n) => n.path);
    expect(paths('AGENTS.md')).toContain('packages/tracker/src/admit.ts');
    expect(paths('deploy/README.md')).toContain('deploy/house.sh');
    expect(paths('docs/NODE.md')).toContain('.env.example');
    expect(named.some((n) => n.from.startsWith('docs/history/'))).toBe(false);
  });

  it('names a file or a folder that exists, but where a path is written on purpose and not kept', () => {
    const dead = named.filter((n) => !(n.path in NOT_KEPT) && !present(n.path)).map((n) => `${n.from}: ${n.path}`);
    expect(dead).toEqual([]);
  });

  it('excepts only paths a document writes, each one git does not keep', () => {
    for (const path of Object.keys(NOT_KEPT))
      expect(
        named.map((n) => n.path),
        path,
      ).toContain(path);
    expect(read('.gitignore').split('\n'), 'deploy/.env').toContain('.env');
    for (const path of ['docs/SWARM.md', 'docs/DESIGN.md']) expect(present(path), path).toBe(false);
  });

  it('reads a path as the documents write one, and a pattern, an address or an extension as none', () => {
    expect(pathsOf('packages/client/src/tools.ts:12')).toEqual(['packages/client/src/tools.ts']);
    expect(pathsOf('docs/NODE.md#6-the-mirror-job')).toEqual(['docs/NODE.md']);
    expect(pathsOf('npx tsx scripts/check-pattern.ts examples/first-pattern.json')).toEqual([
      'scripts/check-pattern.ts',
      'examples/first-pattern.json',
    ]);
    expect(pathsOf('deploy/')).toEqual(['deploy']);
    expect(pathsOf('.env.example')).toEqual(['.env.example']);
    expect(pathsOf('vitest.config.ts')).toEqual(['vitest.config.ts']);
    for (const none of ['examples/<pattern>.json', 'packages/*/src', 'https://bitquilt.org/docs/x', '@bitquilt/core'])
      expect(pathsOf(none), none).toEqual([]);
    for (const none of ['.p8', '.md', '.mcpb', '.json', '.d.ts', '...the', 'tools.ts', 'src/window.generated.ts'])
      expect(pathsOf(none), none).toEqual([]);
  });

  it('reads a name alone as a file at the root where the root has it or the documents write it bare', () => {
    expect(pathsOf('.gitignore')).toEqual(['.gitignore']);
    expect(pathsOf('tsconfig.base.json')).toEqual(['tsconfig.base.json']);
    expect(pathsOf('tsconfig.base.json', new Set())).toEqual([]);
    expect(pathsOf('the Dockerfile', new Set())).toEqual(['Dockerfile']);
  });

  it('lists the root files the documents write bare, no more and no less, so a file moved from the root fails', () => {
    const bare = new Set(
      kept
        .flatMap(marksIn)
        .flatMap(bareIn)
        .filter((name) => atRoot(name)),
    );
    expect([...bare].sort()).toEqual([...BARE].sort());
    for (const name of BARE) expect(present(name), name).toBe(true);
  });

  it('opens a path with every folder the repository keeps at the root, and still reads one that is gone', () => {
    expect(rootFolders().filter((f) => !TOP.includes(f))).toEqual([]);
    expect(TOP).toContain('.github');
    expect(pathsOf('contracts/src/Gone.sol')).toEqual(['contracts/src/Gone.sol']);
    expect(present('contracts/src/Gone.sol')).toBe(false);
  });

  it('finds a path that names nothing, and one whose case differs', () => {
    expect(present('packages/client/src/tools.ts')).toBe(true);
    expect(present('packages/client/src/gone.ts')).toBe(false);
    expect(present('docs/node.md')).toBe(false);
    expect(present('Docs/NODE.md')).toBe(false);
  });
});
