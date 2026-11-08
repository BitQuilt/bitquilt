/**
 * The tracker's door as it takes a post (PROTOCOL.md, The tracker; CORE.md sections 4 and 11): a problem published
 * with its blobs, a read kept under its hash (QX-19 section 2), and an event for one of the three logs. An event is
 * parsed, shaped, checked against its signature and held to its key's hourly limit, then asked what its log asks: the
 * coin log one rule, the coin layer's (QX-17 section 2), and the identity log and a problem's log a map from each event
 * type to the one check that admits it, with where its rule is written. What is admitted is appended once, and what
 * the append changes beside the chain is kept. A peer's lines (QX-21) are admitted through the same checks, and every
 * admission runs inside `exactly`, so each layer a check reads is built afresh at now. A function here takes the
 * door's part of the tracker's context, `Reads`, or the store alone, and says in its signature or its first line what
 * it reads of it.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  type Address,
  type Envelope,
  type Event,
  type Hash,
  type Received,
  blobProblems,
  envelopeProblems,
  eventId,
  eventProblems,
  eventSignedByKey,
  expandPieces,
  hashBytes,
  isHash,
  isRecord,
  isSlug,
  plainTextProblems,
  problemHash,
  type reduce,
  returnProblems,
  returnStrings,
  signedBy,
  stampOk,
  textIssues,
  IDENTITY_LOG,
  SLUG_RULE,
} from '@bitquilt/core';
import { challengeBodyProblems, verdictBodyProblems } from './challenge.js';
import { type CoinLockView, type CoinWord, COIN_LOG, coinEventRefusal } from './coin.js';
import { goldBodyProblems, goldRevealBodyProblems } from './gold.js';
import { hideBodyProblems } from './hide.js';
import { Refusal, json } from './http.js';
import type { PullDoor } from './peers.js';
import { seedBodyProblems } from './seeding.js';
import { PRODUCTION_EVENTS, lockBodyProblems, stakeRuleBodyProblems } from './stake.js';
import type { Store } from './store.js';
import { BLOB_MAX, admitTrace, tracesKept } from './trace.js';
import type { Context } from './tracker.js';
import { kindOf, personSeatIn, rankBodyProblems } from './verifiers.js';
import { hostedPost, witnessOf } from './witness.js';

/** The most a post may carry, 4 MB: room for an envelope with its blobs. */
const MAX_BODY = 4 * 1024 * 1024;

/** Which log a post goes to: a problem's, the identity log, or the coin log (QX-17). */
export type Log = { kind: 'problem'; hash: Hash } | { kind: 'identity' } | { kind: 'coin' };
/**
 * What the door read of an event it admits: the chain it is appended to, and the word it vouches for in the receipt's
 * wrapper (QX-17).
 */
export interface Admitted {
  chain: Hash;
  word?: Record<string, unknown>;
}
/** What the door reads of the tracker's context (tracker.ts). */
type Reads = Pick<
  Context,
  | 'store'
  | 'options'
  | 'url'
  | 'now'
  | 'limits'
  | 'stampNeeded'
  | 'maintainerSet'
  | 'fetchImpl'
  | 'layer'
  | 'exactly'
  | 'inputFor'
  | 'reduceProblem'
  | 'view'
  | 'hidden'
  | 'coin'
  | 'coinHome'
  | 'homeRate'
>;
/**
 * What the door asks of one type of event on a problem's log, as a row of `problemDoor` names it: given the door's
 * part of the context, the event, the problem it is under, that problem's fold, and whether the line's wrappers say
 * its seat is a person's (`personSeatIn` in verifiers.ts), it refuses by throwing a Refusal, and answers the word the
 * receipt's wrapper carries where it has one.
 */
type ProblemCheck = (
  cx: Reads,
  event: Event,
  under: Hash,
  state: ReturnType<typeof reduce>,
  personSeat: boolean,
) => void | Promise<Record<string, unknown> | undefined>;
/**
 * A coin lock as the door read it (QX-17 section 5), with the rate it is read at and the coin log's head the reading
 * stood under.
 */
interface CoinLockRead {
  lock: CoinLockView | null;
  rate: number;
  head: { seq: number; hash: string } | null;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new Refusal(413, 'body over 4 MB');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** The request's body as bytes, at most `max`: what a read's blob arrives as (QX-19). */
async function readBytes(req: IncomingMessage, max: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new Refusal(413, `a blob of at most ${max} bytes`);
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Refusal(400, 'not JSON');
  }
}

/** Counts a post in an hourly bucket, refused with 429 once the hour is over `max`. */
export function limit({ store, now }: Reads, bucket: string, max: number): void {
  if (store.hit(bucket, now().slice(0, 13), max)) throw new Refusal(429, "over the hour's limit");
}

/**
 * The most a body a door takes nests (PROTOCOL.md, What the door answers). The fold reads a body through recursive
 * code, the core's canonical form among it, deeper in the stack than the door that took it, so a body the door could
 * read and the fold could not would fail the fold on every read; sixty-four levels is many more than any event or
 * envelope has.
 */
export const DEPTH_MAX = 64;

/**
 * Why a body is not one the fold can take, an event, an envelope or a data blob read as JSON: nested deeper than
 * `DEPTH_MAX`, or holding a field named `__proto__`. JSON makes such a field the object's own, and an assignment by
 * that name sets an object's prototype, so the core's output and the views would build objects that are not plain.
 */
export function bodyOver(value: unknown, label: string): string[] {
  const left: [unknown, number][] = [[value, 1]];
  while (left.length) {
    const [v, depth] = left.pop()!;
    if (v === null || typeof v !== 'object') continue;
    if (depth > DEPTH_MAX) return [`${label}: nested deeper than ${DEPTH_MAX}`];
    if (Array.isArray(v)) for (const x of v) left.push([x, depth + 1]);
    else
      for (const [k, x] of Object.entries(v)) {
        if (k === '__proto__') return [`${label}: a field named __proto__`];
        left.push([x, depth + 1]);
      }
  }
  return [];
}

/**
 * The most hours a door takes for a lease or a challenge window (PROTOCOL.md, What the door answers). The fold adds
 * them to a receipt's time (CORE.md section 6): a claim is live for its lease, a commit unabandoned for twice the
 * piece's, and a window runs from the receipt that completed a set. A date is written only up to the year 275760, so
 * an hour count past it leaves the fold no time to say, and the fold fails on the receipt. A million hours is over a
 * hundred years, and twice that from any time a door writes is still a date.
 */
export const HOURS_MAX = 1_000_000;

/** Each hour count over `HOURS_MAX`, as a refusal says it, with where it is. */
function hoursOver(counts: [string, unknown][]): string[] {
  return counts
    .filter(([, h]) => typeof h === 'number' && h > HOURS_MAX)
    .map(([at]) => `${at}: at most ${HOURS_MAX} hours`);
}

/** A claim's lease over `HOURS_MAX`, checked with the event's shape, as a post or a peer's line (QX-21). */
export function eventHoursOver(e: Event): string[] {
  return isRecord(e) && e.type === 'claim' && isRecord(e.body) ? hoursOver([['body.lease_h', e.body.lease_h]]) : [];
}

/** A problem's lease and challenge window, and each piece's lease, over `HOURS_MAX`, checked at publish. */
export function envelopeHoursOver(p: Envelope['problem']): string[] {
  return hoursOver([
    ['problem.settings.lease_h', p.settings.lease_h],
    ['problem.settings.challenge_window_h', p.settings.challenge_window_h],
    ...Object.entries(p.pieces).map(([name, d]): [string, unknown] => [`problem.pieces.${name}.lease_h`, d.lease_h]),
  ]);
}

/**
 * Whether a wrapper's time is one as a door writes it, `toISOString` of the receipt's time, which reads back as itself:
 * a date that is one, the time to the millisecond and Z, in a year of four digits, so times compare as text.
 */
function doorTime(at: unknown): boolean {
  if (typeof at !== 'string' || !/^\d{4}-/.test(at)) return false;
  const t = Date.parse(at);
  return Number.isFinite(t) && new Date(t).toISOString() === at;
}

/**
 * Each time in a wrapper a peer serves (QX-21 section 2) that is not a time in UTC as a door writes one: the earliest
 * of a wrapper's times decides an event's order and a lease's start (CORE.md section 6), and the reference reducer
 * compares them as text, which orders only times written alike, and adds hours to the earliest.
 */
export function stampsUnlike(received: unknown): string[] {
  if (!Array.isArray(received)) return ['received: a list'];
  return received.flatMap((w, i) =>
    isRecord(w) && doorTime(w.at) ? [] : [`received[${i}].at: a time in UTC, as a door writes one`],
  );
}

/** A blob read as JSON, which a family's data slots draw on (CORE.md section 2), or null where it is not JSON. */
function jsonOf(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

/** A problem published: its envelope and blobs, once the route has held the post to its address's hourly limit. */
export async function publish(
  { store, options, now, coinHome }: Reads,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const body = parseJson(await readBody(req)) as { envelope?: unknown; blobs?: Record<string, string> };
  const envelope = body.envelope;
  const over = bodyOver(envelope, 'envelope');
  if (over.length) throw new Refusal(400, over[0]!);
  const problems = envelopeProblems(envelope);
  if (problems.length) throw new Refusal(400, problems[0]!);
  const e = envelope as Envelope;
  const hours = envelopeHoursOver(e.problem);
  if (hours.length) throw new Refusal(400, hours[0]!);
  if (!signedBy(e as unknown as Record<string, unknown>, e.problem.owner))
    throw new Refusal(400, 'envelope: not signed by its owner');
  const blobs = new Map<Hash, Uint8Array>();
  for (const [h, b64] of Object.entries(body.blobs ?? {})) {
    if (!isHash(h)) throw new Refusal(400, `blob ${h}: not a hash`);
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    if (hashBytes(bytes) !== h) throw new Refusal(400, `blob ${h}: does not match its hash`);
    const blobOver = bodyOver(jsonOf(bytes), `blob ${h}`);
    if (blobOver.length) throw new Refusal(400, blobOver[0]!);
    blobs.set(h, bytes);
  }
  for (const h of Object.values(e.problem.data))
    if (!blobs.has(h)) {
      const stored = store.getBlob(h);
      if (stored) blobs.set(h, stored);
    }
  const bp = blobProblems(e.problem, blobs);
  if (bp.length) throw new Refusal(400, bp[0]!);
  // Admission: the gate on what a thousand AIs will read.
  for (const [label, text] of [
    ['title', e.problem.title],
    ['done_when', e.problem.done_when],
  ] as const) {
    const issues = plainTextProblems(text, label);
    if (issues.length) throw new Refusal(400, issues[0]!);
  }
  for (const [name, d] of Object.entries(e.problem.pieces)) {
    const issues = plainTextProblems(d.brief, `pieces.${name}.brief`);
    if (issues.length) throw new Refusal(400, issues[0]!);
  }
  // QX-17: at the coin's home, a window longer than the home admits would leave a fake's coin vested before a late
  // challenge decides.
  const windowMax = options.coin?.window_max_h;
  if (windowMax !== undefined && coinHome() === 'here' && e.problem.settings.challenge_window_h > windowMax) {
    throw new Refusal(
      400,
      `the challenge window of ${e.problem.settings.challenge_window_h} hours is beyond the ${windowMax} this home admits (QX-17)`,
    );
  }
  if (e.problem.prev) {
    const prev = store.getEnvelope(e.problem.prev);
    if (!prev) throw new Refusal(400, 'prev: not a problem this tracker holds');
    if (prev.envelope.problem.owner !== e.problem.owner) throw new Refusal(400, 'prev: by another owner');
  }
  // CORE.md section 2: `from` is another owner's problem this one forks; the same owner's next version sets `prev`. A
  // fork of a problem not held here is taken on the forker's word, as the core takes it.
  if (e.problem.from) {
    const from = store.getEnvelope(e.problem.from);
    if (from && from.envelope.problem.owner === e.problem.owner)
      throw new Refusal(400, 'from: by the same owner; a version sets prev');
  }
  try {
    expandPieces(e.problem, blobs);
  } catch (err) {
    throw new Refusal(400, `data: ${(err as Error).message}`);
  }
  const hash = problemHash(e);
  const at = now();
  // The blobs go in before the envelope, so the store never holds a problem without the data the core folds it over.
  for (const [h, bytes] of blobs) store.putBlob(h, bytes);
  store.putEnvelope(hash, e, at);
  json(res, 201, { hash });
}

/** QX-19 section 2: a read kept under its hash, so a trace can rest on it. */
export async function keepBlob(store: Store, req: IncomingMessage, res: ServerResponse, hash: Hash): Promise<void> {
  const bytes = await readBytes(req, BLOB_MAX);
  if (hashBytes(bytes) !== hash) throw new Refusal(400, 'the bytes do not match the hash');
  store.putBlob(hash, bytes);
  json(res, 202, { hash, bytes: bytes.length });
}

/**
 * Takes an event for a log, once the route has held the post to its network address's hourly limit: the parse, the
 * shape, the signature, the key's limit, then the log's own admission, the dedupe, the append, and what the append
 * changes beside the chain.
 */
export async function postEvent(cx: Reads, req: IncomingMessage, res: ServerResponse, log: Log): Promise<void> {
  const { store, url, now, limits, options, exactly } = cx;
  const event = parseJson(await readBody(req)) as Event;
  const over = bodyOver(event, 'event');
  const shape = over.length ? over : [...eventProblems(event), ...eventHoursOver(event)];
  if (shape.length) throw new Refusal(400, shape[0]!);
  if (!eventSignedByKey(event)) throw new Refusal(400, "signature is not the key's");
  limit(cx, `key:${event.key}`, limits.keyPerHour);
  const id = eventId(event);
  const hosted = hostedPost(req, options.custodySecret);
  // What the receipt's wrapper will say of its seat, built before the admission and read through `personSeatIn`, as
  // the pull and the layer read theirs: a hosted post's says `custody: hosted` and `seat: ai`, a person's seat
  // (verifiers.md section 2); every other post's says `custody: self` and no seat.
  const wrapper: Pick<Received, 'custody' | 'seat'> = hosted ? { custody: 'hosted', seat: 'ai' } : { custody: 'self' };
  const { chain, word } = await exactly(() =>
    log.kind === 'coin'
      ? admitCoinEvent(cx, event)
      : log.kind === 'identity'
        ? admitIdentityEvent(cx, event)
        : admitProblemEvent(cx, event, log.hash, personSeatIn([wrapper])),
  );
  if (store.hasEvent(chain, id)) throw new Refusal(409, 'already here');
  const extra = hosted ? { ...witnessOf(req), ...word } : word;
  const line = store.appendReceipt(chain, event, id, url, now(), wrapper.custody, wrapper.seat, extra);
  const at = line.received[0]!.at;
  noteAppended(store, log, event, at);
  json(res, 202, { id, seq: line.seq, hash: line.hash, at });
}

/**
 * What the door keeps beside the chain once a line is on it: a hold released by a reveal or a decline, an
 * announcement for the index, a name for `/n/<owner>/<slug>`.
 */
function noteAppended(store: Store, log: Log, event: Event, at: string): void {
  const type = event.type;
  if (log.kind === 'problem') {
    if ((type === 'reveal' || type === 'decline') && event.piece) store.releaseHold(log.hash, event.piece, event.key);
    if (type === 'announce') store.putAnnouncement(log.hash, event.key, event, at);
  }
  if (type === 'version')
    store.putName(event.key, (event.body as { slug: string }).slug, (event.body as { hash: Hash }).hash, at);
}

/**
 * QX-21: what the peer pull reaches of a tracker. A peer's event is admitted as a post's is, with the layer built
 * afresh at now while it is (`exactly`); the coin log is not pulled.
 */
export function pullDoorOf(cx: Reads): PullDoor {
  const { store, url, now, fetchImpl, options, exactly } = cx;
  return {
    store,
    url,
    now,
    fetchImpl,
    peers: options.peers ?? [],
    admit: (log, event, personSeat) =>
      exactly(() =>
        log.kind === 'identity'
          ? admitIdentityEvent(cx, event)
          : admitProblemEvent(cx, event, (log as { hash: Hash }).hash, personSeat),
      ),
    noteAppended: (log, event, at) => noteAppended(store, log, event, at),
  };
}

/**
 * QX-17: the coin log, admitted against the layer's balances at now; a burn's word is the standing it credits. The
 * coin log has no map by type as the other two logs have below. Its six types are admitted by one rule, the coin
 * layer's (QX-17 section 2), which the fold reads too, so what it takes is COIN_EVENTS in coin.ts, said once for
 * both.
 */
function admitCoinEvent({ options, coin }: Reads, event: Event): Admitted {
  if (!options.coin) throw new Refusal(404, 'this tracker carries no coin');
  const refused = coinEventRefusal(event);
  if (refused) throw new Refusal(400, refused);
  const a = coin()!.admit(event);
  if (!a.ok) throw new Refusal(400, a.why);
  return event.type === 'burn'
    ? { chain: COIN_LOG, word: { stake: { kind: 'burn', amount: event.body.amount, standing: a.standing ?? 0 } } }
    : { chain: COIN_LOG };
}

/**
 * The identity log's door by event type: the one check each type is admitted through once it names no problem, with
 * where its rule is written. The keys are what the identity log takes, so a new type is one row; null where the
 * shape the core checks before any log is asked is the whole of it.
 */
export const identityDoor: Readonly<Record<string, ((cx: Reads, event: Event) => void) | null>> = {
  name: checkNameEvent, // CORE.md sections 4 and 11, the stamp
  delegate: null, // CORE.md section 4
  revoke: null, // CORE.md section 4
  rotate: null, // CORE.md section 4
  hide: checkHideEvent, // QX-6 section 1
};

/** The identity log: a type its door takes, naming no problem, then that type's own check. */
function admitIdentityEvent(cx: Reads, event: Event): Admitted {
  if (!Object.hasOwn(identityDoor, event.type)) {
    const types = Object.keys(identityDoor);
    throw new Refusal(400, `the identity log takes ${types.slice(0, -1).join(', ')} and ${types.at(-1)}`);
  }
  if (event.problem !== undefined || event.piece !== undefined)
    throw new Refusal(400, 'an identity event names no problem');
  identityDoor[event.type]?.(cx, event);
  return { chain: IDENTITY_LOG };
}

/**
 * The door for a name: the stamp asked here, where one is (CORE.md section 11), of "a `nonce` whose presence makes the
 * event's id have at least the number of leading zero bits a tracker asks for in its well-known document, on a `name`
 * event". The event carries it, so a name pulled from a peer is asked it as a posted one is (QX-21 section 2).
 */
function checkNameEvent({ stampNeeded }: Reads, event: Event): void {
  if (stampNeeded > 0 && !stampOk(event, stampNeeded))
    throw new Refusal(400, `a name event here carries a stamp of ${stampNeeded} bits`);
}

/** The door for QX-6's hide: well formed, and signed by one of this tracker's maintainers. */
function checkHideEvent({ maintainerSet }: Reads, event: Event): void {
  const hp = hideBodyProblems(event.body);
  if (hp.length) throw new Refusal(400, hp[0]!);
  if (!maintainerSet.has(event.key.toLowerCase()))
    throw new Refusal(403, "a hide is signed by one of this tracker's maintainers");
}

/**
 * The problem log's door by event type: the one check each type is admitted through once it is under the problem it
 * names, held here and not taken down, with where its rule is written. The keys are what a problem's log takes, so a
 * new type is one row; null where the shape the core checks before any log is asked is the whole of it. Its types
 * beyond the core's, with identityDoor's and COIN_EVENTS in coin.ts, are the rows of the table in PROTOCOL.md, Events,
 * and each row's rule is where the comment here names first (events-table.test.ts).
 */
export const problemDoor: Readonly<Record<string, ProblemCheck | null>> = {
  // The core's.
  claim: checkPieceEvent, // CORE.md sections 4 and 6; QX-15 section 2; QX-20 section 2
  commit: checkPieceEvent, // CORE.md sections 4 and 6; QX-15 section 2; QX-20 section 2
  reveal: checkPieceEvent, // CORE.md sections 4, 6 and 11; QX-15 section 2; QX-20 section 2; verifiers.md section 2
  decline: checkPieceEvent, // CORE.md sections 4 and 6
  run: checkPieceEvent, // CORE.md sections 4 and 6; QX-15 section 2; QX-20 section 2
  version: checkVersionEvent, // CORE.md sections 2 and 4; PROTOCOL.md, What the door answers
  output: null, // CORE.md section 4
  // The extensions'.
  announce: checkAnnounceEvent, // QX-13 sections 1 and 2
  seed: checkSeedEvent, // QX-4 section 1
  challenge: checkChallengeEvent, // QX-1 section 1, and QX-16 section 4 for a challenge on a miss
  verdict: checkVerdictEvent, // QX-1 section 1
  rank: checkRankEvent, // verifiers.md section 2, judge:n (QX-2)
  stake_rule: checkStakeRuleEvent, // QX-15 section 1
  lock: checkLockEvent, // QX-15 section 1, and QX-17 section 5 for a coin-kind lock
  gold: checkGoldEvent, // QX-16 section 1
  gold_reveal: checkGoldRevealEvent, // QX-16 section 1
  trace: checkTraceEvent, // QX-19 section 1
};

/**
 * A problem's log: a type its door takes, under the problem it names, held here and not taken down, then that type's
 * own check, whose word, where it has one, the receipt's wrapper carries.
 */
async function admitProblemEvent(cx: Reads, event: Event, under: Hash, personSeat: boolean): Promise<Admitted> {
  const { hidden, reduceProblem } = cx;
  const type = event.type;
  if (Object.hasOwn(identityDoor, type)) throw new Refusal(400, 'identity events go to the identity log');
  if (!Object.hasOwn(problemDoor, type)) throw new Refusal(400, `this tracker does not carry ${type} events`);
  if (event.problem !== under) throw new Refusal(400, 'post an event under the problem it names');
  if (hidden().has(under)) throw new Refusal(410, 'this problem is taken down here');
  const state = reduceProblem(under);
  if (!state) throw new Refusal(404, 'no such problem here');
  const word = await problemDoor[type]?.(cx, event, under, state, personSeat);
  return word ? { chain: under, word } : { chain: under };
}

/**
 * The door for the core's piece events: a piece the problem has; on a staked piece, a root with a live lock (QX-15);
 * a reveal's return through the schema and the gate, on an unrevealed commit; a run on a revealed digest.
 */
function checkPieceEvent(
  cx: Reads,
  event: Event,
  under: Hash,
  state: ReturnType<typeof reduce>,
  personSeat: boolean,
): void {
  const { layer } = cx;
  const view = event.piece ? state.byHash.get(event.piece) : undefined;
  if (!view) throw new Refusal(400, 'names a piece this problem does not have');
  if (PRODUCTION_EVENTS.has(event.type)) {
    // QX-15: on a staked piece, work is admitted only from a root with a live lock. The layer's admission is in
    // stake.ts.
    const a = layer().admitProduction(under, event.piece!, event.key);
    if (!a.ok) throw new Refusal(400, a.why);
    // QX-20 section 2: a record is fixed once its readings are in; no claim, commit, reveal or run is taken on it
    // after.
    if (
      kindOf(view.piece.verifier)?.kind === 'record' &&
      layer().problems.get(under)?.byHash.get(event.piece!)?.state === 'recorded'
    )
      throw new Refusal(400, 'the readings for this piece are in');
  }
  if (event.type === 'reveal') {
    const ret = (event.body as { return: Record<string, unknown> }).return;
    if (view.piece.schema) {
      const rp = returnProblems(view.piece.schema, ret);
      if (rp.length) throw new Refusal(400, rp[0]!);
    }
    for (const s of returnStrings(ret)) {
      const issues = plainTextProblems(s, 'return');
      if (issues.length) throw new Refusal(400, issues[0]!);
    }
    if (!view.commits.some((c) => c.key === event.key && !c.revealed))
      throw new Refusal(400, 'no unrevealed commit by this key on the piece');
    checkRevealEvent(cx, event, under, view.piece.verifier, personSeat);
  }
  if (event.type === 'run' && !view.reveals.some((r) => r.digest === (event.body as { digest: Hash }).digest))
    throw new Refusal(400, 'the digest is no revealed return of the piece');
}

/**
 * The door for the verifier kinds' reveals: a human piece takes a return only from a person's seat (QX-3), which is
 * the line's wrappers saying so, the connector's custody at a post here and a peer's word at a pull, or a client
 * declaring the model `human`; a judge piece takes no more candidates once its panel sits (QX-2). The layer would
 * count neither; the door says why.
 */
function checkRevealEvent({ view }: Reads, event: Event, under: Hash, verifier: string, personSeat: boolean): void {
  const kind = kindOf(verifier)?.kind;
  if (kind === 'human') {
    const by = (event.body as { by: { model: string } }).by;
    if (by.model !== 'human' && !personSeat)
      throw new Refusal(400, "a human piece takes a return from a person's seat");
  }
  if (kind === 'judge' && event.piece && view(under)?.panels.some((p) => p.piece === event.piece))
    throw new Refusal(400, 'the candidates for this piece are in');
}

/**
 * The door for a version (PROTOCOL.md, What the door answers): its slug is a slug by the envelope's rule,
 * "problem.slug: lower-case letters, digits and hyphens, at most 64" (`isSlug` in the core's envelope.ts), said here of
 * `body.slug` in the same words. A version's body is `{ slug, hash }` (CORE.md section 4), and the core's shape asks
 * only that the slug is a string, so a core client folds any. The door asks more, its checks being admission and not
 * validity (CORE.md section 11), since an owner's name is one segment of a path, `/n/<owner>/<slug>` here and
 * `names/<owner>/<slug>` in a mirror's folder (NODE.md section 6).
 */
function checkVersionEvent(_cx: Reads, event: Event): void {
  if (!isSlug(event.body.slug)) throw new Refusal(400, `body.slug: ${SLUG_RULE}`);
}

/**
 * The door for QX-13's announce: the title, slug and done_when are the envelope's, and the topics are few, short and
 * through the gate.
 */
function checkAnnounceEvent(_cx: Reads, event: Event, _under: Hash, { envelope }: ReturnType<typeof reduce>): void {
  const b = event.body as Record<string, unknown>;
  if (
    b.title !== envelope.problem.title ||
    b.slug !== envelope.problem.slug ||
    b.done_when !== envelope.problem.done_when
  )
    throw new Refusal(400, "announce: title, slug and done_when are the envelope's");
  if (
    !Array.isArray(b.topics) ||
    b.topics.length > 8 ||
    !b.topics.every((t) => typeof t === 'string' && t.length <= 40 && textIssues(t).length === 0)
  )
    throw new Refusal(400, 'announce: at most eight short topics through the gate');
  // QX-13 section 2: the owner and the fork are the envelope's where the announce states them; the pieces, the counts
  // and the work are whole numbers, and are the announcer's word.
  if (b.owner !== undefined && b.owner !== envelope.problem.owner)
    throw new Refusal(400, "announce: owner is the envelope's");
  if (b.from !== undefined && b.from !== (envelope.problem.from ?? null))
    throw new Refusal(400, "announce: from is the envelope's");
  const whole = (x: unknown): boolean => typeof x === 'number' && Number.isInteger(x) && x >= 0;
  const countsOk =
    b.counts === undefined ||
    (!!b.counts && typeof b.counts === 'object' && Object.values(b.counts as Record<string, unknown>).every(whole));
  const w = b.work as Record<string, unknown> | undefined;
  const t = w?.traced as Record<string, unknown> | undefined;
  const workOk =
    w === undefined ||
    (!!w &&
      typeof w === 'object' &&
      ['returned', 'accepted', 'verified', 'disputed', 'readers', 'vendors'].every((k) => whole(w[k])) &&
      !!t &&
      typeof t === 'object' &&
      ['both', 'one', 'none'].every((k) => whole(t[k])) &&
      (w.last === null || (typeof w.last === 'string' && !Number.isNaN(Date.parse(w.last)))));
  if ((b.pieces !== undefined && !whole(b.pieces)) || !countsOk || !workOk)
    throw new Refusal(400, 'announce: pieces, counts and work are whole numbers');
}

/** The door for QX-4's seed: a well-formed body, and nothing more. */
function checkSeedEvent(_cx: Reads, event: Event): void {
  const sp = seedBodyProblems(event.body);
  if (sp.length) throw new Refusal(400, sp[0]!);
}

/**
 * The door for QX-1's challenge: from a root with standing, inside the window, with a panel to seat. The layer's
 * admission is in challenge.ts (challengeAdmissions).
 */
function checkChallengeEvent({ layer }: Reads, event: Event, under: Hash): void {
  if (!event.piece) throw new Refusal(400, 'a challenge names a problem and a piece');
  const layered = layer();
  const body = event.body;
  const shape = challengeBodyProblems(body);
  if (shape.length) throw new Refusal(400, shape[0]!);
  const issues = plainTextProblems(body.ground as string, 'ground');
  if (issues.length) throw new Refusal(400, issues[0]!);
  const a = layered.admitChallenge(under, event.piece, event.key, body.stake as number);
  if (!a.ok) throw new Refusal(400, a.why);
}

/**
 * The door for QX-1's verdict: from a judge drawn, with any return it carries through the gate. The layer's admission
 * is in challenge.ts (challengeAdmissions).
 */
function checkVerdictEvent({ layer }: Reads, event: Event, under: Hash): void {
  if (!event.piece) throw new Refusal(400, 'a verdict names a problem and a piece');
  const layered = layer();
  const body = event.body;
  const shape = verdictBodyProblems(body);
  if (shape.length) throw new Refusal(400, shape[0]!);
  if (body.return !== undefined)
    for (const s of returnStrings(body.return as Record<string, unknown>)) {
      const issues = plainTextProblems(s, 'return');
      if (issues.length) throw new Refusal(400, issues[0]!);
    }
  const a = layered.admitVerdict(under, event.piece, event.key, body.challenge as Hash, body);
  if (!a.ok) throw new Refusal(400, a.why);
}

/**
 * The door for QX-2's rank: from a judge drawn to the piece's panel, naming every candidate once. The layer's
 * admission is in verifiers.ts.
 */
function checkRankEvent({ layer }: Reads, event: Event, under: Hash): void {
  if (!event.piece) throw new Refusal(400, 'a rank names a problem and a piece');
  const shape = rankBodyProblems(event.body);
  if (shape.length) throw new Refusal(400, shape[0]!);
  const a = layer().admitRank(under, event.piece, event.key, event.body);
  if (!a.ok) throw new Refusal(400, a.why);
}

/**
 * The door for QX-15's stake rule: from the owner, naming pieces the problem has. The layer's admission is in
 * stake.ts.
 */
function checkStakeRuleEvent({ layer }: Reads, event: Event, under: Hash): void {
  if (event.piece !== undefined) throw new Refusal(400, 'a stake rule names a problem and no piece');
  const shape = stakeRuleBodyProblems(event.body);
  if (shape.length) throw new Refusal(400, shape[0]!);
  const a = layer().admitStakeRule(under, event.key, event.body);
  if (!a.ok) throw new Refusal(400, a.why);
}

/**
 * The door for QX-15's lock: one a root can cover, on a piece that asks one. A coin-kind lock is checked against the
 * coin log (QX-17), and what the door read is its word for the receipt. The layer's admission is in stake.ts.
 */
async function checkLockEvent(
  cx: Reads,
  event: Event,
  under: Hash,
  state: ReturnType<typeof reduce>,
): Promise<{ stake: CoinWord } | undefined> {
  const { layer, now } = cx;
  if (!event.piece) throw new Refusal(400, 'a lock names a problem and a piece');
  const shape = lockBodyProblems(event.body);
  if (shape.length) throw new Refusal(400, shape[0]!);
  let word: CoinWord | null = null;
  if (event.body.kind === 'coin') {
    if (!state.byHash.has(event.piece)) throw new Refusal(400, 'names a piece this problem does not have');
    word = await coinWord(cx, under, event, state.rootOf(event.key, now()));
  }
  const a = layer().admitLock(under, event.piece, event.key, event.body, word);
  if (!a.ok) throw new Refusal(400, a.why);
  return word ? { stake: word } : undefined;
}

/**
 * The door for QX-16's gold: the owner's, kept whole or refused naming the piece. The layer's admission is in
 * gold.ts.
 */
function checkGoldEvent({ layer }: Reads, event: Event, under: Hash): void {
  if (event.piece !== undefined) throw new Refusal(400, 'a gold names a problem and no piece');
  const shape = goldBodyProblems(event.body);
  if (shape.length) throw new Refusal(400, shape[0]!);
  const a = layer().admitGold(under, event.key, event.body);
  if (!a.ok) throw new Refusal(400, a.why);
}

/**
 * The door for QX-16's gold reveal: the owner's, on an accepted piece inside its window. The layer's admission is in
 * gold.ts.
 */
function checkGoldRevealEvent({ layer }: Reads, event: Event, under: Hash): void {
  if (!event.piece) throw new Refusal(400, 'a gold reveal names a problem and a piece');
  const shape = goldRevealBodyProblems(event.body);
  if (shape.length) throw new Refusal(400, shape[0]!);
  const a = layer().admitGoldReveal(under, event.piece, event.key, event.body);
  if (!a.ok) throw new Refusal(400, a.why);
}

/**
 * The door for QX-19: a trace from the key that revealed, naming reads this tracker holds, with every span inside its
 * read (QX-19 section 1).
 */
function checkTraceEvent(
  { store, inputFor }: Reads,
  event: Event,
  under: Hash,
  state: ReturnType<typeof reduce>,
): void {
  if (!event.piece) throw new Refusal(400, 'a trace names a problem and a piece');
  const view = state.byHash.get(event.piece);
  if (!view) throw new Refusal(400, 'names a piece this problem does not have');
  const receipts = inputFor(under)!.receipts;
  const blobLength = (h: Hash): number | null => store.blobLength(h);
  const a = admitTrace(view, receipts, event, tracesKept(view, receipts, blobLength), blobLength);
  if (!a.ok) throw new Refusal(400, a.why);
}

/**
 * A coin lock as the door reads it (QX-17 section 5): from this tracker's own coin layer at the home, from the home's
 * route elsewhere, with the burn rate the home publishes. `head` is the coin log's head the reading stood under, null
 * where there was none to read.
 */
async function readCoinLock(cx: Reads, home: string, id: Hash): Promise<CoinLockRead> {
  const { coin, fetchImpl } = cx;
  let head: { seq: number; hash: string } | null = null;
  if (home === 'here') {
    const c = coin()!;
    return { lock: c.lock(id), rate: c.burnRateAt(c.now), head: c.head };
  }
  let lock: CoinLockView | null = null;
  let rate: number | null = null;
  try {
    const r = await fetchImpl(`${home}coin/lock/${id}`, { signal: AbortSignal.timeout(8000) });
    if (r.ok) {
      const {
        head: h,
        rate: read,
        ...rest
      } = (await r.json()) as CoinLockView & {
        head: { seq: number; hash: string } | null;
        at: string;
        rate?: number;
      };
      lock = rest;
      head = h;
      // The rate in force at the home when it answered; an indexed one moves with the epochs.
      if (typeof read === 'number') rate = read;
    } else if (r.status !== 404) throw new Error(`${r.status}`);
    if (rate === null) {
      // An older home answers no rate with the lock; the one its well-known publishes is read once.
      if (cx.homeRate === null) {
        const w = (await (
          await fetchImpl(`${home}.well-known/quilt`, { signal: AbortSignal.timeout(8000) })
        ).json()) as { stake?: { burn_rate?: number }; coin?: { burn_rate?: number } };
        const published = w.stake?.burn_rate ?? w.coin?.burn_rate;
        if (typeof published !== 'number') throw new Error('no coin');
        cx.homeRate = published;
      }
      rate = cx.homeRate;
    }
  } catch {
    throw new Refusal(400, 'the home did not answer');
  }
  return { lock, rate, head };
}

/**
 * Why the door does not admit a coin-kind lock on the coin lock it read, in the order QX-17 section 5 gives: the lock
 * is the root's, names this problem and piece, is live, is unbound, and backs at least the amount at the burn rate;
 * null when it does.
 */
function coinLockProblem(lock: CoinLockView, rate: number, root: Address, under: Hash, event: Event): string | null {
  if (lock.root !== root) return "the lock is another root's";
  if (lock.problem !== under || lock.piece !== event.piece) return 'the lock names another piece';
  if (lock.state !== 'live') return 'the lock has ended';
  if (lock.bound !== null) return 'the lock is bound';
  const amount = event.body.amount as number;
  if (Math.floor(lock.units / rate) < amount)
    return `the lock holds ${lock.units} units, a stake of ${Math.floor(lock.units / rate)} at ${rate} a point`;
  return null;
}

/**
 * QX-17 section 5: what the door reads of a coin lock before it admits a coin-kind QX-15 lock, and writes into the
 * receipt as its word.
 */
async function coinWord(cx: Reads, under: Hash, event: Event, root: Address): Promise<CoinWord> {
  const { coinHome } = cx;
  const home = coinHome();
  if (home === null) throw new Refusal(400, 'this tracker honours no coin lock');
  const id = event.body.id as Hash;
  const { lock, rate, head } = await readCoinLock(cx, home, id);
  if (!lock) throw new Refusal(400, 'no such lock on the coin log');
  const why = coinLockProblem(lock, rate, root, under, event);
  if (why) throw new Refusal(400, why);
  return { kind: 'coin', amount: event.body.amount as number, id, units: lock.units, home, head };
}
