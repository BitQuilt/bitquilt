/**
 * What the hosted on-ramp reads from the environment, beside the tracker's names (packages/tracker/src/env.ts), for
 * the two programs that hold custody at a door: bitquilt-hosted, and bitquilt-node with the role host.
 *   QUILT_KEY_SECRET     required: what the keys this tracker holds are encrypted with; each binary refuses to start
 *                        without it, in its own words
 *   QUILT_HOSTED_HOME    a folder for members' caches and queues (./quilt-hosted for bitquilt-hosted, the node's home's
 *                        hosted folder for a node)
 *   QUILT_OAUTH_SECRET   the key the authorization server signs its tokens with (QX-18); unset, there is no OAuth and
 *                        an address is its own credential
 *   QUILT_OAUTH_ISSUER   the issuer its metadata names (the tracker's address without the trailing slash)
 *   QUILT_WITNESS_RANGES the address ranges each product publishes for its servers, as one JSON object of product to
 *                        ranges; the ranges in products.ts unless set
 *   QUILT_RELAYS         the relays a member's Quilt searches and announces on (QX-14), comma separated; none unless
 *                        set
 *   QUILT_READS          public where it is unset or empty, by `guardReads`
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, QUILT_SENTENCE_MODEL
 *                        the vendor the owners' turn asks for the sentence a brief lacks (QX-19 section 4,
 *                        sentence.ts, which reads them); with neither key the turn reveals the gold due and sharpens
 *                        nothing, as the binaries' start lines say (`onrampStartLines`)
 * The tracker's name and QUILT_TRUSTED_PROXIES are the tracker's, read there, and the on-ramp takes them from its
 * options. This file loads no store: its one import from the tracker is a type from env.ts, so a binary can read it
 * before Node's SQLite module is loaded and its warning silenced.
 */
import type { TrackerEnv } from '@bitquilt/tracker/env';
import type { HostedOptions } from './hosted.js';

/**
 * What the environment says of the on-ramp: the relays, always listed and none where none are named; the members'
 * folder where the environment names one; the authorization server where its secret is set; and the tracker's name
 * and proxies, taken from the tracker's options.
 */
export type HostedEnv = Pick<HostedOptions, 'name' | 'trustedProxies' | 'oauth'> & { relays: string[]; home?: string };

/**
 * QX-19: a door that holds custody fetches a trace's pages on a stranger's word and serves what it kept to anyone, so
 * never from a private address: QUILT_READS is public where it is unset or empty.
 */
export function guardReads(env: NodeJS.ProcessEnv): void {
  env.QUILT_READS ||= 'public';
}

/**
 * Reads the names above beside the tracker's options, which name the tracker and the proxies it believes; a malformed
 * QUILT_WITNESS_RANGES throws naming the fault.
 */
export function hostedOptionsFromEnv(env: NodeJS.ProcessEnv, tracker: TrackerEnv['options']): HostedEnv {
  const oauthSecret = env.QUILT_OAUTH_SECRET;
  const ranges = env.QUILT_WITNESS_RANGES ? witnessRanges(env.QUILT_WITNESS_RANGES) : undefined;
  const oauth = oauthSecret
    ? {
        secret: oauthSecret,
        ...(env.QUILT_OAUTH_ISSUER ? { issuer: env.QUILT_OAUTH_ISSUER } : {}),
        ...(ranges ? { ranges } : {}),
      }
    : undefined;
  const relays = (env.QUILT_RELAYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    relays,
    ...(env.QUILT_HOSTED_HOME ? { home: env.QUILT_HOSTED_HOME } : {}),
    ...(tracker.name ? { name: tracker.name } : {}),
    ...(oauth ? { oauth } : {}),
    ...(tracker.trustedProxies ? { trustedProxies: tracker.trustedProxies } : {}),
  };
}

/**
 * What a binary says of the on-ramp once its door listens: whether the authorization server is on, and what the owners'
 * turn does with the vendor keys the environment holds.
 */
export function onrampStartLines(url: string, onramp: HostedEnv, env: NodeJS.ProcessEnv): [string, string] {
  return [
    onramp.oauth
      ? `the authorization server is on: products connect at ${url}mcp and the events say which (QX-18)`
      : 'QUILT_OAUTH_SECRET is unset: no OAuth, and an address is its own credential',
    env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY
      ? "the owners' turn runs every hour: the gold due revealed and the briefs sharpened for the keys held here"
      : "the owners' turn runs every hour: the gold due revealed; no vendor key is set, so no brief is sharpened",
  ];
}

/** QUILT_WITNESS_RANGES as one JSON object of product to a list of ranges; anything else throws, naming the fault. */
function witnessRanges(text: string): Record<string, string[]> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('QUILT_WITNESS_RANGES is a JSON object of product to ranges');
  const out: Record<string, string[]> = {};
  for (const [product, list] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(list) || !list.every((r) => typeof r === 'string'))
      throw new Error(`QUILT_WITNESS_RANGES: ${product} is a list of ranges`);
    out[product] = list as string[];
  }
  return out;
}
