/**
 * Quilt: the one thing that signs with the home's key, reads the trackers, and says what it read as text for a model.
 * The MCP server (mcp.ts, tools.ts) and the page (page.ts) are thin shells over it; the text itself is made in
 * render.ts from what is read here. Other people's words come out only as quoted text with the signer named.
 */
import {
  type Address,
  type Capability,
  type Client,
  type DeclineReason,
  type Envelope,
  type Event,
  type Hash,
  type Pick,
  type Piece,
  type Problem,
  type State,
  type Unsigned,
  DECLINE_REASONS,
  commitHash,
  eventId,
  expandPieces,
  isHash,
  newNonce,
  next,
  plainTextProblems,
  problemHash,
  renderInputs,
  signEvent,
  signObject,
  textIssues,
} from '@bitquilt/core';
import * as coin from './coin.js';
import type { CoinBalance } from './coin.js';
import { type Config, type Identity, createKey, loadKey } from './config.js';
import { draftEnvelope, patternProblems, patternProblemsText } from './pattern.js';
import type { Door } from './door.js';
import * as gold from './gold.js';
import { type Link, makeLink, parseLink } from './link.js';
import { type RestAsked, type TraceOutcome, traceAfterReveal } from './trace.js';
import {
  type ChallengeListing,
  type GoldCount,
  type LayerPiece,
  type Opened,
  type PanelListing,
  type Scrape,
  SIDES,
  type Seam,
  type SeamSide,
  type Side,
  type Takedown,
  type Witness,
} from './listings.js';
import { type AnnouncedWork, NO_WORK, announcementEvent, postToRelays, searchRelays } from './relay.js';
import { type Library, type Posted, type Resolver, askJson } from './resolver.js';
import { inParallel } from './pool.js';
import {
  type SentenceAsk,
  acceptedText,
  challengesText,
  disputedText,
  kindWords,
  layerByHash,
  nameOf,
  panelsText,
  pieceText,
  summary,
  waitsText,
  witnessesOf,
} from './render.js';

export type { CoinBalance } from './coin.js';
export type { Door } from './door.js';
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
  /**
   * rank: drawn to a judge panel and not yet ranked; verdict: drawn to a challenge and not yet answered; disputed: a
   * piece this key returned is disputed; person: a human piece in a kept problem has a seat open; gold: a piece this
   * key committed gold on is accepted and awaits the reveal.
   */
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
/**
 * What `publish` and the owner's sharpening answer: where the envelope went, what refused it, and the gold committed.
 */
export interface Published {
  hash: Hash;
  link: string;
  posted: string[];
  refused: string[];
  relays: string[];
  gold: { pieces: number; stake: number } | null;
}

/**
 * A problem as a search finds it (APP.md, Search): a tracker's row with the work on it, or a relay's announce (QX-13),
 * and every place that had it.
 */
export interface SearchResult {
  problem: Hash;
  title: string;
  slug: string;
  owner: string;
  owner_name: string | null;
  /**
   * The problem this one forks (CORE.md section 2), and the root of its group in this answer: itself where it forks
   * nothing in the answer.
   */
  from: Hash | null;
  root: Hash;
  pieces: number;
  counts: Record<string, number>;
  kinds: Record<string, number> | null;
  work: AnnouncedWork | null;
  topics: string[];
  /** Where to open it: the tracker that had it, or the first the announce named, or the relay. */
  tracker: string;
  via: 'tracker' | 'relay';
  held: string[];
  /** For a row from a relay alone: who announced it and when, since its numbers are a snapshot. */
  announcer: string | null;
  announced: string | null;
}

/**
 * QX-19 section 4: a brief sharpened, or not: the sentence asked for each family with a seam, whether it was kept and
 * why not, and the version published with those kept.
 */
export interface Sharpened {
  problem: Hash;
  sentences: { family: string; field: string; sentence: string | null; kept: boolean; why: string | null }[];
  hash: Hash | null;
  posted: string[];
  refused: string[];
}

/** The most a sentence added to a brief may run (QX-19 section 4). */
export const SENTENCE_MAX = 400;
const NOT_OWNER = 'only the owner sharpens a brief';
const FROZEN = "that problem's brief is frozen in this home; `quilt freeze <problem> off` thaws it";

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
  /**
   * The stake of standing a claim on the pieces is backed by (QX-15): `min` on every piece, or on the families and
   * pieces named.
   */
  stake?: { min: number; pieces?: string[] };
  /**
   * The owner's gold (QX-16): the answers to some pieces by name, committed by hash before the work; the stake, left
   * out, is the sum of the pieces' shares (two a piece where no stake rule applies).
   */
  gold?: { answers: Record<string, Record<string, unknown>>; stake?: number };
}

/**
 * This key's standing as a tracker computes it (QX-1, QX-15): what it has, what is locked behind its claims, what is
 * free to stake.
 */
export interface Standing {
  tracker: string;
  standing: number;
  locked: number;
  free: number;
  /**
   * The part of `standing` the tracker declared for this root at its founding (QX-1 section 2 as amended); 0 for nearly
   * everyone.
   */
  founding: number;
  locks: { problem: Hash; piece: Hash; amount: number; at: string }[];
}

/**
 * A piece handed to this key by `next`: the pick, where the claim went, the owner by name, and what was locked before
 * the claim.
 */
export interface Handed {
  hash: Hash;
  pick: Pick;
  posted: Posted;
  owner: string;
  stake: number;
  lock: 'standing' | 'coin' | null;
  /**
   * QX-19: where the two readings of a disputed piece differ and what each rests on, as the tracker handed them over;
   * empty otherwise.
   */
  seams: Seam[];
}

/**
 * A plan to lock coin in place of standing (QX-17): where the coin log is, how many units at the burn rate, and the
 * stake they stand for.
 */
interface CoinPlan {
  coinHome: string;
  units: number;
  stake: number;
}

/** Whether a string is one of the core's fixed decline reasons. */
function isDeclineReason(s: string): s is DeclineReason {
  return (DECLINE_REASONS as readonly string[]).includes(s);
}

/**
 * A Quilt holds the home's key, its config and a resolver, and keeps three things true. It signs with the home's one
 * key and nothing else: every event leaves through `sign`. A post goes to the trackers the library remembers for the
 * problem, then the config's (`trackersFor`), and waits in the resolver's queue when none takes it. The library records
 * what this key opened, claimed, returned, seeded and committed, and is saved after each. The coin (coin.ts) and the
 * gold (gold.ts) do their work through the door it hands them, built here from its private methods.
 */
export class Quilt {
  readonly hostName: string | undefined;
  /**
   * A tracker's well-known document, kept for ten minutes: long enough to spare the tracker, short enough that one
   * restarted with the coin is seen.
   */
  private readonly wellKnownCache = new Map<string, { at: number; answer: Promise<Record<string, unknown> | null> }>();
  /**
   * What coin.ts and gold.ts are handed (door.ts): the key, the config, the library, and this Quilt's own signing,
   * posting and reading.
   */
  private readonly door: Door;

  private held: Identity | null;

  /**
   * `witness` is set by the hosted on-ramp alone (QX-18): the product whose OAuth callback this session's token came
   * through, which the tracker writes beside custody on each event this Quilt posts. Null for a home of one's own.
   */
  constructor(
    readonly config: Config,
    identity: Identity | null,
    readonly resolver: Resolver,
    hostName?: string,
    readonly witness: Witness | null = null,
  ) {
    this.held = identity;
    this.hostName = hostName;
    const q = this;
    this.door = {
      config,
      get identity() {
        return q.identity;
      },
      get library() {
        return q.library;
      },
      needKey: () => q.needKey(),
      stamp: (after) => q.stamp(after),
      sign: (unsigned) => q.sign(unsigned),
      post: (event, log, trackers) => q.resolver.post(event, log, trackers),
      postSigned: (unsigned, log, trackers, what) => q.postSigned(unsigned, log, trackers, what),
      trackersFor: (problem, first) => q.trackersFor(problem, first),
      ask: (url) => q.ask(url),
      firstAnswer: (trackers, ask) => q.firstAnswer(trackers, ask),
      wellKnown: (tracker) => q.wellKnown(tracker),
      layerOf: (hash, tracker) => q.layerOf(hash, tracker),
      open: (input) => q.open(input),
      save: () => q.save(),
    };
  }

  /** The person at the page hands in as a person: the same key and resolver, model `human`, capability `person`. */
  static asPerson(config: Config, identity: Identity | null, resolver: Resolver): Quilt {
    return new Quilt({ ...config, model: 'human', can: ['person', 'web', 'files'] }, identity, resolver, 'human');
  }

  /** The home's library, held by the resolver: every Quilt over one resolver reads and writes the same one. */
  get library(): Library {
    return this.resolver.library;
  }

  /**
   * The model this client declares on its claims and reveals: the config's where it names one, else the host's vendor
   * and name.
   */
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

  /**
   * The key this Quilt signs with: the one given, else the one at the home, read when first asked for, so a key made by
   * another Quilt over the same home (the connector's, the page's) is seen by this one.
   */
  get identity(): Identity | null {
    if (this.held === null) this.held = loadKey(this.resolver.home);
    return this.held;
  }

  /**
   * The key, made at first use where the home has none: nobody sits at a terminal when a bundle is first asked to sign,
   * so the key is made then and its twelve words kept for the page to show once (`Resolver.takeWords`); `quilt_me` says
   * so until they are seen.
   */
  private needKey(): Identity {
    if (!this.identity) this.held = createKey(this.resolver.home, { keepWords: true }).identity;
    return this.identity!;
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
  private async postSigned(
    unsigned: Unsigned,
    log: Hash | null | 'coin',
    trackers: string[],
    what: string,
  ): Promise<{ event: Event; posted: Posted }> {
    const event = this.sign(unsigned);
    const posted = await this.resolver.post(event, log, trackers);
    if (posted.error && !posted.queued)
      throw new Error(`${log === 'coin' ? "the coin's home" : 'the tracker'} refused the ${what}: ${posted.error}`);
    return { event, posted };
  }

  /**
   * Where posts about a problem go, each once: the trackers named `first` (the one that answered, a link's), then the
   * ones the library remembers for it, then the config's.
   */
  /** A tracker's JSON through this Quilt's own way to the network, or null. */
  ask<T>(url: string): Promise<T | null> {
    return askJson<T>(url, 8000, this.resolver.fetchImpl);
  }

  private trackersFor(problem: Hash, first: string[] = []): string[] {
    return [...new Set([...first, ...(this.library.problems[problem]?.trackers ?? []), ...this.config.trackers])];
  }

  /**
   * The first tracker that answers: `ask` is put to each in order, and the first answer that is not null is it; null
   * when none answers.
   */
  private async firstAnswer<T>(trackers: string[], ask: (tracker: string) => Promise<T | null>): Promise<T | null> {
    for (const t of trackers) {
      const answer = await ask(t);
      if (answer !== null) return answer;
    }
    return null;
  }

  /** Every string in a return through the plain-text gate; the first problem found is thrown. */
  private gate(ret: Record<string, unknown>): void {
    for (const s of Object.values(ret))
      if (typeof s === 'string') {
        const issues = plainTextProblems(s, 'return');
        if (issues.length) throw new Error(issues[0]);
      }
  }

  /**
   * This client as it knows itself, from memory and the library alone: the address, name, model, capabilities,
   * trackers, mirrors, relays, what waits in the queue, and how many problems the library holds.
   */
  me() {
    return {
      address: this.identity?.address ?? null,
      name: this.config.name ?? null,
      model: this.model(),
      can: this.config.can,
      trackers: this.config.trackers,
      mirrors: this.config.mirrors,
      relays: this.config.relays,
      queued: this.resolver.queued(),
      problems: Object.keys(this.library.problems).length,
      wordsDue: this.resolver.wordsDue(),
      witness: this.witness,
    };
  }

  /** This key's standing as the first tracker that answers computes it; null with no key or no tracker. */
  async standing(): Promise<Standing | null> {
    const address = this.identity?.address;
    return address ? this.standingOf(address) : null;
  }

  /** Any key's standing as the first tracker that answers computes it (QX-1); null where no tracker answers. */
  async standingOf(address: Address): Promise<Standing | null> {
    return this.firstAnswer(this.config.trackers, async (t) => {
      const j = await this.ask<Omit<Standing, 'tracker'>>(`${t}k/${address}/standing`);
      return (
        j && {
          tracker: t,
          standing: j.standing,
          locked: j.locked,
          free: j.free,
          founding: j.founding ?? 0,
          locks: j.locks,
        }
      );
    });
  }

  /**
   * The hot list (APP.md, "The window"): a key followed or dropped, in this home's library alone; nothing is signed or
   * posted.
   */
  async follow(address: Address, on: boolean, name: string | null = null): Promise<void> {
    const follows = (this.library.follows ??= {});
    if (on)
      follows[address] = {
        name: name ?? follows[address]?.name ?? null,
        since: follows[address]?.since ?? this.stamp(),
      };
    else delete follows[address];
    this.save();
  }

  /**
   * A tracker's well-known document, asked again after ten minutes or when the last answer was nothing; null when it
   * does not answer.
   */
  wellKnown(tracker: string): Promise<Record<string, unknown> | null> {
    const t = tracker.endsWith('/') ? tracker : `${tracker}/`;
    const kept = this.wellKnownCache.get(t);
    if (kept && Date.now() - kept.at < 10 * 60_000) return kept.answer;
    const answer = this.ask<Record<string, unknown>>(`${t}.well-known/quilt`);
    this.wellKnownCache.set(t, { at: Date.now(), answer });
    // A tracker that did not answer is asked again next time.
    answer.then(
      (a) => {
        if (a === null) this.wellKnownCache.delete(t);
      },
      () => this.wellKnownCache.delete(t),
    );
    return answer;
  }

  /**
   * The tracker's state for a problem: its pieces as the layer sees them, and the owner's gold summed (QX-16). Null
   * when the tracker does not answer.
   */
  async trackerState(
    hash: Hash,
    tracker: string,
  ): Promise<{ pieces: LayerPiece[]; gold: GoldCount | null; superseded: Hash | null } | null> {
    const j = await this.ask<{ pieces?: LayerPiece[]; gold?: GoldCount; superseded?: Hash | null }>(
      `${tracker}p/${hash}/state`,
    );
    return j && Array.isArray(j.pieces)
      ? { pieces: j.pieces, gold: j.gold ?? null, superseded: isHash(j.superseded) ? j.superseded : null }
      : null;
  }

  /**
   * The tracker's own states for a problem's pieces, with each kind and its strength: where its layer (the challenge
   * window, the verifier kinds) says more than the core this client computes. Null when the tracker does not answer.
   */
  async layerOf(hash: Hash, tracker: string): Promise<LayerPiece[] | null> {
    return (await this.trackerState(hash, tracker))?.pieces ?? null;
  }

  /**
   * The tracker's scrape of a problem: whether it has taken it down (QX-6) and why, in its own word, and who keeps it
   * (QX-4). Null when the tracker does not answer.
   */
  async scrapeOf(hash: Hash, tracker: string): Promise<Scrape | null> {
    const j = await this.ask<{ hidden?: Takedown | null; seeders?: number; last_seeded?: string | null }>(
      `${tracker}p/${hash}/scrape`,
    );
    return j && { hidden: j.hidden ?? null, seeders: j.seeders ?? 0, last_seeded: j.last_seeded ?? null };
  }

  /**
   * The problem behind a link or hash, resolved and reduced, with the tracker's own view of its pieces and its scrape
   * where one answered, and the witness on each reveal its receipts name (QX-18); the library remembers it and where it
   * was found.
   */
  async open(input: string): Promise<
    Opened & {
      link: Link;
      layer: LayerPiece[] | null;
      hidden: Takedown | null;
      gold: GoldCount | null;
      scrape: Scrape | null;
      witnessed: Map<string, Witness>;
      superseded: Hash | null;
    }
  > {
    const link = parseLink(input);
    const resolved = await this.resolver.resolve(link);
    if (!resolved) throw new Error('no resolver answered for that hash');
    const state = this.resolver.state(resolved);
    const now = this.stamp();
    const trackers = this.trackersFor(resolved.hash, [
      ...(resolved.tracker ? [resolved.tracker] : []),
      ...link.trackers,
    ]);
    const entry = this.library.problems[resolved.hash];
    // The rest of the entry stays: the version it was replaced by, its topics, and the mark of the last announce (QX-13
    // section 3).
    this.library.problems[resolved.hash] = {
      ...entry,
      title: state.envelope.problem.title,
      slug: state.envelope.problem.slug,
      trackers,
      first: entry?.first ?? now,
      last: now,
    };
    this.save();
    const st = resolved.tracker ? await this.trackerState(resolved.hash, resolved.tracker) : null;
    const scrape = resolved.tracker ? await this.scrapeOf(resolved.hash, resolved.tracker) : null;
    return {
      link,
      hash: resolved.hash,
      state,
      tracker: resolved.tracker,
      layer: st?.pieces ?? null,
      hidden: scrape?.hidden ?? null,
      gold: st?.gold ?? null,
      scrape,
      witnessed: witnessesOf(resolved.receipts),
      superseded: st?.superseded ?? null,
    };
  }

  /**
   * Problems whose title, slug, topics or statement of done carry the words, from every tracker this client knows,
   * asked together, and from the relays (QX-14), each problem once: a tracker's row where one has it, with the work on
   * it (APP.md, Search), else a relay's announce with the work the announce stated (QX-13); `held` names every place
   * that had it. A fork (CORE.md section 2, `from`) sits under the problem it forks when that is in the answer, the
   * problem first and its forks by the work on each; the groups come in the order of their latest reading.
   */
  async search(query: string): Promise<SearchResult[]> {
    type Row = {
      problem: Hash;
      title: string;
      slug: string;
      owner: string;
      owner_name?: string | null;
      from?: Hash | null;
      pieces: number;
      counts: Record<string, number>;
      kinds?: Record<string, number>;
      work?: AnnouncedWork | null;
      topics: string[];
    };
    const out = new Map<string, SearchResult>();
    const answers = await inParallel(this.config.trackers, 4, (t) =>
      this.ask<{ problems: Row[] }>(`${t}search?q=${encodeURIComponent(query)}`),
    );
    this.config.trackers.forEach((t, i) => {
      for (const p of answers[i]?.problems ?? []) {
        const have = out.get(p.problem);
        if (have) {
          have.held.push(t);
          continue;
        }
        out.set(p.problem, {
          problem: p.problem,
          title: p.title,
          slug: p.slug,
          owner: p.owner,
          owner_name: p.owner_name ?? null,
          from: p.from ?? null,
          root: p.problem,
          pieces: p.pieces,
          counts: p.counts,
          kinds: p.kinds ?? null,
          work: p.work ?? null,
          topics: p.topics,
          tracker: t,
          via: 'tracker',
          held: [t],
          announcer: null,
          announced: null,
        });
      }
    });
    // QX-14: what the relays carry, with the tracker the announce named as the place to open it, and the work as the
    // announce stated it.
    for (const a of await searchRelays(this.config.relays, query)) {
      const have = out.get(a.problem);
      if (have) {
        have.held.push(a.relay);
        continue;
      }
      const pieces = a.pieces ?? Object.values(a.counts).reduce((n, c) => n + c, 0);
      out.set(a.problem, {
        problem: a.problem,
        title: a.title,
        slug: a.slug,
        owner: a.owner,
        owner_name: null,
        from: a.from,
        root: a.problem,
        pieces,
        counts: a.counts,
        kinds: null,
        work: a.work,
        topics: a.topics,
        tracker: a.trackers[0] ?? a.relay,
        via: 'relay',
        held: [a.relay],
        announcer: a.announcer,
        announced: new Date(a.created_at * 1000).toISOString(),
      });
    }
    // The root of each: `from` followed while the problem it names is in the answer.
    for (const f of out.values()) {
      let root = f;
      for (let i = 0; i < 8 && root.from && out.has(root.from); i += 1) root = out.get(root.from)!;
      f.root = root.problem;
    }
    const weight = (f: SearchResult): number =>
      f.work ? f.work.verified * 1_000_000 + f.work.accepted * 1_000 + f.work.returned : 0;
    const latest = new Map<Hash, string>();
    for (const f of out.values()) {
      const l = f.work?.last ?? '';
      if (l > (latest.get(f.root) ?? '')) latest.set(f.root, l);
    }
    return [...out.values()].sort((a, b) => {
      if (a.root !== b.root)
        return (latest.get(b.root) ?? '').localeCompare(latest.get(a.root) ?? '') || a.root.localeCompare(b.root);
      if ((a.problem === a.root) !== (b.problem === b.root)) return a.problem === a.root ? -1 : 1;
      return weight(b) - weight(a) || a.problem.localeCompare(b.problem);
    });
  }

  /**
   * The tracker's row for a problem, as `/p/<hash>/scrape` gives it, with its topics: what the owner's turn announces
   * again. Null when the tracker does not answer.
   */
  private rowOf(
    hash: Hash,
    tracker: string,
  ): Promise<{
    title: string;
    slug: string;
    done_when: string;
    owner: string;
    from: Hash | null;
    pieces: number;
    counts: Record<string, number>;
    work: AnnouncedWork;
    topics?: string[];
  } | null> {
    return this.ask(`${tracker}p/${hash}/scrape`);
  }

  /**
   * QX-13 section 3: the owner's turn announces a problem again where the work on it has moved since the last announce
   * this home recorded, with the tracker's row of the moment, the same topics and the same signer, to the problem's
   * trackers and this home's relays, and where a relay this home is configured with has not been offered the announce
   * yet, so a relay added later gets every owned problem at the next turn, once; one that is down then gets the next
   * announce the work earns. A problem this key does not own, or has replaced, is passed over. The hashes announced.
   */
  async announceDue(): Promise<Hash[]> {
    const id = this.identity;
    if (!id) return [];
    const out: Hash[] = [];
    for (const [h, entry] of Object.entries(this.library.problems)) {
      if (!isHash(h) || entry.next) continue;
      const trackers = entry.trackers.length ? entry.trackers : this.config.trackers;
      const offered = entry.announced?.relays ?? [];
      const unoffered = this.config.relays.filter((r) => !offered.includes(r));
      const row = await this.firstAnswer(trackers, (t) => this.rowOf(h, t));
      if (!row || !row.work || row.owner.toLowerCase() !== id.address.toLowerCase()) continue;
      const mark = [row.work.returned, row.work.accepted, row.work.verified, row.work.disputed, row.work.readers].join(
        '/',
      );
      if (entry.announced?.mark === mark && unoffered.length === 0) continue;
      const topics = entry.topics ?? row.topics ?? [];
      const body = {
        title: row.title,
        slug: row.slug,
        done_when: row.done_when,
        topics,
        owner: id.address,
        from: row.from ?? null,
        pieces: row.pieces,
        counts: row.counts,
        work: row.work,
        trackers,
        mirrors: this.config.mirrors,
      };
      const announce = this.sign({ quilt: 1, type: 'announce', problem: h, key: id.address, ts: this.stamp(), body });
      await this.resolver.post(announce, h, trackers);
      if (this.config.relays.length) await postToRelays(this.config.relays, announcementEvent(announce, id.secret));
      entry.announced = { at: this.stamp(), mark, relays: [...new Set([...offered, ...this.config.relays])] };
      if (!entry.topics) entry.topics = topics;
      this.save();
      out.push(h);
    }
    return out;
  }

  /**
   * The rarest piece for this key, claimed: the tracker's assisted next where one answers and names a piece, else the
   * core's `next` over the map; a lock of standing or of coin before the claim where the problem asks a stake of the
   * piece (QX-15, QX-17); the claim recorded in the library. With no problem named, `offered`. With QUILT_NEXT_ONLY set
   * to `verify`, only a piece within the second reader's pool (`pool`), and nothing claimed when there is none.
   */
  async next(input: string): Promise<Handed> {
    if (!input.trim()) return this.offered();
    const id = this.needKey();
    const { hash, state, tracker, superseded } = await this.open(input);
    if (superseded) throw new Error(`that problem was replaced by its owner; the work is on ${superseded}`);
    const trackers = this.trackersFor(hash);
    // The second reader's pool, where the environment asks for one: empty, there is nothing to verify, and no claim is
    // made. Everything below picks within it.
    const pool = this.pool(state);
    const nothingToVerify = 'nothing to verify on that problem for this key right now';
    if (pool?.size === 0) throw new Error(nothingToVerify);
    const within = (piece: Hash): boolean => !pool || pool.has(piece);
    // 1. The tracker's word, where one answered and named a piece within the pool: the piece, the stake it asks, and
    // the pieces this key cannot cover.
    const asked = tracker
      ? await this.askedNext(hash, state, tracker, pool !== null)
      : { pick: null, stake: 0, unaffordable: [] as Hash[], seams: [] as Seam[] };
    let pick = asked.pick && within(asked.pick.piece.hash) ? asked.pick : null;
    let stake = pick ? asked.stake : 0;
    // 2. Else the map, within the pool and leaving out the pieces the tracker left out for their stake, since a claim
    // on one would be refused at its door; where the tracker had named a piece outside the pool, the stake is the map's
    // piece's own.
    if (!pick) {
      const exclude = new Set<string>([
        ...asked.unaffordable,
        ...state.pieces.filter((v) => !within(v.piece.hash)).map((v) => v.piece.hash),
      ]);
      pick = next(state, id.address, this.client(), this.stamp(), { exclude });
      if (pick && asked.pick && tracker)
        stake = layerByHash(await this.layerOf(hash, tracker)).get(pick.piece.hash)?.stake ?? 0;
    }
    // 3. Else coin in place of standing (QX-17), where the tracker carries it and this key's free coin covers a stake
    // within the pool.
    let plan: CoinPlan | null = null;
    const unaffordable = asked.unaffordable.filter(within);
    if (!pick && unaffordable.length && tracker) {
      const instead = await this.coinInstead(hash, state, tracker, unaffordable);
      if (instead) ({ pick, plan } = instead);
      if (plan) stake = plan.stake;
    }
    if (!pick)
      throw new Error(
        pool
          ? nothingToVerify
          : asked.unaffordable.length
            ? `every piece left on that problem asks a stake this key's free standing cannot cover (${tracker})`
            : 'nothing for this key on that problem right now',
      );
    // 4. The lock before the claim, where a stake is asked.
    const lock = await this.lockBefore(hash, pick.piece.hash, trackers, stake, plan);
    // 5. The claim, stamped after the lock so the two fold in order; where it went comes back as `posted`, refused or
    // not.
    const claim = this.sign({
      quilt: 1,
      type: 'claim',
      problem: hash,
      piece: pick.piece.hash,
      key: id.address,
      ts: this.stamp(2),
      body: { by: this.by() },
    });
    const posted = await this.resolver.post(claim, hash, trackers);
    // 6. The claim in the library.
    this.library.pieces[pick.piece.hash] = {
      problem: hash,
      name: pick.piece.name,
      when: claim.ts,
      what: 'claimed',
      verifier: pick.piece.verifier,
    };
    this.save();
    // The seams belong to the piece the tracker named; a piece the map picked instead has none here.
    const seams = asked.pick?.piece.hash === pick.piece.hash ? asked.seams : [];
    return { hash, pick, posted, owner: nameOf(state, state.envelope.problem.owner), stake, lock, seams };
  }

  /**
   * The second reader's pool, when QUILT_NEXT_ONLY is `verify`: the pieces in `needs_verify` or `disputed` that have a
   * reading on them. A key run this way confirms or disagrees with what was returned and does no first work, so an open
   * piece is never in the pool. Which piece among them is the core's choice (CORE.md section 7, step 3): it prefers one
   * no reading of which is this key's vendor's and falls back to the rest, and its own rule keeps a same-vendor pair
   * from making a set and a root from reading a piece twice; so this filter says nothing about vendors (QX-19 section
   * 4). The tracker is asked within the same pool (`askedNext`), so a reading it set aside comes back to the key that
   * made it. Null when the environment does not ask for it, and `next` takes anything.
   */
  private pool(state: State): Set<string> | null {
    if (process.env.QUILT_NEXT_ONLY !== 'verify') return null;
    return new Set(
      state.pieces
        .filter((v) => (v.state === 'needs_verify' || v.state === 'disputed') && v.reveals.length > 0)
        .map((v) => v.piece.hash),
    );
  }

  /**
   * The core's `next` held to one piece: every other piece excluded, so the pick is that piece's, or null where this
   * key cannot take it.
   */
  private pickOnly(state: State, piece: Hash, now: string): Pick | null {
    return next(state, this.needKey().address, this.client(), now, {
      exclude: new Set(state.pieces.filter((v) => v.piece.hash !== piece).map((v) => v.piece.hash)),
    });
  }

  /**
   * The tracker's assisted next: the piece it names for this key as a pick, the stake it asks of it (QX-15), and the
   * pieces it left out because this key's free standing cannot cover their stake. A tracker that names nothing is only
   * saying its holds are taken, and the map decides; one that does not answer names nothing. One that has taken the
   * problem down (QX-6) takes no claim on it either, so that throws. With `pool`, the tracker is asked within the
   * second reader's pool (`only=verify`), so its pick is a piece with a reading on it, over its own fold: the one fold
   * in which a reading it set aside does not stand (QX-19 section 4).
   */
  private async askedNext(
    hash: Hash,
    state: State,
    tracker: string,
    pool = false,
  ): Promise<{ pick: Pick | null; stake: number; unaffordable: Hash[]; seams: Seam[] }> {
    const id = this.needKey();
    type Answer = {
      piece: Hash | null;
      state?: string;
      agree?: string[];
      lease_h?: number;
      stake?: number;
      unaffordable?: Hash[];
      seams?: Seam[];
    };
    let answer: Answer | null = null;
    let takenDown: string | null = null;
    try {
      const r = await this.resolver.fetchImpl(
        `${tracker}p/${hash}/next?key=${id.address}&can=${this.config.can.join(',')}&model=${encodeURIComponent(this.model())}${pool ? '&only=verify' : ''}`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (r.ok) answer = (await r.json()) as Answer;
      else if (r.status === 410)
        takenDown = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? 'taken down';
    } catch {
      /* a tracker that does not answer names nothing */
    }
    if (takenDown) throw new Error(`${tracker} has taken this problem down: ${takenDown}`);
    const stake = answer?.stake ?? 0;
    const unaffordable = Array.isArray(answer?.unaffordable) ? answer.unaffordable : [];
    const view = answer?.piece ? state.byHash.get(answer.piece) : undefined;
    if (!answer?.piece || !view) return { pick: null, stake, unaffordable, seams: [] };
    let pick = this.pickOnly(state, answer.piece, this.stamp());
    // QX-19: the seams of a disputed piece, as the tracker handed them over, each side's key named here.
    const seams = (Array.isArray(answer.seams) ? answer.seams : []).map((s) => ({
      ...s,
      sides: s.sides.map((x) => ({ ...x, name: nameOf(state, x.key) })) as [SeamSide, SeamSide],
    }));
    // A kind the core does not implement (human, judge:n, attest): the tracker's layer offered it. Or a piece whose
    // reading by this key the tracker set aside (QX-19 section 4): the core still counts that reading and would not
    // hand the piece to this key, the layer does not count it and hands it back. In both, the piece's own brief, schema
    // and lease are in the envelope this client holds, and the tracker's word on the state stands.
    const setAsideHere = seams.some((s) =>
      s.sides.some((x) => x.aside && x.key.toLowerCase() === id.address.toLowerCase()),
    );
    if (!pick && (view.state === 'unknown' || setAsideHere))
      pick = {
        piece: view.piece,
        state: (answer.state ?? 'open') as Pick['state'],
        brief: renderInputs(view, state),
        ...(view.piece.schema ? { schema: view.piece.schema } : {}),
        agree: answer.agree ?? view.piece.agree ?? view.piece.schema?.required ?? [],
        requires: view.piece.requires,
        lease_h: answer.lease_h ?? view.piece.lease_h ?? state.envelope.problem.settings.lease_h,
        availability: view.availability,
      };
    return { pick, stake, unaffordable, seams };
  }

  /**
   * QX-17: standing is short. Where the tracker honours coin and this key's free coin covers a piece's stake at the
   * burn rate, that piece is picked and the plan says where the coin is locked and how much; null where no piece can
   * be covered that way.
   */
  private async coinInstead(
    hash: Hash,
    state: State,
    tracker: string,
    unaffordable: Hash[],
  ): Promise<{ pick: Pick; plan: CoinPlan } | null> {
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
  private async lockBefore(
    hash: Hash,
    piece: Hash,
    trackers: string[],
    stake: number,
    plan: CoinPlan | null,
  ): Promise<'standing' | 'coin' | null> {
    const key = this.needKey().address;
    if (plan) {
      const onLog = this.sign({
        quilt: 1,
        type: 'lock',
        key,
        ts: this.stamp(),
        body: { problem: hash, piece, amount: plan.units },
      });
      const c = await this.resolver.post(onLog, 'coin', [plan.coinHome]);
      // A queued lock is no lock, since the door would refuse the claim: this one is not left to the queue.
      if (c.error || c.queued)
        throw new Error(
          `the coin's home did not take the lock of ${plan.units} units${c.error ? `: ${c.error}` : ''}; nothing was claimed`,
        );
      await this.postSigned(
        {
          quilt: 1,
          type: 'lock',
          problem: hash,
          piece,
          key,
          ts: this.stamp(1),
          body: { kind: 'coin', amount: plan.stake, id: eventId(onLog) },
        },
        hash,
        trackers,
        `coin lock of ${plan.stake}`,
      );
      return 'coin';
    }
    if (stake > 0) {
      await this.postSigned(
        {
          quilt: 1,
          type: 'lock',
          problem: hash,
          piece,
          key,
          ts: this.stamp(),
          body: { kind: 'standing', amount: stake },
        },
        hash,
        trackers,
        `lock of ${stake}`,
      );
      return 'standing';
    }
    return null;
  }

  /**
   * Something to do when no problem is named: the standing list first (QX-4), then each tracker's offer in its order
   * (QX-5).
   */
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
      const offers =
        (
          await this.ask<{ offers: { problem: Hash }[] }>(
            `${t}offer?key=${id.address}&can=${this.config.can.join(',')}&model=${encodeURIComponent(this.model())}`,
          )
        )?.offers ?? [];
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
    const { event, posted } = await this.postSigned(
      { quilt: 1, type: 'seed', problem, key: this.needKey().address, ts: this.stamp(), body: { on } },
      problem,
      this.trackersFor(problem),
      'seed',
    );
    if (on) this.library.seeding[problem] = event.ts;
    else delete this.library.seeding[problem];
    this.save();
    return posted;
  }

  /**
   * What waits on this key's person across the problems it keeps and the ones it has worked: a judge seat not yet
   * ranked, a challenge seat without its verdict, a dispute on a piece this key returned, and, in a kept problem, a
   * human piece with a seat open that this key has not filled. Nothing is written: the library's dates stay as they
   * were.
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
    // Each problem is its own few requests to its tracker; four are asked at once, and the items keep the problems'
    // order.
    const perProblem = await inParallel(problems, 4, async (problem): Promise<AttentionItem[]> => {
      const items: AttentionItem[] = [];
      let resolved: Awaited<ReturnType<Resolver['resolve']>>;
      try {
        resolved = await this.resolver.resolve(parseLink(problem));
      } catch {
        return items;
      }
      if (!resolved) return items;
      const state = this.resolver.state(resolved);
      const title = state.envelope.problem.title;
      const tracker = resolved.tracker;
      const over = layerByHash(tracker ? await this.layerOf(problem, tracker) : null);
      const item = (piece: Hash | null, name: string | null, why: AttentionItem['why']) =>
        items.push({ problem, title, piece, name, why, tracker });
      if (tracker) {
        const [panels, challenges] = await Promise.all([
          this.panels(problem, tracker),
          this.challenges(problem, tracker),
        ]);
        for (const p of panels)
          if (p.outcome === 'open' && p.seats.some((s) => s.root === me && s.lapsed_at === null && !s.rank))
            item(p.piece, p.name, 'rank');
        for (const c of challenges)
          if (c.outcome === 'open' && c.seats.some((s) => s.root === me && s.lapsed_at === null && !s.verdict))
            item(c.piece, c.name, 'verdict');
        // QX-16: a piece this key committed gold on, its window open and not yet revealed, as the tracker holds it
        // (gold.ts, goldDue).
        for (const d of gold.goldDue(this.library, problem, over)) item(d.piece, d.name, 'gold');
      }
      for (const v of state.pieces) {
        const st = over.get(v.piece.hash)?.state ?? v.state;
        const mine = this.library.pieces[v.piece.hash];
        if (st === 'disputed' && mine?.what === 'returned') item(v.piece.hash, v.piece.name, 'disputed');
        if (
          v.piece.verifier === 'human' &&
          this.library.seeding[problem] &&
          (st === 'open' || st === 'needs_verify') &&
          mine?.what !== 'returned'
        )
          item(v.piece.hash, v.piece.name, 'person');
      }
      return items;
    });
    items.push(...perProblem.flat());
    return { items, checked };
  }

  /**
   * A return handed in: a commit, then its reveal a moment later; and what the piece waits for next, by its kind. With
   * rests (QX-19), the trace behind the reveal follows it: each page fetched once, each passage found, the reads kept
   * on the trackers and the trace posted naming the reveal (trace.ts); a rest that cannot be placed is left out and
   * said.
   */
  async return(
    problem: Hash,
    piece: Hash,
    ret: Record<string, unknown>,
    rests: RestAsked[] = [],
  ): Promise<{ commit: Posted; reveal: Posted; waits: string; trace: TraceOutcome | null }> {
    const key = this.needKey().address;
    const trackers = this.trackersFor(problem);
    this.gate(ret);
    const nonce = newNonce();
    const { posted: commit } = await this.postSigned(
      { quilt: 1, type: 'commit', problem, piece, key, ts: this.stamp(), body: { h: commitHash(ret, nonce) } },
      problem,
      trackers,
      'commit',
    );
    const { event: reveal, posted: revealed } = await this.postSigned(
      { quilt: 1, type: 'reveal', problem, piece, key, ts: this.stamp(1), body: { return: ret, nonce, by: this.by() } },
      problem,
      trackers,
      'reveal',
    );
    const known = this.library.pieces[piece];
    this.library.pieces[piece] = {
      problem,
      name: known?.name ?? piece,
      when: reveal.ts,
      what: 'returned',
      ...(known?.verifier ? { verifier: known.verifier } : {}),
    };
    this.save();
    const trace = rests.length
      ? await traceAfterReveal(
          this.door,
          problem,
          piece,
          eventId(reveal),
          ret,
          rests,
          trackers,
          this.resolver.fetchImpl,
        )
      : null;
    return { commit, reveal: revealed, waits: await this.afterReturn(problem, piece, known?.verifier), trace };
  }

  /**
   * What the piece is now that the return is in, read back from the tracker: accepted on two vendors' agreement, or
   * disputed, where this return was the second production; else what a piece of its kind waits for. A tracker that does
   * not answer leaves the kind's words.
   */
  private async afterReturn(problem: Hash, piece: Hash, verifier: string | undefined): Promise<string> {
    let kind = verifier ? kindWords(verifier).kind : null;
    // Only a kind accepted on agreement has a second production to speak of; an attest record is accepted at once and
    // says so already.
    if (kind !== null && kind !== 'agree' && kind !== 'human') return waitsText(verifier);
    try {
      const { state, layer } = await this.open(problem);
      const view = state.pieces.find((v) => v.piece.hash === piece);
      if (kind === null && view) {
        // A piece returned without being handed out first: its kind is the problem's to say.
        verifier = view.piece.verifier;
        kind = kindWords(verifier).kind;
        if (kind !== 'agree' && kind !== 'human') return waitsText(verifier);
      }
      const now: string | undefined = layerByHash(layer).get(piece)?.state ?? view?.state;
      if (now === 'accepted_provisional' || now === 'accepted')
        return 'Two vendors agree: the piece is accepted, provisionally until the challenge window closes, and the standing for it is counted.';
      if (now === 'disputed')
        return 'Another vendor read it differently: the piece is disputed, and a third production from a vendor unrelated to both settles it.';
    } catch {
      // The tracker did not answer in time; the kind's words stand.
    }
    return waitsText(verifier);
  }

  /**
   * A piece given back with one of the core's fixed reasons (DECLINE_REASONS); any other reason is refused here before
   * it is signed. This key is not offered the piece again in this version of the problem.
   */
  async decline(problem: Hash, piece: Hash, reason: DeclineReason): Promise<Posted> {
    if (!isDeclineReason(reason)) throw new Error(`a decline gives one of ${DECLINE_REASONS.join(', ')}`);
    const { posted } = await this.postSigned(
      { quilt: 1, type: 'decline', problem, piece, key: this.needKey().address, ts: this.stamp(), body: { reason } },
      problem,
      this.trackersFor(problem),
      'decline',
    );
    return posted;
  }

  /**
   * A ranking of a judge piece's candidates by a key drawn to its panel (QX-2): every candidate's digest once, first
   * choice first, signed and posted.
   */
  async rank(problem: Hash, piece: Hash, ranking: Hash[]): Promise<Posted & { id: Hash }> {
    if (!Array.isArray(ranking) || ranking.length === 0 || !ranking.every((d) => isHash(d)))
      throw new Error('a ranking is a list of candidate digests, first choice first');
    if (new Set(ranking).size !== ranking.length) throw new Error('a ranking names each digest once');
    const { event, posted } = await this.postSigned(
      { quilt: 1, type: 'rank', problem, piece, key: this.needKey().address, ts: this.stamp(), body: { ranking } },
      problem,
      this.trackersFor(problem),
      'rank',
    );
    return { id: eventId(event), ...posted };
  }

  /**
   * The problem's judge panels as the first tracker that answers computes them: the one that answered for the problem,
   * then the known ones.
   */
  async panels(problem: Hash, tracker: string | null = null): Promise<PanelListing[]> {
    const found = await this.firstAnswer(
      this.trackersFor(problem, tracker ? [tracker] : []),
      async (t) => (await this.ask<{ panels: PanelListing[] }>(`${t}p/${problem}/panels`))?.panels ?? null,
    );
    return found ?? [];
  }

  /**
   * A challenge of a piece's provisional acceptance (QX-1), or of a gold miss by a root it struck (QX-16): a stake of
   * this key's standing, 0 allowed against a miss, and one sentence of ground, signed and posted.
   */
  async challenge(problem: Hash, piece: Hash, stake: number, ground: string): Promise<Posted & { id: Hash }> {
    if (!Number.isInteger(stake) || stake < 0)
      throw new Error(
        'the stake is a whole number from 0: at least 1 against an acceptance, and nothing need be staked against a gold miss',
      );
    const issues = plainTextProblems(ground, 'ground');
    if (issues.length) throw new Error(issues[0]);
    const { event, posted } = await this.postSigned(
      {
        quilt: 1,
        type: 'challenge',
        problem,
        piece,
        key: this.needKey().address,
        ts: this.stamp(),
        body: { stake, ground },
      },
      problem,
      this.trackersFor(problem),
      'challenge',
    );
    return { id: eventId(event), ...posted };
  }

  /**
   * A verdict on a challenge this key was drawn to judge: for the challenger or for the author, with this judge's own
   * return as evidence where it has one.
   */
  async verdict(
    problem: Hash,
    piece: Hash,
    challenge: Hash,
    side: Side,
    ret?: Record<string, unknown>,
  ): Promise<Posted & { id: Hash }> {
    if (!SIDES.includes(side)) throw new Error(`a verdict is for the ${SIDES.join(' or the ')}`);
    if (ret) this.gate(ret);
    const { event, posted } = await this.postSigned(
      {
        quilt: 1,
        type: 'verdict',
        problem,
        piece,
        key: this.needKey().address,
        ts: this.stamp(),
        body: { challenge, for: side, ...(ret ? { return: ret } : {}) },
      },
      problem,
      this.trackersFor(problem),
      'verdict',
    );
    return { id: eventId(event), ...posted };
  }

  /**
   * The problem's challenges as the first tracker that answers computes them: the one that answered for the problem,
   * then the known ones.
   */
  async challenges(problem: Hash, tracker: string | null = null): Promise<ChallengeListing[]> {
    const found = await this.firstAnswer(
      this.trackersFor(problem, tracker ? [tracker] : []),
      async (t) =>
        (await this.ask<{ challenges: ChallengeListing[] }>(`${t}p/${problem}/challenges`))?.challenges ?? null,
    );
    return found ?? [];
  }

  /**
   * A maintainer's takedown (QX-6): a hide event on the identity log of this client's trackers; lifted with `on` false.
   */
  async hide(id: string, why: string, on = true): Promise<Posted> {
    const issues = plainTextProblems(why, 'why');
    if (issues.length) throw new Error(issues[0]);
    const { posted } = await this.postSigned(
      { quilt: 1, type: 'hide', key: this.needKey().address, ts: this.stamp(), body: { id, why, on } },
      null,
      this.config.trackers,
      'hide',
    );
    return posted;
  }

  /**
   * The stake a problem asks of a claim on its pieces (QX-15): a stake_rule event from the owner on the problem's log,
   * replacing the one before.
   */
  async stakeRule(problem: Hash, min: number, pieces?: string[]): Promise<Posted> {
    if (!Number.isInteger(min) || min < 0) throw new Error('the stake is a whole number from 0');
    const { posted } = await this.postSigned(
      {
        quilt: 1,
        type: 'stake_rule',
        problem,
        key: this.needKey().address,
        ts: this.stamp(),
        body: { min, ...(pieces && pieces.length ? { pieces } : {}) },
      },
      problem,
      this.trackersFor(problem),
      'stake rule',
    );
    return posted;
  }

  /** A name event for this key on the identity log of this client's trackers. */
  async setName(name: string): Promise<Posted> {
    const issues = plainTextProblems(name, 'name');
    if (issues.length) throw new Error(issues[0]);
    const { posted } = await this.postSigned(
      { quilt: 1, type: 'name', key: this.needKey().address, ts: this.stamp(), body: { name } },
      null,
      this.config.trackers,
      'name',
    );
    return posted;
  }

  /**
   * Builds, signs and publishes an envelope from a pattern, with its blobs; then announces it, and posts the stake rule
   * and the gold where the pattern carries them.
   */
  async publish(pattern: Pattern): Promise<Published> {
    const id = this.needKey();
    // Every fault at once (pattern.ts), so an AI drafting the pattern from a conversation fixes them in one turn.
    const drafted = draftEnvelope(pattern, id, { trackers: this.config.trackers, mirrors: this.config.mirrors });
    const problems = patternProblems(pattern, drafted);
    if (problems.length) throw new Error(patternProblemsText(problems));
    const { envelope, blobs, problem } = drafted;
    const out = await this.publishEnvelope(envelope, blobs, problem, pattern.topics ?? []);
    if (out.posted.length) {
      if (pattern.stake) {
        // QX-15: the stake the owner asks, on the problem's log right after the envelope; a refusal is listed rather
        // than thrown, since the problem is out.
        const rule = this.sign({
          quilt: 1,
          type: 'stake_rule',
          problem: out.hash,
          key: id.address,
          ts: this.stamp(),
          body: { min: pattern.stake.min, ...(pattern.stake.pieces?.length ? { pieces: pattern.stake.pieces } : {}) },
        });
        const r = await this.resolver.post(rule, out.hash, out.posted);
        if (r.error && !r.queued) out.refused.push(`stake rule: ${r.error}`);
      }
      if (pattern.gold) {
        try {
          out.gold = await this.commitGold(
            out.hash,
            pattern.gold.answers,
            pattern.gold.stake,
            expandPieces(problem, blobs),
            out.posted,
            pattern.stake,
          );
        } catch (err) {
          out.refused.push(`gold: ${(err as Error).message}`);
        }
      }
    }
    return out;
  }

  /**
   * A signed envelope posted to every tracker with its blobs; then, where it went, the announce with the topics, the
   * relays and the version event; the home's library notes the problem.
   */
  private async publishEnvelope(
    envelope: Envelope,
    blobs: Map<Hash, Uint8Array>,
    problem: Problem,
    topics: string[],
  ): Promise<Published> {
    const id = this.needKey();
    const hash = problemHash(envelope);
    const body = JSON.stringify({
      envelope,
      blobs: Object.fromEntries([...blobs].map(([h, b]) => [h, Buffer.from(b).toString('base64')])),
    });
    const posted: string[] = [];
    const refused: string[] = [];
    let relays: string[] = [];
    for (const t of this.config.trackers) {
      try {
        // A whole envelope with its blobs: fifteen seconds, where a read gets eight (askJson).
        const r = await this.resolver.fetchImpl(`${t}p`, {
          method: 'POST',
          body,
          headers: { 'content-type': 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
        if (r.status === 201) posted.push(t);
        else refused.push(`${t}: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`);
      } catch (err) {
        refused.push(`${t}: ${(err as Error).message}`);
      }
    }
    const pieces = expandPieces(problem, blobs).length;
    if (posted.length) {
      // The announce (QX-13: the owner, the fork, the pieces, every piece open, no work yet) and the version are posted
      // where the envelope went, and a refusal of either is not the publish's to report.
      const announce = this.sign({
        quilt: 1,
        type: 'announce',
        problem: hash,
        key: id.address,
        ts: this.stamp(),
        body: {
          title: problem.title,
          slug: problem.slug,
          done_when: problem.done_when,
          topics,
          owner: id.address,
          from: problem.from ?? null,
          pieces,
          counts: { open: pieces },
          work: NO_WORK,
          trackers: posted,
          mirrors: this.config.mirrors,
        },
      });
      await this.resolver.post(announce, hash, posted);
      if (this.config.relays.length)
        relays = (await postToRelays(this.config.relays, announcementEvent(announce, id.secret))).posted;
      const version = this.sign({
        quilt: 1,
        type: 'version',
        problem: hash,
        key: id.address,
        ts: this.stamp(),
        body: { slug: problem.slug, hash },
      });
      await this.resolver.post(version, hash, posted);
    }
    const now = this.stamp();
    this.library.problems[hash] = {
      title: problem.title,
      slug: problem.slug,
      trackers: posted,
      first: now,
      last: now,
      topics,
      announced: { at: now, mark: [0, 0, 0, 0, 0].join('/'), relays: [...this.config.relays] },
    };
    this.save();
    return { hash, link: makeLink(hash, posted, problem.slug), posted, refused, relays, gold: null };
  }

  /**
   * QX-19 section 4: the owner's node sharpens a brief two readings read apart. For each family of this problem with a
   * piece the core calls disputed on a `source`, `span` or `reading` seam, or disputed between readings that rest on
   * nothing once the dispute has stood a lease past its last reveal, `ask` is given the brief, the field and both
   * sides, and answers with the sentence the brief lacks, or null to leave it. Each sentence kept goes at the end of
   * its family's brief in a version of the problem, `prev` this one, posted as `publish` posts, with the announce's
   * topics, and the gold the home holds for this problem is committed again on the new pieces. A problem already
   * replaced is left as it is, and the home notes which version replaced which. `now` is the clock the lease is read
   * by.
   */
  async sharpen(
    problem: Hash,
    ask: (q: SentenceAsk) => Promise<string | null>,
    now = new Date().toISOString(),
  ): Promise<Sharpened> {
    const id = this.needKey();
    if (this.library.problems[problem]?.frozen) throw new Error(FROZEN);
    const { state, layer, superseded } = await this.open(problem);
    const old = state.envelope.problem;
    if (old.owner.toLowerCase() !== id.address.toLowerCase()) throw new Error(NOT_OWNER);
    const entry = this.library.problems[problem];
    if (superseded) {
      if (entry && entry.next !== superseded) {
        entry.next = superseded;
        this.save();
      }
      return { problem, sentences: [], hash: superseded, posted: [], refused: [] };
    }
    const over = layerByHash(layer);
    const seams = new Map<string, { piece: string; seam: Seam; grounded: boolean }>();
    const grounded = (x: SeamSide) => x.read !== null && x.span !== null;
    for (const v of state.pieces) {
      const l = over.get(v.piece.hash);
      if ((l?.core ?? v.state) !== 'disputed' || seams.has(v.piece.family) || !l?.seams?.length) continue;
      // Two readings that both rest on the record: the seam says why they differ, and the sentence decides between
      // them.
      const both = l.seams.find((s) => s.why !== 'unknown');
      if (both) {
        seams.set(v.piece.family, { piece: v.piece.name, seam: both, grounded: true });
        continue;
      }
      // Readings that rest on nothing, none set aside, and the dispute a lease old since its last reveal: nothing a
      // reader could prefer, so the sentence says which record governs and where it is read.
      if (l.state !== 'disputed' || l.seams.some((s) => s.sides.some(grounded))) continue;
      const leaseMs = (v.piece.lease_h ?? old.settings.lease_h) * 3_600_000;
      const last = v.reveals.reduce((t, r) => (r.at > t ? r.at : t), '');
      if (!last || Date.parse(last) + leaseMs > Date.parse(now)) continue;
      seams.set(v.piece.family, { piece: v.piece.name, seam: l.seams[0]!, grounded: false });
    }
    const sentences: Sharpened['sentences'] = [];
    const pieces = structuredClone(old.pieces);
    for (const [family, { piece, seam, grounded: both }] of seams) {
      const key = Object.keys(pieces).find((k) => k === `${family}/*` || k === family || k === piece);
      const def = key ? pieces[key] : undefined;
      if (!def) continue;
      const said =
        (await ask({ family, brief: def.brief, field: seam.field, seam, piece, grounded: both }))
          ?.replace(/\s+/g, ' ')
          .trim() ?? '';
      const why = !said
        ? 'no sentence'
        : said.length > SENTENCE_MAX
          ? `over ${SENTENCE_MAX} characters`
          : (textIssues(said)[0] ?? null);
      sentences.push({ family, field: seam.field, sentence: said || null, kept: why === null, why });
      if (why === null) def.brief = `${def.brief} ${said}`;
    }
    if (!sentences.some((s) => s.kept)) return { problem, sentences, hash: null, posted: [], refused: [] };
    const resolved = await this.resolver.resolve(parseLink(problem));
    if (!resolved) throw new Error('no resolver answered for that hash');
    const next: Problem = { ...old, prev: problem, pieces };
    const unsigned = {
      quilt: 1 as const,
      problem: next,
      hints: { trackers: this.config.trackers, mirrors: this.config.mirrors },
    };
    const envelope: Envelope = { ...unsigned, sig: signObject(unsigned, id.secret) };
    const announce = resolved.receipts.find(
      (r) => r.event.type === 'announce' && r.event.key.toLowerCase() === id.address.toLowerCase(),
    );
    const topics = (announce?.event.body as { topics?: string[] } | undefined)?.topics ?? [];
    const out = await this.publishEnvelope(envelope, resolved.blobs, next, Array.isArray(topics) ? topics : []);
    if (out.posted.length) {
      const kept = this.library.gold?.[problem];
      if (kept && Object.keys(kept).length) {
        try {
          out.gold = await this.commitGold(
            out.hash,
            Object.fromEntries(Object.values(kept).map((g) => [g.name, g.projection])),
            undefined,
            expandPieces(next, resolved.blobs),
            out.posted,
          );
        } catch (err) {
          out.refused.push(`gold: ${(err as Error).message}`);
        }
      }
      const was = this.library.problems[problem];
      if (was) was.next = out.hash;
      this.save();
    }
    return { problem, sentences, hash: out.posted.length ? out.hash : null, posted: out.posted, refused: out.refused };
  }

  /**
   * The owner's freeze of a problem's brief in this home (QX-19 section 4): from now on the owner's turn does not
   * sharpen it, so a dispute after the freeze waits beside the brief as written and no version moves the squares
   * already made onto another hash; the gold due is still revealed. Off thaws it. Only a problem this home's library
   * knows and this key owns.
   */
  async freeze(problem: Hash, on = true): Promise<{ problem: Hash; frozen: string | null }> {
    const id = this.needKey();
    const entry = this.library.problems[problem];
    if (!entry) throw new Error("that problem is not in this home's library");
    const { state } = await this.open(problem);
    if (state.envelope.problem.owner.toLowerCase() !== id.address.toLowerCase())
      throw new Error('only the owner freezes a brief');
    const kept = this.library.problems[problem]!;
    if (on) kept.frozen ??= this.stamp();
    else delete kept.frozen;
    this.save();
    return { problem, frozen: kept.frozen ?? null };
  }

  /**
   * The owner's sharpening over every problem the home knows and this key owns, each once (QX-19 section 4); the away
   * turn runs it before its agent. A problem with no such seam, or one frozen here, is passed over in silence.
   */
  async sharpenDue(
    ask: (q: SentenceAsk) => Promise<string | null>,
    now = new Date().toISOString(),
  ): Promise<Sharpened[]> {
    if (!this.identity) return [];
    const out: Sharpened[] = [];
    for (const h of new Set([...Object.keys(this.library.problems), ...Object.keys(this.library.gold ?? {})])) {
      if (!isHash(h) || this.library.problems[h]?.next || this.library.problems[h]?.frozen) continue;
      try {
        const r = await this.sharpen(h, ask, now);
        if (r.sentences.length) out.push(r);
      } catch (e) {
        if ((e as Error).message !== NOT_OWNER)
          out.push({ problem: h, sentences: [], hash: null, posted: [], refused: [(e as Error).message] });
      }
    }
    return out;
  }

  // What was read, said as text: the work is in render.ts, and these hand it the config's trackers where it needs them.

  /** A problem said whole, as quilt_open answers it (render.ts, `summary`). */
  summary(
    hash: Hash,
    state: State,
    tracker: string | null,
    layer: LayerPiece[] | null = null,
    hidden: Takedown | null = null,
    gold: GoldCount | null = null,
  ): string {
    return summary({ hash, state, tracker, layer, hidden, gold }, this.config.trackers);
  }

  /** The piece said as text, as quilt_next answers it (render.ts, `pieceText`). */
  pieceText(hash: Hash, pick: Pick, owner: string, stake = 0): string {
    return pieceText(hash, pick, owner, stake);
  }

  /**
   * The accepted returns as quoted text with the signers named, and the witness beside a name where the receipt carries
   * one (render.ts, `acceptedText`).
   */
  acceptedText(state: State, layer: LayerPiece[] | null = null, witnessed: Map<string, Witness> = new Map()): string {
    return acceptedText(state, layer, witnessed);
  }

  /**
   * The disputed pieces, each return quoted with its signer named and this key's marked (render.ts, `disputedText`).
   */
  disputedText(state: State, layer: LayerPiece[] | null = null): string {
    return disputedText(state, layer, this.identity?.address ?? null);
  }

  /** The challenges said as text (render.ts, `challengesText`). */
  challengesText(list: ChallengeListing[], state: State): string {
    return challengesText(list, state);
  }

  /** The panels said as text (render.ts, `panelsText`). */
  panelsText(list: PanelListing[], state: State): string {
    return panelsText(list, state);
  }

  // The coin (QX-17): where it lives, what this key holds of it, and the three events that move it. The work is in
  // coin.ts, through the door.

  /** Where a tracker's coin lives and the burn rate there, or null where it honours none (coin.ts, `coinAt`). */
  coinAt(tracker: string): Promise<{ coinHome: string; burn_rate: number } | null> {
    return coin.coinAt(this.door, tracker);
  }

  /** This key's coin at a home, or null (coin.ts, `coinBalance`). */
  coinBalance(coinHome: string): Promise<CoinBalance | null> {
    return coin.coinBalance(this.door, coinHome);
  }

  /** This key's coin at the first of this client's trackers that carries one, or null (coin.ts, `balance`). */
  coin(): Promise<CoinBalance | null> {
    return coin.balance(this.door);
  }

  /** A pay to a problem: coin escrowed for its workers (coin.ts, `pay`). */
  pay(problem: Hash, amount: number, perSquare: number): Promise<Posted & { id: Hash; home: string }> {
    return coin.pay(this.door, problem, amount, perSquare);
  }

  /** A transfer of this key's vested free coin to an address (coin.ts, `transfer`). */
  transfer(to: Address, amount: number): Promise<Posted & { id: Hash; home: string }> {
    return coin.transfer(this.door, to, amount);
  }

  /** A redeem of this key's vested free coin, the door out to the chain (coin.ts, `redeem`). */
  redeem(amount: number, to?: Address): Promise<Posted & { id: Hash; home: string }> {
    return coin.redeem(this.door, amount, to);
  }

  // The owner's gold (QX-16): answers committed blind before the work, and revealed piece by piece once accepted. The
  // work is in gold.ts, through the door.

  /** The owner's gold on a problem, committed blind (gold.ts, `commitGold`). */
  commitGold(
    problem: Hash,
    answers: Record<string, Record<string, unknown>>,
    stakeAsked?: number,
    pieces?: Piece[],
    trackers?: string[],
    rule?: { min: number; pieces?: string[] },
  ): Promise<{ pieces: number; stake: number }> {
    return gold.commitGold(this.door, problem, answers, stakeAsked, pieces, trackers, rule);
  }

  /** The owner's reveal of the gold on a piece, and what the tracker decided (gold.ts, `revealGold`). */
  revealGold(problem: Hash, piece: Hash): Promise<Posted & { id: Hash; name: string; outcome: string | null }> {
    return gold.revealGold(this.door, problem, piece);
  }

  /**
   * The owner's reveals run with nobody asked: every piece whose gold is due, revealed in turn, or with `post` false
   * listed with nothing posted (gold.ts, `revealDue`).
   */
  revealDue(post = true): Promise<gold.Revealed[]> {
    return gold.revealDue(this.door, post);
  }
}
