/**
 * `quilt install claude`, and the menu bar's button (page.ts, POST /api/install): the connector written into Claude
 * Desktop's config, so a chat there can start it over stdio.
 *
 * Claude Desktop keeps that file in memory while it runs and writes it back whole, on quit among other times, so an
 * entry added from outside while it runs is lost. The verb is meant to run while Claude is closed; `installClaude`
 * refuses when it can tell Claude is running, unless told to go ahead anyway.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * The entry for this very program: the executable when it is one, else the development command from the repository.
 * The client this installs into is Claude, so the connector declares `anthropic/claude` on its claims and reveals
 * unless `QUILT_MODEL` says otherwise: the app names itself to the connector by a bridge name, not by its vendor,
 * and agreement on a piece is judged across vendors.
 */
export function quiltEntry(options: { sea: boolean; execPath: string; repoRoot: string; home: string; env: NodeJS.ProcessEnv }): ServerEntry {
  const env: Record<string, string> = { QUILT_HOME: options.home, QUILT_MODEL: options.env.QUILT_MODEL ?? 'anthropic/claude' };
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

/** Whether the config file names the quilt connector already: what the menu bar reads as installed. */
export function claudeHasQuilt(file: string): boolean {
  try {
    const config = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers?: Record<string, unknown> };
    return typeof config.mcpServers?.quilt === 'object' && config.mcpServers.quilt !== null;
  } catch {
    return false;
  }
}

/** Whether Claude Desktop is running here, as far as the process list says; false where that cannot be asked. */
export function claudeRunning(): boolean {
  try {
    if (process.platform === 'win32') return execFileSync('tasklist', { encoding: 'utf8' }).toLowerCase().includes('claude.exe');
    // ps shows the app's own process (pgrep on macOS does not); its helpers live under Frameworks and Claude Code's bundle is lower-case.
    const names = execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map((l) => l.trim());
    return names.some((n) => (process.platform === 'darwin' ? n.endsWith('/Claude.app/Contents/MacOS/Claude') : /^(.*\/)?claude(-desktop)?$/.test(n)));
  } catch {
    return false;
  }
}

/** The entry for the program this runs in: the executable when it is one, else the repository's development command. */
export function entryHere(home: string, env: NodeJS.ProcessEnv = process.env): ServerEntry {
  const sea = (process.getBuiltinModule('node:sea') as { isSea(): boolean } | undefined)?.isSea() ?? false;
  // The executable has no module URL; the repository root is only for the development command.
  const repoRoot = sea ? '' : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  return quiltEntry({ sea, execPath: process.execPath, repoRoot, home, env });
}

/** The connector written for this program, into Claude Desktop's config here, unless Claude is running: what the CLI's verb and the menu bar's button both do. */
export function installHere(home: string, anyway = false, env: NodeJS.ProcessEnv = process.env): { file: string; written: boolean; reason?: string } {
  return installClaude({ file: claudeDesktopConfigPath(), entry: entryHere(home, env), claudeRunning: claudeRunning(), anyway });
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
