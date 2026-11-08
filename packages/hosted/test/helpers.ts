/**
 * What the hosted tests share (AGENTS.md rule 7): a door with the on-ramp mounted beside it by `hostedDoor`, as both
 * binaries mount it, listening on a port of the system's choosing; and a Quilt with its own home and key over a door,
 * as a person elsewhere on the network runs one.
 */
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, type Tracker } from '@bitquilt/tracker';
import { DEFAULT_CONFIG, Quilt, Resolver, createKey, loadKey } from 'quilt';
import type { Hosted } from '../src/hosted.js';
import { type HostedDoorOptions, hostedDoor } from '../src/mount.js';

/** A door that listens, with the on-ramp beside it: its address with the slash, and its parts. */
export interface OpenDoor {
  base: string;
  server: Server;
  store: Store;
  tracker: Tracker;
  hosted: Hosted;
}

/**
 * The door: a store in memory unless one is given, the tracker at http://t.test/ with the salt `s`, and the on-ramp at
 * the address the door listens on, with the key secret `test-secret` and a members' folder of its own; each side's
 * options given here are laid over these.
 */
export async function openDoor(
  options: {
    store?: Store;
    tracker?: Partial<HostedDoorOptions['tracker']>;
    hosted?: Partial<HostedDoorOptions['hosted']>;
  } = {},
): Promise<OpenDoor> {
  let base = '';
  const store = options.store ?? new Store(':memory:');
  const { tracker, hosted } = hostedDoor({
    store,
    tracker: { url: 'http://t.test/', ipSalt: 's', ...options.tracker },
    hosted: {
      trackerUrl: () => base,
      keySecret: 'test-secret',
      home: mkdtempSync(join(tmpdir(), 'hosted-')),
      ...options.hosted,
    },
  });
  const server = await tracker.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  return { base, server, store, tracker, hosted };
}

/**
 * A Quilt of its own home whose key is the byte `n`, over the door at `base`, declaring `model` where one is given,
 * and connected as `host`.
 */
export function quiltOver(base: string, n: number, model?: string, host = 'Claude Code'): Quilt {
  const home = mkdtempSync(join(tmpdir(), `quilt-${n}-`));
  createKey(home, { secretHex: n.toString(16).padStart(64, '0') });
  const config = { ...DEFAULT_CONFIG, trackers: [base], ...(model ? { model } : {}) };
  return new Quilt(config, loadKey(home), new Resolver(config, home), host);
}
