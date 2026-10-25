/**
 * The stamp (CORE.md section 11, extension QX-7): a `nonce` on an event that makes its id have at least the number of
 * leading zero bits a tracker asks for. Cost without identity, at a tracker's door. The reducer ignores it.
 */
import { eventId, type Unsigned } from './events.js';
import { hashHex, type Hash } from './hash.js';

/** How many leading zero bits a hash has. */
export function leadingZeroBits(h: Hash): number {
  const hex = hashHex(h);
  let bits = 0;
  for (const c of hex) {
    const v = parseInt(c, 16);
    if (v === 0) {
      bits += 4;
      continue;
    }
    bits += Math.clz32(v) - 28;
    break;
  }
  return bits;
}

/** Whether the event's id meets the difficulty. An event with no nonce meets difficulty 0 only. */
export function stampOk(e: Unsigned, difficulty: number): boolean {
  if (difficulty <= 0) return true;
  if (e.nonce === undefined) return false;
  return leadingZeroBits(eventId(e)) >= difficulty;
}

/** The event with a nonce that meets the difficulty, found by counting; or null within `maxTries`. Sign after stamping. */
export function stamp(e: Unsigned, difficulty: number, maxTries = 1 << 22): Unsigned | null {
  for (let i = 0; i < maxTries; i++) {
    const nonce = i.toString(16).padStart(32, '0');
    const candidate = { ...e, nonce };
    if (leadingZeroBits(eventId(candidate)) >= difficulty) return candidate;
  }
  return null;
}
