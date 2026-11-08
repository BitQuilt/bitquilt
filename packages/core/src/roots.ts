/**
 * Roots, delegates and rotations (CORE.md section 4, the event line, and section 6, Roots and delegates). The fold in
 * reduce.ts keeps one `Roots` and asks it the root each event counts for; its `delegate`, `revoke` and `rotate` cases
 * hand the event here and drop it for the reason given back. Pure, like the rest of the core. The package exports
 * `Delegation` and not `Roots`: a client reads the roots through the state's `rootOf`, `related`, `delegations` and
 * `rotations`.
 */
import { type Event, ROOT_ONLY_TYPES, rotateSecondSigner } from './events.js';
import type { Address } from './keys.js';

export interface Delegation {
  root: Address;
  to: Address;
  scope: Set<string>;
  since: string;
  expires: string;
  revokedAt: string | null;
}

/** Roots, delegates and rotations as the fold builds them (section 6, Roots and delegates). */
export class Roots {
  readonly delegations: Delegation[] = [];
  readonly rotations = new Map<Address, Address>();
  /**
   * Old roots whose new root has revoked them (section 4: "the old root is a delegate of the new until revoked"); what
   * they did stays the new root's.
   */
  readonly rotationRevoked = new Set<Address>();
  /**
   * Every key with a prior event (section 4): one whose core event passed shape, signature and standing, and one a kept
   * rotate named as `to`.
   */
  readonly prior = new Set<Address>();

  hasPrior(key: Address): boolean {
    return this.prior.has(key);
  }

  /** Whether the key has been delegated to or rotated from: then it is no root. */
  isDelegateOfAnyone(key: Address): boolean {
    return this.delegations.some((d) => d.to === key) || this.rotations.has(key);
  }

  /** Whether a delegation stands at `at`: begun by then, not yet expired, and not revoked by then. */
  private live(d: Delegation, at: string): boolean {
    return d.since <= at && d.expires > at && (d.revokedAt === null || d.revokedAt > at);
  }

  /** The delegation under which `key` may sign `type` at `at`, or null. */
  liveDelegation(key: Address, type: string, at: string): Delegation | null {
    for (const d of this.delegations) if (d.to === key && this.live(d, at) && d.scope.has(type)) return d;
    return null;
  }

  /** The root `key` counts for at `at`: through a live delegation of any scope, or through a rotation, or itself. */
  rootOf(key: Address, at: string): Address {
    for (const d of this.delegations) if (d.to === key && this.live(d, at)) return this.final(d.root);
    const rotated = this.rotations.get(key);
    return rotated ? this.final(rotated) : key;
  }

  /**
   * The standing of `key` to sign an event of `type` at `at`: the root it counts for, or why it counts for nobody
   * (section 6, Roots and delegates, and the Drop list). A delegate signs within its scope; a root rotated from is a
   * delegate of the new root for every type (section 4); neither signs what only a root signs.
   */
  standing(key: Address, type: string, at: string): { root: Address } | { why: string } {
    const d = this.liveDelegation(key, type, at);
    const rotated = this.rotationRevoked.has(key) ? undefined : this.rotations.get(key);
    if ((d || rotated) && ROOT_ONLY_TYPES.includes(type)) return { why: `a ${type} is signed by a root` };
    if (d) return { root: this.final(d.root) };
    if (rotated) return { root: this.final(rotated) };
    if (this.isDelegateOfAnyone(key)) return { why: 'the delegation does not cover this event' };
    return { root: key };
  }

  /** The root `root` has become through rotations. */
  final(root: Address): Address {
    let r = root;
    const guard = new Set<Address>();
    while (this.rotations.has(r) && !guard.has(r)) {
      guard.add(r);
      r = this.rotations.get(r)!;
    }
    return r;
  }

  /**
   * Whether two roots are the same, or one a delegate of the other, as judged at `at` (section 6: "with delegations as
   * live then and rotations as they stand at the end of the fold"). The fold asks about the roots events counted for,
   * which are never delegate keys, so the delegation branch answers `next`, which asks about a key's own address once
   * its delegation has run out.
   */
  related(a: Address, b: Address, at: string): boolean {
    if (this.final(a) === this.final(b)) return true;
    for (const d of this.delegations) {
      if (!this.live(d, at)) continue;
      if ((d.to === a && this.final(d.root) === this.final(b)) || (d.to === b && this.final(d.root) === this.final(a)))
        return true;
    }
    return false;
  }

  /**
   * A `delegate` the fold has let through, received at `at` (section 4, and section 6, Drop): kept when `to` has no
   * prior event and is no other root's delegate. The reason it is dropped, or null when it is kept.
   */
  delegate(e: Event, at: string): string | null {
    const body = e.body as Record<string, unknown>;
    const to = body.to as Address;
    if (this.hasPrior(to)) return 'the delegate has a prior event';
    if (this.isDelegateOfAnyone(to)) return "the delegate is another root's";
    this.delegations.push({
      root: e.key,
      to,
      scope: new Set(body.scope as string[]),
      since: at,
      expires: body.expires as string,
      revokedAt: null,
    });
    return null;
  }

  /**
   * A `revoke` the fold has let through, received at `at` (section 4): it ends the signer's unrevoked delegations to
   * `of`, and revokes a rotated `of` where the signer is the root `of` has become through all its rotations. After one
   * rotation that is the key `of` was rotated to; after more, it is the last. The reason it is dropped, or null when it
   * revoked one.
   */
  revoke(e: Event, at: string): string | null {
    const body = e.body as Record<string, unknown>;
    const of = body.of as Address;
    let any = false;
    for (const d of this.delegations)
      if (d.root === e.key && d.to === of && d.revokedAt === null) {
        d.revokedAt = at;
        any = true;
      }
    // Section 4: "the old root is a delegate of the new until revoked". The root the old key now counts for revokes it.
    const rotatedTo = this.rotations.get(of);
    if (rotatedTo !== undefined && this.final(rotatedTo) === e.key && !this.rotationRevoked.has(of)) {
      this.rotationRevoked.add(of);
      any = true;
    }
    if (!any) return "revokes a key that is not this root's delegate";
    return null;
  }

  /**
   * A `rotate` the fold has let through (section 4, and section 6, Drop): kept when `sig_to` recovers to `to`, and `to`
   * has no prior event and is no other root's delegate. The reason it is dropped, or null when it is kept.
   */
  rotate(e: Event): string | null {
    const body = e.body as Record<string, unknown>;
    const to = body.to as Address;
    if (rotateSecondSigner(e) !== to) return 'sig_to does not recover to the new root';
    if (this.hasPrior(to)) return 'the new root has a prior event';
    if (this.isDelegateOfAnyone(to)) return "the new root is another root's delegate";
    this.rotations.set(e.key, to);
    // Section 4: a key has a prior event "once a kept rotate names it as to".
    this.prior.add(to);
    return null;
  }
}
