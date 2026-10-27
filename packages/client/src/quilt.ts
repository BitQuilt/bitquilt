/**
 * Quilt: the one thing that signs with the home's key, reads the trackers, and says what it read as text for a model.
 * The MCP server (mcp.ts, tools.ts) and the page (page.ts) are thin shells over it; the text itself is made in
 * render.ts from what is read here. Other people's words come out only as quoted text with the signer named.
 */
import { type Address, type Capability, type Client, type DeclineReason, type Envelope, type Event, type Hash, type Pick, type Piece, type Problem, type State, type Unsigned, DECLINE_REASONS, agreeFields, commitHash, eventId, expandPieces, hashBytes, isHash, newNonce, next, plainTextProblems, problemHash, renderInputs, signEvent, signObject, envelopeProblems, isAddress } from '@bitquilt/core';
import type { Config, Identity } from './config.js';
import { type Link, makeLink, parseLink } from './link.js';
import { type ChallengeListing, type GoldCount, type LayerPiece, type Opened, type PanelListing, type Scrape, SIDES, type Side, type Takedown } from './listings.js';
import { announcementEvent, postToRelays, searchRelays } from './relay.js';
import { type Library, type Posted, type Resolver, askJson } from './resolver.js';
import { acceptedText, challengesText, layerByHash, nameOf, panelsText, pieceText, summary, waitsText } from './render.js';

export type { Library, Posted } from './resolver.js';

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

/**
 * A problem as a person writes it for `publish`: the title, what done looks like, a slug, and the pieces as the core's
 * envelope takes them, with the data rows inline under the blob names the pieces draw on, and topics for the index
 * (QX-13). `publish` fills what is left out: the settings' defaults (a 48-hour challenge window, a 2-hour lease, the
 * endgame at 10 pieces, a budget of 1000, a patch of at most 100000 characters), `prev` and `from` as null, the owner
 * as this key, and the hints as this client's trackers and mirrors.
 */
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
  /** The owner's gold (QX-16): the answers to some pieces by name, committed by hash before the work; the stake, left out, is the sum of the pieces' shares (two a piece where no stake rule applies). */
  gold?: { answers: Record<string, Record<string, unknown>>; stake?: number };
}

/** This key's standing as a tracker computes it (QX-1, QX-15): what it has, what is locked behind its claims, what is free to stake. */
export interface Standing {
  tracker: string;
  standing: number;
  locked: number;
  free: number;
  locks: { problem: Hash; piece: Hash; amount: number; at: string }[];
}

/** This key's coin at a home (QX-17), as /coin/balance answers it: the balance in units, what has vested, what is locked or escrowed, and what is free. `home` is the coin's home, the tracker that keeps the coin log. */
export interface CoinBalance {
  home: string;
  balance: number;
  vested: number;
  unvested: number;
  locked: number;
  escrowed: number;
  free: number;
  free_vested: number;
}

/** A piece handed to this key by `next`: the pick, where the claim went, the owner by name, and what was locked before the claim. */
export interface Handed {
  hash: Hash;
  pick: Pick;
  posted: Posted;
  owner: string;
  stake: number;
  lock: 'standing' | 'coin' | null;
}

/** A plan to lock coin in place of standing (QX-17): where the coin log is, how many units at the burn rate, and the stake they stand for. */
interface CoinPlan { coinHome: string; units: number; stake: number }

/** Whether a string is one of the core's fixed decline reasons. */
function isDeclineReason(s: string): s is DeclineReason {
  return (DECLINE_REASONS as readonly string[]).includes(s);
}

/**
 * A Quilt holds the home's key, its config and a resolver, and keeps three things true. It signs with the home's one
 * key and nothing else: every event leaves through `sign`. A post goes to the trackers the library remembers for the
 * problem, then the config's (`trackersFor`), and waits in the resolver's queue when none takes it. The library records
 * what this key opened, claimed, returned, seeded and committed, and is saved after each.
 */
export class Quilt {
  readonly hostName: string | undefined;
  /** A tracker's well-known document, read once per Quilt. */
  private readonly wellKnownCache = new Map<string, Promise<Record<string, unknown> | null>>();

  constructor(readonly config: Config, readonly identity: Identity | null, readonly resolver: Resolver, hostName?: string) {
    this.hostName = hostName;
  }

  /** The person at the page hands in as a person: the same key and resolver, model `human`, capability `person`. */
  static asPerson(config: Config, identity: Identity | null, resolver: Resolver): Quilt {
    return new Quilt({ ...config, model: 'human', can: ['person', 'web', 'files'] }, identity, resolver, 'human');
  }

  /** The home's library, held by the resolver: every Quilt over one resolver reads and writes the same one. */
  get library(): Library {
    return this.resolver.library;
  }

  /** The model this client declares on its claims and reveals: the config's where it names one, else the host's vendor and name. */
  model(): string {
    return modelFor(this.hostName, this.config.model);
  }

  /** The declaration a claim, a reveal and a run carry: the model, this client, and what it can do. */
  by(can: Capability[] = this.config.can) {
    return { model: this.model(), client: 'quilt/0.1', can };
  }

  /** What the core's `next` asks of a client: what it can do and the model it declares. */
  private client(): Client {
    return { can: this.config.can, model: this.model() };
  }

  private save(): void {
    this.resolver.saveLibrary();
  }

  private needKey(): Identity {
    if (!this.identity) throw new Error('no key yet: run quilt init');
    return this.identity;
  }

  private sign(unsigned: Unsigned): Event {
    return signEvent(unsigned, this.needKey().secret);
  }

  /**
   * Now, or a millisecond or two later than now, so that events this call posts together fold in the order they were
   * written (reduce.ts, orderReceipts): the lock before the claim, the commit before the reveal.
   */
  private stamp(after = 0): string {
    return new Date(Date.now() + after).toISOString();
  }

  /**
   * Signs an event and posts it to the trackers in order: the first that takes it is `at`; none taking it, it waits in
   * the queue. A refusal throws, with the tracker's reason under `what`; a queued event does not, since it is signed
   * and will go out, and the caller records it as written.
   */
  private async postSigned(unsigned: Unsigned, log: Hash | null | 'coin', trackers: string[], what: string): Promise<{ event: Event; posted: Posted }> {
    const event = this.sign(unsigned);
    const posted = await this.resolver.post(event, log, trackers);
    if (posted.error && !posted.queued) throw new Error(`${log === 'coin' ? 'the coin\'s home' : 'the tracker'} refused the ${what}: ${posted.error}`);
    return { event, posted };
  }

  /** Where posts about a problem go, each once: the trackers named `first` (the one that answered, a link's), then the ones the library remembers for it, then the config's. */
  private trackersFor(problem: Hash, first: string[] = []): string[] {
    return [...new Set([...first, ...(this.library.problems[problem]?.trackers ?? []), ...this.config.trackers])];
  }

  /** The first tracker that answers: `ask` is put to each in order, and the first answer that is not null is it; null when none answers. */
  private async firstAnswer<T>(trackers: string[], ask: (tracker: string) => Promise<T | null>): Promise<T | null> {
    for (const t of trackers) {
      const answer = await ask(t);
      if (answer !== null) return answer;
    }
    return null;
  }

  /** Every string in a return through the plain-text gate; the first problem found is thrown. */
  private gate(ret: Record<string, unknown>): void {
    for (const s of Object.values(ret)) if (typeof s === 'string') {
      const issues = plainTextProblems(s, 'return');
      if (issues.length) throw new Error(issues[0]);
    }
  }

  /** This client as it knows itself, from memory and the library alone: the address, name, model, capabilities, trackers, mirrors, relays, what waits in the queue, and how many problems the library holds. */
  me() {
    return { address: this.identity?.address ?? null, name: this.config.name ?? null, model: this.model(), can: this.config.can, trackers: this.config.trackers, mirrors: this.config.mirrors, relays: this.config.relays, queued: this.resolver.queued(), problems: Object.keys(this.library.problems).length };
  }

  /** This key's standing as the first tracker that answers computes it; null with no key or no tracker. */
  async standing(): Promise<Standing | null> {
    const address = this.identity?.address;
    if (!address) return null;
    return this.firstAnswer(this.config.trackers, async (t) => {
      const j = await askJson<Omit<Standing, 'tracker'>>(`${t}k/${address}/standing`);
      return j && { tracker: t, standing: j.standing, locked: j.locked, free: j.free, locks: j.locks };
    });
  }

  /** A tracker's well-known document, read once per Quilt; null when it does not answer. */
  wellKnown(tracker: string): Promise<Record<string, unknown> | null> {
    const t = tracker.endsWith('/') ? tracker : `${tracker}/`;
    let p = this.wellKnownCache.get(t);
    if (!p) {
      p = askJson<Record<string, unknown>>(`${t}.well-known/quilt`);
      this.wellKnownCache.set(t, p);
    }
    return p;
  }

  /** The tracker's state for a problem: its pieces as the layer sees them, and the owner's gold summed (QX-16). Null when the tracker does not answer. */
  async trackerState(hash: Hash, tracker: string): Promise<{ pieces: LayerPiece[]; gold: GoldCount | null } | null> {
    const j = await askJson<{ pieces?: LayerPiece[]; gold?: GoldCount }>(`${tracker}p/${hash}/state`);
    return j && Array.isArray(j.pieces) ? { pieces: j.pieces, gold: j.gold ?? null } : null;
  }

  /**
   * The tracker's own states for a problem's pieces, with each kind and its strength: where its layer (the challenge
   * window, the verifier kinds) says more than the core this client computes. Null when the tracker does not answer.
   */
  async layerOf(hash: Hash, tracker: string): Promise<LayerPiece[] | null> {
    return (await this.trackerState(hash, tracker))?.pieces ?? null;
  }

  /** The tracker's scrape of a problem: whether it has taken it down (QX-6) and why, in its own word, and who keeps it (QX-4). Null when the tracker does not answer. */
  async scrapeOf(hash: Hash, tracker: string): Promise<Scrape | null> {
    const j = await askJson<{ hidden?: Takedown | null; seeders?: number; last_seeded?: string | null }>(`${tracker}p/${hash}/scrape`);
    return j && { hidden: j.hidden ?? null, seeders: j.seeders ?? 0, last_seeded: j.last_seeded ?? null };
  }

  /** The problem behind a link or hash, resolved and reduced, with the tracker's own view of its pieces and its scrape where one answered; the library remembers it and where it was found. */
  async open(input: string): Promise<Opened & { link: Link; layer: LayerPiece[] | null; hidden: Takedown | null; gold: GoldCount | null; scrape: Scrape | null }> {
    const link = parseLink(input);
    const resolved = await this.resolver.resolve(link);
    if (!resolved) throw new Error('no resolver answered for that hash');
    const state = this.resolver.state(resolved);
    const now = this.stamp();
    const trackers = this.trackersFor(resolved.hash, [...(resolved.tracker ? [resolved.tracker] : []), ...link.trackers]);
    const entry = this.library.problems[resolved.hash];
    this.library.problems[resolved.hash] = { title: state.envelope.problem.title, slug: state.envelope.problem.slug, trackers, first: entry?.first ?? now, last: now };
    this.save();
    const st = resolved.tracker ? await this.trackerState(resolved.hash, resolved.tracker) : null;
    const scrape = resolved.tracker ? await this.scrapeOf(resolved.hash, resolved.tracker) : null;
    return { link, hash: resolved.hash, state, tracker: resolved.tracker, layer: st?.pieces ?? null, hidden: scrape?.hidden ?? null, gold: st?.gold ?? null, scrape };
  }

  /** Problems whose title, slug, topics or statement of done carry the words, from every tracker this client knows and then the relays (QX-14), each problem once with the first place that answered for it. */
  async search(query: string): Promise<{ problem: Hash; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[]; tracker: string; via: 'tracker' | 'relay' }[]> {
    type Found = { problem: Hash; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[] };
    const out = new Map<string, Found & { tracker: string; via: 'tracker' | 'relay' }>();
    for (const t of this.config.trackers) {
      const j = await askJson<{ problems: Found[] }>(`${t}search?q=${encodeURIComponent(query)}`);
      for (const p of j?.problems ?? []) if (!out.has(p.problem)) out.set(p.problem, { ...p, tracker: t, via: 'tracker' });
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
   * The rarest piece for this key, claimed: the tracker's assisted next where one answers and names a piece, else the
   * core's `next` over the map; a lock of standing or of coin before the claim where the problem asks a stake of the
   * piece (QX-15, QX-17); the claim recorded in the library. With no problem named, `offered`.
   */
  async next(input: string): Promise<Handed> {
    if (!input.trim()) return this.offered();
    const id = this.needKey();
    const { hash, state, tracker } = await this.open(input);
    const trackers = this.trackersFor(hash);
    // 1. The tracker's word, where one answered: the piece it names, the stake it asks, the pieces this key cannot cover.
    const asked = tracker ? await this.askedNext(hash, state, tracker) : { pick: null, stake: 0, unaffordable: [] as Hash[] };
    let { pick, stake } = asked;
    // 2. Else the map, leaving out the pieces the tracker left out for their stake: a claim on one would be refused at its door.
    pick ??= next(state, id.address, this.client(), this.stamp(), { exclude: new Set(asked.unaffordable) });
    // 3. Else coin in place of standing (QX-17), where the tracker carries it and this key's free coin covers a stake.
    let plan: CoinPlan | null = null;
    if (!pick && asked.unaffordable.length && tracker) {
      const instead = await this.coinInstead(hash, state, tracker, asked.unaffordable);
      if (instead) ({ pick, plan } = instead);
      if (plan) stake = plan.stake;
    }
    if (!pick) throw new Error(asked.unaffordable.length ? `every piece left on that problem asks a stake this key's free standing cannot cover (${tracker})` : 'nothing for this key on that problem right now');
    // 4. The lock before the claim, where a stake is asked.
    const lock = await this.lockBefore(hash, pick.piece.hash, trackers, stake, plan);
    // 5. The claim, stamped after the lock so the two fold in order; where it went comes back as `posted`, refused or not.
    const claim = this.sign({ quilt: 1, type: 'claim', problem: hash, piece: pick.piece.hash, key: id.address, ts: this.stamp(2), body: { by: this.by() } });
    const posted = await this.resolver.post(claim, hash, trackers);
    // 6. The claim in the library.
    this.library.pieces[pick.piece.hash] = { problem: hash, name: pick.piece.name, when: claim.ts, what: 'claimed', verifier: pick.piece.verifier };
    this.save();
    return { hash, pick, posted, owner: nameOf(state, state.envelope.problem.owner), stake, lock };
  }

  /** The core's `next` held to one piece: every other piece excluded, so the pick is that piece's, or null where this key cannot take it. */
  private pickOnly(state: State, piece: Hash, now: string): Pick | null {
    return next(state, this.needKey().address, this.client(), now, { exclude: new Set(state.pieces.filter((v) => v.piece.hash !== piece).map((v) => v.piece.hash)) });
  }

  /**
   * The tracker's assisted next: the piece it names for this key as a pick, the stake it asks of it (QX-15), and the
   * pieces it left out because this key's free standing cannot cover their stake. A tracker that names nothing is only
   * saying its holds are taken, and the map decides; one that does not answer names nothing. One that has taken the
   * problem down (QX-6) takes no claim on it either, so that throws.
   */
  private async askedNext(hash: Hash, state: State, tracker: string): Promise<{ pick: Pick | null; stake: number; unaffordable: Hash[] }> {
    const id = this.needKey();
    type Answer = { piece: Hash | null; state?: string; agree?: string[]; lease_h?: number; stake?: number; unaffordable?: Hash[] };
    let answer: Answer | null = null;
    let takenDown: string | null = null;
    try {
      const r = await fetch(`${tracker}p/${hash}/next?key=${id.address}&can=${this.config.can.join(',')}&model=${encodeURIComponent(this.model())}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) answer = (await r.json()) as Answer;
      else if (r.status === 410) takenDown = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'taken down';
    } catch {
      /* a tracker that does not answer names nothing */
    }
    if (takenDown) throw new Error(`${tracker} has taken this problem down: ${takenDown}`);
    const stake = answer?.stake ?? 0;
    const unaffordable = Array.isArray(answer?.unaffordable) ? answer.unaffordable : [];
    const view = answer?.piece ? state.byHash.get(answer.piece) : undefined;
    if (!answer?.piece || !view) return { pick: null, stake, unaffordable };
    let pick = this.pickOnly(state, answer.piece, this.stamp());
    // A kind the core does not implement (human, judge:n, attest): the tracker's layer offered it, and the piece's own
    // brief, schema and lease are in the envelope this client holds.
    if (!pick && view.state === 'unknown') pick = {
      piece: view.piece, state: (answer.state ?? 'open') as Pick['state'], brief: renderInputs(view, state), ...(view.piece.schema ? { schema: view.piece.schema } : {}),
      agree: answer.agree ?? view.piece.agree ?? view.piece.schema?.required ?? [], requires: view.piece.requires, lease_h: answer.lease_h ?? view.piece.lease_h ?? state.envelope.problem.settings.lease_h, availability: view.availability,
    };
    return { pick, stake, unaffordable };
  }

  /**
   * QX-17: standing is short. Where the tracker honours coin and this key's free coin covers a piece's stake at the
   * burn rate, that piece is picked and the plan says where the coin is locked and how much; null where no piece can
   * be covered that way.
   */
  private async coinInstead(hash: Hash, state: State, tracker: string, unaffordable: Hash[]): Promise<{ pick: Pick; plan: CoinPlan } | null> {
    const coin = await this.coinAt(tracker);
    if (!coin) return null;
    const layer = await this.layerOf(hash, tracker);
    const mine = await this.coinBalance(coin.coinHome);
    if (!layer || !mine) return null;
    const byHash = layerByHash(layer);
    for (const candidate of unaffordable) {
      const asked = byHash.get(candidate)?.stake ?? 0;
      const units = asked * coin.burn_rate;
      if (asked <= 0 || units > mine.free) continue;
      const pick = this.pickOnly(state, candidate, this.stamp());
      if (pick) return { pick, plan: { coinHome: coin.coinHome, units, stake: asked } };
    }
    return null;
  }

  /**
   * The lock before the claim: of standing where the problem asks a stake (QX-15); of coin where the plan says so
   * (QX-17), the coin locked on the home's log first and then the lock at the door naming it. The person's own client
   * asked once for the lock and the claim together. What was locked, or null where nothing was asked.
   */
  private async lockBefore(hash: Hash, piece: Hash, trackers: string[], stake: number, plan: CoinPlan | null): Promise<'standing' | 'coin' | null> {
    const key = this.needKey().address;
    if (plan) {
      const onLog = this.sign({ quilt: 1, type: 'lock', key, ts: this.stamp(), body: { problem: hash, piece, amount: plan.units } });
      const c = await this.resolver.post(onLog, 'coin', [plan.coinHome]);
      // A queued lock is no lock, since the door would refuse the claim: this one is not left to the queue.
      if (c.error || c.queued) throw new Error(`the coin's home did not take the lock of ${plan.units} units${c.error ? `: ${c.error}` : ''}; nothing was claimed`);
      await this.postSigned({ quilt: 1, type: 'lock', problem: hash, piece, key, ts: this.stamp(1), body: { kind: 'coin', amount: plan.stake, id: eventId(onLog) } }, hash, trackers, `coin lock of ${plan.stake}`);
      return 'coin';
    }
    if (stake > 0) {
      await this.postSigned({ quilt: 1, type: 'lock', problem: hash, piece, key, ts: this.stamp(), body: { kind: 'standing', amount: stake } }, hash, trackers, `lock of ${stake}`);
      return 'standing';
    }
    return null;
  }

  /** Something to do when no problem is named: the standing list first (QX-4), then each tracker's offer in its order (QX-5). */
  async offered(): Promise<Handed> {
    const id = this.needKey();
    for (const p of Object.keys(this.library.seeding)) {
      try {
        return await this.next(p);
      } catch {
        /* nothing there for this key right now */
      }
    }
    for (const t of this.config.trackers) {
      const offers = (await askJson<{ offers: { problem: Hash }[] }>(`${t}offer?key=${id.address}&can=${this.config.can.join(',')}&model=${encodeURIComponent(this.model())}`))?.offers ?? [];
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
  async seed(problem: Hash, on: boolean): Promise<Posted> {
    const { event, posted } = await this.postSigned({ quilt: 1, type: 'seed', problem, key: this.needKey().address, ts: this.stamp(), body: { on } }, problem, this.trackersFor(problem), 'seed');
    if (on) this.library.seeding[problem] = event.ts;
    else delete this.library.seeding[problem];
    this.save();
    return posted;
  }

  /**
   * What waits on this key's person across the problems it keeps and the ones it has worked: a judge seat not yet
   * ranked, a challenge seat without its verdict, a dispute on a piece this key returned, and, in a kept problem, a human
   * piece with a seat open that this key has not filled. Nothing is written: the library's dates stay as they were.
   */
  async attention(limit = 20): Promise<{ items: AttentionItem[]; checked: string }> {
    const checked = this.stamp();
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
      const over = layerByHash(tracker ? await this.layerOf(problem, tracker) : null);
      const item = (piece: Hash | null, name: string | null, why: AttentionItem['why']) => items.push({ problem, title, piece, name, why, tracker });
      if (tracker) {
        const [panels, challenges] = await Promise.all([this.panels(problem, tracker), this.challenges(problem, tracker)]);
        for (const p of panels) if (p.outcome === 'open' && p.seats.some((s) => s.root === me && s.lapsed_at === null && !s.rank)) item(p.piece, p.name, 'rank');
        for (const c of challenges) if (c.outcome === 'open' && c.seats.some((s) => s.root === me && s.lapsed_at === null && !s.verdict)) item(c.piece, c.name, 'verdict');
        // QX-16: a piece this key committed gold on, accepted and not yet revealed, as the tracker holds it.
        for (const [piece, g] of Object.entries(this.library.gold?.[problem] ?? {})) {
          const l = over.get(piece as Hash);
          if (l && !l.gold && !g.revealed && ['accepted_provisional', 'accepted', 'challenged'].includes(l.state)) item(piece as Hash, g.name, 'gold');
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

  /** A return handed in: a commit, then its reveal a moment later; and what the piece waits for next, by its kind. */
  async return(problem: Hash, piece: Hash, ret: Record<string, unknown>): Promise<{ commit: Posted; reveal: Posted; waits: string }> {
    const key = this.needKey().address;
    const trackers = this.trackersFor(problem);
    this.gate(ret);
    const nonce = newNonce();
    const { posted: commit } = await this.postSigned({ quilt: 1, type: 'commit', problem, piece, key, ts: this.stamp(), body: { h: commitHash(ret, nonce) } }, problem, trackers, 'commit');
    const { event: reveal, posted: revealed } = await this.postSigned({ quilt: 1, type: 'reveal', problem, piece, key, ts: this.stamp(1), body: { return: ret, nonce, by: this.by() } }, problem, trackers, 'reveal');
    const known = this.library.pieces[piece];
    this.library.pieces[piece] = { problem, name: known?.name ?? piece, when: reveal.ts, what: 'returned', ...(known?.verifier ? { verifier: known.verifier } : {}) };
    this.save();
    return { commit, reveal: revealed, waits: waitsText(known?.verifier) };
  }

  /** A piece given back with one of the core's fixed reasons (DECLINE_REASONS); any other reason is refused here before it is signed. This key is not offered the piece again in this version of the problem. */
  async decline(problem: Hash, piece: Hash, reason: DeclineReason): Promise<Posted> {
    if (!isDeclineReason(reason)) throw new Error(`a decline gives one of ${DECLINE_REASONS.join(', ')}`);
    const { posted } = await this.postSigned({ quilt: 1, type: 'decline', problem, piece, key: this.needKey().address, ts: this.stamp(), body: { reason } }, problem, this.trackersFor(problem), 'decline');
    return posted;
  }

  /** A ranking of a judge piece's candidates by a key drawn to its panel (QX-2): every candidate's digest once, first choice first, signed and posted. */
  async rank(problem: Hash, piece: Hash, ranking: Hash[]): Promise<Posted & { id: Hash }> {
    if (!Array.isArray(ranking) || ranking.length === 0 || !ranking.every((d) => isHash(d))) throw new Error('a ranking is a list of candidate digests, first choice first');
    if (new Set(ranking).size !== ranking.length) throw new Error('a ranking names each digest once');
    const { event, posted } = await this.postSigned({ quilt: 1, type: 'rank', problem, piece, key: this.needKey().address, ts: this.stamp(), body: { ranking } }, problem, this.trackersFor(problem), 'rank');
    return { id: eventId(event), ...posted };
  }

  /** The problem's judge panels as the first tracker that answers computes them: the one that answered for the problem, then the known ones. */
  async panels(problem: Hash, tracker: string | null = null): Promise<PanelListing[]> {
    const found = await this.firstAnswer(this.trackersFor(problem, tracker ? [tracker] : []), async (t) => (await askJson<{ panels: PanelListing[] }>(`${t}p/${problem}/panels`))?.panels ?? null);
    return found ?? [];
  }

  /** A challenge of a piece's provisional acceptance (QX-1), or of a gold miss by a root it struck (QX-16): a stake of this key's standing, 0 allowed against a miss, and one sentence of ground, signed and posted. */
  async challenge(problem: Hash, piece: Hash, stake: number, ground: string): Promise<Posted & { id: Hash }> {
    if (!Number.isInteger(stake) || stake < 0) throw new Error('the stake is a whole number from 0: at least 1 against an acceptance, and nothing need be staked against a gold miss');
    const issues = plainTextProblems(ground, 'ground');
    if (issues.length) throw new Error(issues[0]);
    const { event, posted } = await this.postSigned({ quilt: 1, type: 'challenge', problem, piece, key: this.needKey().address, ts: this.stamp(), body: { stake, ground } }, problem, this.trackersFor(problem), 'challenge');
    return { id: eventId(event), ...posted };
  }

  /** A verdict on a challenge this key was drawn to judge: for the challenger or for the author, with this judge's own return as evidence where it has one. */
  async verdict(problem: Hash, piece: Hash, challenge: Hash, side: Side, ret?: Record<string, unknown>): Promise<Posted & { id: Hash }> {
    if (!SIDES.includes(side)) throw new Error(`a verdict is for the ${SIDES.join(' or the ')}`);
    if (ret) this.gate(ret);
    const { event, posted } = await this.postSigned({ quilt: 1, type: 'verdict', problem, piece, key: this.needKey().address, ts: this.stamp(), body: { challenge, for: side, ...(ret ? { return: ret } : {}) } }, problem, this.trackersFor(problem), 'verdict');
    return { id: eventId(event), ...posted };
  }

  /** The problem's challenges as the first tracker that answers computes them: the one that answered for the problem, then the known ones. */
  async challenges(problem: Hash, tracker: string | null = null): Promise<ChallengeListing[]> {
    const found = await this.firstAnswer(this.trackersFor(problem, tracker ? [tracker] : []), async (t) => (await askJson<{ challenges: ChallengeListing[] }>(`${t}p/${problem}/challenges`))?.challenges ?? null);
    return found ?? [];
  }

  /** A maintainer's takedown (QX-6): a hide event on the identity log of this client's trackers; lifted with `on` false. */
  async hide(id: string, why: string, on = true): Promise<Posted> {
    const issues = plainTextProblems(why, 'why');
    if (issues.length) throw new Error(issues[0]);
    const { posted } = await this.postSigned({ quilt: 1, type: 'hide', key: this.needKey().address, ts: this.stamp(), body: { id, why, on } }, null, this.config.trackers, 'hide');
    return posted;
  }

  /** The stake a problem asks of a claim on its pieces (QX-15): a stake_rule event from the owner on the problem's log, replacing the one before. */
  async stakeRule(problem: Hash, min: number, pieces?: string[]): Promise<Posted> {
    if (!Number.isInteger(min) || min < 0) throw new Error('the stake is a whole number from 0');
    const { posted } = await this.postSigned({ quilt: 1, type: 'stake_rule', problem, key: this.needKey().address, ts: this.stamp(), body: { min, ...(pieces && pieces.length ? { pieces } : {}) } }, problem, this.trackersFor(problem), 'stake rule');
    return posted;
  }

  /** A name event for this key on the identity log of this client's trackers. */
  async setName(name: string): Promise<Posted> {
    const issues = plainTextProblems(name, 'name');
    if (issues.length) throw new Error(issues[0]);
    const { posted } = await this.postSigned({ quilt: 1, type: 'name', key: this.needKey().address, ts: this.stamp(), body: { name } }, null, this.config.trackers, 'name');
    return posted;
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
        // A whole envelope with its blobs: fifteen seconds, where a read gets eight (askJson).
        const r = await fetch(`${t}p`, { method: 'POST', body, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (r.status === 201) posted.push(t);
        else refused.push(`${t}: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`);
      } catch (err) {
        refused.push(`${t}: ${(err as Error).message}`);
      }
    }
    if (posted.length) {
      // The announce and the version are posted where the envelope went, and a refusal of either is not the publish's to report.
      const announce = this.sign({ quilt: 1, type: 'announce', problem: hash, key: id.address, ts: this.stamp(), body: { title: problem.title, slug: problem.slug, done_when: problem.done_when, topics: pattern.topics ?? [], counts: {}, trackers: posted, mirrors: this.config.mirrors } });
      await this.resolver.post(announce, hash, posted);
      if (this.config.relays.length) relays = (await postToRelays(this.config.relays, announcementEvent(announce, id.secret))).posted;
      const version = this.sign({ quilt: 1, type: 'version', problem: hash, key: id.address, ts: this.stamp(), body: { slug: problem.slug, hash } });
      await this.resolver.post(version, hash, posted);
      if (pattern.stake) {
        // QX-15: the stake the owner asks, on the problem's log right after the envelope; a refusal is listed rather than thrown, since the problem is out.
        const rule = this.sign({ quilt: 1, type: 'stake_rule', problem: hash, key: id.address, ts: this.stamp(), body: { min: pattern.stake.min, ...(pattern.stake.pieces?.length ? { pieces: pattern.stake.pieces } : {}) } });
        const r = await this.resolver.post(rule, hash, posted);
        if (r.error && !r.queued) refused.push(`stake rule: ${r.error}`);
      }
      if (pattern.gold) {
        try {
          gold = await this.commitGold(hash, pattern.gold.answers, pattern.gold.stake, expandPieces(problem, blobs), posted, pattern.stake);
        } catch (err) {
          refused.push(`gold: ${(err as Error).message}`);
        }
      }
    }
    const now = this.stamp();
    this.library.problems[hash] = { title: problem.title, slug: problem.slug, trackers: posted, first: now, last: now };
    this.save();
    return { hash, link: makeLink(hash, posted, problem.slug), posted, refused, relays, gold };
  }

  // What was read, said as text: the work is in render.ts, and these hand it the config's trackers where it needs them.

  /** A problem said whole, as quilt_open answers it (render.ts, `summary`). */
  summary(hash: Hash, state: State, tracker: string | null, layer: LayerPiece[] | null = null, hidden: Takedown | null = null, gold: GoldCount | null = null): string {
    return summary({ hash, state, tracker, layer, hidden, gold }, this.config.trackers);
  }

  /** The piece said as text, as quilt_next answers it (render.ts, `pieceText`). */
  pieceText(hash: Hash, pick: Pick, owner: string, stake = 0): string {
    return pieceText(hash, pick, owner, stake);
  }

  /** The accepted returns as quoted text with the signers named (render.ts, `acceptedText`). */
  acceptedText(state: State, layer: LayerPiece[] | null = null): string {
    return acceptedText(state, layer);
  }

  /** The challenges said as text (render.ts, `challengesText`). */
  challengesText(list: ChallengeListing[], state: State): string {
    return challengesText(list, state);
  }

  /** The panels said as text (render.ts, `panelsText`). */
  panelsText(list: PanelListing[], state: State): string {
    return panelsText(list, state);
  }

  // The coin (QX-17): where it lives, what this key holds of it, and the three events that move it.

  /** Where a tracker's coin lives, as its well-known says under stake: the coin's home, the tracker that keeps the coin log, and the burn rate a point of standing costs there; null where it honours none. */
  async coinAt(tracker: string): Promise<{ coinHome: string; burn_rate: number } | null> {
    const t = tracker.endsWith('/') ? tracker : `${tracker}/`;
    const wk = await this.wellKnown(t);
    const stake = wk?.stake as { coin?: string | null; burn_rate?: number } | undefined;
    if (!stake?.coin || typeof stake.burn_rate !== 'number') return null;
    const coinHome = stake.coin === 'here' ? t : stake.coin.endsWith('/') ? stake.coin : `${stake.coin}/`;
    return { coinHome, burn_rate: stake.burn_rate };
  }

  /** The coin's home among this client's trackers: the first that carries the coin, or null. */
  async coinHome(): Promise<string | null> {
    return this.firstAnswer(this.config.trackers, async (t) => (await this.coinAt(t))?.coinHome ?? null);
  }

  /** This key's coin at a home: balance, vested, locked, escrowed, free; null with no key or no answer. */
  async coinBalance(coinHome: string): Promise<CoinBalance | null> {
    const address = this.identity?.address;
    if (!address) return null;
    const j = await askJson<Omit<CoinBalance, 'home'>>(`${coinHome}coin/balance/${address}`);
    return j && { home: coinHome, balance: j.balance, vested: j.vested, unvested: j.unvested, locked: j.locked, escrowed: j.escrowed, free: j.free, free_vested: j.free_vested };
  }

  /** This key's coin at the first of this client's trackers that carries one, or null. */
  async coin(): Promise<CoinBalance | null> {
    const coinHome = await this.coinHome();
    return coinHome ? this.coinBalance(coinHome) : null;
  }

  /** A pay to a problem: coin escrowed on the coin log of the problem's home, paid per square to the roots of each set accepted after it, the rest back to this key when the problem completes. */
  async pay(problem: Hash, amount: number, perSquare: number): Promise<Posted & { id: Hash; home: string }> {
    if (!Number.isInteger(amount) || amount < 1 || !Number.isInteger(perSquare) || perSquare < 1) throw new Error('a pay is a whole amount and a whole price per square, each at least 1');
    const coinHome = await this.firstAnswer(this.trackersFor(problem), async (t) => (await this.coinAt(t))?.coinHome ?? null);
    if (!coinHome) throw new Error('no tracker this client knows for that problem carries the coin');
    const { event, posted } = await this.postSigned({ quilt: 1, type: 'pay', key: this.needKey().address, ts: this.stamp(), body: { problem, amount, per_square: perSquare } }, 'coin', [coinHome], 'pay');
    return { id: eventId(event), ...posted, home: coinHome };
  }

  /**
   * A transfer of this key's coin to an address: vested free coin moved on the coin log of the coin's home, from the
   * time the home's parameters name. The recipient need not be a key anywhere yet.
   */
  async transfer(to: Address, amount: number): Promise<Posted & { id: Hash; home: string }> {
    if (!isAddress(to)) throw new Error('the recipient is an address with its checksum');
    if (!Number.isInteger(amount) || amount < 1) throw new Error('a transfer is a whole number of units, at least 1');
    const coinHome = await this.coinHome();
    if (!coinHome) throw new Error('no tracker this client knows carries the coin');
    const { event, posted } = await this.postSigned({ quilt: 1, type: 'transfer', key: this.needKey().address, ts: this.stamp(), body: { to, amount } }, 'coin', [coinHome], 'transfer');
    return { id: eventId(event), ...posted, home: coinHome };
  }

  /**
   * A redeem of this key's coin (the door out): vested free coin taken off the ledger as a signed line on the coin log,
   * to be minted on the chain to this key's address or the one named once the bridge's poster carries the line under a
   * posted head. Final on the ledger from its receipt.
   */
  async redeem(amount: number, to?: Address): Promise<Posted & { id: Hash; home: string }> {
    if (to !== undefined && !isAddress(to)) throw new Error('the recipient is an address with its checksum');
    if (!Number.isInteger(amount) || amount < 1) throw new Error('a redeem is a whole number of units, at least 1');
    const coinHome = await this.coinHome();
    if (!coinHome) throw new Error('no tracker this client knows carries the coin');
    const { event, posted } = await this.postSigned({ quilt: 1, type: 'redeem', key: this.needKey().address, ts: this.stamp(), body: { amount, ...(to ? { to } : {}) } }, 'coin', [coinHome], 'redeem');
    return { id: eventId(event), ...posted, home: coinHome };
  }

  // The owner's gold (QX-16): answers committed blind before the work, and revealed piece by piece once accepted.

  /**
   * The owner's gold on a problem, posted after publishing or at it: each answer projected to the piece's agreed
   * fields and committed by hash together with the piece, under its own nonce, so the ledger shows how many answers are
   * committed and not which pieces; the projections and nonces stay in the library. The stake, left out, is the largest
   * share among the pieces a gold can be on, for each commitment: for each root a miss would dock, two for a piece whose
   * set is two reveals, the stake the rule asks of the piece, or one. A piece already worked takes no gold, since the
   * reveal on it would be refused.
   */
  async commitGold(problem: Hash, answers: Record<string, Record<string, unknown>>, stakeAsked?: number, pieces?: Piece[], trackers?: string[], rule?: { min: number; pieces?: string[] }): Promise<{ pieces: number; stake: number }> {
    let all = pieces;
    let where = trackers;
    const worked = new Set<Hash>();
    if (!all || !where) {
      const opened = await this.open(problem);
      all ??= opened.state.pieces.map((v) => v.piece);
      where ??= this.trackersFor(problem);
      for (const v of opened.state.pieces) if (v.claims.length || v.commits.length || v.reveals.length || v.runs.length) worked.add(v.piece.hash);
      if (!rule && opened.layer) {
        // The rule in force, as the tracker shows it per piece: the share of each committed piece follows it.
        const stakes = new Map(opened.layer.map((l) => [l.hash, l.stake ?? 0] as const));
        rule = { min: 0, pieces: [] };
        for (const p of all) if ((stakes.get(p.hash) ?? 0) > 0) rule = { min: Math.max(rule.min, stakes.get(p.hash)!), pieces: [...(rule.pieces ?? []), p.name] };
      }
    }
    const golden = (x: Piece) => x.schema !== undefined && x.verifier !== 'check' && x.verifier !== 'score';
    const covered = (x: Piece) => rule !== undefined && rule.min > 0 && (!rule.pieces?.length || rule.pieces.includes(x.family) || rule.pieces.includes(x.name));
    // Each blind commitment costs the largest share among the pieces a gold can be on, since the ledger cannot tell which piece it names.
    const share = Math.max(0, ...all.filter(golden).map((x) => (x.verifier === 'attest' ? 1 : 2) * Math.max(1, covered(x) ? rule!.min : 0)));
    const commitments: Hash[] = [];
    const kept: Record<string, { name: string; projection: Record<string, unknown>; nonce: string }> = {};
    for (const [name, answer] of Object.entries(answers)) {
      const piece = all.find((x) => x.name === name);
      if (!piece) throw new Error(`no piece named ${name}`);
      if (!golden(piece)) throw new Error(`${name} has no agreed fields to commit to`);
      if (worked.has(piece.hash)) throw new Error(`${name} is already worked, and a reveal on it would be refused`);
      const fields = agreeFields(piece.schema!, piece.agree);
      const projection: Record<string, unknown> = {};
      for (const f of fields) {
        if (!(f in answer)) throw new Error(`the answer for ${name} lacks ${f}`);
        projection[f] = answer[f];
      }
      const nonce = newNonce();
      commitments.push(commitHash({ piece: piece.hash, projection }, nonce));
      kept[piece.hash] = { name, projection, nonce };
    }
    if (commitments.length === 0) throw new Error('no answers to commit');
    // In hash order, so the order of the list says nothing about which piece is which.
    commitments.sort();
    const stake = stakeAsked ?? share * commitments.length;
    const r = await this.resolver.post(this.sign({ quilt: 1, type: 'gold', problem, key: this.needKey().address, ts: this.stamp(), body: { commitments, stake } }), problem, where);
    // The tracker's reason alone, since `publish` lists it under "gold:" and `quilt gold commit` prints it as it is.
    if (r.error && !r.queued) throw new Error(r.error);
    this.library.gold ??= {};
    this.library.gold[problem] = { ...(this.library.gold[problem] ?? {}), ...kept };
    this.save();
    return { pieces: Object.keys(kept).length, stake };
  }

  /**
   * The owner's reveal of the gold on a piece, from the projection and nonce kept at publishing: posted to the
   * problem's trackers, and the tracker that took it says what it decided, a match or a miss.
   */
  async revealGold(problem: Hash, piece: Hash): Promise<Posted & { id: Hash; name: string; outcome: string | null }> {
    const kept = this.library.gold?.[problem]?.[piece];
    if (!kept) throw new Error('no gold kept here for that piece: the projection and nonce are the owner\'s, in the library of the home that published');
    const { event, posted } = await this.postSigned({ quilt: 1, type: 'gold_reveal', problem, piece, key: this.needKey().address, ts: this.stamp(), body: { projection: kept.projection, nonce: kept.nonce } }, problem, this.trackersFor(problem), 'reveal');
    kept.revealed = event.ts;
    this.save();
    const layer = posted.at ? await this.layerOf(problem, posted.at) : null;
    const outcome = layer?.find((l) => l.hash === piece)?.gold ?? null;
    return { id: eventId(event), ...posted, name: kept.name, outcome };
  }
}
