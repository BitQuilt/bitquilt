import { describe, expect, it } from 'vitest';
import { inParallel, kept } from '../src/pool.js';

/**
 * The two helpers that keep the menu bar's reads from waiting on the trackers (pool.ts): several problems asked at once
 * with their order kept, and the last answer kept and served while one fresh read at a time is under way.
 */
const later = <T>(ms: number, value: T) => new Promise<T>((r) => setTimeout(() => r(value), ms));

describe('inParallel', () => {
  it('keeps the order of the items and never runs more than the width at once', async () => {
    let now = 0;
    let most = 0;
    const out = await inParallel([30, 10, 20, 5, 15], 2, async (ms) => {
      now += 1;
      most = Math.max(most, now);
      await later(ms, null);
      now -= 1;
      return ms * 2;
    });
    expect(out).toEqual([60, 20, 40, 10, 30]);
    expect(most).toBe(2);
  });

  it('answers an empty list with an empty list', async () => {
    expect(await inParallel([], 4, async () => 1)).toEqual([]);
  });
});

describe('kept', () => {
  it('answers null when the first read is slower than the wait, and has the answer for the next ask', async () => {
    let reads = 0;
    const k = kept(async () => { reads += 1; return later(40, `read ${reads}`); }, 60_000);
    expect(await k.get(5)).toBeNull();
    // The caller gave up and asks again: no second read starts.
    expect(await k.get(5)).toBeNull();
    await later(60, null);
    expect(await k.get(5)).toBe('read 1');
    expect(reads).toBe(1);
  });

  it('serves the last answer at once once it is old, and reads afresh behind it, one read at a time', async () => {
    let clock = 0;
    let reads = 0;
    const k = kept(async () => { reads += 1; return later(20, reads); }, 1000, () => clock);
    expect(await k.get(1000)).toBe(1);
    clock = 500;
    expect(await k.get(1000)).toBe(1);
    expect(reads).toBe(1);
    clock = 2000;
    expect(await k.get(1000)).toBe(1);
    expect(await k.get(1000)).toBe(1);
    expect(reads).toBe(2);
    await later(40, null);
    expect(await k.get(1000)).toBe(2);
  });

  it('reads again after drop, serving the last answer meanwhile', async () => {
    let reads = 0;
    const k = kept(async () => { reads += 1; return reads; }, 60_000);
    expect(await k.get(1000)).toBe(1);
    k.drop();
    expect(await k.get(1000)).toBe(1);
    await later(5, null);
    expect(await k.get(1000)).toBe(2);
  });

  it('keeps the last answer when a read fails, and tries again on the next ask', async () => {
    let clock = 0;
    let fail = false;
    let reads = 0;
    const k = kept(async () => { reads += 1; if (fail) throw new Error('tracker down'); return 'good'; }, 1000, () => clock);
    expect(await k.get(1000)).toBe('good');
    fail = true;
    clock = 5000;
    expect(await k.get(1000)).toBe('good');
    await later(5, null);
    expect(await k.get(1000)).toBe('good');
    expect(reads).toBe(3);
  });
});
