/**
 * Where Quilt keeps its things: a folder in the person's home (or $QUILT_HOME), with the key readable by the person
 * alone, a config of trackers and mirrors, a cache of what has been touched, and a queue of events written while no
 * tracker answered. Nothing here leaves the machine except through the resolver.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type Address, type Capability, addressOf, isPhrase, newPhrase, secretFromHex, secretKeyFromPhrase, secretToHex } from '@bitquilt/core';

export interface Config {
  trackers: string[];
  mirrors: string[];
  name?: string;
  /** The model declared on claims and reveals when the host does not say, as vendor/model. */
  model?: string;
  /** What this client can do for a piece: web, files, shell. A person at the page is `person`. */
  can: Capability[];
  /** The port of the page on localhost. */
  port: number;
}

export const DEFAULT_CONFIG: Config = {
  trackers: ['http://localhost:3977/'],
  mirrors: [],
  can: ['web', 'files', 'shell'],
  port: 3978,
};

export function quiltHome(): string {
  return process.env.QUILT_HOME ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'quilt');
}

export function ensureHome(home = quiltHome()): string {
  for (const d of [home, join(home, 'cache'), join(home, 'cache', 'blobs'), join(home, 'cache', 'ledger')]) mkdirSync(d, { recursive: true });
  return home;
}

export function loadConfig(home = quiltHome()): Config {
  const file = join(home, 'config.json');
  const fromFile = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>) : {};
  const env = process.env.QUILT_TRACKERS?.split(',').map((s) => s.trim()).filter(Boolean);
  const config: Config = { ...DEFAULT_CONFIG, ...fromFile };
  if (env?.length) config.trackers = env;
  if (process.env.QUILT_PORT_PAGE) config.port = Number(process.env.QUILT_PORT_PAGE);
  if (process.env.QUILT_MODEL) config.model = process.env.QUILT_MODEL;
  return config;
}

export function saveConfig(config: Config, home = quiltHome()): void {
  ensureHome(home);
  writeFileSync(join(home, 'config.json'), JSON.stringify(config, null, 2) + '\n');
}

export interface Identity {
  secret: Uint8Array;
  address: Address;
}

/** The key on disk, or null when none has been made. */
export function loadKey(home = quiltHome()): Identity | null {
  const file = join(home, 'key');
  if (!existsSync(file)) return null;
  const secret = secretFromHex(readFileSync(file, 'utf8'));
  return { secret, address: addressOf(secret) };
}

/**
 * Makes the key: from a phrase the person gives (a wallet's, or one they wrote down), or from a new phrase, which is
 * returned once so they can write it down, or from a secret key exported from a hosted root. Refuses to overwrite.
 */
export function createKey(home = quiltHome(), from: { phrase?: string; secretHex?: string } = {}): { identity: Identity; phrase: string | null } {
  ensureHome(home);
  const file = join(home, 'key');
  if (existsSync(file)) throw new Error(`a key is already at ${file}`);
  let secret: Uint8Array;
  let phrase: string | null = null;
  if (from.secretHex) secret = secretFromHex(from.secretHex);
  else if (from.phrase) {
    if (!isPhrase(from.phrase)) throw new Error('not a valid phrase');
    secret = secretKeyFromPhrase(from.phrase);
  } else {
    phrase = newPhrase();
    secret = secretKeyFromPhrase(phrase);
  }
  writeFileSync(file, secretToHex(secret) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return { identity: { secret, address: addressOf(secret) }, phrase };
}
