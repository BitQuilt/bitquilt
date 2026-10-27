import { describe, expect, it } from 'vitest';
import type { Receipt } from '@bitquilt/core';
import { hiddenFromIdentity, keysFromIdentity } from '../src/identity.js';

/**
 * The folds over the identity log: the mirror records every hide per problem, whoever signed it, and lets a lift by
 * the same key remove it, the reader deciding whom to trust; and keys.json carries each address's latest name, whether
 * it is an agent on its own, and the delegations in force, an expired one dropped and a revoked one removed by `of`.
 */
const line = (key: string, type: string, body: Record<string, unknown>, at: string): Receipt => ({ event: { quilt: 1, type, key, ts: at, body, sig: '0x' } as Receipt['event'], received: [{ by: 'http://t/', at, custody: 'self' }] });
const hide = (key: string, body: Record<string, unknown>, at: string): Receipt => line(key, 'hide', body, at);
const P = 'sha256:' + 'a'.repeat(64);
const Q = 'sha256:' + 'b'.repeat(64);

describe('hides in the mirror\'s index', () => {
  it('lists each problem\'s hides by signer and drops one its signer lifted', () => {
    const lines: Receipt[] = [
      hide('0xM1', { id: P, why: 'names a person' }, '2026-10-27T10:00:00Z'),
      hide('0xM2', { id: P, why: 'spam' }, '2026-10-27T10:01:00Z'),
      hide('0xM1', { id: Q, why: 'a test' }, '2026-10-27T10:02:00Z'),
      hide('0xM1', { id: Q, why: 'lifted', on: false }, '2026-10-27T10:03:00Z'),
      line('0xM1', 'name', { name: 'x' }, '2026-10-27T10:04:00Z'),
    ];
    const h = hiddenFromIdentity(lines);
    expect(h.get(P)).toEqual([{ by: '0xM1', why: 'names a person', at: '2026-10-27T10:00:00Z' }, { by: '0xM2', why: 'spam', at: '2026-10-27T10:01:00Z' }]);
    expect(h.get(Q)).toBeUndefined();
  });
});

describe('keys from the identity log', () => {
  it('keeps each address\'s latest name and agent mark, drops a delegation past its expiry, and removes one revoked by `of`', () => {
    const lines: Receipt[] = [
      line('0xM1', 'name', { name: 'Maya' }, '2026-10-27T10:00:00Z'),
      line('0xM1', 'name', { name: 'May' }, '2026-10-27T10:01:00Z'),
      line('0xM1', 'delegate', { to: '0xA1', scope: ['return'], expires: '2026-10-28T00:00:00Z' }, '2026-10-27T10:02:00Z'),
      line('0xM1', 'delegate', { to: '0xA2', scope: ['return'], expires: '2026-10-27T09:00:00Z' }, '2026-10-27T10:03:00Z'),
      line('0xM1', 'delegate', { to: '0xA3', scope: ['return', 'challenge'], expires: '2026-10-28T00:00:00Z' }, '2026-10-27T10:04:00Z'),
      line('0xM1', 'revoke', { of: '0xA3' }, '2026-10-27T10:05:00Z'),
      line('0xM2', 'name', { name: 'Loom', agent: true }, '2026-10-27T10:06:00Z'),
    ];
    const keys = keysFromIdentity(lines, '2026-10-27T12:00:00Z');
    expect(keys['0xM1']).toEqual({ name: 'May', delegates: [{ to: '0xA1', scope: ['return'], expires: '2026-10-28T00:00:00Z' }] });
    expect(keys['0xM2']).toEqual({ name: 'Loom', agent: true, delegates: [] });
    expect(Object.keys(keys)).toEqual(['0xM1', '0xM2']);
  });
});
