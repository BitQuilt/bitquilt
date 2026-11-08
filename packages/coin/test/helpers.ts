/**
 * What the coin's tests share: the stand-in chain the jobs are pointed at, the two addresses a redeem or a deposit
 * names, and a 32-byte value written as text. Each test file keeps its own fake home and its own door, since what each
 * job asks of them differs. vitest runs `*.test.ts` alone, so this file is no test of its own.
 */
import type { Address, Chain } from '../src/chain.js';

/** A chain no test reaches: the jobs read its addresses, and the door each test hands them answers in its place. */
export const chain: Chain = {
  rpc: 'http://chain.test',
  chainId: 1,
  contracts: {
    anchors: '0x1111111111111111111111111111111111111111',
    quilt: '0x2222222222222222222222222222222222222222',
  },
};

/** The holder: the address a redeem line mints to and a deposit is credited to. */
export const HOLDER: Address = '0x3333333333333333333333333333333333333333';
/** Another address, for a line or a deposit that is not the holder's. */
export const OTHER: Address = '0x4444444444444444444444444444444444444444';

/**
 * A 32-byte value as 64 lowercase hex characters with no `0x`, `n` at its end: an id, a head, a root or a transaction.
 */
export const hex = (n: number): string => n.toString(16).padStart(64, '0');
