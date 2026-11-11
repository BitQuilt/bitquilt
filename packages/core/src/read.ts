/**
 * The read of reading 2 (docs/v2/READING.md section 1): `read` takes every problem a reader holds and the time, and
 * answers the views, standing over them, and the record the fold wrote into. It reads no clock, network or file, and
 * a tracker, a keeper and a client that hold the same ledger are handed the same state.
 *
 * It began as the challenge window, extension QX-1 (docs/ext/QX-1.md), a layer over version 1's fold. A root with
 * standing may challenge a provisional acceptance inside its window; a panel of three is drawn by sortition from roots
 * with an accepted return on another problem, seeded by the challenge's own chained receipt line, which no party makes
 * alone; two verdicts decide. A held challenge strikes the accepting set's events, and the reducer, run again without
 * them, says what the piece is now; a failed one costs the challenger the stake. Version 1's state is a coarsening of
 * this one: where this says `challenged`, version 1 says accepted within its window.
 *
 * The fold this pass reads is version 1's with the verifier kinds of `kinds.ts` (human, judge:n, attest) decided on
 * top, so an attested or judged acceptance can be challenged and struck like any other, and a judge panel is drawn
 * from the same pool of credits as a challenge's. The two are folded together because both are functions of the whole
 * ledger: a credit on one problem seats a panel on another.
 *
 * Three more extensions are folded here because each is a move on the same standing or a strike on the same set: the
 * stake rules and locks of QX-15 (`stake.ts` holds what each rule says), the owner's gold of QX-16 (`gold.ts`), and
 * QX-17's burn credit and the door's word on a coin lock. `read` takes them in one pass over every problem's receipts,
 * in receipt order, since a lock on one problem and a credit on another are both functions of the whole ledger. Before
 * them it sets aside, in a dispute, a reading that rests on nothing where the other rests on the record
 * (QX-19 section 4; `trace.ts` says what a reading rests on), so the piece is folded without it.
 *
 * The steps are the eight of the reading, docs/v2/READING.md sections 2 to 9, numbered as its sections are and marked
 * below where each runs:
 *
 *   2. The check, and the line: every problem reduced once by the core, which checks its envelopes, blobs, signatures
 *      and chain, and a problem the core refuses left out with the core's reason (`foldProblems`).
 *   3. The record: each problem's events in order on its pieces, as the reducer folds them, with the kinds' first
 *      word on them and no panel drawn yet (`foldProblems`; verifiers.md section 1).
 *   4. The grounds: in a dispute, a reading that rests on nothing set aside (QX-19 section 4; trace.ts), before the
 *      sets, so the reading that takes its place counts toward one, and again after them where a set opened a piece
 *      that waited on it.
 *   5. The sets: each kind's rule read over the record (verifiers.md section 1; kinds.ts), brought to a fixed point
 *      with the credits of step 6, since a panel is drawn by standing and a panel's ranking makes a set
 *      (`setsAndStanding`).
 *   6. Standing: a credit for each reveal in a set (QX-1 section 2; standing.ts), and the burns on the coin log
 *      credited (QX-17 section 4).
 *   7. The decisions: the stake rules kept in receipt order (QX-15 section 1; stake.ts), then the events the pass
 *      keeps, read once each in receipt order across every problem (`decide`): locks (QX-15 section 1), golds
 *      (QX-16 section 1), gold reveals (QX-16 section 3) and challenges with their verdicts
 *      (QX-1 sections 3 to 6; against a gold miss, QX-16 section 4).
 *   8. The reach, after everything that moves standing, a lock or a strike: what each fork reaches, the pieces done
 *      elsewhere, what waits on them settled again, and the inherited squares marked
 *      (QX-23 sections 1 to 3; inherit.ts).
 *   9. The state: the views a reader is handed (`stateOf`; layer.ts), with the record the steps wrote into
 *      (standing.ts).
 *
 * Where the reading departs from what this pass does, its section 12 says so, and each departure waits to be argued
 * with a fixture: a record here is a problem's own, read with its ancestors', and not yet a line's.
 *
 * What a door asks before it takes an event, the admissions, is no part of the read: a tracker builds them over the
 * record this answers with. The pass moved here from the tracker's layer as docs/history/V2-PLAN.md, phase 3, says,
 * in the seven phases it had there, and was laid out in the reading's steps after, the grounds before the sets. In
 * those phases the grounds came after the fixed point, which was not run again: a set made by the reading that took a
 * set-aside one's place was credited too late to seat a panel on another problem.
 */
import { type ChallengeView, type LayerState, SIDES, type Seat, type Side } from './challenge.js';
import { problemHash } from './envelope.js';
import { type Event, type Receipt, eventId, eventSignedByKey } from './events.js';
import {
  type GoldCommitment,
  type GoldState,
  type GoldView,
  checkGold,
  checkGoldReveal,
  goldCount,
  goldMatches,
  goldOn,
  missOn,
  outcomeOf,
} from './gold.js';
import { type Hash, isHash } from './hash.js';
import { completeInLayer, inheritSquares } from './inherit.js';
import type { Address } from './keys.js';
import { applyVerifiers, leaseOf, ownerOf, rootFor, settleKinds, viaOf, windowOf } from './kinds.js';
import type { LayerViews, PieceLayer, ProblemLayer } from './layer.js';
import { byAtThenId, isRecord, plusHours } from './plain.js';
import { type PieceView, type ReduceInput, type Reveal, type State, orderReceipts, reduce } from './reduce.js';
import { type Return, returnProblems } from './schema.js';
import { drawOrder, offerSeats } from './sortition.js';
import { type CoinLockWord, checkLock, keepStakeRules, lockReleasedAt, ruleAt, stakeAsked } from './stake.js';
import {
  type Folding,
  type ProblemEntry,
  acceptingRoots,
  creditBurns,
  creditedElsewhere,
  creditedReveals,
  creditedRoots,
  lineOf,
  newFolding,
  refreshCredits,
  rootOf,
} from './standing.js';
import { pieceTraces } from './trace.js';

export const CHALLENGE = 'QX-1';
export const PANEL = 3;
export const MAJORITY = 2;
export const GROUND_MAX = 200;
/** The seed a challenge panel is drawn from, named for the well-known document: the receipt line of the challenge. */
export const CHALLENGE_SEED = 'challenge-receipt';

/** The events this layer keeps or drops in receipt order; a verdict is read under its challenge. */
type LayerEventKind = 'challenge' | 'lock' | 'gold' | 'gold_reveal';
const LAYER_EVENT_KINDS: ReadonlySet<string> = new Set<LayerEventKind>(['challenge', 'lock', 'gold', 'gold_reveal']);
interface LayerEvent {
  id: Hash;
  kind: LayerEventKind;
  event: Event;
  at: string;
  receipt: Receipt;
  home: ProblemEntry;
}
interface Verdict {
  id: Hash;
  event: Event;
  at: string;
}

/** Why this is not a well-formed challenge body, or nothing. */
export function challengeBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!Number.isInteger(body.stake) || (body.stake as number) < 0) out.push('body.stake: a whole number from 0');
  if (typeof body.ground !== 'string' || !body.ground.trim() || body.ground.length > GROUND_MAX)
    out.push(`body.ground: a sentence of at most ${GROUND_MAX} characters`);
  return out;
}

/**
 * Why this is not a well-formed verdict body, or nothing. The return is checked against the piece's schema by the fold.
 */
export function verdictBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!isHash(body.challenge)) out.push('body.challenge: the id of a challenge');
  if (!(SIDES as readonly string[]).includes(body.for as string)) out.push(`body.for: one of ${SIDES.join(', ')}`);
  if (body.return !== undefined && !isRecord(body.return)) out.push('body.return: an object');
  return out;
}

/**
 * The ids of the events a strike leaves out of the fold: the set's reveals, each with the commit it opened, or the
 * patch's with the runs. The fold keeps each event's id on its view, so the point a strike withdraws is the point the
 * reveal earned.
 */
function setEventIds(v: PieceView): Hash[] {
  if (!v.accepting) return [];
  const opened = (r: Reveal) => [r.id, r.commit];
  if (v.accepting.kind === 'agree') return v.accepting.reveals.flatMap(opened);
  return [...opened(v.accepting.patch), ...v.accepting.runs.map((r) => r.id)];
}

// The pools

/**
 * The pool a judge panel is drawn from (verifiers.md): roots credited on another problem at the time, unrelated to the
 * piece's parties.
 */
function judgePool(f: Folding, problem: Hash, at: string, unrelatedTo: Address[], fold: State): Address[] {
  return [...creditedElsewhere(f, problem, at)].filter((r) => !unrelatedTo.some((u) => fold.related(r, u, at)));
}

/**
 * The pool a challenge's panel is drawn from (QX-1 section 3): roots credited elsewhere, unrelated to the challenger,
 * to each party, and to anyone with a reveal or a run on the piece.
 */
function poolFor(
  f: Folding,
  home: ProblemEntry,
  view: PieceView,
  challenger: Address,
  parties: Address[],
  at: string,
): Address[] {
  const fold = home.fold;
  const out: Address[] = [];
  for (const r of creditedElsewhere(f, home.hash, at)) {
    if (fold.related(r, challenger, at)) continue;
    if (parties.some((p) => fold.related(r, p, at))) continue;
    if (view.reveals.some((x) => fold.related(x.root, r, at)) || view.runs.some((x) => fold.related(x.root, r, at)))
      continue;
    out.push(r);
  }
  return out;
}

// The fold

/** The verifier kinds decided over an entry's base fold, with the pool as the credits stand. */
function refold(f: Folding, e: ProblemEntry): void {
  e.decided = applyVerifiers(
    e.base,
    e.input.receipts.filter((x) => !e.struck.has(eventId(x.event))),
    f.now,
    { pool: (problem, at, unrelatedTo, fold) => judgePool(f, problem, at, unrelatedTo, fold) },
  );
  e.fold = e.decided.fold;
}

/** Reduces an entry again without its struck events and decides the kinds again over what remains. */
function rereduce(f: Folding, e: ProblemEntry): void {
  e.base = reduce({ ...e.input, receipts: e.input.receipts.filter((x) => !e.struck.has(eventId(x.event))) });
  refold(f, e);
}

/** The problems whose input holds any of these events: every version that carried the set they made. */
function carriersOf(f: Folding, ids: readonly Hash[]): Set<Hash> {
  const of = new Set(ids);
  const out = new Set<Hash>();
  for (const e of f.entries.values()) if (e.input.receipts.some((x) => of.has(eventId(x.event)))) out.add(e.hash);
  return out;
}

/**
 * Strikes a piece's accepting set at `d`, as QX-1 section 6 says: the roots docked and their points withdrawn, their
 * locks forfeited (QX-15 section 3), the events left out and every fold that carried them redone. QX-1 section 2 as
 * amended 10 November 2026: "A held challenge at any version strikes the set's events from the fold of every version
 * that holds them. Each root of the set loses one and its point for the set, once, and a lock behind the set
 * (QX-15 section 3) is forfeited whichever version it was made at." So each credited root is docked once, the live
 * credit for its reveal is withdrawn from `d`, and the locks forfeited are those at every problem that carried the
 * set's events. Where the reveal's point was withdrawn by an earlier strike and given back as a move by an unstrike
 * (QX-16 section 4), that point is withdrawn as a move, so nothing is credited twice.
 */
function strike(
  f: Folding,
  home: ProblemEntry,
  view: PieceView,
  d: string,
  lease: number,
): { ids: Hash[]; roots: Address[] } {
  const ids = setEventIds(view);
  const carriers = carriersOf(f, ids);
  for (const r of creditedReveals(view)) {
    const root = home.fold.rootOf(r.root, f.now);
    f.moves.push({ root, at: d, delta: -1 });
    const live = f.credits.find((c) => c.reveal === r.id);
    if (live) f.struckCredits.push({ ...live, until: d });
    else if (f.struckCredits.some((c) => c.reveal === r.id)) f.moves.push({ root, at: d, delta: -1 });
  }
  const roots: Address[] = [];
  for (const p of acceptingRoots(view)) {
    const root = home.fold.rootOf(p, f.now);
    roots.push(root);
    for (const l of f.locks) {
      if (!carriers.has(l.problem) || l.piece !== view.piece.hash || l.root !== root || l.at > d) continue;
      if (l.forfeitedAt !== null && (l.restoredAt === null || l.restoredAt > d)) continue;
      const end = lockReleasedAt(l, view, lease, home.fold.related, d);
      if (end !== null && end <= d) continue;
      l.forfeitedAt = d;
      l.restoredAt = null;
      if (l.kind === 'standing') f.moves.push({ root, at: d, delta: -l.amount });
    }
  }
  for (const e of f.entries.values()) {
    if (!carriers.has(e.hash)) continue;
    for (const id of ids) e.struck.add(id);
    rereduce(f, e);
  }
  refreshCredits(f);
  return { ids, roots };
}

/**
 * QX-19 section 4: in a dispute, a reading that rests on nothing where the other rests on the record is set aside: the
 * piece is folded without that reveal, so it needs a second reading again, and the key whose reading was set aside may
 * read it again, its commit unrevealed in that fold. To a fixed point, since the fold without one pair may show
 * another. Nothing is docked: a disputed piece had no square. A trace that arrives later lifts it, since the layer is a
 * function of the receipts; a reader that measures no blob sets nothing aside. The mirror's own fold, for its record
 * documents, measures none; its check of the coin's balances measures each read a trace names by its bytes, as the
 * home does, so it sets aside what the home sets aside (QX-17 section 7). Answers whether anything was set aside, so
 * the read brings the sets and standing to their fixed point again over what remains.
 */
function setAsideUngrounded(f: Folding, blobLength: (hash: Hash) => number | null): boolean {
  let any = false;
  for (const e of f.entries.values()) {
    for (let pass = 0; pass < 4; pass++) {
      const found: Hash[] = [];
      for (const v of e.fold.pieces) {
        if (v.state !== 'disputed') continue;
        for (const id of pieceTraces(e.fold, v, e.input.receipts, blobLength, () => null).aside)
          if (!e.struck.has(id)) found.push(id);
      }
      if (found.length === 0) break;
      any = true;
      for (const id of found) {
        e.struck.add(id);
        e.aside.add(id);
      }
      rereduce(f, e);
    }
  }
  refreshCredits(f);
  return any;
}

/**
 * Undoes a miss's strike at `d` (QX-16 section 4): the events return to the fold of every problem that carried them,
 * and each struck root regains from `d` the point docked, its point for the set and its locks at those problems, once
 * however many versions carried the set (QX-1 section 2 as amended 10 November 2026). The reveal's point stays out of
 * the credits, withdrawn in `struckCredits`, and comes back as the move.
 */
function unstrike(f: Folding, home: ProblemEntry, c: GoldCommitment, d: string): void {
  const carriers = carriersOf(f, c.struck);
  for (const e of f.entries.values()) {
    if (!carriers.has(e.hash)) continue;
    for (const id of c.struck) e.struck.delete(id);
    rereduce(f, e);
  }
  refreshCredits(f);
  const piece = c.piece!;
  const view = home.fold.byHash.get(piece);
  const credited = view?.accepting ? creditedRoots(view).map((p) => home.fold.rootOf(p, f.now)) : [];
  for (const root of c.struckRoots) {
    if (credited.includes(root)) f.moves.push({ root, at: d, delta: 2 });
    for (const l of f.locks) {
      if (
        !carriers.has(l.problem) ||
        l.piece !== piece ||
        l.root !== root ||
        l.forfeitedAt !== c.revealedAt ||
        l.restoredAt !== null
      )
        continue;
      l.restoredAt = d;
      if (l.kind === 'standing') f.moves.push({ root, at: d, delta: l.amount });
    }
  }
}

/**
 * Why a root's free standing does not cover a stake at `at`, naming the lock where one is the reason; null when it
 * does.
 */
function stakeShort(f: Folding, root: Address, stake: number, at: string): string | null {
  const s = f.standing(root, at);
  const l = f.locked(root, at);
  const free = Math.max(0, s - l);
  if (free >= stake) return null;
  return l > 0
    ? `free standing ${free} is below the stake of ${stake}`
    : `standing ${s} is below the stake of ${stake}`;
}

export type ChallengeCheck =
  | {
      ok: true;
      root: Address;
      view: PieceView;
      parties: Address[];
      pool: Address[];
      gold: GoldView | null;
      commitment: GoldCommitment | null;
    }
  | { ok: false; why: string };

/**
 * Whether a challenge would be kept if received at `at`, and why not: QX-1 section 1 against an acceptance;
 * QX-16 section 4 against a gold miss, from a struck root, for a stake of 0 or more.
 */
export function checkChallenge(
  f: Folding,
  home: ProblemEntry,
  piece: Hash,
  key: Address,
  stake: number,
  at: string,
): ChallengeCheck {
  const fold = home.fold;
  const view = fold.byHash.get(piece);
  if (!view) return { ok: false, why: 'names a piece this problem does not have' };
  const root = rootFor(fold, key, 'challenge', at);
  if (!root) return { ok: false, why: 'the key may not sign a challenge' };
  // QX-1 section 2 as amended 10 November 2026: "The challenges on a piece are those on it at any problem of the line:
  // one is open at a time across the line, and a piece that had its held challenge at one version is not challenged at
  // another."
  const prior = lineOf(f, home.hash)
    .flatMap((e) => e.challenges)
    .filter((c) => c.piece === piece);
  if (prior.some((c) => c.outcome === 'held')) return { ok: false, why: 'this piece has had its challenge' };
  const open = prior.some((c) => c.outcome === 'open' || (c.decidedAt !== null && c.decidedAt > at));
  // QX-16 section 4: a miss on the piece inside its window is challenged by a root of the struck set, against the gold.
  // The stake may be 0: the strike may have left the root with nothing (amended 27 October 2026).
  const miss = missOn(home, piece);
  if (!view.accepting && miss) {
    if (open) return { ok: false, why: 'a challenge is open on this piece' };
    if (at >= plusHours(miss.commitment.revealedAt!, windowOf(fold))) return { ok: false, why: 'outside the window' };
    if (!miss.commitment.struckRoots.includes(root))
      return { ok: false, why: 'only a root of the struck set challenges a miss' };
    const parties = [ownerOf(fold, at)];
    const short = stakeShort(f, root, stake, at);
    if (short) return { ok: false, why: short };
    const pool = poolFor(f, home, view, root, parties, at).filter((r) => !miss.commitment.struckRoots.includes(r));
    return { ok: true, root, view, parties, pool, gold: miss.gold, commitment: miss.commitment };
  }
  if (!view.accepting || view.accepting.completedAt > at)
    return { ok: false, why: 'nothing accepted on this piece yet' };
  if (view.windowEnd === null || at >= view.windowEnd) return { ok: false, why: 'outside the window' };
  if (open) return { ok: false, why: 'a challenge is open on this piece' };
  const parties = [...acceptingRoots(view), fold.envelope.problem.owner as Address];
  if (parties.some((p) => fold.related(p, root, at)))
    return { ok: false, why: 'a party to the acceptance cannot challenge it' };
  if (stake < 1) return { ok: false, why: 'a challenge on an acceptance stakes at least 1' };
  // QX-15 section 3: standing locked behind a claim is not staked again on a challenge.
  const short = stakeShort(f, root, stake, at);
  if (short) return { ok: false, why: short };
  return {
    ok: true,
    root,
    view,
    parties,
    pool: poolFor(f, home, view, root, parties, at),
    gold: null,
    commitment: null,
  };
}

/**
 * Why an event is not this layer's to keep: it names another problem, names a piece or not as its kind asks, or its
 * signature is not the key's; null when it is.
 */
function misnamed(ev: Event, home: ProblemEntry, { piece }: { piece: boolean }): string | null {
  if (ev.problem !== home.hash || (piece ? !ev.piece : ev.piece !== undefined))
    return piece
      ? 'names a problem or piece this layer does not hold'
      : 'names a problem this layer does not hold, or a piece';
  if (!eventSignedByKey(ev)) return "signature is not the key's";
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
  f.locks.push({
    id: c.id,
    problem: home.hash,
    piece: ev.piece!,
    name: r.view.piece.name,
    key: ev.key,
    root: r.root,
    at,
    kind: coin ? 'coin' : 'standing',
    amount: ev.body.amount as number,
    coinId: coin ? (ev.body.id as Hash) : null,
    forfeitedAt: null,
    restoredAt: null,
  });
}

/**
 * QX-16 section 1: the owner's blind commitments, kept at their receipt against the owner's free standing then; the
 * pieces are named at the reveals.
 */
function keepGold(f: Folding, c: LayerEvent): void {
  const { event: ev, at, home } = c;
  const why = misnamed(ev, home, { piece: false });
  if (why) return drop(c, why);
  const r = checkGold(f, home, ev.key, ev.body, at);
  if (!r.ok) return drop(c, r.why);
  const g: GoldView = {
    id: c.id,
    problem: home.hash,
    key: ev.key,
    root: r.root,
    at,
    stake: ev.body.stake as number,
    commitments: r.kept,
    forfeitedAt: null,
  };
  f.golds.push(g);
  home.golds.push(g);
}

/** QX-16 section 3: the owner's reveal decides the piece at its receipt: a match verifies, a miss strikes. */
function keepGoldReveal(f: Folding, c: LayerEvent): void {
  const { event: ev, at, home } = c;
  const why = misnamed(ev, home, { piece: true });
  if (why) return drop(c, why);
  const r = checkGoldReveal(home, lineOf(f, home.hash), ev.piece!, ev.key, ev.body, at);
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
 * QX-1 sections 3 to 6: a challenge kept at its receipt seats its panel from the pool then and folds its verdicts;
 * held, it strikes the set, or against a gold miss undoes the miss's strike and forfeits the gold (QX-16 section 4);
 * failed, it costs the challenger the stake.
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
    id: c.id,
    problem: home.hash,
    piece: ev.piece!,
    key: ev.key,
    root: r.root,
    at,
    stake,
    ground: ev.body.ground as string,
    against: r.gold ? 'gold' : 'acceptance',
    parties: r.parties,
    seed,
    order: [],
    seats: [],
    outcome: 'open',
    decidedAt: null,
    struck: [],
    dropped: [],
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
      // QX-16 section 4: the gold was wrong. The strike is undone, the owner's stake is forfeited whole, and the rest
      // of the gold is dropped.
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
 * Why the core refuses a problem's input, or null where it does not: CORE.md section 6, "An envelope that fails its
 * checks makes the input invalid: `reduce` refuses it and produces no state." What makes it so is the
 * envelopes and the blobs, an envelope that does not check, is not its owner's or lacks a data blob, or a data blob
 * its pieces cannot be read from, so the input is reduced again with no receipt: where that is refused, the refusal
 * is the input's, and where it is not, what failed was a receipt, which is no refusal of the core's.
 */
export function inputRefused(p: ReduceInput): string | null {
  try {
    reduce({ ...p, receipts: [] });
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

/** The last challenge the layer kept on a piece, or null. */
function lastChallenge(e: ProblemEntry, piece: Hash): ChallengeView | null {
  const own = e.challenges.filter((c) => c.piece === piece);
  return own.length ? own[own.length - 1]! : null;
}

/**
 * A piece's own state on a problem, as the layer says it before anything is inherited: challenged while its last
 * challenge is open; recording on a record piece some readings stand on, which the fold holds under needs_verify so
 * the core's `next` offers it (QX-20); else the fold's. After the last pass the fold's is `inherited` on an inherited
 * piece (QX-23 section 2), and the views say so.
 */
function ownState(e: ProblemEntry, v: PieceView): LayerState {
  if (lastChallenge(e, v.piece.hash)?.outcome === 'open') return 'challenged';
  return e.decided.records.has(v.piece.hash) && v.state === 'needs_verify' ? 'recording' : v.state;
}

/**
 * What `read` is given (READING.md section 1): every problem a reader holds, the time, and what reaches the fold from
 * beside the lines.
 */
export interface ReadInput {
  problems: ReduceInput[];
  now: string;
  /** The core's fold of a problem's input, as a tracker keeps it (folds.ts); `reduce` where none is given. */
  reduce?: (p: ReduceInput) => State;
  coin?: Receipt[];
  founding?: Map<string, number>;
  blobLength?: (hash: Hash) => number | null;
}

/**
 * What `read` answers: the views, standing over them, and the record the fold wrote into, which a door's admissions
 * are asked over.
 */
export interface Reading extends LayerViews {
  /**
   * Every problem the reader holds whose input the core refuses, by hash, with the core's reason: CORE.md section 6,
   * "An envelope that fails its checks makes the input invalid: `reduce` refuses it and produces no state." A problem
   * with no state is in no view, no standing and no coin.
   */
  refused: Map<Hash, string>;
  /** Every problem's, in receipt order. */
  challenges: ChallengeView[];
  /**
   * Every problem's input carries the identity log, so any fold resolves a key; with no problem held, the key is its
   * own root.
   */
  rootOf(key: Address, at?: string): Address;
  /** A root's standing at a time, `now` when none is given. */
  standing(root: Address, at?: string): number;
  /** The record the fold wrote into (standing.ts): every credit, move, lock and challenge it kept. */
  record: Folding;
}

/**
 * The reading of every problem a reader holds, at `now`: the time lapses, windows and liveness are judged at; roots are
 * resolved at `now` throughout, moves are dated at the receipts that made them. `coin` is the coin log's receipts, read
 * for burn credits (QX-17 section 4).
 */
export function read(input: ReadInput): Reading {
  const { now } = input;
  const f = newFolding(now, input.founding);

  // 2. The check, and the line: every problem reduced once by the core, and one the core refuses left out.
  // 3. The record: each problem's events on its pieces, with the kinds' first word on them (verifiers.md section 1).
  const refused = foldProblems(f, input);

  // 4. The grounds (QX-19 section 4): in a dispute, a reading that rests on nothing is set aside.
  const grounds = () => setAsideUngrounded(f, input.blobLength ?? (() => null));
  grounds();

  // 5. The sets (verifiers.md section 1), brought to a fixed point with the credits of step 6, and with the grounds
  // again where a set opened a piece that waited on it and a dispute shows there: four passes at most.
  // 6. Standing (QX-1 section 2), and the burns on the coin log credited (QX-17 section 4).
  setsAndStanding(f);
  for (let pass = 0; pass < 3 && grounds(); pass++) setsAndStanding(f);
  creditBurns(f, input.coin ?? []);

  // 7. The decisions: the stake rules each owner set (QX-15 section 1), then the locks, golds and challenges.
  keepStakeRules(f);
  decide(f);

  // 8. The reach (QX-23 sections 1 to 3): the pieces done elsewhere, what waits on them settled again with nothing
  // decided again, and the inherited squares marked. Every credit, lock, gold and strike is folded above with each
  // `elsewhere` empty, so an inherited square moves none of them.
  inheritSquares(f, ownState, (e) => settleKinds(e.decided, e.base, now, e.elsewhere));

  // 9. The state: the views, standing, and the record the door's admissions are asked over.
  return {
    now,
    ...stateOf(f),
    refused,
    rootOf: (key, at = now) => rootOf(f, key, at),
    standing: f.standing,
    record: f,
  };
}

/**
 * Steps 2 and 3 of the read (READING.md sections 2 and 3): every problem reduced by the core, once each by hash, and
 * the kinds decided over it with no credits yet. A problem whose input the core refuses is left out with the core's
 * reason (`inputRefused`), so one problem a store cannot fold leaves the others folded; anything else that fails is
 * the failure it was. Answers the problems refused, by hash.
 */
function foldProblems(f: Folding, input: ReadInput): Map<Hash, string> {
  const refused = new Map<Hash, string>();
  for (const p of input.problems) {
    let core: State;
    try {
      core = (input.reduce ?? reduce)(p);
    } catch (err) {
      const why = inputRefused(p);
      if (why === null || !p.envelopes[0]) throw err;
      refused.set(problemHash(p.envelopes[0]), why);
      continue;
    }
    if (f.entries.has(core.problem)) continue;
    const decided = applyVerifiers(core, p.receipts, f.now, { pool: () => [] });
    f.entries.set(core.problem, {
      hash: core.problem,
      input: p,
      core,
      base: core,
      fold: decided.fold,
      decided,
      struck: new Set(),
      aside: new Set(),
      challenges: [],
      dropped: [],
      rules: [],
      golds: [],
      elsewhere: new Set(),
      inherited: new Map(),
    });
  }
  for (const h of f.entries.keys()) refused.delete(h);
  return refused;
}

/**
 * Steps 5 and 6 of the read (READING.md sections 5 and 6), to a fixed point (verifiers.md section 1): a judge panel's
 * pool is the credits on other problems, and a judged acceptance is itself a credit, so the credits are refreshed and
 * the kinds decided again until nothing moves; four passes at most. A strike in step 7 refolds the problems it touches
 * and refreshes the credits without running the fixed point again: a struck credit keeps its `until`, so a panel drawn
 * before the strike keeps its pool (verifiers.md section 6), and a panel drawn after it draws from what remains.
 */
function setsAndStanding(f: Folding): void {
  const seats = (e: ProblemEntry) =>
    e.decided.panels.map((p) => `${p.piece}:${p.outcome}:${p.seats.map((s) => s.root).join('.')}`).join(';');
  let fingerprint = '';
  for (let pass = 0; ; pass++) {
    refreshCredits(f);
    const next = [...f.entries.values()]
      .map((e) => `${e.fold.pieces.map((v) => v.state).join(',')}|${seats(e)}`)
      .join('/');
    if (next === fingerprint || pass === 3) break;
    fingerprint = next;
    for (const e of f.entries.values()) refold(f, e);
  }
}

/**
 * Step 7 of the read (READING.md section 7): the events the pass keeps or drops, once each by id across every problem,
 * in receipt order; a verdict is read under its challenge.
 */
function decide(f: Folding): void {
  const events = new Map<Hash, LayerEvent>();
  const verdicts = new Map<Hash, Verdict[]>();
  for (const e of f.entries.values())
    for (const { receipt, at, id } of orderReceipts(e.input.receipts)) {
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
}

/**
 * Step 9 of the read (READING.md section 9): each problem's view, a piece's state and each extension's word on it, and
 * every problem's challenges in receipt order.
 */
function stateOf(f: Folding): Pick<Reading, 'problems' | 'challenges'> {
  const now = f.now;
  const problems = new Map<Hash, ProblemLayer>();
  const all: ChallengeView[] = [];
  for (const e of f.entries.values()) {
    const asideBy = new Map<Hash, Address[]>();
    for (const r of e.input.receipts)
      if (r.event.piece && e.aside.has(eventId(r.event)))
        asideBy.set(r.event.piece, [...(asideBy.get(r.event.piece) ?? []), r.event.key]);
    const pieces: PieceLayer[] = e.fold.pieces.map((v) => {
      const last = lastChallenge(e, v.piece.hash);
      const core = e.core.byHash.get(v.piece.hash)?.state ?? v.state;
      const record = e.decided.records.get(v.piece.hash) ?? null;
      const state = ownState(e, v);
      const kind = e.decided.kinds.get(v.piece.hash)!;
      const commitment = goldOn(e, v.piece.hash);
      const gold = commitment ? (outcomeOf(e, commitment, now) as GoldState) : null;
      return {
        hash: v.piece.hash,
        name: v.piece.name,
        core,
        state,
        challenge: last,
        kind,
        attested: viaOf(v.accepting) === 'attest',
        panel: e.decided.byPiece.get(v.piece.hash) ?? null,
        stake: stakeAsked(ruleAt(e, now), v.piece),
        gold,
        verified: gold === 'match',
        aside: asideBy.get(v.piece.hash) ?? [],
        record,
        inherited: e.inherited.get(v.piece.hash) ?? null,
      };
    });
    const rule = ruleAt(e, now);
    problems.set(e.hash, {
      problem: e.hash,
      core: e.core,
      fold: e.fold,
      complete: completeInLayer(pieces),
      pieces,
      byHash: new Map(pieces.map((p) => [p.hash, p])),
      challenges: e.challenges,
      panels: e.decided.panels,
      unoffered: e.decided.unoffered,
      dropped: [...e.dropped, ...e.decided.dropped],
      stake: rule ? { min: rule.min, pieces: rule.pieces } : null,
      locks: f.locks.filter((l) => l.problem === e.hash),
      golds: e.golds,
      goldCount: goldCount(e.golds, (_g, c) => outcomeOf(e, c, now)),
      receipts: e.input.receipts,
    });
    all.push(...e.challenges);
  }
  all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { problems, challenges: all };
}

/** Why a root has no live seat on a challenge, or null when it has one. */
export function seatProblem(challenge: ChallengeView, root: Address): string | null {
  const seats = challenge.seats.filter((s) => s.root === root);
  if (seats.length === 0) return 'not a judge drawn for this challenge';
  if (seats.some((s) => s.verdict)) return 'this judge has answered';
  if (seats.every((s) => s.lapsedAt !== null)) return 'this seat lapsed';
  return null;
}

/** Why a verdict's return does not fit the piece, or null. */
export function verdictReturnProblem(view: PieceView, ret: unknown): string | null {
  if (ret === undefined) return null;
  if (!isRecord(ret)) return 'body.return: an object';
  if (!view.piece.schema) return 'a verdict on a check or score piece carries no return';
  const rp = returnProblems(view.piece.schema, ret);
  return rp.length ? rp[0]! : null;
}

/**
 * Offers the seats, lapses and replaces them by the lease (the core's sortition.ts), folds the verdicts in receipt
 * order, and decides on a majority.
 */
function seat(
  challenge: ChallengeView,
  fold: State,
  view: PieceView,
  leaseH: number,
  verdicts: Verdict[],
  now: string,
): void {
  const { seats, advance, ranOut, lastLapse } = offerSeats<Seat>(
    challenge.order,
    PANEL,
    challenge.at,
    leaseH,
    (root, offeredAt) => ({ root, offeredAt, lapsedAt: null, verdict: null }),
    (s) => s.verdict !== null,
  );
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
      dropVerdict("signature is not the key's");
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
    const rp = verdictReturnProblem(view, ev.body.return);
    if (rp) {
      dropVerdict(rp);
      continue;
    }
    const side = ev.body.for as Side;
    const open = seats.find((s) => s.root === root && s.lapsedAt === null && !s.verdict)!;
    open.verdict = {
      id: v.id,
      key: ev.key,
      root,
      at: v.at,
      for: side,
      return: (ev.body.return as Return | undefined) ?? null,
    };
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
