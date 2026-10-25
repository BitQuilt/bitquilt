import { describe, expect, it } from 'vitest';
import { addressOf, checksumAddress, isAddress, isPhrase, newPhrase, randomSecretKey, recoverAddress, recoverSigner, secretKeyFromPhrase, signMessage, signObject, signedBy, verifyMessage } from '../src/keys.js';

const one = new Uint8Array(32);
one[31] = 1;

describe('keys and signatures', () => {
  it('derives the address a wallet would, with the EIP-55 checksum', () => {
    expect(addressOf(one)).toBe('0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf');
    for (const a of ['0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed', '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359', '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB', '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb']) {
      expect(checksumAddress(a.toLowerCase())).toBe(a);
      expect(isAddress(a)).toBe(true);
      expect(isAddress(a.toLowerCase())).toBe(false);
    }
  });
  it('derives the standard Ethereum path from a phrase', () => {
    const phrase = 'test test test test test test test test test test test junk';
    expect(isPhrase(phrase)).toBe(true);
    expect(addressOf(secretKeyFromPhrase(phrase))).toBe('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266');
    expect(isPhrase(newPhrase())).toBe(true);
    expect(newPhrase().split(' ')).toHaveLength(12);
    expect(isPhrase('not a phrase at all')).toBe(false);
  });
  it('signs in the personal-message form and recovers the signer', () => {
    const secret = randomSecretKey();
    const me = addressOf(secret);
    const msg = new TextEncoder().encode('hello');
    const sig = signMessage(msg, secret);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
    expect(recoverAddress(msg, sig)).toBe(me);
    expect(verifyMessage(msg, sig, me)).toBe(true);
    expect(verifyMessage(new TextEncoder().encode('hellp'), sig, me)).toBe(false);
    expect(recoverAddress(msg, '0x' + '00'.repeat(65))).toBeNull();
    expect(recoverAddress(msg, 'nonsense')).toBeNull();
  });
  it('signs an object without its signature fields, whatever the key order', () => {
    const secret = randomSecretKey();
    const me = addressOf(secret);
    const event: Record<string, unknown> = { quilt: 1, type: 'claim', key: me, body: { by: { model: 'human' } }, ts: '2026-10-24T00:00:00Z' };
    event.sig = signObject(event, secret);
    expect(recoverSigner(event)).toBe(me);
    expect(signedBy({ ts: event.ts, body: event.body, key: me, type: 'claim', quilt: 1, sig: event.sig }, me)).toBe(true);
    expect(signedBy({ ...event, type: 'commit' }, me)).toBe(false);
    const rotate: Record<string, unknown> = { quilt: 1, type: 'rotate', key: me, body: { to: addressOf(one) }, ts: event.ts };
    rotate.sig_to = signObject(rotate, one);
    rotate.sig = signObject(rotate, secret);
    expect(recoverSigner(rotate, 'sig')).toBe(me);
    expect(recoverSigner(rotate, 'sig_to')).toBe(addressOf(one));
  });
});
