/**
 * Sortition, QX-1 sections 4 and 5, shared by the challenge window (challenge.ts) and the judge panels (verifiers.ts):
 * the draw order over a pool from a seed no one party makes alone, and the seats offered down that order, lapsing by
 * the lease and passing to the next root not yet offered one. The decision loops stay with their callers: a verdict
 * decides a challenge, a rank decides a panel.
 */
import { type Address, hashCanonical, plusHours } from '@bitquilt/core';

/** What a seat holds whatever it is for: who sits, when it was offered, and when it lapsed, null while it is open. */
export interface Seated { root: Address; offeredAt: string; lapsedAt: string | null }

/** The pool sorted ascending by `sha256(canonical([seed, address]))` (QX-1 section 4). */
export function drawOrder(seed: string, pool: Address[]): Address[] {
  return [...pool].sort((a, b) => {
    const ha = hashCanonical([seed, a]);
    const hb = hashCanonical([seed, b]);
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

/**
 * The seats over a draw order (QX-1 section 5): the first `n` roots are offered a seat at `offeredAt`; `advance(to)`
 * lapses every open seat whose lease has run out by `to`, and at each lapse offers a seat to the next root in the
 * order not yet offered one. `seat` makes a seat of the shape the view keeps; `answered` says whether a seat has given
 * its verdict or rank. `ranOut()` is true once the order is spent and every seat has answered or lapsed, which is when
 * a panel is void, at `lastLapse()`.
 */
export function offerSeats<S extends Seated>(
  order: Address[], n: number, offeredAt: string, leaseH: number, seat: (root: Address, offeredAt: string) => S, answered: (s: S) => boolean,
): { seats: S[]; advance(to: string): void; ranOut(): boolean; lastLapse(): string | null } {
  const seats: S[] = [];
  for (const root of order.slice(0, n)) seats.push(seat(root, offeredAt));
  let nextIdx = Math.min(n, order.length);
  const advance = (to: string) => {
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i]!;
      if (answered(s) || s.lapsedAt !== null) continue;
      const lapse = plusHours(s.offeredAt, leaseH);
      if (lapse > to) continue;
      s.lapsedAt = lapse;
      if (nextIdx < order.length) seats.push(seat(order[nextIdx++]!, lapse));
    }
  };
  const ranOut = () => nextIdx >= order.length && seats.every((s) => answered(s) || s.lapsedAt !== null);
  const lastLapse = () => seats.reduce<string | null>((m, s) => (s.lapsedAt !== null && (m === null || s.lapsedAt > m) ? s.lapsedAt : m), null);
  return { seats, advance, ranOut, lastLapse };
}
