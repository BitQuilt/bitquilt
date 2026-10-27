#!/usr/bin/env tsx
/**
 * bitquilt-deposit <amount> [root]: burns `amount` units of the holder's Quilt on the chain for the ledger to credit to
 * `root`, the holder's own address when none is given, from the environment (QUILT_CHAIN_RPC, QUILT_CHAIN_ID,
 * QUILT_CONTRACTS, and the holder's key in QUILT_HOLDER_KEY). Prints the transaction as one line of JSON. Exits 1 when
 * the chain refused, 2 when the environment or the arguments are short. Nothing it prints carries the key.
 */
import { type Address, chainFromEnv, deposit, selfAddress } from './chain.js';

const amount = process.argv[2];
const root = process.argv[3];
if (!amount || !/^[0-9]+$/.test(amount) || BigInt(amount) < 1n) {
  console.error('usage: bitquilt-deposit <amount in units> [root]');
  process.exit(2);
}
if (root !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(root)) {
  console.error('usage: the root is an address');
  process.exit(2);
}
let config: ReturnType<typeof chainFromEnv>;
try {
  config = chainFromEnv({ ...process.env, QUILT_POSTER_KEY: process.env.QUILT_HOLDER_KEY ?? process.env.QUILT_POSTER_KEY });
} catch (e) {
  console.error(`usage: ${(e as Error).message}`);
  process.exit(2);
}
const to = (root as Address | undefined) ?? selfAddress(config.chain);
deposit(config.chain, { amount: BigInt(amount), root: to }).then(
  ({ tx }) => {
    console.log(JSON.stringify({ amount: Number(amount), root: to, tx }));
    process.exit(0);
  },
  (e) => {
    console.error(`the deposit failed: ${(e as Error).message}`);
    process.exit(1);
  },
);
