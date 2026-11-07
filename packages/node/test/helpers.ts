/** What the node's tests share: a free port, a temporary home with a key, a reading Quilt over a door, and a small pattern. */
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG, type Config, type Pattern, Quilt, Resolver, createKey, loadKey } from 'quilt';

export const hex = (n: number): string => n.toString(16).padStart(64, '0');

export function tempHome(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A port nothing listens on, from the system. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** A Quilt with its own home and key over a door, as a reader elsewhere on the network. */
export function readerOver(door: string, n: number, model = 'anthropic/claude'): Quilt {
  const home = tempHome(`quilt-node-reader-${n}-`);
  createKey(home, { secretHex: hex(n) });
  const config: Config = { ...DEFAULT_CONFIG, trackers: [door], model };
  return new Quilt(config, loadKey(home), new Resolver(config, home), 'Claude Code');
}

export const pattern: Pattern = {
  title: 'Does the paper say what people say it says?',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'paper-says',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: {claim.text} Return whether the paper says this, with a quote.',
      data: { claim: 'claims' },
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'quote'],
        properties: {
          verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] },
          quote: { type: 'string', maxLength: 160 },
        },
      },
      agree: ['verdict'],
    },
  },
  data: { claims: [{ text: 'The coin is a chain of signatures.' }, { text: 'Difficulty never changes.' }] },
};

export async function text(url: string): Promise<string> {
  return (await fetch(url)).text();
}

export async function json<T>(url: string): Promise<T> {
  return (await fetch(url)).json() as Promise<T>;
}

export async function lines<T = { event: { sig: string; type: string }; received: { by: string }[] }>(
  url: string,
): Promise<T[]> {
  return (await text(url))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as T);
}
