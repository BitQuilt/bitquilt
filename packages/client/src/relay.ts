/**
 * QX-14, discovery over relays: an announcement posted to Nostr relays as a signed event of its own, and found there
 * by anyone, with no tracker in the way. The relay event is transport: what a reader trusts is the BitQuilt announce
 * inside it, signed by the problem's owner, and the hash it names. The same secp256k1 key signs both, Schnorr for the
 * relay (BIP-340, as Nostr asks) and the core's signature for the announce.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { type Event, type Hash, eventSignedByKey, eventProblems } from '@bitquilt/core';

/** The event kind announcements use: parameterized replaceable, so a relay keeps one per key and problem. */
export const KIND = 30177;
export const EXTENSION = 'QX-14';

export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}

export interface RelayAnnouncement {
  announce: Event;
  problem: Hash;
  owner: string;
  title: string;
  slug: string;
  done_when: string;
  topics: string[];
  trackers: string[];
  mirrors: string[];
  relay: string;
  created_at: number;
}

export function nostrPublicKey(secret: Uint8Array): string {
  return bytesToHex(schnorr.getPublicKey(secret));
}

function idOf(pubkey: string, created_at: number, kind: number, tags: string[][], content: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(JSON.stringify([0, pubkey, created_at, kind, tags, content]))));
}

/** The relay event carrying a BitQuilt announce: `d` is the problem hash, `t` the topics, the content the announce itself. */
export function announcementEvent(announce: Event, secret: Uint8Array, now = Math.floor(Date.now() / 1000)): NostrEvent {
  const body = announce.body as { title?: string; topics?: string[] };
  const tags: string[][] = [['d', announce.problem ?? ''], ['title', body.title ?? '']];
  for (const t of body.topics ?? []) tags.push(['t', t]);
  const pubkey = nostrPublicKey(secret);
  const content = JSON.stringify(announce);
  const id = idOf(pubkey, now, KIND, tags, content);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secret));
  return { id, pubkey, created_at: now, kind: KIND, tags, content, sig };
}

/** The announcement a relay event carries, or null when the event, its id, its signature or the announce inside fails. */
export function readAnnouncement(ev: NostrEvent, relay: string): RelayAnnouncement | null {
  try {
    if (ev.kind !== KIND || typeof ev.content !== 'string' || !Array.isArray(ev.tags)) return null;
    if (idOf(ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content) !== ev.id) return null;
    if (!schnorr.verify(hexToBytes(ev.sig), hexToBytes(ev.id), hexToBytes(ev.pubkey))) return null;
    const announce = JSON.parse(ev.content) as Event;
    if (announce.type !== 'announce' || eventProblems(announce).length || !eventSignedByKey(announce)) return null;
    const d = ev.tags.find((t) => t[0] === 'd')?.[1];
    if (!announce.problem || d !== announce.problem) return null;
    const b = announce.body as { title?: unknown; slug?: unknown; done_when?: unknown; topics?: unknown; trackers?: unknown; mirrors?: unknown };
    const strings = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
    if (typeof b.title !== 'string' || typeof b.slug !== 'string' || typeof b.done_when !== 'string') return null;
    return { announce, problem: announce.problem, owner: announce.key, title: b.title, slug: b.slug, done_when: b.done_when, topics: strings(b.topics), trackers: strings(b.trackers), mirrors: strings(b.mirrors), relay, created_at: ev.created_at };
  } catch {
    return null;
  }
}

/** One relay, one conversation, one deadline. The run gets the socket and a way to finish with a value. */
function talk<T>(relay: string, timeoutMs: number, run: (ws: WebSocket, finish: (value: T) => void) => void, onFail: T): Promise<T> {
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
    const timer = setTimeout(() => finish(onFail), timeoutMs);
    try {
      ws = new WebSocket(relay);
    } catch {
      finish(onFail);
      return;
    }
    ws.addEventListener('error', () => finish(onFail));
    ws.addEventListener('close', () => finish(onFail));
    ws.addEventListener('open', () => run(ws, finish));
  });
}

/** The event posted to each relay; a relay that answers OK is in `posted`, any other in `refused`. */
export async function postToRelays(relays: string[], ev: NostrEvent, timeoutMs = 8000): Promise<{ posted: string[]; refused: string[] }> {
  const posted: string[] = [];
  const refused: string[] = [];
  await Promise.all(relays.map(async (relay) => {
    const ok = await talk<boolean>(relay, timeoutMs, (ws, finish) => {
      ws.addEventListener('message', (m) => {
        try {
          const msg = JSON.parse(String(m.data)) as unknown[];
          if (msg[0] === 'OK' && msg[1] === ev.id) finish(msg[2] === true);
        } catch {
          /* not for us */
        }
      });
      ws.send(JSON.stringify(['EVENT', ev]));
    }, false);
    (ok ? posted : refused).push(relay);
  }));
  return { posted, refused };
}

/** Announcements on the relays that match the query in their title, slug, statement or topics; the latest per problem. */
export async function searchRelays(relays: string[], query: string, timeoutMs = 5000, limit = 200): Promise<RelayAnnouncement[]> {
  const q = query.trim().toLowerCase();
  const found = new Map<Hash, RelayAnnouncement>();
  await Promise.all(relays.map(async (relay) => {
    const sub = `q${Math.random().toString(36).slice(2, 10)}`;
    const got = await talk<RelayAnnouncement[]>(relay, timeoutMs, (ws, finish) => {
      const out: RelayAnnouncement[] = [];
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
      ws.send(JSON.stringify(['REQ', sub, { kinds: [KIND], limit }]));
    }, []);
    for (const a of got) {
      const hay = `${a.title} ${a.slug} ${a.done_when} ${a.topics.join(' ')}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      const have = found.get(a.problem);
      if (!have || have.created_at < a.created_at) found.set(a.problem, a);
    }
  }));
  return [...found.values()];
}
