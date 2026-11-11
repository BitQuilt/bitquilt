/**
 * The ledger of reading 2 (docs/v2/READING.md section 1): `state = read(ledger, now)`. The ledger is the identity
 * log's lines and, for every problem a reader holds, its envelope, the blobs it names and its log's lines, with the two
 * things that reach the fold from beside the lines: the founding standing a tracker publishes and the reads it holds.
 * This file gives the ledger its shape in JSON, builds each problem's input from it as a tracker builds it from its
 * store (`reduceInputOf`), reads it (`readLedger`), and writes what the read says of it as plain JSON (`saidOf`), the
 * form the fixtures of reading 2 keep (`ReadingFixture`). The input's building moved here from the tracker's store
 * as docs/history/V2-PLAN.md, phase 3, says, so a client is held to the fixtures with the core alone.
 */
import { type Envelope, problemHash } from './envelope.js';
import { IDENTITY_LOG, type Receipt } from './events.js';
import type { Hash } from './hash.js';
import type { Address } from './keys.js';
import type { PieceLayer, ProblemLayer } from './layer.js';
import { proposalsIn } from './propose.js';
import { type Reading, read } from './read.js';
import type { ReduceInput } from './reduce.js';
import { setName } from './standing.js';
import { problemTraces, recordOutput } from './trace.js';

/**
 * What `reduceInputOf` reads a problem from: an envelope by its hash, a blob by its hash, and every line of a log. A
 * tracker's store answers it, and so do a ledger in JSON, the mirror's files and a node's store under the keeper.
 */
export interface ChainReader {
  envelopeOf(hash: Hash): Envelope | null;
  getBlob(hash: Hash): Uint8Array | null;
  lines(log: Hash): Receipt[];
}

/**
 * What the reducer takes for a problem a reader holds: its envelope chain along prev, the blobs, every receipt along
 * the chain and the identity log.
 */
export function reduceInputOf(store: ChainReader, envelope: Envelope, at: string): ReduceInput {
  const chainEnvelopes: Envelope[] = [envelope];
  const guard = new Set<Hash>([problemHash(envelope)]);
  for (let cur = envelope.problem.prev; cur && !guard.has(cur); ) {
    guard.add(cur);
    const prev = store.envelopeOf(cur);
    if (!prev) break;
    chainEnvelopes.push(prev);
    cur = prev.problem.prev;
  }
  const blobs = new Map<Hash, Uint8Array>();
  for (const e of chainEnvelopes)
    for (const h of Object.values(e.problem.data))
      if (!blobs.has(h)) {
        const b = store.getBlob(h);
        if (b) blobs.set(h, b);
      }
  const receipts: Receipt[] = [];
  // Line by line, not spread into one call, which a log of more than about a hundred thousand lines would overflow.
  for (const e of chainEnvelopes) for (const l of store.lines(problemHash(e))) receipts.push(l);
  for (const l of store.lines(IDENTITY_LOG)) receipts.push(l);
  return { envelopes: chainEnvelopes, blobs, receipts, now: at };
}

/** A ledger as docs/v2/READING.md section 1 names it, in JSON. */
export interface Ledger {
  /** The identity log's lines. */
  identity: Receipt[];
  /** Every problem held, in the order the tracker lists them, each with its own log's lines. */
  problems: { envelope: Envelope; lines: Receipt[] }[];
  /** The blobs the envelopes name, by hash, in base64. */
  blobs: Record<string, string>;
  /** The coin log's lines where the tracker carries the coin, or null. */
  coin: Receipt[] | null;
  /** The founding standing the tracker publishes (QX-1 section 2), by address. */
  founding: Record<string, number>;
  /** Each read the fold asked the length of, and the length, or null where the reader does not hold it. */
  reads: Record<string, number | null>;
}

/** One fixture of reading 2: a ledger, and what the read says of it at each time (docs/v2/READING.md section 11). */
export interface ReadingFixture {
  name: string;
  description: string;
  reading: 2;
  ledger: Ledger;
  readings: { now: string; expect: unknown }[];
}

/** Bytes from base64, and base64 from bytes, with the standard alphabet and its padding. */
function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text);
}

/** A ledger as the reader `reduceInputOf` takes, so a problem's input is built as a tracker builds it. */
function readerOf(ledger: Ledger): ChainReader {
  const envelopes = new Map(ledger.problems.map((p) => [problemHash(p.envelope), p] as const));
  return {
    envelopeOf: (hash) => envelopes.get(hash)?.envelope ?? null,
    getBlob: (hash) => (hash in ledger.blobs ? fromBase64(ledger.blobs[hash]!) : null),
    lines: (log) => (log === IDENTITY_LOG ? ledger.identity : (envelopes.get(log)?.lines ?? [])),
  };
}

/** The read of a ledger at a time (docs/v2/READING.md section 1), each problem's input built as a tracker builds it. */
export function readLedger(ledger: Ledger, now: string): Reading {
  const reader = readerOf(ledger);
  const founding = new Map(Object.entries(ledger.founding).map(([a, n]) => [a.toLowerCase(), n]));
  return read({
    problems: ledger.problems.map((p) => reduceInputOf(reader, p.envelope, now)),
    now,
    blobLength: (h) => ledger.reads[h] ?? null,
    ...(ledger.coin ? { coin: ledger.coin } : {}),
    ...(founding.size ? { founding } : {}),
  });
}

/** A view as plain JSON: a Map as an object and a Set as a list, each sorted, with what cannot be written left out. */
function plain(v: unknown): unknown {
  if (v instanceof Map) return plain(Object.fromEntries([...v].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1))));
  if (v instanceof Set) return [...v].map(plain).sort();
  if (v instanceof Uint8Array) return toBase64(v);
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== 'function') out[k] = plain(x);
    return out;
  }
  return v;
}

/** What the read says of one piece: its state, its kind, its set, each extension's word on it, and its trace. */
function pieceOf(pl: ProblemLayer, p: PieceLayer, trace: unknown): unknown {
  const set = pl.fold.byHash.get(p.hash)?.accepting ?? null;
  // A reading is named by its event's id, and a set by the hash of its events' ids (docs/v2/READING.md section 5).
  const member = (m: { id: Hash; key: Address; at: string; digest: Hash }) => ({
    id: m.id,
    key: m.key,
    at: m.at,
    digest: m.digest,
  });
  return plain({
    state: p.state,
    kind: p.kind.kind,
    extension: p.kind.extension,
    strength: p.kind.strength,
    attested: p.attested,
    stake: p.stake,
    gold: p.gold,
    verified: p.verified,
    aside: [...p.aside].sort(),
    readings: p.readings,
    inherited: p.inherited,
    challenge: p.challenge?.id ?? null,
    set: set && {
      name: setName(set),
      kind: set.kind,
      completedAt: set.completedAt,
      members: set.kind === 'agree' ? set.reveals.map(member) : [member(set.patch), ...set.runs.map(member)],
    },
    record: p.record && {
      wanted: p.record.wanted,
      recordedAt: p.record.recordedAt,
      standing: p.record.standing.map(member),
    },
    trace,
  });
}

/**
 * What a read says of a ledger, as JSON: every problem, what was refused, and every root's standing. The form is the
 * one the fixtures of reading 2 keep, which the README of their folder gives field by field.
 */
export function saidOf(reading: Reading, ledger: Ledger): unknown {
  const problems: Record<string, unknown> = {};
  for (const [hash, pl] of [...reading.problems].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const traces = problemTraces(
      pl,
      (h) => ledger.reads[h] ?? null,
      () => null,
    );
    // A view many pieces share is written once: `views` holds each view, and a piece names its view's place there.
    const views: unknown[] = [];
    const place = new Map<string, number>();
    const pieces: Record<string, number> = {};
    for (const p of pl.pieces) {
      const view = pieceOf(pl, p, traces.get(p.hash) ?? null);
      const text = JSON.stringify(view);
      if (!place.has(text)) place.set(text, views.push(view) - 1);
      pieces[p.name] = place.get(text)!;
    }
    problems[hash] = plain({
      line: pl.line,
      complete: pl.complete,
      own_complete: pl.fold.complete,
      output: pl.fold.output?.hash ?? null,
      record_output: recordOutput(pl)?.hash ?? null,
      dropped: pl.dropped.length,
      unoffered: pl.unoffered,
      stake: pl.stake,
      gold: pl.goldCount,
      locks: pl.locks,
      golds: pl.golds,
      challenges: pl.challenges,
      panels: pl.panels,
      proposals: proposalsIn(
        pl,
        reading,
        () => true,
        () => null,
      ),
      views,
      pieces,
    });
  }
  const roots = new Set<Address>();
  const lines = [...ledger.identity, ...(ledger.coin ?? []), ...ledger.problems.flatMap((p) => p.lines)];
  for (const l of lines) roots.add(reading.rootOf(l.event.key));
  for (const p of ledger.problems) roots.add(reading.rootOf(p.envelope.problem.owner as Address));
  const standing: Record<string, unknown> = {};
  const { record } = reading;
  for (const root of [...roots].sort())
    standing[root] = { standing: reading.standing(root), locked: record.locked(root), free: record.free(root) };
  return { problems, refused: plain(reading.refused), standing };
}
