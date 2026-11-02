/**
 * The directory window: the card's side of the MCP app (packages/client/src/window.ts is the server's). One
 * self-contained document, built by scripts/build-window.mjs into src/window.generated.ts. In a chat that shows MCP
 * apps it connects to the host, reads the handle from the tool result it was shown with (quilt_window, or quilt_search,
 * which names the same card), and draws everything it shows from the app-only tool quilt_window_io over the same
 * session; it loads nothing from anywhere else, and the host's own sandbox would refuse it if it tried. A button that
 * would do something in the person's name hands this chat one of the person's own phrases with the problem's link
 * filled in, so a piece is taken or a problem opened through quilt_next and quilt_open as always, with the host asking
 * first; nothing a stranger wrote goes into what the person's AI is told. Text is set with textContent, never as markup.
 *
 * Two views so far, Search and Me, and a status line with the trackers' totals.
 */
import { App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext } from '@modelcontextprotocol/ext-apps/app-with-deps';

/** packages/client/package.json's version, put in by scripts/build-window.mjs at build time. */
declare const __QUILT_VERSION__: string;

interface Row { problem: string; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[]; tracker: string; via: 'tracker' | 'relay'; link: string }
interface Searched { op: 'search'; query: string; rows: Row[] }
interface Me {
  op: 'me';
  address: string | null;
  name: string | null;
  model: string;
  trackers: string[];
  relays: string[];
  queued: number;
  problems: number;
  standing: { tracker: string; standing: number; locked: number; free: number } | null;
  coin: { balance: number; free: number; home: string } | null;
  witness: string | null;
  /** The person's own phrases, each with {link} where a problem's link goes. */
  phrases: Record<string, string>;
}
interface Totals { op: 'totals'; trackers: { tracker: string; problems: number | null; pieces: number; counts: Record<string, number> }[] }
/** What the tool that showed this card handed it: who the client is and what to open on. No one's words. */
interface Handle { address?: string | null; name?: string | null; trackers?: string[]; host?: string | null; view?: string; query?: string | null; link?: string | null }

const root = document.getElementById('window') as HTMLElement;
const state = {
  view: 'search' as 'search' | 'me',
  query: '',
  rows: null as Row[] | null,
  me: null as Me | null,
  totals: null as Totals | null,
  busy: false,
  error: '',
  /** Something was just handed to the person's AI: the answer comes in the chat, under the card. */
  told: '',
};
let app: App | null = null;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: Array<Node | string | null | undefined>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, ...rest } = props;
  if (cls) el.className = cls;
  Object.assign(el, rest);
  for (const k of kids) if (k !== null && k !== undefined) el.append(k);
  return el;
}
const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};
const short = (address: string): string => (address.length > 12 ? `${address.slice(0, 8)}…${address.slice(-4)}` : address);
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
  if (!app) throw new Error('This window has no host to read through.');
  const r = await app.callServerTool({ name: 'quilt_window_io', arguments: { op, ...body } });
  const first = r.content?.[0];
  const text = first && first.type === 'text' ? first.text : '';
  if (r.isError) throw new Error(text || 'The reader did not answer.');
  return JSON.parse(text) as T;
}

/** One of the person's own phrases, handed to this chat as the person's message; the AI answers under the card. */
async function tell(text: string): Promise<void> {
  if (!app || !text) return;
  await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
  state.told = text;
  draw();
}
const phrase = (name: string, link = ''): string => (state.me?.phrases[name] ?? '').replace('{link}', link);

function applyHost(ctx: McpUiHostContext | undefined): void {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

// ---- drawing --------------------------------------------------------------

const els = {
  tabSearch: h('button', { class: 'tab on', type: 'button', textContent: 'Search' }),
  tabMe: h('button', { class: 'tab', type: 'button', textContent: 'Me' }),
  search: h('section', { class: 'view on' }),
  me: h('section', { class: 'view' }),
  q: h('input', { type: 'search', placeholder: 'a word of a title, a topic, a slug', autocomplete: 'off', maxLength: 200 }),
  go: h('button', { class: 'b primary', type: 'submit', textContent: 'Find it' }),
  any: h('button', { class: 'b', type: 'button', textContent: 'Something to do' }),
  results: h('div', { class: 'results' }),
  meView: h('div', { class: 'me' }),
  status: h('p', { class: 'status' }),
  err: h('p', { class: 'err' }),
};

function shell(): void {
  const form = h('form', { class: 'row' }, els.q, els.go, els.any);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.query = els.q.value.trim();
    void search();
  });
  els.any.addEventListener('click', () => void tell(phrase('find_something_to_do')));
  els.tabSearch.addEventListener('click', () => show('search'));
  els.tabMe.addEventListener('click', () => show('me'));
  els.search.append(form, els.results);
  els.me.append(els.meView);
  root.replaceChildren(h('nav', { class: 'tabs' }, els.tabSearch, els.tabMe), els.search, els.me, els.err, els.status);
}

function show(view: 'search' | 'me'): void {
  state.view = view;
  draw();
}

async function search(): Promise<void> {
  state.busy = true;
  state.error = '';
  draw();
  try {
    state.rows = (await io<Searched>('search', { query: state.query })).rows;
  } catch (e) {
    state.error = (e as Error).message;
  }
  state.busy = false;
  draw();
}

function drawResults(): void {
  const rows = state.rows;
  if (rows === null) {
    els.results.replaceChildren(h('p', { class: 'quiet' }, state.busy ? 'Searching.' : 'Search the trackers and relays this client knows, or ask for something to do.'));
    return;
  }
  if (rows.length === 0) {
    els.results.replaceChildren(h('p', { class: 'quiet' }, 'No problem matched on the trackers and relays this client knows.'));
    return;
  }
  const head = h('tr', {}, h('th', {}, 'Problem'), h('th', {}, 'By'), h('th', { class: 'n' }, 'Pieces'), h('th', { class: 'n' }, 'Returned'), h('th', { class: 'n' }, 'Accepted'), h('th', { class: 'n' }, 'Disputed'), h('th', {}, 'Where'), h('th', {}, ''));
  const body = rows.map((r) => {
    const w = workOf(r.counts);
    const open = h('button', { class: 'b small', type: 'button', textContent: 'Open with my AI', disabled: !state.me }, undefined);
    open.addEventListener('click', () => void tell(phrase('open_problem', r.link)));
    const take = h('button', { class: 'b small', type: 'button', textContent: 'Take a piece', disabled: !state.me });
    take.addEventListener('click', () => void tell(phrase('take_piece', r.link)));
    return h('tr', {},
      h('td', { class: 'title' }, h('span', { class: 't' }, r.title), h('span', { class: 's' }, `${r.slug}${r.topics.length ? `; ${r.topics.join(', ')}` : ''}`)),
      h('td', {}, short(r.owner)),
      h('td', { class: 'n' }, String(r.pieces)),
      h('td', { class: 'n' }, String(w.returned)),
      h('td', { class: 'n' }, String(w.accepted)),
      h('td', { class: 'n' }, String(w.disputed)),
      h('td', {}, r.via === 'relay' ? `a relay; opens at ${hostOf(r.tracker)}` : hostOf(r.tracker)),
      h('td', { class: 'acts' }, open, ' ', take),
    );
  });
  els.results.replaceChildren(h('table', {}, h('thead', {}, head), h('tbody', {}, ...body)));
}

function drawMe(): void {
  const me = state.me;
  if (!me) {
    els.meView.replaceChildren(h('p', { class: 'quiet' }, 'Reading who this client is.'));
    return;
  }
  const dl = h('dl', {},
    h('dt', {}, 'Address'), h('dd', {}, me.address ?? 'none yet; made at first use'),
    h('dt', {}, 'Name'), h('dd', {}, me.name ?? 'none set'),
    h('dt', {}, 'Declares'), h('dd', {}, me.model),
    h('dt', {}, 'Trackers'), h('dd', {}, me.trackers.join(', ')),
    ...(me.relays.length ? [h('dt', {}, 'Relays'), h('dd', {}, me.relays.join(', '))] : []),
    h('dt', {}, 'Standing'), h('dd', {}, me.standing ? `${me.standing.standing}, earned by work and not for sale (locked ${me.standing.locked}, free to stake ${me.standing.free})` : 'no tracker answered'),
    ...(me.coin ? [h('dt', {}, 'Coin'), h('dd', {}, `${me.coin.balance} units, ${me.coin.free} free, at ${hostOf(me.coin.home)}`)] : []),
    ...(me.witness ? [h('dt', {}, 'Witness'), h('dd', {}, me.witness)] : []),
    h('dt', {}, 'Library'), h('dd', {}, `${me.problems} problem${me.problems === 1 ? '' : 's'}; ${me.queued} event${me.queued === 1 ? '' : 's'} queued`),
  );
  const who = h('button', { class: 'b', type: 'button', textContent: 'Ask my AI who I am' });
  who.addEventListener('click', () => void tell(phrase('who_am_i')));
  els.meView.replaceChildren(dl, who);
}

function drawStatus(): void {
  const t = state.totals;
  const parts: string[] = [];
  if (t) {
    const problems = t.trackers.reduce((n, x) => n + (x.problems ?? 0), 0);
    const pieces = t.trackers.reduce((n, x) => n + x.pieces, 0);
    const sum = (k: string) => t.trackers.reduce((n, x) => n + (x.counts[k] ?? 0), 0);
    parts.push(`${problems} problem${problems === 1 ? '' : 's'}, ${pieces} pieces: ${sum('accepted') + sum('accepted_provisional')} accepted, ${sum('needs_verify')} waiting on a second reading, ${sum('disputed')} disputed`);
    parts.push(t.trackers.map((x) => hostOf(x.tracker)).join(', '));
  } else parts.push('Reading the trackers.');
  els.status.replaceChildren(h('span', {}, parts[0] ?? ''), h('span', {}, `${parts[1] ? `${parts[1]} · ` : ''}Quilt ${__QUILT_VERSION__}`));
}

function draw(): void {
  els.tabSearch.classList.toggle('on', state.view === 'search');
  els.tabMe.classList.toggle('on', state.view === 'me');
  els.search.classList.toggle('on', state.view === 'search');
  els.me.classList.toggle('on', state.view === 'me');
  els.go.disabled = state.busy;
  drawResults();
  drawMe();
  drawStatus();
  els.err.textContent = state.error || (state.told ? 'Handed to your AI; its answer comes in the chat.' : '');
}

// ---- start ----------------------------------------------------------------

async function load(): Promise<void> {
  try {
    const [me, totals] = await Promise.all([io<Me>('me'), io<Totals>('totals')]);
    state.me = me;
    state.totals = totals;
    els.q.value = state.query;
    draw();
    if (state.query) await search();
  } catch (e) {
    state.error = (e as Error).message;
    draw();
  }
}

async function start(): Promise<void> {
  shell();
  draw();
  app = new App({ name: 'Quilt', version: __QUILT_VERSION__ });
  app.ontoolresult = (p) => {
    const handles = (p.structuredContent as { handles?: { window?: Handle; query?: string } } | undefined)?.handles;
    const hd = handles?.window;
    if (hd?.view === 'me') state.view = 'me';
    const query = hd?.query ?? handles?.query;
    if (typeof query === 'string') state.query = query;
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
