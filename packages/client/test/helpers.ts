/**
 * What the client's tests set up again and again: a tracker on a free port, a temporary home with a key, a Quilt over
 * a tracker, the connector over an in-memory MCP pair, and a JSON fetch. Each test keeps its own pattern and its own
 * assertions; only the scaffolding is here.
 */
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

/** A reference tracker on a free port, with an in-memory store and the name http://tracker.test/ unless `options` says another; the rest of `options` are the tracker's. */
export async function startTracker(options: Omit<Parameters<typeof createTracker>[0], 'store' | 'url' | 'ipSalt'> & { url?: string } = {}): Promise<{ server: Server; base: string }> {
  const tracker = createTracker({ store: new Store(':memory:'), url: 'http://tracker.test/', ipSalt: 's', ...options });
  const server = await tracker.listen(0);
  return { server, base: baseOf(server) };
}

/**
 * A maker of Quilts over one tracker: each with its own temporary home, the key from `hex(n)`, and the config given
 * over the defaults with that tracker; `model` is what it declares and `host` the client it says it is.
 */
export function quiltOver(tracker: string, extra: Partial<Config> = {}): (n: number, model?: string, host?: string) => Quilt {
  const config: Config = { ...DEFAULT_CONFIG, trackers: [tracker], ...extra };
  return (n, model, host = 'Claude Code') => {
    const home = tempHome(`quilt-${n}-`);
    createKey(home, { secretHex: hex(n) });
    return new Quilt(model ? { ...config, model } : config, loadKey(home), new Resolver(config, home), host);
  };
}

/** The connector over this Quilt, connected to a client by an in-memory pair; `close` ends both. */
export async function mcpPair(quilt: Quilt, clientName = 'claude-test'): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer(localRunner(() => quilt));
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

/** A fetch whose answer is read as JSON of the type the caller says. */
export async function json<T>(url: string, init?: RequestInit): Promise<T> {
  return (await (await fetch(url, init)).json()) as T;
}

/** The regex the tests hold tool descriptions and manifests to: text that describes and does not instruct. */
export const instructs = /\b(you must|always|never|do not|important|ignore)\b/i;
