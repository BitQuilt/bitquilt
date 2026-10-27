#!/usr/bin/env tsx
/**
 * bitquilt-hosted: the reference tracker with the hosted on-ramp mounted beside it. It reads the tracker's variables
 * (packages/tracker/src/env.ts lists them) and two more:
 *   QUILT_KEY_SECRET   required: what the keys this tracker holds are encrypted with
 *   QUILT_HOSTED_HOME  a folder for members' caches and queues (./quilt-hosted)
 */
import { randomBytes } from 'node:crypto';
import { quietSqliteWarning, trackerOptionsFromEnv } from '@bitquilt/tracker/env';

quietSqliteWarning();

async function main(): Promise<void> {
  const keySecret = process.env.QUILT_KEY_SECRET;
  if (!keySecret) {
    console.error('QUILT_KEY_SECRET is required: the keys this tracker holds are encrypted with it');
    process.exit(2);
  }
  const { Store, createTracker } = await import('@bitquilt/tracker');
  const { createHosted } = await import('./hosted.js');
  const { port, host, dbPath, options } = trackerOptionsFromEnv(process.env);
  const store = new Store(dbPath);
  const custodySecret = randomBytes(32).toString('hex');
  const hosted = createHosted({ store, trackerUrl: options.url, keySecret, home: process.env.QUILT_HOSTED_HOME ?? './quilt-hosted', custodySecret });
  const tracker = createTracker({ store, custodySecret, extra: hosted.routes, ...options });
  await tracker.listen(port, host);
  console.log(`bitquilt tracker with the hosted on-ramp at ${options.url} (db ${dbPath}; addresses at ${options.url}join)`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
