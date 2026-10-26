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
 */
import {
  type Address, type Event, type Hash, type PieceState, type PieceView, type Receipt, type ReduceInput, type Return, type State,
  commitHash, eventId, eventSignedByKey, hashCanonical, isHash, orderReceipts, reduce, returnProblems,
} from '@bitquilt/core';
import { type KindInfo, type Layered, type PanelView, applyVerifiers, panelSeatProblem, rankBodyProblems, rankingProblem, rootFor, viaOf } from './verifiers.js';
import { type LockView, type StakeRule, lockBodyProblems, lockReleasedAt, ruleNames, stakeAsked, stakeRuleBodyProblems } from './stake.js';

export { rootFor };
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
  /** The roots of the accepting set, then the owner. */
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
  dropped: { id: Hash; type: string; why: string }[];
  /** The stake rule in force at now (QX-15), or null. */
  stake: { min: number; pieces: string[] | null } | null;
  /** Every standing lock on this problem the layer kept, live or not. */
  locks: LockView[];
}

export type Admission = { ok: true } | { ok: false; why: string };

export interface Layer {
  now: string;
  problems: Map<Hash, ProblemLayer>;
  challenges: ChallengeView[];
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
  locks(root: Address): LockView[];
  /** Whether a stake rule by this key would count if received now, and why not. */
  admitStakeRule(problem: Hash, key: Address, body: Record<string, unknown>): Admission;
  /** Whether a lock by this key on this piece would count if received now, and why not. */
  admitLock(problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission;
  /** Whether a claim, commit, reveal or run by this key on this piece is backed as the piece's stake asks, and why not. */
  admitProduction(problem: Hash, piece: Hash, key: Address): Admission;
  /** The undone pieces of a problem whose stake the key's free standing cannot cover and on which it holds no lock. */
  unaffordable(problem: Hash, key: Address): Set<Hash>;
}

interface Credit { root: Address; problem: Hash; at: string; until: string | null }
interface Delta { root: Address; at: string; delta: number }
/** `base` is the core's reduce without the struck events; `fold` is `base` with the verifier kinds decided; `core` is the reduce of everything, kept for the core's states. */
interface Entry { hash: Hash; input: ReduceInput; core: State; base: State; fold: State; layered: Layered; struck: Set<Hash>; challenges: ChallengeView[]; dropped: ProblemLayer['dropped']; rules: StakeRule[] }
interface Candidate { id: Hash; kind: 'challenge' | 'lock'; event: Event; at: string; receipt: Receipt; home: Entry }

const plusHours = (t: string, h: number): string => new Date(Date.parse(t) + h * 3_600_000).toISOString();
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Why this is not a well-formed challenge body, or nothing. */
export function challengeBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!Number.isInteger(body.stake) || (body.stake as number) < 1) out.push('body.stake: a whole number of at least 1');
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

/** The roots of a piece's accepting set: both reveals of an agree set; the patch's root and the two runners of a check or score set. */
export function acceptingRoots(v: PieceView): Address[] {
  if (!v.accepting) return [];
  if (v.accepting.kind === 'agree') return v.accepting.reveals.map((r) => r.root);
  return [v.accepting.patch.root, ...v.accepting.runs.map((r) => r.root)];
}

/** The roots whose standing a set credits: the reveals, not the runs; an attested acceptance credits nobody, being the actor's own word. */
function creditedRoots(v: PieceView): Address[] {
  if (!v.accepting) return [];
  if (viaOf(v.accepting) === 'attest') return [];
  return v.accepting.kind === 'agree' ? v.accepting.reveals.map((r) => r.root) : [v.accepting.patch.root];
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

export function challengeLayer(input: { problems: ReduceInput[]; now: string }): Layer {
  const { now } = input;
  const entries = new Map<Hash, Entry>();
  const struckCredits: Credit[] = [];
  const deltas: Delta[] = [];
  let credits: Credit[] = [];
  /** The pool a judge panel is drawn from: roots credited on another problem at the time, unstruck then, unrelated to the piece's parties. */
  const judgePool = (problem: Hash, at: string, unrelatedTo: Address[], fold: State): Address[] => {
    const roots = new Set<Address>();
    for (const c of [...credits, ...struckCredits]) if (c.problem !== problem && c.at <= at && (c.until === null || c.until > at)) roots.add(c.root);
    return [...roots].filter((r) => !unrelatedTo.some((u) => fold.related(r, u, at)));
  };
  /** The verifier kinds decided over an entry's base fold, with the pool as the credits stand. */
  const refold = (e: Entry) => {
    e.layered = applyVerifiers(e.base, e.input.receipts.filter((x) => !e.struck.has(eventId(x.event))), now, { pool: judgePool });
    e.fold = e.layered.fold;
  };
  for (const p of input.problems) {
    const core = reduce(p);
    if (entries.has(core.problem)) continue;
    const e: Entry = { hash: core.problem, input: p, core, base: core, fold: core, layered: null as unknown as Layered, struck: new Set(), challenges: [], dropped: [], rules: [] };
    entries.set(core.problem, e);
  }

  // Standing: credits from the folds as they stand, struck ones kept with the time they were withdrawn, and the stakes.
  const refreshCredits = () => {
    credits = [];
    for (const e of entries.values()) for (const v of e.fold.pieces) if (v.accepting) for (const r of creditedRoots(v)) credits.push({ root: e.fold.rootOf(r, now), problem: e.hash, at: v.accepting.completedAt, until: null });
  };
  // The kinds are decided to a fixed point: a judge panel's pool is credits on other problems, and a judged acceptance is itself a credit.
  let signature = '';
  for (let pass = 0; pass < 4; pass++) {
    for (const e of entries.values()) refold(e);
    refreshCredits();
    const next = [...entries.values()].map((e) => `${e.fold.pieces.map((v) => v.state).join(',')}|${e.layered.panels.map((p) => `${p.piece}:${p.outcome}:${p.seats.map((s) => s.root).join('.')}`).join(';')}`).join('/');
    if (next === signature) break;
    signature = next;
  }
  // QX-15: the stake rules each problem's owner set, in receipt order, and the standing locks the layer keeps.
  const ownerOf = (e: Entry, at: string): Address => e.fold.rootOf(e.fold.envelope.problem.owner as Address, at);
  const ruleProblem = (e: Entry, key: Address, body: Record<string, unknown>, at: string): string | null => {
    const shape = stakeRuleBodyProblems(body);
    if (shape.length) return shape[0]!;
    const root = rootFor(e.fold, key, 'stake_rule', at);
    if (!root || root !== ownerOf(e, at)) return 'the owner alone sets a stake rule';
    const names = ruleNames(e.fold.pieces.map((v) => v.piece));
    const pieces = body.pieces as string[] | undefined;
    if (pieces && !pieces.every((n) => names.has(n))) return 'names a piece or family this problem does not have';
    return null;
  };
  for (const e of entries.values()) for (const { receipt, at, id } of orderReceipts(e.input.receipts)) {
    const ev = receipt.event;
    if (ev.type !== 'stake_rule' || ev.problem !== e.hash) continue;
    if (e.rules.some((r) => r.id === id)) continue;
    if (!eventSignedByKey(ev)) {
      e.dropped.push({ id, type: 'stake_rule', why: 'signature is not the key\'s' });
      continue;
    }
    const why = ruleProblem(e, ev.key, ev.body, at);
    if (why) {
      e.dropped.push({ id, type: 'stake_rule', why });
      continue;
    }
    e.rules.push({ id, root: ev.key, at, min: ev.body.min as number, pieces: (ev.body.pieces as string[] | undefined) ?? null });
  }
  /** The rule in force at a time: the latest kept at or before it. */
  const ruleAt = (e: Entry, at: string): StakeRule | null => {
    let found: StakeRule | null = null;
    for (const r of e.rules) if (r.at <= at) found = r;
    return found;
  };
  const locks: LockView[] = [];
  /** When a lock ended, or null while it is live: its forfeit, else what the fold says. */
  const lockEnd = (l: LockView): string | null => {
    if (l.forfeitedAt !== null) return l.forfeitedAt;
    const home = entries.get(l.problem);
    const view = home?.fold.byHash.get(l.piece);
    if (!home || !view) return l.at;
    return lockReleasedAt(l, view, view.piece.lease_h ?? home.fold.envelope.problem.settings.lease_h, home.fold.related, now);
  };
  const liveAt = (l: LockView, at: string): boolean => {
    if (l.at > at) return false;
    const end = lockEnd(l);
    return end === null || end > at;
  };
  const hasLock = (home: Entry, piece: Hash, root: Address, at: string): boolean => locks.some((l) => l.problem === home.hash && l.piece === piece && l.root === root && liveAt(l, at));
  const locked = (root: Address, at: string = now): number => locks.reduce((sum, l) => (l.root === root && liveAt(l, at) ? sum + l.amount : sum), 0);

  const standing = (root: Address, at: string = now): number => {
    const moves: { at: string; delta: number }[] = [];
    for (const c of [...credits, ...struckCredits]) if (c.root === root) {
      moves.push({ at: c.at, delta: 1 });
      if (c.until !== null) moves.push({ at: c.until, delta: -1 });
    }
    for (const d of deltas) if (d.root === root) moves.push({ at: d.at, delta: d.delta });
    moves.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    let s = 1;
    for (const m of moves) if (m.at <= at) s = Math.max(0, s + m.delta);
    return s;
  };
  const free = (root: Address, at: string = now): number => Math.max(0, standing(root, at) - locked(root, at));
  type LockCheck = { ok: true; root: Address; view: PieceView } | { ok: false; why: string };
  /** Whether a lock would be kept if received at `at`, by section 1 of QX-15, and why not. */
  const checkLock = (home: Entry, piece: Hash, key: Address, body: Record<string, unknown>, at: string): LockCheck => {
    const view = home.fold.byHash.get(piece);
    if (!view) return { ok: false, why: 'names a piece this problem does not have' };
    const shape = lockBodyProblems(body);
    if (shape.length) return { ok: false, why: shape[0]! };
    if (body.kind === 'coin') return { ok: false, why: 'this tracker honours no coin lock' };
    const root = rootFor(home.fold, key, 'lock', at);
    if (!root) return { ok: false, why: 'the key may not sign a lock' };
    const asked = stakeAsked(ruleAt(home, at), view.piece);
    if (asked === 0) return { ok: false, why: 'this piece asks no stake' };
    const amount = body.amount as number;
    if (amount < asked) return { ok: false, why: `this piece asks for a stake of ${asked}` };
    if (hasLock(home, piece, root, at)) return { ok: false, why: 'a lock already stands on this piece' };
    const f = free(root, at);
    if (f < amount) return { ok: false, why: `free standing ${f} is below the lock of ${amount}` };
    return { ok: true, root, view };
  };
  const poolFor = (home: Entry, view: PieceView, challenger: Address, parties: Address[], at: string): Address[] => {
    const fold = home.fold;
    const roots = new Set<Address>();
    for (const c of [...credits, ...struckCredits]) if (c.problem !== home.hash && c.at <= at && (c.until === null || c.until > at)) roots.add(c.root);
    const out: Address[] = [];
    for (const r of roots) {
      if (fold.related(r, challenger, at)) continue;
      if (parties.some((p) => fold.related(r, p, at))) continue;
      if (view.reveals.some((x) => fold.related(x.root, r, at)) || view.runs.some((x) => fold.related(x.root, r, at))) continue;
      out.push(r);
    }
    return out;
  };

  type Check = { ok: true; root: Address; view: PieceView; parties: Address[]; pool: Address[] } | { ok: false; why: string };
  const check = (home: Entry, piece: Hash, key: Address, stake: number, at: string): Check => {
    const fold = home.fold;
    const view = fold.byHash.get(piece);
    if (!view) return { ok: false, why: 'names a piece this problem does not have' };
    const root = rootFor(fold, key, 'challenge', at);
    if (!root) return { ok: false, why: 'the key may not sign a challenge' };
    const prior = home.challenges.filter((c) => c.piece === piece);
    if (prior.some((c) => c.outcome === 'held')) return { ok: false, why: 'this piece has had its challenge' };
    if (!view.accepting || view.accepting.completedAt > at) return { ok: false, why: 'nothing accepted on this piece yet' };
    if (view.windowEnd === null || at >= view.windowEnd) return { ok: false, why: 'outside the window' };
    if (prior.some((c) => c.outcome === 'open' || (c.decidedAt !== null && c.decidedAt > at))) return { ok: false, why: 'a challenge is open on this piece' };
    const parties = [...acceptingRoots(view), fold.envelope.problem.owner as Address];
    if (parties.some((p) => fold.related(p, root, at))) return { ok: false, why: 'a party to the acceptance cannot challenge it' };
    // QX-15: standing locked behind a claim is not staked again on a challenge.
    const s = standing(root, at);
    const l = locked(root, at);
    const f = Math.max(0, s - l);
    if (f < stake) return { ok: false, why: l > 0 ? `free standing ${f} is below the stake of ${stake}` : `standing ${s} is below the stake of ${stake}` };
    return { ok: true, root, view, parties, pool: poolFor(home, view, root, parties, at) };
  };

  // Every challenge the entries hold, once each by id, in receipt order across all problems; a verdict is read under its challenge.
  const candidates = new Map<Hash, Candidate>();
  const verdicts = new Map<Hash, { id: Hash; event: Event; at: string }[]>();
  for (const e of entries.values()) for (const { receipt, at, id } of orderReceipts(e.input.receipts)) {
    const ev = receipt.event;
    if (ev.type === 'challenge' || ev.type === 'lock') {
      if (candidates.has(id)) continue;
      const home = (ev.problem && entries.get(ev.problem)) || e;
      candidates.set(id, { id, kind: ev.type, event: ev, at, receipt, home });
    } else if (ev.type === 'verdict') {
      const of = (ev.body as { challenge?: unknown }).challenge;
      if (!isHash(of)) continue;
      const list = verdicts.get(of) ?? [];
      if (list.some((v) => v.id === id)) continue;
      list.push({ id, event: ev, at });
      verdicts.set(of, list);
    }
  }
  const ordered = [...candidates.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const c of ordered) {
    const { event: ev, at, home } = c;
    const drop = (why: string) => home.dropped.push({ id: c.id, type: c.kind, why });
    if (c.kind === 'lock') {
      // QX-15: a lock is kept or dropped at its receipt, against the free standing and the rule in force then.
      if (!ev.piece || ev.problem !== home.hash) {
        drop('names a problem or piece this layer does not hold');
        continue;
      }
      if (!eventSignedByKey(ev)) {
        drop('signature is not the key\'s');
        continue;
      }
      const r = checkLock(home, ev.piece, ev.key, ev.body, at);
      if (!r.ok) {
        drop(r.why);
        continue;
      }
      locks.push({ id: c.id, problem: home.hash, piece: ev.piece, name: r.view.piece.name, key: ev.key, root: r.root, at, kind: 'standing', amount: ev.body.amount as number, forfeitedAt: null });
      continue;
    }
    if (!ev.piece || ev.problem !== home.hash) {
      drop('names a problem or piece this layer does not hold');
      continue;
    }
    if (!eventSignedByKey(ev)) {
      drop('signature is not the key\'s');
      continue;
    }
    const shape = challengeBodyProblems(ev.body);
    if (shape.length) {
      drop(shape[0]!);
      continue;
    }
    const stake = ev.body.stake as number;
    const r = check(home, ev.piece, ev.key, stake, at);
    if (!r.ok) {
      drop(r.why);
      continue;
    }
    const view = r.view;
    const seed = c.receipt.hash ?? null;
    const challenge: ChallengeView = {
      id: c.id, problem: home.hash, piece: ev.piece, key: ev.key, root: r.root, at, stake, ground: ev.body.ground as string,
      parties: r.parties, seed, order: [], seats: [], outcome: 'open', decidedAt: null, struck: [], dropped: [],
    };
    home.challenges.push(challenge);
    if (r.pool.length < PANEL) {
      challenge.outcome = 'void';
      challenge.decidedAt = at;
      continue;
    }
    if (seed === null) continue;
    challenge.order = [...r.pool].sort((a, b) => {
      const ha = hashCanonical([seed, a]);
      const hb = hashCanonical([seed, b]);
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    const lease = view.piece.lease_h ?? home.fold.envelope.problem.settings.lease_h;
    seat(challenge, home.fold, view, lease, (verdicts.get(c.id) ?? []).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), now);
    if (challenge.outcome === 'held') {
      const d = challenge.decidedAt!;
      deltas.push({ root: challenge.root, at: d, delta: stake });
      for (const p of creditedRoots(view)) {
        const root = home.fold.rootOf(p, now);
        deltas.push({ root, at: d, delta: -1 });
        struckCredits.push({ root, problem: home.hash, at: view.accepting!.completedAt, until: d });
      }
      // QX-15: every root of the struck set loses its lock on the piece, from the decision.
      for (const p of acceptingRoots(view)) {
        const root = home.fold.rootOf(p, now);
        for (const l of locks) {
          if (l.problem !== home.hash || l.piece !== view.piece.hash || l.root !== root || l.forfeitedAt !== null || l.at > d) continue;
          const end = lockReleasedAt(l, view, lease, home.fold.related, d);
          if (end !== null && end <= d) continue;
          l.forfeitedAt = d;
          deltas.push({ root, at: d, delta: -l.amount });
        }
      }
      challenge.struck = setEventIds(view, home.input.receipts);
      const struck = new Set(challenge.struck);
      for (const e of entries.values()) {
        if (!e.input.receipts.some((x) => struck.has(eventId(x.event)))) continue;
        for (const id of struck) e.struck.add(id);
        e.base = reduce({ ...e.input, receipts: e.input.receipts.filter((x) => !e.struck.has(eventId(x.event))) });
        refold(e);
      }
      refreshCredits();
    } else if (challenge.outcome === 'failed') {
      deltas.push({ root: challenge.root, at: challenge.decidedAt!, delta: -stake });
    }
  }

  const problems = new Map<Hash, ProblemLayer>();
  const all: ChallengeView[] = [];
  for (const e of entries.values()) {
    const pieces: PieceLayer[] = e.fold.pieces.map((v) => {
      const own = e.challenges.filter((c) => c.piece === v.piece.hash);
      const last = own.length ? own[own.length - 1]! : null;
      const core = e.core.byHash.get(v.piece.hash)?.state ?? v.state;
      const state: LayerState = last?.outcome === 'open' ? 'challenged' : v.state;
      const kind = e.layered.kinds.get(v.piece.hash)!;
      return { hash: v.piece.hash, name: v.piece.name, core, state, challenge: last, kind, attested: viaOf(v.accepting) === 'attest', panel: e.layered.byPiece.get(v.piece.hash) ?? null, stake: stakeAsked(ruleAt(e, now), v.piece) };
    });
    const rule = ruleAt(e, now);
    problems.set(e.hash, {
      problem: e.hash, core: e.core, fold: e.fold, pieces, byHash: new Map(pieces.map((p) => [p.hash, p])), challenges: e.challenges,
      panels: e.layered.panels, unoffered: e.layered.unoffered, dropped: [...e.dropped, ...e.layered.dropped],
      stake: rule ? { min: rule.min, pieces: rule.pieces } : null, locks: locks.filter((l) => l.problem === e.hash),
    });
    all.push(...e.challenges);
  }
  all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const admitChallenge = (problem: Hash, piece: Hash, key: Address, stake: number): Admission => {
    const home = entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = check(home, piece, key, stake, now);
    if (!r.ok) return r;
    if (r.pool.length < PANEL) return { ok: false, why: `no panel can be seated: ${r.pool.length} root${r.pool.length === 1 ? '' : 's'} with an accepted return on another problem, ${PANEL} needed` };
    return { ok: true };
  };
  const admitVerdict = (problem: Hash, piece: Hash, key: Address, id: Hash, body: Record<string, unknown>): Admission => {
    const home = entries.get(problem);
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
    const home = entries.get(problem);
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
    const home = entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const why = ruleProblem(home, key, body, now);
    return why ? { ok: false, why } : { ok: true };
  };
  const admitLock = (problem: Hash, piece: Hash, key: Address, body: Record<string, unknown>): Admission => {
    const home = entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const r = checkLock(home, piece, key, body, now);
    return r.ok ? { ok: true } : r;
  };
  const admitProduction = (problem: Hash, piece: Hash, key: Address): Admission => {
    const home = entries.get(problem);
    if (!home) return { ok: false, why: 'no such problem here' };
    const view = home.fold.byHash.get(piece);
    if (!view) return { ok: false, why: 'names a piece this problem does not have' };
    const asked = stakeAsked(ruleAt(home, now), view.piece);
    if (asked === 0 || hasLock(home, piece, home.fold.rootOf(key, now), now)) return { ok: true };
    return { ok: false, why: `this piece asks for a stake of ${asked}; lock first` };
  };
  const UNDONE: ReadonlySet<string> = new Set(['open', 'in_flight', 'sealed', 'needs_verify', 'disputed']);
  const unaffordable = (problem: Hash, key: Address): Set<Hash> => {
    const out = new Set<Hash>();
    const home = entries.get(problem);
    const pl = problems.get(problem);
    if (!home || !pl) return out;
    const root = home.fold.rootOf(key, now);
    const f = free(root, now);
    for (const p of pl.pieces) if (UNDONE.has(p.state) && p.stake > f && !hasLock(home, p.hash, root, now)) out.add(p.hash);
    return out;
  };
  const locksOf = (root: Address): LockView[] => locks.filter((l) => l.root === root && liveAt(l, now));

  return { now, problems, challenges: all, standing, admitChallenge, admitVerdict, admitRank, locked, free, locks: locksOf, admitStakeRule, admitLock, admitProduction, unaffordable };
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

/** Offers the seats, lapses and replaces them by the lease, folds the verdicts in receipt order, and decides. */
function seat(challenge: ChallengeView, fold: State, view: PieceView, leaseH: number, verdicts: { id: Hash; event: Event; at: string }[], now: string): void {
  const { order, seats } = challenge;
  for (const root of order.slice(0, PANEL)) seats.push({ root, offeredAt: challenge.at, lapsedAt: null, verdict: null });
  let nextIdx = Math.min(PANEL, order.length);
  const advance = (to: string) => {
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i]!;
      if (s.verdict || s.lapsedAt !== null) continue;
      const lapse = plusHours(s.offeredAt, leaseH);
      if (lapse > to) continue;
      s.lapsedAt = lapse;
      if (nextIdx < order.length) seats.push({ root: order[nextIdx++]!, offeredAt: lapse, lapsedAt: null, verdict: null });
    }
  };
  const tally: Record<Side, number> = { challenger: 0, author: 0 };
  for (const v of verdicts) {
    const drop = (why: string) => challenge.dropped.push({ id: v.id, why });
    if (challenge.outcome !== 'open') {
      drop('the challenge was decided');
      continue;
    }
    const ev = v.event;
    if (ev.problem !== challenge.problem || ev.piece !== challenge.piece) {
      drop('names another problem or piece than its challenge');
      continue;
    }
    if (!eventSignedByKey(ev)) {
      drop('signature is not the key\'s');
      continue;
    }
    const shape = verdictBodyProblems(ev.body);
    if (shape.length) {
      drop(shape[0]!);
      continue;
    }
    advance(v.at);
    const root = rootFor(fold, ev.key, 'verdict', v.at);
    if (!root) {
      drop('the key may not sign a verdict');
      continue;
    }
    const why = seatProblem(challenge, root);
    if (why) {
      drop(why);
      continue;
    }
    const rp = returnProblem(view, ev.body.return);
    if (rp) {
      drop(rp);
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
    if (nextIdx >= order.length && seats.every((s) => s.verdict || s.lapsedAt !== null)) {
      challenge.outcome = 'void';
      challenge.decidedAt = seats.reduce<string | null>((m, s) => (s.lapsedAt !== null && (m === null || s.lapsedAt > m) ? s.lapsedAt : m), null) ?? now;
    }
  }
}
