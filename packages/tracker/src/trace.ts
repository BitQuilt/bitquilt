/**
 * The trace (QX-19): what a return rests on. Beside its reveal a key posts the reads it made, each kept as a blob under
 * its hash, and for each field of the return the read and the span of it the value rests on. The door checks the shape
 * and that every read is held (section 1); the layer grades an accepted square by whether both of its reveals rest on
 * kept reads (section 3) and, where reveals differ, says why from the traces, pair by pair, and which readings rest on
 * nothing where another rests on the record (section 4): those the layer sets aside (challenge.ts). On a record piece
 * (QX-20) the same traces grade the standing readings and give the seams between them, with nothing set aside, and
 * the record document states each reading with its trace as the chain has it. Which fold each piece of a problem is
 * read over, for the state and for `next`, is said here too (`problemTraces`), and so are a complete problem's record
 * output (`recordOutput`) and what each reading rests on, field by field with its passage, for any page that shows a
 * reading. Pure over the fold, the receipts, and a way to measure and read a blob. Nothing here changes what the core
 * calls a piece.
 */
import {
  type Address,
  type Event,
  type Hash,
  type PieceView,
  type Receipt,
  type Reveal,
  type Schema,
  type State,
  agreeFields,
  earliestReceipt,
  eventId,
  hashCanonical,
  isHash,
  isTime,
  returnsAgree,
  whole,
} from '@bitquilt/core';
import type { Admission, ProblemLayer } from './challenge.js';
import type { RecordView } from './verifiers.js';

export const TRACE = 'QX-19';
export const RECORD = 'QX-20';
export const TRACE_EVENTS: ReadonlySet<string> = new Set(['trace']);
export const READS_MAX = 16;
export const RESTS_MAX = 64;
export const URL_MAX = 2048;
export const MEDIA_MAX = 100;
/** The longest span, in bytes: a passage, not a page. */
export const SPAN_MAX = 2000;
/** The most a read's blob weighs. */
export const BLOB_MAX = 1024 * 1024;

export interface Read {
  url: string;
  hash: Hash;
  at: string;
  media?: string;
}
export interface Rest {
  field: string;
  read: number;
  span: [number, number];
}
export interface TraceBody {
  reveal: Hash;
  reads: Read[];
  rests: Rest[];
}
export interface TraceView extends TraceBody {
  id: Hash;
  key: Address;
  at: string;
}
export type Traced = 'both' | 'one' | 'none';
export type SeamWhy = 'source' | 'span' | 'reading' | 'unknown';
/** One reading's side of a seam; `aside` says the layer folds the piece without it (section 4). */
export interface SeamSide {
  key: Address;
  value: unknown;
  read: Read | null;
  span: [number, number] | null;
  passage: string | null;
  aside: boolean;
}
export interface Seam {
  field: string;
  why: SeamWhy;
  sides: [SeamSide, SeamSide];
}
/**
 * QX-20 section 3: a record piece's grade: the readings wanted and standing, how many rest every agreed field on a kept
 * read, from how many roots and vendors, and the keys that signed the standing ones.
 */
export interface RecordGrade {
  wanted: number;
  standing: number;
  grounded: number;
  roots: number;
  vendors: number;
  keys: Address[];
}
/**
 * A piece's traces, its grade, its seams, the ids of the reveals set aside, where there are any (section 4), and on a
 * record piece its grade (QX-20).
 */
export interface PieceTraces {
  traces: TraceView[];
  traced: Traced | null;
  seams: Seam[];
  aside: Hash[];
  record: RecordGrade | null;
}
/**
 * What a reading rests one field on: the read's address and the hash it was kept under, the span, and the passage as
 * text where the read's bytes are held, or null where they are not.
 */
export interface RestedOn {
  field: string;
  url: string;
  hash: Hash;
  span: [number, number];
  passage: string | null;
}

/** Why this is not a well-formed trace body, or nothing; the reveal and the blobs are checked by `admitTrace`. */
export function traceBodyProblems(body: unknown): string[] {
  const b = body as Partial<TraceBody> | null;
  if (!b || typeof b !== 'object') return ['body: an object'];
  if (!isHash(b.reveal)) return ["body.reveal: the id of this key's reveal on the piece"];
  if (!Array.isArray(b.reads) || b.reads.length < 1 || b.reads.length > READS_MAX)
    return [`body.reads: 1 to ${READS_MAX} reads`];
  for (const [i, r] of b.reads.entries()) {
    if (
      !r ||
      typeof r !== 'object' ||
      typeof r.url !== 'string' ||
      r.url.length < 1 ||
      r.url.length > URL_MAX ||
      !isHash(r.hash) ||
      !isTime(r.at)
    )
      return [`read ${i}: url, hash and at`];
    if (r.media !== undefined && (typeof r.media !== 'string' || r.media.length > MEDIA_MAX))
      return [`read ${i}: media is a short string`];
  }
  if (!Array.isArray(b.rests) || b.rests.length < 1 || b.rests.length > RESTS_MAX)
    return [`body.rests: 1 to ${RESTS_MAX} rests`];
  for (const [i, x] of b.rests.entries()) {
    if (!x || typeof x !== 'object' || typeof x.field !== 'string' || x.field.length < 1 || x.field.length > 200)
      return [`rest ${i}: a field name`];
    if (!whole(x.read, 0) || x.read >= b.reads.length) return [`rest ${i}: read out of range`];
    if (
      !Array.isArray(x.span) ||
      x.span.length !== 2 ||
      !whole(x.span[0], 0) ||
      !whole(x.span[1], 0) ||
      x.span[0] >= x.span[1] ||
      x.span[1] - x.span[0] > SPAN_MAX
    )
      return [`rest ${i}: span is [start, end) with end at most ${SPAN_MAX} past start`];
  }
  return [];
}

/**
 * The hashes a trace event's reads name, in the body's order, as the body states them and unchecked; none for any other
 * event. A door pulling a peer's chain and a keeper taking one fetch the reads they lack by these (QX-21 section 2),
 * each with its own check of the hash and its own report. A body whose reads are not a list fails as a loop over it
 * does, at the read that does not parse.
 */
export function* readsNamed(event: Event): Generator<unknown> {
  if (event.type !== 'trace') return;
  for (const read of (event.body as { reads?: { hash?: unknown }[] }).reads ?? []) yield read.hash;
}

/**
 * The kept reveals on a piece by the id of their event; a dropped reveal has no entry, so a trace naming it is dropped
 * too.
 */
function revealsById(view: PieceView, receipts: Receipt[]): Map<Hash, Reveal> {
  const out = new Map<Hash, Reveal>();
  for (const r of receipts) {
    const e = r.event;
    if (e.type !== 'reveal' || e.piece !== view.piece.hash) continue;
    const at = earliestReceipt(r);
    const kept = view.reveals.find((x) => x.key === e.key && x.at === at);
    if (kept) out.set(eventId(e), kept);
  }
  return out;
}

/**
 * Whether a trace by this key would be kept on this piece, and why not (section 1); `kept` are the traces already on
 * the piece.
 */
export function admitTrace(
  view: PieceView,
  receipts: Receipt[],
  event: Event,
  kept: readonly TraceView[],
  blobLength: (hash: Hash) => number | null,
): Admission {
  const shape = traceBodyProblems(event.body);
  if (shape.length) return { ok: false, why: shape[0]! };
  const body = event.body as unknown as TraceBody;
  const reveal = revealsById(view, receipts).get(body.reveal);
  if (!reveal || reveal.key !== event.key)
    return { ok: false, why: "body.reveal: the id of this key's reveal on the piece" };
  if (kept.some((t) => t.reveal === body.reveal)) return { ok: false, why: 'a trace already names this reveal' };
  const fields = new Set(Object.keys(reveal.return as Record<string, unknown>));
  for (const [i, x] of body.rests.entries())
    if (!fields.has(x.field)) return { ok: false, why: `rest ${i}: ${x.field} is not a field of the return` };
  for (const [i, r] of body.reads.entries()) {
    const n = blobLength(r.hash);
    if (n === null) return { ok: false, why: `read ${i}: no such blob here; put it first` };
    for (const [j, x] of body.rests.entries())
      if (x.read === i && x.span[1] > n) return { ok: false, why: `rest ${j}: span outside the read` };
  }
  return { ok: true };
}

/**
 * Every two of the reveals given, from unrelated roots, that differ on an agreed field, pair by pair in the order they
 * were kept. A piece with three readings has up to three pairs, and each is judged on its own (section 4); until
 * 2 November 2026 the first pair alone was, and a third reading that rested on the record counted for nothing.
 */
function disputingPairs(fold: State, schema: Schema, fields: string[], rs: readonly Reveal[]): [Reveal, Reveal][] {
  const pairs: [Reveal, Reveal][] = [];
  for (let i = 0; i < rs.length; i += 1)
    for (let j = i + 1; j < rs.length; j += 1) {
      const a = rs[i]!;
      const b = rs[j]!;
      if (fold.related(a.root, b.root, b.at)) continue;
      if (!returnsAgree(schema, fields, a.return, b.return)) pairs.push([a, b]);
    }
  return pairs;
}

/** Why two sides differ, read from what each rests on (section 4). */
function whyOf(a: SeamSide, b: SeamSide): SeamWhy {
  if (!a.read || !b.read || !a.span || !b.span) return 'unknown';
  if (a.read.hash !== b.read.hash) return 'source';
  const overlap = a.span[0] < b.span[1] && b.span[0] < a.span[1];
  return overlap ? 'reading' : 'span';
}

/**
 * A piece's traces in receipt order, each held to section 1 as the door holds it, so a ledger another door admitted
 * reads the same. Over the fold the door reduces, the core's: a trace names a reveal, and the core's fold has them all.
 */
export function tracesKept(
  view: PieceView,
  receipts: Receipt[],
  blobLength: (hash: Hash) => number | null,
): TraceView[] {
  const traces: TraceView[] = [];
  const ordered = receipts.map((r) => ({ r, at: earliestReceipt(r) ?? '' })).sort((x, y) => x.at.localeCompare(y.at));
  for (const { r, at } of ordered) {
    const e = r.event;
    if (e.type !== 'trace' || e.piece !== view.piece.hash) continue;
    if (!admitTrace(view, receipts, e, traces, blobLength).ok) continue;
    const b = e.body as unknown as TraceBody;
    traces.push({ id: eventId(e), key: e.key, at, reveal: b.reveal, reads: b.reads, rests: b.rests });
  }
  return traces;
}

/**
 * The traces as the chain states them, whether or not the reads are held here: every blob measured as long as any span
 * asks. What the record document (QX-20 section 4) carries, so that a mirror with no blobs writes the same document as
 * the tracker that kept them; whether the bytes are held is the state route's word, not the document's.
 */
export function tracesStated(view: PieceView, receipts: Receipt[]): TraceView[] {
  return tracesKept(view, receipts, () => Number.MAX_SAFE_INTEGER);
}

/** The trace on a reveal, by the reveal's key and time, or null; and the rest a trace gives a field, or null. */
function matching(
  view: PieceView,
  receipts: Receipt[],
  traces: readonly TraceView[],
): {
  byId: Map<Hash, Reveal>;
  traceOf: (rv: Reveal) => TraceView | null;
  restFor: (t: TraceView | null, field: string) => Rest | null;
} {
  const byId = revealsById(view, receipts);
  return {
    byId,
    traceOf: (rv) =>
      traces.find((t) => {
        const k = byId.get(t.reveal);
        return k !== undefined && k.key === rv.key && k.at === rv.at;
      }) ?? null,
    restFor: (t, field) => t?.rests.find((x) => x.field === field) ?? null,
  };
}

/** Section 3's rule for one reveal: it rests every agreed field on a kept read. */
function restsAll(
  t: TraceView | null,
  fields: readonly string[],
  restFor: (t: TraceView | null, field: string) => Rest | null,
): boolean {
  return t !== null && fields.every((f) => restFor(t, f) !== null);
}

/**
 * The square's grade (section 3), over the fold whose accepting set counts: `both`, `one` or `none` of its reveals rest
 * every agreed field on a kept read; null where no two reveals accept the piece.
 */
export function graded(view: PieceView, receipts: Receipt[], traces: readonly TraceView[]): Traced | null {
  if (view.accepting?.kind !== 'agree') return null;
  const { traceOf, restFor } = matching(view, receipts, traces);
  const fields = view.piece.schema ? agreeFields(view.piece.schema, view.piece.agree) : [];
  const n = view.accepting.reveals.filter((rv) => restsAll(traceOf(rv), fields, restFor)).length;
  return n === 2 ? 'both' : n === 1 ? 'one' : 'none';
}

/**
 * QX-20 section 3: a record piece's grade over its standing readings, by the same rule as a square's: each is grounded
 * when its trace rests every agreed field on a kept read.
 */
export function recordGraded(
  view: PieceView,
  record: RecordView,
  receipts: Receipt[],
  traces: readonly TraceView[],
): RecordGrade {
  const { traceOf, restFor } = matching(view, receipts, traces);
  const fields = view.piece.schema ? agreeFields(view.piece.schema, view.piece.agree) : [];
  const standing = record.standing;
  return {
    wanted: record.wanted,
    standing: standing.length,
    grounded: standing.filter((rv) => restsAll(traceOf(rv), fields, restFor)).length,
    roots: new Set(standing.map((r) => r.root)).size,
    vendors: new Set(standing.map((r) => r.vendor)).size,
    keys: standing.map((r) => r.key),
  };
}

/** The seams between two readings: one per agreed field they differ on, each side with what it rests on. */
function pairSeams(
  schema: Schema,
  fields: readonly string[],
  pair: [Reveal, Reveal],
  side: (rv: Reveal, field: string) => SeamSide,
): Seam[] {
  const own: Seam[] = [];
  for (const f of fields) {
    if (returnsAgree(schema, [f], pair[0].return, pair[1].return)) continue;
    const a = side(pair[0], f);
    const b = side(pair[1], f);
    own.push({ field: f, why: whyOf(a, b), sides: [a, b] });
  }
  return own;
}

/**
 * One reading's side of a seam on a field: the key, the value, and the read, span and passage its trace gives the
 * field.
 */
function sideOf(
  view: PieceView,
  receipts: Receipt[],
  traces: readonly TraceView[],
  passage: (hash: Hash, span: [number, number]) => string | null,
): (rv: Reveal, field: string) => SeamSide {
  const { traceOf, restFor } = matching(view, receipts, traces);
  return (rv, field) => {
    const t = traceOf(rv);
    const rest = restFor(t, field);
    const read = rest && t ? (t.reads[rest.read] ?? null) : null;
    return {
      key: rv.key,
      value: (rv.return as Record<string, unknown>)[field],
      read,
      span: rest ? rest.span : null,
      passage: rest && read ? passage(read.hash, rest.span) : null,
      aside: false,
    };
  };
}

/**
 * A span of a read's bytes as text, or null where the bytes are not held: one way to read a passage, for the seams and
 * the square page alike.
 */
export function passageIn(bytes: Uint8Array | null, span: [number, number]): string | null {
  return bytes ? new TextDecoder().decode(bytes.subarray(span[0], span[1])) : null;
}

/**
 * What each reading on a piece rests on, field by field in its trace's order, from the traces as the chain states them
 * (`tracesStated`), so a rest whose read's bytes are not held here still names the page and the hash it was kept under,
 * with no passage. `receipts` are the lines of every version of the chain the view was folded from: a reading made
 * under an earlier version keeps its trace on that version's log. A reading with no trace rests on nothing.
 * `passage` reads a span of a blob as text, or null where the blob is not here.
 */
export function restsOf(
  view: PieceView,
  receipts: Receipt[],
  passage: (hash: Hash, span: [number, number]) => string | null,
): (rv: Reveal) => RestedOn[] {
  const { traceOf } = matching(view, receipts, tracesStated(view, receipts));
  return (rv) => {
    const t = traceOf(rv);
    if (!t) return [];
    return t.rests.map((x) => {
      const read = t.reads[x.read]!;
      return { field: x.field, url: read.url, hash: read.hash, span: x.span, passage: passage(read.hash, x.span) };
    });
  };
}

/**
 * Where the fold calls the piece disputed, its seams, pair by pair, and the reveals to set aside (section 4): in each
 * pair, the side that rests on nothing on every field the two differ on, where the other rests on a kept read on each,
 * loses; mixed, neither does. A reading that loses any pair is set aside, and every seam it is a side of says so.
 * `passage` reads a span of a blob as text, or null where the blob is not here.
 */
export function seamed(
  fold: State,
  view: PieceView,
  receipts: Receipt[],
  traces: readonly TraceView[],
  passage: (hash: Hash, span: [number, number]) => string | null,
): { seams: Seam[]; aside: Hash[] } {
  const seams: Seam[] = [];
  const aside: Hash[] = [];
  const schema = view.piece.schema;
  if (!schema || view.state !== 'disputed') return { seams, aside };
  const fields = agreeFields(schema, view.piece.agree);
  const pairs = disputingPairs(fold, schema, fields, view.reveals);
  if (pairs.length === 0) return { seams, aside };
  const side = sideOf(view, receipts, traces, passage);
  const grounded = (s: SeamSide) => s.read !== null && s.span !== null;
  const losers = new Set<Reveal>();
  const owners: [Reveal, Reveal][] = [];
  for (const pair of pairs) {
    const own = pairSeams(schema, fields, pair, side);
    const loses = (i: 0 | 1) =>
      own.length > 0 && own.every((s) => !grounded(s.sides[i]) && grounded(s.sides[i === 0 ? 1 : 0]));
    if (loses(0)) losers.add(pair[0]);
    else if (loses(1)) losers.add(pair[1]);
    for (const s of own) {
      seams.push(s);
      owners.push(pair);
    }
  }
  const { byId } = matching(view, receipts, traces);
  for (const [id, rv] of byId) if (losers.has(rv)) aside.push(id);
  seams.forEach((s, i) => {
    if (losers.has(owners[i]![0])) s.sides[0].aside = true;
    if (losers.has(owners[i]![1])) s.sides[1].aside = true;
  });
  return { seams, aside };
}

/**
 * QX-20 section 3: the seams between a record piece's standing readings, pair by pair, on every agreed field two of
 * them differ on, each side with what it rests on. No side is set aside: on a record piece the seams are the content,
 * and a reading that rests on nothing stands and says so.
 */
export function recordSeams(
  fold: State,
  view: PieceView,
  record: RecordView,
  receipts: Receipt[],
  traces: readonly TraceView[],
  passage: (hash: Hash, span: [number, number]) => string | null,
): Seam[] {
  const schema = view.piece.schema;
  if (!schema) return [];
  const fields = agreeFields(schema, view.piece.agree);
  const side = sideOf(view, receipts, traces, passage);
  return disputingPairs(fold, schema, fields, record.standing).flatMap((pair) => pairSeams(schema, fields, pair, side));
}

/**
 * The three over one fold: the traces kept, the grade, and the seams with the reveals to set aside. The layer's fold is
 * asked this way (challenge.ts); a problem's pieces with the fold each is read over and a record piece's grade are
 * `problemTraces`'s.
 */
export function pieceTraces(
  fold: State,
  view: PieceView,
  receipts: Receipt[],
  blobLength: (hash: Hash) => number | null,
  passage: (hash: Hash, span: [number, number]) => string | null,
): PieceTraces {
  const traces = tracesKept(view, receipts, blobLength);
  return {
    traces,
    traced: graded(view, receipts, traces),
    ...seamed(fold, view, receipts, traces, passage),
    record: null,
  };
}

/**
 * Each piece's traces on a problem as the door kept them, over the core's fold, which has every reveal a trace could
 * name; the square's grade over the layer's fold, whose accepting set is the one that counts; and its seams between the
 * readings that stand (section 4): over the layer's fold where it still calls the piece disputed, so a key that read
 * again with grounds after its first reading was set aside is a side and not the reading set aside, and over the
 * core's fold where the layer has set a reading aside, so the seam shows which. What the state, the directory row,
 * a key's work and `next` show. `blobLength` measures a read and `passageOf` reads a span of it as text, or null
 * where the blob is not here.
 */
export function problemTraces(
  pl: ProblemLayer,
  blobLength: (hash: Hash) => number | null,
  passageOf: (hash: Hash, span: [number, number]) => string | null,
): Map<Hash, PieceTraces> {
  const receipts = pl.receipts;
  const out = new Map(
    pl.fold.pieces.map((v) => {
      const core = pl.core.byHash.get(v.piece.hash) ?? v;
      const traces = tracesKept(core, receipts, blobLength);
      // QX-20 section 3: a record piece's seams are between its standing readings, with nothing set aside, and its
      // grade is over them.
      const record = pl.byHash.get(v.piece.hash)?.record ?? null;
      const over = record
        ? { seams: recordSeams(pl.fold, v, record, receipts, traces, passageOf), aside: [] as Hash[] }
        : v.state === 'disputed'
          ? seamed(pl.fold, v, receipts, traces, passageOf)
          : seamed(pl.core, core, receipts, traces, passageOf);
      return [
        v.piece.hash,
        {
          traces,
          traced: graded(v, receipts, traces),
          ...over,
          record: record ? recordGraded(v, record, receipts, traces) : null,
        },
      ] as const;
    }),
  );
  return out;
}

/**
 * QX-20 section 4: the record document of a problem with a record piece once the layer calls it complete, with its
 * hash; null otherwise. The tracker's state answers the hash as `record_output` and the mirror writes the document
 * under `outputs/`, so the two are the same where the chains are.
 */
export function recordOutput(pl: ProblemLayer): { document: unknown; hash: Hash } | null {
  const records = new Map(pl.pieces.filter((p) => p.record).map((p) => [p.hash, p.record!] as const));
  if (records.size === 0 || !pl.fold.complete) return null;
  return recordDocument(pl.problem, pl.fold, records, pl.receipts);
}

/**
 * QX-20 section 4: the record document of a complete problem, one entry per piece in file order as the core's output
 * has it (CORE.md section 6), with a record piece's entry carrying its standing readings: the signer's root and key,
 * the vendor and model declared, the time, the return whole, and the trace as the chain states it, or null. A function
 * of the envelope and the receipts alone, so a mirror writes the same document and the same hash as the tracker.
 */
export function recordDocument(
  problem: Hash,
  fold: State,
  records: ReadonlyMap<Hash, RecordView>,
  receipts: Receipt[],
): { document: unknown; hash: Hash } {
  const pieces = fold.pieces.map((v) => {
    const base = { name: v.piece.name, piece: v.piece.hash, state: v.state };
    const rec = records.get(v.piece.hash);
    if (rec) {
      const traces = tracesStated(v, receipts);
      const { traceOf } = matching(v, receipts, traces);
      const readings = rec.standing.map((r) => {
        const t = traceOf(r);
        return {
          signer: r.root,
          key: r.key,
          vendor: r.vendor,
          model: r.by.model,
          at: r.at,
          return: r.return,
          trace: t ? { reads: t.reads, rests: t.rests } : null,
        };
      });
      return { ...base, wanted: rec.wanted, readings };
    }
    if (!v.accepting) return base;
    if (v.accepting.kind === 'agree') {
      const fields = agreeFields(v.piece.schema!, v.piece.agree);
      const agreed: Record<string, unknown> = {};
      for (const f of fields) agreed[f] = v.accepting.reveals[0].return[f];
      const evidence = v.accepting.reveals.map((r) => {
        const rest: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(r.return)) if (!fields.includes(k)) rest[k] = val;
        return { signer: r.root, ...rest };
      });
      return { ...base, agreed, evidence };
    }
    return {
      ...base,
      patch: v.accepting.patch.return.patch,
      author: v.accepting.patch.root,
      runs: v.accepting.runs.map((r) => ({
        signer: r.root,
        exit: r.exit,
        score: r.score,
        image: r.image,
        host: r.host,
      })),
    };
  });
  const document = { quilt: 1, problem, extension: RECORD, pieces };
  return { document, hash: hashCanonical(document) };
}
