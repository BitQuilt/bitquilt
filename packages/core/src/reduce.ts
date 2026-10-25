/**
 * The reducer (CORE.md section 6): state = reduce(envelopes, blobs, receipts, now). Pure. Two clients with the same
 * inputs produce the same state. Everything a client, a tracker, a mirror or a verify script says about a problem is
 * computed here and nowhere else.
 */
import { type Blobs, type Envelope, type Piece, blobProblems, envelopeProblems, expandPieces, inputPieces, problemHash } from './envelope.js';
import { type By, type Event, type Receipt, commitHash, earliestReceipt, eventId, eventProblems, eventSignedByKey, rotateSecondSigner, vendorOf } from './events.js';
import { type Hash, hashCanonical } from './hash.js';
import { type Address, signedBy } from './keys.js';
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

const CORE_TYPES: ReadonlySet<string> = new Set(['claim', 'commit', 'reveal', 'decline', 'run', 'name', 'delegate', 'revoke', 'rotate', 'version', 'output']);
const ROOT_ONLY: ReadonlySet<string> = new Set(['delegate', 'revoke', 'rotate', 'version']);
const MACHINE: ReadonlySet<string> = new Set(['check', 'score']);
const CORE_VERIFIERS: ReadonlySet<string> = new Set(['check', 'score', 'agree']);

const ms = (t: string): number => Date.parse(t);
const plusHours = (t: string, h: number): string => new Date(ms(t) + h * 3_600_000).toISOString();

/** The receipts in the order the reducer folds them: receipted first by earliest receipt then id; the rest by ts then id. */
export function orderReceipts(receipts: Receipt[]): { receipt: Receipt; at: string; id: Hash }[] {
  const items = receipts.map((receipt) => ({ receipt, at: earliestReceipt(receipt), id: eventId(receipt.event) }));
  const received = items.filter((x) => x.at !== null) as { receipt: Receipt; at: string; id: Hash }[];
  const bare = items.filter((x) => x.at === null).map((x) => ({ receipt: x.receipt, at: x.receipt.event.ts, id: x.id }));
  received.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  bare.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...received, ...bare];
}

class Roots {
  readonly delegations: Delegation[] = [];
  readonly rotations = new Map<Address, Address>();
  readonly seen = new Set<Address>();

  /** Whether this key has ever appeared as an event's key. */
  hasPrior(key: Address): boolean {
    return this.seen.has(key);
  }

  isDelegateOfAnyone(key: Address): boolean {
    return this.delegations.some((d) => d.to === key) || this.rotations.has(key);
  }

  /** The delegation under which `key` may sign `type` at `at`, or null. A rotated-from root is a delegate of the new for every type. */
  liveDelegation(key: Address, type: string, at: string): Delegation | null {
    for (const d of this.delegations) {
      if (d.to !== key) continue;
      if (d.since > at) continue;
      if (d.revokedAt !== null && d.revokedAt <= at) continue;
      if (d.expires <= at) continue;
      if (!d.scope.has(type)) continue;
      return d;
    }
    return null;
  }

  /** The root `key` counts for at `at` under any live delegation, or through a rotation, or itself. */
  rootOfAny(key: Address, at: string): Address {
    for (const d of this.delegations) {
      if (d.to !== key || d.since > at || (d.revokedAt !== null && d.revokedAt <= at) || d.expires <= at) continue;
      return this.final(d.root);
    }
    const rotated = this.rotations.get(key);
    return rotated ? this.final(rotated) : key;
  }

  /** The root an event by `key` of `type` counts for at `at`, or null when the key may not sign it. */
  rootAt(key: Address, type: string, at: string): Address | null {
    const d = this.liveDelegation(key, type, at);
    if (d) return this.final(d.root);
    const rotated = this.rotations.get(key);
    if (rotated) return this.final(rotated);
    return key;
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
      if (d.since > at || (d.revokedAt !== null && d.revokedAt <= at)) continue;
      if ((d.to === a && this.final(d.root) === this.final(b)) || (d.to === b && this.final(d.root) === this.final(a))) return true;
    }
    return false;
  }
}

export function reduce(input: ReduceInput): State {
  const { blobs, now } = input;
  if (input.envelopes.length === 0) throw new Error('no envelope');
  const envelope = input.envelopes[0]!;
  const envProblems = envelopeProblems(envelope);
  if (envProblems.length) throw new Error(`envelope: ${envProblems[0]}`);
  if (!signedBy(envelope as unknown as Record<string, unknown>, envelope.problem.owner)) throw new Error('envelope: not signed by its owner');
  const bp = blobProblems(envelope.problem, blobs);
  if (bp.length) throw new Error(bp[0]);
  const problem = problemHash(envelope);

  // The chain of ancestors along prev, each checked.
  const byHash = new Map(input.envelopes.map((e) => [problemHash(e), e] as const));
  const chain: Envelope[] = [envelope];
  const chainHashes = new Set<Hash>([problem]);
  for (let cur = envelope; cur.problem.prev; ) {
    const prev = byHash.get(cur.problem.prev);
    if (!prev) break;
    if (prev.problem.owner !== cur.problem.owner) break;
    if (envelopeProblems(prev).length || !signedBy(prev as unknown as Record<string, unknown>, prev.problem.owner) || blobProblems(prev.problem, blobs).length) break;
    if (chainHashes.has(cur.problem.prev)) break;
    chain.push(prev);
    chainHashes.add(cur.problem.prev);
    cur = prev;
  }

  // Pieces: this problem's expansion, by hash; ancestors' pieces that are not in it are not pieces of this problem.
  const pieces = expandPieces(envelope.problem, blobs);
  const views = new Map<Hash, PieceView>();
  for (const piece of pieces) {
    views.set(piece.hash, { piece, state: 'open', claims: [], commits: [], reveals: [], runs: [], declined: new Set(), accepting: null, windowEnd: null, availability: 0, dependents: 0, frontier: null });
  }
  const settings = envelope.problem.settings;
  const ownerRoot = envelope.problem.owner as Address;

  const roots = new Roots();
  const names = new Map<Address, { name: string; agent: boolean }>();
  const versions = new Map<string, Hash>();
  const dropped: State['dropped'] = [];
  const drop = (e: Event, why: string) => dropped.push({ id: eventId(e), type: e.type, why });

  for (const { receipt, at } of orderReceipts(input.receipts)) {
    const e = receipt.event;
    if (!CORE_TYPES.has(e.type)) continue;
    const shape = eventProblems(e);
    if (shape.length) {
      drop(e, shape[0]!);
      continue;
    }
    if (!eventSignedByKey(e)) {
      drop(e, 'signature is not the key\'s');
      continue;
    }
    const isDelegate = roots.liveDelegation(e.key, e.type, at) !== null || roots.rotations.has(e.key);
    if (ROOT_ONLY.has(e.type) && isDelegate) {
      drop(e, `a ${e.type} is signed by a root`);
      continue;
    }
    const root = roots.rootAt(e.key, e.type, at);
    if (root === null) {
      drop(e, 'the key may not sign this type');
      continue;
    }
    if (roots.isDelegateOfAnyone(e.key) && roots.liveDelegation(e.key, e.type, at) === null && !roots.rotations.has(e.key)) {
      drop(e, 'the delegation does not cover this event');
      continue;
    }
    roots.seen.add(e.key);

    const view = e.piece ? views.get(e.piece) : undefined;
    const aboutPiece = ['claim', 'commit', 'reveal', 'decline', 'run'].includes(e.type);
    if (aboutPiece) {
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
        if (MACHINE.has(v.piece.verifier)) {
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
        if (!MACHINE.has(v.piece.verifier)) {
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
        roots.seen.add(to);
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

  // Accepting sets, states, weights, availability.
  for (const v of views.values()) decideAccepting(v, roots, ownerRoot, now, settings.challenge_window_h);
  const weights = computeWeights(views, roots);
  const stateMemo = new Map<Hash, PieceState>();
  const list = pieces.map((p) => views.get(p.hash)!);
  for (const v of list) v.dependents = 0;
  for (const v of list) for (const entry of v.piece.inputs) for (const dep of inputPieces(entry, pieces)) views.get(dep.hash)!.dependents++;
  const stateOf = (v: PieceView, trail: Set<Hash>): PieceState => {
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
    else if (!CORE_VERIFIERS.has(v.piece.verifier)) s = 'unknown';
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
  };
  for (const v of list) v.state = stateOf(v, new Set());
  for (const v of list) v.availability = availabilityOf(v, weights, roots, now, false);

  const complete = list.length > 0 && list.every((v) => v.state === 'accepted' || v.state === 'unreachable');
  const output = complete ? assembleOutput(problem, list) : null;

  return {
    problem, envelope, chain, pieces: list, byHash: views, names, versions, delegations: roots.delegations, rotations: roots.rotations, weights, output, dropped, complete,
    rootOf: (key, at) => roots.rootOfAny(key, at),
    related: (a, b, at) => roots.related(a, b, at),
  };
}

function decideAccepting(v: PieceView, roots: Roots, owner: Address, now: string, windowH: number): void {
  const p = v.piece;
  if (MACHINE.has(p.verifier)) {
    // A revealed patch and two runs with exit 0 (scores within tolerance) from roots unrelated to each other and to the author.
    const tolerance = p.check?.tolerance ?? 0;
    const better = p.check?.better ?? 'higher';
    let best: AcceptingSet | null = null;
    for (const patch of v.reveals) {
      const runs = v.runs.filter((r) => r.digest === patch.digest && !roots.related(r.root, owner, r.at));
      for (let j = 0; j < runs.length; j++) {
        const b = runs[j]!;
        if (b.exit !== 0) continue;
        for (let i = 0; i < j; i++) {
          const a = runs[i]!;
          if (a.exit !== 0 || roots.related(a.root, b.root, b.at)) continue;
          if (p.verifier === 'score') {
            if (a.score === undefined || b.score === undefined || Math.abs(a.score - b.score) > tolerance) continue;
            const score = better === 'higher' ? Math.max(a.score, b.score) : Math.min(a.score, b.score);
            if (!v.frontier || (better === 'higher' ? score > v.frontier.score : score < v.frontier.score)) v.frontier = { score, run: b };
            if (!best || b.at < best.completedAt) best = { kind: 'score', patch, runs: [a, b], completedAt: b.at, score };
          } else if (!best || b.at < best.completedAt) best = { kind: 'check', patch, runs: [a, b], completedAt: b.at };
        }
      }
    }
    v.accepting = best;
  } else if (p.verifier === 'agree' && p.schema) {
    const fields = agreeFields(p.schema, p.agree);
    const reveals = v.reveals.filter((r) => !roots.related(r.root, owner, r.at));
    for (let j = 0; j < reveals.length && !v.accepting; j++) {
      const b = reveals[j]!;
      // b counts only if unrelated to every earlier revealer.
      if (reveals.slice(0, j).some((a) => roots.related(a.root, b.root, b.at))) continue;
      for (let i = 0; i < j; i++) {
        const a = reveals[i]!;
        if (a.vendor === b.vendor) continue;
        if (returnsAgree(p.schema, fields, a.return, b.return)) {
          v.accepting = { kind: 'agree', reveals: [a, b], completedAt: b.at };
          break;
        }
      }
    }
  }
  v.windowEnd = v.accepting ? plusHours(v.accepting.completedAt, windowH) : null;
}

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

function isUnreachable(v: PieceView): boolean {
  if (!v.accepting || v.accepting.kind !== 'agree' || !v.piece.schema) return false;
  const fields = agreeFields(v.piece.schema, v.piece.agree);
  const agreed = v.accepting.reveals[0].return;
  return fields.some((f) => {
    const def = v.piece.schema!.properties[f];
    return def !== undefined && 'enum' in def && def.enum.includes('unreachable') && agreed[f] === 'unreachable';
  });
}

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

/** Live claims weighted by the claimant's record, plus unabandoned commits and reveals. In endgame, live claims count zero. */
export function availabilityOf(v: PieceView, weights: Map<Address, number>, roots: Roots | null, now: string, endgame: boolean): number {
  let a = 0;
  if (!endgame) for (const c of v.claims) if (c.until > now) a += weights.get(roots ? roots.final(c.root) : c.root) ?? 1;
  for (const c of v.commits) if (!c.revealed && c.abandonAt > now) a += 1;
  a += v.reveals.length;
  return a;
}

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

export { Roots };
