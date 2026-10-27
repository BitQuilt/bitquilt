import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { claudeDesktopConfigPath, installClaude, quiltEntry, withQuilt } from '../src/install.js';
import { tempHome } from './helpers.js';

/**
 * `quilt install claude`: where Claude Desktop keeps its config on each platform, the entry this program writes there
 * (the executable or the development command, the vendor Claude is, only the quilt variables that are set), what the
 * write keeps of the file, and the refusal while Claude runs.
 */

describe('quilt install claude', () => {
  it('knows where Claude Desktop keeps its config on each platform', () => {
    expect(claudeDesktopConfigPath('darwin', {}, '/Users/x')).toBe('/Users/x/Library/Application Support/Claude/claude_desktop_config.json');
    expect(claudeDesktopConfigPath('win32', { APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'C:\\Users\\x')).toContain('Claude');
    expect(claudeDesktopConfigPath('linux', {}, '/home/x')).toBe('/home/x/.config/Claude/claude_desktop_config.json');
  });
  it('names this executable, the home in use, the vendor Claude is, and only the quilt variables that are set', () => {
    const e = quiltEntry({ sea: true, execPath: '/opt/quilt', repoRoot: '/r', home: '/h', env: { QUILT_TRACKERS: 'http://t/', PATH: '/bin' } });
    expect(e).toEqual({ command: '/opt/quilt', args: ['mcp'], env: { QUILT_HOME: '/h', QUILT_MODEL: 'anthropic/claude', QUILT_TRACKERS: 'http://t/' } });
    expect(quiltEntry({ sea: true, execPath: '/opt/quilt', repoRoot: '/r', home: '/h', env: { QUILT_MODEL: 'anthropic/claude-opus-5-5' } }).env.QUILT_MODEL).toBe('anthropic/claude-opus-5-5');
    expect(quiltEntry({ sea: false, execPath: '/usr/bin/node', repoRoot: '/r', home: '/h', env: {} }).args).toEqual(['--filter', 'quilt', '--dir', '/r', 'start', 'mcp']);
  });
  it('keeps everything else in the file and the other servers', () => {
    const out = withQuilt({ preferences: { a: 1 }, mcpServers: { other: { command: 'x' } } }, { command: '/q', args: ['mcp'], env: {} });
    expect(out.preferences).toEqual({ a: 1 });
    expect(Object.keys(out.mcpServers as object)).toEqual(['other', 'quilt']);
  });
  it('refuses while Claude runs, and writes the merged file when it does not', () => {
    const dir = tempHome('quilt-install-');
    const file = join(dir, 'Claude', 'claude_desktop_config.json');
    const entry = { command: '/q', args: ['mcp'], env: { QUILT_HOME: '/h', QUILT_MODEL: 'anthropic/claude' } };
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
