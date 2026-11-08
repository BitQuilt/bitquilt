/**
 * The schedule of the away run (away.ts; APP.md, "While you're away"): on a Mac a launchd user agent that runs this
 * program's `away` every hour, not at load, and elsewhere a crontab line that runs it at the top of every hour, each
 * with the home in its environment and its output under the home. The label, the plist's text and the command it runs
 * are what an installed schedule carries, and away.test.ts pins the plist whole, so a schedule already installed keeps
 * running.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, posix, resolve } from 'node:path';
import { isExecutable } from './agents.js';
import type { ServerEntry } from './install.js';

export const LAUNCHD_LABEL = 'org.bitquilt.quilt.away';

/**
 * The launchd label for a home: the plain label for the usual home, and the label with eight hex characters of the
 * home's hash for any other, so two homes on one Mac, a person's and a maintainer's, each keep their own hourly turn.
 * Until 2 November 2026 the label was one, and installing for a second home replaced the first's.
 */
export function launchdLabel(
  home: string,
  usual = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'quilt'),
): string {
  return resolve(home) === resolve(usual)
    ? LAUNCHD_LABEL
    : `${LAUNCHD_LABEL}.${createHash('sha256').update(resolve(home)).digest('hex').slice(0, 8)}`;
}

/**
 * The command the schedule runs: this program with `away`, from the connector's entry (the executable, or the
 * development command). A bare name such as `pnpm` is resolved to its path in the directories given, since launchd
 * looks a program up with a PATH of its own, not the one the plist sets, and fails the job with EX_CONFIG when it is
 * not there; a name found nowhere is left as given.
 */
export function awayCommand(
  entry: ServerEntry,
  dirs: string[] = [],
  exists: (path: string) => boolean = isExecutable,
): { command: string; args: string[] } {
  let command = entry.command;
  if (!command.includes('/') && !command.includes('\\')) {
    for (const dir of dirs) {
      const path = join(dir, command);
      if (exists(path)) {
        command = path;
        break;
      }
    }
  }
  return { command, args: [...entry.args.slice(0, -1), 'away'] };
}

/**
 * The environment the schedule runs under: the connector entry's quilt variables but the model, which the run declares
 * itself, the home, and a PATH with the places an agent CLI is looked for.
 */
export function scheduleEnv(entry: ServerEntry, dirs: string[], home: string): Record<string, string> {
  const env = { ...entry.env };
  delete env.QUILT_MODEL;
  return { ...env, QUILT_HOME: home, PATH: dirs.join(delimiter) };
}

/**
 * The launchd user agent: this program's `away` every hour, not at load, with the home in its environment and its
 * output under the home.
 */
export function plistText(o: {
  label: string;
  command: string;
  args: string[];
  home: string;
  env: Record<string, string>;
}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const strings = (xs: string[]) => xs.map((x) => `    <string>${esc(x)}</string>`).join('\n');
  const env = Object.entries(o.env)
    .map(([k, v]) => `    <key>${esc(k)}</key>\n    <string>${esc(v)}</string>`)
    .join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key>\n  <string>${esc(o.label)}</string>`,
    `  <key>ProgramArguments</key>\n  <array>\n${strings([o.command, ...o.args])}\n  </array>`,
    '  <key>StartInterval</key>\n  <integer>3600</integer>',
    '  <key>RunAtLoad</key>\n  <false/>',
    `  <key>EnvironmentVariables</key>\n  <dict>\n${env}\n  </dict>`,
    `  <key>StandardOutPath</key>\n  <string>${esc(join(o.home, 'away.out'))}</string>`,
    `  <key>StandardErrorPath</key>\n  <string>${esc(join(o.home, 'away.err'))}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** Where the launchd user agent for a label is written. */
export function launchAgentFile(label = LAUNCHD_LABEL, userHome = homedir()): string {
  // A launchd path is a Mac's, so it is joined the Mac's way wherever this runs.
  return posix.join(userHome, 'Library', 'LaunchAgents', `${label}.plist`);
}

/** The crontab line for a machine without launchd: the same command at the top of every hour. */
export function crontabLine(command: string, args: string[], home: string): string {
  const q = (s: string) => (/^[\w./:=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return `0 * * * * QUILT_HOME=${q(home)} ${[command, ...args].map(q).join(' ')} >> ${q(join(home, 'away.out'))} 2>> ${q(join(home, 'away.err'))}`;
}

/** Runs launchctl with the arguments; true when it exited 0. */
export type Launchctl = (args: string[]) => boolean;

function launchctl(args: string[]): boolean {
  try {
    execFileSync('launchctl', args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const uidHere = () => process.getuid?.() ?? 0;

export interface ScheduleOptions {
  platform?: NodeJS.Platform;
  /** The plist's path; ~/Library/LaunchAgents/<label>.plist when left out. */
  file?: string;
  /** The launchd label; the home's (`launchdLabel`) when left out. */
  label?: string;
  uid?: number;
  ctl?: Launchctl;
}

export interface Schedule {
  kind: 'launchd' | 'crontab';
  installed: boolean;
  /** Whether launchd has it loaded now; false where there is no launchd. */
  loaded: boolean;
  file: string | null;
  /** The line to add by hand where there is no launchd. */
  crontab: string | null;
}

/**
 * Whether the schedule is in place: on a Mac, the plist and whether launchd has it; elsewhere, the crontab line to add.
 */
export function scheduleOf(o: ScheduleOptions & { command: string; args: string[]; home: string }): Schedule {
  const platform = o.platform ?? process.platform;
  if (platform !== 'darwin')
    return {
      kind: 'crontab',
      installed: false,
      loaded: false,
      file: null,
      crontab: crontabLine(o.command, o.args, o.home),
    };
  const label = o.label ?? launchdLabel(o.home);
  const file = o.file ?? launchAgentFile(label);
  const installed = existsSync(file);
  const loaded = installed && (o.ctl ?? launchctl)(['print', `gui/${o.uid ?? uidHere()}/${label}`]);
  return { kind: 'launchd', installed, loaded, file, crontab: null };
}

/** The plist written and loaded; one already loaded is unloaded first so launchd reads the new text. */
export function installSchedule(o: { file: string; text: string; label?: string; uid?: number; ctl?: Launchctl }): {
  file: string;
  loaded: boolean;
} {
  const ctl = o.ctl ?? launchctl;
  const uid = o.uid ?? uidHere();
  mkdirSync(dirname(o.file), { recursive: true });
  writeFileSync(o.file, o.text);
  ctl(['bootout', `gui/${uid}/${o.label ?? LAUNCHD_LABEL}`]);
  return { file: o.file, loaded: ctl(['bootstrap', `gui/${uid}`, o.file]) };
}

/** The agent unloaded and its plist removed. */
export function uninstallSchedule(o: { file: string; label?: string; uid?: number; ctl?: Launchctl }): {
  file: string;
  removed: boolean;
} {
  (o.ctl ?? launchctl)(['bootout', `gui/${o.uid ?? uidHere()}/${o.label ?? LAUNCHD_LABEL}`]);
  const removed = existsSync(o.file);
  if (removed) unlinkSync(o.file);
  return { file: o.file, removed };
}
