/**
 * `quilt install claude`: the connector written into Claude Desktop's config, so a chat there can start it over stdio.
 *
 * Claude Desktop keeps that file in memory while it runs and writes it back whole, on quit among other times, so an
 * entry added from outside while it runs is lost. The verb is meant to run while Claude is closed; `installClaude`
 * refuses when it can tell Claude is running, unless told to go ahead anyway.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface ServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Where Claude Desktop reads `claude_desktop_config.json` on each platform. */
export function claudeDesktopConfigPath(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const file = 'claude_desktop_config.json';
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Claude', file);
  if (platform === 'win32') return join(env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', file);
  return join(env.XDG_CONFIG_HOME ?? join(home, '.config'), 'Claude', file);
}

/** The entry for this very program: the executable when it is one, else the development command from the repository. */
export function quiltEntry(options: { sea: boolean; execPath: string; repoRoot: string; home: string; env: NodeJS.ProcessEnv }): ServerEntry {
  const env: Record<string, string> = { QUILT_HOME: options.home };
  for (const k of ['QUILT_TRACKERS', 'QUILT_PORT_PAGE'] as const) if (options.env[k]) env[k] = options.env[k]!;
  return options.sea
    ? { command: options.execPath, args: ['mcp'], env }
    : { command: 'pnpm', args: ['--filter', 'quilt', '--dir', options.repoRoot, 'start', 'mcp'], env };
}

/** The config with `mcpServers.quilt` set to the entry; everything else in it kept as it was. */
export function withQuilt(config: Record<string, unknown>, entry: ServerEntry): Record<string, unknown> {
  const servers = { ...((config.mcpServers as Record<string, unknown> | undefined) ?? {}), quilt: entry };
  return { ...config, mcpServers: servers };
}

export function installClaude(options: { file: string; entry: ServerEntry; claudeRunning: boolean; anyway: boolean }): { file: string; written: boolean; reason?: string } {
  if (options.claudeRunning && !options.anyway) return { file: options.file, written: false, reason: 'Claude is running and writes this file from memory when it quits; quit Claude first, then run this again (or add --anyway).' };
  let config: Record<string, unknown> = {};
  if (existsSync(options.file)) {
    try {
      config = JSON.parse(readFileSync(options.file, 'utf8')) as Record<string, unknown>;
    } catch (e) {
      return { file: options.file, written: false, reason: `the file there is not JSON: ${(e as Error).message}` };
    }
  }
  mkdirSync(dirname(options.file), { recursive: true });
  writeFileSync(options.file, JSON.stringify(withQuilt(config, options.entry), null, 2) + '\n');
  return { file: options.file, written: true };
}
