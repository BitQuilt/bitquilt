/**
 * What the core's tests share: the fixtures' keys and their addresses, a clock in minutes, and a client's `by`. Not a
 * test, and not run by vitest, whose include is the `.test.ts` files under each package's test folder; the tests
 * beside it import it.
 */
import type { Capability } from '../src/envelope.js';
import type { By } from '../src/events.js';
import { type Address, addressOf } from '../src/keys.js';

/** The secret key whose value is `n`: the fixtures' keys are 1 to 12, with 9 the owner (fixtures/README.md). */
export const key = (n: number): Uint8Array => {
  const k = new Uint8Array(32);
  k[31] = n;
  return k;
};

/** The address of a secret key. */
export const addr = (k: Uint8Array): Address => addressOf(k);

/** A clock: `clock(start)(m)` is the ISO time `m` minutes after `start`. */
export const clock = (start: string): ((minutes: number) => string) => {
  const t0 = Date.parse(start);
  return (minutes: number): string => new Date(t0 + minutes * 60_000).toISOString();
};

/** A client's declaration on a claim, a reveal or a run: the model, a fixed client name, and what it can do. */
export const byOf = (model: string, can: Capability[]): By => ({ model, client: 'test/0', can });
