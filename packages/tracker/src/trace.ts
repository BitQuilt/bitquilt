/**
 * The trace (QX-19): what a return rests on. Beside its reveal a key posts the reads it made, each kept as a blob under
 * its hash, and for each field of the return the read and the span of it the value rests on. The door checks the shape
 * and that every read is held (section 1); the layer grades an accepted square by whether both of its reveals rest on
 * kept reads (section 3) and, where reveals differ, says why from the traces, pair by pair, and which readings rest on
 * nothing where another rests on the record (section 4): those the layer sets aside (challenge.ts). Pure over the
 * fold, the receipts, and a way to measure and read a blob. Nothing here changes what the core calls a piece.
 */
import { type Address, type Event, type Hash, type PieceView, type Receipt, type Reveal, type State, agreeFields, earliestReceipt, eventId, isHash, returnsAgree } from '@bitquilt/core';

export const TRACE = 'QX-19';
export const TRACE_EVENTS: ReadonlySet<string> = new Set(['trace']);
export const READS_MAX = 16;
export const RESTS_MAX = 64;
export const URL_MAX = 2048;
export const MEDIA_MAX = 100;
/** The longest span, in bytes: a passage, not a page. */
export const SPAN_MAX = 2000;
/** The most a read's blob weighs. */
export const BLOB_MAX = 1024 * 1024;

export interface Read { url: string; hash: Hash; at: string; media?: string }
export interface Rest { field: string; read: number; span: [number, number] }
export interface TraceBody { reveal: Hash; reads: Read[]; rests: Rest[] }
export interface TraceView extends TraceBody { id: Hash; key: Address; at: string }
export type Traced = 'both' | 'one' | 'none';
export type SeamWhy = 'source' | 'span' | 'reading' | 'unknown';
/** One reading's side of a seam; `aside` says the layer folds the piece without it (section 4). */
export interface SeamSide { key: Address; value: unknown; read: Read | null; span: [number, number] | null; passage: string | null; aside: boolean }
export interface Seam { field: string; why: SeamWhy; sides: [SeamSide, SeamSide] }
/** A piece's traces, its grade, its seams, and the ids of the reveals set aside, where there are any (section 4). */
export interface PieceTraces { traces: TraceView[]; traced: Traced | null; seams: Seam[]; aside: Hash[] }
export type Admission = { ok: true } | { ok: false; why: string };

const isTime = (s: unknown): s is string => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const isWhole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

/** Why this is not a well-formed trace body, or nothing; the reveal and the blobs are checked by `admitTrace`. */
export function traceBodyProblems(body: unknown): string[] {
  const b = body as Partial<TraceBody> | null;
  if (!b || typeof b !== 'object') return ['body: an object'];
  if (!isHash(b.reveal)) return ["body.reveal: the id of this key's reveal on the piece"];
  if (!Array.isArray(b.reads) || b.reads.length < 1 || b.reads.length > READS_MAX) return [`body.reads: 1 to ${READS_MAX} reads`];
  for (const [i, r] of b.reads.entries()) {
    if (!r || typeof r !== 'object' || typeof r.url !== 'string' || r.url.length < 1 || r.url.length > URL_MAX || !isHash(r.hash) || !isTime(r.at)) return [`read ${i}: url, hash and at`];
    if (r.media !== undefined && (typeof r.media !== 'string' || r.media.length > MEDIA_MAX)) return [`read ${i}: media is a short string`];
  }
  if (!Array.isArray(b.rests) || b.rests.length < 1 || b.rests.length > RESTS_MAX) return [`body.rests: 1 to ${RESTS_MAX} rests`];
  for (const [i, x] of b.rests.entries()) {
    if (!x || typeof x !== 'object' || typeof x.field !== 'string' || x.field.length < 1 || x.field.length > 200) return [`rest ${i}: a field name`];
    if (!isWhole(x.read) || x.read >= b.reads.length) return [`rest ${i}: read out of range`];
    if (!Array.isArray(x.span) || x.span.length !== 2 || !isWhole(x.span[0]) || !isWhole(x.span[1]) || x.span[0] >= x.span[1] || x.span[1] - x.span[0] > SPAN_MAX) return [`rest ${i}: span is [start, end) with end at most ${SPAN_MAX} past start`];
  }
  return [];
}

/** The kept reveals on a piece by the id of their event; a dropped reveal has no entry, so a trace naming it is dropped too. */
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

/** Whether a trace by this key would be kept on this piece, and why not (section 1); `kept` are the traces already on the piece. */
export function admitTrace(view: PieceView, receipts: Receipt[], event: Event, kept: readonly TraceView[], blobLength: (hash: Hash) => number | null): Admission {
  const shape = traceBodyProblems(event.body);
  if (shape.length) return { ok: false, why: shape[0]! };
  const body = event.body as unknown as TraceBody;
  const reveal = revealsById(view, receipts).get(body.reveal);
  if (!reveal || reveal.key !== event.key) return { ok: false, why: "body.reveal: the id of this key's reveal on the piece" };
  if (kept.some((t) => t.reveal === body.reveal)) return { ok: false, why: 'a trace already names this reveal' };
  const fields = new Set(Object.keys(reveal.return as Record<string, unknown>));
  for (const [i, x] of body.rests.entries()) if (!fields.has(x.field)) return { ok: false, why: `rest ${i}: ${x.field} is not a field of the return` };
  for (const [i, r] of body.reads.entries()) {
    const n = blobLength(r.hash);
    if (n === null) return { ok: false, why: `read ${i}: no such blob here; put it first` };
    for (const [j, x] of body.rests.entries()) if (x.read === i && x.span[1] > n) return { ok: false, why: `rest ${j}: span outside the read` };
  }
  return { ok: true };
}

/**
 * Every two reveals from unrelated roots that differ on an agreed field, pair by pair in the order they were kept. A
 * piece with three readings has up to three pairs, and each is judged on its own (section 4); until 2 November 2026
 * the first pair alone was, and a third reading that rested on the record counted for nothing.
 */
function disputingPairs(fold: State, view: PieceView, fields: string[]): [Reveal, Reveal][] {
  const schema = view.piece.schema;
  if (!schema) return [];
  const rs = view.reveals;
  const pairs: [Reveal, Reveal][] = [];
  for (let i = 0; i < rs.length; i += 1) for (let j = i + 1; j < rs.length; j += 1) {
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
 * reads the same; the square's grade (section 3); and, where the piece is disputed, its seams, pair by pair, and the
 * reveals to set aside: in each pair, the side that rests on nothing on every field the two differ on, where the other
 * rests on a kept read on each (section 4). `passage` reads a span of a blob as text, or null where the blob is not here.
 */
export function pieceTraces(fold: State, view: PieceView, receipts: Receipt[], blobLength: (hash: Hash) => number | null, passage: (hash: Hash, span: [number, number]) => string | null): PieceTraces {
  const traces: TraceView[] = [];
  const ordered = receipts.map((r) => ({ r, at: earliestReceipt(r) ?? '' })).sort((x, y) => x.at.localeCompare(y.at));
  for (const { r, at } of ordered) {
    const e = r.event;
    if (e.type !== 'trace' || e.piece !== view.piece.hash) continue;
    if (!admitTrace(view, receipts, e, traces, blobLength).ok) continue;
    const b = e.body as unknown as TraceBody;
    traces.push({ id: eventId(e), key: e.key, at, reveal: b.reveal, reads: b.reads, rests: b.rests });
  }
  const byId = revealsById(view, receipts);
  const traceOf = (rv: Reveal): TraceView | null => traces.find((t) => {
    const k = byId.get(t.reveal);
    return k !== undefined && k.key === rv.key && k.at === rv.at;
  }) ?? null;
  const fields = view.piece.schema ? agreeFields(view.piece.schema, view.piece.agree) : [];
  const restFor = (t: TraceView | null, field: string): Rest | null => t?.rests.find((x) => x.field === field) ?? null;
  const tracedReveal = (rv: Reveal): boolean => {
    const t = traceOf(rv);
    return t !== null && fields.every((f) => restFor(t, f) !== null);
  };
  let traced: Traced | null = null;
  if (view.accepting?.kind === 'agree') {
    const n = view.accepting.reveals.filter(tracedReveal).length;
    traced = n === 2 ? 'both' : n === 1 ? 'one' : 'none';
  }
  const seams: Seam[] = [];
  const aside: Hash[] = [];
  const pairs = view.state === 'disputed' ? disputingPairs(fold, view, fields) : [];
  if (pairs.length && view.piece.schema) {
    const schema = view.piece.schema;
    const side = (rv: Reveal, field: string): SeamSide => {
      const t = traceOf(rv);
      const rest = restFor(t, field);
      const read = rest && t ? t.reads[rest.read] ?? null : null;
      return { key: rv.key, value: (rv.return as Record<string, unknown>)[field], read, span: rest ? rest.span : null, passage: rest && read ? passage(read.hash, rest.span) : null, aside: false };
    };
    // Section 4: a reading that rests on nothing loses to one that rests on the record. In each pair, the side with no
    // rest on any field the two differ on, where the other side rests each on a kept read, loses; mixed, neither does.
    // A reading that loses any pair is set aside, and every seam it is a side of says so.
    const grounded = (s: SeamSide) => s.read !== null && s.span !== null;
    const losers = new Set<Reveal>();
    const owners: [Reveal, Reveal][] = [];
    for (const pair of pairs) {
      const own: Seam[] = [];
      for (const f of fields) {
        if (returnsAgree(schema, [f], pair[0].return, pair[1].return)) continue;
        const a = side(pair[0], f);
        const b = side(pair[1], f);
        own.push({ field: f, why: whyOf(a, b), sides: [a, b] });
      }
      const loses = (i: 0 | 1) => own.length > 0 && own.every((s) => !grounded(s.sides[i]) && grounded(s.sides[i === 0 ? 1 : 0]));
      if (loses(0)) losers.add(pair[0]);
      else if (loses(1)) losers.add(pair[1]);
      for (const s of own) {
        seams.push(s);
        owners.push(pair);
      }
    }
    for (const [id, rv] of byId) if (losers.has(rv)) aside.push(id);
    seams.forEach((s, i) => {
      if (losers.has(owners[i]![0])) s.sides[0].aside = true;
      if (losers.has(owners[i]![1])) s.sides[1].aside = true;
    });
  }
  return { traces, traced, seams, aside };
}
