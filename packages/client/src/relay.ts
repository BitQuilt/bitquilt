/**
 * QX-14, discovery over relays: an announcement posted to Nostr relays as a signed event of its own, and found there
 * by anyone, with no tracker in the way. The relay event is transport: what a reader trusts is the BitQuilt announce
 * inside it, signed by its key, and the hash it names. The same secp256k1 key signs both, Schnorr for the relay
 * (BIP-340, as Nostr asks) and the core's signature for the announce. What an announce carries is QX-13: the title,
 * slug and statement of done as the envelope has them, the topics, the owner, what it forks, and the work on the
 * problem as the announcer's tracker counted it when it was posted.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import {
  type Event,
  type Hash,
  carriesWords,
  eventSignedByKey,
  eventProblems,
  isHash,
  textIssues,
} from '@bitquilt/core';

/** The event kind announcements use: parameterized replaceable, so a relay keeps one per key and problem. */
export const KIND = 30177;
export const RELAYS = 'QX-14';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

/**
 * The work on a problem as an announce states it (QX-13): the tracker's row when it was posted, or zeros at publish.
 */
export interface AnnouncedWork {
  returned: number;
  accepted: number;
  verified: number;
  disputed: number;
  traced: { both: number; one: number; none: number };
  readers: number;
  vendors: number;
  last: string | null;
  /** QX-20: the record pieces whose readings are in; absent from an announce made before the kind. */
  recorded?: number;
  /** The roots that declined a piece, from a tracker's row; an announce's is not read. */
  declined?: number;
  /** What the accepted squares found, from a tracker's row; an announce's is not read. */
  found?: Record<string, Record<string, number>>;
}

export const NO_WORK: AnnouncedWork = {
  returned: 0,
  accepted: 0,
  verified: 0,
  disputed: 0,
  traced: { both: 0, one: 0, none: 0 },
  readers: 0,
  vendors: 0,
  last: null,
};

export interface RelayAnnouncement {
  announce: Event;
  problem: Hash;
  /** The envelope's owner as the announce states it (QX-13); the signer where an older announce says none. */
  owner: string;
  /** The key that signed the announce: the owner, or a seeder who announced it too. */
  announcer: string;
  title: string;
  slug: string;
  done_when: string;
  topics: string[];
  trackers: string[];
  mirrors: string[];
  relay: string;
  created_at: number;
  /**
   * QX-13: the problem this one forks, the pieces, the counts and the work, as the announcer's tracker counted them
   * when it posted; null or empty where the announce says none.
   */
  from: Hash | null;
  pieces: number | null;
  counts: Record<string, number>;
  work: AnnouncedWork | null;
}

export function nostrPublicKey(secret: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(secret));
}

function idOf(pubkey: string, created_at: number, kind: number, tags: string[][], content: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([0, pubkey, created_at, kind, tags, content]))));
}

/**
 * The relay event carrying a BitQuilt announce: `d` is the problem hash, `t` the topics, the content the announce
 * itself.
 */
export function announcementEvent(
  announce: Event,
  secret: Uint8Array,
  now = Math.floor(Date.now() / 1000),
): NostrEvent {
  const body = announce.body as { title?: string; topics?: string[] };
  const tags: string[][] = [
    ['d', announce.problem ?? ''],
    ['title', body.title ?? ''],
  ];
  for (const t of body.topics ?? []) tags.push(['t', t]);
  const pubkey = nostrPublicKey(secret);
  const content = JSON.stringify(announce);
  const id = idOf(pubkey, now, KIND, tags, content);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secret));
  return { id, pubkey, created_at: now, kind: KIND, tags, content, sig };
}

const whole = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

/** The work an announce states, as its shape, or null where it states none or states it wrong. */
export function announcedWork(x: unknown): AnnouncedWork | null {
  if (!x || typeof x !== 'object') return null;
  const w = x as Record<string, unknown>;
  const t = w.traced as Record<string, unknown> | undefined;
  if (!['returned', 'accepted', 'verified', 'disputed', 'readers', 'vendors'].every((k) => whole(w[k]))) return null;
  if (!t || typeof t !== 'object' || !['both', 'one', 'none'].every((k) => whole(t[k]))) return null;
  if (w.last !== null && (typeof w.last !== 'string' || Number.isNaN(Date.parse(w.last)))) return null;
  return {
    returned: w.returned as number,
    accepted: w.accepted as number,
    verified: w.verified as number,
    disputed: w.disputed as number,
    traced: { both: t.both as number, one: t.one as number, none: t.none as number },
    readers: w.readers as number,
    vendors: w.vendors as number,
    last: w.last as string | null,
    ...(whole(w.recorded) ? { recorded: w.recorded as number } : {}),
  };
}

/**
 * The announcement a relay event carries, or null when the event, its id, its signature or the announce inside fails,
 * or the words do not pass the plain-text gate (QX-14 section 3): a relay admits anything, so the reader is the gate.
 */
export function readAnnouncement(ev: NostrEvent, relay: string): RelayAnnouncement | null {
  try {
    if (ev.kind !== KIND || typeof ev.content !== 'string' || !Array.isArray(ev.tags)) return null;
    if (idOf(ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content) !== ev.id) return null;
    if (!schnorr.verify(hexToBytes(ev.sig), hexToBytes(ev.id), hexToBytes(ev.pubkey))) return null;
    const announce = JSON.parse(ev.content) as Event;
    if (announce.type !== 'announce' || eventProblems(announce).length || !eventSignedByKey(announce)) return null;
    const d = ev.tags.find((t) => t[0] === 'd')?.[1];
    if (!announce.problem || d !== announce.problem) return null;
    const b = announce.body as Record<string, unknown>;
    const strings = (x: unknown): string[] =>
      Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [];
    if (typeof b.title !== 'string' || typeof b.slug !== 'string' || typeof b.done_when !== 'string') return null;
    if (textIssues(b.title).length || textIssues(b.done_when).length || !/^[a-z0-9-]{1,64}$/.test(b.slug)) return null;
    const topics = strings(b.topics);
    if (topics.length > 8 || topics.some((t) => t.length > 40 || textIssues(t).length > 0)) return null;
    const counts: Record<string, number> = {};
    if (b.counts && typeof b.counts === 'object')
      for (const [k, n] of Object.entries(b.counts as Record<string, unknown>)) if (whole(n)) counts[k] = n;
    return {
      announce,
      problem: announce.problem,
      owner: typeof b.owner === 'string' ? b.owner : announce.key,
      announcer: announce.key,
      title: b.title,
      slug: b.slug,
      done_when: b.done_when,
      topics,
      trackers: strings(b.trackers),
      mirrors: strings(b.mirrors),
      relay,
      created_at: ev.created_at,
      from: isHash(b.from) ? b.from : null,
      pieces: whole(b.pieces) ? b.pieces : null,
      counts,
      work: announcedWork(b.work),
    };
  } catch {
    return null;
  }
}

/**
 * One relay, one conversation, one deadline. The run gets the socket and a way to finish with a value; `onFail` is what
 * the deadline or a dropped socket resolves with.
 */
function talk<T>(
  relay: string,
  timeoutMs: number,
  run: (ws: WebSocket, finish: (value: T) => void) => void,
  onFail: () => T,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let done = false;
    let ws: WebSocket;
    const finish = (value: T) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* already closed */
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish(onFail()), timeoutMs);
    try {
      ws = new WebSocket(relay);
    } catch {
      finish(onFail());
      return;
    }
    ws.addEventListener('error', () => finish(onFail()));
    ws.addEventListener('close', () => finish(onFail()));
    ws.addEventListener('open', () => run(ws, finish));
  });
}

/** The event posted to each relay; a relay that answers OK is in `posted`, any other in `refused`. */
export async function postToRelays(
  relays: string[],
  ev: NostrEvent,
  timeoutMs = 8000,
): Promise<{ posted: string[]; refused: string[] }> {
  const posted: string[] = [];
  const refused: string[] = [];
  await Promise.all(
    relays.map(async (relay) => {
      const ok = await talk<boolean>(
        relay,
        timeoutMs,
        (ws, finish) => {
          ws.addEventListener('message', (m) => {
            try {
              const msg = JSON.parse(String(m.data)) as unknown[];
              if (msg[0] === 'OK' && msg[1] === ev.id) finish(msg[2] === true);
            } catch {
              /* not for us */
            }
          });
          ws.send(JSON.stringify(['EVENT', ev]));
        },
        () => false,
      );
      (ok ? posted : refused).push(relay);
    }),
  );
  return { posted, refused };
}

/**
 * The filters a search sends: the latest announcements, and, for one word, the announcements tagged with it, since a
 * relay's limit may cut the first short (NIP-01 takes several filters as a union; NIP-24 has tags in lower case).
 */
export function searchFilters(query: string, limit: number): Record<string, unknown>[] {
  const q = query.trim().toLowerCase();
  const filters: Record<string, unknown>[] = [{ kinds: [KIND], limit }];
  if (q && /^[a-z0-9-]{1,40}$/.test(q)) filters.push({ kinds: [KIND], '#t': [q], limit });
  return filters;
}

/**
 * Announcements on the relays whose title, slug, statement or topics hold every word of the query; the latest per
 * problem, an owner's own announce before a seeder's. What a relay had sent before its deadline is kept, since a slow
 * relay is still a relay.
 */
export async function searchRelays(
  relays: string[],
  query: string,
  timeoutMs = 5000,
  limit = 200,
): Promise<RelayAnnouncement[]> {
  const found = new Map<Hash, RelayAnnouncement>();
  await Promise.all(
    relays.map(async (relay) => {
      const sub = `q${Math.random().toString(36).slice(2, 10)}`;
      const out: RelayAnnouncement[] = [];
      const got = await talk<RelayAnnouncement[]>(
        relay,
        timeoutMs,
        (ws, finish) => {
          ws.addEventListener('message', (m) => {
            try {
              const msg = JSON.parse(String(m.data)) as unknown[];
              if (msg[0] === 'EVENT' && msg[1] === sub) {
                const a = readAnnouncement(msg[2] as NostrEvent, relay);
                if (a) out.push(a);
              } else if (msg[0] === 'EOSE' && msg[1] === sub) finish(out);
            } catch {
              /* not for us */
            }
          });
          ws.send(JSON.stringify(['REQ', sub, ...searchFilters(query, limit)]));
        },
        () => out,
      );
      for (const a of got) {
        if (!carriesWords(`${a.title} ${a.slug} ${a.done_when} ${a.topics.join(' ')}`, query)) continue;
        const have = found.get(a.problem);
        if (!have || prefer(a, have)) found.set(a.problem, a);
      }
    }),
  );
  return [...found.values()];
}

/**
 * QX-14 section 3: the announcements of one problem on the relays, asked by its hash as the `d` tag, one per announcer,
 * the owner's own first. What a resolver with no tracker that answers asks, to learn where the problem is held.
 */
export async function findOnRelays(relays: string[], problem: Hash, timeoutMs = 5000): Promise<RelayAnnouncement[]> {
  const found = new Map<string, RelayAnnouncement>();
  await Promise.all(
    relays.map(async (relay) => {
      const sub = `d${Math.random().toString(36).slice(2, 10)}`;
      const out: RelayAnnouncement[] = [];
      const got = await talk<RelayAnnouncement[]>(
        relay,
        timeoutMs,
        (ws, finish) => {
          ws.addEventListener('message', (m) => {
            try {
              const msg = JSON.parse(String(m.data)) as unknown[];
              if (msg[0] === 'EVENT' && msg[1] === sub) {
                const a = readAnnouncement(msg[2] as NostrEvent, relay);
                if (a && a.problem === problem) out.push(a);
              } else if (msg[0] === 'EOSE' && msg[1] === sub) finish(out);
            } catch {
              /* not for us */
            }
          });
          ws.send(JSON.stringify(['REQ', sub, { kinds: [KIND], '#d': [problem], limit: 20 }]));
        },
        () => out,
      );
      for (const a of got) {
        const k = a.announcer.toLowerCase();
        const have = found.get(k);
        if (!have || a.created_at > have.created_at) found.set(k, a);
      }
    }),
  );
  return [...found.values()].sort((a, b) => (prefer(a, b) ? -1 : 1));
}

/** Whether `a` is the announcement to keep over `have`: the owner's own before a seeder's, then the later. */
function prefer(a: RelayAnnouncement, have: RelayAnnouncement): boolean {
  const own = (x: RelayAnnouncement) => x.announcer.toLowerCase() === x.owner.toLowerCase();
  if (own(a) !== own(have)) return own(a);
  return a.created_at > have.created_at;
}
