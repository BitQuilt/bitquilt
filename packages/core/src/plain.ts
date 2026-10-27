/**
 * Small pure helpers every package reaches for: the shape checks a body validator starts with, the hour arithmetic
 * the leases and windows use, the trailing slash a tracker's address carries, and the order receipts are read in.
 * They are here, in the core, because the core is the one package every other one depends on; nothing in them reads
 * a clock, the network, a file or the environment, as AGENTS.md asks of the core.
 */

/** A plain object: not null, not an array. What every body check asks first. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A whole number of at least `min`. */
export const whole = (v: unknown, min: number): v is number => Number.isInteger(v) && (v as number) >= min;

/** A string `Date.parse` reads: the ISO times the ledger carries. */
export const isTime = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s));

/** The ISO time `h` hours after `t`: a lease's end, a window's close, a commitment's abandonment. */
export const plusHours = (t: string, h: number): string => new Date(Date.parse(t) + h * 3_600_000).toISOString();

/** A tracker's address as the links and the configuration carry it, with one trailing slash. */
export const withSlash = (url: string): string => (url.endsWith('/') ? url : `${url}/`);

/** The order receipts are read in wherever two carry the same time: by time, then by id. */
export const byAtThenId = <T extends { at: string; id: string }>(a: T, b: T): number => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
