#!/usr/bin/env tsx
/**
 * bitquilt-poster: one run of the poster from the environment (QUILT_CHAIN_RPC, QUILT_CHAIN_ID, QUILT_CONTRACTS,
 * QUILT_POSTER_KEY, QUILT_COIN_HOME). Prints the report as one line of JSON: the sequence, the head, the root, whether
 * it was posted this run, and how many redeem lines the tree holds. Exits 1 when the home or the chain refused, 2
 * when the environment is short, so a job notices. Nothing it prints carries the key.
 */
import { chainFromEnv } from './chain.js';
import { post } from './post.js';

let config: ReturnType<typeof chainFromEnv>;
try {
  config = chainFromEnv();
} catch (e) {
  console.error(`usage: ${(e as Error).message}`);
  process.exit(2);
}
if (!config.home) {
  console.error('usage: QUILT_COIN_HOME names the home tracker');
  process.exit(2);
}
post({ home: config.home, chain: config.chain }).then(
  (report) => {
    console.log(JSON.stringify(report));
    process.exit(0);
  },
  (e) => {
    console.error(`the poster failed: ${(e as Error).message}`);
    process.exit(1);
  },
);
