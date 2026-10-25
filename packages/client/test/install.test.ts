import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeDesktopConfigPath, installClaude, quiltEntry, withQuilt } from '../src/install.js';

describe('quilt install claude', () => {
  it('knows where Claude Desktop keeps its config on each platform', () => {
    expect(claudeDesktopConfigPath('darwin', {}, '/Users/x')).toBe('/Users/x/Library/Application Support/Claude/claude_desktop_config.json');
    expect(claudeDesktopConfigPath('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'C:\\Users\\x')).toContain('Claude');
    expect(claudeDesktopConfigPath('linux', {}, '/home/x')).toBe('/home/x/.config/Claude/claude_desktop_config.json');
  });
  it('names this executable, the home in use, and only the quilt variables that are set', () => {
    const e = quiltEntry({ sea: true, execPath: '/opt/quilt', repoRoot: '/r', home: '/h', env: { QUILT_TRACKERS: 'http://t/', PATH: '/bin' } });
    expect(e).toEqual({ command: '/opt/quilt', args: ['mcp'], env: { QUILT_HOME: '/h', QUILT_TRACKERS: 'http://t/' } });
    expect(quiltEntry({ sea: false, execPath: '/usr/bin/node', repoRoot: '/r', home: '/h', env: {} }).args).toEqual(['--filter', 'quilt', '--dir', '/r', 'start', 'mcp']);
  });
  it('keeps everything else in the file and the other servers', () => {
    const out = withQuilt({ preferences: { a: 1 }, mcpServers: { other: { command: 'x' } } }, { command: '/q', args: ['mcp'], env: {} });
    expect(out.preferences).toEqual({ a: 1 });
    expect(Object.keys(out.mcpServers as object)).toEqual(['other', 'quilt']);
  });
  it('refuses while Claude runs, and writes the merged file when it does not', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quilt-install-'));
    const file = join(dir, 'Claude', 'claude_desktop_config.json');
    const entry = { command: '/q', args: ['mcp'], env: { QUILT_HOME: '/h' } };
    expect(installClaude({ file, entry, claudeRunning: true, anyway: false }).written).toBe(false);
    expect(installClaude({ file, entry, claudeRunning: false, anyway: false })).toEqual({ file, written: true });
    writeFileSync(file, JSON.stringify({ preferences: { kept: true }, mcpServers: { quilt: { command: 'old', args: [], env: {} } } }));
    expect(installClaude({ file, entry, claudeRunning: true, anyway: true }).written).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.preferences).toEqual({ kept: true });
    expect(saved.mcpServers.quilt).toEqual(entry);
    writeFileSync(file, '{not json');
    expect(installClaude({ file, entry, claudeRunning: false, anyway: false }).reason).toMatch(/not JSON/);
  });
});
