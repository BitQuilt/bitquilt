#!/usr/bin/env tsx
/**
 * bitquilt-reader: one run of the reader from the environment (QUILT_CHAIN_RPC, QUILT_CHAIN_ID, QUILT_CONTRACTS,
 * QUILT_COIN_HOME, and the reader's ledger key in QUILT_READER_KEY, 64 hex characters). Prints the report as one line
 * of JSON: the deposits on the chain, the credits the home held, what was posted and what was refused. Exits 1 when the
 * home or the chain refused, 2 when the environment is short. Nothing it prints carries the key.
 */
import { fromEnv, run, secretFromEnv } from './cli.js';
import { read } from './read.js';

const { chain, home } = fromEnv({ home: true });
const key = secretFromEnv('QUILT_READER_KEY');
run('reader', () => read({ home, chain, key }), true);
