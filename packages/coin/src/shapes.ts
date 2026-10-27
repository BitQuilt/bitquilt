/**
 * The field checks the home's answers go through before a job signs or sends anything: a hash of 64 hex characters,
 * an address, a whole number of at least a floor, and a line of named fields checked in order. Each refusal names the
 * line and the field ("redeem 1 has no address to mint to"), so a test and a bin's output read the same. An address is
 * taken in any case: the tracker serves addresses checksummed, the chain door answers them checksummed too, and
 * wherever two are compared they are lowercased first, so the case carries nothing.
 */
import { isRecord } from '@bitquilt/core';

/** A coin log line's hash as the home serves it: 64 lowercase hex characters, the `sha256:` of the core's hashes taken off. */
export const HEX64_RE = /^[0-9a-f]{64}$/;
/** An address: 0x and 40 hex characters, in any case. */
export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** A private key or a ledger secret as the environment carries it, the 0x already taken off: 64 hex characters in any case. */
export const KEY_HEX_RE = /^[0-9a-fA-F]{64}$/;

/** `v` as a hash of 64 lowercase hex characters, or a refusal naming the line and the field. */
export function hex64(v: unknown, at: string, what: string): string {
  if (typeof v !== 'string' || !HEX64_RE.test(v)) throw new Error(`${at} has no ${what} of 64 lowercase hex characters`);
  return v;
}

/** `v` as an address, in any case, or a refusal naming the line and the field. */
export function address(v: unknown, at: string, what: string): string {
  if (typeof v !== 'string' || !ADDRESS_RE.test(v)) throw new Error(`${at} has no ${what}`);
  return v;
}

/** `v` as a whole number of at least `min`, or a refusal naming the line and the field. */
export function wholeNumber(v: unknown, at: string, what: string, min: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) throw new Error(`${at} has no ${what}`);
  return v;
}

/** One line of the home's answer: an object whose named fields each pass their check, in the order given, so the first wrong field is the one refused. */
export function checkLine<T>(x: unknown, at: string, fields: { [K in keyof T]: (v: unknown, at: string) => T[K] }): T {
  if (!isRecord(x)) throw new Error(`${at} is not an object`);
  const line = {} as T;
  for (const k of Object.keys(fields) as (keyof T & string)[]) line[k] = fields[k](x[k], at);
  return line;
}
