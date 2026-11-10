/**
 * QX-22 from the client's side: a piece proposed beside a problem, and the owner's take of proposed pieces into a
 * version. The body's shape, the hash a proposed piece has and the proposals that stand are the tracker's rules (its
 * own propose.ts) written a second time, since this package imports the core alone, and test/propose.test.ts holds the
 * two files to the same answers. A take rests on the signed events of the chain this client resolved and on no
 * tracker's listing, so nothing unsigned decides what the owner signs. Here too is the fork of QX-23 section 5, where
 * a key that is not the owner pursues a proposed piece: the problem's pieces kept under this home's key, and each
 * proposed piece named added as a take adds one (test/fork.test.ts). Each act works through the door its Quilt hands
 * it (door.ts): the version or the fork is published as the sharpening publishes a version (sharpen.ts, `republish`),
 * and the Quilt's `propose`, `take`, `takeDue` and `fork` call these.
 */
import {
  type Address,
  type Envelope,
  type Hash,
  type PieceDef,
  type Problem,
  type Receipt,
  type Reveal,
  type State,
  SLUG_RULE,
  canonicalBytes,
  envelopeProblems,
  eventId,
  eventSignedByKey,
  expandPieces,
  isHash,
  isRecord,
  isSlug,
  orderReceipts,
  plainTextProblems,
} from '@bitquilt/core';
import type { Door } from './door.js';
import { parseLink } from './link.js';
import { kindWords } from './render.js';
import type { Posted, Resolved } from './resolver.js';
import { FROZEN, republish } from './sharpen.js';

/** QX-22 section 1: "`why` is the proposer's reason, text of at most 500 characters through the plain-text gate." */
export const PROPOSE_WHY_MAX = 500;

/** QX-22 section 1: "`piece` is at most 16,384 bytes as canonical JSON." */
export const PROPOSED_MAX = 16_384;

const NOT_OWNER = 'only the owner takes a proposed piece';
const NO_WORK = 'its proposer has no work standing on the problem';
const UNKNOWN_KIND = 'its kind is one this client does not implement';
const NAME_HELD = 'the problem has a piece of that name';
const NO_ROOM = 'the budget has no room for it';
const NOT_TAKEN = 'no tracker took the version';

/**
 * Why this is not a well-formed propose body, or nothing (QX-22 section 1): one piece under a slug, no family and no
 * data, of a bounded size, with a reason, and the gate on the two texts a person reads. "A proposed piece does not
 * wait on itself". The tracker's `proposeBodyProblems`, fault for fault.
 */
export function proposeBodyProblems(body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  if (!isSlug(body.name)) out.push(`body.name: ${SLUG_RULE}`);
  const piece = body.piece;
  if (!isRecord(piece)) out.push('body.piece: an object');
  else {
    if (piece.count !== undefined) out.push('body.piece.count: a proposal is one piece and has no count');
    if (piece.data !== undefined) out.push('body.piece.data: a proposed piece draws on no data');
    if (sizeOf(piece) > PROPOSED_MAX) out.push(`body.piece: at most ${PROPOSED_MAX} bytes as canonical JSON`);
    if (Array.isArray(piece.inputs) && piece.inputs.includes(body.name))
      out.push('body.piece.inputs: a proposed piece does not wait on itself');
    if (typeof piece.brief === 'string') out.push(...plainTextProblems(piece.brief, 'body.piece.brief'));
  }
  if (typeof body.why !== 'string' || !body.why.trim() || body.why.length > PROPOSE_WHY_MAX)
    out.push(`body.why: text of at most ${PROPOSE_WHY_MAX} characters`);
  else out.push(...plainTextProblems(body.why, 'body.why'));
  for (const k of Object.keys(body))
    if (!['name', 'piece', 'why'].includes(k)) out.push(`body.${k}: not a field of a proposal`);
  return out;
}

/** A value's size as canonical JSON, and past any bound where it has no canonical form. */
function sizeOf(value: unknown): number {
  try {
    return canonicalBytes(value).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * QX-22 section 1: "A proposed piece is named by the hash it has in any envelope that takes it under its name." A
 * single piece's hash reads its name and its own fields and nothing of the problem around it (CORE.md section 3), so
 * it is had from the body alone; null where the piece cannot be expanded.
 */
export function proposedHash(name: string, piece: PieceDef): Hash | null {
  try {
    const alone = { pieces: { [name]: piece }, data: {} } as unknown as Problem;
    return expandPieces(alone, new Map())[0]?.hash ?? null;
  } catch {
    return null;
  }
}

/** A proposal that stands on a problem's chain. */
export interface Proposal {
  /** The propose event's id. */
  id: Hash;
  /** The version of the problem the event names. */
  under: Hash;
  name: string;
  /** The hash the piece has in any envelope that takes it under this name. */
  hash: Hash;
  piece: PieceDef;
  why: string;
  key: Address;
  /** The root the key counted for when the proposal was received. */
  root: Address;
  at: string;
}

/**
 * QX-22 section 2: "The proposals that stand on a problem are the well-formed `propose` events on its chain, in
 * receipt order. Of several proposals of one piece by one root, the first stands and the rest are passed over."
 * Well-formed is the body's shape and the signature of the event's own key, which this client asks of a chain it did
 * not admit. The tracker's `standingProposals`, proposal for proposal.
 */
export function standingProposals(
  receipts: Receipt[],
  rootOf: (key: Address, at: string) => Address,
  now: string,
): Proposal[] {
  const out: Proposal[] = [];
  const seen = new Set<string>();
  const received = receipts.filter((r) => r.event.type === 'propose' && r.received.length > 0);
  for (const { receipt, at, id } of orderReceipts(received)) {
    const e = receipt.event;
    if (at > now || !e.problem || e.piece !== undefined || proposeBodyProblems(e.body).length) continue;
    if (!eventSignedByKey(e)) continue;
    const { name, piece, why } = e.body as { name: string; piece: PieceDef; why: string };
    const hash = proposedHash(name, piece);
    if (!hash) continue;
    const root = rootOf(e.key, at);
    const once = `${root.toLowerCase()} ${hash}`;
    if (seen.has(once)) continue;
    seen.add(once);
    out.push({ id, under: e.problem, name, hash, piece, why, key: e.key, root, at });
  }
  return out;
}

/** The version of a problem that would hold these pieces: `prev` the version before it, the budget as given. */
function versionWith(head: Envelope, prev: Hash, pieces: Record<string, PieceDef>, budget: number): Envelope {
  const p = head.problem;
  return { ...head, problem: { ...p, prev, settings: { ...p.settings, budget }, pieces } };
}

/**
 * Every fault of a proposal at once, before it is signed: the body's shape; then the name against the version it is
 * proposed under; then what the door asks, QX-22 section 1: "The door holds the piece to every rule a version that
 * took it would be held to at publish, with room made for the one piece in the budget, which is the owner's to give".
 * A fault of the piece is said of `body.piece`, as the door says it, and the bounds a tracker sets for itself are its
 * own to refuse by.
 */
export function proposalProblems(under: Hash, head: Envelope, body: unknown): string[] {
  const shape = proposeBodyProblems(body);
  if (shape.length) return shape;
  const { name, piece } = body as { name: string; piece: PieceDef };
  const p = head.problem;
  if (Object.hasOwn(p.pieces, name)) return [`body.name: this problem has a piece named ${name}`];
  if (Object.hasOwn(p.pieces, `${name}/*`)) return [`body.name: this problem has a family named ${name}`];
  const where = `problem.pieces.${name}`;
  const draft = versionWith(head, under, { ...p.pieces, [name]: piece }, p.settings.budget + 1);
  const out = envelopeProblems(draft).map((fault) =>
    fault.startsWith(`${where}.`) || fault.startsWith(`${where}:`) ? `body.piece${fault.slice(where.length)}` : fault,
  );
  if (!out.length && !proposedHash(name, piece)) out.push('body.piece: a piece its hash can name');
  return out;
}

/** A proposal's faults as one message, as a pattern's are said before it publishes. */
export function proposalProblemsText(faults: string[]): string {
  const n = faults.length;
  return `${n} problem${n === 1 ? '' : 's'} in the proposed piece, each to fix before it is proposed:\n${faults.join('\n')}`;
}

/** A piece proposed: the propose event's id, the version it names, the name, the piece's hash, and where it went. */
export interface Proposed extends Posted {
  id: Hash;
  problem: Hash;
  name: string;
  piece: Hash;
}

/**
 * QX-22 section 1: one piece proposed beside a problem, under the version this client resolved, with the proposer's
 * reason. The proposal is held to every fault this client can name before it is signed, and a problem its owner
 * replaced takes none here, since the work is on the version that replaced it. Nothing is earned and nothing is
 * staked: the proposal stands as a record, and the piece joins the map where the owner takes it into a version.
 */
export async function propose(
  door: Door,
  input: string,
  name: string,
  piece: PieceDef,
  why: string,
): Promise<Proposed> {
  const id = door.needKey();
  const { state, superseded } = await door.open(input);
  if (superseded) throw new Error(`that problem was replaced by its owner; the work is on ${superseded}`);
  const under = state.problem;
  const body = { name, piece, why: typeof why === 'string' ? why.trim() : why };
  const faults = proposalProblems(under, state.envelope, body);
  if (faults.length) throw new Error(proposalProblemsText(faults));
  const { event, posted } = await door.postSigned(
    { quilt: 1, type: 'propose', problem: under, key: id.address, ts: door.stamp(), body },
    under,
    door.trackersFor(under),
    'proposed piece',
  );
  return { ...posted, id: eventId(event), problem: under, name, piece: proposedHash(name, piece) as Hash };
}

/**
 * QX-22 section 3: the roots with work standing on the problem, "a root of an accepting set on a piece of the problem
 * or of an ancestor, or of a reading that stands on a record piece", read over the core's fold of the chain this
 * client resolved. The readings that stand on a record piece are QX-20 section 2's: each valid reveal whose root is
 * unrelated to the owner and to every earlier standing reading's root, until the piece has the readings it asks for.
 */
function workersOf(state: State): Set<string> {
  const out = new Set<string>();
  for (const v of [...state.byHash.values(), ...state.ancestral.values()]) {
    const set = v.accepting;
    if (!set) continue;
    const roots =
      set.kind === 'agree' ? set.reveals.map((r) => r.root) : [set.patch.root, ...set.runs.map((r) => r.root)];
    for (const root of roots) out.add(root.toLowerCase());
  }
  const owner = state.envelope.problem.owner as Address;
  for (const v of state.pieces) {
    if (kindWords(v.piece.verifier).kind !== 'record') continue;
    const wanted = Number(v.piece.verifier.slice('record:'.length));
    const standing: Reveal[] = [];
    for (const r of v.reveals) {
      if (standing.length >= wanted) break;
      if (state.related(r.root, owner, r.at)) continue;
      if (standing.some((s) => state.related(s.root, r.root, r.at))) continue;
      standing.push(r);
    }
    for (const r of standing) out.add(r.root.toLowerCase());
  }
  return out;
}

/**
 * QX-22 section 4: "A proposal waits while no version after the one it names, up to the head, holds its piece." The
 * line is read from its first version to the head, the head's pieces from the fold and an older version's from its
 * envelope; a proposal that names a version outside the line read is passed over.
 */
function waitingOf(state: State, resolved: Resolved, now: string): Proposal[] {
  const line = state.chain
    .map((envelope, i) => ({ hash: i === 0 ? state.problem : state.chain[i - 1]!.problem.prev, envelope }))
    .reverse();
  const place = new Map(line.map((v, i) => [v.hash, i] as const));
  const held = new Map<number, Set<Hash>>();
  const holds = (i: number, piece: Hash): boolean => {
    let set = held.get(i);
    if (!set) {
      set = new Set<Hash>();
      if (i === line.length - 1) for (const h of state.byHash.keys()) set.add(h);
      else {
        try {
          for (const p of expandPieces(line[i]!.envelope.problem, resolved.blobs)) set.add(p.hash);
        } catch {
          // A version this client cannot expand holds no piece it can name.
        }
      }
      held.set(i, set);
    }
    return set.has(piece);
  };
  return standingProposals(resolved.receipts, state.rootOf, now).filter((p) => {
    const i = place.get(p.under);
    if (i === undefined) return false;
    for (let k = i + 1; k < line.length; k++) if (holds(k, p.hash)) return false;
    return true;
  });
}

/**
 * QX-22 section 4: a take, or not: each proposed piece that waited, with the propose event's id, its name, its hash
 * and its proposer's root, whether the version took it and why not; and the version published with those taken.
 */
export interface Taken {
  problem: Hash;
  pieces: { id: Hash; name: string; piece: Hash; by: Address; taken: boolean; why: string | null }[];
  hash: Hash | null;
  posted: string[];
  refused: string[];
}

/**
 * QX-22 section 4: the owner's take of proposed pieces into a version, `prev` this one, each piece under its
 * proposal's name as proposed. "The owner's node takes a waiting proposal by default when its proposer's root is the
 * owner's own or has work standing on the problem, its name is free at the head, and the budget has room for it, in
 * receipt order." With names, each the name, the piece's hash or the propose event's id of a waiting proposal: "A take
 * by name takes any waiting proposal and raises the budget to fit." The default leaves a piece whose kind this client
 * does not implement, and either way each piece is held to the version that would take it, so one that no longer fits
 * the head is left with the fault. The version is published as a sharpening's is, with the gold the home holds
 * committed again; a frozen problem gets none, and a problem already replaced is left as it is, the home noting which
 * version replaced which. `now` is the clock the receipts are read by.
 */
export async function take(
  door: Door,
  problem: Hash,
  names: string[] = [],
  now = new Date().toISOString(),
): Promise<Taken> {
  const id = door.needKey();
  if (door.library.problems[problem]?.frozen) throw new Error(FROZEN);
  // The owner's turn reads every problem of the home each hour, so the read leaves the library's dates as they were.
  const { state, superseded } = await door.open(problem, false);
  const old = state.envelope.problem;
  if (old.owner.toLowerCase() !== id.address.toLowerCase()) throw new Error(NOT_OWNER);
  const entry = door.library.problems[problem];
  if (superseded) {
    if (entry && entry.next !== superseded) {
      entry.next = superseded;
      door.save();
    }
    return { problem, pieces: [], hash: superseded, posted: [], refused: [] };
  }
  const resolved = await door.resolve(parseLink(problem));
  if (!resolved) throw new Error('no resolver answered for that hash');
  const waiting = waitingOf(state, resolved, now);

  // By name, the first waiting proposal each name finds, in receipt order; by default, every one that waits.
  const byName = names.length > 0;
  const named = new Set<Hash>();
  for (const n of names) {
    const found = waiting.find((p) => p.name === n || p.hash === n || p.id === n);
    if (!found) throw new Error(`no proposed piece waits on that problem under ${n}`);
    named.add(found.id);
  }
  const candidates = byName ? waiting.filter((p) => named.has(p.id)) : waiting;

  const workers = workersOf(state);
  const pieces: Record<string, PieceDef> = { ...old.pieces };
  let total = state.pieces.length;
  const added = new Set<Hash>();
  const left = new Map<Hash, string>();
  for (const p of candidates) {
    // Two roots that proposed one piece: the version that takes the first holds the second's piece too.
    if (added.has(p.hash)) continue;
    const whyNot = (): string | null => {
      if (!byName) {
        const own = p.root.toLowerCase() === state.rootOf(old.owner as Address, p.at).toLowerCase();
        if (!own && !workers.has(p.root.toLowerCase())) return NO_WORK;
        if (kindWords(p.piece.verifier).strength === 'unknown') return UNKNOWN_KIND;
      }
      if (Object.hasOwn(pieces, p.name) || Object.hasOwn(pieces, `${p.name}/*`)) return NAME_HELD;
      // "The budget is the room a problem has to grow": the default take stays inside it, a take by name raises it.
      if (!byName && total + 1 > old.settings.budget) return NO_ROOM;
      const budget = Math.max(old.settings.budget, total + 1);
      return (
        envelopeProblems(versionWith(state.envelope, problem, { ...pieces, [p.name]: p.piece }, budget))[0] ?? null
      );
    };
    const why = whyNot();
    if (why !== null) {
      left.set(p.id, why);
      continue;
    }
    pieces[p.name] = p.piece;
    total += 1;
    added.add(p.hash);
  }
  const said = (went: boolean): Taken['pieces'] =>
    candidates.map((p) => ({
      id: p.id,
      name: p.name,
      piece: p.hash,
      by: p.root,
      taken: went && added.has(p.hash),
      why: added.has(p.hash) ? (went ? null : NOT_TAKEN) : (left.get(p.id) ?? null),
    }));
  if (!added.size) return { problem, pieces: said(false), hash: null, posted: [], refused: [] };

  const settings = { ...old.settings, budget: Math.max(old.settings.budget, total) };
  const out = await republish(door, problem, { ...old, prev: problem, settings, pieces }, resolved);
  const went = out.posted.length > 0;
  return { problem, pieces: said(went), hash: went ? out.hash : null, posted: out.posted, refused: out.refused };
}

/**
 * The owner's default take over every problem the home knows and this key owns, each once (QX-22 section 4); the
 * owner's turn runs it after the sharpening. A problem with nothing taken and nothing refused is passed over in
 * silence, a frozen one among them, so a proposal left waiting is not said again every hour.
 */
export async function takeDue(door: Door, now = new Date().toISOString()): Promise<Taken[]> {
  if (!door.identity) return [];
  const out: Taken[] = [];
  for (const h of new Set([...Object.keys(door.library.problems), ...Object.keys(door.library.gold ?? {})])) {
    if (!isHash(h) || door.library.problems[h]?.next || door.library.problems[h]?.frozen) continue;
    try {
      const r = await take(door, h, [], now);
      if (r.pieces.some((p) => p.taken) || r.refused.length) out.push(r);
    } catch (e) {
      if ((e as Error).message !== NOT_OWNER)
        out.push({ problem: h, pieces: [], hash: null, posted: [], refused: [(e as Error).message] });
    }
  }
  return out;
}

/**
 * QX-23 section 5: a fork published, or not. `from` is the problem forked; `hash` and `link` are the fork's, null
 * where no tracker took it, with each tracker's reason in `refused`; `kept` is how many pieces of the problem the fork
 * holds, each under the hash it had there; `added` is each proposed piece named, with the propose event's id, its
 * name, its hash and its proposer's root.
 */
export interface Forked {
  from: Hash;
  hash: Hash | null;
  link: string | null;
  kept: number;
  added: { id: Hash; name: string; piece: Hash; by: Address }[];
  posted: string[];
  refused: string[];
}

/**
 * QX-23 section 5: "`quilt fork <problem> [<name> ...]` publishes a fork under this home's key: `from` names the
 * problem, its pieces and data are copied as they are, so each keeps its hash and its square, and each proposed piece
 * named (QX-22) is added, as a take adds one to a version." The fork is the version this client resolved with this
 * key as its owner, no `prev`, and `from` that version: the title, the slug, what done looks like, the settings, the
 * pieces and the data are the problem's, and a piece's hash reads none of what changed (CORE.md section 3). Each name
 * is the name, the piece's hash or the propose event's id of a proposal that stands on the chain resolved, the first
 * in receipt order, and each piece is added under its proposal's name as proposed, the budget raised to fit. Every
 * fault is said before anything is signed, and one fault publishes nothing: a name no standing proposal answers to, a
 * name the problem's pieces hold, or the first fault the envelope's rules find in the fork that would hold the piece.
 * Any key forks, the owner's among them, and whether a tracker takes a fork is the tracker's to say. The fork is
 * published as a version is (sharpen.ts, `republish`), with no gold and no stake rule of its own. `now` is the clock
 * the receipts are read by.
 */
export async function fork(
  door: Door,
  input: string,
  names: string[] = [],
  now = new Date().toISOString(),
): Promise<Forked> {
  const id = door.needKey();
  const { state } = await door.open(input);
  const from = state.problem;
  const old = state.envelope.problem;
  // The problem is most often another owner's, so it is asked for where the library remembers it from the open.
  const resolved = await door.resolve({ ...parseLink(from), trackers: door.trackersFor(from) });
  if (!resolved) throw new Error('no resolver answered for that hash');
  const standing = standingProposals(resolved.receipts, state.rootOf, now);

  const faults: string[] = [];
  const named = new Set<Hash>();
  for (const n of names) {
    const found = standing.find((p) => p.name === n || p.hash === n || p.id === n);
    if (found) named.add(found.id);
    else faults.push(`no proposed piece stands on that problem under ${n}`);
  }
  const candidates = standing.filter((p) => named.has(p.id));

  const forkWith = (pieces: Record<string, PieceDef>, budget: number): Problem => ({
    ...old,
    owner: id.address,
    prev: null,
    from,
    settings: { ...old.settings, budget },
    pieces,
  });
  const pieces: Record<string, PieceDef> = { ...old.pieces };
  let total = state.pieces.length;
  const added = new Set<Hash>();
  for (const p of candidates) {
    // Two roots that proposed one piece: the fork that holds the first holds the second's piece too.
    if (added.has(p.hash)) continue;
    const budget = Math.max(old.settings.budget, total + 1);
    const why =
      Object.hasOwn(pieces, p.name) || Object.hasOwn(pieces, `${p.name}/*`)
        ? NAME_HELD
        : (envelopeProblems({ ...state.envelope, problem: forkWith({ ...pieces, [p.name]: p.piece }, budget) })[0] ??
          null);
    if (why !== null) {
      faults.push(`${p.name}: ${why}`);
      continue;
    }
    pieces[p.name] = p.piece;
    total += 1;
    added.add(p.hash);
  }
  if (faults.length) throw new Error(faults.join('\n'));

  const out = await republish(door, from, forkWith(pieces, Math.max(old.settings.budget, total)), resolved);
  const went = out.posted.length > 0;
  return {
    from,
    hash: went ? out.hash : null,
    link: went ? out.link : null,
    kept: state.pieces.length,
    added: candidates.map((p) => ({ id: p.id, name: p.name, piece: p.hash, by: p.root })),
    posted: out.posted,
    refused: out.refused,
  };
}
