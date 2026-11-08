#!/usr/bin/env tsx
/**
 * bitquilt-node: one node with roles, from the environment. QUILT_HOME is the node's folder (./quilt-node); QUILT_ROLES
 * the roles, comma separated (admit,keep); QUILT_DB the store's path when a door kept a database before (else
 * QUILT_HOME/node.db); QUILT_SOURCES the sources a node with keep and no door pulls from (the door's peers and the
 * config's trackers unless set). The door reads the tracker's names (packages/tracker/src/env.ts: QUILT_PORT,
 * QUILT_HOST, QUILT_URL, QUILT_NAME, QUILT_PEERS and the rest); the on-ramp reads the names the hosted binary reads
 * (packages/hosted/src/env.ts: QUILT_KEY_SECRET, QUILT_HOSTED_HOME, QUILT_OAUTH_SECRET and the rest); the page reads
 * the home's config.json, with QUILT_TRACKERS and QUILT_RELAYS over it. The store is loaded once the SQLite notice is
 * silenced: the first imports are the tracker's env.ts and the on-ramp's, which load no store, and the node is
 * imported after them.
 */
import { quietSqliteWarning, trackerOptionsFromEnv } from '@bitquilt/tracker/env';
import { guardReads, hostedOptionsFromEnv, onrampStartLines } from '@bitquilt/hosted/env';

quietSqliteWarning();

async function main(): Promise<void> {
  const { ROLES, start } = await import('./node.js');
  const env = process.env;
  const roles = (env.QUILT_ROLES ?? 'admit,keep')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const r of roles)
    if (!(ROLES as readonly string[]).includes(r))
      throw new Error(`QUILT_ROLES: ${r} is not a role; the roles are ${ROLES.join(', ')}`);
  const home = env.QUILT_HOME ?? './quilt-node';
  const list = (s: string | undefined): string[] =>
    (s ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const { port, host, dbPath, options } = trackerOptionsFromEnv(env);
  const keySecret = env.QUILT_KEY_SECRET;
  if (roles.includes('host')) {
    if (!keySecret)
      throw new Error('QUILT_KEY_SECRET is required for host: the keys a node holds are encrypted with it');
    guardReads(env);
  }
  const onramp = hostedOptionsFromEnv(env, options);
  const { relays } = onramp;
  const trackers = list(env.QUILT_TRACKERS);
  const sources = list(env.QUILT_SOURCES);
  const node = await start({
    home,
    roles: roles as Parameters<typeof start>[0]['roles'],
    ...(env.QUILT_DB ? { store: dbPath } : {}),
    door: { port, host, ...options },
    page: { ...(trackers.length ? { trackers } : {}), ...(relays.length ? { relays } : {}) },
    ...(sources.length ? { sources } : {}),
    ...(keySecret ? { host: { keySecret, ...onramp } } : {}),
    say: (line) => console.log(line),
  });
  const where = [
    node.door ? `door at ${options.url}` : '',
    node.page ? `page at http://localhost:${node.config.port}/` : '',
  ]
    .filter(Boolean)
    .join(', ');
  console.log(
    `bitquilt node, roles ${[...node.roles].join(', ')}; ${where || 'no door and no page'}; store ${env.QUILT_DB ? dbPath : `${home}/node.db`}`,
  );
  if (node.hosted) {
    const [oauth, turn] = onrampStartLines(options.url, onramp, env);
    console.log(`addresses at ${options.url}join; ${oauth}`);
    console.log(turn);
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
