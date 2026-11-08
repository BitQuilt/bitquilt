/**
 * The agent CLIs on this machine, Claude Code and Codex, as a run uses them (APP.md, "While you're away"): where one is
 * looked for and which is found, how one is started headless under a timeout, what it said last, and how it is asked
 * for one answer with no tools, as the owner's turn asks for the sentence a brief lacks (QX-19 section 4). The away run
 * (away.ts) builds its own invocations with the connector over these; `quilt sharpen` asks through `agentSentence`.
 */
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync, readdirSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

export type AgentName = 'claude' | 'codex';

/** The agent CLIs looked for, in order; gemini would be a third once its headless flags are known. */
export const AGENTS: readonly AgentName[] = ['claude', 'codex'];

/** How long one run may take before it is stopped. */
export const RUN_TIMEOUT_MS = 10 * 60_000;
export const NEEDS_AGENT = 'Needs Claude Code or Codex on this machine.';
/** What the run declares when Claude Code is the agent; a Codex run declares openai/<the model its config names>. */
export const CLAUDE_MODEL = 'anthropic/claude';

export interface Agent {
  name: AgentName;
  path: string;
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Whether a file is there and this user may run it. */
export function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where an agent CLI is looked for: the PATH, then the places the installers put one, since launchd and an app started
 * from the Finder carry a short PATH with none of them. The nvm versions come newest first.
 */
export function searchDirs(
  env: NodeJS.ProcessEnv,
  home = homedir(),
  list: (dir: string) => string[] = listDir,
): string[] {
  const fromPath = (env.PATH ?? '').split(delimiter).filter(Boolean);
  const usual = [
    join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    join(home, '.npm-global', 'bin'),
    join(home, '.claude', 'local'),
  ];
  const nvm = join(home, '.nvm', 'versions', 'node');
  const nodes = list(nvm)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((v) => join(nvm, v, 'bin'));
  return [...new Set([...fromPath, ...usual, ...nodes])];
}

/** The first agent CLI found: claude in any of the directories, then codex. */
export function findAgent(dirs: string[], exists: (path: string) => boolean = isExecutable): Agent | null {
  for (const name of AGENTS)
    for (const dir of dirs) {
      const path = join(dir, name);
      if (exists(path)) return { name, path };
    }
  return null;
}

/** An agent CLI's headless invocation, and the model the connector declares under it. */
export interface Invocation {
  command: string;
  args: string[];
  model: string;
}

/** The model Codex's config names (~/.codex/config.toml, `model = "..."`), or `codex` where it names none. */
export function codexModel(toml: string | null): string {
  const m = toml ? /^\s*model\s*=\s*"([^"\n]+)"/m.exec(toml) : null;
  return m?.[1] ?? 'codex';
}

/** What `claude -p --output-format json` printed, as the final text, or null where it printed something else. */
export function saidByClaude(stdout: string): string | null {
  for (const line of [stdout.trim(), ...stdout.trim().split('\n').reverse()]) {
    try {
      const j = JSON.parse(line) as { result?: unknown };
      if (typeof j.result === 'string') return j.result;
    } catch {
      /* not this line */
    }
  }
  return null;
}

/** The agent run with the timeout: SIGTERM at the deadline, SIGKILL ten seconds later. */
export function runAgent(
  inv: Invocation,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ code: number | null; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(inv.command, inv.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 10_000).unref();
    }, options.timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, stdout, stderr });
    });
  });
}

/** A file's text, or null where no file is named or it cannot be read. */
export function readIfThere(file: string | null): string | null {
  try {
    return file ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
}

/**
 * The agent CLI as a function from a prompt to its one answer, with no tools: how the owner's node asks for the
 * sentence a brief lacks (QX-19 section 4).
 */
export function askInvocation(agent: Agent, prompt: string, lastMessage: string): Invocation {
  return agent.name === 'claude'
    ? {
        command: agent.path,
        model: CLAUDE_MODEL,
        args: [
          '-p',
          prompt,
          '--output-format',
          'json',
          '--max-turns',
          '1',
          '--strict-mcp-config',
          '--mcp-config',
          JSON.stringify({ mcpServers: {} }),
        ],
      }
    : {
        command: agent.path,
        model: 'codex',
        args: [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '-c',
          'approval_policy="never"',
          '--output-last-message',
          lastMessage,
          prompt,
        ],
      };
}

/** The agent's one answer to a prompt, trimmed, or null where it failed or said nothing. */
export async function agentSentence(
  agent: Agent,
  prompt: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<string | null> {
  const lastMessage = join(options.cwd, 'away.sentence');
  const run = await runAgent(askInvocation(agent, prompt, lastMessage), options);
  const said = agent.name === 'claude' ? saidByClaude(run.stdout) : readIfThere(lastMessage);
  if (existsSync(lastMessage)) unlinkSync(lastMessage);
  return run.code === 0 && said ? said.trim() : null;
}
