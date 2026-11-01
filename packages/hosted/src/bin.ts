#!/usr/bin/env tsx
/**
 * bitquilt-hosted: the reference tracker with the hosted on-ramp mounted beside it. It reads the tracker's variables
 * (packages/tracker/src/env.ts lists them) and these:
 *   QUILT_KEY_SECRET     required: what the keys this tracker holds are encrypted with
 *   QUILT_HOSTED_HOME    a folder for members' caches and queues (./quilt-hosted)
 *   QUILT_OAUTH_SECRET   the key the authorization server signs its tokens with (QX-18); unset, there is no OAuth and
 *                        an address is its own credential
 *   QUILT_OAUTH_ISSUER   the issuer its metadata names (the tracker's address without the trailing slash)
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
  const oauthSecret = process.env.QUILT_OAUTH_SECRET;
  const oauth = oauthSecret ? { secret: oauthSecret, ...(process.env.QUILT_OAUTH_ISSUER ? { issuer: process.env.QUILT_OAUTH_ISSUER } : {}) } : undefined;
  const hosted = createHosted({ store, trackerUrl: options.url, keySecret, home: process.env.QUILT_HOSTED_HOME ?? './quilt-hosted', custodySecret, ...(options.name ? { name: options.name } : {}), ...(oauth ? { oauth } : {}) });
  const tracker = createTracker({ store, custodySecret, extra: hosted.routes, ...options });
  await tracker.listen(port, host);
  console.log(`bitquilt tracker with the hosted on-ramp at ${options.url} (db ${dbPath}; addresses at ${options.url}join)`);
  console.log(oauth ? `the authorization server is on: products connect at ${options.url}mcp and the events say which (QX-18)` : 'QUILT_OAUTH_SECRET is unset: no OAuth, and an address is its own credential');
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
