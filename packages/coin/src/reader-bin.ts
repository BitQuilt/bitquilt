#!/usr/bin/env tsx
/**
 * bitquilt-reader: one run of the reader from the environment (QUILT_CHAIN_RPC, QUILT_CHAIN_ID, QUILT_CONTRACTS,
 * QUILT_COIN_HOME, and the reader's ledger key in QUILT_READER_KEY, 64 hex characters). Prints the report as one line
 * of JSON: the deposits on the chain, the credits the home held, what was posted and what was refused. Exits 1 when the
 * home or the chain refused, 2 when the environment is short. Nothing it prints carries the key.
 */
import { chainFromEnv } from './chain.js';
import { read } from './read.js';

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
const raw = (process.env.QUILT_READER_KEY ?? '').trim().replace(/^0x/, '');
if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
  console.error('usage: QUILT_READER_KEY is 64 hex characters');
  process.exit(2);
}
const key = Uint8Array.from(Buffer.from(raw, 'hex'));
read({ home: config.home, chain: config.chain, key }).then(
  (report) => {
    console.log(JSON.stringify(report));
    process.exit(report.refused.length ? 1 : 0);
  },
  (e) => {
    console.error(`the reader failed: ${(e as Error).message}`);
    process.exit(1);
  },
);
