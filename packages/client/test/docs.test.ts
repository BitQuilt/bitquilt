import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The documents' links (AGENTS.md, "The words"; docs/README.md): every relative link in the repository's Markdown, the
 * documents under docs/ and the READMEs beside the code, resolves to a file or a folder that exists, and a link that
 * names a heading (`#...`) names one the file has, by the anchor GitHub gives it. A document moved, renamed or retitled
 * strands no link. A link to another site is not followed, and text inside code is not a link. The registry in
 * docs/EXTENSIONS.md links each document under docs/ext/ from its number's row.
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
