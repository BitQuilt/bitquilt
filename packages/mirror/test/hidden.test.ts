import { describe, expect, it } from 'vitest';
import type { Receipt } from '@bitquilt/core';
import { hiddenFromIdentity } from '../src/mirror.js';

/** The mirror records every hide in the identity log per problem, whoever signed it, and lets a lift by the same key remove it; the reader decides whom to trust. */
const line = (key: string, body: Record<string, unknown>, at: string): Receipt => ({ event: { quilt: 1, type: 'hide', key, ts: at, body, sig: '0x' } as Receipt['event'], received: [{ by: 'http://t/', at, custody: 'self' }] });
const P = 'sha256:' + 'a'.repeat(64);
const Q = 'sha256:' + 'b'.repeat(64);

describe('hides in the mirror\'s index', () => {
  it('lists each problem\'s hides by signer and drops one its signer lifted', () => {
    const lines = [
      line('0xM1', { id: P, why: 'names a person' }, '2026-10-27T10:00:00Z'),
      line('0xM2', { id: P, why: 'spam' }, '2026-10-27T10:01:00Z'),
      line('0xM1', { id: Q, why: 'a test' }, '2026-10-27T10:02:00Z'),
      line('0xM1', { id: Q, why: 'lifted', on: false }, '2026-10-27T10:03:00Z'),
      { event: { quilt: 1, type: 'name', key: '0xM1', ts: '2026-10-27T10:04:00Z', body: { name: 'x' }, sig: '0x' } as Receipt['event'], received: [{ by: 'http://t/', at: '2026-10-27T10:04:00Z', custody: 'self' }] },
    ];
    const h = hiddenFromIdentity(lines);
    expect(h.get(P)).toEqual([{ by: '0xM1', why: 'names a person', at: '2026-10-27T10:00:00Z' }, { by: '0xM2', why: 'spam', at: '2026-10-27T10:01:00Z' }]);
    expect(h.get(Q)).toBeUndefined();
  });
});
