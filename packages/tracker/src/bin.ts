#!/usr/bin/env tsx
/**
 * bitquilt-tracker: run a reference tracker. Configuration comes from the environment and nothing else.
 *   QUILT_PORT (3977)  QUILT_HOST (127.0.0.1)  QUILT_DB (./quilt-tracker.db)  QUILT_URL (http://localhost:<port>/)
 *   QUILT_NAME  QUILT_PEERS (comma-separated)  QUILT_LIMIT_KEY_HOUR (120)  QUILT_LIMIT_IP_HOUR (600)
 *   QUILT_STAMP_NAME (0)  QUILT_IP_SALT  QUILT_MAINTAINERS (addresses whose hide events this tracker honours, comma separated)
 *   QUILT_COIN (the coin's parameters as JSON, QX-17; absent, no coin log and no coin lock honoured)
 */
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: unknown, ...rest: unknown[]) => {
  if (String(warning).includes('SQLite is an experimental feature')) return;
  (emitWarning as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

async function main(): Promise<void> {
  const { Store } = await import('./store.js');
  const { createTracker } = await import('./tracker.js');
  const { coinParamsProblems } = await import('./coin.js');
  let coin: import('./coin.js').CoinParams | undefined;
  if (process.env.QUILT_COIN) {
    const parsed = JSON.parse(process.env.QUILT_COIN) as unknown;
    const problems = coinParamsProblems(parsed);
    if (problems.length) throw new Error(`QUILT_COIN: ${problems[0]}`);
    coin = parsed as import('./coin.js').CoinParams;
  }
  const port = Number(process.env.QUILT_PORT ?? 3977);
  const host = process.env.QUILT_HOST ?? '127.0.0.1';
  const url = process.env.QUILT_URL ?? `http://localhost:${port}/`;
  const dbPath = process.env.QUILT_DB ?? './quilt-tracker.db';
  const store = new Store(dbPath);
  const tracker = createTracker({
    store,
    url,
    ...(process.env.QUILT_NAME ? { name: process.env.QUILT_NAME } : {}),
    peers: (process.env.QUILT_PEERS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    limits: { keyPerHour: Number(process.env.QUILT_LIMIT_KEY_HOUR ?? 120), ipPerHour: Number(process.env.QUILT_LIMIT_IP_HOUR ?? 600) },
    stamp: { name: Number(process.env.QUILT_STAMP_NAME ?? 0) },
    ...(process.env.QUILT_IP_SALT ? { ipSalt: process.env.QUILT_IP_SALT } : {}),
    maintainers: (process.env.QUILT_MAINTAINERS ?? '').split(',').map((s) => s.trim()).filter(Boolean) as `0x${string}`[],
    ...(coin ? { coin } : {}),
  });
  await tracker.listen(port, host);
  console.log(`bitquilt tracker at ${url} (db ${dbPath})`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
