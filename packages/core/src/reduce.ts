/**
 * The reducer (CORE.md section 6): state = reduce(envelopes, blobs, receipts, now). Pure. Two clients with the same
 * inputs produce the same state. Everything a client, a tracker, a mirror or a verify script says about a problem is
 * computed here and nowhere else. It is three steps, one function each: `checkChain` reads the envelopes, `fold`
 * takes the receipts in order, `settle` decides every piece at `now`.
 */
import { type Blobs, type Envelope, type Piece, type Settings, CORE_VERIFIERS, PATCH_VERIFIERS, blobProblems, envelopeProblems, expandPieces, inputPieces, problemHash } from './envelope.js';
import { type By, type Event, type Receipt, CORE_EVENT_TYPES, PIECE_EVENT_TYPES, ROOT_ONLY_TYPES, commitHash, earliestReceipt, eventId, eventProblems, eventSignedByKey, rotateSecondSigner, vendorOf } from './events.js';
import { type Hash, hashCanonical } from './hash.js';
import { type Address, signedBy } from './keys.js';
import { byAtThenId, plusHours } from './plain.js';
import { type Return, agreeFields, returnProblems, returnsAgree } from './schema.js';

export type PieceState = 'locked' | 'unknown' | 'open' | 'in_flight' | 'sealed' | 'needs_verify' | 'disputed' | 'accepted_provisional' | 'accepted' | 'unreachable';

export interface Claim { key: Address; root: Address; at: string; until: string; by: By }
export interface Commit { key: Address; root: Address; at: string; h: Hash; abandonAt: string; revealed: boolean }
export interface Reveal { key: Address; root: Address; at: string; return: Return; vendor: string; by: By; digest: Hash }
export interface Run { key: Address; root: Address; at: string; digest: Hash; exit: number; score?: number; image?: string; host: string; by: By }

export type AcceptingSet =
  | { kind: 'agree'; reveals: [Reveal, Reveal]; completedAt: string }
  | { kind: 'check' | 'score'; patch: Reveal; runs: [Run, Run]; completedAt: string; score?: number };

export interface PieceView {
  piece: Piece;
  state: PieceState;
  claims: Claim[];
  commits: Commit[];
  reveals: Reveal[];
  runs: Run[];
  declined: Set<Address>;
  accepting: AcceptingSet | null;
  windowEnd: string | null;
  availability: number;
  dependents: number;
  frontier: { score: number; run: Run } | null;
}

export interface Delegation { root: Address; to: Address; scope: Set<string>; since: string; expires: string; revokedAt: string | null }

export interface State {
  problem: Hash;
  envelope: Envelope;
  chain: Envelope[];
  pieces: PieceView[];
  byHash: Map<Hash, PieceView>;
  names: Map<Address, { name: string; agent: boolean }>;
  versions: Map<string, Hash>;
  delegations: Delegation[];
  rotations: Map<Address, Address>;
  weights: Map<Address, number>;
  output: { document: unknown; hash: Hash } | null;
  dropped: { id: Hash; type: string; why: string }[];
  complete: boolean;
  /** The root a key counts for at a time, through any live delegation and the rotations. */
  rootOf: (key: Address, at: string) => Address;
  /** Whether two roots are the same, or one a delegate of the other, as judged at a time. */
  related: (a: Address, b: Address, at: string) => boolean;
}

export interface ReduceInput {
  envelopes: Envelope[];
  blobs: Blobs;
  receipts: Receipt[];
  now: string;
}

/** The receipts in the order the reducer folds them (section 6, Order): receipted first, by earliest receipt then id; the rest by ts then id. */
export function orderReceipts(receipts: Receipt[]): { receipt: Receipt; at: string; id: Hash }[] {
  const items = receipts.map((receipt) => ({ receipt, at: earliestReceipt(receipt), id: eventId(receipt.event) }));
  const received = items.filter((x) => x.at !== null) as { receipt: Receipt; at: string; id: Hash }[];
  const withoutWrapper = items.filter((x) => x.at === null).map((x) => ({ receipt: x.receipt, at: x.receipt.event.ts, id: x.id }));
  received.sort(byAtThenId);
  withoutWrapper.sort(byAtThenId);
  return [...received, ...withoutWrapper];
}

/** Roots, delegates and rotations as the fold builds them (section 6, Roots and delegates). */
class Roots {
  readonly delegations: Delegation[] = [];
  readonly rotations = new Map<Address, Address>();
  /** Every key with a prior event (section 4): one whose core event passed shape, signature and standing, and one a kept rotate named as `to`. */
  readonly prior = new Set<Address>();

  hasPrior(key: Address): boolean {
    return this.prior.has(key);
  }

  /** Whether the key has been delegated to or rotated from: then it is no root. */
  isDelegateOfAnyone(key: Address): boolean {
    return this.delegations.some((d) => d.to === key) || this.rotations.has(key);
  }

  /** Whether a delegation stands at `at`: begun by then, not yet expired, and not revoked by then. */
  private live(d: Delegation, at: string): boolean {
    return d.since <= at && d.expires > at && (d.revokedAt === null || d.revokedAt > at);
  }

  /** The delegation under which `key` may sign `type` at `at`, or null. */
  liveDelegation(key: Address, type: string, at: string): Delegation | null {
    for (const d of this.delegations) if (d.to === key && this.live(d, at) && d.scope.has(type)) return d;
    return null;
  }

  /** The root `key` counts for at `at`: through a live delegation of any scope, or through a rotation, or itself. */
  rootOf(key: Address, at: string): Address {
    for (const d of this.delegations) if (d.to === key && this.live(d, at)) return this.final(d.root);
    const rotated = this.rotations.get(key);
    return rotated ? this.final(rotated) : key;
  }

  /**
   * The standing of `key` to sign an event of `type` at `at`: the root it counts for, or why it counts for nobody
   * (section 6, Roots and delegates, and the Drop list). A delegate signs within its scope; a root rotated from is a
   * delegate of the new root for every type (section 4); neither signs what only a root signs.
   */
  standing(key: Address, type: string, at: string): { root: Address } | { why: string } {
    const d = this.liveDelegation(key, type, at);
    const rotated = this.rotations.get(key);
    if ((d || rotated) && ROOT_ONLY_TYPES.includes(type)) return { why: `a ${type} is signed by a root` };
    if (d) return { root: this.final(d.root) };
    if (rotated) return { root: this.final(rotated) };
    if (this.isDelegateOfAnyone(key)) return { why: 'the delegation does not cover this event' };
    return { root: key };
  }

  /** The root `root` has become through rotations. */
  final(root: Address): Address {
    let r = root;
    const guard = new Set<Address>();
    while (this.rotations.has(r) && !guard.has(r)) {
      guard.add(r);
      r = this.rotations.get(r)!;
    }
    return r;
  }

  /** Whether two roots are the same, or one a delegate of the other, as judged at `at`. */
  related(a: Address, b: Address, at: string): boolean {
    if (this.final(a) === this.final(b)) return true;
    for (const d of this.delegations) {
      // A delegation begun and not revoked by `at` relates its two keys; its expiry is not read here, where `live` would
      // read it. Section 6 says "with delegations as live then"; the behaviour is left as it is for the maintainers to decide.
      if (d.since > at || (d.revokedAt !== null && d.revokedAt <= at)) continue;
      if ((d.to === a && this.final(d.root) === this.final(b)) || (d.to === b && this.final(d.root) === this.final(a))) return true;
    }
    return false;
  }
}

/** The envelopes once checked: this problem's, its hash, the chain along `prev`, and the hashes in it. */
interface Checked { envelope: Envelope; problem: Hash; chain: Envelope[]; chainHashes: Set<Hash> }

/** What the fold leaves for `settle`: the roots as they stand at its end, the names, the versions, and what was dropped. */
interface Folded { roots: Roots; names: State['names']; versions: State['versions']; dropped: State['dropped'] }

export function reduce(input: ReduceInput): State {
  const checked = checkChain(input.envelopes, input.blobs);
  // Pieces: this problem's expansion, by hash; ancestors' pieces that are not in it are not pieces of this problem.
  const pieces = expandPieces(checked.envelope.problem, input.blobs);
  const views = new Map<Hash, PieceView>();
  for (const piece of pieces) {
    views.set(piece.hash, { piece, state: 'open', claims: [], commits: [], reveals: [], runs: [], declined: new Set(), accepting: null, windowEnd: null, availability: 0, dependents: 0, frontier: null });
  }
  const folded = fold(input.receipts, views, checked.chainHashes, checked.envelope.problem.settings);
  return settle(checked, pieces, views, folded, input.now);
}

/**
 * Section 6, Envelopes: "Each is checked against its hash and its owner's signature; each blob against its hash."
 * The first envelope is this problem's; the chain follows `prev` through the rest, and stops at an envelope that is
 * missing, by another owner, invalid, or already in the chain. "An envelope that fails its checks makes the input
 * invalid: reduce refuses it and produces no state."
 */
function checkChain(envelopes: Envelope[], blobs: Blobs): Checked {
  if (envelopes.length === 0) throw new Error('no envelope');
  const envelope = envelopes[0]!;
  const envProblems = envelopeProblems(envelope);
  if (envProblems.length) throw new Error(`envelope: ${envProblems[0]}`);
  if (!signedBy(envelope as unknown as Record<string, unknown>, envelope.problem.owner)) throw new Error('envelope: not signed by its owner');
  const bp = blobProblems(envelope.problem, blobs);
  if (bp.length) throw new Error(bp[0]);
  const problem = problemHash(envelope);

  const envelopesByHash = new Map(envelopes.map((e) => [problemHash(e), e] as const));
  const chain: Envelope[] = [envelope];
  const chainHashes = new Set<Hash>([problem]);
  for (let cur = envelope; cur.problem.prev; ) {
    const prev = envelopesByHash.get(cur.problem.prev);
    if (!prev) break;
    if (prev.problem.owner !== cur.problem.owner) break;
    if (envelopeProblems(prev).length || !signedBy(prev as unknown as Record<string, unknown>, prev.problem.owner) || blobProblems(prev.problem, blobs).length) break;
    if (chainHashes.has(cur.problem.prev)) break;
    chain.push(prev);
    chainHashes.add(cur.problem.prev);
    cur = prev;
  }
  return { envelope, problem, chain, chainHashes };
}

/**
 * Section 6, Order: "Receipted events sort by the earliest received.at across the wrapper, then by event id. Events
 * with no wrapper sort after every receipted event, by ts, then by id." Each event in that order is checked for its
 * shape, its signature and its key's standing, then for what it names, then by its type's own rule; what fails is
 * dropped with its reason (section 6, Drop). An event of a type the core does not define is passed over: not folded,
 * not dropped, and no key's prior event (section 4).
 */
function fold(receipts: Receipt[], views: Map<Hash, PieceView>, chainHashes: Set<Hash>, settings: Settings): Folded {
  const roots = new Roots();
  const names: State['names'] = new Map();
  const versions: State['versions'] = new Map();
  const dropped: State['dropped'] = [];
  const drop = (e: Event, why: string) => dropped.push({ id: eventId(e), type: e.type, why });

  for (const { receipt, at } of orderReceipts(receipts)) {
    const e = receipt.event;
    if (!(CORE_EVENT_TYPES as readonly string[]).includes(e.type)) continue;
    const shape = eventProblems(e);
    if (shape.length) {
      drop(e, shape[0]!);
      continue;
    }
    if (!eventSignedByKey(e)) {
      drop(e, 'signature is not the key\'s');
      continue;
    }
    const s = roots.standing(e.key, e.type, at);
    if ('why' in s) {
      drop(e, s.why);
      continue;
    }
    const { root } = s;
    // Section 4, A prior event: "A key has a prior event once a core event signed by it has passed the checks of shape,
    // signature and standing as a root or live delegate, whether or not it was then dropped for what it names." So the
    // key is recorded here, before the problem and piece checks and before the type's own.
    roots.prior.add(e.key);

    const view = e.piece ? views.get(e.piece) : undefined;
    if (PIECE_EVENT_TYPES.includes(e.type)) {
      if (!e.problem || !chainHashes.has(e.problem)) {
        drop(e, 'names a problem outside the chain');
        continue;
      }
      if (!view) {
        drop(e, 'names a piece this problem does not have');
        continue;
      }
    }
    if ((e.type === 'version' || e.type === 'output') && (!e.problem || !chainHashes.has(e.problem))) {
      drop(e, 'names a problem outside the chain');
      continue;
    }
    const body = e.body as Record<string, unknown>;

    switch (e.type) {
      case 'claim': {
        const v = view!;
        const lease = (body.lease_h as number | undefined) ?? v.piece.lease_h ?? settings.lease_h;
        v.claims.push({ key: e.key, root, at, until: plusHours(at, lease), by: body.by as By });
        break;
      }
      case 'commit': {
        const v = view!;
        const lease = v.piece.lease_h ?? settings.lease_h;
        v.commits.push({ key: e.key, root, at, h: body.h as Hash, abandonAt: plusHours(at, 2 * lease), revealed: false });
        break;
      }
      case 'reveal': {
        const v = view!;
        const ret = body.return as Record<string, unknown>;
        const nonce = body.nonce as string;
        const h = commitHash(ret, nonce);
        const commit = v.commits.find((c) => c.key === e.key && c.h === h && !c.revealed);
        if (!commit) {
          drop(e, 'no commit by this key with this hash');
          break;
        }
        if (commit.abandonAt <= at) {
          drop(e, 'the commit was abandoned before the reveal');
          break;
        }
        if (PATCH_VERIFIERS.includes(v.piece.verifier)) {
          const keys = Object.keys(ret);
          if (keys.length !== 1 || typeof ret.patch !== 'string' || ret.patch.length > settings.patch_max) {
            drop(e, 'a check or score return is { patch } within patch_max');
            break;
          }
        } else if (v.piece.schema) {
          const rp = returnProblems(v.piece.schema, ret);
          if (rp.length) {
            drop(e, rp[0]!);
            break;
          }
        }
        commit.revealed = true;
        const by = body.by as By;
        v.reveals.push({ key: e.key, root, at, return: ret, vendor: vendorOf(by.model), by, digest: hashCanonical(ret) });
        break;
      }
      case 'decline': {
        view!.declined.add(root);
        break;
      }
      case 'run': {
        const v = view!;
        if (!PATCH_VERIFIERS.includes(v.piece.verifier)) {
          drop(e, 'a run belongs to a check or score piece');
          break;
        }
        const digest = body.digest as Hash;
        const patch = v.reveals.find((r) => r.digest === digest);
        if (!patch) {
          drop(e, 'the digest is no revealed return of the piece');
          break;
        }
        if (v.piece.check?.image !== undefined && body.image !== v.piece.check.image) {
          drop(e, 'not in the declared image');
          break;
        }
        if (roots.related(root, patch.root, at)) {
          drop(e, 'a run by the patch\'s author');
          break;
        }
        const run: Run = { key: e.key, root, at, digest, exit: body.exit as number, host: body.host as string, by: body.by as By };
        if (body.score !== undefined) run.score = body.score as number;
        if (body.image !== undefined) run.image = body.image as string;
        v.runs.push(run);
        break;
      }
      case 'name': {
        names.set(root, { name: body.name as string, agent: body.agent === true });
        break;
      }
      case 'delegate': {
        const to = body.to as Address;
        if (roots.hasPrior(to)) {
          drop(e, 'the delegate has a prior event');
          break;
        }
        if (roots.isDelegateOfAnyone(to)) {
          drop(e, 'the delegate is another root\'s');
          break;
        }
        roots.delegations.push({ root: e.key, to, scope: new Set(body.scope as string[]), since: at, expires: body.expires as string, revokedAt: null });
        break;
      }
      case 'revoke': {
        const of = body.of as Address;
        let any = false;
        for (const d of roots.delegations) if (d.root === e.key && d.to === of && d.revokedAt === null) {
          d.revokedAt = at;
          any = true;
        }
        if (!any) drop(e, 'revokes a key that is not this root\'s delegate');
        break;
      }
      case 'rotate': {
        const to = body.to as Address;
        if (rotateSecondSigner(e) !== to) {
          drop(e, 'sig_to does not recover to the new root');
          break;
        }
        if (roots.hasPrior(to)) {
          drop(e, 'the new root has a prior event');
          break;
        }
        if (roots.isDelegateOfAnyone(to)) {
          drop(e, 'the new root is another root\'s delegate');
          break;
        }
        roots.rotations.set(e.key, to);
        // Section 4: a key has a prior event "once a kept rotate names it as to".
        roots.prior.add(to);
        break;
      }
      case 'version': {
        versions.set(`${root}/${body.slug as string}`, body.hash as Hash);
        break;
      }
      case 'output':
        break;
    }
  }
  return { roots, names, versions, dropped };
}

/**
 * Section 6, Per piece: "A piece's state is a function of the sets of its live claims, its unabandoned commits, its
 * valid reveals and its runs at now, not a token moved by transitions." Each piece's accepting set and window first,
 * then the roots' weights, the dependents, the states (a piece's inputs before it), the availabilities, and, when
 * every piece is accepted or unreachable, the output.
 */
function settle(checked: Checked, pieces: Piece[], views: Map<Hash, PieceView>, folded: Folded, now: string): State {
  const { envelope, problem, chain } = checked;
  const { roots, names, versions, dropped } = folded;
  const settings = envelope.problem.settings;
  const ownerRoot = envelope.problem.owner as Address;

  for (const v of views.values()) decideAccepting(v, roots, ownerRoot, settings.challenge_window_h);
  const weights = computeWeights(views, roots);
  const list = pieces.map((p) => views.get(p.hash)!);
  for (const v of list) v.dependents = 0;
  for (const v of list) for (const entry of v.piece.inputs) for (const dep of inputPieces(entry, pieces)) views.get(dep.hash)!.dependents++;

  const stateMemo = new Map<Hash, PieceState>();
  /** The state of one piece at `now`, its inputs' states first; memoised, and a cycle of inputs is locked. */
  function stateOf(v: PieceView, trail: Set<Hash>): PieceState {
    const memo = stateMemo.get(v.piece.hash);
    if (memo) return memo;
    if (trail.has(v.piece.hash)) return 'locked';
    trail.add(v.piece.hash);
    let s: PieceState;
    const inputsDone = v.piece.inputs.every((entry) => inputPieces(entry, pieces).every((dep) => {
      const ds = stateOf(views.get(dep.hash)!, trail);
      return ds === 'accepted' || ds === 'unreachable';
    }));
    if (!inputsDone) s = 'locked';
    else if (!(CORE_VERIFIERS as readonly string[]).includes(v.piece.verifier)) s = 'unknown';
    else if (v.accepting) {
      if (v.windowEnd !== null && now < v.windowEnd) s = 'accepted_provisional';
      else s = isUnreachable(v) ? 'unreachable' : 'accepted';
    } else if (hasDispute(v, roots)) s = 'disputed';
    else if (v.reveals.length) s = 'needs_verify';
    else if (v.commits.some((c) => !c.revealed && c.abandonAt > now)) s = 'sealed';
    else if (v.claims.some((c) => c.until > now)) s = 'in_flight';
    else s = 'open';
    stateMemo.set(v.piece.hash, s);
    return s;
  }
  for (const v of list) v.state = stateOf(v, new Set());
  for (const v of list) v.availability = availabilityOf(v, now, (r) => weights.get(roots.final(r)) ?? 1);

  const complete = list.length > 0 && list.every((v) => v.state === 'accepted' || v.state === 'unreachable');
  const output = complete ? assembleOutput(problem, list) : null;

  return {
    problem, envelope, chain, pieces: list, byHash: views, names, versions, delegations: roots.delegations, rotations: roots.rotations, weights, output, dropped, complete,
    rootOf: (key, at) => roots.rootOf(key, at),
    related: (a, b, at) => roots.related(a, b, at),
  };
}

/** The piece's accepting set by its verifier's rule, its frontier for a score piece, and its window from the set's completion. */
function decideAccepting(v: PieceView, roots: Roots, owner: Address, windowH: number): void {
  const p = v.piece;
  if (PATCH_VERIFIERS.includes(p.verifier)) {
    v.accepting = acceptingRuns(v, roots, owner);
    if (p.verifier === 'score') v.frontier = frontierOf(v, roots, owner);
  } else if (p.verifier === 'agree' && p.schema) {
    v.accepting = acceptingReveals(v, roots, owner);
  }
  // Section 6: "A window runs from the receipt c of the event that completed the set while now < c + challenge_window_h."
  v.windowEnd = v.accepting ? plusHours(v.accepting.completedAt, windowH) : null;
}

/** A pair of runs that could accept a check or score piece, with the patch they ran and, for a score piece, the pair's score by `better`. */
interface RunPair { patch: Reveal; a: Run; b: Run; score?: number }

/**
 * The pairs of runs that qualify (section 6), in search order: the patches in receipt order, then the later run, then
 * the earlier. A run counts at the patch's digest, "with exit 0", "from roots unrelated to each other" and "unrelated
 * to the owner" (the patch's author's own run was dropped at the fold); for a score piece, "two run events whose score
 * values are within the check's tolerance of each other", the pair's score the better of the two.
 */
function qualifyingRuns(v: PieceView, roots: Roots, owner: Address): RunPair[] {
  const p = v.piece;
  const tolerance = p.check?.tolerance ?? 0;
  const better = p.check?.better ?? 'higher';
  const out: RunPair[] = [];
  for (const patch of v.reveals) {
    const runs = v.runs.filter((r) => r.digest === patch.digest && !roots.related(r.root, owner, r.at));
    for (let j = 0; j < runs.length; j++) {
      const b = runs[j]!;
      if (b.exit !== 0) continue;
      for (let i = 0; i < j; i++) {
        const a = runs[i]!;
        if (a.exit !== 0 || roots.related(a.root, b.root, b.at)) continue;
        if (p.verifier !== 'score') {
          out.push({ patch, a, b });
          continue;
        }
        if (a.score === undefined || b.score === undefined || Math.abs(a.score - b.score) > tolerance) continue;
        out.push({ patch, a, b, score: better === 'higher' ? Math.max(a.score, b.score) : Math.min(a.score, b.score) });
      }
    }
  }
  return out;
}

/**
 * Section 6: "for check: a revealed { patch }, and two run events with exit 0 at that patch's digest, in the declared
 * image, from roots unrelated to each other and to the root that revealed the patch"; "for score: as check, with two
 * run events whose score values are within the check's tolerance of each other. The accepting set is the pair
 * completed first."
 */
function acceptingRuns(v: PieceView, roots: Roots, owner: Address): AcceptingSet | null {
  let best: AcceptingSet | null = null;
  for (const { patch, a, b, score } of qualifyingRuns(v, roots, owner)) {
    if (best && b.at >= best.completedAt) continue;
    // A check piece's pairs carry no score; a score piece's every one does.
    best = score === undefined ? { kind: 'check', patch, runs: [a, b], completedAt: b.at } : { kind: 'score', patch, runs: [a, b], completedAt: b.at, score };
  }
  return best;
}

/**
 * Section 6: "the frontier is the best score, by the check's better, among every pair of qualifying runs within
 * tolerance, whether or not that pair is the set." The run kept is the later of the first pair to reach that score.
 */
function frontierOf(v: PieceView, roots: Roots, owner: Address): { score: number; run: Run } | null {
  const better = v.piece.check?.better ?? 'higher';
  let frontier: { score: number; run: Run } | null = null;
  for (const { b, score } of qualifyingRuns(v, roots, owner)) {
    if (score === undefined) continue;
    if (!frontier || (better === 'higher' ? score > frontier.score : score < frontier.score)) frontier = { score, run: b };
  }
  return frontier;
}

/**
 * Section 6: "for agree: two valid reveals from unrelated roots of different vendors that agree on the agree fields
 * after canonicalisation. Reveals are taken in receipt order, and a reveal counts only when its root is unrelated to
 * the owner and to the root of every earlier reveal on the piece; among counting reveals, the first pair in receipt
 * order whose vendors differ and whose agree fields agree is the accepting set, completed at the receipt of its later
 * reveal." The earlier reveals a reveal is held against are the counting ones, the owner's left out.
 */
function acceptingReveals(v: PieceView, roots: Roots, owner: Address): AcceptingSet | null {
  const p = v.piece;
  if (!p.schema) return null;
  const fields = agreeFields(p.schema, p.agree);
  const reveals = v.reveals.filter((r) => !roots.related(r.root, owner, r.at));
  for (let j = 0; j < reveals.length; j++) {
    const b = reveals[j]!;
    if (reveals.slice(0, j).some((a) => roots.related(a.root, b.root, b.at))) continue;
    for (let i = 0; i < j; i++) {
      const a = reveals[i]!;
      if (a.vendor === b.vendor) continue;
      if (returnsAgree(p.schema, fields, a.return, b.return)) return { kind: 'agree', reveals: [a, b], completedAt: b.at };
    }
  }
  return null;
}

/** Section 6: "disputed: two reveals from unrelated roots that differ on an agree field, and no accepting set." The set is the caller's question. */
function hasDispute(v: PieceView, roots: Roots): boolean {
  const p = v.piece;
  if (p.verifier !== 'agree' || !p.schema) return false;
  const fields = agreeFields(p.schema, p.agree);
  for (let j = 0; j < v.reveals.length; j++) for (let i = 0; i < j; i++) {
    const a = v.reveals[i]!;
    const b = v.reveals[j]!;
    if (!roots.related(a.root, b.root, b.at) && !returnsAgree(p.schema, fields, a.return, b.return)) return true;
  }
  return false;
}

/** Section 6: "where the accepting set's first reveal has the value unreachable in an agree field whose schema is an enum that lists it". */
function isUnreachable(v: PieceView): boolean {
  if (!v.accepting || v.accepting.kind !== 'agree' || !v.piece.schema) return false;
  const fields = agreeFields(v.piece.schema, v.piece.agree);
  const agreed = v.accepting.reveals[0].return;
  return fields.some((f) => {
    const def = v.piece.schema!.properties[f];
    return def !== undefined && 'enum' in def && def.enum.includes('unreachable') && agreed[f] === 'unreachable';
  });
}

/** Section 6: "A root's weight is (its reveals in accepting sets in this chain + 1) / (its claims in this chain + 1), bounded to [0.1, 1]." */
function computeWeights(views: Map<Hash, PieceView>, roots: Roots): Map<Address, number> {
  const claims = new Map<Address, number>();
  const accepted = new Map<Address, number>();
  for (const v of views.values()) {
    for (const c of v.claims) {
      const r = roots.final(c.root);
      claims.set(r, (claims.get(r) ?? 0) + 1);
    }
    if (v.accepting?.kind === 'agree') for (const r of v.accepting.reveals) {
      const f = roots.final(r.root);
      accepted.set(f, (accepted.get(f) ?? 0) + 1);
    }
    if (v.accepting && v.accepting.kind !== 'agree') {
      const f = roots.final(v.accepting.patch.root);
      accepted.set(f, (accepted.get(f) ?? 0) + 1);
    }
  }
  const weights = new Map<Address, number>();
  for (const r of new Set([...claims.keys(), ...accepted.keys()])) {
    const w = ((accepted.get(r) ?? 0) + 1) / ((claims.get(r) ?? 0) + 1);
    weights.set(r, Math.min(1, Math.max(0.1, w)));
  }
  return weights;
}

/**
 * Section 6: "Availability of a piece is the sum over its live claims of the claimant root's weight, plus its
 * unabandoned commits and its reveals." `claimWeight` gives a claimant root's weight; `next` passes zero in endgame.
 */
export function availabilityOf(v: PieceView, now: string, claimWeight: (root: Address) => number): number {
  let a = 0;
  for (const c of v.claims) if (c.until > now) a += claimWeight(c.root);
  for (const c of v.commits) if (!c.revealed && c.abandonAt > now) a += 1;
  a += v.reveals.length;
  return a;
}

/** Section 6, Output: the document and its hash, one entry per piece in file order. */
function assembleOutput(problem: Hash, list: PieceView[]): { document: unknown; hash: Hash } {
  const pieces = list.map((v) => {
    const base = { name: v.piece.name, piece: v.piece.hash, state: v.state };
    if (!v.accepting) return base;
    if (v.accepting.kind === 'agree') {
      const fields = agreeFields(v.piece.schema!, v.piece.agree);
      const agreed: Record<string, unknown> = {};
      for (const f of fields) agreed[f] = v.accepting.reveals[0].return[f];
      const evidence = v.accepting.reveals.map((r) => {
        const rest: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(r.return)) if (!fields.includes(k)) rest[k] = val;
        return { signer: r.root, ...rest };
      });
      return { ...base, agreed, evidence };
    }
    return { ...base, patch: v.accepting.patch.return.patch, author: v.accepting.patch.root, runs: v.accepting.runs.map((r) => ({ signer: r.root, exit: r.exit, score: r.score, image: r.image, host: r.host })) };
  });
  const document = { quilt: 1, problem, pieces };
  return { document, hash: hashCanonical(document) };
}
