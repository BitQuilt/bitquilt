#!/usr/bin/env tsx
/**
 * bitquilt-hosted: the reference tracker with the hosted on-ramp mounted beside it. It reads the tracker's names
 * (packages/tracker/src/env.ts lists them) and the on-ramp's (packages/hosted/src/env.ts). Every hour it runs the
 * owners' turn for the members whose homes hold a problem or a gold, the first a minute after it starts. The store is
 * loaded once the SQLite notice is silenced.
 */
import { quietSqliteWarning, trackerOptionsFromEnv } from '@bitquilt/tracker/env';
import { guardReads, hostedOptionsFromEnv, onrampStartLines } from './env.js';

quietSqliteWarning();

async function main(): Promise<void> {
  guardReads(process.env);
  const keySecret = process.env.QUILT_KEY_SECRET;
  if (!keySecret) {
    console.error('QUILT_KEY_SECRET is required: the keys this tracker holds are encrypted with it');
    process.exit(2);
  }
  const { Store, schedulePeerPulls } = await import('@bitquilt/tracker');
  const { hostedDoor, scheduleOwnersTurn } = await import('./mount.js');
  const { port, host, dbPath, options } = trackerOptionsFromEnv(process.env);
  const store = new Store(dbPath);
  const onramp = hostedOptionsFromEnv(process.env, options);
  const { tracker, hosted } = hostedDoor({
    store,
    tracker: options,
    hosted: { ...onramp, trackerUrl: options.url, keySecret, home: onramp.home ?? './quilt-hosted' },
  });
  await tracker.listen(port, host);
  console.log(
    `bitquilt tracker with the hosted on-ramp at ${options.url} (db ${dbPath}; addresses at ${options.url}join)`,
  );
  for (const line of onrampStartLines(options.url, onramp, process.env)) console.log(line);
  scheduleOwnersTurn(hosted, (line) => console.log(line));
  schedulePeerPulls(tracker, options.peers ?? [], (line) => console.log(line));
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
