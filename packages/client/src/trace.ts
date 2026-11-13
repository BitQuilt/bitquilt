/**
 * The trace (QX-19) from the client's side: what a return rests on. A rest names a field, the page it rests on and the
 * words on it. The client fetches the page once, draws its text, keeps the text as the read, finds the passage in it,
 * puts the read on the problem's trackers under its hash, and after the reveal posts the trace with the spans. A
 * passage not found on the page as fetched is left out and said. Nothing a page says reaches the model: the read is
 * kept and hashed, and the only words that come back are the passage the model named itself.
 *
 * A site may answer a program with a check of the browser where the page should be. The client knows such an answer
 * by its words, asks once more after a pause, and says so where the page is still not served. Where a page could not
 * be read and another address is known to serve the same document, the client reads that one, and the read's `url`
 * is the address it came from (QX-19 section 2).
 */
import { type Hash, hashBytes } from '@bitquilt/core';
import type { Door } from './door.js';
import { Refused, publicFetch, readCapped, shared } from './public-fetch.js';
import type { Posted } from './resolver.js';

/** What the model hands in beside a field: the page and the words on it the field rests on. */
export interface RestAsked {
  field: string;
  url: string;
  passage: string;
}
/** A page fetched and drawn to text: what is kept under the hash. */
export interface ReadKept {
  url: string;
  hash: Hash;
  at: string;
  media: string;
  bytes: Uint8Array;
  text: string;
}
/**
 * What became of the rests: the trace posted or not, how many reads it names, the fields that rest on one, and the
 * rests left out with the reason.
 */
export interface TraceOutcome {
  posted: Posted | null;
  reads: number;
  rested: string[];
  missing: { field: string; url: string; why: string }[];
}

/** The most a page may weigh, as the tracker keeps a read (QX-19 section 2). */
export const READ_MAX = 1024 * 1024;
/** The longest passage, in bytes (QX-19 section 1). */
export const PASSAGE_MAX = 2000;
export const FETCH_MS = 15_000;
/** How long the client waits before it asks once more of a site that answered with a check of the browser. */
export const CHECK_PAUSE_MS = 2000;
/** Why a page is left out where its site answered with a check of the browser in the page's place. */
export const CHECKED = 'the site answered with a check of the browser, not the page';
/**
 * The words a check of the browser carries where the page should be, and the longest text taken for one: an article
 * may say any of these of something else, and an article is long.
 */
const CHECK_WORDS = [
  'checking your browser',
  'recaptcha',
  'verify you are human',
  'verifying you are human',
  'enable javascript and cookies to continue',
  'are you a robot',
];
const CHECK_TEXT_MAX = 2000;
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

/** Whether a page's text is a site's check of the browser and not the page asked for. */
export function browserCheck(text: string): boolean {
  if (text.length > CHECK_TEXT_MAX) return false;
  const lower = text.toLowerCase();
  return CHECK_WORDS.some((w) => lower.includes(w));
}

/**
 * Another address known to serve the same document, or null: an article of PubMed Central as Europe PMC serves its
 * full text, the two archives holding the open-access articles in common. PubMed Central answers many programs with a
 * check of the browser, and Europe PMC's service is made for programs.
 */
export function sameElsewhere(url: URL): string | null {
  const m = /^(?:pmc\.ncbi\.nlm\.nih\.gov|(?:www\.)?ncbi\.nlm\.nih\.gov\/pmc)\/articles\/(PMC\d+)(?:\/|$)/i.exec(
    url.hostname + url.pathname,
  );
  return m ? `https://www.ebi.ac.uk/europepmc/webservices/rest/${m[1]!.toUpperCase()}/fullTextXML` : null;
}

/** How a page is fetched where a test stands in for the pause and for the other address. */
export interface ReadOptions {
  pauseMs?: number;
  elsewhere?: (url: URL) => string | null;
}

/**
 * Where a passage sits in a read's text, in bytes, or null when it is not there; the words as written first, then
 * without regard to case.
 */
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
 * A page read for a rest, or the reason it could not be. A site's check of the browser is asked once more after a
 * pause. A page that still could not be read is read at another address known to serve the same document, where there
 * is one, and the read says the address it came from; where that fails too, the reason is the first address's.
 */
export async function fetchRead(
  url: string,
  now: string,
  options: ReadOptions = {},
): Promise<{ read: ReadKept } | { why: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { why: 'not a URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { why: 'not an http or https URL' };
  let got = await readOnce(url, now);
  if ('why' in got && got.why === CHECKED) {
    await new Promise((done) => setTimeout(done, options.pauseMs ?? CHECK_PAUSE_MS));
    got = await readOnce(url, now);
  }
  if ('read' in got) return got;
  const other = (options.elsewhere ?? sameElsewhere)(parsed);
  if (other) {
    const there = await readOnce(other, now);
    if ('read' in there) return there;
  }
  return got;
}

/**
 * A page fetched once and drawn to text, or the reason it could not be. Where the connector is shared
 * (`QUILT_READS=public`, which the hosted binary sets), it fetches on a stranger's word and serves what it kept to
 * anyone, so the GET is `publicFetch`'s, refused at a private address on every hop. In either case the body is read to
 * READ_MAX and no further, and the reason names the kind of failure and nothing the network or the page said.
 */
async function readOnce(url: string, now: string): Promise<{ read: ReadKept } | { why: string }> {
  const signal = AbortSignal.timeout(FETCH_MS);
  const accept = 'text/html, text/plain;q=0.9, */*;q=0.1';
  try {
    const r = await (shared() ? publicFetch : fetch)(url, { signal, headers: { accept }, redirect: 'follow' });
    const contentType = r.headers.get('content-type') ?? 'text/plain';
    const why = !r.ok
      ? `the page answered ${r.status}`
      : !/^(text\/|application\/(xhtml\+xml|xml|json))/i.test(contentType)
        ? 'the page is not text'
        : null;
    if (why) {
      await r.body?.cancel().catch(() => {});
      return { why };
    }
    const raw = await readCapped(r, READ_MAX);
    if (!raw) return { why: `the page is over ${READ_MAX} bytes` };
    const text = drawText(new TextDecoder().decode(raw), contentType);
    const bytes = enc.encode(text);
    if (bytes.length === 0) return { why: 'the page has no text' };
    if (browserCheck(text)) return { why: CHECKED };
    return { read: { url, hash: hashBytes(bytes), at: now, media: 'text/plain', bytes, text } };
  } catch (e) {
    if (e instanceof Refused) return { why: e.why };
    return {
      why: signal.aborted
        ? `the page did not answer within ${FETCH_MS / 1000} seconds`
        : 'the page could not be reached',
    };
  }
}

/** A read put on a tracker under its hash (QX-19 section 2); true when it took it or already had it. */
export async function putRead(tracker: string, read: ReadKept, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await fetchImpl(`${tracker}b/${read.hash}`, {
      method: 'PUT',
      body: read.bytes,
      signal: AbortSignal.timeout(FETCH_MS),
    });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * The trace behind a reveal, from the rests the model named: each page fetched once, each passage found in its text,
 * the reads put on the trackers, and the trace signed and posted to the problem's log naming the reveal. A rest whose
 * page could not be read, whose passage is not on it, or whose field the return lacks is left out and listed under
 * `missing`; with nothing left to rest on, nothing is posted. A refusal at the door comes back in `posted` and is not
 * thrown.
 */
export async function traceAfterReveal(
  door: Door,
  problem: Hash,
  piece: Hash,
  reveal: Hash,
  ret: Record<string, unknown>,
  rests: RestAsked[],
  trackers: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<TraceOutcome> {
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
      const got = await fetchRead(r.url, door.stamp());
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
    else if (span[1] - span[0] > PASSAGE_MAX)
      out.missing.push({ field: r.field, url: r.url, why: `the passage is over ${PASSAGE_MAX} bytes` });
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
  out.posted = await door.post(
    door.sign({ quilt: 1, type: 'trace', problem, piece, key: door.needKey().address, ts: door.stamp(), body }),
    problem,
    trackers,
  );
  return out;
}

/** What the tool says of the trace: nothing where none was asked, else where it went and what rests on what. */
export function traceText(t: TraceOutcome | null): string {
  if (!t) return '';
  const notFound = t.missing.length
    ? ` Left out: ${t.missing.map((m) => `${m.field} at ${m.url} (${m.why})`).join('; ')}.`
    : '';
  if (!t.posted) return `No trace was posted: nothing the return names could be found.${notFound}`.trim();
  if (t.posted.error && !t.posted.queued) return `The trace was refused: ${t.posted.error}.${notFound}`;
  return `Trace ${t.posted.queued ? 'queued' : `posted to ${t.posted.at}`}: ${t.rested.join(', ')} ${t.rested.length === 1 ? 'rests' : 'rest'} on ${t.reads} kept ${t.reads === 1 ? 'read' : 'reads'} (QX-19).${notFound}`;
}
