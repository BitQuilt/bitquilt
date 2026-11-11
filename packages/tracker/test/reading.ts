/**
 * The fixtures of reading 2, as the tracker's layer answers them today: a ledger as a booted tracker's store holds it,
 * the times it is read at, and what the layer says at each. docs/history/V2-PLAN.md, phase 2, calls these the law for
 * the port: the fold the core is given in phase 3 reproduces every one. `reading-fixtures.test.ts` holds the layer to
 * them; with `QUILT_WRITE_READING=1` the helpers' `boot` writes one for each tracker a test file booted, once the file
 * has run, and one wherever a test keeps a tracker as it stands or a ledger it built by hand. With
 * `QUILT_WRITE_READING=new` only a fixture not yet kept is written. vitest runs `*.test.ts` alone, so this file is no
 * test of its own.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Address,
  type Envelope,
  type Hash,
  IDENTITY_LOG,
  type PieceLayer,
  type ProblemLayer,
  type Receipt,
  plusHours,
  problemHash,
  problemTraces,
  proposalsIn,
  recordOutput,
} from '@bitquilt/core';
import { type Layer, challengeLayer } from '../src/challenge.js';
import { COIN_LOG } from '../src/coin.js';
import { type ChainReader, type Store, reduceInputOf } from '../src/store.js';

/** Where the fixtures of reading 2 are kept, beside version 1's. */
export const READING_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../core/fixtures/reading-2');

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
  /** Each read the layer asked the length of, and the length, or null where the reader does not hold it. */
  reads: Record<string, number | null>;
}

/** One fixture: a ledger, and what the layer says of it at each time. */
export interface ReadingFixture {
  name: string;
  description: string;
  reading: 2;
  ledger: Ledger;
  readings: { now: string; expect: unknown }[];
}

/** A view as plain JSON: a Map as an object and a Set as a list, each sorted, with what cannot be written left out. */
function plain(v: unknown): unknown {
  if (v instanceof Map) return plain(Object.fromEntries([...v].sort(([a], [b]) => (String(a) < String(b) ? -1 : 1))));
  if (v instanceof Set) return [...v].map(plain).sort();
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64');
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined && typeof x !== 'function') out[k] = plain(x);
    return out;
  }
  return v;
}

/** The fixture's ledger as the reader `reduceInputOf` takes, so a problem's input is built as the tracker builds it. */
function readerOf(ledger: Ledger): ChainReader {
  const envelopes = new Map(ledger.problems.map((p) => [problemHash(p.envelope), p] as const));
  return {
    envelopeOf: (hash) => envelopes.get(hash)?.envelope ?? null,
    getBlob: (hash) => (hash in ledger.blobs ? new Uint8Array(Buffer.from(ledger.blobs[hash]!, 'base64')) : null),
    lines: (log) => (log === IDENTITY_LOG ? ledger.identity : (envelopes.get(log)?.lines ?? [])),
  };
}

/** The layer over a ledger at a time, built as the tracker's `buildLayer` builds it. */
export function layerOver(ledger: Ledger, now: string): Layer {
  const reader = readerOf(ledger);
  const founding = new Map(Object.entries(ledger.founding).map(([a, n]) => [a.toLowerCase(), n]));
  return challengeLayer({
    problems: ledger.problems.map((p) => reduceInputOf(reader, p.envelope, now)),
    now,
    blobLength: (h) => ledger.reads[h] ?? null,
    ...(ledger.coin ? { coin: ledger.coin } : {}),
    ...(founding.size ? { founding } : {}),
  });
}

/** What the layer says of one piece: its state, its kind, its set, each extension's word on it, and its trace. */
function pieceOf(pl: ProblemLayer, p: PieceLayer, trace: unknown): unknown {
  const set = pl.fold.byHash.get(p.hash)?.accepting ?? null;
  const member = (m: { key: Address; at: string; digest: Hash }) => ({ key: m.key, at: m.at, digest: m.digest });
  return plain({
    state: p.state,
    core: p.core,
    kind: p.kind.kind,
    extension: p.kind.extension,
    strength: p.kind.strength,
    attested: p.attested,
    stake: p.stake,
    gold: p.gold,
    verified: p.verified,
    aside: [...p.aside].sort(),
    inherited: p.inherited,
    challenge: p.challenge?.id ?? null,
    set: set && {
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

/** What the layer says of a ledger, as JSON: every problem, what was refused, and every root's standing. */
export function expectOf(layer: Layer, ledger: Ledger): unknown {
  const problems: Record<string, unknown> = {};
  for (const [hash, pl] of [...layer.problems].sort(([a], [b]) => (a < b ? -1 : 1))) {
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
        layer,
        () => true,
        () => null,
      ),
      views,
      pieces,
    });
  }
  const roots = new Set<Address>();
  const lines = [...ledger.identity, ...(ledger.coin ?? []), ...ledger.problems.flatMap((p) => p.lines)];
  for (const l of lines) roots.add(layer.rootOf(l.event.key));
  for (const p of ledger.problems) roots.add(layer.rootOf(p.envelope.problem.owner as Address));
  const standing: Record<string, unknown> = {};
  for (const root of [...roots].sort())
    standing[root] = { standing: layer.standing(root), locked: layer.locked(root), free: layer.free(root) };
  return { problems, refused: plain(layer.refused), standing };
}

/** The most a fixture's file may hold, in characters; a larger ledger is not kept. */
export const FIXTURE_MAX = 256 * 1024;

/**
 * A booted tracker's store as a fixture, read at its clock and again a thousand hours on, when every window has closed
 * and every lease and seat has run out; null where the store holds no problem or more lines than a fixture can carry.
 * A ledger the layer throws on throws here too, and the caller leaves it out.
 */
export function fixtureOf(
  name: string,
  description: string,
  store: Store,
  now: string,
  options: { coin?: unknown; founding?: Record<string, number> },
): ReadingFixture | null {
  const held = store.listEnvelopes();
  if (held.length === 0) return null;
  if (held.reduce((n, e) => n + store.lines(e.hash).length, 0) > 1000) return null;
  const blobs: Record<string, string> = {};
  for (const { envelope } of held)
    for (const h of Object.values(envelope.problem.data)) {
      const b = store.getBlob(h);
      if (b) blobs[h] = Buffer.from(b).toString('base64');
    }
  const ledger: Ledger = {
    identity: store.lines(IDENTITY_LOG),
    problems: held.map(({ envelope }) => ({ envelope, lines: store.lines(problemHash(envelope)) })),
    blobs,
    coin: options.coin ? store.lines(COIN_LOG) : null,
    founding: options.founding ?? {},
    reads: {},
  };
  // The first pass asks the store for each read's length and keeps the answer; the passes after it read the fixture.
  const reads: Record<string, number | null> = {};
  const ask = (_: object, h: string | symbol) =>
    typeof h === 'string' ? (reads[h] = store.blobLength(h as Hash)) : null;
  const asking: Ledger = { ...ledger, reads: new Proxy({}, { get: ask }) };
  const times = [now, plusHours(now, 1000)];
  for (const at of times) expectOf(layerOver(asking, at), asking);
  for (const h of Object.keys(reads).sort()) ledger.reads[h] = reads[h]!;
  return fixtureOver(name, description, ledger, times);
}

/** A ledger as a fixture: what the layer says of it at each time, read over the ledger as its JSON gives it back. */
export function fixtureOver(name: string, description: string, ledger: Ledger, times: string[]): ReadingFixture {
  const fixture: ReadingFixture = {
    name,
    description,
    reading: 2,
    ledger: JSON.parse(JSON.stringify(ledger)) as Ledger,
    readings: [],
  };
  fixture.readings = times.map((at) => ({ now: at, expect: expectOf(layerOver(fixture.ledger, at), fixture.ledger) }));
  return fixture;
}

/** One problem's envelope and receipts, built by hand with no tracker, as a ledger with nothing else in it. */
export function ledgerOf(envelope: Envelope, lines: Receipt[]): Ledger {
  return { identity: [], problems: [{ envelope, lines }], blobs: {}, coin: null, founding: {}, reads: {} };
}

/** Whether a fixture of this name is kept already. */
export function kept(name: string): boolean {
  return existsSync(join(READING_DIR, `${name}.json`));
}

/** Writes a fixture under the folder, by its name, and says whether it was small enough to keep. */
export function writeFixture(f: ReadingFixture): boolean {
  const text = `${JSON.stringify(f)}\n`;
  if (text.length > FIXTURE_MAX) return false;
  mkdirSync(READING_DIR, { recursive: true });
  writeFileSync(join(READING_DIR, `${f.name}.json`), text);
  return true;
}

/** Every fixture of reading 2, in name order. */
export function loadReadings(): ReadingFixture[] {
  let names: string[] = [];
  try {
    names = readdirSync(READING_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return names.sort().map((f) => JSON.parse(readFileSync(join(READING_DIR, f), 'utf8')) as ReadingFixture);
}
