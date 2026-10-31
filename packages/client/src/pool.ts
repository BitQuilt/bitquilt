/**
 * Two ways a read that asks the trackers is kept from holding up the person who asked: `inParallel` asks for several
 * problems at once rather than one after another, and `kept` answers from the last read while a fresh one is fetched,
 * with one read under way at a time, so a caller that gives up and asks again does not start a second one.
 */

/** Each item through `f`, at most `width` at a time, the answers in the items' order. */
export async function inParallel<T, R>(items: readonly T[], width: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
  return out;
}

export interface Kept<T> {
  /** The last answer while it is younger than the age given; else the last answer at once, with a fresh read started; else, where there is none yet, the first read's answer, or null where it takes longer than `wait` ms. */
  get(wait: number): Promise<T | null>;
  /** The last answer set aside, for after a write that changes it: the next get reads again. */
  drop(): void;
}

/** A read kept for `ttl` ms, one at a time. A read that fails leaves the last answer as it was. */
export function kept<T>(read: () => Promise<T>, ttl: number, now: () => number = Date.now): Kept<T> {
  let last: { at: number; value: T } | null = null;
  let running: Promise<T> | null = null;
  const start = (): Promise<T> => {
    if (!running) {
      const p = read().then((value) => {
        last = { at: now(), value };
        return value;
      });
      running = p;
      p.then(() => { if (running === p) running = null; }, () => { if (running === p) running = null; });
    }
    return running;
  };
  return {
    async get(wait) {
      if (last && now() - last.at < ttl) return last.value;
      const p = start();
      p.catch(() => undefined);
      if (last) return last.value;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<null>((r) => { timer = setTimeout(() => r(null), wait); });
      try {
        return await Promise.race([p, late]);
      } finally {
        clearTimeout(timer);
      }
    },
    drop() {
      if (last) last = { at: -Infinity, value: last.value };
    },
  };
}
