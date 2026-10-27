#!/usr/bin/env tsx
/**
 * bitquilt-poster: one run of the poster from the environment (QUILT_CHAIN_RPC, QUILT_CHAIN_ID, QUILT_CONTRACTS,
 * QUILT_POSTER_KEY, QUILT_COIN_HOME). Prints the report as one line of JSON: the sequence, the head, the root, whether
 * it was posted this run, and how many redeem lines the tree holds. Exits 1 when the home or the chain refused, 2
 * when the environment is short, so a job notices. Nothing it prints carries the key.
 */
import { fromEnv, run } from './cli.js';
import { post } from './post.js';

const { chain, home } = fromEnv({ home: true });
run('poster', () => post({ home, chain }));
