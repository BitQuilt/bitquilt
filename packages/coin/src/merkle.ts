/**
 * The Merkle tree over the coin log's redeem lines, as `Anchors` holds its root and `Quilt` checks a proof against it
 * (docs/COIN.md, "The door out"). A leaf is keccak256 of the ABI encoding of a redeem line's id (the coin log line's
 * hash as bytes32), the address the coin is minted to and the amount in units. Leaves are sorted ascending before the
 * tree is built; each pair is hashed with the smaller first, so a proof is a list of siblings and needs no side bits;
 * an odd node at any level is carried up unchanged; the root of no leaves is thirty-two zero bytes and the root of one
 * leaf is the leaf itself. `contracts/src/Merkle.sol` is the same recipe in Solidity, and the two are held to the same
 * fixture by a test on each side. Everything here is pure: hex in, hex out.
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

/** A 0x-prefixed hex string. */
export type Hex = `0x${string}`;

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function bytes32(hex: string, what: string): string {
  if (!HEX32.test(hex)) throw new Error(`${what} is 0x and 64 hex characters`);
  return hex.slice(2).toLowerCase();
}

function keccakHex(bytes: Uint8Array): Hex {
  return `0x${bytesToHex(keccak_256(bytes))}`;
}

/** keccak256(abi.encode(bytes32 id, address to, uint256 amount)): three words of thirty-two bytes. */
export function leaf(id: string, to: string, amount: bigint | number): Hex {
  const idHex = bytes32(id, 'a redeem id');
  if (!ADDRESS.test(to)) throw new Error('an address is 0x and 40 hex characters');
  if (typeof amount === 'number' && !Number.isSafeInteger(amount)) throw new Error('an amount is a whole number');
  const n = typeof amount === 'number' ? BigInt(amount) : amount;
  if (n < 0n || n >= 1n << 256n) throw new Error('an amount is a whole number that fits in 256 bits');
  const words = idHex + to.slice(2).toLowerCase().padStart(64, '0') + n.toString(16).padStart(64, '0');
  return keccakHex(hexToBytes(words));
}

/** The hash of a pair, the smaller first. */
export function pair(a: Hex, b: Hex): Hex {
  const x = bytes32(a, 'a node');
  const y = bytes32(b, 'a node');
  return keccakHex(hexToBytes(x < y ? x + y : y + x));
}

function sorted(leaves: readonly string[]): Hex[] {
  return leaves.map((l) => `0x${bytes32(l, 'a leaf')}` as Hex).sort();
}

function levelUp(level: readonly Hex[]): Hex[] {
  const next: Hex[] = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i]!;
    const right = level[i + 1];
    next.push(right === undefined ? left : pair(left, right));
  }
  return next;
}

/** The root over `leaves`, in any order: the sorted tree's top. */
export function root(leaves: readonly string[]): Hex {
  let level = sorted(leaves);
  if (level.length === 0) return `0x${'0'.repeat(64)}`;
  while (level.length > 1) level = levelUp(level);
  return level[0]!;
}

/** The siblings from `leaf` up to the root over `leaves`, bottom first; empty for a tree of one. */
export function proof(leaves: readonly string[], leaf: string): Hex[] {
  const target = `0x${bytes32(leaf, 'a leaf')}`;
  let level = sorted(leaves);
  let index = level.indexOf(target as Hex);
  if (index < 0) throw new Error('the leaf is not among the leaves');
  const path: Hex[] = [];
  while (level.length > 1) {
    const sibling = level[index ^ 1];
    if (sibling !== undefined) path.push(sibling);
    index = index >> 1;
    level = levelUp(level);
  }
  return path;
}

/** Whether `leaf` stands under `root` by way of `proof`. */
export function verify(root: string, leaf: string, proof: readonly string[]): boolean {
  let node = `0x${bytes32(leaf, 'a leaf')}` as Hex;
  for (const sibling of proof) node = pair(node, sibling as Hex);
  return node === `0x${bytes32(root, 'a root')}`;
}
