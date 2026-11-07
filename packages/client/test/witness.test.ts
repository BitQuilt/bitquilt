/**
 * QX-18 as the client reads and says it: the witness on each reveal, by piece and key, from the first wrapper that
 * names one; a mark that is not a host name in lower case or `other` left out, and a client's name that does not pass
 * the gate left out while its `other` stays; a claim's mark not read as a return's; the words beside a signer's name,
 * a product's host for a product and the client's own name quoted for another; and the line quilt_me gives a hosted
 * session, which describes.
 */
import { describe, expect, it } from 'vitest';
import type { Hash, Receipt } from '@bitquilt/core';
import { sessionWitnessText, witnessKey, witnessWords, witnessesOf } from '../src/render.js';
import { instructs } from './helpers.js';

const P = `sha256:${'1'.repeat(64)}` as Hash;
const piece = (n: number) => `sha256:${String(n).repeat(64)}` as Hash;
const KEY = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';
const line = (type: string, at: Hash, key: string, ...received: Record<string, unknown>[]): Receipt => ({
  event: {
    quilt: 1,
    type,
    problem: P,
    piece: at,
    key: key as Receipt['event']['key'],
    ts: '2026-11-01T10:00:00.000Z',
    body: {},
    sig: '0x' as Receipt['event']['sig'],
  },
  received: received.map((r) => ({ by: 'http://t/', at: '2026-11-01T10:00:00.000Z', ...r })) as Receipt['received'],
});

describe('the witness as the client reads it (QX-18)', () => {
  it('keeps a well-formed mark on each reveal and leaves out the rest', () => {
    const w = witnessesOf([
      line('reveal', piece(2), KEY, { custody: 'hosted', via: 'claude.ai', via_by: 'address' }),
      line('reveal', piece(3), KEY, { custody: 'hosted', via: 'other', via_client: 'Acme Agent', via_by: 'key' }),
      line('reveal', piece(4), KEY, { custody: 'hosted', via: 'other', via_client: 'see https://evil.example' }),
      line('reveal', piece(5), KEY, { custody: 'hosted', via: 'Claude.AI!' }),
      line('claim', piece(6), KEY, { custody: 'hosted', via: 'claude.ai' }),
      line('reveal', piece(7), KEY, { custody: 'self' }, { custody: 'hosted', via: 'chatgpt.com', via_by: 'key' }),
      line('reveal', piece(8), KEY, { custody: 'hosted', via: 'chatgpt.com', via_by: 'magic' }),
    ]);
    expect(w.get(witnessKey(piece(2), KEY))).toEqual({ via: 'claude.ai', client: null, by: 'address' });
    expect(w.get(witnessKey(piece(3), KEY.toLowerCase()))).toEqual({ via: 'other', client: 'Acme Agent', by: null });
    expect(w.get(witnessKey(piece(4), KEY))).toEqual({ via: 'other', client: null, by: null });
    expect(w.has(witnessKey(piece(5), KEY))).toBe(false);
    expect(w.has(witnessKey(piece(6), KEY))).toBe(false);
    expect(w.get(witnessKey(piece(7), KEY))).toEqual({ via: 'chatgpt.com', client: null, by: 'key' });
    expect(w.get(witnessKey(piece(8), KEY))).toEqual({ via: 'chatgpt.com', client: null, by: null });
  });

  it('says a product by its host and another client by its own name, quoted, and describes in quilt_me', () => {
    expect(witnessWords({ via: 'claude.ai', client: null })).toBe('witnessed by claude.ai');
    expect(witnessWords({ via: 'other', client: 'Acme Agent' })).toBe(
      'through a client that calls itself "Acme Agent"',
    );
    expect(witnessWords({ via: 'other', client: null })).toBe('through a client that gave no name');
    expect(witnessWords(null)).toBe('');
    const product = sessionWitnessText({ via: 'chatgpt.com', client: null, by: 'key' });
    expect(product).toMatch(/^Witnessed by chatgpt\.com: /);
    expect(product).toContain('signed with the key chatgpt.com publishes');
    expect(product).toContain('not who wrote the answer');
    expect(sessionWitnessText({ via: 'claude.ai', client: null, by: 'address' })).toContain(
      'came from the addresses claude.ai publishes for its servers',
    );
    expect(sessionWitnessText({ via: 'claude.ai', client: null })).not.toContain(', and the token request');
    const other = sessionWitnessText({ via: 'other', client: 'Acme Agent' });
    expect(other).toMatch(/^Witness: none\. /);
    expect(other).toContain('calls itself "Acme Agent"');
    for (const text of [product, other]) expect(text).not.toMatch(instructs);
  });
});
