/**
 * What the mirror folds from the identity log alone: the hides each problem carries (QX-6) and, for keys.json, each
 * address's name and the delegations in force. Both are pure folds over the receipts; the reader decides whom to trust.
 */
import type { Receipt } from '@bitquilt/core';

/** One hide on a problem or an event: who signed it, the reason given, and when it was received. */
export interface Hide {
  by: string;
  why: string;
  at: string;
}

/** What keys.json holds for an address: its latest name, whether it is an agent on its own, and the delegations in force. */
export interface KeyEntry {
  name?: string;
  agent?: boolean;
  delegates: { to: string; scope: string[]; expires: string }[];
}

/** QX-6: every hide in an identity log, by the problem or event it names and the key that signed it; a lift by the same key removes its entry. The reader decides whom to trust. */
export function hiddenFromIdentity(lines: Receipt[]): Map<string, Hide[]> {
  const out = new Map<string, Hide[]>();
  for (const line of lines) {
    const event = line.event;
    if (event.type !== 'hide') continue;
    const body = event.body as { id?: unknown; why?: unknown; on?: unknown };
    if (typeof body.id !== 'string' || typeof body.why !== 'string') continue;
    const list = (out.get(body.id) ?? []).filter((h) => h.by !== event.key);
    if (body.on !== false) list.push({ by: event.key, why: body.why, at: line.received[0]?.at ?? event.ts });
    if (list.length) out.set(body.id, list);
    else out.delete(body.id);
  }
  return out;
}

/** keys.json: each address's latest name, whether it is an agent on its own, and the delegations in force at `now`: a delegation past its expiry is dropped, and a revoke removes the delegation to the address it names (`of`). */
export function keysFromIdentity(lines: Receipt[], now: string): Record<string, KeyEntry> {
  const keys: Record<string, KeyEntry> = {};
  for (const line of lines) {
    const event = line.event;
    const entry = (keys[event.key] ??= { delegates: [] });
    if (event.type === 'name') {
      entry.name = (event.body as { name: string }).name;
      if ((event.body as { agent?: boolean }).agent) entry.agent = true;
    }
    if (event.type === 'delegate') {
      const body = event.body as { to: string; scope: string[]; expires: string };
      if (body.expires > now) entry.delegates.push({ to: body.to, scope: body.scope, expires: body.expires });
    }
    if (event.type === 'revoke') entry.delegates = entry.delegates.filter((d) => d.to !== (event.body as { of: string }).of);
  }
  return keys;
}
