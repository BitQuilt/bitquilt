#!/usr/bin/env tsx
/**
 * bitquilt-claim <line id>: mints one redeemed line on the chain for its holder, from the environment
 * (QUILT_CHAIN_RPC, QUILT_CHAIN_ID, QUILT_CONTRACTS, QUILT_COIN_HOME, and the holder's key in QUILT_HOLDER_KEY).
 * Prints the report as one line of JSON. Exits 1 when the home or the chain refused, 2 when the environment or the
 * argument is short. Nothing it prints carries a key.
 */
import { claim } from './claim.js';
import { fromEnv, run, usage } from './cli.js';

const id = process.argv[2];
if (!id) usage('bitquilt-claim <line id>');
const { chain, home } = fromEnv({ home: true, keyVar: 'QUILT_HOLDER_KEY' });
run('claim', () => claim({ home, chain, id }));
