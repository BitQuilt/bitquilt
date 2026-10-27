#!/usr/bin/env tsx
/**
 * bitquilt-claim <line id>: mints one redeemed line on the chain for its holder, from the environment
 * (QUILT_CHAIN_RPC, QUILT_CHAIN_ID, QUILT_CONTRACTS, QUILT_COIN_HOME, and the holder's key in QUILT_HOLDER_KEY, or
 * QUILT_POSTER_KEY where the poster claims for someone). Prints the report as one line of JSON. Exits 1 when the home
 * or the chain refused, 2 when the environment or the argument is short. Nothing it prints carries a key.
 */
import { chainFromEnv } from './chain.js';
import { claim } from './claim.js';

const id = process.argv[2];
if (!id) {
  console.error('usage: bitquilt-claim <line id>');
  process.exit(2);
}
let config: ReturnType<typeof chainFromEnv>;
try {
  config = chainFromEnv({ ...process.env, QUILT_POSTER_KEY: process.env.QUILT_HOLDER_KEY ?? process.env.QUILT_POSTER_KEY });
} catch (e) {
  console.error(`usage: ${(e as Error).message}`);
  process.exit(2);
}
if (!config.home) {
  console.error('usage: QUILT_COIN_HOME names the home tracker');
  process.exit(2);
}
claim({ home: config.home, chain: config.chain, id }).then(
  (report) => {
    console.log(JSON.stringify(report));
    process.exit(0);
  },
  (e) => {
    console.error(`the claim failed: ${(e as Error).message}`);
    process.exit(1);
  },
);
