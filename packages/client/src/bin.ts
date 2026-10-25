#!/usr/bin/env tsx
/**
 * quilt: the thing a person opens, and the MCP server their AI connects to.
 *
 *   quilt init [--phrase "twelve words"] [--secret <hex>]   make or import the key (the phrase is shown once)
 *   quilt me                                              the address, name, model, trackers, queue
 *   quilt mcp                                             the MCP server over stdio, with the page on localhost (what a chat client starts)
 *   quilt serve [--port 3978]                             the page and the node alone
 *   quilt open <link>  |  quilt search <words>  |  quilt read <link>
 *   quilt next <problem>  |  quilt return <problem> <piece> '<json>'  |  quilt decline <problem> <piece> <reason>
 *   quilt publish <pattern.json>  |  quilt name <name>  |  quilt flush
 *
 * Started by a chat client (no TTY on stdin) with no command, it runs `mcp`. Logs go to stderr; stdout is the protocol.
 */
import { readFileSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { type Config, createKey, ensureHome, loadConfig, loadKey, quiltHome, saveConfig } from './config.js';
import { createMcpServer } from './mcp.js';
import { createPage } from './page.js';
import { Resolver } from './resolver.js';
import { type Pattern, Quilt } from './worker.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const command = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true) ?? (process.stdin.isTTY ? 'me' : 'mcp');
const home = ensureHome(quiltHome());
const config: Config = loadConfig(home);
const log = (s: string) => process.stderr.write(s + '\n');

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
    case 'me':
      console.log(JSON.stringify(make().me(), null, 2));
      return;
    case 'mcp': {
      const quilt = make();
      const page = createPage({ quilt, person: make(undefined, true), resolver: quilt.resolver });
      page.listen(config.port).then(() => log(`quilt page at http://localhost:${config.port}/`)).catch((e) => log(`page not started: ${(e as Error).message}`));
      const server = createMcpServer((hostName) => make(hostName));
      await server.connect(new StdioServerTransport());
      log(`quilt mcp connected; key ${quilt.identity?.address ?? 'none (run quilt init)'}`);
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
      const { hash, state, tracker } = await quilt.open(args[1] ?? '');
      console.log(quilt.summary(hash, state, tracker));
      if (command === 'read') console.log(`\nAccepted so far:\n${quilt.acceptedText(state)}`);
      return;
    }
    case 'search': {
      const found = await make().search(args.slice(1).join(' '));
      console.log(JSON.stringify(found, null, 2));
      return;
    }
    case 'next': {
      const quilt = make();
      const { hash, pick, posted, author } = await quilt.next(args[1] ?? '');
      console.log(quilt.pieceText(hash, pick, author));
      console.log(posted.queued ? 'Claim queued.' : `Claim posted to ${posted.at}.`);
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
