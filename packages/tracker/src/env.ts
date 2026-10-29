/**
 * What a tracker binary reads from the environment, and nothing else: the port, host and database path the process
 * needs, and the options `createTracker` takes. Both binaries, the tracker's and the hosted on-ramp's, read it here.
 *   QUILT_PORT (3977)  QUILT_HOST (127.0.0.1)  QUILT_DB (./quilt-tracker.db)  QUILT_URL (http://localhost:<port>/)
 *   QUILT_NAME  QUILT_PEERS (comma-separated)  QUILT_LIMIT_KEY_HOUR (120)  QUILT_LIMIT_IP_HOUR (600)
 *   QUILT_STAMP_NAME (0)  QUILT_IP_SALT  QUILT_MAINTAINERS (addresses whose hide events this tracker honours, comma separated)
 *   QUILT_FOUNDING_STANDING (a founding standing declared per root, <address>=<amount> comma separated, QX-1 section 2 as amended)
 *   QUILT_COIN (the coin's parameters as JSON, QX-17; absent, no coin log and no coin lock honoured)
 * This file loads no store, so a binary can read it before Node's SQLite module is loaded and its warning silenced.
 */
import type { Address } from '@bitquilt/core';
import { type CoinParams, coinParamsProblems } from './coin.js';
import type { TrackerOptions } from './tracker.js';

/** What the environment says a tracker is: where it listens, where its store is, and the options its store is added to. */
export interface TrackerEnv {
  port: number;
  host: string;
  dbPath: string;
  options: Omit<TrackerOptions, 'store'>;
}

const list = (s: string | undefined): string[] => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** `<address>=<amount>` pairs, comma separated: the founding standing declared per root; a pair that is not an address and a whole number of at least 1 throws naming it. */
export function foundingFromEnv(s: string | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pair of list(s)) {
    const [address, amount] = pair.split('=').map((x) => x.trim());
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address) || !amount || !/^[1-9]\d*$/.test(amount)) throw new Error(`QUILT_FOUNDING_STANDING: ${pair} is not <address>=<amount>`);
    out[address] = Number(amount);
  }
  return out;
}

/** Reads the variables above; the coin's parameters are checked for shape, and a malformed QUILT_COIN throws naming the field. */
export function trackerOptionsFromEnv(env: NodeJS.ProcessEnv): TrackerEnv {
  let coin: CoinParams | undefined;
  if (env.QUILT_COIN) {
    const parsed = JSON.parse(env.QUILT_COIN) as unknown;
    const problems = coinParamsProblems(parsed);
    if (problems.length) throw new Error(`QUILT_COIN: ${problems[0]}`);
    coin = parsed as CoinParams;
  }
  const port = Number(env.QUILT_PORT ?? 3977);
  return {
    port,
    host: env.QUILT_HOST ?? '127.0.0.1',
    dbPath: env.QUILT_DB ?? './quilt-tracker.db',
    options: {
      url: env.QUILT_URL ?? `http://localhost:${port}/`,
      ...(env.QUILT_NAME ? { name: env.QUILT_NAME } : {}),
      peers: list(env.QUILT_PEERS),
      limits: { keyPerHour: Number(env.QUILT_LIMIT_KEY_HOUR ?? 120), ipPerHour: Number(env.QUILT_LIMIT_IP_HOUR ?? 600) },
      stamp: { name: Number(env.QUILT_STAMP_NAME ?? 0) },
      ...(env.QUILT_IP_SALT ? { ipSalt: env.QUILT_IP_SALT } : {}),
      maintainers: list(env.QUILT_MAINTAINERS) as Address[],
      ...(env.QUILT_FOUNDING_STANDING ? { founding: foundingFromEnv(env.QUILT_FOUNDING_STANDING) } : {}),
      ...(coin ? { coin } : {}),
    },
  };
}

/** Keeps Node's notice that its SQLite module is experimental out of the log, which the store's import would print at every start. */
export function quietSqliteWarning(): void {
  const emitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
    if (String(warning).includes('SQLite is an experimental feature')) return;
    (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
  }) as typeof process.emitWarning;
}
