#!/usr/bin/env tsx
/**
 * bitquilt-tracker: run a reference tracker. Configuration comes from the environment and nothing else; env.ts lists
 * every variable. The store is loaded once the SQLite notice is silenced.
 */
import { quietSqliteWarning, trackerOptionsFromEnv } from './env.js';

quietSqliteWarning();

async function main(): Promise<void> {
  const { Store } = await import('./store.js');
  const { createTracker } = await import('./tracker.js');
  const { port, host, dbPath, options } = trackerOptionsFromEnv(process.env);
  const store = new Store(dbPath);
  const tracker = createTracker({ store, ...options });
  await tracker.listen(port, host);
  console.log(`bitquilt tracker at ${options.url} (db ${dbPath})`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
