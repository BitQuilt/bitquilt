/**
 * What the client's tests set up again and again: a tracker on a free port, a temporary home with a key, a Quilt over
 * a tracker, the connector over an in-memory MCP pair, a call made under the second opinion's switch, and a JSON
 * fetch; and, for the tests that read the repository's own code, its files and their comments line by line. Each
 * test keeps its own pattern and its own assertions; only the scaffolding is here.
 */
import { mkdtempSync, readdirSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Store, createTracker } from '@bitquilt/tracker';
import { type Config, DEFAULT_CONFIG, createKey, loadKey } from '../src/config.js';
import { createMcpServer } from '../src/mcp.js';
import { Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { localRunner } from '../src/tools.js';

/** The secret key whose last byte is `n`, as hex: the tests' keys, one per actor, the same from run to run. */
export const hex = (n: number): string => '00'.repeat(31) + n.toString(16).padStart(2, '0');

/** A fresh temporary folder for one home. */
export function tempHome(prefix = 'quilt-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** The address a listening server answers at, with its trailing slash. */
export function baseOf(server: Server): string {
  const addr = server.address();
  return typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/` : '';
}

/**
 * A reference tracker on a free port, with an in-memory store and the name http://tracker.test/ unless `options` says
 * another; the rest of `options` are the tracker's.
 */
export async function startTracker(
  options: Omit<Parameters<typeof createTracker>[0], 'store' | 'url' | 'ipSalt'> & { url?: string } = {},
): Promise<{ server: Server; base: string }> {
  const tracker = createTracker({ store: new Store(':memory:'), url: 'http://tracker.test/', ipSalt: 's', ...options });
  const server = await tracker.listen(0);
  return { server, base: baseOf(server) };
}

/**
 * A maker of Quilts over one tracker: each with its own temporary home, the key from `hex(n)`, and the config given
 * over the defaults with that tracker; `model` is what it declares and `host` the client it says it is.
 */
export function quiltOver(
  tracker: string,
  extra: Partial<Config> = {},
): (n: number, model?: string, host?: string) => Quilt {
  const config: Config = { ...DEFAULT_CONFIG, trackers: [tracker], ...extra };
  return (n, model, host = 'Claude Code') => {
    const home = tempHome(`quilt-${n}-`);
    createKey(home, { secretHex: hex(n) });
    return new Quilt(model ? { ...config, model } : config, loadKey(home), new Resolver(config, home), host);
  };
}

/** The connector over this Quilt, connected to a client by an in-memory pair; `close` ends both. */
export async function mcpPair(
  quilt: Quilt,
  clientName = 'claude-test',
  connected?: (host: string | null) => void,
): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(
    localRunner(() => quilt),
    connected ? { connected } : {},
  );
  await server.connect(serverTransport);
  const client = new Client({ name: clientName, version: '0.0.0' });
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/**
 * The call made with the house second opinion's switch set (QUILT_NEXT_ONLY=verify), and the switch unset again
 * whatever happens.
 */
export async function verifying<T>(f: () => Promise<T>): Promise<T> {
  process.env.QUILT_NEXT_ONLY = 'verify';
  try {
    return await f();
  } finally {
    delete process.env.QUILT_NEXT_ONLY;
  }
}

/** A fetch whose answer is read as JSON of the type the caller says. */
export async function json<T>(url: string, init?: RequestInit): Promise<T> {
  return (await (await fetch(url, init)).json()) as T;
}

/**
 * The connector's tools as a host lists them, in the order mcp.ts registers them. It is written here on its own, so a
 * change to that order, to TOOL_NAMES or to the bundle's manifest fails a test and is not a quiet reorder.
 */
export const LISTED_TOOLS = [
  'quilt_me',
  'quilt_open',
  'quilt_search',
  'quilt_window',
  'quilt_window_io',
  'quilt_next',
  'quilt_return',
  'quilt_decline',
  'quilt_read',
  'quilt_rank',
  'quilt_challenge',
  'quilt_verdict',
  'quilt_seed',
  'quilt_publish',
  'quilt_pay',
  'quilt_transfer',
  'quilt_redeem',
  'quilt_reveal_gold',
  'quilt_name',
] as const;

/** The regex the tests hold tool descriptions and manifests to: text that describes and does not instruct. */
export const instructs = /\b(you must|always|never|do not|important|ignore)\b/i;

/** The repository's root, three folders above this one. */
export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * How a source writes a comment: `slash` with `//` and blocks, as TypeScript, JavaScript, CSS and Solidity do; `hash`
 * with `#`, as a shell script, the compose file, the Caddyfile and an env example do; `html` with `<!--` blocks beside
 * the slashes of its own script and style.
 */
export type CommentSyntax = 'slash' | 'hash' | 'html';

/** A source's comment syntax by its file name, or null for a file the comment checks do not read. */
export function syntaxOf(name: string): CommentSyntax | null {
  if (/\.(ts|mts|mjs|js|css|sol)$/.test(name)) return 'slash';
  if (/\.(sh|ya?ml|toml|conf)$/.test(name) || name === 'Caddyfile' || name === 'env.example') return 'hash';
  if (name.endsWith('.html')) return 'html';
  return null;
}

/** Every source under a folder whose syntax `syntaxOf` knows, past dependencies, builds and generated files. */
export function sourcesUnder(dir: string, out: string[] = []): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.endsWith('.generated.ts')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourcesUnder(path, out);
    else if (syntaxOf(name)) out.push(path);
  }
  return out;
}

/**
 * The code whose comments cite the documents: each package's sources and tests, the client's page and card, the
 * core's fixture writer, the deploy files, the contracts and their tests, the scripts and the examples.
 */
export function codeFiles(): string[] {
  const dirs = ['deploy', 'contracts/src', 'contracts/test', 'scripts', 'examples'];
  for (const pkg of readdirSync(join(repoRoot, 'packages')))
    for (const sub of ['src', 'test', 'page', 'window', 'fixtures']) dirs.push(join('packages', pkg, sub));
  return dirs.flatMap((dir) => sourcesUnder(join(repoRoot, dir)));
}

/** Where `//` or `#` opens a comment after code on a line, outside a quoted string, or -1 where nothing does. */
function trailingAt(line: string, marker: '//' | '#'): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (line.startsWith(marker, i) && /\s/.test(line[i - 1] ?? '') && /\s/.test(line[i + marker.length] ?? ' '))
      return i;
  }
  return -1;
}

/**
 * Each line's comment text with its marker set aside, or null where the line holds none. In a `hash` source `#` opens
 * a comment; elsewhere `#` opens a private name and not a comment. A line that opens with `//` or a star is a comment,
 * and so is every line of a block opened at the start of a line, up to the line that closes it, with or without a
 * leading star, as in window.css, and an HTML comment the same. With `trailing`, a comment after code on its line is
 * read too, as the door's map in admit.ts writes where each type's rule is.
 */
export function commentLines(text: string, syntax: CommentSyntax, trailing = false): (string | null)[] {
  let inBlock = false;
  return text.split('\n').map((line) => {
    const trimmed = line.trim();
    if (syntax === 'hash') {
      if (trimmed.startsWith('#')) return trimmed.replace(/^#+\s*/, '');
      const at = trailing ? trailingAt(line, '#') : -1;
      return at < 0 ? null : line.slice(at + 1).trim();
    }
    const opens = trimmed.startsWith('/*') || (syntax === 'html' && trimmed.startsWith('<!--'));
    if (!inBlock && !opens && !/^(\/\/|\*)/.test(trimmed)) {
      const at = trailing ? trailingAt(line, '//') : -1;
      return at < 0 ? null : line.slice(at + 2).trim();
    }
    const closes = (s: string) => s.includes('*/') || (syntax === 'html' && s.includes('-->'));
    if (opens && !closes(trimmed.slice(trimmed.startsWith('<!--') ? 4 : 2))) inBlock = true;
    else if (inBlock && closes(trimmed)) inBlock = false;
    return trimmed
      .replace(/^(\/\/+|\/\*+|<!--|\*(?!\/))\s*/, '')
      .replace(/\s*(\*\/|-->)$/, '')
      .trimEnd();
  });
}
