/**
 * Keys and signatures (CORE.md section 1). A key is secp256k1; an identity is the key's Ethereum address with the
 * EIP-55 checksum; a signature is a recoverable ECDSA signature in the EIP-191 personal-message form over the UTF-8
 * bytes of an object's canonical JSON without its `sig` (and `sig_to`) field, written as 0x, r, s and v in hex. The
 * signer is recovered from the signature and compared with the object's `key` or `owner`, so nothing carries a public
 * key. Any Ethereum wallet can make these signatures, and a phrase at the standard Ethereum path gives the same address
 * a wallet would show for it.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { canonicalBytes } from './canonical.js';

/** An identity: the key's Ethereum address with its EIP-55 checksum, as every `key` and `owner` is written. */
export type Address = `0x${string}`;
/** A recoverable signature as 0x, r, s and v in hex: 132 characters. */
export type Signature = `0x${string}`;
/** The standard Ethereum derivation path, so a phrase gives the address a wallet would show for it. */
export const ETH_PATH = "m/44'/60'/0'/0/0";
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SIG_RE = /^0x[0-9a-f]{130}$/;

/** A secret key as sixty-four hex characters, for the key file; and back. */
export function secretToHex(secret: Uint8Array): string {
  return bytesToHex(secret);
}

/** The secret key read back from the key file, with or without its 0x. */
export function secretFromHex(hex: string): Uint8Array {
  return hexToBytes(hex.trim().replace(/^0x/, ''));
}

/** A fresh secret key, for a client making a root or a delegate. */
export function randomSecretKey(): Uint8Array {
  return secp256k1.utils.randomSecretKey();
}

/** A twelve-word phrase, the backup of a self-held root. */
export function newPhrase(): string {
  return generateMnemonic(wordlist, 128);
}

/** Whether the words are a phrase of the English list, for a client restoring a root. */
export function isPhrase(phrase: string): boolean {
  return validateMnemonic(phrase.trim().toLowerCase(), wordlist);
}

/** The secret key a wallet would derive from this phrase at the standard Ethereum path. */
export function secretKeyFromPhrase(phrase: string, passphrase = ''): Uint8Array {
  const seed = mnemonicToSeedSync(phrase.trim().toLowerCase(), passphrase);
  const key = HDKey.fromMasterSeed(seed).derive(ETH_PATH).privateKey;
  if (!key) throw new Error('no key at the Ethereum path');
  return key;
}

/** The uncompressed public key, sixty-five bytes. */
export function publicKey(secret: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(secret, false);
}

/** EIP-55: the address in mixed case so that a wrong letter is caught. */
export function checksumAddress(hex40: string): Address {
  const lower = hex40.toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(lower)) throw new Error('not forty hex characters');
  const h = bytesToHex(keccak_256(utf8ToBytes(lower)));
  let out = '0x';
  for (let i = 0; i < 40; i++) {
    const c = lower[i]!;
    out += /[a-f]/.test(c) && parseInt(h[i]!, 16) >= 8 ? c.toUpperCase() : c;
  }
  return out as Address;
}

/** The address of a public key, compressed or not, for a client that holds a wallet's key and no secret. */
export function addressFromPublicKey(pub: Uint8Array): Address {
  const uncompressed = pub.length === 65 ? pub : secp256k1.Point.fromBytes(pub).toBytes(false);
  return checksumAddress(bytesToHex(keccak_256(uncompressed.subarray(1)).subarray(12)));
}

/** The address of a secret key: what a client writes as its `key`. */
export function addressOf(secret: Uint8Array): Address {
  return addressFromPublicKey(publicKey(secret));
}

/** An address as the core writes it: forty hex characters with the EIP-55 checksum. */
export function isAddress(s: unknown): s is Address {
  return typeof s === 'string' && ADDRESS_RE.test(s) && checksumAddress(s) === s;
}

/** The EIP-191 personal-message hash: keccak-256 of the prefix, the byte length and the message. */
export function personalHash(message: Uint8Array): Uint8Array {
  return keccak_256(concatBytes(utf8ToBytes(`\x19Ethereum Signed Message:\n${message.length}`), message));
}

/** A recoverable signature over a message, as 0x, r, s and v (27 or 28) in hex. */
export function signMessage(message: Uint8Array, secret: Uint8Array): Signature {
  const recovered = secp256k1.sign(personalHash(message), secret, { prehash: false, lowS: true, format: 'recovered' });
  const rec = recovered[0]!;
  const rs = recovered.subarray(1);
  return `0x${bytesToHex(rs)}${(27 + rec).toString(16)}`;
}

/**
 * Signers already recovered, by signature and the hash of what it signs, which together decide the answer: a tracker
 * reduces every problem it holds again and again, and recovering a key is most of what reducing costs. Emptied once it
 * holds RECOVERED_MAX, so it never grows past that.
 */
const recovered = new Map<string, Address | null>();
const RECOVERED_MAX = 100_000;

/** The address that signed this message, or null when the signature is not one. */
export function recoverAddress(message: Uint8Array, sig: string): Address | null {
  if (!SIG_RE.test(sig)) return null;
  const hash = personalHash(message);
  const key = `${sig}:${bytesToHex(hash)}`;
  const known = recovered.get(key);
  if (known !== undefined) return known;
  const bytes = hexToBytes(sig.slice(2));
  const v = bytes[64]!;
  const rec = v >= 27 ? v - 27 : v;
  let who: Address | null = null;
  if (rec === 0 || rec === 1) {
    try {
      who = addressFromPublicKey(secp256k1.recoverPublicKey(concatBytes(Uint8Array.of(rec), bytes.subarray(0, 64)), hash, { prehash: false }));
    } catch {
      who = null;
    }
  }
  if (recovered.size >= RECOVERED_MAX) recovered.clear();
  recovered.set(key, who);
  return who;
}

/** Whether `sig` over these bytes is `address`'s, for a caller that holds bytes rather than an object. */
export function verifyMessage(message: Uint8Array, sig: string, address: string): boolean {
  const who = recoverAddress(message, sig);
  return who !== null && who === address;
}

/** The fields a signature leaves out of what it covers (section 1): its own, and a rotate's second. */
export const SIGNATURE_FIELDS = ['sig', 'sig_to'] as const;

/** The bytes an object's signature covers: its canonical JSON without the signature fields. */
export function signedBytes(obj: Record<string, unknown>): Uint8Array {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!(SIGNATURE_FIELDS as readonly string[]).includes(k)) copy[k] = v;
  return canonicalBytes(copy);
}

/** The signature of an object by a secret, for a client signing an envelope or an event. */
export function signObject(obj: Record<string, unknown>, secret: Uint8Array): Signature {
  return signMessage(signedBytes(obj), secret);
}

/** Who signed this object's `field`, or null. */
export function recoverSigner(obj: Record<string, unknown>, field: 'sig' | 'sig_to' = 'sig'): Address | null {
  const sig = obj[field];
  if (typeof sig !== 'string') return null;
  return recoverAddress(signedBytes(obj), sig);
}

/** Whether the object's `field` was signed by `address`. */
export function signedBy(obj: Record<string, unknown>, address: string, field: 'sig' | 'sig_to' = 'sig'): boolean {
  return recoverSigner(obj, field) === address;
}

/** Whether a value has a signature's form, for the shape checks; whether it recovers is `recoverSigner`'s question. */
export function isSignature(s: unknown): s is Signature {
  return typeof s === 'string' && SIG_RE.test(s);
}
