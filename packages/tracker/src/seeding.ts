/**
 * QX-4 and QX-5 as a layer over the fold, beside the challenge window: who seeds a problem and when it was last seeded,
 * read from `seed` events the core ignores; watch pieces offered to seeders first, through the holds assisted next
 * already keeps; and the order problems are offered in when a worker names none: reciprocal first, rarest next, every
 * tenth offer to a newcomer. Nothing here changes what the core accepts; it changes who is asked first.
 */
import { type Address, type Client, type Hash, type Pick, type ReduceInput, type State, isRecord, next } from '@bitquilt/core';
import type { Layer, ProblemLayer } from './challenge.js';
import { acceptingRoots } from './standing.js';
import { leaseOf } from './verifiers.js';

export const SEEDING = 'QX-4';
export const RECIPROCITY = 'QX-5';
/** Every this-many offers to a key goes to a newcomer's problem. */
export const TENTH = 10;
/** The family whose pieces are offered to seeders first. */
export const WATCH = 'watch';

export interface SeedInfo {
  seeders: Set<Address>;
  last_seeded: string | null;
}

/** Who seeds the problem at `now`, and the latest `seed` with `on` at or before it, from the problem's receipts in order. */
export function seedInfo(input: ReduceInput, fold: State, now: string): SeedInfo {
  const latest = new Map<Address, boolean>();
  let last: string | null = null;
  for (const r of input.receipts) {
    const e = r.event;
    if (e.type !== 'seed') continue;
    const at = r.received[0]?.at;
    if (!at || at > now) continue;
    const on = (e.body as { on?: unknown })?.on;
    if (typeof on !== 'boolean') continue;
    latest.set(fold.rootOf(e.key as Address, at), on);
    if (on && (last === null || at > last)) last = at;
  }
  const seeders = new Set<Address>();
  for (const [root, on] of latest) if (on) seeders.add(root);
  return { seeders, last_seeded: last };
}

/** Why this is not a well-formed seed body, or nothing. */
export function seedBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (typeof body.on !== 'boolean') out.push('body.on: true or false');
  for (const k of Object.keys(body)) if (k !== 'on') out.push(`body.${k}: not a field of a seed`);
  return out;
}

/** When the pieces of the current version became open: the latest version receipt, else the first receipt, else now. */
function openSince(input: ReduceInput, now: string): string {
  let since: string | null = null;
  for (const r of input.receipts) {
    const at = r.received[0]?.at;
    if (!at) continue;
    if (since === null) since = at;
    if (r.event.type === 'version') since = at;
  }
  return since ?? now;
}

/**
 * The pieces assisted next keeps from this key on this problem under QX-4 section 4: for a root that does not seed
 * the problem while someone does, the open watch pieces newer than their lease; for a seeder, everything but the open
 * watch pieces while there is one, so the watch piece comes first.
 */
export function watchExclusions(pl: ProblemLayer, input: ReduceInput, key: Address, seeders: Set<Address>, now: string): Set<Hash> {
  const out = new Set<Hash>();
  if (seeders.size === 0) return out;
  const fold = pl.fold;
  const root = fold.rootOf(key, now);
  const openWatch = pl.pieces.filter((p) => p.state === 'open' && fold.byHash.get(p.hash)?.piece.family === WATCH);
  if (openWatch.length === 0) return out;
  if (seeders.has(root)) {
    for (const p of pl.pieces) if (fold.byHash.get(p.hash)?.piece.family !== WATCH) out.add(p.hash);
    return out;
  }
  const since = Date.parse(openSince(input, now));
  for (const p of openWatch) {
    const leaseMs = leaseOf(fold, fold.byHash.get(p.hash)!) * 3_600_000;
    if (Date.parse(now) - since < leaseMs) out.add(p.hash);
  }
  return out;
}

export type Reason = 'reciprocal' | 'rarest' | 'newcomer';

export interface Offer {
  problem: Hash;
  title: string;
  slug: string;
  owner: Address;
  reason: Reason;
  pick: Pick;
}

/** Whether a piece in this layered state still carries its accepting set. */
function stands(state: string): boolean {
  return state === 'accepted' || state === 'accepted_provisional' || state === 'challenged';
}

/**
 * The problems this reader holds that have a piece for the key, in the order QX-5 section 2 gives: the problems of
 * owners who have worked for the key first (latest first), then the rest rarest first, and, on every tenth offer,
 * the newcomer's problem that stands highest among the rest. `count` is the number of this offer to the key.
 */
export function offerOrder(layer: Layer, inputs: Map<Hash, ReduceInput>, key: Address, client: Client, now: string, count: number, exclude: (hash: Hash, pl: ProblemLayer, input: ReduceInput) => Set<Hash>): Offer[] {
  // Roots with accepted work anywhere here, and when each worked for whom.
  const accepted = new Set<Address>();
  const workedFor = new Map<Address, Map<Address, string>>(); // owner root -> worker root -> latest completion
  for (const pl of layer.problems.values()) {
    const ownerRoot = pl.fold.rootOf(pl.fold.envelope.problem.owner as Address, now);
    for (const p of pl.pieces) {
      if (!stands(p.state)) continue;
      const v = pl.fold.byHash.get(p.hash);
      if (!v?.accepting) continue;
      const at = v.accepting.completedAt;
      for (const root of acceptingRoots(v)) {
        accepted.add(root);
        const m = workedFor.get(ownerRoot) ?? new Map<Address, string>();
        if (!m.has(root) || m.get(root)! < at) m.set(root, at);
        workedFor.set(ownerRoot, m);
      }
    }
  }
  type Row = Offer & { doneShare: number; last: string; reciprocalAt: string | null; newcomer: boolean };
  const rows: Row[] = [];
  for (const [hash, pl] of layer.problems) {
    const input = inputs.get(hash);
    if (!input) continue;
    const fold = pl.fold;
    const w = fold.rootOf(key, now);
    const ownerRoot = fold.rootOf(fold.envelope.problem.owner as Address, now);
    if (ownerRoot === w) continue;
    const pick = next(fold, key, client, now, { exclude: exclude(hash, pl, input) });
    if (!pick) continue;
    const done = pl.pieces.filter((p) => p.state === 'accepted' || p.state === 'accepted_provisional').length;
    const reciprocalAt = workedFor.get(w)?.get(ownerRoot) ?? null;
    const own = input.receipts.filter((r) => r.event.problem !== undefined);
    const last = own.length ? own[own.length - 1]!.received[0]?.at ?? '' : '';
    rows.push({ problem: hash, title: fold.envelope.problem.title, slug: fold.envelope.problem.slug, owner: fold.envelope.problem.owner as Address, reason: reciprocalAt ? 'reciprocal' : 'rarest', pick, doneShare: pl.pieces.length ? done / pl.pieces.length : 0, last, reciprocalAt, newcomer: !accepted.has(ownerRoot) });
  }
  const reciprocal = rows.filter((r) => r.reciprocalAt).sort((a, b) => (a.reciprocalAt! < b.reciprocalAt! ? 1 : a.reciprocalAt! > b.reciprocalAt! ? -1 : 0));
  const rest = rows.filter((r) => !r.reciprocalAt).sort((a, b) => a.doneShare - b.doneShare || (a.last < b.last ? -1 : a.last > b.last ? 1 : 0));
  const ordered: Row[] = [...reciprocal, ...rest];
  if (count % TENTH === 0) {
    const i = ordered.findIndex((r) => !r.reciprocalAt && r.newcomer);
    if (i > 0) {
      const [n] = ordered.splice(i, 1);
      ordered.unshift({ ...n!, reason: 'newcomer' });
    } else if (i === 0) ordered[0] = { ...ordered[0]!, reason: 'newcomer' };
  }
  return ordered.map(({ problem, title, slug, owner, reason, pick }) => ({ problem, title, slug, owner, reason, pick }));
}
