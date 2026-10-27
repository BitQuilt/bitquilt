/**
 * QX-6, the hide event and a maintainer's key: a tracker's keeper takes a problem or an event down from this tracker's
 * own pages by a signed event on the identity log, which the mirror copies and another tracker may honour or not. The
 * reducer never sees it; history keeps everything. What this tracker does with a hidden problem: leaves it out of its
 * index, its search and its offers, hands out none of its pieces, and refuses new events on it, while still serving
 * its envelope and its chain to anyone who asks by hash.
 */
import { type Address, type Receipt, isHash, isRecord, plainTextProblems } from '@bitquilt/core';

export const HIDE = 'QX-6';
export const WHY_MAX = 200;

export interface Hidden {
  /** An event id or a problem hash. */
  id: string;
  by: Address;
  why: string;
  at: string;
}

/** Why this is not a well-formed hide body, or nothing. */
export function hideBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!isHash(body.id)) out.push('body.id: an event id or a problem hash');
  if (typeof body.why !== 'string' || !body.why.trim() || body.why.length > WHY_MAX) out.push(`body.why: text of at most ${WHY_MAX} characters`);
  else out.push(...plainTextProblems(body.why, 'body.why'));
  if (body.on !== undefined && typeof body.on !== 'boolean') out.push('body.on: true or false');
  for (const k of Object.keys(body)) if (!['id', 'why', 'on'].includes(k)) out.push(`body.${k}: not a field of a hide`);
  return out;
}

/**
 * What stands taken down now: the identity log's hide events in order, counting only those signed by one of the
 * maintainers given, the latest hide or lift per id winning. A maintainer struck from the list takes their hides with
 * them, since the list is read each time.
 */
export function hiddenNow(identity: Receipt[], maintainers: Address[]): Map<string, Hidden> {
  const set = new Set(maintainers.map((a) => a.toLowerCase()));
  const out = new Map<string, Hidden>();
  for (const r of identity) {
    const e = r.event;
    if (e.type !== 'hide' || !set.has(e.key.toLowerCase())) continue;
    const b = e.body as { id: string; why: string; on?: boolean };
    if (hideBodyProblems(b).length) continue;
    const at = r.received[0]?.at ?? e.ts;
    if (b.on === false) out.delete(b.id);
    else out.set(b.id, { id: b.id, by: e.key as Address, why: b.why, at });
  }
  return out;
}
