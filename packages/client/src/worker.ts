/**
 * The verbs' work, with no MCP and no HTTP in it: open a problem, search, be handed a piece, hand one back, decline,
 * read, publish, challenge an acceptance, give a verdict, rank a judge piece's candidates. The MCP server and the page
 * are thin shells over this. Other people's words come out of here only as quoted text with the signer named.
 */
import {
  type Capability, type Envelope, type Event, type Hash, type Pick, type PieceView, type Problem, type State, type Unsigned,
  agreeFields, commitHash, eventId, expandPieces, hashBytes, isHash, newNonce, next, plainTextProblems, problemHash, renderInputs, signEvent, signObject, canonical, envelopeProblems,
} from '@bitquilt/core';
import type { Config, Identity } from './config.js';
import { type Link, makeLink, parseLink } from './link.js';
import { announcementEvent, postToRelays, searchRelays } from './relay.js';
import type { Library, Resolver } from './resolver.js';

export type { Library } from './resolver.js';

export const SIDES = ['challenger', 'author'] as const;
export type Side = (typeof SIDES)[number];

/** A challenge as a tracker lists it at /p/<hash>/challenges (QX-1): the seats drawn, each verdict, the outcome. */
export interface ChallengeListing {
  id: Hash;
  piece: Hash;
  name: string | null;
  root: string;
  at: string;
  stake: number;
  ground: string;
  seats: { root: string; offered_at: string; lapsed_at: string | null; verdict: { at: string; for: Side; return: Record<string, unknown> | null } | null }[];
  outcome: 'open' | 'held' | 'failed' | 'void';
  decided_at: string | null;
}

/** A judge panel as a tracker lists it at /p/<hash>/panels (QX-2): the candidates by digest, their signers named once it has decided, the seats, each rank, the outcome. */
export interface PanelListing {
  piece: Hash;
  name: string;
  verifier: string | null;
  panel: number;
  majority: number;
  candidates: { digest: Hash; return: Record<string, unknown>; root?: string; signer?: string | null }[];
  seats: { root: string; offered_at: string; lapsed_at: string | null; rank: { at: string; ranking: Hash[] } | null }[];
  outcome: 'open' | 'decided' | 'void';
  winner: Hash | null;
  decided_at: string | null;
}

/** A piece as the tracker that answered holds it in its layer (QX-1, QX-2, QX-3, QX-10): its state beside the core's, the kind and its strength. */
export interface LayerPiece {
  hash: Hash;
  name: string;
  verifier: string;
  state: string;
  core: string;
  kind: string | null;
  extension: string | null;
  strength: string | null;
  says: string;
  weakest: boolean;
  attested: boolean;
  panel: string | null;
  challenge: Hash | null;
  /** The stake of standing the problem asks of a claim on this piece (QX-15); 0 or absent where none. */
  stake?: number;
  /** The piece's gold (QX-16): null or absent with none kept, else pending, match, miss, overruled or lapsed. */
  gold?: string | null;
  /** A square whose accepting set agreed with the owner's gold. */
  verified?: boolean;
}

export const STATE_MARK: Record<string, string> = { locked: 'l', unknown: '?', open: '.', in_flight: 'i', sealed: 's', needs_verify: 'v', disputed: 'd', accepted_provisional: 'p', accepted: 'a', unreachable: 'u', challenged: 'c', judging: 'j' };

/** A verifier kind in words: how a square of it is earned, how strongly, and that attest is the weakest. */
export function kindWords(verifier: string): { kind: string; extension: string | null; strength: string; says: string; weakest: boolean } {
  const judge = /^judge:([1-9]\d*)$/.exec(verifier);
  if (judge) return { kind: 'judge', extension: 'QX-2', strength: 'judged', says: `a panel of ${judge[1]} drawn by sortition ranks the candidates and a majority's first choice is accepted`, weakest: false };
  switch (verifier) {
    case 'check':
      return { kind: 'check', extension: null, strength: 'reproduced', says: 'two unrelated runs reproduce the patch', weakest: false };
    case 'score':
      return { kind: 'score', extension: null, strength: 'reproduced', says: 'two unrelated runs score the patch within tolerance', weakest: false };
    case 'agree':
      return { kind: 'agree', extension: null, strength: 'agreed', says: 'two returns from different vendors agree', weakest: false };
    case 'human':
      return { kind: 'human', extension: 'QX-3', strength: 'agreed', says: 'two people at seats a tracker opened for them agree', weakest: false };
    case 'attest':
      return { kind: 'attest', extension: 'QX-10', strength: 'attested', says: 'the actor\'s own signed record is accepted at once and may be challenged for the window; the weakest kind', weakest: true };
    default:
      return { kind: verifier, extension: null, strength: 'unknown', says: 'a kind this client does not implement', weakest: false };
  }
}

/** What a piece waits for after a return, by its kind. */
export function waitsText(verifier: string | undefined): string {
  switch (verifier ? kindWords(verifier).kind : null) {
    case 'check':
    case 'score':
      return 'The patch now waits for two runs by others.';
    case 'agree':
      return 'The piece now waits for a second production from another vendor.';
    case 'human':
      return 'The piece now waits for a second person at a seat to agree.';
    case 'judge':
      return 'The return is a candidate; once the candidates are in, a panel drawn by sortition ranks them.';
    case 'attest':
      return 'The record is accepted at once as the actor\'s own word, marked attested, and may be challenged for the window.';
    default:
      return 'What the piece waits for next is its verifier\'s to say.';
  }
}

/** The vendor and model a host declares, from the name it gives at connection. */
export function modelFor(hostName: string | undefined, override?: string): string {
  if (override) return override;
  const n = (hostName ?? '').toLowerCase();
  if (!n) return 'unknown/unknown';
  if (n.includes('claude')) return `anthropic/${n.replace(/\s+/g, '-')}`;
  if (n.includes('openai') || n.includes('chatgpt') || n.includes('codex')) return `openai/${n.replace(/\s+/g, '-')}`;
  if (n.includes('gemini') || n.includes('google')) return `google/${n.replace(/\s+/g, '-')}`;
  return `${n.replace(/\s+/g, '-')}/${n.replace(/\s+/g, '-')}`;
}

/** One thing waiting on this key's person, for a shell's list of what is wanted from them. */
export interface AttentionItem {
  problem: Hash;
  title: string;
  piece: Hash | null;
  name: string | null;
  /** rank: drawn to a judge panel and not yet ranked; verdict: drawn to a challenge and not yet answered; disputed: a piece this key returned is disputed; person: a human piece in a kept problem has a seat open; gold: a piece this key committed gold on is accepted and awaits the reveal. */
  why: 'rank' | 'verdict' | 'disputed' | 'person' | 'gold';
  tracker: string | null;
}

/** A maintainer's takedown as a tracker reports it (QX-6). */
export interface Takedown {
  id: string;
  by: string;
  why: string;
  at: string;
}

export interface Pattern {
  title: string;
  done_when: string;
  slug: string;
  prev?: Hash | null;
  from?: Hash | null;
  settings?: Partial<Problem['settings']>;
  pieces: Problem['pieces'];
  /** Blob names to their rows, inline. */
  data?: Record<string, unknown[]>;
  topics?: string[];
  /** The stake of standing a claim on the pieces is backed by (QX-15): `min` on every piece, or on the families and pieces named. */
  stake?: { min: number; pieces?: string[] };
  /** The owner's gold (QX-16): the answers to some pieces by name, committed by hash before the work; the stake, left out, is the sum of the pieces' shares. */
  gold?: { answers: Record<string, Record<string, unknown>>; stake?: number };
}

export class Quilt {
  readonly hostName: string | undefined;

  constructor(readonly config: Config, readonly identity: Identity | null, readonly resolver: Resolver, hostName?: string) {
    this.hostName = hostName;
  }

  /** The home's library, held by the resolver: every Quilt over one resolver reads and writes the same one. */
  get library(): Library {
    return this.resolver.library;
  }

  model(): string {
    return modelFor(this.hostName, this.config.model);
  }

  by(can: Capability[] = this.config.can) {
    return { model: this.model(), client: 'quilt/0.1', can };
  }

  private save(): void {
    this.resolver.saveLibrary();
  }

  private needKey(): Identity {
    if (!this.identity) throw new Error('no key yet: run quilt init');
    return this.identity;
  }

  /** Where posts about a problem go: the trackers the library remembers for it, then the config's. */
  private trackersFor(problem: Hash): string[] {
    const entry = this.library.problems[problem];
    return entry ? [...new Set([...entry.trackers, ...this.config.trackers])] : this.config.trackers;
  }

  me() {
    return { address: this.identity?.address ?? null, name: this.config.name ?? null, model: this.model(), can: this.config.can, trackers: this.config.trackers, mirrors: this.config.mirrors, relays: this.config.relays, queued: this.resolver.queued(), problems: Object.keys(this.library.problems).length };
  }

  /** This key's standing as the first tracker that answers computes it (QX-1, QX-15): what it has, what is locked behind its claims, what is free to stake; null with no key or no tracker. */
  async standing(): Promise<{ tracker: string; standing: number; locked: number; free: number; locks: { problem: Hash; piece: Hash; amount: number; at: string }[] } | null> {
    const address = this.identity?.address;
    if (!address) return null;
    for (const t of this.config.trackers) {
      try {
        const r = await fetch(`${t}k/${address}/standing`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const j = (await r.json()) as { standing: number; locked: number; free: number; locks: { problem: Hash; piece: Hash; amount: number; at: string }[] };
        return { tracker: t, standing: j.standing, locked: j.locked, free: j.free, locks: j.locks };
      } catch {
        /* a tracker that does not answer is skipped */
      }
    }
    return null;
  }

  private readonly wellKnownCache = new Map<string, Promise<Record<string, unknown> | null>>();
  /** A tracker's well-known document, read once per Quilt; null when it does not answer. */
  wellKnown(tracker: string): Promise<Record<string, unknown> | null> {
    const t = tracker.endsWith('/') ? tracker : `${tracker}/`;
    let p = this.wellKnownCache.get(t);
    if (!p) {
      p = (async () => {
        try {
          const r = await fetch(`${t}.well-known/quilt`, { signal: AbortSignal.timeout(5000) });
          return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      })();
      this.wellKnownCache.set(t, p);
    }
    return p;
  }

  /** QX-17: where a tracker's coin lives, as its well-known says under stake: the home that keeps the coin log, and the burn rate a point of standing costs there; null where it honours none. */
  async coinAt(tracker: string): Promise<{ home: string; burn_rate: number } | null> {
    const t = tracker.endsWith('/') ? tracker : `${tracker}/`;
    const wk = await this.wellKnown(t);
    const stake = wk?.stake as { coin?: string | null; burn_rate?: number } | undefined;
    if (!stake?.coin || typeof stake.burn_rate !== 'number') return null;
    const home = stake.coin === 'here' ? t : stake.coin.endsWith('/') ? stake.coin : `${stake.coin}/`;
    return { home, burn_rate: stake.burn_rate };
  }

  /** This key's coin at a home (QX-17): balance, vested, locked, escrowed, free; null with no key or no answer. */
  async coinBalance(home: string): Promise<{ home: string; balance: number; vested: number; unvested: number; locked: number; escrowed: number; free: number; free_vested: number } | null> {
    const address = this.identity?.address;
    if (!address) return null;
    try {
      const r = await fetch(`${home}coin/balance/${address}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { balance: number; vested: number; unvested: number; locked: number; escrowed: number; free: number; free_vested: number };
      return { home, balance: j.balance, vested: j.vested, unvested: j.unvested, locked: j.locked, escrowed: j.escrowed, free: j.free, free_vested: j.free_vested };
    } catch {
      return null;
    }
  }

  /** This key's coin at the first of this client's trackers that carries one, or null. */
  async coin(): Promise<{ home: string; balance: number; vested: number; unvested: number; locked: number; escrowed: number; free: number; free_vested: number } | null> {
    for (const t of this.config.trackers) {
      const at = await this.coinAt(t);
      if (!at) continue;
      const b = await this.coinBalance(at.home);
      if (b) return b;
    }
    return null;
  }

  /** A pay to a problem (QX-17): coin escrowed on the coin log of the problem's home, paid per square to the roots of each set accepted after it, the rest back to this key when the problem completes. */
  async pay(problem: Hash, amount: number, perSquare: number): Promise<{ id: Hash; at: string | null; queued: boolean; error?: string; home: string }> {
    const id = this.needKey();
    if (!Number.isInteger(amount) || amount < 1 || !Number.isInteger(perSquare) || perSquare < 1) throw new Error('a pay is a whole amount and a whole price per square, each at least 1');
    let home: string | null = null;
    for (const t of this.trackersFor(problem)) {
      const at = await this.coinAt(t);
      if (at) {
        home = at.home;
        break;
      }
    }
    if (!home) throw new Error('no tracker this client knows for that problem carries the coin');
    const e = this.sign({ quilt: 1, type: 'pay', key: id.address, ts: new Date().toISOString(), body: { problem, amount, per_square: perSquare } });
    const r = await this.resolver.post(e, 'coin', [home]);
    if (r.error && !r.queued) throw new Error(`the coin's home refused the pay: ${r.error}`);
    return { id: eventId(e), ...r, home };
  }

  /** The stake a problem asks of a claim on its pieces (QX-15): a stake_rule event from the owner on the problem's log, replacing the one before. */
  async stakeRule(problem: Hash, min: number, pieces?: string[]): Promise<{ at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    if (!Number.isInteger(min) || min < 0) throw new Error('the stake is a whole number from 0');
    const e = this.sign({ quilt: 1, type: 'stake_rule', problem, key: id.address, ts: new Date().toISOString(), body: { min, ...(pieces && pieces.length ? { pieces } : {}) } });
    const r = await this.resolver.post(e, problem, this.trackersFor(problem));
    if (r.error && !r.queued) throw new Error(`the tracker refused the stake rule: ${r.error}`);
    return r;
  }

  /** The problem behind a link or hash, resolved and reduced, with the tracker's own view of its pieces where one answered. */
  async open(input: string): Promise<{ link: Link; hash: Hash; state: State; tracker: string | null; layer: LayerPiece[] | null; hidden: Takedown | null }> {
    const link = parseLink(input);
    const resolved = await this.resolver.resolve(link);
    if (!resolved) throw new Error('no resolver answered for that hash');
    const state = this.resolver.state(resolved);
    const now = new Date().toISOString();
    const trackers = [...new Set([...(resolved.tracker ? [resolved.tracker] : []), ...link.trackers, ...this.config.trackers])];
    const entry = this.library.problems[resolved.hash];
    this.library.problems[resolved.hash] = { title: state.envelope.problem.title, slug: state.envelope.problem.slug, trackers, first: entry?.first ?? now, last: now };
    this.save();
    const layer = resolved.tracker ? await this.layerOf(resolved.hash, resolved.tracker) : null;
    const hidden = resolved.tracker ? await this.takedownOf(resolved.hash, resolved.tracker) : null;
    return { link, hash: resolved.hash, state, tracker: resolved.tracker, layer, hidden };
  }

  /**
   * The tracker's own states for a problem's pieces, with each kind and its strength: where its layer (the challenge
   * window, the verifier kinds) says more than the core this client computes. Null when the tracker does not answer.
   */
  async layerOf(hash: Hash, tracker: string): Promise<LayerPiece[] | null> {
    try {
      const r = await fetch(`${tracker}p/${hash}/state`, { signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { pieces?: LayerPiece[] };
      return Array.isArray(j.pieces) ? j.pieces : null;
    } catch {
      return null;
    }
  }

  /** The map as a strip of marks, one per piece in file order, and the counts; the tracker's states where it answered, the core's otherwise. */
  mapText(state: State, layer: LayerPiece[] | null = null): string {
    const over = new Map((layer ?? []).map((l) => [l.hash, l] as const));
    const stateOf = (v: PieceView): string => over.get(v.piece.hash)?.state ?? v.state;
    const strip = state.pieces.map((v) => STATE_MARK[stateOf(v)] ?? '?').join('');
    const counts: Record<string, number> = {};
    for (const v of state.pieces) counts[stateOf(v)] = (counts[stateOf(v)] ?? 0) + 1;
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${k.replace('_', ' ')}`);
    return `${strip}\n${parts.join(', ')}${state.complete ? '; complete' : ''}`;
  }

  /** The kinds of the problem's pieces and how each earns its square, the weakest said so. */
  kindsText(state: State): string {
    const counts = new Map<string, number>();
    for (const v of state.pieces) counts.set(v.piece.verifier, (counts.get(v.piece.verifier) ?? 0) + 1);
    return `Kinds: ${[...counts].map(([verifier, n]) => {
      const k = kindWords(verifier);
      return `${n} ${verifier} (${k.strength}: ${k.says})`;
    }).join('; ')}.`;
  }

  /** The stake the problem asks (QX-15), as the tracker that answered holds it: one line, or none where nothing is asked. */
  stakeText(layer: LayerPiece[] | null): string[] {
    const staked = (layer ?? []).filter((l) => (l.stake ?? 0) > 0);
    if (staked.length === 0) return [];
    const amounts = [...new Set(staked.map((l) => l.stake!))].sort((a, b) => a - b);
    return [`Stake asked (QX-15): ${staked.length} of the pieces ask ${amounts.join(' or ')} of a key's standing, locked before the claim and forfeited if the acceptance is struck.`];
  }

  /** The owner's gold (QX-16), as the tracker that answered holds it: one line counting the squares, or none where nothing was committed. */
  goldText(layer: LayerPiece[] | null): string[] {
    const committed = (layer ?? []).filter((l) => l.gold !== null && l.gold !== undefined);
    if (committed.length === 0) return [];
    const count = (s: string) => committed.filter((l) => l.gold === s).length;
    const parts = [`${count('match')} verified`, `${count('miss')} missed`, `${count('pending')} awaiting the owner's reveal`];
    if (count('overruled')) parts.push(`${count('overruled')} overruled by a challenge`);
    if (count('lapsed')) parts.push(`${count('lapsed')} lapsed unrevealed`);
    return [`Gold (QX-16): ${committed.length} of the pieces have an answer the owner committed to before the work; ${parts.join(', ')}.`];
  }

  /** Whether the tracker that answered has taken the problem down (QX-6), and why, in its own word. */
  async takedownOf(hash: Hash, tracker: string): Promise<Takedown | null> {
    try {
      const r = await fetch(`${tracker}p/${hash}/scrape`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) return null;
      const j = (await r.json()) as { hidden?: Takedown | null };
      return j.hidden ?? null;
    } catch {
      return null;
    }
  }

  /** A maintainer's takedown (QX-6): a hide event on the identity log of this client's trackers; lifted with `on` false. */
  async hide(id: string, why: string, on = true): Promise<{ at: string | null; queued: boolean; error?: string }> {
    const k = this.needKey();
    const issues = plainTextProblems(why, 'why');
    if (issues.length) throw new Error(issues[0]);
    const e = this.sign({ quilt: 1, type: 'hide', key: k.address, ts: new Date().toISOString(), body: { id, why, on } });
    const r = await this.resolver.post(e, null, this.config.trackers);
    if (r.error && !r.queued) throw new Error(`the tracker refused the hide: ${r.error}`);
    return r;
  }

  summary(hash: Hash, state: State, tracker: string | null, layer: LayerPiece[] | null = null, hidden: Takedown | null = null): string {
    const p = state.envelope.problem;
    const owner = state.names.get(p.owner as `0x${string}`)?.name ?? p.owner;
    const lines = [
      `Problem ${hash}`,
      `The owner, ${owner}, titled it: "${p.title}"`,
      `and wrote of when it is done: "${p.done_when}"`,
      `${state.pieces.length} pieces, version ${state.chain.length} along prev.`,
      this.mapText(state, layer),
      this.kindsText(state),
      ...this.stakeText(layer),
      ...this.goldText(layer),
      `Legend: . open, i in flight, s sealed, v needs a second production, d disputed, p accepted within the window, a accepted, u unreachable, l locked, c challenged, j a panel ranking candidates, ? a kind neither this client nor the tracker that answered implements.`,
      tracker ? `Answered by ${tracker}.` : 'Answered from the cache or a mirror.',
      ...(hidden ? [`Taken down on ${tracker} by ${hidden.by}: "${hidden.why}" (${hidden.at}). The map above is still what the chain says.`] : []),
      `Link: ${makeLink(hash, tracker ? [tracker] : this.config.trackers, p.slug)}`,
    ];
    return lines.join('\n');
  }

  async search(query: string): Promise<{ problem: Hash; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[]; tracker: string; via: 'tracker' | 'relay' }[]> {
    const out = new Map<string, { problem: Hash; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[]; tracker: string; via: 'tracker' | 'relay' }>();
    for (const t of this.config.trackers) {
      try {
        const r = await fetch(`${t}search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = (await r.json()) as { problems: { problem: Hash; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[] }[] };
        for (const p of j.problems) if (!out.has(p.problem)) out.set(p.problem, { ...p, tracker: t, via: 'tracker' });
      } catch {
        /* a tracker that does not answer is skipped */
      }
    }
    // QX-14: what the relays carry, with the tracker the announce named as the place to open it.
    for (const a of await searchRelays(this.config.relays, query)) {
      if (out.has(a.problem)) continue;
      const counts = (a.announce.body as { counts?: Record<string, number> }).counts ?? {};
      out.set(a.problem, { problem: a.problem, title: a.title, slug: a.slug, owner: a.owner, pieces: Object.values(counts).reduce((n, c) => n + c, 0), counts, topics: a.topics, tracker: a.trackers[0] ?? a.relay, via: 'relay' });
    }
    return [...out.values()];
  }

  /**
   * The rarest piece for this key: the tracker's assisted next when one answers and names a piece, else computed here
   * from the map; then a claim, after a lock of standing where the problem asks a stake of the piece (QX-15).
   */
  async next(input: string): Promise<{ hash: Hash; pick: Pick; posted: { at: string | null; queued: boolean; error?: string }; author: string; stake: number; lock: 'standing' | 'coin' | null }> {
    if (!input.trim()) return this.offered();
    const id = this.needKey();
    const { hash, state, tracker } = await this.open(input);
    const trackers = tracker ? [tracker, ...this.config.trackers] : this.config.trackers;
    let pick: Pick | null = null;
    let takenDown: string | null = null;
    let stake = 0;
    let unaffordable: Hash[] = [];
    let coinPlan: { home: string; units: number; stake: number } | null = null;
    if (tracker) {
      try {
        const r = await fetch(`${tracker}p/${hash}/next?key=${id.address}&can=${this.config.can.join(',')}&model=${encodeURIComponent(this.model())}`, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = (await r.json()) as { piece: Hash | null; state?: string; agree?: string[]; lease_h?: number; stake?: number; unaffordable?: Hash[] };
          stake = j.stake ?? 0;
          unaffordable = Array.isArray(j.unaffordable) ? j.unaffordable : [];
          if (j.piece) {
            const view = state.byHash.get(j.piece);
            if (view) pick = next(state, id.address, { can: this.config.can, model: this.model() }, new Date().toISOString(), { exclude: new Set(state.pieces.filter((v) => v.piece.hash !== j.piece).map((v) => v.piece.hash)) });
            // A kind the core does not implement (human, judge:n, attest): the tracker's layer offered it, and the piece's
            // own brief, schema and lease are in the envelope this client holds.
            if (view && !pick && view.state === 'unknown') pick = {
              piece: view.piece, state: (j.state ?? 'open') as Pick['state'], brief: renderInputs(view, state), ...(view.piece.schema ? { schema: view.piece.schema } : {}),
              agree: j.agree ?? view.piece.agree ?? view.piece.schema?.required ?? [], requires: view.piece.requires, lease_h: j.lease_h ?? view.piece.lease_h ?? state.envelope.problem.settings.lease_h, availability: view.availability,
            };
          }
          // A tracker that names nothing is only saying its holds are taken; the map decides below.
        } else if (r.status === 410) {
          // QX-6: the tracker has taken the problem down; it takes no claim on it either.
          takenDown = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'taken down';
        }
      } catch {
        pick = null;
      }
    }
    if (takenDown) throw new Error(`${tracker} has taken this problem down: ${takenDown}`);
    const client = { can: this.config.can, model: this.model() };
    // The pieces the tracker left out for their stake are left out here too: a claim on one would be refused at its door.
    if (!pick) pick = next(state, id.address, client, new Date().toISOString(), { exclude: new Set(unaffordable) });
    if (!pick && unaffordable.length && tracker) {
      // QX-17: standing is short. Where the tracker honours coin and this key's free coin covers a piece's stake at the burn rate, coin is locked instead.
      const coin = await this.coinAt(tracker);
      const layer = coin ? await this.layerOf(hash, tracker) : null;
      const mine = coin ? await this.coinBalance(coin.home) : null;
      if (coin && layer && mine) {
        const byHash = new Map(layer.map((l) => [l.hash, l] as const));
        for (const candidate of unaffordable) {
          const asked = byHash.get(candidate)?.stake ?? 0;
          const units = asked * coin.burn_rate;
          if (asked <= 0 || units > mine.free) continue;
          const chosen = next(state, id.address, client, new Date().toISOString(), { exclude: new Set(state.pieces.filter((v) => v.piece.hash !== candidate).map((v) => v.piece.hash)) });
          if (!chosen) continue;
          pick = chosen;
          coinPlan = { home: coin.home, units, stake: asked };
          stake = asked;
          break;
        }
      }
    }
    if (!pick) throw new Error(unaffordable.length ? `every piece left on that problem asks a stake this key's free standing cannot cover (${tracker})` : 'nothing for this key on that problem right now');
    let lock: 'standing' | 'coin' | null = null;
    if (coinPlan) {
      // QX-17: the coin locked on the home's log, then the QX-15 lock naming it, then the claim; the person's own client asked once for the three.
      const onLog = this.sign({ quilt: 1, type: 'lock', key: id.address, ts: new Date().toISOString(), body: { problem: hash, piece: pick.piece.hash, amount: coinPlan.units } });
      const c = await this.resolver.post(onLog, 'coin', [coinPlan.home]);
      if (c.error || c.queued) throw new Error(`the coin's home did not take the lock of ${coinPlan.units} units${c.error ? `: ${c.error}` : ''}; nothing was claimed`);
      const atDoor = this.sign({ quilt: 1, type: 'lock', problem: hash, piece: pick.piece.hash, key: id.address, ts: new Date(Date.now() + 1).toISOString(), body: { kind: 'coin', amount: coinPlan.stake, id: eventId(onLog) } });
      const l = await this.resolver.post(atDoor, hash, trackers);
      if (l.error && !l.queued) throw new Error(`the tracker refused the coin lock of ${coinPlan.stake}: ${l.error}`);
      lock = 'coin';
    } else if (stake > 0) {
      // QX-15: the lock first, then the claim; the person's own client asked once for the pair.
      const atDoor = this.sign({ quilt: 1, type: 'lock', problem: hash, piece: pick.piece.hash, key: id.address, ts: new Date().toISOString(), body: { kind: 'standing', amount: stake } });
      const l = await this.resolver.post(atDoor, hash, trackers);
      if (l.error && !l.queued) throw new Error(`the tracker refused the lock of ${stake}: ${l.error}`);
      lock = 'standing';
    }
    const claim = this.sign({ quilt: 1, type: 'claim', problem: hash, piece: pick.piece.hash, key: id.address, ts: new Date(Date.now() + 2).toISOString(), body: { by: this.by() } });
    const posted = await this.resolver.post(claim, hash, trackers);
    this.library.pieces[pick.piece.hash] = { problem: hash, name: pick.piece.name, when: claim.ts, what: 'claimed', verifier: pick.piece.verifier };
    this.save();
    const owner = state.names.get(state.envelope.problem.owner as `0x${string}`)?.name ?? state.envelope.problem.owner;
    return { hash, pick, posted, author: owner, stake, lock };
  }

  /** Something to do when no problem is named: the standing list first (QX-4), then each tracker's offer in its order (QX-5). */
  async offered(): Promise<{ hash: Hash; pick: Pick; posted: { at: string | null; queued: boolean; error?: string }; author: string; stake: number; lock: 'standing' | 'coin' | null }> {
    const id = this.needKey();
    for (const p of Object.keys(this.library.seeding)) {
      try {
        return await this.next(p);
      } catch {
        /* nothing there for this key right now */
      }
    }
    for (const t of this.config.trackers) {
      let offers: { problem: Hash }[] = [];
      try {
        const r = await fetch(`${t}offer?key=${id.address}&can=${this.config.can.join(',')}&model=${encodeURIComponent(this.model())}`, { signal: AbortSignal.timeout(8000) });
        if (r.ok) offers = ((await r.json()) as { offers: { problem: Hash }[] }).offers;
      } catch {
        /* a tracker that does not answer is skipped */
      }
      for (const o of offers) {
        try {
          return await this.next(`${t}p/${o.problem}`);
        } catch {
          /* the next offer */
        }
      }
    }
    throw new Error('nothing to do for this key on any tracker right now');
  }

  /** Keeping a problem (QX-4): a seed event on its log, and the problem in this client's standing list. */
  async seed(problem: Hash, on: boolean): Promise<{ at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    const e = this.sign({ quilt: 1, type: 'seed', problem, key: id.address, ts: new Date().toISOString(), body: { on } });
    const r = await this.resolver.post(e, problem, this.trackersFor(problem));
    if (r.error && !r.queued) throw new Error(`the tracker refused the seed: ${r.error}`);
    if (on) this.library.seeding[problem] = e.ts;
    else delete this.library.seeding[problem];
    this.save();
    return r;
  }

  /** The piece said as text: its kind and how strongly that kind earns a square, the brief as the author's quoted words, the schema, what it requires, the lease. */
  /**
   * What waits on this key's person across the problems it keeps and the ones it has worked: a judge seat not yet
   * ranked, a challenge seat without its verdict, a dispute on a piece this key returned, and, in a kept problem, a human
   * piece with a seat open that this key has not filled. Nothing is written: the library's dates stay as they were.
   */
  async attention(limit = 20): Promise<{ items: AttentionItem[]; checked: string }> {
    const checked = new Date().toISOString();
    const me = this.identity?.address;
    const items: AttentionItem[] = [];
    if (!me) return { items, checked };
    const kept = Object.keys(this.library.seeding);
    const worked = Object.values(this.library.pieces).map((p) => p.problem);
    const golden = Object.keys(this.library.gold ?? {});
    const problems = [...new Set([...kept, ...worked, ...golden])].filter((h) => isHash(h)).slice(0, limit) as Hash[];
    for (const problem of problems) {
      let resolved: Awaited<ReturnType<Resolver['resolve']>>;
      try {
        resolved = await this.resolver.resolve(parseLink(problem));
      } catch {
        continue;
      }
      if (!resolved) continue;
      const state = this.resolver.state(resolved);
      const title = state.envelope.problem.title;
      const tracker = resolved.tracker;
      const layer = tracker ? await this.layerOf(problem, tracker) : null;
      const over = new Map((layer ?? []).map((l) => [l.hash, l] as const));
      const item = (piece: Hash | null, name: string | null, why: AttentionItem['why']) => items.push({ problem, title, piece, name, why, tracker });
      if (tracker) {
        const [panels, challenges] = await Promise.all([this.panels(problem, tracker), this.challenges(problem, tracker)]);
        for (const p of panels) if (p.outcome === 'open' && p.seats.some((s) => s.root === me && s.lapsed_at === null && !s.rank)) item(p.piece, p.name, 'rank');
        for (const c of challenges) if (c.outcome === 'open' && c.seats.some((s) => s.root === me && s.lapsed_at === null && !s.verdict)) item(c.piece, c.name, 'verdict');
        // QX-16: a piece this key committed gold on, accepted and not yet revealed, as the tracker holds it.
        for (const [piece, g] of Object.entries(this.library.gold?.[problem] ?? {})) {
          const l = over.get(piece as Hash);
          if (l && l.gold === 'pending' && !g.revealed && ['accepted_provisional', 'accepted', 'challenged'].includes(l.state)) item(piece as Hash, g.name, 'gold');
        }
      }
      for (const v of state.pieces) {
        const st = over.get(v.piece.hash)?.state ?? v.state;
        const mine = this.library.pieces[v.piece.hash];
        if (st === 'disputed' && mine?.what === 'returned') item(v.piece.hash, v.piece.name, 'disputed');
        if (v.piece.verifier === 'human' && this.library.seeding[problem] && (st === 'open' || st === 'needs_verify') && mine?.what !== 'returned') item(v.piece.hash, v.piece.name, 'person');
      }
    }
    return { items, checked };
  }

  pieceText(hash: Hash, pick: Pick, author: string, stake = 0): string {
    const k = kindWords(pick.piece.verifier);
    const lines = [
      `Piece ${pick.piece.name} (${pick.piece.hash}) of problem ${hash}, verifier ${pick.piece.verifier}, state ${pick.state.replace('_', ' ')}.`,
      `A square of this kind is ${k.strength}: ${k.says}.`,
      `The author, ${author}, wrote this brief: "${pick.brief}"`,
      pick.schema ? `A return is an object with these fields: ${canonical(pick.schema.properties)}; required: ${pick.schema.required.join(', ')}; agreement is on: ${pick.agree.join(', ')}.` : `A return is { patch }: a unified diff against ${pick.piece.workspace?.repo ?? 'the workspace'} at ${pick.piece.workspace?.base ?? 'base'}, or the empty string; the check is ${pick.piece.check?.file ?? 'the check file'}.`,
      pick.requires.length ? `It requires: ${pick.requires.join(', ')}.` : 'It requires nothing in particular.',
      `The lease is ${pick.lease_h} hours.`,
      ...(stake > 0 ? [`It asks a stake of ${stake} (QX-15): that much of this key's standing is locked behind the claim until the piece's window closes, and forfeited if the acceptance is struck.`] : []),
    ];
    return lines.join('\n');
  }

  /** A return handed in: a commit, then its reveal; and what the piece waits for next, by its kind. */
  async return(problem: Hash, piece: Hash, ret: Record<string, unknown>): Promise<{ commit: { at: string | null; queued: boolean; error?: string }; reveal: { at: string | null; queued: boolean; error?: string }; waits: string }> {
    const id = this.needKey();
    const entry = this.library.problems[problem];
    const trackers = entry ? [...new Set([...entry.trackers, ...this.config.trackers])] : this.config.trackers;
    for (const s of Object.values(ret)) if (typeof s === 'string') {
      const issues = plainTextProblems(s, 'return');
      if (issues.length) throw new Error(issues[0]);
    }
    const nonce = newNonce();
    const commit = this.sign({ quilt: 1, type: 'commit', problem, piece, key: id.address, ts: new Date().toISOString(), body: { h: commitHash(ret, nonce) } });
    const c = await this.resolver.post(commit, problem, trackers);
    if (c.error && !c.queued) throw new Error(`the tracker refused the commit: ${c.error}`);
    const reveal = this.sign({ quilt: 1, type: 'reveal', problem, piece, key: id.address, ts: new Date(Date.now() + 1).toISOString(), body: { return: ret, nonce, by: this.by() } });
    const r = await this.resolver.post(reveal, problem, trackers);
    if (r.error && !r.queued) throw new Error(`the tracker refused the reveal: ${r.error}`);
    const known = this.library.pieces[piece];
    this.library.pieces[piece] = { problem, name: known?.name ?? piece, when: reveal.ts, what: 'returned', ...(known?.verifier ? { verifier: known.verifier } : {}) };
    this.save();
    return { commit: c, reveal: r, waits: waitsText(known?.verifier) };
  }

  /** A ranking of a judge piece's candidates by a key drawn to its panel (QX-2): every candidate's digest once, first choice first, signed and posted. */
  async rank(problem: Hash, piece: Hash, ranking: Hash[]): Promise<{ id: Hash; at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    if (!Array.isArray(ranking) || ranking.length === 0 || !ranking.every((d) => isHash(d))) throw new Error('a ranking is a list of candidate digests, first choice first');
    if (new Set(ranking).size !== ranking.length) throw new Error('a ranking names each digest once');
    const e = this.sign({ quilt: 1, type: 'rank', problem, piece, key: id.address, ts: new Date().toISOString(), body: { ranking } });
    const r = await this.resolver.post(e, problem, this.trackersFor(problem));
    if (r.error && !r.queued) throw new Error(`the tracker refused the rank: ${r.error}`);
    return { id: eventId(e), ...r };
  }

  /** The problem's judge panels as the first tracker that answers computes them: the one that answered for the problem, then the known ones. */
  async panels(problem: Hash, tracker: string | null = null): Promise<PanelListing[]> {
    for (const t of [...new Set([...(tracker ? [tracker] : []), ...this.trackersFor(problem)])]) {
      try {
        const r = await fetch(`${t}p/${problem}/panels`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        return ((await r.json()) as { panels: PanelListing[] }).panels;
      } catch {
        /* a tracker that does not answer is skipped */
      }
    }
    return [];
  }

  /** The panels said as text: each candidate's return quoted, its signer named once the panel has decided and "a candidate" while the judges rank blind, the seats, each rank, the outcome. */
  panelsText(list: PanelListing[], state: State): string {
    if (list.length === 0) return 'No judge panel on this problem.';
    const who = (a: string) => state.names.get(a as `0x${string}`)?.name ?? a;
    const outcome: Record<PanelListing['outcome'], string> = {
      open: 'sitting: the candidates are in and the judges drawn are ranking them',
      decided: 'decided: the candidate a majority ranked first is accepted',
      void: 'void: the panel ran out before a majority agreed, and the piece is disputed',
    };
    return list.map((p) => {
      const lines = [`Panel on ${p.name} (${p.verifier ?? 'judge'}, ${p.majority} of ${p.panel} decide), ${outcome[p.outcome]}.`];
      for (const c of p.candidates) lines.push(`${c.root ? who(c.root) : 'A candidate'}${c.digest === p.winner ? ', ranked first by the majority,' : ''} returned, as digest ${c.digest}: ${canonical(c.return)}`);
      if (p.seats.length === 0) lines.push('No seats drawn yet.');
      for (const s of p.seats) {
        const judge = who(s.root);
        if (s.rank) lines.push(`${judge}, drawn, ranked: ${s.rank.ranking.join(', ')}.`);
        else if (s.lapsed_at) lines.push(`${judge}, drawn, let the seat lapse.`);
        else lines.push(`${judge}, drawn, has not ranked.`);
      }
      return lines.join('\n');
    }).join('\n\n');
  }

  async decline(problem: Hash, piece: Hash, reason: 'cannot' | 'unclear' | 'refuse' | 'duplicate' | 'no_time') {
    const id = this.needKey();
    const e = this.sign({ quilt: 1, type: 'decline', problem, piece, key: id.address, ts: new Date().toISOString(), body: { reason } });
    return this.resolver.post(e, problem, this.trackersFor(problem));
  }

  /** A challenge of a piece's provisional acceptance (QX-1): a stake of this key's standing and one sentence of ground, signed and posted. */
  async challenge(problem: Hash, piece: Hash, stake: number, ground: string): Promise<{ id: Hash; at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    if (!Number.isInteger(stake) || stake < 1) throw new Error('the stake is a whole number of at least 1');
    const issues = plainTextProblems(ground, 'ground');
    if (issues.length) throw new Error(issues[0]);
    const e = this.sign({ quilt: 1, type: 'challenge', problem, piece, key: id.address, ts: new Date().toISOString(), body: { stake, ground } });
    const r = await this.resolver.post(e, problem, this.trackersFor(problem));
    if (r.error && !r.queued) throw new Error(`the tracker refused the challenge: ${r.error}`);
    return { id: eventId(e), ...r };
  }

  /** A verdict on a challenge this key was drawn to judge: for the challenger or for the author, with this judge's own return as evidence where it has one. */
  async verdict(problem: Hash, piece: Hash, challenge: Hash, side: Side, ret?: Record<string, unknown>): Promise<{ id: Hash; at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    if (!SIDES.includes(side)) throw new Error(`a verdict is for the ${SIDES.join(' or the ')}`);
    if (ret) for (const s of Object.values(ret)) if (typeof s === 'string') {
      const issues = plainTextProblems(s, 'return');
      if (issues.length) throw new Error(issues[0]);
    }
    const e = this.sign({ quilt: 1, type: 'verdict', problem, piece, key: id.address, ts: new Date().toISOString(), body: { challenge, for: side, ...(ret ? { return: ret } : {}) } });
    const r = await this.resolver.post(e, problem, this.trackersFor(problem));
    if (r.error && !r.queued) throw new Error(`the tracker refused the verdict: ${r.error}`);
    return { id: eventId(e), ...r };
  }

  /** The problem's challenges as the first tracker that answers computes them: the one that answered for the problem, then the known ones. */
  async challenges(problem: Hash, tracker: string | null = null): Promise<ChallengeListing[]> {
    for (const t of [...new Set([...(tracker ? [tracker] : []), ...this.trackersFor(problem)])]) {
      try {
        const r = await fetch(`${t}p/${problem}/challenges`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        return ((await r.json()) as { challenges: ChallengeListing[] }).challenges;
      } catch {
        /* a tracker that does not answer is skipped */
      }
    }
    return [];
  }

  /** The challenges said as text: the ground as the challenger's quoted words, the seats, each verdict with the judge named and its return quoted. */
  challengesText(list: ChallengeListing[], state: State): string {
    if (list.length === 0) return 'No challenge on this problem.';
    const who = (a: string) => state.names.get(a as `0x${string}`)?.name ?? a;
    const outcome: Record<ChallengeListing['outcome'], string> = {
      open: 'open: the piece is challenged while the panel sits',
      held: 'held: the acceptance was struck and the piece is open again',
      failed: 'failed: the acceptance stands and the stake was lost',
      void: 'void: no panel could decide it and the acceptance stands',
    };
    return list.map((c) => {
      const lines = [
        `Challenge ${c.id} on ${c.name ?? c.piece}, by ${who(c.root)} with a stake of ${c.stake}, ${outcome[c.outcome]}.`,
        `${who(c.root)} wrote as the ground: "${c.ground}"`,
      ];
      if (c.seats.length === 0) lines.push('No seats drawn yet.');
      for (const s of c.seats) {
        const judge = who(s.root);
        if (s.verdict) lines.push(`${judge}, drawn, answered for the ${s.verdict.for}${s.verdict.return ? ` and returned: ${canonical(s.verdict.return)}` : ''}.`);
        else if (s.lapsed_at) lines.push(`${judge}, drawn, let the seat lapse.`);
        else lines.push(`${judge}, drawn, has not answered.`);
      }
      return lines.join('\n');
    }).join('\n\n');
  }

  /**
   * The accepted returns of a problem as quoted text with the signers named: the core's accepting sets, and on a piece of
   * a kind the core does not implement that the tracker holds as accepted, every return on it, with the kind and its
   * strength beside the name, since which of them the tracker counted is the tracker's word.
   */
  acceptedText(state: State, layer: LayerPiece[] | null = null): string {
    const over = new Map((layer ?? []).map((l) => [l.hash, l] as const));
    const who = (a: string) => state.names.get(a as `0x${string}`)?.name ?? a;
    const lines: string[] = [];
    for (const v of state.pieces) {
      if (v.accepting) {
        const verified = over.get(v.piece.hash)?.verified ? ' (verified: the set agreed with the answer the owner committed to before the work)' : '';
        if (v.accepting.kind === 'agree') for (const r of v.accepting.reveals) lines.push(`${v.piece.name}${verified}, ${who(r.root)} returned: ${canonical(r.return)}`);
        else lines.push(`${v.piece.name}${verified}, ${who(v.accepting.patch.root)} returned a patch of ${(v.accepting.patch.return.patch as string).length} characters, run by ${v.accepting.runs.map((r) => r.root).join(' and ')}`);
        continue;
      }
      const l = over.get(v.piece.hash);
      if (!l || !['accepted', 'accepted_provisional', 'challenged'].includes(l.state) || v.state !== 'unknown') continue;
      const how = l.attested ? 'attested, the actor\'s own word' : `${l.strength ?? 'accepted'} as the tracker holds it`;
      for (const r of v.reveals) lines.push(`${v.piece.name} (${l.verifier}; ${how}), ${who(r.root)} returned: ${canonical(r.return)}`);
    }
    return lines.length ? lines.join('\n') : 'Nothing accepted yet.';
  }

  /**
   * The owner's reveal of the gold on a piece (QX-16), from the projection and nonce kept at publishing: posted to the
   * problem's trackers, and the tracker that took it says what it decided, a match or a miss.
   */
  async revealGold(problem: Hash, piece: Hash): Promise<{ id: Hash; at: string | null; queued: boolean; error?: string; name: string; outcome: string | null }> {
    const id = this.needKey();
    const kept = this.library.gold?.[problem]?.[piece];
    if (!kept) throw new Error('no gold kept here for that piece: the projection and nonce are the owner\'s, in the library of the home that published');
    const e = this.sign({ quilt: 1, type: 'gold_reveal', problem, piece, key: id.address, ts: new Date().toISOString(), body: { projection: kept.projection, nonce: kept.nonce } });
    const r = await this.resolver.post(e, problem, this.trackersFor(problem));
    if (r.error && !r.queued) throw new Error(`the tracker refused the reveal: ${r.error}`);
    kept.revealed = e.ts;
    this.save();
    const layer = r.at ? await this.layerOf(problem, r.at) : null;
    const outcome = layer?.find((l) => l.hash === piece)?.gold ?? null;
    return { id: eventId(e), ...r, name: kept.name, outcome };
  }

  /** Builds, signs and publishes an envelope from a pattern, with its blobs; then announces it, and posts the stake rule and the gold where the pattern carries them. */
  async publish(pattern: Pattern): Promise<{ hash: Hash; link: string; posted: string[]; refused: string[]; relays: string[]; gold: { pieces: number; stake: number } | null }> {
    const id = this.needKey();
    const blobs = new Map<Hash, Uint8Array>();
    const data: Record<string, Hash> = {};
    for (const [name, rows] of Object.entries(pattern.data ?? {})) {
      const bytes = new TextEncoder().encode(JSON.stringify(rows));
      const h = hashBytes(bytes);
      blobs.set(h, bytes);
      data[name] = h;
    }
    const problem: Problem = {
      title: pattern.title,
      done_when: pattern.done_when,
      owner: id.address,
      slug: pattern.slug,
      prev: pattern.prev ?? null,
      from: pattern.from ?? null,
      settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 10, budget: 1000, patch_max: 100000, ...pattern.settings },
      pieces: pattern.pieces,
      data,
    };
    const unsigned = { quilt: 1 as const, problem, hints: { trackers: this.config.trackers, mirrors: this.config.mirrors } };
    const envelope: Envelope = { ...unsigned, sig: signObject(unsigned, id.secret) };
    const problems = envelopeProblems(envelope);
    if (problems.length) throw new Error(problems[0]);
    const hash = problemHash(envelope);
    const body = JSON.stringify({ envelope, blobs: Object.fromEntries([...blobs].map(([h, b]) => [h, Buffer.from(b).toString('base64')])) });
    const posted: string[] = [];
    const refused: string[] = [];
    let relays: string[] = [];
    let gold: { pieces: number; stake: number } | null = null;
    for (const t of this.config.trackers) {
      try {
        const r = await fetch(`${t}p`, { method: 'POST', body, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (r.status === 201) posted.push(t);
        else refused.push(`${t}: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`);
      } catch (err) {
        refused.push(`${t}: ${(err as Error).message}`);
      }
    }
    if (posted.length) {
      const announce = this.sign({ quilt: 1, type: 'announce', problem: hash, key: id.address, ts: new Date().toISOString(), body: { title: problem.title, slug: problem.slug, done_when: problem.done_when, topics: pattern.topics ?? [], counts: {}, trackers: posted, mirrors: this.config.mirrors } });
      await this.resolver.post(announce, hash, posted);
      if (this.config.relays.length) relays = (await postToRelays(this.config.relays, announcementEvent(announce, id.secret))).posted;
      const version = this.sign({ quilt: 1, type: 'version', problem: hash, key: id.address, ts: new Date().toISOString(), body: { slug: problem.slug, hash } });
      await this.resolver.post(version, hash, posted);
      if (pattern.stake) {
        // QX-15: the stake the owner asks, on the problem's log right after the envelope.
        const rule = this.sign({ quilt: 1, type: 'stake_rule', problem: hash, key: id.address, ts: new Date().toISOString(), body: { min: pattern.stake.min, ...(pattern.stake.pieces?.length ? { pieces: pattern.stake.pieces } : {}) } });
        const r = await this.resolver.post(rule, hash, posted);
        if (r.error && !r.queued) refused.push(`stake rule: ${r.error}`);
      }
      if (pattern.gold) {
        // QX-16: each answer projected to the piece's agreed fields and committed by hash with its own nonce; the projections and nonces stay in the library.
        const pieces = expandPieces(problem, blobs);
        const commitments: Record<string, Hash> = {};
        const kept: Record<string, { name: string; projection: Record<string, unknown>; nonce: string }> = {};
        let shares = 0;
        for (const [name, answer] of Object.entries(pattern.gold.answers)) {
          const piece = pieces.find((x) => x.name === name);
          if (!piece) throw new Error(`gold: no piece named ${name}`);
          if (!piece.schema || piece.verifier === 'check' || piece.verifier === 'score') throw new Error(`gold: ${name} has no agreed fields to commit to`);
          const fields = agreeFields(piece.schema, piece.agree);
          const projection: Record<string, unknown> = {};
          for (const f of fields) {
            if (!(f in answer)) throw new Error(`gold: the answer for ${name} lacks ${f}`);
            projection[f] = answer[f];
          }
          const nonce = newNonce();
          commitments[piece.hash] = commitHash(projection, nonce);
          kept[piece.hash] = { name, projection, nonce };
          const covered = pattern.stake && (!pattern.stake.pieces?.length || pattern.stake.pieces.includes(piece.family) || pattern.stake.pieces.includes(piece.name));
          shares += Math.max(1, covered ? pattern.stake!.min : 0);
        }
        const stake = pattern.gold.stake ?? shares;
        const g = this.sign({ quilt: 1, type: 'gold', problem: hash, key: id.address, ts: new Date().toISOString(), body: { commitments, stake } });
        const r = await this.resolver.post(g, hash, posted);
        if (r.error && !r.queued) refused.push(`gold: ${r.error}`);
        else {
          this.library.gold ??= {};
          this.library.gold[hash] = kept;
          gold = { pieces: Object.keys(kept).length, stake };
        }
      }
    }
    const now = new Date().toISOString();
    this.library.problems[hash] = { title: problem.title, slug: problem.slug, trackers: posted, first: now, last: now };
    this.save();
    return { hash, link: makeLink(hash, posted, problem.slug), posted, refused, relays, gold };
  }

  /** A name event for this key. */
  async setName(name: string): Promise<{ at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    const issues = plainTextProblems(name, 'name');
    if (issues.length) throw new Error(issues[0]);
    const e = this.sign({ quilt: 1, type: 'name', key: id.address, ts: new Date().toISOString(), body: { name } });
    return this.resolver.post(e, null, this.config.trackers);
  }

  private sign(unsigned: Unsigned): Event {
    return signEvent(unsigned, this.needKey().secret);
  }
}
