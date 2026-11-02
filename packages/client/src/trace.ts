/**
 * The trace (QX-19) from the client's side: what a return rests on. A rest names a field, the page it rests on and the
 * words on it. The client fetches the page once, draws its text, keeps the text as the read, finds the passage in it,
 * puts the read on the problem's trackers under its hash, and after the reveal posts the trace with the spans. A
 * passage not found on the page as fetched is left out and said. Nothing a page says reaches the model: the read is
 * kept and hashed, and the only words that come back are the passage the model named itself.
 */
import { type Hash, hashBytes } from '@bitquilt/core';
import type { Door } from './door.js';
import type { Posted } from './resolver.js';

/** What the model hands in beside a field: the page and the words on it the field rests on. */
export interface RestAsked { field: string; url: string; passage: string }
/** A page fetched and drawn to text: what is kept under the hash. */
export interface ReadKept { url: string; hash: Hash; at: string; media: string; bytes: Uint8Array; text: string }
/** What became of the rests: the trace posted or not, how many reads it names, the fields that rest on one, and the rests left out with the reason. */
export interface TraceOutcome { posted: Posted | null; reads: number; rested: string[]; missing: { field: string; url: string; why: string }[] }

/** The most a page may weigh, as the tracker keeps a read (QX-19 section 2). */
export const READ_MAX = 1024 * 1024;
/** The longest passage, in bytes (QX-19 section 1). */
export const PASSAGE_MAX = 2000;
export const FETCH_MS = 15_000;
const enc = new TextEncoder();

/** Whitespace runs as one space, trimmed: the one form a read's text and a passage are compared in. */
export const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** An HTML entity as its character, or the text as it was where it is not one. */
function entity(_: string, name: string): string {
  if (name[0] === '#') {
    const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : `&${name};`;
  }
  return ENTITIES[name.toLowerCase()] ?? `&${name};`;
}

/**
 * A page as text: for HTML, the scripts and styles dropped, block ends as line breaks, every tag taken out and the
 * entities read; for anything else the text as served; and in either case whitespace in its one form.
 */
export function drawText(body: string, contentType: string): string {
  if (!/html|xml/i.test(contentType)) return norm(body);
  const text = body
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|blockquote|pre|td|th|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#?[0-9a-zA-Z]+);/g, entity);
  return norm(text);
}

/** Where a passage sits in a read's text, in bytes, or null when it is not there; the words as written first, then without regard to case. */
export function locate(text: string, passage: string): [number, number] | null {
  const p = norm(passage);
  if (!p) return null;
  let i = text.indexOf(p);
  if (i < 0) i = text.toLowerCase().indexOf(p.toLowerCase());
  if (i < 0) return null;
  const start = enc.encode(text.slice(0, i)).length;
  return [start, start + enc.encode(text.slice(i, i + p.length)).length];
}

/**
 * Whether a host is the machine itself or a private network, by its literal address or the local name: what a shared
 * connector does not fetch from on a stranger's word (`QUILT_READS=public`, which the hosted binary sets), since a read
 * is kept and served to anyone.
 */
export function privateHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::' || h === '::1') return true;
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h.startsWith('::ffff:') ? h.slice(7) : h);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return a === 0 || a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  return /^(fc|fd|fe[89ab])/i.test(h);
}

/** A page fetched once and drawn to text, or the reason it could not be. */
export async function fetchRead(url: string, now: string, fetchImpl: typeof fetch = fetch): Promise<{ read: ReadKept } | { why: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { why: 'not a URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { why: 'not an http or https URL' };
  if (process.env.QUILT_READS === 'public' && privateHost(parsed.hostname)) return { why: 'a private address, which this connector does not fetch' };
  let r: Response;
  try {
    r = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_MS), headers: { accept: 'text/html, text/plain;q=0.9, */*;q=0.1' }, redirect: 'follow' });
  } catch (e) {
    return { why: `the page could not be fetched (${(e as Error).message})` };
  }
  if (!r.ok) return { why: `the page answered ${r.status}` };
  const contentType = r.headers.get('content-type') ?? 'text/plain';
  if (!/^(text\/|application\/(xhtml\+xml|xml|json))/i.test(contentType)) return { why: `the page is ${contentType.split(';')[0]}, not text` };
  const raw = await r.arrayBuffer();
  if (raw.byteLength > READ_MAX) return { why: `the page is over ${READ_MAX} bytes` };
  const text = drawText(new TextDecoder().decode(raw), contentType);
  const bytes = enc.encode(text);
  if (bytes.length === 0) return { why: 'the page has no text' };
  return { read: { url, hash: hashBytes(bytes), at: now, media: 'text/plain', bytes, text } };
}

/** A read put on a tracker under its hash (QX-19 section 2); true when it took it or already had it. */
export async function putRead(tracker: string, read: ReadKept, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await fetchImpl(`${tracker}b/${read.hash}`, { method: 'PUT', body: read.bytes, signal: AbortSignal.timeout(FETCH_MS) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * The trace behind a reveal, from the rests the model named: each page fetched once, each passage found in its text,
 * the reads put on the trackers, and the trace signed and posted to the problem's log naming the reveal. A rest whose
 * page could not be read, whose passage is not on it, or whose field the return lacks is left out and listed under
 * `missing`; with nothing left to rest on, nothing is posted. A refusal at the door comes back in `posted` and is not thrown.
 */
export async function traceAfterReveal(door: Door, problem: Hash, piece: Hash, reveal: Hash, ret: Record<string, unknown>, rests: RestAsked[], trackers: string[], fetchImpl: typeof fetch = fetch): Promise<TraceOutcome> {
  const out: TraceOutcome = { posted: null, reads: 0, rested: [], missing: [] };
  const reads: ReadKept[] = [];
  const index = new Map<string, number>();
  const failed = new Map<string, string>();
  const spans: { field: string; read: number; span: [number, number] }[] = [];
  for (const r of rests) {
    if (!(r.field in ret)) {
      out.missing.push({ field: r.field, url: r.url, why: 'not a field of the return' });
      continue;
    }
    if (!index.has(r.url) && !failed.has(r.url)) {
      const got = await fetchRead(r.url, door.stamp(), fetchImpl);
      if ('why' in got) failed.set(r.url, got.why);
      else {
        index.set(r.url, reads.length);
        reads.push(got.read);
      }
    }
    const why = failed.get(r.url);
    if (why !== undefined) {
      out.missing.push({ field: r.field, url: r.url, why });
      continue;
    }
    const at = index.get(r.url)!;
    const span = locate(reads[at]!.text, r.passage);
    if (!span) out.missing.push({ field: r.field, url: r.url, why: 'the passage is not on the page as fetched' });
    else if (span[1] - span[0] > PASSAGE_MAX) out.missing.push({ field: r.field, url: r.url, why: `the passage is over ${PASSAGE_MAX} bytes` });
    else {
      spans.push({ field: r.field, read: at, span });
      if (!out.rested.includes(r.field)) out.rested.push(r.field);
    }
  }
  if (spans.length === 0) return out;
  // Only the reads something rests on are kept, renumbered in the order they are first used.
  const used = [...new Set(spans.map((s) => s.read))];
  const kept = used.map((i) => reads[i]!);
  const body = {
    reveal,
    reads: kept.map((r) => ({ url: r.url, hash: r.hash, at: r.at, media: r.media })),
    rests: spans.map((s) => ({ field: s.field, read: used.indexOf(s.read), span: s.span })),
  };
  out.reads = kept.length;
  for (const t of trackers) for (const r of kept) await putRead(t, r, fetchImpl);
  out.posted = await door.post(door.sign({ quilt: 1, type: 'trace', problem, piece, key: door.needKey().address, ts: door.stamp(), body }), problem, trackers);
  return out;
}

/** What the tool says of the trace: nothing where none was asked, else where it went and what rests on what. */
export function traceText(t: TraceOutcome | null): string {
  if (!t) return '';
  const notFound = t.missing.length ? ` Left out: ${t.missing.map((m) => `${m.field} at ${m.url} (${m.why})`).join('; ')}.` : '';
  if (!t.posted) return `No trace was posted: nothing the return names could be found.${notFound}`.trim();
  if (t.posted.error && !t.posted.queued) return `The trace was refused: ${t.posted.error}.${notFound}`;
  return `Trace ${t.posted.queued ? 'queued' : `posted to ${t.posted.at}`}: ${t.rested.join(', ')} ${t.rested.length === 1 ? 'rests' : 'rest'} on ${t.reads} kept ${t.reads === 1 ? 'read' : 'reads'} (QX-19).${notFound}`;
}
