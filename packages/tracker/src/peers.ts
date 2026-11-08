/**
 * QX-21, doors fold each other's chains (docs/ext/QX-21.md, sections 2 and 5): a tracker with peers reads each peer's
 * identity log and its chain for every problem held here, page by page, and admits each event it lacks through its own
 * door as a post's is admitted, with the peer's wrappers kept beside its own; the reads a peer's trace names are taken
 * first. The coin log is one sequence and is not pulled (QX-17). The pull reaches the tracker that runs it through the
 * `PullDoor` it is handed and through nothing else.
 */
import {
  type Event,
  type Hash,
  type Receipt,
  IDENTITY_LOG,
  eventId,
  eventProblems,
  eventSignedByKey,
  hashBytes,
  isHash,
  verifyChain,
  withSlash,
} from '@bitquilt/core';
import { COIN_LOG } from './coin.js';
import { Refusal } from './http.js';
import type { Store } from './store.js';
import { readsNamed } from './trace.js';
import type { Admitted, Log, Tracker } from './tracker.js';

/** QX-21: doors fold each other's chains. */
export const PEER_PULL = 'QX-21';
/** How often a tracker with peers pulls their chains, in milliseconds; the first pull a minute after start. */
export const PEER_PULL_EVERY_MS = 300_000;

/**
 * QX-21: what one pull from one peer did: the lines added here, the events this door refused with why, and what could
 * not be read.
 */
export interface PeerPull {
  peer: string;
  added: number;
  refused: { id: Hash; why: string }[];
  errors: string[];
}

/**
 * What the peer pull reaches of the tracker that runs it: its store, its own address, its clock, its fetch and the
 * peers it names; `admit`, the door's admission of an event for a log, run as a post's is, with the layer built afresh
 * at now while it runs; and `noteAppended`, what the door keeps beside a chain once a line is on it.
 */
export interface PullDoor {
  store: Store;
  url: string;
  now: () => string;
  fetchImpl: typeof fetch;
  peers: readonly string[];
  admit: (log: Log, event: Event, hosted: boolean) => Promise<Admitted>;
  noteAppended: (log: Log, event: Event, at: string) => void;
}

/**
 * QX-21: a chain read whole from a peer, page by page along `x-quilt-next-since`; null where the peer does not hold
 * it, did not answer, or did not end its pages.
 */
async function linesFrom(door: PullDoor, target: string): Promise<Receipt[] | null> {
  const { fetchImpl } = door;
  const lines: Receipt[] = [];
  let since = 0;
  for (let page = 0; page < 10_000; page += 1) {
    let r: Response;
    try {
      r = await fetchImpl(`${target}?since=${since}`, { signal: AbortSignal.timeout(30_000) });
    } catch {
      return null;
    }
    if (!r.ok) return null;
    lines.push(
      ...(await r.text())
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Receipt),
    );
    const next = r.headers.get('x-quilt-next-since');
    if (!next) return lines;
    since = Number(next);
  }
  return null;
}

/**
 * QX-21 section 2: the reads a peer's trace names that this door lacks, fetched from the peer under their hashes and
 * kept where they check; one that does not is left to the trace's own refusal.
 */
async function takeReads(door: PullDoor, peer: string, event: Event): Promise<void> {
  const { store, fetchImpl } = door;
  for (const hash of readsNamed(event)) {
    if (!isHash(hash) || store.getBlob(hash)) continue;
    try {
      const r = await fetchImpl(`${peer}b/${hash}`, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (hashBytes(bytes) === hash) store.putBlob(hash, bytes);
    } catch {
      /* the trace says what is missing */
    }
  }
}

/**
 * QX-21 section 2: one log of a peer's, pulled and folded through this door. The chain is taken whole and left whole
 * where it does not verify; each event this tracker lacks is admitted as a post would be, in the peer's order, with
 * the peer's wrappers kept and this door's added (CORE.md section 5: the union of `received`, the earliest deciding
 * the time), so a lock a stake rule asks or a gold rule this door keeps refuses here what the peer admitted, and the
 * pull says so rather than folding it: two doors converge on everything both admit.
 */
async function pullLog(door: PullDoor, peer: string, target: string, log: Log, out: PeerPull): Promise<void> {
  const { store, url, now, admit, noteAppended } = door;
  const chain: Hash = log.kind === 'identity' ? IDENTITY_LOG : log.kind === 'problem' ? log.hash : COIN_LOG;
  const lines = await linesFrom(door, target);
  if (!lines) return;
  const check = verifyChain(lines, chain);
  if (!check.ok) {
    out.errors.push(`${target}: chain does not verify: ${check.problems[0]}`);
    return;
  }
  for (const line of lines) {
    const event = line.event;
    const shape = eventProblems(event);
    if (shape.length) {
      out.refused.push({ id: eventId(event), why: shape[0]! });
      continue;
    }
    const id = eventId(event);
    if (store.hasEvent(chain, id)) continue;
    if (!eventSignedByKey(event)) {
      out.refused.push({ id, why: "signature is not the key's" });
      continue;
    }
    const hosted = line.received.some((w) => w.custody === 'hosted');
    // QX-19 section 2: a trace is admitted where its reads are held, so the reads it names are taken from the peer
    // under their hashes first, as the mirror and a node's keep take them.
    if (event.type === 'trace') await takeReads(door, peer, event);
    try {
      const admitted = await admit(log, event, hosted);
      const appended = store.appendPulled(admitted.chain, event, id, [
        ...line.received,
        { by: url, at: now(), ...(admitted.word ?? {}) },
      ]);
      noteAppended(log, event, appended.received.map((w) => w.at).sort()[0]!);
      out.added += 1;
    } catch (err) {
      if (err instanceof Refusal) out.refused.push({ id, why: err.message });
      else out.errors.push(`${target}: ${(err as Error).message}`);
    }
  }
}

/**
 * QX-21: every peer in turn, its identity log first and then its chain for every problem held here; the coin log is
 * one sequence and is not pulled (QX-17).
 */
export async function pullPeers(door: PullDoor): Promise<PeerPull[]> {
  const { store, url, fetchImpl, peers } = door;
  const out: PeerPull[] = [];
  for (const peer of peers.map(withSlash)) {
    if (peer === url) continue;
    const report: PeerPull = { peer, added: 0, refused: [], errors: [] };
    let known: unknown = null;
    try {
      const r = await fetchImpl(`${peer}.well-known/quilt`, { signal: AbortSignal.timeout(15_000) });
      known = r.ok ? await r.json() : null;
    } catch {
      known = null;
    }
    if (!known) {
      report.errors.push(`${peer}: no answer`);
      out.push(report);
      continue;
    }
    await pullLog(door, peer, `${peer}k/events`, { kind: 'identity' }, report);
    for (const e of store.listEnvelopes())
      await pullLog(door, peer, `${peer}p/${e.hash}/events`, { kind: 'problem', hash: e.hash }, report);
    out.push(report);
  }
  return out;
}

/**
 * QX-21: the peers' chains pulled and folded every `PEER_PULL_EVERY_MS`, the first a minute after start, one pull at a
 * time; `say` gets one line per peer per pull. Nothing is scheduled where there is no peer. What both binaries run.
 */
export function schedulePeerPulls(
  tracker: Pick<Tracker, 'pullPeers'>,
  peers: readonly string[],
  say: (line: string) => void,
): void {
  if (peers.length === 0) return;
  say(
    `peers: ${peers.join(', ')}; their chains are pulled and folded through this door every ${Math.round(PEER_PULL_EVERY_MS / 60_000)} minutes (QX-21)`,
  );
  let pulling = false;
  const pull = async (): Promise<void> => {
    if (pulling) return;
    pulling = true;
    try {
      for (const p of await tracker.pullPeers())
        say(
          `peer ${p.peer}: ${p.added} added, ${p.refused.length} refused${p.errors.length ? `; ${p.errors.join('; ')}` : ''}`,
        );
    } catch (err) {
      say(`peers: not pulled (${(err as Error).message})`);
    } finally {
      pulling = false;
    }
  };
  setTimeout(() => void pull(), 60_000).unref();
  setInterval(() => void pull(), PEER_PULL_EVERY_MS).unref();
}
