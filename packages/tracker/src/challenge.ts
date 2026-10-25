/**
 * The challenge window, extension QX-1 (docs/ext/QX-1.md): a layer over the core's fold, with no HTTP in it. A root
 * with standing may challenge a provisional acceptance inside its window; a panel of three is drawn by sortition from
 * roots with an accepted return on another problem, seeded by the challenge's own chained receipt line, which no party
 * makes alone; two verdicts decide. A held challenge strikes the accepting set's events, and the core's own reducer,
 * run again without them, says what the piece is now; a failed one costs the challenger the stake. The core's state is
 * a coarsening of this layer's: where it says `challenged`, the core says accepted within its window.
 */
import {
  type Address, type Event, type Hash, type PieceState, type PieceView, type Receipt, type ReduceInput, type Return, type State,
  commitHash, eventId, eventSignedByKey, hashCanonical, isHash, orderReceipts, reduce, returnProblems,
} from '@bitquilt/core';

export const EXTENSION = 'QX-1';
export const PANEL = 3;
export const MAJORITY = 2;
export const GROUND_MAX = 200;
export const SEED = 'challenge-receipt';
export const SIDES = ['challenger', 'author'] as const;
export type Side = (typeof SIDES)[number];
export type Outcome = 'open' | 'held' | 'failed' | 'void';
export type LayerState = PieceState | 'challenged';
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

export interface PieceLayer { hash: Hash; name: string; core: PieceState; state: LayerState; challenge: ChallengeView | null }

export interface ProblemLayer {
  problem: Hash;
  /** The core's fold, untouched. */
  core: State;
  /** The core's fold with struck events left out: the same as `core` where nothing was struck. */
  fold: State;
  pieces: PieceLayer[];
  byHash: Map<Hash, PieceLayer>;
  challenges: ChallengeView[];
  dropped: { id: Hash; type: string; why: string }[];
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
}

interface Credit { root: Address; problem: Hash; at: string; until: string | null }
interface Delta { root: Address; at: string; delta: number }
interface Entry { hash: Hash; input: ReduceInput; core: State; fold: State; struck: Set<Hash>; challenges: ChallengeView[]; dropped: ProblemLayer['dropped'] }
interface Candidate { id: Hash; event: Event; at: string; receipt: Receipt; home: Entry }

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

/** The roots whose standing a set credits: the reveals, not the runs. */
function creditedRoots(v: PieceView): Address[] {
  if (!v.accepting) return [];
  return v.accepting.kind === 'agree' ? v.accepting.reveals.map((r) => r.root) : [v.accepting.patch.root];
}

/** The root a key counts for at a time for an extension type, or null when the key may not sign it. */
export function rootFor(state: State, key: Address, type: string, at: string): Address | null {
  const live = state.delegations.find((d) => d.to === key && d.since <= at && (d.revokedAt === null || d.revokedAt > at) && d.expires > at);
  if (live) return live.scope.has(type) ? state.rootOf(key, at) : null;
  if (state.delegations.some((d) => d.to === key) && !state.rotations.has(key)) return null;
  return state.rootOf(key, at);
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
  for (const p of input.problems) {
    const core = reduce(p);
    if (entries.has(core.problem)) continue;
    entries.set(core.problem, { hash: core.problem, input: p, core, fold: core, struck: new Set(), challenges: [], dropped: [] });
  }

  // Standing: credits from the folds as they stand, struck ones kept with the time they were withdrawn, and the stakes.
  const struckCredits: Credit[] = [];
  const deltas: Delta[] = [];
  let credits: Credit[] = [];
  const refreshCredits = () => {
    credits = [];
    for (const e of entries.values()) for (const v of e.fold.pieces) if (v.accepting) for (const r of creditedRoots(v)) credits.push({ root: e.fold.rootOf(r, now), problem: e.hash, at: v.accepting.completedAt, until: null });
  };
  refreshCredits();
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
    const s = standing(root, at);
    if (s < stake) return { ok: false, why: `standing ${s} is below the stake of ${stake}` };
    return { ok: true, root, view, parties, pool: poolFor(home, view, root, parties, at) };
  };

  // Every challenge the entries hold, once each by id, in receipt order across all problems; a verdict is read under its challenge.
  const candidates = new Map<Hash, Candidate>();
  const verdicts = new Map<Hash, { id: Hash; event: Event; at: string }[]>();
  for (const e of entries.values()) for (const { receipt, at, id } of orderReceipts(e.input.receipts)) {
    const ev = receipt.event;
    if (ev.type === 'challenge') {
      if (candidates.has(id)) continue;
      const home = (ev.problem && entries.get(ev.problem)) || e;
      candidates.set(id, { id, event: ev, at, receipt, home });
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
    const drop = (why: string) => home.dropped.push({ id: c.id, type: 'challenge', why });
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
      challenge.struck = setEventIds(view, home.input.receipts);
      const struck = new Set(challenge.struck);
      for (const e of entries.values()) {
        if (!e.input.receipts.some((x) => struck.has(eventId(x.event)))) continue;
        for (const id of struck) e.struck.add(id);
        e.fold = reduce({ ...e.input, receipts: e.input.receipts.filter((x) => !e.struck.has(eventId(x.event))) });
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
      return { hash: v.piece.hash, name: v.piece.name, core, state, challenge: last };
    });
    problems.set(e.hash, { problem: e.hash, core: e.core, fold: e.fold, pieces, byHash: new Map(pieces.map((p) => [p.hash, p])), challenges: e.challenges, dropped: e.dropped });
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

  return { now, problems, challenges: all, standing, admitChallenge, admitVerdict };
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
