/** A hash is `sha256:` and sixty-four lower-case hex characters, over the UTF-8 bytes of canonical JSON or the bytes of a blob. */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalBytes } from './canonical.js';

export type Hash = `sha256:${string}`;
export const HASH_RE = /^sha256:[0-9a-f]{64}$/;
export const HEX64_RE = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes));
}

export function hashBytes(bytes: Uint8Array): Hash {
  return `sha256:${sha256Hex(bytes)}`;
}

/** The hash of a value's canonical JSON. */
export function hashCanonical(value: unknown): Hash {
  return hashBytes(canonicalBytes(value));
}

export function hashText(text: string): Hash {
  return hashBytes(new TextEncoder().encode(text));
}

export function isHash(s: unknown): s is Hash {
  return typeof s === 'string' && HASH_RE.test(s);
}

/** The hex part of a hash, for places that want sixty-four characters and no prefix. */
export function hashHex(h: Hash): string {
  return h.slice('sha256:'.length);
}
