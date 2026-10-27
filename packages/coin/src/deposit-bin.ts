#!/usr/bin/env tsx
/**
 * bitquilt-deposit <amount> [root]: burns `amount` units of the holder's Quilt on the chain for the ledger to credit to
 * `root`, the holder's own address when none is given, from the environment (QUILT_CHAIN_RPC, QUILT_CHAIN_ID,
 * QUILT_CONTRACTS, and the holder's key in QUILT_HOLDER_KEY). Prints the transaction as one line of JSON. Exits 1 when
 * the chain refused, 2 when the environment or the arguments are short. Nothing it prints carries the key.
 */
import { type Address, deposit, selfAddress } from './chain.js';
import { fromEnv, run, usage } from './cli.js';
import { ADDRESS_RE } from './shapes.js';

const amount = process.argv[2];
const root = process.argv[3];
if (!amount || !/^[0-9]+$/.test(amount) || BigInt(amount) < 1n) usage('bitquilt-deposit <amount in units> [root]');
if (root !== undefined && !ADDRESS_RE.test(root)) usage('the root is an address');
const { chain } = fromEnv({ keyVar: 'QUILT_HOLDER_KEY' });
const to = (root as Address | undefined) ?? selfAddress(chain);
run('deposit', async () => ({ amount: Number(amount), root: to, tx: (await deposit(chain, { amount: BigInt(amount), root: to })).tx }));
