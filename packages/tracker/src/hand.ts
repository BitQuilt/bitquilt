/**
 * What the tracker hands a key (PROTOCOL.md, The tracker; CORE.md section 7; QX-5): the piece assisted next picks for
 * it on one problem, with the seams between the readings that stand (QX-19 section 4) and its brief filled from the
 * squares its inputs inherit (QX-23 section 3), and the offer across the problems here, each piece the one next would
 * name. Both leave out the pieces one rule keeps from the key, `excludedFor`, and hold what they hand out for that key
 * a minute, so two clients here are not handed the same piece at once. A function here takes the hand-out's part of
 * the tracker's context, `Reads`, the store alone, or the query alone.
 */
import type { ServerResponse } from 'node:http';
import {
  type Address,
  CAPABILITIES,
  type Capability,
  type Client,
  type Hash,
  type ProblemLayer,
  type ReduceInput,
  type Seam,
  briefOver,
  isAddress,
  next,
} from '@bitquilt/core';
import type { Layer } from './challenge.js';
import { Refusal, json } from './http.js';
import { offerOrder, seedInfo, watchExclusions } from './seeding.js';
import type { Store } from './store.js';
import type { Context } from './tracker.js';
import { replaced, supersededBy, viewIn } from './views.js';

/** What the hand-out reads of the tracker's context (tracker.ts). */
type Reads = Pick<Context, 'store' | 'options' | 'now' | 'layer' | 'inputFor' | 'hidden' | 'tracesOf'>;

/**
 * How long a piece handed out by next or the offer is held for that key, so two clients here are not handed the same
 * piece in the same minute.
 */
const HOLD_SECONDS = 60;

/** The seams `next` hands over with a piece: the same as the state shows (`tracesOf`). */
const seamsOf = ({ tracesOf }: Reads, pl: ProblemLayer, hash: Hash): Seam[] => tracesOf(pl).get(hash)?.seams ?? [];

/**
 * The key and the client a next or an offer is asked for: `key` with its checksum, `can` from the capabilities,
 * `model` as declared.
 */
function clientFrom(query: URLSearchParams): { key: Address; client: Client } {
  const key = query.get('key');
  if (!isAddress(key)) throw new Refusal(400, 'key: an address with its checksum');
  const can = (query.get('can') ?? '').split(',').filter(Boolean);
  if (!can.every((c) => (CAPABILITIES as readonly string[]).includes(c)))
    throw new Refusal(400, `can: from ${CAPABILITIES.join(', ')}`);
  return { key, client: { can: can as Capability[], model: query.get('model') ?? 'unknown/unknown' } };
}

/** Holds a piece for the key it was handed to, for HOLD_SECONDS from `at`. */
function holdFor(store: Store, problem: Hash, piece: Hash, key: Address, at: string): void {
  store.hold(problem, piece, key, new Date(Date.parse(at) + HOLD_SECONDS * 1000).toISOString());
}

/**
 * The pieces this tracker keeps from the key on one problem. Assisted next and the offer share this one rule, so the
 * offer names only a piece next would hand the key (QX-5 section 4). It keeps a piece held for another key; the
 * layer's unoffered pieces, a judge piece whose panel sits or ran out (QX-2); a human piece from a client that
 * declares no person (QX-3); what QX-4 section 4 keeps for the seeders: an open watch piece within its lease from a
 * key that does not seed, and, while one is open, every other piece from a key that does, so a seeder is handed the
 * watch piece first; and a staked piece the key's free standing cannot cover, on which it holds no lock (QX-15).
 * Those last are also named apart, since next's answer lists them.
 */
function excludedFor(
  store: Store,
  layered: Layer,
  pl: ProblemLayer,
  input: ReduceInput,
  key: Address,
  client: Client,
  at: string,
): { exclude: Set<Hash>; unaffordable: Hash[] } {
  const exclude = new Set<Hash>([...store.heldByOthers(pl.problem, key, at), ...pl.unoffered]);
  if (!client.can.includes('person')) for (const p of pl.pieces) if (p.kind.kind === 'human') exclude.add(p.hash);
  for (const h of watchExclusions(pl, input, key, seedInfo(input.receipts, pl.fold, at).seeders, at)) exclude.add(h);
  const unaffordable = [...layered.unaffordable(pl.problem, key)];
  for (const h of unaffordable) exclude.add(h);
  return { exclude, unaffordable };
}

/** Assisted next (CORE.md): the piece this tracker hands the key on one problem, held for it a minute. */
export function assisted(cx: Reads, res: ServerResponse, hash: Hash, query: URLSearchParams): void {
  const { store, now, layer, hidden, inputFor } = cx;
  const { key, client } = clientFrom(query);
  // The layer's fold: a struck piece is open again, and a challenged one is not offered while its panel sits.
  const layered = layer();
  // A problem taken down is 410 before its fold is read, as a post on its log is (`admitProblemEvent` in admit.ts).
  if (hidden().has(hash)) throw new Refusal(410, 'this problem is taken down here');
  const pl = viewIn(layered, hash);
  if (!pl) throw new Refusal(404, 'no such problem here');
  // A problem its owner has replaced with a newer version hands out nothing: the work is on the version that replaced
  // it.
  const superseded = supersededBy(store, hash, layered);
  if (superseded) {
    json(res, 200, { piece: null, unaffordable: [], superseded });
    return;
  }
  const state = pl.fold;
  const at = now();
  const { exclude, unaffordable } = excludedFor(store, layered, pl, inputFor(hash)!, key, client, at);
  // The second reader's pool (QX-19 section 5): asked with only=verify, the pick is from the pieces in needs_verify
  // or disputed alone, in this layer's fold. The core's order puts open pieces first wherever they outnumber those,
  // so without this a key whose reading was set aside would be handed an open piece, and its own fold would not hand
  // it the piece back, since the reading still stands there.
  const only = query.get('only');
  if (only !== null && only !== 'verify') throw new Refusal(400, 'only: verify, or left out');
  // A record piece (QX-20) is outside that pool: a second reader confirms or disagrees, and a record takes no second
  // opinion, only another reading.
  if (only === 'verify')
    for (const v of state.pieces)
      if ((v.state !== 'needs_verify' && v.state !== 'disputed') || pl.byHash.get(v.piece.hash)?.record)
        exclude.add(v.piece.hash);
  const pick = next(state, key, client, at, { exclude });
  if (!pick) {
    json(res, 200, { piece: null, unaffordable });
    return;
  }
  const { kind, stake, state: layerState } = pl.byHash.get(pick.piece.hash)!;
  holdFor(store, hash, pick.piece.hash, key, at);
  // QX-19 section 4: a piece whose readings differ goes out with its seams between the readings that stand, whether
  // the layer still calls it disputed or has set one reading aside, so the next reader sees what each rests on.
  const seams = seamsOf(cx, pl, pick.piece.hash);
  // The state is the layer's word: the fold's, except `recording` where the fold holds a record piece under
  // needs_verify (QX-20).
  json(res, 200, {
    piece: pick.piece.hash,
    name: pick.piece.name,
    state: layerState,
    // QX-23 section 3: the slot of an inherited input is filled with the returns of the set at the problem named.
    brief: briefOver(layered, pl, state.byHash.get(pick.piece.hash)!),
    schema: pick.schema ?? null,
    agree: pick.agree,
    requires: pick.requires,
    lease_h: pick.lease_h,
    verifier: pick.piece.verifier,
    kind: kind.kind,
    extension: kind.extension,
    strength: kind.strength,
    says: kind.says,
    weakest: kind.weakest,
    workspace: pick.piece.workspace ?? null,
    check: pick.piece.check ?? null,
    stake,
    unaffordable,
    seams,
  });
}

/**
 * QX-5: the problems here with a piece for the key, in the order they are offered, each piece the one assisted next
 * would name; the first is held as assisted next holds.
 */
export function offer(cx: Reads, res: ServerResponse, query: URLSearchParams): void {
  const { store, options, now, layer, hidden, inputFor } = cx;
  const { key, client } = clientFrom(query);
  const at = now();
  const layered = layer();
  const inputs = new Map<Hash, ReduceInput>();
  const hid = hidden();
  const gone = replaced(store, layered);
  for (const h of layered.problems.keys()) {
    if (hid.has(h) || gone.has(h)) continue;
    const input = inputFor(h);
    if (input) inputs.set(h, input);
  }
  const count = store.nextOfferCount(key);
  const firstSeeder = options.firstSeeder;
  const list = offerOrder(
    layered,
    inputs,
    key,
    client,
    at,
    count,
    (_h, pl, input) => excludedFor(store, layered, pl, input, key, client, at).exclude,
    firstSeeder
      ? (_h, pl, input) => seedInfo(input.receipts, pl.fold, at).seeders.has(pl.fold.rootOf(firstSeeder, at))
      : undefined,
  );
  const first = list[0];
  if (first) holdFor(store, first.problem, first.pick.piece.hash, key, at);
  json(res, 200, {
    offer: count,
    offers: list.map((o) => ({
      problem: o.problem,
      title: o.title,
      slug: o.slug,
      owner: o.owner,
      reason: o.reason,
      piece: o.pick.piece.hash,
      name: o.pick.piece.name,
      state: o.pick.state,
      verifier: o.pick.piece.verifier,
      requires: o.pick.requires,
      lease_h: o.pick.lease_h,
    })),
  });
}
