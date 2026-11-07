#!/usr/bin/env tsx
/**
 * bitquilt-node: one node with roles, from the environment. QUILT_HOME is the node's folder (./quilt-node); QUILT_ROLES
 * the roles, comma separated (admit,keep); QUILT_DB the store's path when a door kept a database before (else
 * QUILT_HOME/node.db); QUILT_SOURCES the sources a node with keep and no door pulls from (the door's peers and the
 * config's trackers unless set). The door reads the tracker's names (packages/tracker/src/env.ts: QUILT_PORT,
 * QUILT_HOST, QUILT_URL, QUILT_NAME, QUILT_PEERS and the rest); the on-ramp reads what the hosted binary reads
 * (QUILT_KEY_SECRET, QUILT_HOSTED_HOME, QUILT_OAUTH_SECRET, QUILT_OAUTH_ISSUER, QUILT_WITNESS_RANGES, QUILT_RELAYS, and
 * the vendor keys for the owners' turn); the page reads the home's config.json, with QUILT_TRACKERS and QUILT_RELAYS
 * over it. The store is loaded once the SQLite notice is silenced: the first import is the tracker's env.ts, which loads
 * no store, and the node is imported after it.
 */
import { quietSqliteWarning, trackerOptionsFromEnv } from '@bitquilt/tracker/env';

quietSqliteWarning();

/** QUILT_WITNESS_RANGES as one JSON object of product to a list of ranges; anything else throws, naming the fault. */
function witnessRanges(text: string): Record<string, string[]> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('QUILT_WITNESS_RANGES is a JSON object of product to ranges');
  const out: Record<string, string[]> = {};
  for (const [product, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(list) || !list.every((r) => typeof r === 'string')) throw new Error(`QUILT_WITNESS_RANGES: ${product} is a list of ranges`);
    out[product] = list as string[];
  }
  return out;
}

async function main(): Promise<void> {
  const { ROLES, start } = await import('./node.js');
  const env = process.env;
  const roles = (env.QUILT_ROLES ?? 'admit,keep').split(',').map((s) => s.trim()).filter(Boolean);
  for (const r of roles) if (!(ROLES as readonly string[]).includes(r)) throw new Error(`QUILT_ROLES: ${r} is not a role; the roles are ${ROLES.join(', ')}`);
  const home = env.QUILT_HOME ?? './quilt-node';
  const list = (s: string | undefined): string[] => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const { port, host, dbPath, options } = trackerOptionsFromEnv(env);
  const keySecret = env.QUILT_KEY_SECRET;
  if (roles.includes('host')) {
    if (!keySecret) throw new Error('QUILT_KEY_SECRET is required for host: the keys a node holds are encrypted with it');
    // QX-19: a host fetches a trace's pages on a stranger's word and serves what it kept to anyone, so never from a private address.
    env.QUILT_READS ||= 'public';
  }
  const oauthSecret = env.QUILT_OAUTH_SECRET;
  const ranges = env.QUILT_WITNESS_RANGES ? witnessRanges(env.QUILT_WITNESS_RANGES) : undefined;
  const relays = list(env.QUILT_RELAYS);
  const trackers = list(env.QUILT_TRACKERS);
  const sources = list(env.QUILT_SOURCES);
  const node = await start({
    home,
    roles: roles as Parameters<typeof start>[0]['roles'],
    ...(env.QUILT_DB ? { store: dbPath } : {}),
    door: { port, host, ...options },
    page: { ...(trackers.length ? { trackers } : {}), ...(relays.length ? { relays } : {}) },
    ...(sources.length ? { sources } : {}),
    ...(keySecret
      ? {
        host: {
          keySecret, relays, ...(options.name ? { name: options.name } : {}), ...(options.trustedProxies ? { trustedProxies: options.trustedProxies } : {}),
          ...(env.QUILT_HOSTED_HOME ? { home: env.QUILT_HOSTED_HOME } : {}),
          ...(oauthSecret ? { oauth: { secret: oauthSecret, ...(env.QUILT_OAUTH_ISSUER ? { issuer: env.QUILT_OAUTH_ISSUER } : {}), ...(ranges ? { ranges } : {}) } } : {}),
        },
      }
      : {}),
    say: (line) => console.log(line),
  });
  const where = [node.door ? `door at ${options.url}` : '', node.page ? `page at http://localhost:${node.config.port}/` : ''].filter(Boolean).join(', ');
  console.log(`bitquilt node, roles ${[...node.roles].join(', ')}; ${where || 'no door and no page'}; store ${env.QUILT_DB ? dbPath : `${home}/node.db`}`);
  if (node.hosted) {
    console.log(`addresses at ${options.url}join; ${oauthSecret ? `the authorization server is on: products connect at ${options.url}mcp and the events say which (QX-18)` : 'QUILT_OAUTH_SECRET is unset: no OAuth, and an address is its own credential'}`);
    console.log(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY ? 'the owners\' turn runs every hour: the gold due revealed and the briefs sharpened for the keys held here' : 'the owners\' turn runs every hour: the gold due revealed; no vendor key, so no brief is sharpened');
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
