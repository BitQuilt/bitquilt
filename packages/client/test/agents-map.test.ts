/**
 * The map of the code (AGENTS.md, The shape of it, and "One return, end to end"), held both ways. Every source file
 * has a row: each file under a package's src, the client's page and card, the core's fixture writer, the scripts and
 * the example workers; and no row names a file that is not there, or one twice. A name a row gives in code marks is
 * one its file declares, and each document and section a row says its file carries out is a part that document has.
 * Each stop of the return names a file and a function that file declares, and each name a stop gives beside them is
 * declared in the code. Each folder at the root has a line around the packages, as the image and the workflows do,
 * but the packages and the scripts, which have tables of their own. Everywhere else in AGENTS.md, a path names a file
 * or a folder that exists, a name in code marks is a word of the code, and an environment name is one .env.example
 * lists. So a file or a folder added, moved or renamed, or a function renamed, fails here until the map says so. What
 * the map says of a file is held by review. Of the paths rule 11 keeps where they are, the site's client id is held to
 * the file the rule names, which names itself, and to the page on the site it comes back to.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { codeFiles, repoRoot as root, rootFolders } from './helpers.js';

/** A file by its path from the root, its line ends as LF. */
const read = (path: string): string => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n');
const exists = (path: string): boolean => existsSync(join(root, path));
const fromRoot = (path: string): string =>
  path
    .slice(root.length + 1)
    .split('\\')
    .join('/');

const AGENTS = read('AGENTS.md');
const PACKAGES = readdirSync(join(root, 'packages')).filter((p) => exists(`packages/${p}/package.json`));

/** Every file under a folder by its path from the root, past dependencies, builds, dot folders and the mirror's. */
function filesUnder(dir: string, out: string[] = []): string[] {
  if (!statSync(join(root, dir), { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(join(root, dir))) {
    if (name.startsWith('.') || name === 'node_modules' || name === 'dist' || (dir === '.' && name === 'mirror'))
      continue;
    const path = dir === '.' ? name : `${dir}/${name}`;
    if (statSync(join(root, path)).isDirectory()) filesUnder(path, out);
    else out.push(path);
  }
  return out;
}

/** The repository's files, the workflows under their dot folder among them. */
const REPO = [...filesUnder('.'), ...filesUnder('.github')];
const BASENAMES = new Set(REPO.map((f) => basename(f)));

/**
 * The files the map gives a row each: the programs and their parts, by their kinds of source. The card's generated
 * module is built from the card by scripts/build-window.mjs and is not kept, so it has no row.
 */
const SOURCE = /\.(ts|mts|mjs|js|css|html|sh)$/;
function inScope(): string[] {
  const out: string[] = [];
  for (const pkg of PACKAGES)
    for (const sub of ['src', 'page', 'window', 'fixtures'])
      out.push(...filesUnder(`packages/${pkg}/${sub}`).filter((f) => SOURCE.test(f) && !f.endsWith('.generated.ts')));
  out.push(...filesUnder('scripts').filter((f) => SOURCE.test(f)));
  out.push(...filesUnder('examples').filter((f) => /^examples\/worker-[\w-]+\.(mjs|d\.mts)$/.test(f)));
  return out.sort();
}

const SCOPE = inScope();

/** AGENTS.md with its fenced blocks blanked, since a name written there is a command and not a claim. */
const PROSE = AGENTS.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '');

/** The lines under a heading of AGENTS.md, up to the next heading of its level or above. */
function under(heading: string): string[] {
  const lines = PROSE.split('\n');
  const level = /^#+/.exec(heading)![0].length;
  const start = lines.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const end = lines.findIndex((l, i) => i > start && /^#+\s/.test(l) && /^#+/.exec(l)![0].length <= level);
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** The cells of a table's row, or null for a line that is no row of data. */
function cells(line: string): string[] | null {
  if (!line.startsWith('| ') || /^\|\s*-/.test(line)) return null;
  return line
    .slice(1, -1)
    .split(' | ')
    .map((c) => c.trim());
}

/** The names a cell gives in code marks. */
const marked = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);

/** A row of the map: the file from the root, what the row says it holds, and what it says the file carries out. */
interface Row {
  file: string;
  holds: string;
  carries: string;
}

/** The rows of the map, each under the heading that names its folder in code marks. */
function rows(): Row[] {
  const out: Row[] = [];
  let folder: string | null = null;
  for (const line of under('## The shape of it')) {
    if (line.startsWith('### ')) folder = marked(line)[0]?.replace(/\/$/, '') ?? null;
    const c = cells(line);
    if (!c || c[0] === 'File' || !folder) continue;
    expect(c, line).toHaveLength(3);
    out.push({ file: `${folder}/${marked(c[0]!)[0]}`, holds: c[1]!, carries: c[2]! });
  }
  return out;
}

const MAP = rows();

/** Names that look like a file of the repository's, by what they end in. */
const FILE = /\.(ts|mts|mjs|js|sol|py|swift|sh|md|html|css|yml)$/;
/** A name in the code: an identifier, or a member of one, as `Quilt.next`. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
/** An environment name of the executables', which .env.example lists. */
const ENV_NAME = /^(?:QUILT|BITQUILT)_[A-Z0-9_]+$/;
const ENV = new Set([...read('.env.example').matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]!));

/**
 * What a path is said to be built or installed, not kept: the builds land under dist/, and the card's module is
 * written by its build.
 */
const built = (path: string): boolean => path.startsWith('dist/') || path.endsWith('window.generated.ts');

/**
 * Whether a path names a file or a folder: from the root, or inside a package where it names one there, as
 * `test/helpers.ts` and `window/` do; a bare name is also the name of a file somewhere in the repository, and a `*`
 * stands for any part of one name.
 */
function located(token: string): boolean {
  const path = token.replace(/\/$/, '');
  if (built(path)) return true;
  if (path.includes('*')) {
    const pattern = new RegExp(`^${path.split('*').map(literal).join('[^/]*')}$`);
    return REPO.some((f) => pattern.test(f));
  }
  if (exists(path) || PACKAGES.some((p) => exists(`packages/${p}/${path}`))) return true;
  return !path.includes('/') && BASENAMES.has(path);
}

/** A text as a pattern that matches it and nothing else. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The names a source declares: its functions, classes, interfaces, types and enums, its variables, the members of its
 * classes and interfaces alone and as `Owner.member`, and the names it exports from another module.
 */
const declaredMemo = new Map<string, Set<string>>();
function declared(path: string): Set<string> {
  const hit = declaredMemo.get(path);
  if (hit) return hit;
  const names = new Set<string>();
  if (!/\.(ts|mts|mjs|js)$/.test(path)) {
    for (const m of read(path).matchAll(/[A-Za-z_$][\w$]*/g)) names.add(m[0]);
  } else {
    const kind = /\.m?js$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, kind);
    const bind = (name: ts.BindingName): void => {
      if (ts.isIdentifier(name)) names.add(name.text);
      else for (const e of name.elements) if (!ts.isOmittedExpression(e)) bind(e.name);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) bind(node.name);
      else if (ts.isExportSpecifier(node)) names.add(node.name.text);
      else if (
        (ts.isFunctionDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node)) &&
        node.name
      ) {
        const owner = node.name.text;
        names.add(owner);
        const members: readonly (ts.ClassElement | ts.TypeElement)[] =
          ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ? node.members : [];
        for (const m of members)
          if (m.name && (ts.isIdentifier(m.name) || ts.isPrivateIdentifier(m.name))) {
            names.add(m.name.text);
            names.add(`${owner}.${m.name.text}`);
          }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  declaredMemo.set(path, names);
  return names;
}

/** Every name the programs declare, across every source the map gives a row. */
const DECLARED = new Set(SCOPE.flatMap((f) => [...declared(f)]));

/**
 * Every word of the code: each package's sources, the page, the card, the fixture writer, the deploy files, the
 * contracts, the scripts, the examples, the Mac app's sources, the image and the workflows. The tests are left out, so
 * a name only a test writes, as this one's own, is no word of the code.
 */
const WORDS = new Set(
  [
    ...codeFiles()
      .map(fromRoot)
      .filter((f) => !/(^|\/)test\//.test(f)),
    ...filesUnder('apps/mac/Sources'),
    'Dockerfile',
    ...readdirSync(join(root, '.github', 'workflows')).map((f) => `.github/workflows/${f}`),
  ].flatMap((f) => read(f).match(/[A-Za-z_$][\w$]*/g) ?? []),
);

/**
 * Why a name in code marks is not there, or null where it is. A path or a file's name is located; an environment name
 * is listed; a name in the code is in `names`, or, where `names` is the code's words, each part of it is a word or the
 * whole is a file at the root. Anything else, such as a route, a command or a field with its value, is prose.
 */
function missing(token: string, names: Set<string>, words = false): string | null {
  if (token.startsWith('/') || token.startsWith('@') || /\s/.test(token)) return null;
  if (ENV_NAME.test(token)) return ENV.has(token) ? null : `${token} is no name .env.example lists`;
  if (FILE.test(token) || token.includes('/') || token.startsWith('.')) {
    if (!/^[\w./*-]+$/.test(token)) return null;
    return located(token) ? null : `${token} is no file or folder here`;
  }
  if (!IDENTIFIER.test(token)) return null;
  if (words)
    return token.split('.').every((part) => names.has(part)) || exists(token) ? null : `${token} is not in the code`;
  return names.has(token) ? null : `${token} is not declared there`;
}

/** A heading of a document: its number where it is numbered, its name, and the lines it spans. */
interface Heading {
  number: string | null;
  name: string;
  start: number;
  end: number;
}

/** A heading's name as a citation names it: code marks, a closing parenthesis and a closing colon set aside. */
const bare = (name: string): string =>
  name
    .replace(/`/g, '')
    .replace(/\s+\([^)]*\)$/, '')
    .replace(/[.:]$/, '')
    .trim();

/** The headings of a Markdown file, each spanning the lines up to the next heading of its level or above. */
function headingsOf(path: string): Heading[] {
  const lines = read(path)
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
    .split('\n');
  const found: (Heading & { level: number })[] = [];
  for (const [i, line] of lines.entries()) {
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const numbered = /^(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(m[2]!);
    const name = bare(numbered?.[2] ?? m[2]!);
    found.push({ level: m[1]!.length, number: numbered?.[1] ?? null, name, start: i, end: lines.length });
  }
  for (const [j, h] of found.entries()) {
    const next = found.slice(j + 1).find((later) => later.level <= h.level);
    if (next) h.end = next.start;
  }
  return found;
}

/** Each extension's number, with the document its row in docs/EXTENSIONS.md links, or null where it has none. */
const REGISTRY = new Map<string, string | null>();
for (const line of read('docs/EXTENSIONS.md').split('\n')) {
  const row = /^\|\s*(QX-\d+)\s*\|/.exec(line);
  if (row) REGISTRY.set(row[1]!, /\]\((ext\/[^)#\s]+\.md)\)/.exec(line)?.[1] ?? null);
}

/** The numbers a citation names, a range "1 to 5" read as every number in it. */
function numbersIn(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/, | and /)) {
    const range = /^(\d+) to (\d+)$/.exec(piece);
    if (!range) out.push(piece);
    else for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(String(n));
  }
  return out;
}

/**
 * One part of a row's documents, as the code cites them: a document's name or an extension's number, then sections by
 * number, then a part by its name after a comma.
 */
const CITED =
  /^(QX-\d+|[A-Za-z][\w-]*\.md)(?: sections? (\d+(?:\.\d+)*(?:(?:, | and | to )\d+(?:\.\d+)*)*))?(?:, (.+))?$/;

/** Why a part of a row's documents names nothing its document has, or null where it does. */
function uncited(part: string): string | null {
  const m = CITED.exec(part);
  if (!m) return `"${part}" is no citation of a document`;
  const [, name, sections, title] = m;
  let path: string | null;
  if (name!.startsWith('QX-')) {
    if (!REGISTRY.has(name!)) return `${name} is no number the registry assigns`;
    const link = REGISTRY.get(name!);
    path = link ? `docs/${link}` : null;
    if (!path) return sections || title ? `${name} has no document of its own` : null;
  } else path = [`docs/${name}`, `docs/ext/${name}`, `docs/v2/${name}`].find(exists) ?? null;
  if (!path) return `no document is at ${name}`;
  const headings = headingsOf(path);
  let scopes = [{ start: 0, end: Number.POSITIVE_INFINITY }];
  if (sections) {
    scopes = [];
    for (const n of numbersIn(sections)) {
      const h = headings.find((x) => x.number === n);
      if (!h) return `${path} has no section ${n}`;
      scopes.push(h);
    }
  }
  if (title) {
    const named = (h: Heading): boolean =>
      [h.name, h.name.replace(/:.*$/, '').trim()].some((n) => n.toLowerCase() === title.toLowerCase());
    if (!headings.some((h) => named(h) && scopes.some((s) => h.start >= s.start && h.start < s.end)))
      return `${path} has no part named "${title}"`;
  }
  return null;
}

/** A stop of the return: the file and the function where it happens, and what it says happens. */
interface Stop {
  stop: string;
  file: string;
  name: string;
  says: string;
}

function stops(): Stop[] {
  const out: Stop[] = [];
  for (const line of under('## One return, end to end')) {
    const c = cells(line);
    if (!c || c[0] === 'Stop') continue;
    expect(c, line).toHaveLength(3);
    const [file, name] = marked(c[1]!);
    out.push({ stop: c[0]!, file: file!, name: name!, says: c[2]! });
  }
  return out;
}

describe('the map of the code (AGENTS.md, The shape of it)', () => {
  it('gives every source file a row, and no row to a file that is not there or to one twice', () => {
    const named = MAP.map((r) => r.file);
    expect(named.length).toBeGreaterThan(120);
    expect(named.filter((f) => !exists(f))).toEqual([]);
    expect(named.filter((f, i) => named.indexOf(f) !== i)).toEqual([]);
    expect(SCOPE.filter((f) => !named.includes(f))).toEqual([]);
    expect(named.filter((f) => !SCOPE.includes(f))).toEqual([]);
  });

  it("names in each row only what the row's file declares", () => {
    const wrong = MAP.flatMap((r) =>
      marked(r.holds).flatMap((token) => {
        const why = missing(token, declared(r.file));
        return why ? [`${r.file}: ${why}`] : [];
      }),
    );
    expect(wrong).toEqual([]);
  });

  it('cites in each row a document, and sections and parts it has', () => {
    const cited = MAP.filter((r) => r.carries !== '');
    expect(cited.length).toBeGreaterThan(90);
    const wrong = cited.flatMap((r) =>
      r.carries.split('; ').flatMap((part) => {
        const why = uncited(part);
        return why ? [`${r.file}: ${why}`] : [];
      }),
    );
    expect(wrong).toEqual([]);
  });

  it('reads a citation as the code writes one, and finds one that names nothing', () => {
    for (const ok of ['CORE.md sections 4 and 11', 'QX-1 sections 4 and 5', 'QX-11 section 7.4', 'QX-7'])
      expect(uncited(ok), ok).toBeNull();
    for (const ok of ["APP.md, While you're away", 'PROTOCOL.md, Identity', 'PROTOCOL.md, The piece next hands over'])
      expect(uncited(ok), ok).toBeNull();
    expect(uncited('QX-19 section 9')).toContain('has no section 9');
    expect(uncited('QX-12 sections 1 to 9')).toContain('has no section 7');
    expect(uncited('APP.md, The card')).toContain('has no part named "The card"');
    expect(uncited('QX-11 section 8, The jobs')).toContain('has no part named "The jobs"');
    expect(uncited('QX-99')).toContain('no number the registry assigns');
    expect(uncited('QX-7 section 1')).toContain('no document of its own');
    expect(uncited('the door')).toContain('is no citation');
  });

  it('knows a missing file, a name its file does not declare, and a name the code does not have', () => {
    expect(missing('packages/client/src/gone.ts', new Set())).toContain('is no file or folder here');
    expect(missing('gone.ts', new Set())).toContain('is no file or folder here');
    expect(missing('test/helpers.ts', new Set())).toBeNull();
    expect(missing('examples/worker-*.mjs', new Set())).toBeNull();
    expect(missing('runTool', declared('packages/client/src/tools.ts'))).toBeNull();
    expect(missing('runTool', declared('packages/client/src/mcp.ts'))).toContain('is not declared there');
    expect(missing('Quilt.next', declared('packages/client/src/quilt.ts'))).toBeNull();
    expect(missing('Quilt.gone', declared('packages/client/src/quilt.ts'))).toContain('is not declared there');
    expect(missing('QUILT_GONE', new Set())).toContain('no name .env.example lists');
    expect(missing('notAWordOfTheCode', WORDS, true)).toContain('is not in the code');
  });
});

describe('one return, end to end (AGENTS.md)', () => {
  const walk = stops();

  it('goes from the phrase to the render, a file and the function it declares at each stop', () => {
    expect(walk.length).toBeGreaterThanOrEqual(10);
    expect(walk[0]!.file).toBe('packages/client/src/phrases.ts');
    expect(walk.at(-1)!.file).toBe('packages/client/src/render.ts');
    const wrong = walk.flatMap((s) => {
      if (!exists(s.file)) return [`${s.stop}: ${s.file} is no file here`];
      return declared(s.file).has(s.name) ? [] : [`${s.stop}: ${s.name} is not declared in ${s.file}`];
    });
    expect(wrong).toEqual([]);
  });

  it('names beside each stop only what the code declares', () => {
    const wrong = walk.flatMap((s) =>
      marked(s.says).flatMap((token) => {
        const why = missing(token, DECLARED);
        return why ? [`${s.stop}: ${why}`] : [];
      }),
    );
    expect(wrong).toEqual([]);
  });
});

/** The names "Around the packages" gives a line each, by the bold code marks that open the line. */
function aroundLines(): string[] {
  return under('### Around the packages').flatMap((line) => {
    const m = /^- \*\*`([^`]+)`\*\*/.exec(line);
    return m ? [m[1]!.replace(/\/$/, '')] : [];
  });
}

describe('what runs around the packages (AGENTS.md, Around the packages)', () => {
  it('gives each folder at the root a line, and the image and the workflows one each', () => {
    const lines = aroundLines();
    const tabled = new Set(['packages', 'scripts']);
    const folders = rootFolders().filter((f) => !tabled.has(f));
    expect(folders.length).toBeGreaterThan(5);
    expect(folders.filter((f) => !lines.some((l) => l.split('/')[0] === f))).toEqual([]);
    for (const named of ['Dockerfile', '.github/workflows', 'deploy', 'mirror']) expect(lines).toContain(named);
    expect(lines.filter((l) => !located(l))).toEqual([]);
  });
});

describe('the names AGENTS.md gives everywhere else', () => {
  it('names files and folders that exist, words of the code, and environment names .env.example lists', () => {
    const map = new Set([...under('## The shape of it'), ...under('## One return, end to end')]);
    const rest = PROSE.split('\n').filter((line) => !map.has(line) || !line.startsWith('| '));
    const wrong = rest.flatMap((line) =>
      marked(line).flatMap((token) => {
        const why = missing(token, WORDS, true);
        return why ? [why] : [];
      }),
    );
    expect(wrong).toEqual([]);
  });
});

describe('a path something outside the repository keeps (AGENTS.md, rule 11)', () => {
  it("keeps the site's client id at the file the rule names, and its way back at a page the site serves", () => {
    const meta = /<meta name="bitquilt:client" content="([^"]+)">/.exec(read('site/index.html'));
    expect(meta, 'the bitquilt:client meta of site/index.html').not.toBeNull();
    const id = new URL(meta![1]!);
    const file = `site${id.pathname}`;
    expect(file).toBe('site/.well-known/oauth/client-metadata.json');
    expect(PROSE).toContain(`\`${file}\``);
    const doc = JSON.parse(read(file)) as { client_id: string; redirect_uris: string[] };
    expect(doc.client_id).toBe(id.href);
    expect(doc.redirect_uris.length).toBeGreaterThan(0);
    for (const back of doc.redirect_uris.map((u) => new URL(u))) {
      expect(back.origin).toBe(id.origin);
      expect(PROSE).toContain(`\`site${back.pathname}\``);
      expect(exists(`site${back.pathname}`), back.href).toBe(true);
    }
  });
});
