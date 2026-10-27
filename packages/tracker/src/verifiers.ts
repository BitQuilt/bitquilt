/**
 * Three verifier kinds the core does not know, as a layer over its fold (docs/ext/verifiers.md): `human` (QX-3), two
 * people at seats a tracker opened for them agreeing; `judge:n` (QX-2), a panel of n drawn by the challenge window's
 * sortition ranking the candidates blind; `attest` (QX-10), the actor's own signed record, accepted at once and marked
 * the weakest kind. No HTTP in it, and the core's reducer is untouched: it holds these pieces as `unknown`, and this
 * layer decides on top, so a core client's map is coarse and never wrong. The accepting set this layer records has the
 * shape of the core's `agree` set with one more field, `via`, naming the kind, so code that reads the core's shapes
 * (`next`, the brief's slots, the challenge window) reads it; `viaOf` tells the two apart.
 */
import {
  type AcceptingSet, type Address, type Event, type Hash, type PieceState, type PieceView, type Receipt, type Return, type Reveal, type State,
  agreeFields, byAtThenId, eventSignedByKey, inputPieces, isHash, isRecord, orderReceipts, plusHours, returnsAgree,
} from '@bitquilt/core';
import { drawOrder, offerSeats } from './sortition.js';

export const EXTENSIONS = { human: 'QX-3', judge: 'QX-2', attest: 'QX-10' } as const;
export const RANK_EVENTS: ReadonlySet<string> = new Set(['rank']);
/** Candidates a judge piece takes when its definition names no count. */
export const DEFAULT_CANDIDATES = 2;
/** The seed a judge panel is drawn from, named for the well-known document: the receipt line of the piece's first candidate. */
export const JUDGE_SEED = 'first-candidate-receipt';
const CORE_KINDS: ReadonlySet<string> = new Set(['check', 'score', 'agree']);
const JUDGE = /^judge:([1-9]\d{0,2})$/;

export type Kind = 'check' | 'score' | 'agree' | 'human' | 'judge' | 'attest';
export type Via = 'human' | 'judge' | 'attest';
/** How a kind earns a square, strongest first: reproduced by runs, agreed by two, judged by a panel, attested by the actor alone. */
export type Strength = 'reproduced' | 'agreed' | 'judged' | 'attested';
export const STRENGTHS: readonly Strength[] = ['reproduced', 'agreed', 'judged', 'attested'];
export type LayerPieceState = PieceState | 'judging';
export type PanelOutcome = 'open' | 'decided' | 'void';

export interface KindInfo {
  verifier: string;
  /** Null for a kind neither the core nor this layer implements. */
  kind: Kind | null;
  /** The registry number for an extension kind, null for the core's three. */
  extension: string | null;
  strength: Strength | null;
  /** What earns the square, in words. */
  says: string;
  /** The attest kind alone: the actor's own word, marked on the square. */
  weakest: boolean;
  /** For judge:n, n. */
  panel: number | null;
}

export interface RankView { id: Hash; key: Address; root: Address; at: string; ranking: Hash[] }
export interface PanelSeat { root: Address; offeredAt: string; lapsedAt: string | null; rank: RankView | null }
export interface Candidate { digest: Hash; key: Address; root: Address; at: string; return: Return }
export interface PanelView {
  piece: Hash;
  name: string;
  /** n, the seats; the majority that decides; the candidates the piece asked for. */
  panel: number;
  majority: number;
  wanted: number;
  /** In receipt order; the digest is what a rank names. */
  candidates: Candidate[];
  seed: string | null;
  /** The receipt of the candidate that completed the set: when the seats were offered. */
  completedAt: string;
  /** The pool in draw order. */
  order: Address[];
  seats: PanelSeat[];
  outcome: PanelOutcome;
  /** The digest a majority ranked first. */
  winner: Hash | null;
  decidedAt: string | null;
  /** Ranks that did not count, with why. */
  dropped: { id: Hash; why: string }[];
}

/** The layer's accepting set: the core's agree shape, one or two reveals, and the kind it came by. */
export type ExtAccepting = { kind: 'agree'; via: Via; reveals: Reveal[]; completedAt: string };

export interface Layered {
  /** The core's fold with these kinds decided: the pieces cloned, their states this layer's; `complete` recomputed; `output` the core's. */
  fold: State;
  panels: PanelView[];
  byPiece: Map<Hash, PanelView>;
  kinds: Map<Hash, KindInfo>;
  /** Pieces `next` is not to offer here: a judge piece whose panel sits or ran out. */
  unoffered: Set<Hash>;
  dropped: { id: Hash; type: string; why: string }[];
}

export interface VerifierOptions {
  /** The roots a judge panel on `problem` may be drawn from at `at`: credits on other problems as the caller holds them, less those related to any of `unrelatedTo`. */
  pool(problem: Hash, at: string, unrelatedTo: Address[], fold: State): Address[];
}

/** A piece's lease in hours: the piece's `lease_h`, else the problem's (QX-15 section 3 names the rule; the core sets both). */
export function leaseOf(fold: State, view: PieceView): number {
  return view.piece.lease_h ?? fold.envelope.problem.settings.lease_h;
}

/** The problem's challenge window in hours. */
export function windowOf(fold: State): number {
  return fold.envelope.problem.settings.challenge_window_h;
}

/** The owner's root at a time. */
export function ownerOf(fold: State, at: string): Address {
  return fold.rootOf(fold.envelope.problem.owner as Address, at);
}

/** The kind a verifier name is, with n for judge:n, or null. */
export function kindOf(verifier: string): { kind: Kind; panel: number | null } | null {
  if (CORE_KINDS.has(verifier)) return { kind: verifier as Kind, panel: null };
  if (verifier === 'human' || verifier === 'attest') return { kind: verifier, panel: null };
  const m = JUDGE.exec(verifier);
  return m ? { kind: 'judge', panel: Number(m[1]) } : null;
}

/** A verifier in words: its kind, its registry number, how it earns a square, and whether it is the weakest kind. */
export function describeKind(verifier: string): KindInfo {
  const k = kindOf(verifier);
  if (!k) return { verifier, kind: null, extension: null, strength: null, says: 'a kind this tracker does not implement', weakest: false, panel: null };
  switch (k.kind) {
    case 'check':
      return { verifier, kind: 'check', extension: null, strength: 'reproduced', says: 'a patch that two unrelated runs reproduce', weakest: false, panel: null };
    case 'score':
      return { verifier, kind: 'score', extension: null, strength: 'reproduced', says: 'a patch that two unrelated runs score within tolerance', weakest: false, panel: null };
    case 'agree':
      return { verifier, kind: 'agree', extension: null, strength: 'agreed', says: 'two returns from different vendors agree', weakest: false, panel: null };
    case 'human':
      return { verifier, kind: 'human', extension: EXTENSIONS.human, strength: 'agreed', says: 'two people at seats a tracker opened for them agree', weakest: false, panel: null };
    case 'judge':
      return { verifier, kind: 'judge', extension: EXTENSIONS.judge, strength: 'judged', says: `a panel of ${k.panel} drawn by sortition ranks the candidates and a majority's first choice is accepted`, weakest: false, panel: k.panel };
    case 'attest':
      return { verifier, kind: 'attest', extension: EXTENSIONS.attest, strength: 'attested', says: 'the actor\'s own signed record, accepted at once and open to challenge for the window', weakest: true, panel: null };
  }
}

/** The kind an accepting set came by, or null for one the core made. */
export function viaOf(set: AcceptingSet | null | undefined): Via | null {
  return set && 'via' in set ? (set as unknown as ExtAccepting).via : null;
}

/** Why this is not a well-formed rank body, or nothing. Whether the digests are the piece's candidates is the panel's question. */
export function rankBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const r = body.ranking;
  if (!Array.isArray(r) || r.length === 0 || !r.every((d) => isHash(d))) return ['body.ranking: a list of candidate digests, first choice first'];
  if (new Set(r).size !== r.length) return ['body.ranking: each digest once'];
  return [];
}

/** The root a key counts for at a time for an extension type, or null when the key may not sign it. */
export function rootFor(state: State, key: Address, type: string, at: string): Address | null {
  const live = state.delegations.find((d) => d.to === key && d.since <= at && (d.revokedAt === null || d.revokedAt > at) && d.expires > at);
  if (live) return live.scope.has(type) ? state.rootOf(key, at) : null;
  if (state.delegations.some((d) => d.to === key) && !state.rotations.has(key)) return null;
  return state.rootOf(key, at);
}

/** Why a root has no live seat on a panel, or null when it has one. */
export function panelSeatProblem(panel: PanelView, root: Address): string | null {
  const seats = panel.seats.filter((s) => s.root === root);
  if (seats.length === 0) return 'not a judge drawn for this piece';
  if (seats.some((s) => s.rank)) return 'this judge has ranked';
  if (seats.every((s) => s.lapsedAt !== null)) return 'this seat lapsed';
  return null;
}

/** Why a ranking is not the panel's candidates each once, or null. */
export function rankingProblem(panel: PanelView, ranking: unknown): string | null {
  if (!Array.isArray(ranking)) return 'body.ranking: a list of candidate digests, first choice first';
  const digests = new Set(panel.candidates.map((c) => c.digest));
  if (ranking.length !== digests.size || !ranking.every((d) => digests.has(d as Hash))) return `body.ranking: the ${digests.size} candidate digests, each once`;
  return null;
}

/** Whether a reveal came from a person's seat: the receipt says `seat: person` or `custody: hosted`, or the client declared the model `human`. */
export function fromPersonSeat(reveal: Reveal, receipt: Receipt | undefined): boolean {
  if (reveal.by.model === 'human') return true;
  return receipt?.received.some((r) => r.seat === 'person' || r.custody === 'hosted') ?? false;
}

interface Line { receipt: Receipt; id: Hash }
interface Rank { id: Hash; event: Event; at: string }

/** What deciding a piece of one of these kinds reads: the fold being decided, its owner and window, the receipt line of a reveal, the time, and the caller's pool. */
interface Context {
  fold: State;
  owner: Address;
  windowH: number;
  lineOf: (piece: Hash, r: Reveal) => Line | undefined;
  now: string;
  options: VerifierOptions;
}

/**
 * The verifier kinds decided over a core fold (verifiers.md section 1): the piece views cloned, each attest, human and
 * judge piece decided from the receipts, every state recomputed so the core's own pieces keep the core's word except
 * one the core locked behind a piece of these kinds, and `complete` recomputed. `options.pool` is the caller's credits,
 * from which a judge panel is drawn.
 */
export function applyVerifiers(core: State, receipts: Receipt[], now: string, options: VerifierOptions): Layered {
  const owner = core.envelope.problem.owner as Address;
  const windowH = windowOf(core);

  // The receipt line of each reveal, by piece, key and time, and the ranks by piece, each once by id.
  const revealLines = new Map<string, Line>();
  const ranks = new Map<Hash, Rank[]>();
  for (const { receipt, at, id } of orderReceipts(receipts)) {
    const ev = receipt.event;
    if (ev.type === 'reveal' && ev.piece) {
      const k = `${ev.piece}|${ev.key}|${at}`;
      if (!revealLines.has(k)) revealLines.set(k, { receipt, id });
    } else if (ev.type === 'rank' && ev.piece && ev.problem === core.problem) {
      const list = ranks.get(ev.piece) ?? [];
      if (!list.some((r) => r.id === id)) list.push({ id, event: ev, at });
      ranks.set(ev.piece, list);
    }
  }
  const lineOf = (piece: Hash, r: Reveal): Line | undefined => revealLines.get(`${piece}|${r.key}|${r.at}`);

  const views: PieceView[] = core.pieces.map((v) => ({ ...v }));
  const byHash = new Map(views.map((v) => [v.piece.hash, v] as const));
  const fold: State = { ...core, pieces: views, byHash };
  const panels: PanelView[] = [];
  const byPiece = new Map<Hash, PanelView>();
  const kinds = new Map<Hash, KindInfo>();
  const unoffered = new Set<Hash>();
  const dropped: Layered['dropped'] = [];
  /** The reveals that count on a human piece: from a person's seat, unrelated to the owner. */
  const counted = new Map<Hash, Reveal[]>();
  const cx: Context = { fold, owner, windowH, lineOf, now, options };

  for (const v of views) {
    const info = describeKind(v.piece.verifier);
    kinds.set(v.piece.hash, info);
    if (info.kind === 'attest') decideAttest(v, cx);
    else if (info.kind === 'human') counted.set(v.piece.hash, decideHuman(v, cx));
    else if (info.kind === 'judge') {
      const panel = decideJudge(v, cx, info.panel!, ranks.get(v.piece.hash) ?? []);
      if (!panel) continue;
      panels.push(panel);
      byPiece.set(v.piece.hash, panel);
      for (const d of panel.dropped) dropped.push({ id: d.id, type: 'rank', why: d.why });
      if (panel.outcome !== 'decided') unoffered.add(v.piece.hash);
    }
  }

  // States: the core's for its own kinds where it had one; this layer's for its kinds and for what the core locked behind them.
  const pieces = views.map((v) => v.piece);
  const memo = new Map<Hash, LayerPieceState>();
  const stateOf = (v: PieceView, trail: Set<Hash>): LayerPieceState => {
    const hit = memo.get(v.piece.hash);
    if (hit) return hit;
    if (trail.has(v.piece.hash)) return 'locked';
    trail.add(v.piece.hash);
    const inputsDone = v.piece.inputs.every((entry) => inputPieces(entry, pieces).every((dep) => {
      const ds = stateOf(byHash.get(dep.hash)!, trail);
      return ds === 'accepted' || ds === 'unreachable';
    }));
    let s: LayerPieceState;
    const info = kinds.get(v.piece.hash)!;
    if (!inputsDone) s = 'locked';
    else if (info.kind === null) s = 'unknown';
    else if (CORE_KINDS.has(info.kind) && v.state !== 'locked') s = v.state;
    else {
      const panel = byPiece.get(v.piece.hash);
      if (panel?.outcome === 'open') s = 'judging';
      else if (panel?.outcome === 'void') s = 'disputed';
      else if (v.accepting) s = v.windowEnd !== null && now < v.windowEnd ? 'accepted_provisional' : isUnreachable(v) ? 'unreachable' : 'accepted';
      else if (hasDispute(v, fold, info.kind === 'human' ? counted.get(v.piece.hash) ?? [] : v.reveals)) s = 'disputed';
      else if (v.reveals.length) s = 'needs_verify';
      else if (v.commits.some((c) => !c.revealed && c.abandonAt > now)) s = 'sealed';
      else if (v.claims.some((c) => c.until > now)) s = 'in_flight';
      else s = 'open';
    }
    memo.set(v.piece.hash, s);
    return s;
  };
  for (const v of views) v.state = stateOf(v, new Set()) as PieceState;
  fold.complete = views.length > 0 && views.every((v) => v.state === 'accepted' || v.state === 'unreachable');

  return { fold, panels, byPiece, kinds, unoffered, dropped };
}

/** The first valid reveal from a root unrelated to the owner accepts the piece at once (QX-10); the window runs from its receipt. */
function decideAttest(v: PieceView, { fold, owner, windowH }: Context): void {
  const r = v.reveals.find((x) => !fold.related(x.root, owner, x.at));
  if (!r) return;
  const set: ExtAccepting = { kind: 'agree', via: 'attest', reveals: [r], completedAt: r.at };
  v.accepting = set as unknown as AcceptingSet;
  v.windowEnd = plusHours(r.at, windowH);
}

/** As agree, with the vendor rule replaced by the seat (QX-3): two reveals from unrelated roots, each from a person's seat, agreeing on the agree fields. */
function decideHuman(v: PieceView, { fold, owner, windowH, lineOf }: Context): Reveal[] {
  const schema = v.piece.schema;
  if (!schema) return [];
  const fields = agreeFields(schema, v.piece.agree);
  const counted = v.reveals.filter((r) => !fold.related(r.root, owner, r.at) && fromPersonSeat(r, lineOf(v.piece.hash, r)?.receipt));
  for (let j = 0; j < counted.length && !v.accepting; j++) {
    const b = counted[j]!;
    if (counted.slice(0, j).some((a) => fold.related(a.root, b.root, b.at))) continue;
    for (let i = 0; i < j; i++) {
      const a = counted[i]!;
      if (returnsAgree(schema, fields, a.return, b.return)) {
        const set: ExtAccepting = { kind: 'agree', via: 'human', reveals: [a, b], completedAt: b.at };
        v.accepting = set as unknown as AcceptingSet;
        break;
      }
    }
  }
  v.windowEnd = v.accepting ? plusHours(v.accepting.completedAt, windowH) : null;
  return counted;
}

/**
 * The candidates are the first `candidates` reveals from roots unrelated to the owner and to each other, with distinct
 * digests (QX-2); once they are in, a panel of n is drawn from the pool at that receipt, seeded by the first candidate's
 * receipt line, and the ranks are folded in receipt order. Null while the candidates are not yet in.
 */
function decideJudge(v: PieceView, { fold, owner, windowH, lineOf, now, options }: Context, n: number, ranks: Rank[]): PanelView | null {
  const wanted = v.piece.candidates ?? DEFAULT_CANDIDATES;
  const chosen: Reveal[] = [];
  for (const r of v.reveals) {
    if (chosen.length >= wanted) break;
    if (fold.related(r.root, owner, r.at)) continue;
    if (chosen.some((c) => c.digest === r.digest || fold.related(c.root, r.root, r.at))) continue;
    chosen.push(r);
  }
  if (chosen.length < wanted) return null;
  const first = chosen[0]!;
  const last = chosen[chosen.length - 1]!;
  const seed = lineOf(v.piece.hash, first)?.receipt.hash ?? null;
  const panel: PanelView = {
    piece: v.piece.hash, name: v.piece.name, panel: n, majority: Math.floor(n / 2) + 1, wanted,
    candidates: chosen.map((r) => ({ digest: r.digest, key: r.key, root: r.root, at: r.at, return: r.return })),
    seed, completedAt: last.at, order: [], seats: [], outcome: 'open', winner: null, decidedAt: null, dropped: [],
  };
  const pool = options.pool(fold.problem, last.at, [owner, ...v.reveals.map((r) => r.root)], fold);
  if (pool.length < n) {
    panel.outcome = 'void';
    panel.decidedAt = last.at;
    return panel;
  }
  if (seed === null) return panel;
  panel.order = drawOrder(seed, pool);
  seatPanel(panel, fold, leaseOf(fold, v), ranks.sort(byAtThenId), now);
  if (panel.outcome === 'decided') {
    const winner = chosen.find((r) => r.digest === panel.winner)!;
    const set: ExtAccepting = { kind: 'agree', via: 'judge', reveals: [winner], completedAt: panel.decidedAt! };
    v.accepting = set as unknown as AcceptingSet;
    v.windowEnd = plusHours(panel.decidedAt!, windowH);
  }
  return panel;
}

/** Offers the seats, lapses and replaces them by the lease (sortition.ts), folds the ranks in receipt order, and decides on a majority's first choice. */
function seatPanel(panel: PanelView, fold: State, leaseH: number, ranks: Rank[], now: string): void {
  const { seats, advance, ranOut, lastLapse } = offerSeats<PanelSeat>(panel.order, panel.panel, panel.completedAt, leaseH, (root, offeredAt) => ({ root, offeredAt, lapsedAt: null, rank: null }), (s) => s.rank !== null);
  panel.seats = seats;
  const firsts = new Map<Hash, number>();
  for (const r of ranks) {
    const drop = (why: string) => panel.dropped.push({ id: r.id, why });
    if (panel.outcome !== 'open') {
      drop('the panel has decided');
      continue;
    }
    const ev = r.event;
    if (!eventSignedByKey(ev)) {
      drop('signature is not the key\'s');
      continue;
    }
    const shape = rankBodyProblems(ev.body);
    if (shape.length) {
      drop(shape[0]!);
      continue;
    }
    advance(r.at);
    const root = rootFor(fold, ev.key, 'rank', r.at);
    if (!root) {
      drop('the key may not sign a rank');
      continue;
    }
    const why = panelSeatProblem(panel, root);
    if (why) {
      drop(why);
      continue;
    }
    const ranking = ev.body.ranking as Hash[];
    const rp = rankingProblem(panel, ranking);
    if (rp) {
      drop(rp);
      continue;
    }
    const open = seats.find((s) => s.root === root && s.lapsedAt === null && !s.rank)!;
    open.rank = { id: r.id, key: ev.key, root, at: r.at, ranking };
    const top = ranking[0]!;
    const count = (firsts.get(top) ?? 0) + 1;
    firsts.set(top, count);
    if (count >= panel.majority) {
      panel.outcome = 'decided';
      panel.winner = top;
      panel.decidedAt = r.at;
    }
  }
  if (panel.outcome === 'open') {
    advance(now);
    if (ranOut()) {
      panel.outcome = 'void';
      panel.decidedAt = lastLapse() ?? now;
    }
  }
}

/** Two of the reveals given, from unrelated roots, that differ on an agree field. */
function hasDispute(v: PieceView, fold: State, reveals: Reveal[]): boolean {
  const schema = v.piece.schema;
  if (!schema) return false;
  const fields = agreeFields(schema, v.piece.agree);
  for (let j = 0; j < reveals.length; j++) for (let i = 0; i < j; i++) {
    const a = reveals[i]!;
    const b = reveals[j]!;
    if (!fold.related(a.root, b.root, b.at) && !returnsAgree(schema, fields, a.return, b.return)) return true;
  }
  return false;
}

/** As the core: the agreed return has `unreachable` in a field whose schema allows it. */
function isUnreachable(v: PieceView): boolean {
  const schema = v.piece.schema;
  if (!v.accepting || v.accepting.kind !== 'agree' || !schema) return false;
  const fields = agreeFields(schema, v.piece.agree);
  const agreed = v.accepting.reveals[0].return;
  return fields.some((f) => {
    const def = schema.properties[f];
    return def !== undefined && 'enum' in def && def.enum.includes('unreachable') && agreed[f] === 'unreachable';
  });
}
