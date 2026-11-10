/**
 * The page of one square, at /r/<problem hash>/<piece hash>: what the problem's version named by the first hash records
 * of the piece named by the second, gathered here from the reader and the store (`squareView`) and built here on the
 * server (`squarePage`), every word escaped, and no script. The two hashes name the record itself, so the address keeps
 * its meaning when the owner sharpens the brief: the page says what that version recorded, then follows the versions
 * that replaced it and says where the piece stands now, and where a sharpening gave its family a new brief, quotes the
 * newer brief as the owner's words. A piece the version keeps only from an earlier version has no state there, so the
 * page names the version that holds it and says what that one recorded. Each reading is the quoted words of the key
 * that signed it, with the signer and its declared vendor named; each rest names the page it rests on and the hash it
 * was kept under, and quotes the passage where the bytes are held here. The title and the card tags say the agreed
 * answer and the vendors that agreed, or the state; a field agreed blank says so. A piece a fork inherits has its
 * square on the problem the fork came from (QX-23 section 2), so the page names that problem, says the piece's state
 * there, and links to the page of the same piece there, where the readings are.
 */
import { type Address, type Hash, problemHash } from '@bitquilt/core';
import { type RestedOn, type Store, carriesSet, passageIn, restsOf } from '@bitquilt/tracker';
import { type Quilt, inheritedOf, kindWords, makeLink } from 'quilt';

/**
 * One reading of the piece: who signed it and as what, when, the fields, what each rests on, and whether it is one of
 * the two that accepted the square or one the layer set aside.
 */
export interface SquareReading {
  key: string;
  name: string | null;
  vendor: string;
  model: string;
  at: string;
  accepting: boolean;
  aside: boolean;
  fields: [string, unknown][];
  rests: RestedOn[];
}

/**
 * Where the piece stands in the newest version: the same piece, or, after a sharpening of its family, the piece of the
 * same name and its newer brief.
 */
export type SquareNow =
  | { version: string; same: true; state: string }
  | { version: string; same: false; piece: string; state: string; brief: string };

/** Everything the page says, gathered by `squareView` and rendered by `squarePage`. */
export interface SquareView {
  url: string;
  problem: string;
  /**
   * The earlier version that holds the piece, where the version the address names keeps it only from that one; null
   * where the address's version holds it.
   */
  holder: string | null;
  title: string;
  owner: string;
  ownerName: string | null;
  piece: string;
  name: string;
  brief: string;
  state: string;
  kind: string;
  agreed: { field: string; value: unknown }[] | null;
  vendors: string[];
  traced: 'both' | 'one' | 'none' | null;
  verified: boolean;
  /**
   * QX-23 section 2: where the layer says the piece is inherited, the problem where its square stands, the piece's
   * state there, and the address of that square's page here; null for every other piece.
   */
  inherited: { problem: string; state: string; url: string } | null;
  readings: SquareReading[];
  now: SquareNow | null;
  link: string;
  directory: string;
}

/**
 * What `squareView` reads from: the on-ramp's reader, a Quilt with no key over this tracker and the relays, made at its
 * first use; the tracker's store; and the tracker's own address with its slash.
 */
export interface SquareSource {
  readerOf: () => Quilt;
  store: Store;
  trackerUrl: () => string;
}

/**
 * One square for its page: the version the address names, opened over the reader with no key, or, where that version
 * keeps the piece only as an earlier version's (CORE.md section 6, Envelopes), the newest version of its chain that
 * holds it, since an ancestral piece has no state where it is kept. The readings come from that version's fold, the two
 * that accepted the square and any the layer set aside marked; what each rests on from the traces on the lines of the
 * same chain (trace.ts, restsOf), with the passages of the reads kept here; and where the piece stands in the newest
 * version, following the replacements eight at most. Null where this tracker holds no such problem or piece, or a
 * maintainer hid the version the page reads.
 */
export async function squareView(
  { readerOf, store, trackerUrl }: SquareSource,
  problem: Hash,
  piece: Hash,
): Promise<SquareView | null> {
  const reader = readerOf();
  type Opened = Awaited<ReturnType<Quilt['open']>>;
  const openOf = async (h: Hash): Promise<Opened | null> => {
    try {
      return await reader.open(h);
    } catch {
      return null;
    }
  };
  const opened = await openOf(problem);
  if (!opened || opened.hidden || opened.hash !== problem) return null;
  let holder: Opened | null = opened;
  if (!opened.state.byHash.has(piece)) {
    if (!opened.state.ancestral.has(piece)) return null;
    holder = null;
    for (const envelope of opened.state.chain.slice(1)) {
      const o = await openOf(problemHash(envelope));
      if (o?.state.byHash.has(piece)) {
        holder = o;
        break;
      }
    }
    if (!holder || holder.hidden) return null;
  }
  const { state, layer } = holder;
  const v = state.byHash.get(piece)!;
  const l = layer?.find((x) => x.hash === piece) ?? null;
  const st: string = l?.state ?? v.state;
  const accepting = carriesSet(st) && v.accepting?.kind === 'agree' ? v.accepting : null;
  const aside = new Set((l?.aside ?? []).map((k) => k.toLowerCase()));
  const receipts = state.chain.flatMap((envelope) => store.lines(problemHash(envelope)));
  const restsFor = restsOf(v, receipts, (h, span) => passageIn(store.getBlob(h), span));
  const accepted = new Set(accepting ? accepting.reveals.map((r) => r.key.toLowerCase()) : []);
  const readings: SquareReading[] = v.reveals.map((r) => ({
    key: r.key,
    name: state.names.get(r.root)?.name ?? null,
    vendor: r.vendor,
    model: r.by.model,
    at: r.at,
    accepting: accepted.has(r.key.toLowerCase()),
    aside: aside.has(r.key.toLowerCase()),
    fields: Object.entries(r.return as Record<string, unknown>),
    rests: restsFor(r),
  }));
  // Where the piece stands now: from the versions that replaced the one the address names, and from that version
  // itself where it keeps the piece only as an earlier version's.
  let later: SquareNow | null = null;
  let newest: { hash: Hash; opened: Opened } | null = holder === opened ? null : { hash: problem, opened };
  for (let next = opened.superseded, hops = 0; next && hops < 8; hops++) {
    const o = await openOf(next);
    if (!o) break;
    newest = { hash: next, opened: o };
    next = o.superseded;
  }
  if (newest) {
    const stateIn = (h: Hash, core: string): string => newest!.opened.layer?.find((x) => x.hash === h)?.state ?? core;
    const same = newest.opened.state.byHash.get(piece);
    const named = same ? null : newest.opened.state.pieces.find((x) => x.piece.name === v.piece.name);
    if (same) later = { version: newest.hash, same: true, state: stateIn(piece, same.state) };
    else if (named)
      later = {
        version: newest.hash,
        same: false,
        piece: named.piece.hash,
        state: stateIn(named.piece.hash, named.state),
        brief: named.piece.brief,
      };
  }
  const env = opened.state.envelope.problem;
  const mark = inheritedOf(l);
  return {
    url: `${trackerUrl()}r/${problem}/${piece}`,
    problem,
    holder: holder === opened ? null : holder.hash,
    title: env.title,
    owner: env.owner,
    ownerName: opened.state.names.get(env.owner as Address)?.name ?? null,
    piece,
    name: v.piece.name,
    brief: v.piece.brief,
    state: st,
    kind: kindWords(v.piece.verifier).says,
    agreed: accepting
      ? (v.piece.agree ?? []).map((field) => ({
          field,
          value: (accepting.reveals[0].return as Record<string, unknown>)[field],
        }))
      : null,
    vendors: accepting ? [...new Set(accepting.reveals.map((r) => r.vendor))] : [],
    traced: l?.traced ?? null,
    verified: l?.verified ?? false,
    inherited: mark ? { ...mark, url: `${trackerUrl()}r/${mark.problem}/${piece}` } : null,
    readings,
    now: later,
    link: makeLink(problem, [trackerUrl()], env.slug),
    directory: `${trackerUrl()}window?reader=window/io`,
  };
}

const STATE: Record<string, string> = {
  open: 'open: nobody has read it yet',
  in_flight: 'in flight: claimed and being read',
  sealed: 'sealed: a reading is committed and not yet revealed',
  needs_verify: 'waiting for a second reading, from an AI of another company',
  disputed: 'disputed: two readings differ',
  accepted_provisional:
    'accepted by two AIs from different companies, inside the window in which anyone may challenge it',
  accepted: 'accepted by two AIs from different companies',
  challenged: 'challenged: a panel is deciding whether the acceptance stands',
  unreachable: 'unreachable: the window closed with no acceptance',
  locked: 'locked: it waits on another piece',
  recording: 'a record piece, its readings being recorded',
  recorded: 'a record piece, every reading standing',
  inherited: 'inherited: its square stands on a problem this fork came from',
};
const stateWords = (s: string): string => STATE[s] ?? s;
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const shown = (v: unknown): string =>
  typeof v === 'string' ? (v.trim() === '' ? 'a blank' : `"${v}"`) : JSON.stringify(v);
const who = (r: { key: string; name: string | null }): string => (r.name ? `${r.name} (${r.key})` : r.key);

/** The page's title: the agreed answer and the vendors that agreed, or the piece's state. */
export function squareTitle(v: SquareView): string {
  if (v.agreed && v.agreed.length)
    return `${v.name}: ${v.agreed.map((a) => `${a.field} ${shown(a.value)}`).join(', ')}, agreed by AIs from ${v.vendors.join(' and ')}`;
  return `${v.name}: ${stateWords(v.state)}`;
}

/**
 * One rest: the passage as kept, or, where this tracker no longer holds the read's bytes, the page and its hash with no
 * passage.
 */
function rest(x: RestedOn): string {
  const at = `at <a href="${esc(x.url)}" rel="nofollow noopener">${esc(x.url)}</a>, kept as <code>${esc(x.hash)}</code>`;
  return x.passage === null
    ? `<li>${esc(x.field)} rests on a passage of the page ${at}; the page's bytes are not held here</li>`
    : `<li>${esc(x.field)} rests on “${esc(x.passage)}” ${at}</li>`;
}

function reading(r: SquareReading): string {
  const mark = r.accepting
    ? ' One of the two readings that accepted the square.'
    : r.aside
      ? ' Set aside: it rests on nothing where the other reading rests on a kept page.'
      : '';
  const fields = r.fields.map(([f, val]) => `<li><b>${esc(f)}</b>: ${esc(shown(val))}</li>`).join('');
  const rests = r.rests.length
    ? `<p>What it rests on:</p><ul>${r.rests.map(rest).join('')}</ul>`
    : '<p class="q">It names no page it rests on.</p>';
  return `<section><h3>${esc(who(r))}</h3><p class="q">Declared ${esc(r.vendor)}, model ${esc(r.model)}, at ${esc(r.at)}.${esc(mark)}</p><p>Its return, in its own words:</p><ul>${fields}</ul>${rests}</section>`;
}

function nowText(v: SquareView): string {
  const n = v.now;
  if (!n) return '';
  if (n.same)
    return `<p>The owner has replaced this version of the problem. In the current version, <code>${esc(n.version)}</code>, the same piece is ${esc(stateWords(n.state))}. This page keeps saying what the version above recorded.</p>`;
  return `<p>The owner has replaced this version of the problem and sharpened this piece's brief. In the current version, <code>${esc(n.version)}</code>, the piece of the same name is <code>${esc(n.piece)}</code>, ${esc(stateWords(n.state))}, and its brief, as the owner wrote it, reads: “${esc(n.brief)}” This page keeps saying what the version above recorded.</p>`;
}

/**
 * Where the address names a later version that keeps the piece only from an earlier one: which version the page reads,
 * and why.
 */
function holderText(v: SquareView): string {
  if (!v.holder) return '';
  return `<p>The version this address names, <code>${esc(v.problem)}</code>, is a later version without this piece. The state and the readings below are the ones <code>${esc(v.holder)}</code> recorded.</p>\n`;
}

/**
 * QX-23 section 2: where the piece is inherited, the problem its square stands on, its state there, and the link to
 * that square's page, where the readings are.
 */
function standsText(v: SquareView): string {
  const i = v.inherited;
  if (!i) return '';
  return `<p>The square stands on the problem <code>${esc(i.problem)}</code>, which this fork came from. The same piece there is ${esc(stateWords(i.state))}. Its readings are on <a href="${esc(i.url)}">the page of that square</a>.</p>\n`;
}

/** The page itself: one document, no script, nothing loaded from elsewhere. */
export function squarePage(v: SquareView): string {
  const title = squareTitle(v);
  const owner = v.ownerName ? `${v.ownerName} (${v.owner})` : v.owner;
  const grade =
    v.traced === 'both'
      ? ' Both readings rest on pages kept here.'
      : v.traced === 'one'
        ? ' One of the two readings rests on a page kept here.'
        : v.traced === 'none'
          ? ' Neither reading names a page kept here.'
          : '';
  const verified = v.verified ? " The owner's own answer, committed before anyone read the piece, agreed with it." : '';
  const readings = v.readings.length
    ? v.readings.map(reading).join('')
    : v.inherited
      ? '<p class="q">No reading has been revealed on this problem. The readings of the square are on the page named above.</p>'
      : '<p class="q">No reading has been revealed yet.</p>';
  const description = `${v.title}: ${title}.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(v.url)}">
<meta name="twitter:card" content="summary">
<style>
:root{color-scheme:light dark}
body{margin:0;font:17px/1.5 system-ui,sans-serif;background:#eef0f3;color:#17213a}
main{max-width:680px;margin:0 auto;padding:40px 16px}
h1{font-size:1.4rem;margin:0 0 8px}
h2{font-size:1.1rem;margin:28px 0 8px}
h3{font-size:1rem;margin:0 0 4px;overflow-wrap:anywhere}
section{background:#fff;border-radius:8px;padding:12px 14px;margin:12px 0}
code{font-family:ui-monospace,Menlo,monospace;font-size:.9em;overflow-wrap:anywhere}
a{color:#2b3f7a;overflow-wrap:anywhere}
.q{color:#4a546b}
.state{font-weight:600}
@media (prefers-color-scheme: dark){body{background:#151922;color:#e6e9f0}section{background:#1e2330}.q{color:#aab2c5}a{color:#9fb2ff}}
</style>
</head>
<body>
<main>
<p class="q">A square of a problem on Quilt, as this tracker keeps it.</p>
<h1>${esc(title)}</h1>
<p>The problem, titled by ${esc(owner)}: “${esc(v.title)}”</p>
<p>The piece <b>${esc(v.name)}</b>, <code>${esc(v.piece)}</code>, of the problem's version <code>${esc(v.holder ?? v.problem)}</code>. Its brief, as the owner wrote it: “${esc(v.brief)}”</p>
${holderText(v)}<p class="state">It is ${esc(stateWords(v.state))}.${esc(grade)}${esc(verified)}</p>
${standsText(v)}<p class="q">${esc(v.kind)}</p>
${nowText(v)}
<h2>The readings</h2>
${readings}
<h2>The problem</h2>
<p>Its link, which a person's AI opens with Quilt: <code>${esc(v.link)}</code></p>
<p>Every problem this tracker holds, with its map: <a href="${esc(v.directory)}">the directory</a>.</p>
</main>
</body>
</html>`;
}
