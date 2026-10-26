#!/usr/bin/env tsx
/**
 * quilt: the thing a person opens, and the MCP server their AI connects to.
 *
 *   quilt init [--phrase "twelve words"] [--secret <hex>]   make or import the key (the phrase is shown once)
 *   quilt me                                              the address, name, model, trackers, queue, and the standing a tracker computes (what is locked, what is free)
 *   quilt mcp                                             the MCP server over stdio, with the page on localhost (what a chat client starts);
 *                                                         through the node already holding this home's page when there is one
 *   quilt serve [--port 3978]                             the page and the node alone
 *   quilt open <link>  |  quilt search <words>  |  quilt read <link>
 *   quilt next [problem]  |  quilt return <problem> <piece> '<json>'  |  quilt decline <problem> <piece> <reason>
 *   quilt seed <problem> on|off                          keep a problem: a seed event on its log, and the problem in the standing list
 *   quilt publish <pattern.json>  |  quilt name <name>  |  quilt flush
 *   quilt stake <problem> <min> [<family> ...]           the owner's stake rule (QX-15): what a claim on the pieces locks; 0 asks nothing
 *   quilt challenge <problem> <piece> <stake> <ground>  |  quilt verdict <problem> <piece> <challenge> <challenger|author> ['<json>']
 *   quilt rank <problem> <piece> <digest> [<digest>...]   a judge's ranking of a piece's candidates, first choice first
 *   quilt hide <id or hash> <why> [--lift]                a maintainer's takedown on this client's trackers, or its lift
 *   quilt install claude [--anyway]                     the connector written into Claude Desktop's config (run it while Claude is closed)
 *
 * Started by a chat client (no TTY on stdin) with no command, it runs `mcp`. Logs go to stderr; stdout is the protocol.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Config, createKey, ensureHome, loadConfig, loadKey, quiltHome, saveConfig } from './config.js';
import { claudeDesktopConfigPath, installClaude, quiltEntry } from './install.js';
import { createMcpServer } from './mcp.js';
import { probeNode, remoteRunner } from './node.js';
import { createPage } from './page.js';
import { Resolver } from './resolver.js';
import { type ToolRunner, localRunner } from './tools.js';
import { type Pattern, type Side, Quilt } from './worker.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const command = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true) ?? (process.stdin.isTTY ? 'me' : 'mcp');
const home = ensureHome(quiltHome());
const config: Config = loadConfig(home);
const log = (s: string) => process.stderr.write(s + '\n');

/** Whether Claude Desktop is running here, as far as the process list says; false where that cannot be asked. */
function claudeRunning(): boolean {
  try {
    if (process.platform === 'win32') return execFileSync('tasklist', { encoding: 'utf8' }).toLowerCase().includes('claude.exe');
    // ps shows the app's own process (pgrep on macOS does not); its helpers live under Frameworks and Claude Code's bundle is lower-case.
    const names = execFileSync('ps', ['-axo', 'comm='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').map((l) => l.trim());
    return names.some((n) => (process.platform === 'darwin' ? n.endsWith('/Claude.app/Contents/MacOS/Claude') : /^(.*\/)?claude(-desktop)?$/.test(n)));
  } catch {
    return false;
  }
}

function make(hostName?: string, person = false): Quilt {
  const identity = loadKey(home);
  const resolver = new Resolver(config, home);
  if (person) return new Quilt({ ...config, model: 'human', can: ['person', 'web', 'files'] }, identity, resolver, 'human');
  return new Quilt(config, identity, resolver, hostName);
}

async function main(): Promise<void> {
  switch (command) {
    case 'init': {
      const phrase = flag('--phrase');
      const secret = flag('--secret');
      const { identity, phrase: shown } = createKey(home, { ...(phrase ? { phrase } : {}), ...(secret ? { secretHex: secret } : {}) });
      saveConfig(config, home);
      console.log(`Address: ${identity.address}`);
      if (shown) console.log(`Phrase (shown once; it is the key, write it down and keep it to yourself):\n  ${shown}`);
      console.log(`Kept at ${home}`);
      return;
    }
    case 'me': {
      const quilt = make();
      console.log(JSON.stringify({ ...quilt.me(), standing: await quilt.standing() }, null, 2));
      return;
    }
    case 'stake': {
      console.log(JSON.stringify(await make().stakeRule(args[1] as `sha256:${string}`, Number(args[2]), args.slice(3))));
      return;
    }
    case 'mcp': {
      // One resolver, so every Quilt this process makes (one per host that connects, and the person's) shares one library.
      const identity = loadKey(home);
      const resolver = new Resolver(config, home);
      const quiltFor = (hostName?: string) => new Quilt(config, identity, resolver, hostName);
      const alone = (): ToolRunner => {
        const quilt = quiltFor();
        const person = new Quilt({ ...config, model: 'human', can: ['person', 'web', 'files'] }, identity, resolver, 'human');
        createPage({ quilt, person, resolver }).listen(config.port).then(() => log(`quilt page at http://localhost:${config.port}/`)).catch((e) => log(`page not started: ${(e as Error).message}`));
        return localRunner(quiltFor);
      };
      const node = await probeNode(config.port, identity?.address ?? null);
      let run: ToolRunner;
      if (node.found === 'mine') {
        log(`quilt works through the node at http://127.0.0.1:${config.port}/, which holds this home's page`);
        run = remoteRunner(`http://127.0.0.1:${config.port}/`, alone, fetch, log);
      } else {
        if (node.found === 'other') log(`port ${config.port} is held by another quilt (key ${node.address ?? 'none'}) or another program; this copy works alone, without the page`);
        run = alone();
      }
      const server = createMcpServer(run);
      await server.connect(new StdioServerTransport());
      log(`quilt mcp connected; key ${identity?.address ?? 'none (run quilt init)'}`);
      return;
    }
    case 'serve': {
      const quilt = make();
      const port = Number(flag('--port') ?? config.port);
      await createPage({ quilt, person: make(undefined, true), resolver: quilt.resolver }).listen(port);
      console.log(`quilt page at http://localhost:${port}/`);
      return;
    }
    case 'open':
    case 'read': {
      const quilt = make();
      const { hash, state, tracker, layer, hidden } = await quilt.open(args[1] ?? '');
      console.log(quilt.summary(hash, state, tracker, layer, hidden));
      if (command === 'read') {
        console.log(`\nAccepted so far:\n${quilt.acceptedText(state, layer)}`);
        console.log(`\nChallenges:\n${quilt.challengesText(await quilt.challenges(hash, tracker), state)}`);
        console.log(`\nPanels:\n${quilt.panelsText(await quilt.panels(hash, tracker), state)}`);
      }
      return;
    }
    case 'search': {
      const found = await make().search(args.slice(1).join(' '));
      console.log(JSON.stringify(found, null, 2));
      return;
    }
    case 'next': {
      const quilt = make();
      const { hash, pick, posted, author, stake } = await quilt.next(args[1] ?? '');
      console.log(quilt.pieceText(hash, pick, author, stake));
      console.log(posted.queued ? 'Claim queued.' : `Claim posted to ${posted.at}${stake > 0 ? `, after a lock of ${stake}` : ''}.`);
      return;
    }
    case 'seed': {
      console.log(JSON.stringify(await make().seed(args[1] as `sha256:${string}`, (args[2] ?? 'on') !== 'off')));
      return;
    }
    case 'return': {
      const r = await make().return(args[1] as `sha256:${string}`, args[2] as `sha256:${string}`, JSON.parse(args[3] ?? '{}') as Record<string, unknown>);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'decline': {
      const r = await make().decline(args[1] as `sha256:${string}`, args[2] as `sha256:${string}`, (args[3] ?? 'cannot') as 'cannot');
      console.log(JSON.stringify(r));
      return;
    }
    case 'challenge': {
      const r = await make().challenge(args[1] as `sha256:${string}`, args[2] as `sha256:${string}`, Number(args[3]), args.slice(4).join(' '));
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'verdict': {
      const ret = args[5] ? (JSON.parse(args[5]) as Record<string, unknown>) : undefined;
      const r = await make().verdict(args[1] as `sha256:${string}`, args[2] as `sha256:${string}`, args[3] as `sha256:${string}`, args[4] as Side, ret);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'rank': {
      const r = await make().rank(args[1] as `sha256:${string}`, args[2] as `sha256:${string}`, args.slice(3) as `sha256:${string}`[]);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'publish': {
      const pattern = JSON.parse(readFileSync(args[1] ?? '', 'utf8')) as Pattern;
      const r = await make().publish(pattern);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case 'name': {
      console.log(JSON.stringify(await make().setName(args.slice(1).join(' '))));
      return;
    }
    case 'hide': {
      const lift = args.includes('--lift');
      console.log(JSON.stringify(await make().hide(args[1] ?? '', args.slice(2).filter((a) => a !== '--lift').join(' '), !lift)));
      return;
    }
    case 'install': {
      if ((args[1] ?? 'claude') !== 'claude') {
        log('install: claude is the one target so far');
        process.exit(2);
      }
      const sea = (process.getBuiltinModule('node:sea') as { isSea(): boolean } | undefined)?.isSea() ?? false;
      // The executable has no module URL; the repository root is only for the development command.
      const repoRoot = sea ? '' : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
      const entry = quiltEntry({ sea, execPath: process.execPath, repoRoot, home, env: process.env });
      const r = installClaude({ file: claudeDesktopConfigPath(), entry, claudeRunning: claudeRunning(), anyway: args.includes('--anyway') });
      if (!r.written) {
        log(`not written: ${r.reason}`);
        process.exit(1);
      }
      console.log(`Written to ${r.file}:\n${JSON.stringify(entry, null, 2)}\nOpen Claude; the quilt tools are there in a new chat.`);
      return;
    }
    case 'flush': {
      console.log(JSON.stringify(await new Resolver(config, home).flush()));
      return;
    }
    default:
      log(`unknown command ${command}`);
      process.exit(2);
  }
}

main().catch((err) => {
  log((err as Error).message);
  process.exit(1);
});
