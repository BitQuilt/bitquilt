/**
 * CORE.md section 1, Forms: canonical JSON is RFC 8785, and a hash is `sha256:` over the UTF-8 bytes of the canonical
 * form. The RFC's own example, the key order, what is refused, and that one value gives one byte string.
 */
import { describe, expect, it } from 'vitest';
import { canonical, canonicalBytes } from '../src/canonical.js';
import { hashCanonical, hashText, isHash } from '../src/hash.js';

describe('canonical JSON (RFC 8785)', () => {
  it('reproduces the RFC\'s own example', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonical(input)).toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
  });
  it('sorts keys by UTF-16 code units, not by locale', () => {
    expect(canonical({ b: 1, a: 2, aa: 3, B: 4 })).toBe('{"B":4,"a":2,"aa":3,"b":1}');
    expect(canonical({ 'é': 1, z: 2 })).toBe('{"z":2,"é":1}');
  });
  it('leaves out undefined properties and refuses what is not JSON', () => {
    expect(canonical({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(() => canonical({ a: NaN })).toThrow(/finite/);
    expect(() => canonical({ a: () => 1 })).toThrow(/not JSON/);
    expect(() => canonical([1, undefined])).toThrow(/undefined/);
    expect(() => canonical(new Date(0))).toThrow(/plain object/);
  });
  it('is the same bytes for the same value whatever the key order', () => {
    const a = canonicalBytes({ x: [1, { q: 'a', p: 'b' }], y: null });
    const b = canonicalBytes({ y: null, x: [1, { p: 'b', q: 'a' }] });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

describe('hashes', () => {
  it('is sha256: and sixty-four hex characters over the canonical bytes', () => {
    const h = hashCanonical({ b: 1, a: 'x' });
    expect(isHash(h)).toBe(true);
    expect(h).toBe(hashCanonical({ a: 'x', b: 1 }));
    expect(hashText('')).toBe('sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
