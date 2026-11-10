/**
 * The directory window: the card's side of the MCP app (packages/client/src/window.ts is the server's). One
 * self-contained document, built by scripts/build-window.mjs into src/window.generated.ts. In a chat that shows MCP
 * apps it connects to the host, reads the handle from the tool result it was shown with (quilt_window, quilt_search,
 * quilt_open or quilt_read, which name the same card), and draws everything it shows from the app-only tool
 * quilt_window_io over the same session; it loads nothing from anywhere else, and the host's own sandbox would refuse
 * it if it tried. A button that would do something in the person's name hands this chat one of the person's own
 * phrases with the problem's link filled in, so a piece is taken or a problem opened through quilt_next and
 * quilt_open as from any sentence of theirs, with the host asking first; nothing a stranger wrote goes into what the
 * person's AI is told. Following a key is the one thing the card writes, in this home's library alone. Text is set
 * with textContent, never as markup.
 *
 * Five views, as Napster had its tabs: Search, Problem (the map), Hot list (the keys followed), Library (what this
 * home keeps and serves), Me; and a status line with the swarm's totals, each problem counted once however many doors
 * hold it.
 *
 * The same document stands on a site, where no chat holds it: the on-ramp serves it at /window, and `?reader=` names
 * the route beside it that answers the read-only ops over the tracker's own view, so bitquilt.org frames the live
 * directory. There is no person in it: the personal tabs are not shown, nothing is followed, and a button that would
 * hand the person's AI a phrase copies the phrase instead, for the person to say in a chat of their own. A page that
 * frames it may hand it a member's bearer token through postMessage, never in a URL; then the reader answers the
 * personal ops over that member's own Quilt and the five tabs come back, the buttons still copying, since no AI is in
 * the page.
 */
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  type McpUiHostContext,
} from '@modelcontextprotocol/ext-apps/app-with-deps';
// The reader's answers, declared once in src/window-answers.ts and taken as types alone. The build erases them, but the
// minifier picks its short names by how often each letter appears in this file's code, types included, so a type edit
// here can still change the card's bytes and so its hashed address.
import type {
  Handle,
  Hot,
  Lib,
  Me,
  PieceRow,
  Phrases,
  ProblemMap,
  Row,
  Searched,
  Totals,
  Work,
} from '../src/window-answers.js';

/** packages/client/package.json's version, put in by scripts/build-window.mjs at build time. */
declare const __QUILT_VERSION__: string;

type View = 'search' | 'problem' | 'hot' | 'library' | 'me';

const root = document.getElementById('window') as HTMLElement;
const state = {
  view: 'search' as View,
  query: '',
  rows: null as Row[] | null,
  opened: null as ProblemMap | null,
  /** The problem to open once the reader is reachable: a hash from the tool result's handles. */
  wanted: '',
  hot: null as Hot | null,
  lib: null as Lib | null,
  me: null as Me | null,
  /**
   * The person's own phrases, each with {link} where a problem's link goes: from `me` in a chat, from `phrases` on a
   * site.
   */
  phrases: null as Record<string, string> | null,
  totals: null as Totals | null,
  busy: false,
  error: '',
  /**
   * Something was just handed to the person's AI: the answer comes in the chat, under the card. On a site, the sentence
   * copied for the person to say.
   */
  told: '',
  copied: false,
};
let app: App | null = null;
/**
 * On a site: the reader's address from the page's own query, resolved against this document (`window/io` beside
 * `/window`); in a chat, none.
 */
const params = new URLSearchParams(location.search);
const reader = params.get('reader') ? new URL(params.get('reader') as string, location.href).href : null;
const standalone = reader !== null;
/**
 * On a site, a member's bearer token from the tracker's own authorization server, handed by the page that frames the
 * card and kept here in memory alone; null until then, and again when the page says so.
 */
let token: string | null = null;
/** Whether there is a person in the card: always in a chat; on a site, once the page has handed it a token. */
const personal = (): boolean => !standalone || token !== null;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {},
  ...kids: Array<Node | string | null | undefined>
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const k of kids) if (k !== null && k !== undefined) el.append(k);
  return el;
}
/** A button with what it does, in one call. */
function btn(text: string, cls: string, act: () => void, disabled = false): HTMLButtonElement {
  const b = h('button', { class: cls, type: 'button', textContent: text, disabled });
  b.addEventListener('click', act);
  return b;
}
/**
 * Where a tracker is, as a person reads it: the host, with the path where a door is a path under one name
 * (tracker.bitquilt.org/two).
 */
const placeOf = (url: string): string => {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
};
const short = (address: string): string =>
  address.length > 12 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address;
const day = (iso: string): string => iso.slice(0, 10);
const words = (s: string): string => s.replace(/_/g, ' ');
/**
 * QX-23 section 3: an inherited square is final where its state on the problem it stands on is `accepted`,
 * `unreachable` or `recorded`.
 */
const FINAL_THERE: readonly string[] = ['accepted', 'unreachable', 'recorded'];
/** Where an inherited piece's square stands, and its state there (QX-23 section 2); nothing for any other piece. */
const standsOn = (p: PieceRow): string =>
  p.inherited ? `, its square on ${short(p.inherited.problem)}, ${words(p.inherited.state)} there` : '';
/** The counts a row carries, summed into the three a person reads first. */
function workOf(counts: Record<string, number>): { returned: number; accepted: number; disputed: number } {
  const n = (k: string) => counts[k] ?? 0;
  const accepted = n('accepted') + n('accepted_provisional');
  const disputed = n('disputed') + n('challenged');
  return { returned: accepted + disputed + n('needs_verify') + n('judging'), accepted, disputed };
}

// ---- the host -----------------------------------------------------------

/** The reader behind the card: the app-only tool, over the session the host relays, answering JSON as text. */
async function io<T>(op: string, body: Record<string, unknown> = {}): Promise<T> {
  if (reader) {
    // On a site: the same ops as plain GETs to the reader beside this document; the on-ramp answers the read-only ones
    // and refuses the rest.
    const q = new URLSearchParams({ op });
    for (const [k, v] of Object.entries(body)) if (v !== undefined && v !== null) q.set(k, String(v));
    const r = await fetch(`${reader}?${q}`, {
      headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const text = await r.text();
    if (r.status === 401 && token) {
      // The token ended or was revoked: the card goes back to the public view, and the page's login is the way in
      // again.
      token = null;
      setTimeout(() => void relaunch(), 0);
      throw new Error('Your login ended; log in again on the page.');
    }
    if (!r.ok) {
      let why = text;
      try {
        why = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        /* the body as it came */
      }
      throw new Error(why || 'The reader did not answer.');
    }
    return JSON.parse(text) as T;
  }
  if (!app) throw new Error('This window has no host to read through.');
  const r = await app.callServerTool({ name: 'quilt_window_io', arguments: { op, ...body } });
  const first = r.content?.[0];
  const text = first && first.type === 'text' ? first.text : '';
  if (r.isError) throw new Error(text || 'The reader did not answer.');
  return JSON.parse(text) as T;
}

/** One of the person's own phrases, handed to this chat as the person's message; the AI answers under the card. */
async function tell(text: string): Promise<void> {
  if (!text) return;
  if (standalone) {
    // No AI is in this page: the sentence is shown under the tabs, where the card scrolls, and copied where the page
    // lets this frame write the clipboard, for the person to say in any chat where Quilt is connected.
    state.told = text;
    state.copied = false;
    state.error = '';
    draw();
    els.told.scrollIntoView({ block: 'nearest' });
    state.copied = await copy(text);
    draw();
    return;
  }
  if (!app) return;
  await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
  state.told = text;
  draw();
}

/**
 * The sentence onto the clipboard: the clipboard API where the frame is allowed it (a site grants it on the frame),
 * else the old copy command over the shown sentence, selected.
 */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* the old way */
  }
  const shown = els.told.querySelector('.mono');
  const selection = getSelection();
  if (!shown || !selection) return false;
  try {
    const range = document.createRange();
    range.selectNodeContents(shown);
    selection.removeAllRanges();
    selection.addRange(range);
    const done = document.execCommand('copy');
    selection.removeAllRanges();
    return done;
  } catch {
    return false;
  }
}
const phrase = (name: string, link = ''): string => (state.phrases?.[name] ?? '').replace('{link}', link);

function applyHost(ctx: McpUiHostContext | undefined): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

// ---- reading ----------------------------------------------------------------

/** One read, with the busy mark and the error line kept; `then` takes what came back. */
async function reading<T>(op: string, body: Record<string, unknown>, then: (t: T) => void): Promise<void> {
  state.busy = true;
  state.error = '';
  draw();
  try {
    then(await io<T>(op, body));
  } catch (e) {
    state.error = (e as Error).message;
  }
  state.busy = false;
  draw();
}
const search = () =>
  reading<Searched>('search', { query: state.query }, (r) => {
    state.rows = r.rows;
  });
const openProblem = (link: string) => {
  state.view = 'problem';
  return reading<ProblemMap>('open', { link }, (r) => {
    state.opened = r;
  });
};
const loadHot = () =>
  reading<Hot>('hot', {}, (r) => {
    state.hot = r;
  });
const loadLib = () =>
  reading<Lib>('library', {}, (r) => {
    state.lib = r;
  });
const follow = (key: string, on: boolean, name: string | null = null) =>
  reading<Hot>('follow', { key, on, ...(name ? { name } : {}) }, (r) => {
    state.hot = r;
  });

// ---- drawing ------------------------------------------------------------------

const TABS: { view: View; label: string }[] = [
  { view: 'search', label: 'Search' },
  { view: 'problem', label: 'Problem' },
  { view: 'hot', label: 'Hot list' },
  { view: 'library', label: 'Library' },
  { view: 'me', label: 'Me' },
];
const els = {
  tabs: new Map<View, HTMLButtonElement>(),
  views: new Map<View, HTMLElement>(),
  q: h('input', {
    type: 'search',
    placeholder: 'a word of a title, a topic, a slug',
    autocomplete: 'off',
    maxLength: 200,
  }),
  go: h('button', { class: 'b primary', type: 'submit', textContent: 'Find it' }),
  results: h('div', { class: 'results' }),
  problem: h('div', { class: 'problem' }),
  hot: h('div', { class: 'hot' }),
  followKey: h('input', { type: 'text', placeholder: 'an address, 0x…', autocomplete: 'off', maxLength: 42, size: 24 }),
  followName: h('input', { type: 'text', placeholder: 'a name for it', autocomplete: 'off', maxLength: 60, size: 14 }),
  lib: h('div', { class: 'lib' }),
  meView: h('div', { class: 'me' }),
  status: h('p', { class: 'status' }),
  err: h('p', { class: 'err' }),
  /** What the last button did, under the tabs: on a site the sentence to say, in a chat that the AI has it. */
  told: h('div', { class: 'told' }),
};

function shell(): void {
  const nav = h('nav', { class: 'tabs' });
  els.tabs.clear();
  els.views.clear();
  // On a site with no one logged in there is no person: the search and the map alone.
  for (const t of TABS.filter((t) => personal() || t.view === 'search' || t.view === 'problem')) {
    const b = btn(t.label, 'tab', () => show(t.view));
    els.tabs.set(t.view, b);
    nav.append(b);
  }
  const searchForm = h(
    'form',
    { class: 'row' },
    els.q,
    els.go,
    btn('Something to do', 'b', () => void tell(phrase('find_something_to_do'))),
  );
  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    state.query = els.q.value.trim();
    void search();
  });
  const followForm = h(
    'form',
    { class: 'row' },
    els.followKey,
    els.followName,
    h('button', { class: 'b', type: 'submit', textContent: 'Follow' }),
  );
  followForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = els.followKey.value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(key)) {
      state.error = 'An address is 0x and forty hex characters.';
      draw();
      return;
    }
    void follow(key, true, els.followName.value.trim() || null);
    els.followKey.value = '';
    els.followName.value = '';
  });
  const sections: [View, HTMLElement][] = [
    ['search', h('section', { class: 'view' }, searchForm, els.results)],
    ['problem', h('section', { class: 'view' }, els.problem)],
    ['hot', h('section', { class: 'view' }, els.hot, followForm)],
    ['library', h('section', { class: 'view' }, els.lib)],
    ['me', h('section', { class: 'view' }, els.meView)],
  ];
  for (const [view, el] of sections) els.views.set(view, el);
  root.replaceChildren(nav, els.err, els.told, ...sections.map(([, el]) => el), els.status);
}

function show(view: View): void {
  state.view = view;
  if (view === 'hot' && !state.hot) void loadHot();
  if (view === 'library' && !state.lib) void loadLib();
  draw();
}

function drawResults(): void {
  const rows = state.rows;
  if (rows === null) {
    els.results.replaceChildren(
      h(
        'p',
        { class: 'quiet' },
        state.busy ? 'Searching.' : 'Search the trackers and relays this client knows, or ask for something to do.',
      ),
    );
    return;
  }
  if (rows.length === 0) {
    els.results.replaceChildren(
      h('p', { class: 'quiet' }, 'No problem matched on the trackers and relays this client knows.'),
    );
    return;
  }
  // The Napster columns with the quilt's nouns: the work from the tracker's row where it has one (APP.md, Search), else
  // from the counts.
  const head = h(
    'tr',
    {},
    h('th', {}, 'Problem'),
    h('th', {}, 'By'),
    h('th', { class: 'n' }, 'Pieces'),
    h('th', { class: 'n' }, 'Returned'),
    h('th', { class: 'n' }, 'Accepted'),
    h('th', { class: 'n' }, 'Verified'),
    h('th', { class: 'n' }, 'Both sides'),
    h('th', { class: 'n' }, 'Readers'),
    h('th', { class: 'n' }, 'Disputed'),
    h('th', {}, 'Where'),
    h('th', {}, ''),
  );
  const body = rows.map((r) => {
    const w: Work = r.work ?? {
      ...workOf(r.counts),
      verified: 0,
      traced: { both: 0, one: 0, none: 0 },
      readers: 0,
      vendors: 0,
      last: null,
    };
    const title = h('span', { class: 't' }, r.title);
    title.addEventListener('click', () => void openProblem(r.link));
    const fork = r.from ? `; forks ${short(r.from)}` : '';
    const held = r.held?.length ?? 1;
    const where = `${r.via === 'relay' ? 'a relay; opens at ' : ''}${placeOf(r.tracker)}${held > 1 ? ` and ${held - 1} more` : ''}${r.announced ? `; as announced ${day(r.announced)}` : ''}`;
    return h(
      'tr',
      { class: r.root && r.root !== r.problem ? 'fork' : '' },
      h(
        'td',
        { class: 'title' },
        title,
        h('span', { class: 's' }, `${r.slug}${r.topics.length ? `; ${r.topics.join(', ')}` : ''}${fork}`),
      ),
      h('td', {}, r.owner_name ?? short(r.owner)),
      h('td', { class: 'n' }, String(r.pieces)),
      h('td', { class: 'n' }, String(w.returned)),
      h('td', { class: 'n' }, String(w.accepted)),
      h('td', { class: 'n' }, String(w.verified)),
      h('td', { class: 'n' }, String(w.traced.both)),
      h('td', { class: 'n' }, w.readers ? `${w.readers} / ${w.vendors}` : '0'),
      h('td', { class: 'n' }, String(w.disputed)),
      h('td', {}, where),
      h(
        'td',
        { class: 'acts' },
        btn('Open', 'b small', () => void openProblem(r.link)),
        ' ',
        btn('Take a piece', 'b small', () => void tell(phrase('take_piece', r.link)), !state.phrases),
      ),
    );
  });
  els.results.replaceChildren(h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
}

/**
 * The map: one square a piece, coloured by its state, dotted where attested, ringed where verified, underlined where a
 * stake is asked. An inherited piece (QX-23 section 2) is a ring in the accepted green and not a filled square, full
 * where its square is final on the problem it stands on and light where it is not.
 */
function mapOf(pieces: PieceRow[]): HTMLElement {
  const m = h('div', { class: 'map' });
  for (const p of pieces) {
    const final = p.inherited && FINAL_THERE.includes(p.inherited.state);
    const s = h('div', {
      class: `sq ${p.state}${final ? ' final' : ''}${p.attested ? ' attested' : ''}${p.verified ? ' verified' : ''}${p.stake ? ' staked' : ''}`,
    });
    const notes = [
      p.verifier,
      ...(p.strength ? [p.strength] : []),
      ...(p.weakest ? ['the weakest kind'] : []),
      ...(p.verified ? ['verified'] : []),
      ...(p.traced
        ? [
            `rests on kept reads on ${p.traced === 'both' ? 'both sides' : p.traced === 'one' ? 'one side' : 'neither side'}`,
          ]
        : []),
    ];
    s.title = `${p.name}: ${words(p.state)}${standsOn(p)} (${notes.join(', ')})`;
    m.append(s);
  }
  return m;
}

function drawProblem(): void {
  const p = state.opened;
  if (!p) {
    els.problem.replaceChildren(
      h('p', { class: 'quiet' }, state.busy ? 'Opening.' : 'Open a problem from the search or the library.'),
    );
    return;
  }
  const followed = Boolean(state.hot?.keys.some((k) => k.key.toLowerCase() === p.owner.toLowerCase()));
  const counts: Record<string, number> = {};
  for (const x of p.pieces) counts[x.state] = (counts[x.state] ?? 0) + 1;
  const w = workOf(counts);
  const traced = p.pieces.filter((x) => x.traced === 'both').length;
  // QX-23 section 4: the accepted squares counted are the problem's own, and the inherited are said beside them.
  const inherited = counts.inherited ? `, ${counts.inherited} inherited from a problem this fork came from` : '';
  const lines = [
    `${p.pieces.length} pieces: ${w.returned} returned, ${w.accepted} accepted (${p.pieces.filter((x) => x.verified).length} verified by the owner's gold, ${traced} resting on kept reads on both sides), ${w.disputed} disputed${inherited}${p.complete ? '; complete' : ''}.`,
    `${p.readers} reader${p.readers === 1 ? '' : 's'}${p.vendors.length ? ` from ${p.vendors.length} vendor${p.vendors.length === 1 ? '' : 's'} (${p.vendors.join(', ')})` : ''}; ${p.seeders} seeder${p.seeders === 1 ? '' : 's'}${p.tracker ? `; at ${placeOf(p.tracker)}` : ''}.`,
  ];
  const acts = h(
    'div',
    { class: 'acts' },
    btn('Take a piece', 'b primary', () => void tell(phrase('take_piece', p.link)), !state.phrases),
    btn('Open with my AI', 'b', () => void tell(phrase('open_problem', p.link)), !state.phrases),
    btn(
      p.seeding ? 'Kept by this home' : 'Keep it',
      'b',
      () => void tell(phrase('keep_problem', p.link)),
      !state.phrases || p.seeding,
    ),
    ...(personal()
      ? [
          btn(
            followed ? 'Unfollow the owner' : 'Follow the owner',
            'b',
            () => void follow(p.owner, !followed, p.owner_name),
          ),
        ]
      : []),
  );
  const shown = p.pieces.slice(0, 80);
  const table = h(
    'table',
    {},
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', {}, 'Piece'),
        h('th', {}, 'State'),
        h('th', {}, 'Kind'),
        h('th', { class: 'n' }, 'Readers'),
        h('th', {}, 'Grade'),
        h('th', { class: 'n' }, 'Seams'),
      ),
    ),
    h(
      'tbody',
      {},
      ...shown.map((x) =>
        h(
          'tr',
          {},
          h('td', {}, x.name),
          h('td', {}, words(x.state) + standsOn(x) + (x.verified ? ', verified' : '')),
          h(
            'td',
            {},
            `${x.verifier}${x.strength ? `, ${x.strength}` : ''}${x.attested ? ', attested' : ''}${x.stake ? `, a stake of ${x.stake}` : ''}`,
          ),
          h('td', { class: 'n' }, String(x.reveals)),
          h(
            'td',
            {},
            x.traced === 'both'
              ? 'both sides rest on kept reads'
              : x.traced === 'one'
                ? 'one side rests on a kept read'
                : x.traced === 'none'
                  ? 'no kept read'
                  : x.traces
                    ? `${x.traces} trace${x.traces === 1 ? '' : 's'}`
                    : '',
          ),
          h('td', { class: 'n' }, x.seams ? String(x.seams) : ''),
        ),
      ),
    ),
  );
  els.problem.replaceChildren(
    h('h3', {}, p.title),
    h(
      'p',
      { class: 'meta' },
      `Published by ${p.owner_name ?? short(p.owner)}${p.owner_name ? ` (${short(p.owner)})` : ''}; ${p.slug}.${p.superseded ? ' Its owner replaced this version; the work is on the newer one.' : ''}${p.hidden ? ` Taken down on this tracker by ${short(p.hidden.by)}: ${p.hidden.why}.` : ''}`,
    ),
    h('p', {}, `Done when: ${p.done_when}`),
    mapOf(p.pieces),
    h('p', { class: 'meta' }, lines[0] ?? ''),
    h('p', { class: 'meta' }, lines[1] ?? ''),
    ...(p.gold
      ? [
          h(
            'p',
            { class: 'meta' },
            `Gold: ${p.gold.committed} committed, ${p.gold.verified} verified, ${p.gold.missed} missed, ${p.gold.pending} pending.`,
          ),
        ]
      : []),
    acts,
    table,
    ...(p.pieces.length > shown.length
      ? [h('p', { class: 'quiet' }, `${p.pieces.length - shown.length} more pieces are on the map above.`)]
      : []),
  );
}

function drawHot(): void {
  const hot = state.hot;
  if (!hot) {
    els.hot.replaceChildren(
      h(
        'p',
        { class: 'quiet' },
        state.busy ? 'Reading.' : "The keys you follow, kept in this home's library and nowhere else.",
      ),
    );
    return;
  }
  if (hot.keys.length === 0) {
    els.hot.replaceChildren(
      h('p', { class: 'quiet' }, "No key followed yet. Follow a problem's owner from its map, or an address here."),
    );
    return;
  }
  const table = h(
    'table',
    {},
    h(
      'thead',
      {},
      h('tr', {}, h('th', {}, 'Key'), h('th', { class: 'n' }, 'Standing'), h('th', {}, 'Since'), h('th', {}, '')),
    ),
    h(
      'tbody',
      {},
      ...hot.keys.map((k) =>
        h(
          'tr',
          {},
          h('td', {}, k.name ? `${k.name} ` : '', h('span', { class: 'mono' }, short(k.key))),
          h('td', { class: 'n' }, k.standing === null ? '' : String(k.standing)),
          h('td', {}, day(k.since)),
          h(
            'td',
            { class: 'acts' },
            btn('Unfollow', 'b small', () => void follow(k.key, false)),
          ),
        ),
      ),
    ),
  );
  els.hot.replaceChildren(table);
}

function drawLib(): void {
  const lib = state.lib;
  if (!lib) {
    els.lib.replaceChildren(h('p', { class: 'quiet' }, state.busy ? 'Reading.' : 'What this home keeps and serves.'));
    return;
  }
  const s = lib.serving;
  const problems = Object.entries(lib.problems).sort(([, a], [, b]) => b.last.localeCompare(a.last));
  const pieces = Object.entries(lib.pieces)
    .sort(([, a], [, b]) => b.when.localeCompare(a.when))
    .slice(0, 20);
  const goldCommitted = Object.values(lib.gold).reduce((n, g) => n + g.committed, 0);
  const goldRevealed = Object.values(lib.gold).reduce((n, g) => n + g.revealed, 0);
  const dl = h(
    'dl',
    {},
    h('dt', {}, 'Serving'),
    h(
      'dd',
      {},
      `${s.problems} problem${s.problems === 1 ? '' : 's'}, ${s.ledgers} ledger${s.ledgers === 1 ? '' : 's'}, ${s.blobs} page${s.blobs === 1 ? '' : 's'}; ${Math.round(s.bytes / 1024)} KB`,
    ),
    h('dt', {}, 'Gold'),
    h('dd', {}, goldCommitted ? `${goldCommitted} committed, ${goldRevealed} revealed` : 'none committed'),
    h('dt', {}, 'Queued'),
    h('dd', {}, `${lib.queued} event${lib.queued === 1 ? '' : 's'} waiting for a tracker`),
  );
  const probs = problems.length
    ? h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Problem'), h('th', {}, 'Last opened'), h('th', {}, ''))),
        h(
          'tbody',
          {},
          ...problems.map(([hash, e]) => {
            const title = h('span', { class: 't' }, e.title);
            title.addEventListener('click', () => void openProblem(e.link));
            return h(
              'tr',
              {},
              h(
                'td',
                { class: 'title' },
                title,
                h(
                  'span',
                  { class: 's' },
                  `${e.slug}${lib.seeding[hash] ? '; kept' : ''}${e.next ? '; replaced by a newer version' : ''}`,
                ),
              ),
              h('td', {}, day(e.last)),
              h(
                'td',
                { class: 'acts' },
                btn('Open', 'b small', () => void openProblem(e.link)),
                ' ',
                btn(
                  'Take a piece',
                  'b small',
                  () => void tell(phrase('take_piece', e.link)),
                  !state.phrases || Boolean(e.next),
                ),
              ),
            );
          }),
        ),
      )
    : h('p', { class: 'quiet' }, 'No problem opened from this home yet.');
  const done = pieces.length
    ? h(
        'table',
        {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Piece'), h('th', {}, 'What'), h('th', {}, 'When'))),
        h(
          'tbody',
          {},
          ...pieces.map(([, e]) =>
            h(
              'tr',
              {},
              h('td', {}, `${e.name} of ${lib.problems[e.problem]?.title ?? short(e.problem)}`),
              h('td', {}, e.what),
              h('td', {}, day(e.when)),
            ),
          ),
        ),
      )
    : h('p', { class: 'quiet' }, 'No piece taken from this home yet.');
  els.lib.replaceChildren(dl, h('h3', {}, 'Problems'), probs, h('h3', {}, 'Pieces'), done);
}

function drawMe(): void {
  const me = state.me;
  if (!me) {
    els.meView.replaceChildren(h('p', { class: 'quiet' }, 'Reading who this client is.'));
    return;
  }
  const dl = h(
    'dl',
    {},
    h('dt', {}, 'Address'),
    h('dd', {}, me.address ?? 'none yet; made at first use'),
    h('dt', {}, 'Name'),
    h('dd', {}, me.name ?? 'none set'),
    h('dt', {}, 'Declares'),
    h('dd', {}, me.model),
    h('dt', {}, 'Trackers'),
    h('dd', {}, me.trackers.join(', ')),
    ...(me.relays.length ? [h('dt', {}, 'Relays'), h('dd', {}, me.relays.join(', '))] : []),
    h('dt', {}, 'Standing'),
    h(
      'dd',
      {},
      me.standing
        ? `${me.standing.standing}, earned by work and not for sale (locked ${me.standing.locked}, free to stake ${me.standing.free})`
        : 'no tracker answered',
    ),
    ...(me.coin
      ? [
          h('dt', {}, 'Coin'),
          h('dd', {}, `${me.coin.balance} units, ${me.coin.free} free, at ${placeOf(me.coin.home)}`),
        ]
      : []),
    ...(me.witness ? [h('dt', {}, 'Witness'), h('dd', {}, me.witness)] : []),
    h('dt', {}, 'Library'),
    h(
      'dd',
      {},
      `${me.problems} problem${me.problems === 1 ? '' : 's'}; ${me.queued} event${me.queued === 1 ? '' : 's'} queued`,
    ),
  );
  els.meView.replaceChildren(
    dl,
    btn('Ask my AI who I am', 'b', () => void tell(phrase('who_am_i'))),
  );
}

function drawStatus(): void {
  const t = state.totals;
  const parts: string[] = [];
  if (t) {
    // Each problem once, however many doors hold it (window.ts, totals); a door that gave no answer is named as such.
    const n = (k: string) => t.counts[k] ?? 0;
    parts.push(
      `${t.problems} problem${t.problems === 1 ? '' : 's'}, ${t.pieces} pieces: ${n('accepted') + n('accepted_provisional')} accepted, ${n('needs_verify')} waiting on a second reading, ${n('disputed')} disputed`,
    );
    parts.push(t.trackers.map((x) => `${placeOf(x.tracker)}${x.problems === null ? ' (no answer)' : ''}`).join(', '));
  } else parts.push('Reading the trackers.');
  els.status.replaceChildren(
    h('span', {}, parts[0] ?? ''),
    h('span', {}, `${parts[1] ? `${parts[1]} · ` : ''}Quilt ${__QUILT_VERSION__}`),
  );
}

function draw(): void {
  for (const [view, b] of els.tabs) b.classList.toggle('on', state.view === view);
  for (const [view, el] of els.views) el.classList.toggle('on', state.view === view);
  els.go.disabled = state.busy;
  drawResults();
  drawProblem();
  drawHot();
  drawLib();
  drawMe();
  drawStatus();
  els.err.textContent = state.error;
  drawTold();
}

/**
 * What the last button did: on a site, the sentence to say with a button that copies it again; in a chat, that the AI
 * has it.
 */
function drawTold(): void {
  if (!state.told) {
    els.told.replaceChildren();
    return;
  }
  if (!standalone) {
    els.told.textContent = 'Handed to your AI; its answer comes in the chat.';
    return;
  }
  els.told.replaceChildren(
    h('span', { class: 'lead' }, state.copied ? 'Copied. Say it to your AI:' : 'Say this to your AI:'),
    h('code', { class: 'mono' }, state.told),
    btn(state.copied ? 'Copied' : 'Copy', 'b small', () => void copyAgain()),
    h(
      'span',
      { class: 'quiet' },
      token ? 'In any chat where your Quilt is connected.' : 'In any chat where Quilt is connected. ',
      ...(token
        ? []
        : [
            h(
              'a',
              { href: new URL('join', location.href).href, target: '_blank', rel: 'noopener' },
              'No Quilt yet? Get an address.',
            ),
          ]),
    ),
  );
}

async function copyAgain(): Promise<void> {
  state.copied = await copy(state.told);
  draw();
}

// ---- start ----------------------------------------------------------------

async function load(): Promise<void> {
  try {
    if (standalone && !token) {
      // The phrases and the totals, then the directory at once, since a visitor has asked for nothing yet.
      const [phrases, totals] = await Promise.all([io<Phrases>('phrases'), io<Totals>('totals')]);
      state.phrases = phrases.phrases;
      state.totals = totals;
      els.q.value = state.query;
      draw();
      if (state.wanted) await openProblem(state.wanted);
      else await search();
      return;
    }
    const [me, totals, hot] = await Promise.all([io<Me>('me'), io<Totals>('totals'), io<Hot>('hot')]);
    state.me = me;
    state.phrases = me.phrases;
    state.totals = totals;
    state.hot = hot;
    els.q.value = state.query;
    draw();
    if (state.wanted) await openProblem(state.wanted);
    else if (state.query || standalone) await search();
  } catch (e) {
    state.error = (e as Error).message;
    draw();
  }
}

/**
 * The card again after a login or a logout on the page: the person's views dropped, the tabs made again, everything
 * read anew.
 */
async function relaunch(): Promise<void> {
  state.me = null;
  state.hot = null;
  state.lib = null;
  state.phrases = null;
  state.told = '';
  state.error = '';
  if (!personal() && state.view !== 'search' && state.view !== 'problem') state.view = 'search';
  shell();
  draw();
  await load();
}

async function start(): Promise<void> {
  shell();
  draw();
  if (standalone) {
    // On a site: no host to connect to; the page's own query says what to search or open.
    state.query = (params.get('query') ?? '').slice(0, 200);
    const link = params.get('link');
    if (link) {
      state.wanted = link;
      state.view = 'problem';
    }
    if (window.parent !== window) {
      // The page that frames the card may hand it a member's token, and take it back; the card says it is ready to take
      // one. Nothing else is read from a message.
      window.addEventListener('message', (e: MessageEvent) => {
        const d = e.data as { type?: unknown; token?: unknown } | null;
        if (!d || typeof d !== 'object' || d.type !== 'quilt:token') return;
        const next = typeof d.token === 'string' && d.token ? d.token : null;
        if (next === token) return;
        token = next;
        void relaunch();
      });
      window.parent.postMessage({ type: 'quilt:ready' }, '*');
    }
    await load();
    return;
  }
  app = new App({ name: 'Quilt', version: __QUILT_VERSION__ });
  app.ontoolresult = (p) => {
    const handles = (
      p.structuredContent as { handles?: { window?: Handle; query?: string; problem?: string } } | undefined
    )?.handles;
    const hd = handles?.window;
    if (hd?.view === 'me') state.view = 'me';
    const query = hd?.query ?? handles?.query;
    if (typeof query === 'string') state.query = query;
    // A problem the tool opened or read, or the one the window was asked to open on: the map comes up.
    const wanted = hd?.link ?? handles?.problem;
    if (typeof wanted === 'string' && wanted) {
      state.wanted = wanted;
      state.view = 'problem';
    }
    if (p.isError) {
      state.error = 'The call that showed this window did not go through.';
      draw();
      return;
    }
    void load();
  };
  app.onhostcontextchanged = (ctx) => applyHost(ctx as McpUiHostContext);
  app.onteardown = async () => ({});
  await app.connect();
  applyHost(app.getHostContext());
}

start().catch((e: unknown) => {
  state.error = (e as Error).message || 'This window could not reach its host.';
  draw();
});
