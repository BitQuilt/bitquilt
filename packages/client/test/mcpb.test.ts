import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unpackExtension, validateManifest } from '@anthropic-ai/mcpb';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';

/** The fields of the manifest the bundle is held to; the mcpb tool's schema checks the rest. */
interface Manifest {
  manifest_version: string;
  name: string;
  version: string;
  description: string;
  long_description?: string;
  license?: string;
  server: { type: string; entry_point: string; mcp_config: { command: string; args: string[]; env: Record<string, string> } };
  tools: { name: string }[];
  user_config: Record<string, { type: string; title: string; description: string; default?: string; required?: boolean }>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = mkdtempSync(join(tmpdir(), 'quilt-mcpb-'));
const unpacked = join(out, 'unpacked');
const instructs = /\b(you must|always|never|do not|important|ignore)\b/i;
let manifest: Manifest;

beforeAll(async () => {
  execFileSync(process.execPath, [join(root, 'scripts', 'build-mcpb.mjs'), '--out', out], { stdio: 'pipe' });
  expect(await unpackExtension({ mcpbPath: join(out, 'quilt.mcpb'), outputDir: unpacked, silent: true })).toBe(true);
  manifest = JSON.parse(readFileSync(join(unpacked, 'manifest.json'), 'utf8')) as Manifest;
}, 60_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('the MCP Bundle for Claude Desktop', () => {
  it('holds the server, the page beside it, the licence, a package.json that says CommonJS, and a manifest the mcpb tool accepts', () => {
    for (const f of ['manifest.json', 'server/index.js', 'page/index.html', 'package.json', 'LICENSE']) expect(existsSync(join(unpacked, f))).toBe(true);
    expect((JSON.parse(readFileSync(join(unpacked, 'package.json'), 'utf8')) as { type: string }).type).toBe('commonjs');
    expect(validateManifest(join(unpacked, 'manifest.json'))).toBe(true);
  });

  it('says how the app starts it: node on the entry file with mcp, declaring anthropic/claude, trackers from a setting, the key left where quilt keeps it', () => {
    expect(manifest.name).toBe('quilt');
    expect(manifest.version).toBe((JSON.parse(readFileSync(join(root, 'packages', 'client', 'package.json'), 'utf8')) as { version: string }).version);
    expect(manifest.license).toBe('Apache-2.0');
    expect(manifest.server.type).toBe('node');
    expect(manifest.server.entry_point).toBe('server/index.js');
    expect(manifest.server.mcp_config).toEqual({ command: 'node', args: ['${__dirname}/server/index.js', 'mcp'], env: { QUILT_MODEL: 'anthropic/claude', QUILT_TRACKERS: '${user_config.trackers}' } });
    expect(manifest.user_config.trackers).toMatchObject({ type: 'string', default: DEFAULT_CONFIG.trackers.join(',') });
    expect(Object.keys(manifest.server.mcp_config.env)).not.toContain('QUILT_HOME');
    for (const text of [manifest.description, manifest.long_description ?? '', ...Object.values(manifest.user_config).flatMap((c) => [c.title, c.description])]) expect(text).not.toMatch(instructs);
  });

  it('starts over stdio from the unpacked files, under a folder that declares ES modules, finds its page, and lists the seventeen tools the manifest names', async () => {
    const home = join(out, 'home');
    // Where the app unpacks it is not the bundle's to choose; a package.json above it saying ES modules changes nothing.
    writeFileSync(join(out, 'package.json'), JSON.stringify({ type: 'module' }));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(unpacked, manifest.server.entry_point), 'mcp'],
      env: { ...getDefaultEnvironment(), QUILT_HOME: home, QUILT_PORT_PAGE: '0', QUILT_MODEL: 'anthropic/claude', QUILT_TRACKERS: 'http://tracker.test/' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'claude-desktop-test', version: '0.0.0' });
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual(['quilt_challenge', 'quilt_decline', 'quilt_me', 'quilt_name', 'quilt_next', 'quilt_open', 'quilt_pay', 'quilt_publish', 'quilt_rank', 'quilt_read', 'quilt_redeem', 'quilt_return', 'quilt_reveal_gold', 'quilt_search', 'quilt_seed', 'quilt_transfer', 'quilt_verdict']);
    expect(names).toEqual(manifest.tools.map((t) => t.name).sort());
    for (const t of tools.tools) expect(t.description ?? '').not.toMatch(instructs);
    const me = await client.callTool({ name: 'quilt_me', arguments: {} });
    const text = (me.structuredContent as { text: string }).text;
    expect(text).toContain('Declares: anthropic/claude');
    expect(text).toContain('Trackers: http://tracker.test/');
    expect(text).toContain('none yet (quilt init makes one)');
    expect(existsSync(join(home, 'cache'))).toBe(true);
    await client.close();
  }, 30_000);
});
