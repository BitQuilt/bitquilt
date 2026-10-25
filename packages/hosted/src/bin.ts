#!/usr/bin/env tsx
/**
 * bitquilt-hosted: the reference tracker with the hosted on-ramp mounted beside it.
 * The tracker's variables (QUILT_PORT, QUILT_HOST, QUILT_DB, QUILT_URL, ...) and two more:
 *   QUILT_KEY_SECRET   required: what the keys this tracker holds are encrypted with
 *   QUILT_HOSTED_HOME  a folder for members' caches and queues (./quilt-hosted)
 */
import { randomBytes } from 'node:crypto';

const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

async function main(): Promise<void> {
  const keySecret = process.env.QUILT_KEY_SECRET;
  if (!keySecret) {
    console.error('QUILT_KEY_SECRET is required: the keys this tracker holds are encrypted with it');
    process.exit(2);
  }
  const { Store, createTracker } = await import('@bitquilt/tracker');
  const { createHosted } = await import('./hosted.js');
  const port = Number(process.env.QUILT_PORT ?? 3977);
  const host = process.env.QUILT_HOST ?? '127.0.0.1';
  const url = process.env.QUILT_URL ?? `http://localhost:${port}/`;
  const dbPath = process.env.QUILT_DB ?? './quilt-tracker.db';
  const store = new Store(dbPath);
  const custodySecret = randomBytes(32).toString('hex');
  const hosted = createHosted({ store, trackerUrl: url, keySecret, home: process.env.QUILT_HOSTED_HOME ?? './quilt-hosted', custodySecret });
  const tracker = createTracker({
    store,
    url,
    custodySecret,
    extra: hosted.routes,
    ...(process.env.QUILT_NAME ? { name: process.env.QUILT_NAME } : {}),
    peers: (process.env.QUILT_PEERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    limits: { keyPerHour: Number(process.env.QUILT_LIMIT_KEY_HOUR ?? 120), ipPerHour: Number(process.env.QUILT_LIMIT_IP_HOUR ?? 600) },
    stamp: { name: Number(process.env.QUILT_STAMP_NAME ?? 0) },
    ...(process.env.QUILT_IP_SALT ? { ipSalt: process.env.QUILT_IP_SALT } : {}),
    maintainers: (process.env.QUILT_MAINTAINERS ?? '').split(',').map((s) => s.trim()).filter(Boolean) as `0x${string}`[],
  });
  await tracker.listen(port, host);
  console.log(`bitquilt tracker with the hosted on-ramp at ${url} (db ${dbPath}; addresses at ${url}join)`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
