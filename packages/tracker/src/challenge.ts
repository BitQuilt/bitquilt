/**
 * The challenge window, extension QX-1 (docs/ext/QX-1.md): a layer over the core's fold, with no HTTP in it. A root
 * with standing may challenge a provisional acceptance inside its window; a panel of three is drawn by sortition from
 * roots with an accepted return on another problem, seeded by the challenge's own chained receipt line, which no party
 * makes alone; two verdicts decide. A held challenge strikes the accepting set's events, and the core's own reducer,
 * run again without them, says what the piece is now; a failed one costs the challenger the stake. The core's state is
 * a coarsening of this layer's: where it says `challenged`, the core says accepted within its window.
 *
 * The fold this layer reads is the core's with the verifier kinds of verifiers.ts (human, judge:n, attest) decided on
 * top, so an attested or judged acceptance can be challenged and struck like any other, and a judge panel is drawn
 * from the same pool of credits as a challenge's. The two are folded together here because both are functions of the
 * whole store: a credit on one problem seats a panel on another.
 *
 * Three more extensions are folded here because each is a move on the same standing or a strike on the same set: the
 * stake rules and locks of QX-15 (stake.ts holds what each rule says), the owner's gold of QX-16 (gold.ts), and
 * QX-17's burn credit and the door's word on a coin lock. challengeLayer reads them in one pass over every problem's
 * receipts, in receipt order, since a lock on one problem and a credit on another are both functions of the whole
 * store. The phases, each marked below where it runs:
 *
 *   1. Every problem reduced by the core, and the verifier kinds decided over it (verifiers.md section 1).
 *   2. The kinds and the credits brought to a fixed point (verifiers.md section 1).
 *   3. The stake rules kept in receipt order (QX-15 section 1; stake.ts).
 *   4. The burns on the coin log credited as standing (QX-17 section 4; standing.ts).
 *   5. The events the layer keeps, read once each in receipt order across every problem: locks (QX-15 section 1),
 *      golds (QX-16 section 1), gold reveals (QX-16 section 3) and challenges with their verdicts (QX-1 sections 3 to
 *      6; against a gold miss, QX-16 section 4).
 *   6. The views a reader is handed, and the admissions the door asks before it takes an event.
 *
 * The record the phases write into, and standing, locked and free over it, are in standing.ts; the draw and the seats
 * both panels share are in sortition.ts.
 */
import {
  type Address, type Event, type Hash, type PieceState, type PieceView, type Receipt, type ReduceInput, type Return, type State,
  byAtThenId, commitHash, eventId, eventSignedByKey, isHash, isRecord, orderReceipts, plusHours, reduce, returnProblems,
} from '@bitquilt/core';
import { type KindInfo, type PanelView, applyVerifiers, leaseOf, ownerOf, panelSeatProblem, rankBodyProblems, rankingProblem, rootFor, viaOf, windowOf } from './verifiers.js';
import { type CoinLockWord, type LockView, checkLock, hasLock, keepStakeRules, lockEnd, lockReleasedAt, liveAt, ruleAt, ruleProblem, stakeAsked } from './stake.js';
import { type GoldCommitment, type GoldCount, type GoldState, type GoldView, checkGold, checkGoldReveal, goldCount, goldMatches, goldOn, missOn, outcomeOf } from './gold.js';
import { type Dropped, type Folding, type ProblemEntry, acceptingRoots, creditBurns, creditedElsewhere, creditedRoots, newFolding, refreshCredits, rootOf } from './standing.js';
import { drawOrder, offerSeats } from './sortition.js';

export { rootFor, acceptingRoots, creditedRoots };
export type { CoinLockWord };
export const EXTENSION = 'QX-1';
export const PANEL = 3;
export const MAJORITY = 2;
export const GROUND_MAX = 200;
export const SEED = 'challenge-receipt';
export const SIDES = ['challenger', 'author'] as const;
export type Side = (typeof SIDES)[number];
export type Outcome = 'open' | 'held' | 'failed' | 'void';
export type LayerState = PieceState | 'challenged' | 'judging';
export const CHALLENGE_EVENTS: ReadonlySet<string> = new Set(['challenge', 'verdict']);

export interface VerdictView { id: Hash; key: Address; root: Address; at: string; for: Side; return: Return | null }
export interface Seat { root: Address; offeredAt: string; lapsedAt: string | null; verdict: VerdictView | null }
export interface ChallengeView {
  id: Hash;
  problem: Hash;
  piece: Hash;
  key: Address;
  root: Address;
  at: string;
  stake: number;
  ground: string;
  /** What is challenged: a piece's acceptance (QX-1), or the gold reveal that struck it (QX-16). */
  against: 'acceptance' | 'gold';
  /** The roots of the accepting set, then the owner; against gold, the owner alone. */
  parties: Address[];
  seed: string | null;
  /** The pool in draw order. */
  order: Address[];
  seats: Seat[];
  outcome: Outcome;
  decidedAt: string | null;
  /** The ids of the accepting set's events, left out of the fold once the challenge held. */
  struck: Hash[];
  /** Verdicts that did not count, with why. */
  dropped: { id: Hash; why: string }[];
}

export interface PieceLayer {
  hash: Hash;
  name: string;
  core: PieceState;
  state: LayerState;
  challenge: ChallengeView | null;
  /** The verifier in words: kind, registry number, strength. */
  kind: KindInfo;
  /** An attest piece accepted on the actor's own record: the square says so. */
  attested: boolean;
  /** The panel sitting or having sat on a judge piece. */
  panel: PanelView | null;
  /** The stake the rule in force asks of this piece at now (QX-15); 0 where none. */
  stake: number;
  /** The piece's gold (QX-16): nothing kept, or where it stands. */
  gold: GoldState;
  /** A square whose accepting set agreed with the owner's gold. */
  verified: boolean;
}

export interface ProblemLayer {
  problem: Hash;
  /** The core's fold, untouched. */
  core: State;
  /** The core's fold with struck events left out and the verifier kinds decided: the same as `core` where nothing was struck and every kind is the core's. */
  fold: State;
  pieces: PieceLayer[];
  byHash: Map<Hash, PieceLayer>;
  challenges: ChallengeView[];
  panels: PanelView[];
  /** Pieces `next` is not to offer here: a judge piece whose panel sits or ran out. */
  unoffered: Set<Hash>;
  dropped: Dropped[];
  /** The stake rule in force at now (QX-15), or null. */
  stake: { min: number; pieces: string[] | null } | null;
  /** Every standing lock on this problem the layer kept, live or not. */
  locks: LockView[];
  /** The owner's golds on this problem (QX-16), as kept. */
  golds: GoldView[];
  /** The gold summed for a reader: how many commitments, and how each stands; which pieces they are on is known only at the reveal. */
  goldCount: GoldCount;
}

export type Admission = { ok: true } | { ok: false; why: string };

export interface Layer {
  /**
   * The time the layer is read at; lapses, windows and liveness are judged against it and every `at` below defaults
   * to it. Roots are resolved at `now`; moves carry the receipt that made them, so standing at an earlier time is
   * unchanged by what is kept later.
   */
  now: string;
  /** Every problem the reader holds, by hash. */
  problems: Map<Hash, ProblemLayer>;
  /** Every problem's, in receipt order. */
  challenges: ChallengeView[];
  /** Every problem's input carries the identity log, so any fold resolves a key; with no problem held, the key is its own root. */
  rootOf(key: Address, at?: string): Address;
  /** A root's standing at a time, `now` when none is given. */
  standing(root: Address, at?: string): number;
  /** Whether a challenge by this key for this stake would count if received now, and why not. */
  admitChallenge(problem: Hash, piece: Hash, key: Address, stake: number): Admission;
  /** Whether a verdict by this key on this challenge would count if received now, and why not. */
  admitVerdict(problem: Hash, piece: Hash, key: Address, challenge: Hash, body: Record<string, unknown>): Admission;
  /** Whether a rank by this key on this judge piece would count if received now, and why not. */
  admitRank(problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission;
  /** QX-15: the sum of a root's live standing locks at a time, `now` when none is given. */
  locked(root: Address, at?: string): number;
  /** QX-15: standing less locked, never below zero. */
  free(root: Address, at?: string): number;
  /** QX-15: a root's locks live at now. */
  liveLocks(root: Address): LockView[];
  /** The same as `liveLocks`, under the name the first readers used. */
  locks(root: Address): LockView[];
  /** Whether a stake rule by this key would count if received now, and why not. */
  admitStakeRule(problem: Hash, key: Address, body: Record<string, unknown>): Admission;
  /** Whether a lock by this key on this piece would count if received now, and why not; a coin-kind lock comes with the word the door read of the coin lock (QX-17). */
  admitLock(problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>, word?: CoinLockWord | null): Admission;
  /** QX-15: when the fold releases a lock, or null while it would be live; forfeits are not judged here. */
  lockEndsAt(lock: LockView): string | null;
  /** Whether a claim, commit, reveal or run by this key on this piece is backed as the piece's stake asks, and why not. */
  admitProduction(problem: Hash, piece: Hash, key: Address): Admission;
  /** The undone pieces of a problem whose stake the key's free standing cannot cover and on which it holds no lock. */
  unaffordable(problem: Hash, key: Address): Set<Hash>;
  /** Whether a gold by this key would be kept whole if received now, and why not (QX-16). */
  admitGold(problem: Hash, key: Address, body: Record<string, unknown>): Admission;
  /** Whether a gold reveal by this key on this piece would count if received now, and why not. */
  admitGoldReveal(problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission;
}

/** The events this layer keeps or drops in receipt order; a verdict is read under its challenge. */
type LayerEventKind = 'challenge' | 'lock' | 'gold' | 'gold_reveal';
const LAYER_EVENT_KINDS: ReadonlySet<string> = new Set<LayerEventKind>(['challenge', 'lock', 'gold', 'gold_reveal']);
interface LayerEvent { id: Hash; kind: LayerEventKind; event: Event; at: string; receipt: Receipt; home: ProblemEntry }
interface Verdict { id: Hash; event: Event; at: string }

/** The states a piece still takes work in (QX-15 section 2): what `unaffordable` measures a key's free standing against. */
const UNDONE: ReadonlySet<string> = new Set(['open', 'in_flight', 'sealed', 'needs_verify', 'disputed']);

/** Why this is not a well-formed challenge body, or nothing. */
export function challengeBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!Number.isInteger(body.stake) || (body.stake as number) < 0) out.push('body.stake: a whole number from 0');
  if (typeof body.ground !== 'string' || !body.ground.trim() || body.ground.length > GROUND_MAX) out.push(`body.ground: a sentence of at most ${GROUND_MAX} characters`);
  return out;
}

/** Why this is not a well-formed verdict body, or nothing. The return is checked against the piece's schema by the fold. */
export function verdictBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!isHash(body.challenge)) out.push('body.challenge: the id of a challenge');
  if (!(SIDES as readonly string[]).includes(body.for as string)) out.push(`body.for: one of ${SIDES.join(', ')}`);
  if (body.return !== undefined && !isRecord(body.return)) out.push('body.return: an object');
  return out;
}

/** The ids of an accepting set's events in the problem's receipts: the reveals with their commits, or the patch's with the runs. */
function setEventIds(v: PieceView, receipts: Receipt[]): Hash[] {
  if (!v.accepting) return [];
  const ordered = orderReceipts(receipts);
  const ids: Hash[] = [];
  const reveal = (key: Address, at: string) => {
    const r = ordered.find((x) => x.receipt.event.type === 'reveal' && x.receipt.event.key === key && x.receipt.event.piece === v.piece.hash && x.at === at);
    if (!r) return;
    ids.push(r.id);
    const b = r.receipt.event.body as { return: unknown; nonce: string };
    const h = commitHash(b.return, b.nonce);
    const c = ordered.find((x) => x.receipt.event.type === 'commit' && x.receipt.event.key === key && x.receipt.event.piece === v.piece.hash && (x.receipt.event.body as { h: Hash }).h === h);
    if (c) ids.push(c.id);
  };
  if (v.accepting.kind === 'agree') for (const r of v.accepting.reveals) reveal(r.key, r.at);
  else {
    reveal(v.accepting.patch.key, v.accepting.patch.at);
    for (const run of v.accepting.runs) {
      const x = ordered.find((y) => y.receipt.event.type === 'run' && y.receipt.event.key === run.key && y.receipt.event.piece === v.piece.hash && y.at === run.at);
      if (x) ids.push(x.id);
    }
  }
  return ids;
}

// The pools

/** The pool a judge panel is drawn from (verifiers.md): roots credited on another problem at the time, unrelated to the piece's parties. */
function judgePool(f: Folding, problem: Hash, at: string, unrelatedTo: Address[], fold: State): Address[] {
  return [...creditedElsewhere(f, problem, at)].filter((r) => !unrelatedTo.some((u) => fold.related(r, u, at)));
}

/** The pool a challenge's panel is drawn from (QX-1 section 3): roots credited elsewhere, unrelated to the challenger, to each party, and to anyone with a reveal or a run on the piece. */
function poolFor(f: Folding, home: ProblemEntry, view: PieceView, challenger: Address, parties: Address[], at: string): Address[] {
  const fold = home.fold;
  const out: Address[] = [];
  for (const r of creditedElsewhere(f, home.hash, at)) {
    if (fold.related(r, challenger, at)) continue;
    if (parties.some((p) => fold.related(r, p, at))) continue;
    if (view.reveals.some((x) => fold.related(x.root, r, at)) || view.runs.some((x) => fold.related(x.root, r, at))) continue;
    out.push(r);
  }
  return out;
}

// The fold

/** The verifier kinds decided over an entry's base fold, with the pool as the credits stand. */
function refold(f: Folding, e: ProblemEntry): void {
  e.layered = applyVerifiers(e.base, e.input.receipts.filter((x) => !e.struck.has(eventId(x.event))), f.now, { pool: (problem, at, unrelatedTo, fold) => judgePool(f, problem, at, unrelatedTo, fold) });
  e.fold = e.layered.fold;
}

/** Reduces an entry again without its struck events and decides the kinds again over what remains. */
function rereduce(f: Folding, e: ProblemEntry): void {
  e.base = reduce({ ...e.input, receipts: e.input.receipts.filter((x) => !e.struck.has(eventId(x.event))) });
  refold(f, e);
}

/**
 * Strikes a piece's accepting set at `d`, as QX-1 section 6 says: the roots docked and their points withdrawn, their
 * locks forfeited (QX-15 section 3), the events left out and every fold that carried them redone.
 */
function strike(f: Folding, home: ProblemEntry, view: PieceView, d: string, lease: number): { ids: Hash[]; roots: Address[] } {
  for (const p of creditedRoots(view)) {
    const root = home.fold.rootOf(p, f.now);
    f.moves.push({ root, at: d, delta: -1 });
    f.struckCredits.push({ root, problem: home.hash, at: view.accepting!.completedAt, until: d });
  }
  const roots: Address[] = [];
  for (const p of acceptingRoots(view)) {
    const root = home.fold.rootOf(p, f.now);
    roots.push(root);
    for (const l of f.locks) {
      if (l.problem !== home.hash || l.piece !== view.piece.hash || l.root !== root || l.at > d) continue;
      if (l.forfeitedAt !== null && (l.restoredAt === null || l.restoredAt > d)) continue;
      const end = lockReleasedAt(l, view, lease, home.fold.related, d);
      if (end !== null && end <= d) continue;
      l.forfeitedAt = d;
      l.restoredAt = null;
      if (l.kind === 'standing') f.moves.push({ root, at: d, delta: -l.amount });
    }
  }
  const ids = setEventIds(view, home.input.receipts);
  const struck = new Set(ids);
  for (const e of f.entries.values()) {
    if (!e.input.receipts.some((x) => struck.has(eventId(x.event)))) continue;
    for (const id of struck) e.struck.add(id);
    rereduce(f, e);
  }
  refreshCredits(f);
  return { ids, roots };
}

/** Undoes a miss's strike at `d` (QX-16 section 4): the events return to the fold, and each struck root regains from `d` the point docked, its point for the set and its lock. */
function unstrike(f: Folding, home: ProblemEntry, c: GoldCommitment, d: string): void {
  const struck = new Set(c.struck);
  for (const e of f.entries.values()) {
    if (![...struck].some((id) => e.struck.has(id))) continue;
    for (const id of struck) e.struck.delete(id);
    rereduce(f, e);
  }
  refreshCredits(f);
  const piece = c.piece!;
  const view = home.fold.byHash.get(piece);
  const credited = view?.accepting ? creditedRoots(view).map((p) => home.fold.rootOf(p, f.now)) : [];
  for (const root of c.struckRoots) {
    if (credited.includes(root)) f.moves.push({ root, at: d, delta: 2 });
    for (const l of f.locks) {
      if (l.problem !== home.hash || l.piece !== piece || l.root !== root || l.forfeitedAt !== c.revealedAt || l.restoredAt !== null) continue;
      l.restoredAt = d;
      if (l.kind === 'standing') f.moves.push({ root, at: d, delta: l.amount });
    }
  }
}

/** Why a root's free standing does not cover a stake at `at`, naming the lock where one is the reason; null when it does. */
function stakeShort(f: Folding, root: Address, stake: number, at: string): string | null {
  const s = f.standing(root, at);
  const l = f.locked(root, at);
  const free = Math.max(0, s - l);
  if (free >= stake) return null;
  return l > 0 ? `free standing ${free} is below the stake of ${stake}` : `standing ${s} is below the stake of ${stake}`;
}

type ChallengeCheck =
  | { ok: true; root: Address; view: PieceView; parties: Address[]; pool: Address[]; gold: GoldView | null; commitment: GoldCommitment | null }
  | { ok: false; why: string };

/**
 * Whether a challenge would be kept if received at `at`, and why not: QX-1 section 1 against an acceptance; QX-16
 * section 4 against a gold miss, from a struck root, for a stake of 0 or more.
 */
function checkChallenge(f: Folding, home: ProblemEntry, piece: Hash, key: Address, stake: number, at: string): ChallengeCheck {
  const fold = home.fold;
  const view = fold.byHash.get(piece);
  if (!view) return { ok: false, why: 'names a piece this problem does not have' };
  const root = rootFor(fold, key, 'challenge', at);
  if (!root) return { ok: false, why: 'the key may not sign a challenge' };
  const prior = home.challenges.filter((c) => c.piece === piece);
  if (prior.some((c) => c.outcome === 'held')) return { ok: false, why: 'this piece has had its challenge' };
  const open = prior.some((c) => c.outcome === 'open' || (c.decidedAt !== null && c.decidedAt > at));
  // QX-16 section 4: a miss on the piece inside its window is challenged by a root of the struck set, against the gold.
  // The stake may be 0: the strike may have left the root with nothing (amended 27 October 2026).
  const miss = missOn(home, piece);
  if (!view.accepting && miss) {
    if (open) return { ok: false, why: 'a challenge is open on this piece' };
    if (at >= plusHours(miss.commitment.revealedAt!, windowOf(fold))) return { ok: false, why: 'outside the window' };
    if (!miss.commitment.struckRoots.includes(root)) return { ok: false, why: 'only a root of the struck set challenges a miss' };
    const parties = [ownerOf(fold, at)];
    const short = stakeShort(f, root, stake, at);
    if (short) return { ok: false, why: short };
    const pool = poolFor(f, home, view, root, parties, at).filter((r) => !miss.commitment.struckRoots.includes(r));
    return { ok: true, root, view, parties, pool, gold: miss.gold, commitment: miss.commitment };
  }
  if (!view.accepting || view.accepting.completedAt > at) return { ok: false, why: 'nothing accepted on this piece yet' };
  if (view.windowEnd === null || at >= view.windowEnd) return { ok: false, why: 'outside the window' };
  if (open) return { ok: false, why: 'a challenge is open on this piece' };
  const parties = [...acceptingRoots(view), fold.envelope.problem.owner as Address];
  if (parties.some((p) => fold.related(p, root, at))) return { ok: false, why: 'a party to the acceptance cannot challenge it' };
  if (stake < 1) return { ok: false, why: 'a challenge on an acceptance stakes at least 1' };
  // QX-15 section 3: standing locked behind a claim is not staked again on a challenge.
  const short = stakeShort(f, root, stake, at);
  if (short) return { ok: false, why: short };
  return { ok: true, root, view, parties, pool: poolFor(f, home, view, root, parties, at), gold: null, commitment: null };
}

/** Why an event is not this layer's to keep: it names another problem, names a piece or not as its kind asks, or its signature is not the key's; null when it is. */
function misnamed(ev: Event, home: ProblemEntry, { piece }: { piece: boolean }): string | null {
  if (ev.problem !== home.hash || (piece ? !ev.piece : ev.piece !== undefined)) return piece ? 'names a problem or piece this layer does not hold' : 'names a problem this layer does not hold, or a piece';
  if (!eventSignedByKey(ev)) return 'signature is not the key\'s';
  return null;
}

function drop(c: LayerEvent, why: string): void {
  c.home.dropped.push({ id: c.id, type: c.kind, why });
}

/** QX-15 section 1: a lock is kept or dropped at its receipt, against the free standing and the rule in force then. */
function keepLock(f: Folding, c: LayerEvent): void {
  const { event: ev, at, home } = c;
  const why = misnamed(ev, home, { piece: true });
  if (why) return drop(c, why);
  const word = (c.receipt.received[0] as { stake?: CoinLockWord } | undefined)?.stake ?? null;
  const r = checkLock(f, home, ev.piece!, ev.key, ev.body, at, word);
  if (!r.ok) return drop(c, r.why);
  const coin = ev.body.kind === 'coin';
  f.locks.push({ id: c.id, problem: home.hash, piece: ev.piece!, name: r.view.piece.name, key: ev.key, root: r.root, at, kind: coin ? 'coin' : 'standing', amount: ev.body.amount as number, coinId: coin ? (ev.body.id as Hash) : null, forfeitedAt: null, restoredAt: null });
}

/** QX-16 section 1: the owner's blind commitments, kept at their receipt against the owner's free standing then; the pieces are named at the reveals. */
function keepGold(f: Folding, c: LayerEvent): void {
  const { event: ev, at, home } = c;
  const why = misnamed(ev, home, { piece: false });
  if (why) return drop(c, why);
  const r = checkGold(f, home, ev.key, ev.body, at);
  if (!r.ok) return drop(c, r.why);
  const g: GoldView = { id: c.id, problem: home.hash, key: ev.key, root: r.root, at, stake: ev.body.stake as number, commitments: r.kept, forfeitedAt: null };
  f.golds.push(g);
  home.golds.push(g);
}

/** QX-16 section 3: the owner's reveal decides the piece at its receipt: a match verifies, a miss strikes. */
function keepGoldReveal(f: Folding, c: LayerEvent): void {
  const { event: ev, at, home } = c;
  const why = misnamed(ev, home, { piece: true });
  if (why) return drop(c, why);
  const r = checkGoldReveal(home, ev.piece!, ev.key, ev.body, at);
  if (!r.ok) return drop(c, r.why);
  const projection = ev.body.projection as Record<string, unknown>;
  r.commitment.piece = ev.piece!;
  r.commitment.name = r.view.piece.name;
  r.commitment.revealedAt = at;
  r.commitment.projection = projection;
  if (goldMatches(r.view, projection)) r.commitment.outcome = 'match';
  else {
    r.commitment.outcome = 'miss';
    const s = strike(f, home, r.view, at, leaseOf(home.fold, r.view));
    r.commitment.struck = s.ids;
    r.commitment.struckRoots = s.roots;
  }
}

/**
 * QX-1 sections 3 to 6: a challenge kept at its receipt seats its panel from the pool then and folds its verdicts; held,
 * it strikes the set, or against a gold miss undoes the miss's strike and forfeits the gold (QX-16 section 4); failed,
 * it costs the challenger the stake.
 */
function keepChallenge(f: Folding, c: LayerEvent, verdicts: Verdict[]): void {
  const { event: ev, at, home } = c;
  const why = misnamed(ev, home, { piece: true });
  if (why) return drop(c, why);
  const shape = challengeBodyProblems(ev.body);
  if (shape.length) return drop(c, shape[0]!);
  const stake = ev.body.stake as number;
  const r = checkChallenge(f, home, ev.piece!, ev.key, stake, at);
  if (!r.ok) return drop(c, r.why);
  const view = r.view;
  const seed = c.receipt.hash ?? null;
  const challenge: ChallengeView = {
    id: c.id, problem: home.hash, piece: ev.piece!, key: ev.key, root: r.root, at, stake, ground: ev.body.ground as string, against: r.gold ? 'gold' : 'acceptance',
    parties: r.parties, seed, order: [], seats: [], outcome: 'open', decidedAt: null, struck: [], dropped: [],
  };
  home.challenges.push(challenge);
  if (r.pool.length < PANEL) {
    challenge.outcome = 'void';
    challenge.decidedAt = at;
    return;
  }
  if (seed === null) return;
  challenge.order = drawOrder(seed, r.pool);
  const lease = leaseOf(home.fold, view);
  seat(challenge, home.fold, view, lease, verdicts, f.now);
  if (challenge.outcome === 'held') {
    const d = challenge.decidedAt!;
    f.moves.push({ root: challenge.root, at: d, delta: stake });
    if (r.gold && r.commitment) {
      // QX-16 section 4: the gold was wrong. The strike is undone, the owner's stake is forfeited whole, and the rest of the gold is dropped.
      unstrike(f, home, r.commitment, d);
      r.commitment.outcome = 'overruled';
      r.gold.forfeitedAt = d;
      f.moves.push({ root: r.gold.root, at: d, delta: -r.gold.stake });
      for (const other of r.gold.commitments) if (other.outcome === 'pending') other.outcome = 'dropped';
    } else {
      challenge.struck = strike(f, home, view, d, lease).ids;
    }
  } else if (challenge.outcome === 'failed') {
    f.moves.push({ root: challenge.root, at: challenge.decidedAt!, delta: -stake });
  }
}

/**
 * The layer over every problem a reader holds, at `now`: the time lapses, windows and liveness are judged at; roots are
 * resolved at `now` throughout, moves are dated at the receipts that made them. `coin` is the coin log's receipts, read
 * for burn credits (QX-17 section 4).
 */
export function challengeLayer(input: { problems: ReduceInput[]; now: string; coin?: Receipt[]; founding?: Map<string, number> }): Layer {
  const { now } = input;
  const f = newFolding(now, input.founding);

  // 1. Every problem reduced by the core, once each by hash, and the kinds decided over it with no credits yet.
  for (const p of input.problems) {
    const core = reduce(p);
    if (f.entries.has(core.problem)) continue;
    const layered = applyVerifiers(core, p.receipts, now, { pool: () => [] });
    f.entries.set(core.problem, { hash: core.problem, input: p, core, base: core, fold: layered.fold, layered, struck: new Set(), challenges: [], dropped: [], rules: [], golds: [] });
  }

  // 2. The kinds and the credits to a fixed point (verifiers.md section 1): a judge panel's pool is the credits on other
  // problems, and a judged acceptance is itself a credit, so the credits are refreshed and the kinds decided again
  // until nothing moves; four passes at most.
  let fingerprint = '';
  for (let pass = 0; ; pass++) {
    refreshCredits(f);
    const next = [...f.entries.values()].map((e) => `${e.fold.pieces.map((v) => v.state).join(',')}|${e.layered.panels.map((p) => `${p.piece}:${p.outcome}:${p.seats.map((s) => s.root).join('.')}`).join(';')}`).join('/');
    if (next === fingerprint || pass === 3) break;
    fingerprint = next;
    for (const e of f.entries.values()) refold(f, e);
  }
  // A strike below refolds the problems it touches and refreshes the credits without running the fixed point again: a
  // struck credit keeps its `until`, so a panel drawn before the strike keeps its pool (verifiers.md section 6), and a
  // panel drawn after it draws from what remains.

  // 3. The stake rules each problem's owner set (QX-15 section 1).
  keepStakeRules(f);

  // 4. The burns on the coin log, credited as standing (QX-17 section 4).
  creditBurns(f, input.coin ?? []);

  // 5. The events this layer keeps or drops, once each by id across every problem, in receipt order; a verdict is read
  // under its challenge.
  const events = new Map<Hash, LayerEvent>();
  const verdicts = new Map<Hash, Verdict[]>();
  for (const e of f.entries.values()) for (const { receipt, at, id } of orderReceipts(e.input.receipts)) {
    const ev = receipt.event;
    if (LAYER_EVENT_KINDS.has(ev.type)) {
      if (events.has(id)) continue;
      const home = (ev.problem && f.entries.get(ev.problem)) || e;
      events.set(id, { id, kind: ev.type as LayerEventKind, event: ev, at, receipt, home });
    } else if (ev.type === 'verdict') {
      const of = (ev.body as { challenge?: unknown }).challenge;
      if (!isHash(of)) continue;
      const list = verdicts.get(of) ?? [];
      if (list.some((v) => v.id === id)) continue;
      list.push({ id, event: ev, at });
      verdicts.set(of, list);
    }
  }
  for (const c of [...events.values()].sort(byAtThenId)) {
    switch (c.kind) {
      case 'lock':
        keepLock(f, c);
        break;
      case 'gold':
        keepGold(f, c);
        break;
      case 'gold_reveal':
        keepGoldReveal(f, c);
        break;
      case 'challenge':
        keepChallenge(f, c, (verdicts.get(c.id) ?? []).sort(byAtThenId));
        break;
    }
  }

  // 6. The views.
  const problems = new Map<Hash, ProblemLayer>();
  const all: ChallengeView[] = [];
  for (const e of f.entries.values()) {
    const pieces: PieceLayer[] = e.fold.pieces.map((v) => {
      const own = e.challenges.filter((c) => c.piece === v.piece.hash);
      const last = own.length ? own[own.length - 1]! : null;
      const core = e.core.byHash.get(v.piece.hash)?.state ?? v.state;
      const state: LayerState = last?.outcome === 'open' ? 'challenged' : v.state;
      const kind = e.layered.kinds.get(v.piece.hash)!;
      const commitment = goldOn(e, v.piece.hash);
      const gold = commitment ? (outcomeOf(e, commitment, now) as GoldState) : null;
      return { hash: v.piece.hash, name: v.piece.name, core, state, challenge: last, kind, attested: viaOf(v.accepting) === 'attest', panel: e.layered.byPiece.get(v.piece.hash) ?? null, stake: stakeAsked(ruleAt(e, now), v.piece), gold, verified: gold === 'match' };
    });
    const rule = ruleAt(e, now);
    problems.set(e.hash, {
      problem: e.hash, core: e.core, fold: e.fold, pieces, byHash: new Map(pieces.map((p) => [p.hash, p])), challenges: e.challenges,
      panels: e.layered.panels, unoffered: e.layered.unoffered, dropped: [...e.dropped, ...e.layered.dropped],
      stake: rule ? { min: rule.min, pieces: rule.pieces } : null, locks: f.locks.filter((l) => l.problem === e.hash), golds: e.golds, goldCount: goldCount(e.golds, (_g, c) => outcomeOf(e, c, now)),
    });
    all.push(...e.challenges);
  }
  all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  // The admissions: what the door asks before it takes an event, each the check the fold would make at now.
  const admitChallenge = (problem: Hash, piece: Hash, key: Address, stake: number): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkChallenge(f, home, piece, key, stake, now);
    if (!r.ok) return r;
    if (r.pool.length < PANEL) return { ok: false, why: `no panel can be seated: ${r.pool.length} root${r.pool.length === 1 ? '' : 's'} with an accepted return on another problem, ${PANEL} needed` };
    return { ok: true };
  };
  const admitVerdict = (problem: Hash, piece: Hash, key: Address, id: Hash, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const challenge = home.challenges.find((c) => c.id === id && c.piece === piece);
    if (!challenge || challenge.outcome !== 'open') return { ok: false, why: 'names no open challenge on this piece' };
    const root = rootFor(home.fold, key, 'verdict', now);
    if (!root) return { ok: false, why: 'the key may not sign a verdict' };
    const why = seatProblem(challenge, root);
    if (why) return { ok: false, why };
    const view = home.fold.byHash.get(piece)!;
    const rp = returnProblem(view, body.return);
    return rp ? { ok: false, why: rp } : { ok: true };
  };
  const admitRank = (problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    if (!home.fold.byHash.has(piece)) return { ok: false, why: 'names a piece this problem does not have' };
    const shape = rankBodyProblems(body);
    if (shape.length) return { ok: false, why: shape[0]! };
    const panel = home.layered.byPiece.get(piece);
    if (!panel) return { ok: false, why: home.layered.kinds.get(piece)?.kind === 'judge' ? 'the candidates for this piece are not in yet' : 'no panel sits on this piece' };
    if (panel.outcome === 'decided') return { ok: false, why: 'the panel has decided' };
    if (panel.outcome === 'void') return { ok: false, why: 'the panel ran out' };
    if (panel.seats.length === 0) return { ok: false, why: 'no seats drawn yet' };
    const root = rootFor(home.fold, key, 'rank', now);
    if (!root) return { ok: false, why: 'the key may not sign a rank' };
    const why = panelSeatProblem(panel, root);
    if (why) return { ok: false, why };
    const rp = rankingProblem(panel, body.ranking);
    return rp ? { ok: false, why: rp } : { ok: true };
  };
  const admitStakeRule = (problem: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const why = ruleProblem(home, key, body, now);
    return why ? { ok: false, why } : { ok: true };
  };
  const admitLock = (problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>, word: CoinLockWord | null = null): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkLock(f, home, piece, key, body, now, word);
    return r.ok ? { ok: true } : r;
  };
  const admitProduction = (problem: Hash, piece: Hash, key: Address): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const view = home.fold.byHash.get(piece);
    if (!view) return { ok: false, why: 'names a piece this problem does not have' };
    const asked = stakeAsked(ruleAt(home, now), view.piece);
    if (asked === 0 || hasLock(f, home, piece, home.fold.rootOf(key, now), now)) return { ok: true };
    return { ok: false, why: `this piece asks for a stake of ${asked}; lock first` };
  };
  const unaffordable = (problem: Hash, key: Address): Set<Hash> => {
    const out = new Set<Hash>();
    const home = f.entries.get(problem);
    const pl = problems.get(problem);
    if (!home || !pl) return out;
    const root = home.fold.rootOf(key, now);
    const free = f.free(root, now);
    for (const p of pl.pieces) if (UNDONE.has(p.state) && p.stake > free && !hasLock(f, home, p.hash, root, now)) out.add(p.hash);
    return out;
  };
  const liveLocks = (root: Address): LockView[] => f.locks.filter((l) => l.root === root && liveAt(f, l, now));
  const admitGold = (problem: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkGold(f, home, key, body, now);
    return r.ok ? { ok: true } : r;
  };
  const admitGoldReveal = (problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = f.entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkGoldReveal(home, piece, key, body, now);
    return r.ok ? { ok: true } : r;
  };

  return {
    now, problems, challenges: all, rootOf: (key, at = now) => rootOf(f, key, at), standing: f.standing, admitChallenge, admitVerdict, admitRank, locked: f.locked, free: f.free, liveLocks, locks: liveLocks,
    admitStakeRule, admitLock, lockEndsAt: (l) => lockEnd(f, l), admitProduction, unaffordable, admitGold, admitGoldReveal,
  };
}

/** Why a root has no live seat on a challenge, or null when it has one. */
function seatProblem(challenge: ChallengeView, root: Address): string | null {
  const seats = challenge.seats.filter((s) => s.root === root);
  if (seats.length === 0) return 'not a judge drawn for this challenge';
  if (seats.some((s) => s.verdict)) return 'this judge has answered';
  if (seats.every((s) => s.lapsedAt !== null)) return 'this seat lapsed';
  return null;
}

/** Why a verdict's return does not fit the piece, or null. */
function returnProblem(view: PieceView, ret: unknown): string | null {
  if (ret === undefined) return null;
  if (!isRecord(ret)) return 'body.return: an object';
  if (!view.piece.schema) return 'a verdict on a check or score piece carries no return';
  const rp = returnProblems(view.piece.schema, ret);
  return rp.length ? rp[0]! : null;
}

/** Offers the seats, lapses and replaces them by the lease (sortition.ts), folds the verdicts in receipt order, and decides on a majority. */
function seat(challenge: ChallengeView, fold: State, view: PieceView, leaseH: number, verdicts: Verdict[], now: string): void {
  const { seats, advance, ranOut, lastLapse } = offerSeats<Seat>(challenge.order, PANEL, challenge.at, leaseH, (root, offeredAt) => ({ root, offeredAt, lapsedAt: null, verdict: null }), (s) => s.verdict !== null);
  challenge.seats = seats;
  const tally: Record<Side, number> = { challenger: 0, author: 0 };
  for (const v of verdicts) {
    const dropVerdict = (why: string) => challenge.dropped.push({ id: v.id, why });
    if (challenge.outcome !== 'open') {
      dropVerdict('the challenge was decided');
      continue;
    }
    const ev = v.event;
    if (ev.problem !== challenge.problem || ev.piece !== challenge.piece) {
      dropVerdict('names another problem or piece than its challenge');
      continue;
    }
    if (!eventSignedByKey(ev)) {
      dropVerdict('signature is not the key\'s');
      continue;
    }
    const shape = verdictBodyProblems(ev.body);
    if (shape.length) {
      dropVerdict(shape[0]!);
      continue;
    }
    advance(v.at);
    const root = rootFor(fold, ev.key, 'verdict', v.at);
    if (!root) {
      dropVerdict('the key may not sign a verdict');
      continue;
    }
    const why = seatProblem(challenge, root);
    if (why) {
      dropVerdict(why);
      continue;
    }
    const rp = returnProblem(view, ev.body.return);
    if (rp) {
      dropVerdict(rp);
      continue;
    }
    const side = ev.body.for as Side;
    const open = seats.find((s) => s.root === root && s.lapsedAt === null && !s.verdict)!;
    open.verdict = { id: v.id, key: ev.key, root, at: v.at, for: side, return: (ev.body.return as Return | undefined) ?? null };
    tally[side]++;
    if (tally[side] >= MAJORITY) {
      challenge.outcome = side === 'challenger' ? 'held' : 'failed';
      challenge.decidedAt = v.at;
    }
  }
  if (challenge.outcome === 'open') {
    advance(now);
    if (ranOut()) {
      challenge.outcome = 'void';
      challenge.decidedAt = lastLapse() ?? now;
    }
  }
}
