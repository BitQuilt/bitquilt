#!/usr/bin/env tsx
/**
 * bitquilt-node: one node with roles, from the environment. QUILT_HOME is the node's folder (./quilt-node); QUILT_ROLES
 * the roles, comma separated (admit,keep). The door reads the tracker's names (packages/tracker/src/env.ts: QUILT_PORT,
 * QUILT_HOST, QUILT_URL, QUILT_NAME, QUILT_PEERS and the rest); the on-ramp reads QUILT_KEY_SECRET, QUILT_OAUTH_SECRET,
 * QUILT_OAUTH_ISSUER, QUILT_RELAYS and QUILT_HOSTED_HOME as the hosted binary does, without the witness ranges; the
 * page reads the home's config.json, with QUILT_TRACKERS and QUILT_RELAYS over it. The store is loaded once the SQLite
 * notice is silenced.
 */
import { quietSqliteWarning, trackerOptionsFromEnv } from '@bitquilt/tracker';

quietSqliteWarning();

async function main(): Promise<void> {
  const { ROLES, start } = await import('./node.js');
  const env = process.env;
  const roles = (env.QUILT_ROLES ?? 'admit,keep').split(',').map((s) => s.trim()).filter(Boolean);
  for (const r of roles) if (!(ROLES as readonly string[]).includes(r)) throw new Error(`QUILT_ROLES: ${r} is not a role; the roles are ${ROLES.join(', ')}`);
  const home = env.QUILT_HOME ?? './quilt-node';
  const list = (s: string | undefined): string[] => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const { port, host, options } = trackerOptionsFromEnv(env);
  const keySecret = env.QUILT_KEY_SECRET;
  if (roles.includes('host') && !keySecret) throw new Error('QUILT_KEY_SECRET is required for host: the keys a node holds are encrypted with it');
  const oauthSecret = env.QUILT_OAUTH_SECRET;
  const relays = list(env.QUILT_RELAYS);
  const trackers = list(env.QUILT_TRACKERS);
  const node = await start({
    home,
    roles: roles as Parameters<typeof start>[0]['roles'],
    door: { port, host, ...options },
    page: { ...(trackers.length ? { trackers } : {}), ...(relays.length ? { relays } : {}) },
    ...(keySecret
      ? {
        host: {
          keySecret, relays, ...(options.name ? { name: options.name } : {}), ...(options.trustedProxies ? { trustedProxies: options.trustedProxies } : {}),
          ...(env.QUILT_HOSTED_HOME ? { home: env.QUILT_HOSTED_HOME } : {}),
          ...(oauthSecret ? { oauth: { secret: oauthSecret, ...(env.QUILT_OAUTH_ISSUER ? { issuer: env.QUILT_OAUTH_ISSUER } : {}) } } : {}),
        },
      }
      : {}),
    say: (line) => console.log(line),
  });
  const where = [node.door ? `door at ${options.url}` : '', node.page ? `page at http://localhost:${node.config.port}/` : ''].filter(Boolean).join(', ');
  console.log(`bitquilt node, roles ${[...node.roles].join(', ')}; ${where || 'no door and no page'}; store ${home}/node.db`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
