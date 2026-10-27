import { describe, expect, it } from 'vitest';
import { leaf, pair, proof, root, verify } from '../src/merkle.js';

/**
 * The Merkle tree over redeem lines, held to the same three fixed leaves as contracts/test/Merkle.t.sol: the same
 * leaves, the same root, the same proofs on both sides. The root was computed by this implementation, recomputed by
 * hand with cast (abi-encode, keccak, sorted pairs), and reproduced by the Solidity tree before it was written down.
 */
const lines = [
  { id: `0x${'01'.repeat(32)}`, to: '0x1111111111111111111111111111111111111111', amount: 1_000_000 },
  { id: `0x${'02'.repeat(32)}`, to: '0x2222222222222222222222222222222222222222', amount: 2_500_000 },
  { id: `0x${'03'.repeat(32)}`, to: '0x3333333333333333333333333333333333333333', amount: 7 },
];
const LEAF_A = '0xd3801f5f4f128a03cf5bdb2de12c20b9e9aabee980d3b713cce0f9b5ee79d88b';
const LEAF_B = '0xd8528bcf228f32a5224248696e1a525d6ecb051ddbfbbbac1d04eb9b6b7ca2cf';
const LEAF_C = '0xf1a41eb11b3af38a12fbe92e61d1bfbec6867722ca55a7ac4b5a4056abe499a4';
const PAIR_AB = '0x9e3667452b4a4a8c01cda75e6a9c7f0967cc9c32f9f527189dc8b218c0ea1ccd';
const ROOT = '0x5a13d80b100b007f43e3de1dce34d2f48eac81f14792c1b0545d9f7bc863aebb';

describe('the Merkle tree over redeem lines', () => {
  it('hashes the fixture leaves as the Solidity tree does', () => {
    expect(lines.map((l) => leaf(l.id, l.to, l.amount))).toEqual([LEAF_A, LEAF_B, LEAF_C]);
    expect(leaf(lines[0]!.id, lines[0]!.to, 1_000_000n)).toBe(LEAF_A);
    expect(leaf(lines[0]!.id, lines[0]!.to.toUpperCase().replace('0X', '0x'), 1_000_000)).toBe(LEAF_A);
  });
  it('comes to the fixture root, in any order of the leaves', () => {
    expect(root([LEAF_A, LEAF_B, LEAF_C])).toBe(ROOT);
    expect(root([LEAF_C, LEAF_A, LEAF_B])).toBe(ROOT);
    expect(pair(LEAF_A, LEAF_B)).toBe(PAIR_AB);
    expect(pair(LEAF_B, LEAF_A)).toBe(PAIR_AB);
    expect(root([LEAF_A.toUpperCase().replace('0X', '0x'), LEAF_B, LEAF_C])).toBe(ROOT);
  });
  it('gives each leaf the proof the Solidity tree gives, and the proofs verify', () => {
    const leaves = [LEAF_C, LEAF_A, LEAF_B];
    expect(proof(leaves, LEAF_A)).toEqual([LEAF_B, LEAF_C]);
    expect(proof(leaves, LEAF_B)).toEqual([LEAF_A, LEAF_C]);
    expect(proof(leaves, LEAF_C)).toEqual([PAIR_AB]);
    for (const l of leaves) expect(verify(ROOT, l, proof(leaves, l))).toBe(true);
    expect(leaves).toEqual([LEAF_C, LEAF_A, LEAF_B]);
  });
  it('keeps a wrong leaf outside', () => {
    const leaves = [LEAF_A, LEAF_B, LEAF_C];
    const pa = proof(leaves, LEAF_A);
    expect(verify(ROOT, leaf(lines[0]!.id, lines[0]!.to, 1_000_001), pa)).toBe(false);
    expect(verify(ROOT, leaf(lines[0]!.id, lines[1]!.to, 1_000_000), pa)).toBe(false);
    expect(verify(ROOT, LEAF_B, pa)).toBe(false);
    expect(verify(ROOT, LEAF_A, [])).toBe(false);
    expect(verify(ROOT, LEAF_A, [...pa].reverse())).toBe(false);
    expect(() => proof(leaves, `0x${'ab'.repeat(32)}`)).toThrow(/not among the leaves/);
  });
  it('has a zero root for no leaves and the leaf itself for one', () => {
    expect(root([])).toBe(`0x${'0'.repeat(64)}`);
    expect(root([LEAF_B])).toBe(LEAF_B);
    expect(proof([LEAF_B], LEAF_B)).toEqual([]);
    expect(verify(LEAF_B, LEAF_B, [])).toBe(true);
    expect(verify(root([]), LEAF_B, [])).toBe(false);
  });
  it('carries an odd node up unchanged at every level', () => {
    const five = [1, 2, 3, 4, 5].map((n) => leaf(`0x${n.toString(16).padStart(64, '0')}`, lines[0]!.to, n));
    const r = root(five);
    for (const l of five) expect(verify(r, l, proof(five, l))).toBe(true);
    const sorted = [...five].sort();
    const lone = sorted[4]!;
    expect(proof(five, lone)).toEqual([pair(pair(sorted[0]!, sorted[1]!), pair(sorted[2]!, sorted[3]!))]);
  });
  it('refuses what is not a leaf, an address or a whole amount', () => {
    expect(() => leaf('0x01', lines[0]!.to, 1)).toThrow(/64 hex/);
    expect(() => leaf(lines[0]!.id, '0x1234', 1)).toThrow(/40 hex/);
    expect(() => leaf(lines[0]!.id, lines[0]!.to, -1)).toThrow(/whole number/);
    expect(() => leaf(lines[0]!.id, lines[0]!.to, 1.5)).toThrow(/whole number/);
    expect(() => root(['abc'])).toThrow(/64 hex/);
  });
});
