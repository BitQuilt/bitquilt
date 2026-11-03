#!/usr/bin/env tsx
/**
 * bitquilt-hosted: the reference tracker with the hosted on-ramp mounted beside it. It reads the tracker's variables
 * (packages/tracker/src/env.ts lists them) and these:
 *   QUILT_KEY_SECRET     required: what the keys this tracker holds are encrypted with
 *   QUILT_HOSTED_HOME    a folder for members' caches and queues (./quilt-hosted)
 *   QUILT_OAUTH_SECRET   the key the authorization server signs its tokens with (QX-18); unset, there is no OAuth and
 *                        an address is its own credential
 *   QUILT_OAUTH_ISSUER   the issuer its metadata names (the tracker's address without the trailing slash)
 *   QUILT_WITNESS_RANGES the address ranges each product publishes for its servers, as one JSON object of product to
 *                        ranges; the ranges in products.ts unless set
 *   QUILT_RELAYS         the relays a member's Quilt searches and announces on (QX-14), comma separated; none unless set
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, QUILT_SENTENCE_MODEL
 *                        the vendor the owners' turn asks for the sentence a brief lacks (QX-19 section 4, sentence.ts);
 *                        with neither key the turn reveals the gold due and sharpens nothing
 * and QUILT_TRUSTED_PROXIES, which the tracker reads too. Every hour it runs the owners' turn for the members whose
 * homes hold a problem or a gold, the first a minute after it starts.
 */
import { randomBytes } from 'node:crypto';
import { quietSqliteWarning, trackerOptionsFromEnv } from '@bitquilt/tracker/env';

quietSqliteWarning();

async function main(): Promise<void> {
  // QX-19: this connector fetches a trace's pages on a stranger's word and serves what it kept to anyone, so never from a private address.
  process.env.QUILT_READS ??= 'public';
  const keySecret = process.env.QUILT_KEY_SECRET;
  if (!keySecret) {
    console.error('QUILT_KEY_SECRET is required: the keys this tracker holds are encrypted with it');
    process.exit(2);
  }
  const { Store, createTracker, schedulePeerPulls } = await import('@bitquilt/tracker');
  const { createHosted } = await import('./hosted.js');
  const { port, host, dbPath, options } = trackerOptionsFromEnv(process.env);
  const store = new Store(dbPath);
  const custodySecret = randomBytes(32).toString('hex');
  const oauthSecret = process.env.QUILT_OAUTH_SECRET;
  const ranges = process.env.QUILT_WITNESS_RANGES ? witnessRanges(process.env.QUILT_WITNESS_RANGES) : undefined;
  const oauth = oauthSecret ? { secret: oauthSecret, ...(process.env.QUILT_OAUTH_ISSUER ? { issuer: process.env.QUILT_OAUTH_ISSUER } : {}), ...(ranges ? { ranges } : {}) } : undefined;
  const relays = (process.env.QUILT_RELAYS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const hosted = createHosted({
    store, trackerUrl: options.url, keySecret, home: process.env.QUILT_HOSTED_HOME ?? './quilt-hosted', custodySecret, relays,
    ...(options.name ? { name: options.name } : {}), ...(oauth ? { oauth } : {}), ...(options.trustedProxies ? { trustedProxies: options.trustedProxies } : {}),
  });
  const tracker = createTracker({ store, custodySecret, extra: hosted.routes, extraWellKnown: hosted.describe, ...options });
  await tracker.listen(port, host);
  console.log(`bitquilt tracker with the hosted on-ramp at ${options.url} (db ${dbPath}; addresses at ${options.url}join)`);
  console.log(oauth ? `the authorization server is on: products connect at ${options.url}mcp and the events say which (QX-18)` : 'QUILT_OAUTH_SECRET is unset: no OAuth, and an address is its own credential');
  console.log(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY ? 'the owners\' turn runs every hour: the gold due revealed and the briefs sharpened for the keys held here' : 'the owners\' turn runs every hour: the gold due revealed; no vendor key is set, so no brief is sharpened');
  // The owners' turn, hourly, one at a time: a turn still running when the hour comes round is left to finish.
  let running = false;
  const ownersTurn = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const t of await hosted.turn()) if (t.said) console.log(`owners' turn, ${t.address}: ${t.said}`);
    } catch (err) {
      console.log(`owners' turn: not run (${(err as Error).message})`);
    } finally {
      running = false;
    }
  };
  setTimeout(() => void ownersTurn(), 60_000).unref();
  setInterval(() => void ownersTurn(), 3_600_000).unref();
  schedulePeerPulls(tracker, options.peers ?? [], (line) => console.log(line));
}

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

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
