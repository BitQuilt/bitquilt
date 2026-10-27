/**
 * The coin as a layer, extension QX-17 (docs/ext/QX-17.md), with no HTTP in it. A tracker that carries the coin keeps
 * one more log, the coin log, and reads from the problem logs it holds which squares were verified (QX-16), which
 * locks were forfeited or restored (QX-15), which sets were accepted and which problems completed. From those lines,
 * the coin log's own and the published parameters it computes every root's balance: a fixed amount minted each epoch to
 * the verified squares by weight, vesting with time, locked at a door, escrowed to a problem and paid per square,
 * burned for standing. Everything here is a function of receipts anyone can hold; the tracker orders and decides nothing.
 */
import { type Address, type Event, type Hash, type Receipt, eventId, hashText, isAddress, isHash } from '@bitquilt/core';
import { type Admission, type Layer, type ProblemLayer, creditedRoots } from './challenge.js';
import type { LockView } from './stake.js';
import { viaOf } from './verifiers.js';

export const COIN = 'QX-17';
/** The pseudo-problem the coin log is chained from, as the identity log is from quilt:identity. */
export const COIN_LOG: Hash = hashText('quilt:coin');
export const COIN_EVENTS: ReadonlySet<string> = new Set(['lock', 'pay', 'burn', 'transfer', 'redeem']);

/** The parameters a tracker that carries the coin publishes: the coin's constitution (QX-17 section 1). */
export interface CoinParams {
  /** Another tracker's address whose ledger this one reads; absent, this tracker is the home. */
  home?: string;
  genesis: string;
  epoch_h: number;
  emission: { per_epoch: number; decline_bp: number; period_epochs: number };
  vesting_h: number;
  infra_bp: number;
  treasury: Address;
  unit: number;
  weights: { cross_vendor: number; same_vendor: number; attest: number };
  burn_rate: number;
  transfers_from: string | null;
  redeem_from: string | null;
}

/** What the door writes into a receipt's wrapper when it admits a coin-kind QX-15 lock: what it read of the coin lock, and where. */
export interface CoinWord { kind: 'coin'; amount: number; id: Hash; units: number; home: string; head: { seq: number; hash: string } | null }
/** What the door writes into a burn's wrapper: the standing it credited. */
export interface BurnWord { kind: 'burn'; amount: number; standing: number }

export interface CoinLockView {
  id: Hash;
  key: Address;
  root: Address;
  problem: Hash;
  piece: Hash;
  units: number;
  at: string;
  /** The QX-15 lock this one is bound to, or null while unbound. */
  bound: Hash | null;
  state: 'live' | 'released' | 'forfeited';
  /** When it ended, or null while live. */
  endedAt: string | null;
}

export interface BalanceView {
  root: Address;
  balance: number;
  vested: number;
  unvested: number;
  locked: number;
  escrowed: number;
  free: number;
  free_vested: number;
  minted: number;
  received: number;
  burned: number;
  forfeited: number;
  /** What left the ledger by redeem, for minting on the chain (the door out). */
  redeemed: number;
}

/** A redeem line the layer kept: what the bridge's poster puts in its tree, and the ERC-20 mints once, by `id`. */
export interface RedeemLine {
  /** The coin log line's hash (QX-11), 64 hex characters: the id the chain mints against, once. */
  id: string;
  seq: number;
  root: Address;
  /** The address the coin is minted to: the redeem's `to`, or the root itself. */
  to: Address;
  amount: number;
  at: string;
}

export interface EpochView { epoch: number; start: string; end: string; amount: number; treasury: number; weight: number; minted: number }

export interface CoinLayer {
  params: CoinParams;
  now: string;
  head: { seq: number; hash: string } | null;
  balance(root: Address): BalanceView;
  balances(): Map<Address, BalanceView>;
  lock(id: Hash): CoinLockView | null;
  locks(root: Address): CoinLockView[];
  epochs(): EpochView[];
  /** The redeem lines kept, in receipt order, up to a sequence when one is given. */
  redeems(upto?: number): RedeemLine[];
  /** Whether a coin-log event would be kept if received now, and why not; for a burn that would, the standing it credits. */
  admit(event: Event): Admission & { standing?: number };
  dropped: { id: Hash; type: string; why: string }[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const whole = (v: unknown, min: number): v is number => Number.isInteger(v) && (v as number) >= min;
const isTime = (s: unknown): s is string => typeof s === 'string' && Number.isFinite(Date.parse(s));
const plusHours = (t: string, h: number): string => new Date(Date.parse(t) + h * 3_600_000).toISOString();

/** Why these are not coin parameters, or nothing: the shape a tracker is started with. */
export function coinParamsProblems(p: unknown): string[] {
  if (!isRecord(p)) return ['coin: an object'];
  const out: string[] = [];
  if (p.home !== undefined && (typeof p.home !== 'string' || !/^https?:\/\//.test(p.home))) out.push('coin.home: a tracker address');
  if (!isTime(p.genesis)) out.push('coin.genesis: a time');
  if (!(typeof p.epoch_h === 'number' && p.epoch_h > 0)) out.push('coin.epoch_h: hours above 0');
  const e = p.emission;
  if (!isRecord(e) || !whole(e.per_epoch, 0) || !whole(e.decline_bp, 0) || (e.decline_bp as number) > 10000 || !whole(e.period_epochs, 1)) out.push('coin.emission: per_epoch, decline_bp (0 to 10000) and period_epochs (at least 1), whole');
  if (!(typeof p.vesting_h === 'number' && p.vesting_h >= 0)) out.push('coin.vesting_h: hours from 0');
  if (!whole(p.infra_bp, 0) || (p.infra_bp as number) > 10000) out.push('coin.infra_bp: 0 to 10000');
  if (!isAddress(p.treasury)) out.push('coin.treasury: an address with its checksum');
  if (!whole(p.unit, 1)) out.push('coin.unit: units a coin, at least 1');
  const w = p.weights;
  if (!isRecord(w) || !whole(w.cross_vendor, 0) || !whole(w.same_vendor, 0) || !whole(w.attest, 0)) out.push('coin.weights: cross_vendor, same_vendor and attest, whole');
  if (!whole(p.burn_rate, 1)) out.push('coin.burn_rate: units a point, at least 1');
  for (const k of ['transfers_from', 'redeem_from']) if (p[k] !== null && !isTime(p[k])) out.push(`coin.${k}: a time or null`);
  return out;
}

/** Why this is not a well-formed body for a coin-log event of this type, or nothing. */
export function coinBodyProblems(type: string, body: unknown): string[] {
  if (!isRecord(body)) return ['body: an object'];
  const out: string[] = [];
  const only = (keys: string[]) => { for (const k of Object.keys(body)) if (!keys.includes(k)) out.push(`body.${k}: not a field of a ${type}`); };
  switch (type) {
    case 'lock':
      if (!isHash(body.problem)) out.push('body.problem: a hash');
      if (!isHash(body.piece)) out.push('body.piece: a hash');
      if (!whole(body.amount, 1)) out.push('body.amount: a whole number of at least 1');
      only(['problem', 'piece', 'amount']);
      break;
    case 'pay':
      if (!isHash(body.problem)) out.push('body.problem: a hash');
      if (!whole(body.amount, 1)) out.push('body.amount: a whole number of at least 1');
      if (!whole(body.per_square, 1)) out.push('body.per_square: a whole number of at least 1');
      only(['problem', 'amount', 'per_square']);
      break;
    case 'burn':
      if (!whole(body.amount, 1)) out.push('body.amount: a whole number of at least 1');
      only(['amount']);
      break;
    case 'transfer':
      if (!isAddress(body.to)) out.push('body.to: an address with its checksum');
      if (!whole(body.amount, 1)) out.push('body.amount: a whole number of at least 1');
      only(['to', 'amount']);
      break;
    case 'redeem':
      if (!whole(body.amount, 1)) out.push('body.amount: a whole number of at least 1');
      if (body.to !== undefined && !isAddress(body.to)) out.push('body.to: an address with its checksum');
      only(['amount', 'to']);
      break;
    default:
      out.push('the coin log takes lock, pay, burn, transfer and redeem');
  }
  return out;
}

/** The amount an epoch mints before the division: per_epoch, reduced once per period by decline_bp, each reduction floored. */
export function epochAmount(params: CoinParams, epoch: number): number {
  let amount = params.emission.per_epoch;
  const reductions = Math.floor(epoch / params.emission.period_epochs);
  for (let i = 0; i < reductions; i++) amount = Math.floor((amount * (10000 - params.emission.decline_bp)) / 10000);
  return amount;
}

type LineKind = 'verified' | 'forfeit' | 'restore' | 'release' | 'bind' | 'accepted' | 'complete' | 'mint' | 'posted';
const ORDER: Record<LineKind, number> = { verified: 0, forfeit: 1, restore: 2, release: 3, bind: 4, accepted: 5, complete: 6, mint: 7, posted: 8 };
interface Line { kind: LineKind; at: string; id: string; problem?: Hash; piece?: Hash; root?: Address; weight?: number; roots?: Address[]; coin?: Hash; lock?: Hash; epoch?: number; receipt?: Receipt }

interface Account { minted: number; received: number; drawnVested: number; drawnUnvested: number; locked: number; escrowed: number; burned: number; forfeited: number; redeemed: number; mints: { at: string; amount: number }[] }
interface Escrow { payer: Address; remaining: number; per_square: number; at: string }
interface Coin extends CoinLockView { forfeit: { fromUnvested: number; fromVested: number; penalty: number } | null }

export function coinLayer(input: { layer: Layer; params: CoinParams; receipts: Receipt[]; now: string }): CoinLayer {
  const { layer, params, now } = input;
  const vestingMs = params.vesting_h * 3_600_000;
  const accounts = new Map<Address, Account>();
  const account = (root: Address): Account => {
    let a = accounts.get(root);
    if (!a) {
      a = { minted: 0, received: 0, drawnVested: 0, drawnUnvested: 0, locked: 0, escrowed: 0, burned: 0, forfeited: 0, redeemed: 0, mints: [] };
      accounts.set(root, a);
    }
    return a;
  };
  const balanceOf = (a: Account) => a.minted + a.received - a.drawnVested - a.drawnUnvested;
  const vestedTotal = (a: Account, at: string): number => {
    const t = Date.parse(at);
    let sum = a.received;
    for (const m of a.mints) {
      const since = t - Date.parse(m.at);
      if (since <= 0) continue;
      sum += vestingMs === 0 || since >= vestingMs ? m.amount : Math.floor((m.amount * since) / vestingMs);
    }
    return sum;
  };
  const vestedOf = (a: Account, at: string): number => Math.min(balanceOf(a), Math.max(0, vestedTotal(a, at) - a.drawnVested));
  const unvestedOf = (a: Account, at: string): number => balanceOf(a) - vestedOf(a, at);
  const freeOf = (a: Account): number => balanceOf(a) - a.locked - a.escrowed;
  const freeVestedOf = (a: Account, at: string): number => Math.min(freeOf(a), vestedOf(a, at));
  /** Takes `x` from the unvested part first, then the vested; says how it was split. */
  const drawUnvestedFirst = (a: Account, x: number, at: string): { fromUnvested: number; fromVested: number } => {
    const fromUnvested = Math.min(unvestedOf(a, at), x);
    a.drawnUnvested += fromUnvested;
    a.drawnVested += x - fromUnvested;
    return { fromUnvested, fromVested: x - fromUnvested };
  };
  const rootOf = (key: Address, at: string): Address => {
    const first = layer.problems.values().next().value as ProblemLayer | undefined;
    return first ? first.fold.rootOf(key, at) : key;
  };

  const dropped: CoinLayer['dropped'] = [];
  const coins = new Map<Hash, Coin>();
  const escrows = new Map<Hash, Escrow[]>();
  const epochs: EpochView[] = [];
  const lines: Line[] = [];
  const verified: Line[] = [];
  const redeemLines: RedeemLine[] = [];

  // Derived lines from the problem logs, as the layers fold them.
  for (const pl of layer.problems.values()) {
    const fold = pl.fold;
    for (const g of pl.gold) for (const c of g.commitments) {
      if (c.outcome !== 'match' || c.revealedAt === null || c.piece === null) continue;
      const view = fold.byHash.get(c.piece);
      const set = view?.accepting;
      if (!set || set.kind !== 'agree') continue;
      const via = viaOf(set);
      const vendors = new Set(set.reveals.map((r) => r.vendor));
      const weight = via === 'attest' ? params.weights.attest : vendors.size > 1 ? params.weights.cross_vendor : params.weights.same_vendor;
      for (const r of set.reveals) {
        const line: Line = { kind: 'verified', at: c.revealedAt, id: `${c.piece}:${r.root}`, problem: pl.problem, piece: c.piece, root: fold.rootOf(r.root, now), weight };
        verified.push(line);
        lines.push(line);
      }
    }
    for (const v of fold.pieces) if (v.accepting && v.accepting.completedAt <= now) {
      lines.push({ kind: 'accepted', at: v.accepting.completedAt, id: `${v.piece.hash}:${v.accepting.completedAt}`, problem: pl.problem, piece: v.piece.hash, roots: creditedRoots(v).map((r) => fold.rootOf(r, now)) });
    }
    if (fold.complete) {
      let latest: string | null = null;
      for (const v of fold.pieces) if (v.windowEnd !== null && (latest === null || v.windowEnd > latest)) latest = v.windowEnd;
      const at = latest ?? now;
      if (at <= now) lines.push({ kind: 'complete', at, id: `complete:${pl.problem}`, problem: pl.problem });
    }
    for (const l of pl.locks as (LockView & { coinId?: Hash | null })[]) {
      if (l.kind !== 'coin' || !l.coinId) continue;
      lines.push({ kind: 'bind', at: l.at, id: `bind:${l.id}`, coin: l.coinId, lock: l.id });
      if (l.forfeitedAt !== null) lines.push({ kind: 'forfeit', at: l.forfeitedAt, id: `forfeit:${l.id}:${l.forfeitedAt}`, coin: l.coinId });
      if (l.restoredAt !== null) lines.push({ kind: 'restore', at: l.restoredAt, id: `restore:${l.id}:${l.restoredAt}`, coin: l.coinId });
      const ends = layer.lockEndsAt(l);
      if (ends !== null && ends <= now && (l.forfeitedAt === null || (l.restoredAt !== null && ends > l.restoredAt))) lines.push({ kind: 'release', at: ends, id: `release:${l.id}`, coin: l.coinId });
    }
  }
  // Every epoch that has ended.
  const genesis = Date.parse(params.genesis);
  const epochMs = params.epoch_h * 3_600_000;
  for (let n = 0; ; n++) {
    const end = genesis + (n + 1) * epochMs;
    if (end > Date.parse(now)) break;
    lines.push({ kind: 'mint', at: new Date(end).toISOString(), id: `mint:${n}`, epoch: n });
    if (n > 100_000) break;
  }
  // The coin log's own lines, in receipt order.
  const receipts = [...input.receipts].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  for (const r of receipts) {
    const at = r.received[0]?.at;
    if (!at) continue;
    lines.push({ kind: 'posted', at, id: eventId(r.event), receipt: r });
  }
  const byOrder = (a: Line, b: Line) => (a.at < b.at ? -1 : a.at > b.at ? 1 : ORDER[a.kind] - ORDER[b.kind] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  lines.sort(byOrder);

  /** A line added while folding (an unbound lock's release), kept in order. */
  const insert = (line: Line) => {
    let i = lines.findIndex((x) => byOrder(x, line) > 0);
    if (i < 0) i = lines.length;
    lines.splice(i, 0, line);
  };
  const leaseOf = (problem: Hash, piece: Hash): number => {
    const pl = layer.problems.get(problem);
    const view = pl?.fold.byHash.get(piece);
    return view?.piece.lease_h ?? pl?.fold.envelope.problem.settings.lease_h ?? 0;
  };

  type Check = { ok: true; root: Address; standing?: number } | { ok: false; why: string };
  /** Whether a posted event would be kept at `at`, by section 2 of QX-17. */
  const check = (e: Event, at: string): Check => {
    if (!COIN_EVENTS.has(e.type)) return { ok: false, why: 'the coin log takes lock, pay, burn, transfer and redeem' };
    if (e.problem !== undefined || e.piece !== undefined) return { ok: false, why: 'a coin event names no problem in its fields' };
    const shape = coinBodyProblems(e.type, e.body);
    if (shape.length) return { ok: false, why: shape[0]! };
    const root = rootOf(e.key, at);
    const a = account(root);
    const b = e.body;
    switch (e.type) {
      case 'lock': {
        const pl = layer.problems.get(b.problem as Hash);
        if (!pl) return { ok: false, why: 'no such problem here' };
        if (!pl.fold.byHash.has(b.piece as Hash)) return { ok: false, why: 'names a piece this problem does not have' };
        const f = freeOf(a);
        if (f < (b.amount as number)) return { ok: false, why: `free coin ${f} is below the lock of ${b.amount}` };
        return { ok: true, root };
      }
      case 'pay': {
        if (!layer.problems.has(b.problem as Hash)) return { ok: false, why: 'no such problem here' };
        const f = freeOf(a);
        if (f < (b.amount as number)) return { ok: false, why: `free coin ${f} is below the pay of ${b.amount}` };
        return { ok: true, root };
      }
      case 'burn': {
        const f = freeOf(a);
        if (f < (b.amount as number)) return { ok: false, why: `free coin ${f} is below the burn of ${b.amount}` };
        return { ok: true, root, standing: Math.floor((b.amount as number) / params.burn_rate) };
      }
      case 'transfer': {
        if (params.transfers_from === null || at < params.transfers_from) return { ok: false, why: 'transfers are off' };
        const f = freeVestedOf(a, at);
        if (f < (b.amount as number)) return { ok: false, why: `free vested coin ${f} is below the transfer of ${b.amount}` };
        return { ok: true, root };
      }
      case 'redeem': {
        if (params.redeem_from === null || at < params.redeem_from) return { ok: false, why: 'redemption is off' };
        const f = freeVestedOf(a, at);
        if (f < (b.amount as number)) return { ok: false, why: `free vested coin ${f} is below the redeem of ${b.amount}` };
        return { ok: true, root };
      }
      default:
        return { ok: false, why: 'the coin log takes lock, pay, burn, transfer and redeem' };
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    switch (line.kind) {
      case 'mint': {
        const n = line.epoch!;
        const start = new Date(genesis + n * epochMs).toISOString();
        const end = line.at;
        const amount = epochAmount(params, n);
        const inEpoch = verified.filter((v) => v.at >= start && v.at < end);
        const weight = inEpoch.reduce((s, v) => s + (v.weight ?? 0), 0);
        let minted = 0;
        let treasury = 0;
        if (weight > 0 && amount > 0) {
          treasury = Math.floor((amount * params.infra_bp) / 10000);
          if (treasury > 0) {
            const t = account(params.treasury);
            t.mints.push({ at: end, amount: treasury });
            t.minted += treasury;
            minted += treasury;
          }
          // One minting per root an epoch: each square's share floored, the root's shares summed, so vesting rounds once.
          const rest = amount - treasury;
          const shares = new Map<Address, number>();
          for (const v of inEpoch) {
            const share = Math.floor((rest * (v.weight ?? 0)) / weight);
            if (share > 0) shares.set(v.root!, (shares.get(v.root!) ?? 0) + share);
          }
          for (const [root, share] of shares) {
            const a = account(root);
            a.mints.push({ at: end, amount: share });
            a.minted += share;
            minted += share;
          }
        }
        epochs.push({ epoch: n, start, end, amount, treasury, weight, minted });
        break;
      }
      case 'accepted': {
        const list = escrows.get(line.problem!) ?? [];
        const roots = line.roots ?? [];
        const e = list.find((x) => x.remaining > 0 && x.at < line.at);
        if (!e || roots.length === 0) break;
        const pay = Math.min(e.per_square, e.remaining);
        const share = Math.floor(pay / roots.length);
        if (share <= 0) break;
        const total = share * roots.length;
        const payer = account(e.payer);
        payer.escrowed -= total;
        drawUnvestedFirst(payer, total, line.at);
        e.remaining -= total;
        for (const r of roots) account(r).received += share;
        break;
      }
      case 'complete': {
        for (const e of escrows.get(line.problem!) ?? []) {
          if (e.remaining <= 0) continue;
          account(e.payer).escrowed -= e.remaining;
          e.remaining = 0;
        }
        break;
      }
      case 'bind': {
        const c = coins.get(line.coin!);
        if (c && c.state === 'live' && c.bound === null) c.bound = line.lock!;
        break;
      }
      case 'forfeit': {
        const c = coins.get(line.coin!);
        if (!c || c.state !== 'live') break;
        const a = account(c.root);
        a.locked -= c.units;
        const split = drawUnvestedFirst(a, c.units, line.at);
        const penalty = Math.min(unvestedOf(a, line.at), c.units);
        a.drawnUnvested += penalty;
        a.forfeited += c.units + penalty;
        c.forfeit = { ...split, penalty };
        c.state = 'forfeited';
        c.endedAt = line.at;
        break;
      }
      case 'restore': {
        const c = coins.get(line.coin!);
        if (!c || c.state !== 'forfeited' || !c.forfeit) break;
        const a = account(c.root);
        a.drawnUnvested -= c.forfeit.fromUnvested + c.forfeit.penalty;
        a.drawnVested -= c.forfeit.fromVested;
        a.forfeited -= c.units + c.forfeit.penalty;
        a.locked += c.units;
        c.forfeit = null;
        c.state = 'live';
        c.endedAt = null;
        break;
      }
      case 'release': {
        const c = coins.get(line.coin!);
        if (!c || c.state !== 'live') break;
        account(c.root).locked -= c.units;
        c.state = 'released';
        c.endedAt = line.at;
        break;
      }
      case 'posted': {
        const r = line.receipt!;
        const e = r.event;
        const id = line.id as Hash;
        const result = check(e, line.at);
        if (!result.ok) {
          dropped.push({ id, type: e.type, why: result.why });
          break;
        }
        const a = account(result.root);
        const b = e.body;
        if (e.type === 'lock') {
          const units = b.amount as number;
          a.locked += units;
          coins.set(id, { id, key: e.key, root: result.root, problem: b.problem as Hash, piece: b.piece as Hash, units, at: line.at, bound: null, state: 'live', endedAt: null, forfeit: null });
          // Unbound past the piece's lease, it is released; a bind before then stands in the way.
          const idle = plusHours(line.at, leaseOf(b.problem as Hash, b.piece as Hash));
          const boundBefore = lines.some((x) => x.kind === 'bind' && x.coin === id && x.at < idle);
          if (!boundBefore && idle <= now) insert({ kind: 'release', at: idle, id: `idle:${id}`, coin: id });
        } else if (e.type === 'pay') {
          const list = escrows.get(b.problem as Hash) ?? [];
          list.push({ payer: result.root, remaining: b.amount as number, per_square: b.per_square as number, at: line.at });
          escrows.set(b.problem as Hash, list);
          a.escrowed += b.amount as number;
        } else if (e.type === 'burn') {
          drawUnvestedFirst(a, b.amount as number, line.at);
          a.burned += b.amount as number;
        } else if (e.type === 'transfer') {
          a.drawnVested += b.amount as number;
          account(b.to as Address).received += b.amount as number;
        } else if (e.type === 'redeem') {
          // The coin leaves the ledger; the line is what the chain mints against, once, by the line's own hash.
          const amount = b.amount as number;
          a.drawnVested += amount;
          a.redeemed += amount;
          redeemLines.push({ id: r.hash ?? id.replace('sha256:', ''), seq: r.seq ?? 0, root: result.root, to: (b.to as Address | undefined) ?? result.root, amount, at: line.at });
        }
        break;
      }
      default:
        break;
    }
  }

  const view = (root: Address): BalanceView => {
    const a = accounts.get(root) ?? account(root);
    const balance = balanceOf(a);
    const vested = vestedOf(a, now);
    return {
      root, balance, vested, unvested: balance - vested, locked: a.locked, escrowed: a.escrowed, free: freeOf(a), free_vested: freeVestedOf(a, now),
      minted: a.minted, received: a.received, burned: a.burned, forfeited: a.forfeited, redeemed: a.redeemed,
    };
  };
  const last = receipts[receipts.length - 1];
  const head = last && typeof last.seq === 'number' && typeof last.hash === 'string' ? { seq: last.seq, hash: last.hash } : null;
  const strip = (c: Coin): CoinLockView => ({ id: c.id, key: c.key, root: c.root, problem: c.problem, piece: c.piece, units: c.units, at: c.at, bound: c.bound, state: c.state, endedAt: c.endedAt });

  return {
    params, now, head, dropped,
    balance: view,
    balances: () => new Map([...accounts.keys()].filter((r) => balanceOf(accounts.get(r)!) !== 0 || accounts.get(r)!.minted > 0 || accounts.get(r)!.received > 0).map((r) => [r, view(r)])),
    lock: (id) => { const c = coins.get(id); return c ? strip(c) : null; },
    locks: (root) => [...coins.values()].filter((c) => c.root === root).map(strip),
    epochs: () => epochs,
    redeems: (upto) => redeemLines.filter((x) => upto === undefined || x.seq <= upto),
    admit: (event) => {
      const r = check(event, now);
      return r.ok ? { ok: true, ...(r.standing !== undefined ? { standing: r.standing } : {}) } : r;
    },
  };
}
