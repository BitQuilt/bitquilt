/**
 * CORE.md section 4, the event line, and section 6, Roots and delegates: the roots the fold keeps in roots.ts. A
 * delegate, a revoke and a rotate each give back the reason the fold drops it, or null when it is kept, and what is
 * kept changes the root a key counts for. The fold in reduce.ts still names every core type in its own case, so a
 * reader of section 6 finds each where it is folded. The fixtures and reduce.test.ts hold the same rules through the
 * reducer; this file holds them at the class.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CORE_EVENT_TYPES, type Event, type Unsigned, signEvent } from '../src/events.js';
import { signObject } from '../src/keys.js';
import { Roots } from '../src/roots.js';
import { addr, clock, key } from './helpers.js';

const A = key(1),
  B = key(2),
  C = key(3),
  B1 = key(10),
  A2 = key(11),
  Z = key(12),
  A3 = key(13);
const t = clock('2026-10-24T18:00:00Z');
const NOT_DELEGATE = "revokes a key that is not this root's delegate";

/** An event of `type` signed by `k` at `at`. */
const ev = (k: Uint8Array, type: string, at: string, body: Record<string, unknown>): Event =>
  signEvent({ quilt: 1, type, key: addr(k), ts: at, body }, k);

/** A rotate from `from` to `to`, its second signature made by `signer`. */
function rotate(from: Uint8Array, to: Uint8Array, signer: Uint8Array, at: string): Event {
  const unsigned: Unsigned = { quilt: 1, type: 'rotate', key: addr(from), ts: at, body: { to: addr(to) } };
  return signEvent({ ...unsigned, sig_to: signObject(unsigned, signer) }, from);
}

describe('the roots', () => {
  it('keeps a delegation, and counts the delegate for its root within its scope while it lives', () => {
    const roots = new Roots();
    const delegate = ev(B, 'delegate', t(0), { to: addr(B1), scope: ['claim', 'delegate'], expires: t(60) });
    expect(roots.delegate(delegate, t(0))).toBe(null);
    expect(roots.delegations).toHaveLength(1);
    expect(roots.standing(addr(B1), 'claim', t(30))).toEqual({ root: addr(B) });
    expect(roots.standing(addr(B1), 'reveal', t(30))).toEqual({ why: 'the delegation does not cover this event' });
    expect(roots.standing(addr(B1), 'delegate', t(30))).toEqual({ why: 'a delegate is signed by a root' });
    expect(roots.rootOf(addr(B1), t(90))).toBe(addr(B1));
  });

  it("drops a delegate to a key with a prior event, and to another root's delegate", () => {
    const roots = new Roots();
    roots.prior.add(addr(B1));
    const body = { to: addr(B1), scope: ['claim'], expires: t(60) };
    expect(roots.delegate(ev(B, 'delegate', t(0), body), t(0))).toBe('the delegate has a prior event');
    const fresh = new Roots();
    expect(fresh.delegate(ev(B, 'delegate', t(0), body), t(0))).toBe(null);
    expect(fresh.delegate(ev(C, 'delegate', t(1), body), t(1))).toBe("the delegate is another root's");
    expect(fresh.delegations.map((d) => d.root)).toEqual([addr(B)]);
  });

  it("ends a delegation at the revoke, and drops a revoke of a key that is not the root's delegate", () => {
    const roots = new Roots();
    roots.delegate(ev(B, 'delegate', t(0), { to: addr(B1), scope: ['claim'], expires: t(600) }), t(0));
    expect(roots.revoke(ev(C, 'revoke', t(5), { of: addr(B1) }), t(5))).toBe(NOT_DELEGATE);
    expect(roots.revoke(ev(B, 'revoke', t(10), { of: addr(B1) }), t(10))).toBe(null);
    expect(roots.delegations[0]!.revokedAt).toBe(t(10));
    expect(roots.rootOf(addr(B1), t(5))).toBe(addr(B));
    expect(roots.rootOf(addr(B1), t(20))).toBe(addr(B1));
    expect(roots.revoke(ev(B, 'revoke', t(15), { of: addr(B1) }), t(15))).toBe(NOT_DELEGATE);
  });

  it('keeps a rotate whose second signature is the new root, and gives the new root a prior event', () => {
    const roots = new Roots();
    expect(roots.rotate(rotate(A, A2, Z, t(0)))).toBe('sig_to does not recover to the new root');
    expect(roots.rotations.size).toBe(0);
    expect(roots.rotate(rotate(A, A2, A2, t(1)))).toBe(null);
    expect(roots.rotations.get(addr(A))).toBe(addr(A2));
    expect(roots.hasPrior(addr(A2))).toBe(true);
    expect(roots.rootOf(addr(A), t(2))).toBe(addr(A2));
    expect(roots.rotate(rotate(C, A2, A2, t(2)))).toBe('the new root has a prior event');
  });

  it("drops a rotate to another root's delegate", () => {
    const roots = new Roots();
    roots.delegate(ev(B, 'delegate', t(0), { to: addr(B1), scope: ['claim'], expires: t(600) }), t(0));
    expect(roots.rotate(rotate(A, B1, B1, t(1)))).toBe("the new root is another root's delegate");
    expect(roots.rotations.size).toBe(0);
  });

  it("lets the new root revoke the old one: the old key then signs nothing, and its root stays the new one's", () => {
    const roots = new Roots();
    roots.rotate(rotate(A, A2, A2, t(0)));
    expect(roots.standing(addr(A), 'claim', t(1))).toEqual({ root: addr(A2) });
    expect(roots.revoke(ev(B, 'revoke', t(2), { of: addr(A) }), t(2))).toBe(NOT_DELEGATE);
    expect(roots.revoke(ev(A2, 'revoke', t(2), { of: addr(A) }), t(2))).toBe(null);
    expect(roots.rotationRevoked.has(addr(A))).toBe(true);
    expect(roots.standing(addr(A), 'claim', t(3))).toEqual({ why: 'the delegation does not cover this event' });
    expect(roots.final(addr(A))).toBe(addr(A2));
  });

  it('after two rotations, the root at the end revokes the first key, and the key between them does not', () => {
    const roots = new Roots();
    roots.rotate(rotate(A, A2, A2, t(0)));
    roots.rotate(rotate(A2, A3, A3, t(1)));
    expect(roots.final(addr(A))).toBe(addr(A3));
    expect(roots.standing(addr(A2), 'revoke', t(2))).toEqual({ why: 'a revoke is signed by a root' });
    expect(roots.revoke(ev(A2, 'revoke', t(2), { of: addr(A) }), t(2))).toBe(NOT_DELEGATE);
    expect(roots.rotationRevoked.has(addr(A))).toBe(false);
    expect(roots.revoke(ev(A3, 'revoke', t(3), { of: addr(A) }), t(3))).toBe(null);
    expect(roots.rotationRevoked.has(addr(A))).toBe(true);
    expect(roots.standing(addr(A), 'claim', t(4))).toEqual({ why: 'the delegation does not cover this event' });
    expect(roots.standing(addr(A2), 'claim', t(4))).toEqual({ root: addr(A3) });
  });
});

describe('the fold', () => {
  it('names every core type in its own case', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'reduce.ts'), 'utf8');
    const fold = source.slice(source.indexOf('function fold('), source.indexOf('function settle('));
    expect(fold.length).toBeGreaterThan(0);
    expect(CORE_EVENT_TYPES.filter((type) => !fold.includes(`case '${type}':`))).toEqual([]);
  });
});
