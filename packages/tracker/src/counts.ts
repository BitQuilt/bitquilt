/**
 * The launch funnel, counted by the UTC day (docs/JOURNEY-AUDIT.md section 3, item 9), with no HTTP in it. Numbers
 * with nobody in them: the addresses the hosted on-ramp handed out, first used and taken home, from the times the
 * members table keeps; the keys whose first event on a problem log here fell on the day, through the hosted connector
 * or on a key of their own by the receipt's custody mark; the claims and reveals received; the sets accepted, from the
 * layer's fold with struck events left out; the squares the owner's gold verified (QX-16), by the reveal's receipt. No
 * address, name, token or hash goes into the answer, so the route that serves it is public: the counts say how the
 * launch is going and nothing about anyone. Each is a function of the store at now and is computed on request, as the
 * layer is.
 */
import type { Receipt } from '@bitquilt/core';
import type { Layer } from './challenge.js';

/** The window a `days` query asks for when it says nothing, and the most it may ask. */
export const DAYS_DEFAULT = 30;
export const DAYS_MAX = 365;
const DAY_MS = 86_400_000;

/** When a hosted member was made, first used and took the key home, and nothing else about them. */
export interface MemberTimes { createdAt: string; firstUsedAt: string | null; keyTakenAt: string | null }

export interface FunnelInput {
  members: MemberTimes[];
  /** Every problem log this tracker holds, each its receipts in order. */
  logs: Receipt[][];
  layer: Layer;
  now: string;
  /** How many UTC days the window holds, ending on now's. */
  days: number;
}

/** One day's counts, or the window's. */
export interface FunnelCounts {
  /** Addresses the hosted on-ramp made, by the day each was made. */
  addresses_made: number;
  /** Members by the day their address was first used. */
  addresses_first_used: number;
  /** Members by the day they took the key home. */
  keys_taken_home: number;
  /** Keys by the day of their earliest receipt on any problem log here: through the hosted connector, or on a key of their own. */
  keys_first_event: { hosted: number; own: number };
  claims: number;
  reveals: number;
  /** Accepting sets by the day they completed, in the layer's fold. */
  sets_accepted: number;
  /** Squares the owner's gold verified, by the day of the reveal's receipt. */
  squares_verified: number;
}
export interface FunnelDay extends FunnelCounts { day: string }
export interface Funnel {
  now: string;
  window: { days: number; from: string; to: string };
  /** Every day of the window, oldest first, with zeros where nothing happened. */
  by_day: FunnelDay[];
  totals: FunnelCounts;
}

/** The days a `days` query asks for: the default when it says nothing, null when it is not a whole number from 1 to DAYS_MAX. */
export function daysFrom(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return DAYS_DEFAULT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= DAYS_MAX ? n : null;
}

/** The UTC day a time in milliseconds falls on, as YYYY-MM-DD. */
const dayOf = (t: number): string => new Date(t).toISOString().slice(0, 10);

const zero = (): FunnelCounts => ({ addresses_made: 0, addresses_first_used: 0, keys_taken_home: 0, keys_first_event: { hosted: 0, own: 0 }, claims: 0, reveals: 0, sets_accepted: 0, squares_verified: 0 });

/** The funnel over the window of `days` UTC days ending on now's, every day present, and the totals over it. */
export function funnel(input: FunnelInput): Funnel {
  const { members, logs, layer, now, days } = input;
  const end = Date.parse(now);
  const rows = new Map<string, FunnelDay>();
  for (let i = days - 1; i >= 0; i--) {
    const day = dayOf(end - i * DAY_MS);
    rows.set(day, { day, ...zero() });
  }
  /** Counts one on the day `at` falls on, when that day is in the window and `at` is not after now. */
  const on = (at: string | null, add: (c: FunnelCounts) => void): void => {
    if (at === null) return;
    const t = Date.parse(at);
    if (!Number.isFinite(t) || t > end) return;
    const row = rows.get(dayOf(t));
    if (row) add(row);
  };
  for (const m of members) {
    on(m.createdAt, (c) => { c.addresses_made += 1; });
    on(m.firstUsedAt, (c) => { c.addresses_first_used += 1; });
    on(m.keyTakenAt, (c) => { c.keys_taken_home += 1; });
  }
  // Each key's earliest receipt across every problem log, and whose custody it was in then; the keys themselves stay here.
  const first = new Map<string, { at: string; hosted: boolean }>();
  for (const log of logs) for (const r of log) {
    const w = r.received[0];
    if (!w) continue;
    if (r.event.type === 'claim') on(w.at, (c) => { c.claims += 1; });
    if (r.event.type === 'reveal') on(w.at, (c) => { c.reveals += 1; });
    const seen = first.get(r.event.key);
    if (!seen || w.at < seen.at) first.set(r.event.key, { at: w.at, hosted: w.custody === 'hosted' });
  }
  for (const f of first.values()) on(f.at, (c) => { c.keys_first_event[f.hosted ? 'hosted' : 'own'] += 1; });
  // The layer's fold: a set a held challenge or a miss struck is not in it. A piece two versions of a problem share counts once.
  const sets = new Set<string>();
  const squares = new Set<string>();
  for (const pl of layer.problems.values()) {
    for (const v of pl.fold.pieces) {
      const set = v.accepting;
      if (!set) continue;
      const id = `${v.piece.hash}:${set.completedAt}`;
      if (sets.has(id)) continue;
      sets.add(id);
      on(set.completedAt, (c) => { c.sets_accepted += 1; });
    }
    for (const g of pl.golds) for (const c of g.commitments) {
      if (c.outcome !== 'match' || c.revealedAt === null || squares.has(c.h)) continue;
      squares.add(c.h);
      on(c.revealedAt, (x) => { x.squares_verified += 1; });
    }
  }
  const totals = zero();
  for (const r of rows.values()) {
    totals.addresses_made += r.addresses_made;
    totals.addresses_first_used += r.addresses_first_used;
    totals.keys_taken_home += r.keys_taken_home;
    totals.keys_first_event.hosted += r.keys_first_event.hosted;
    totals.keys_first_event.own += r.keys_first_event.own;
    totals.claims += r.claims;
    totals.reveals += r.reveals;
    totals.sets_accepted += r.sets_accepted;
    totals.squares_verified += r.squares_verified;
  }
  const list = [...rows.values()];
  return { now, window: { days, from: list[0]!.day, to: list[list.length - 1]!.day }, by_day: list, totals };
}
