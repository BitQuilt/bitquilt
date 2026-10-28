/**
 * The coin as a client sees it (QX-17): where a tracker says it lives, what this key holds of it, and the three events
 * that move it, pay, transfer and redeem. Each works through the door its Quilt hands it (door.ts), so the key signs
 * here as everywhere else and nothing posts but through the Quilt; the Quilt's methods of the same names call these.
 */
import { type Address, type Hash, eventId, isAddress } from '@bitquilt/core';
import type { Door } from './door.js';
import { type Posted, askJson } from './resolver.js';

/** This key's coin at a home (QX-17), as /coin/balance answers it: the balance in units, what has vested, what is locked or escrowed, and what is free. `home` is the coin's home, the tracker that keeps the coin log. */
export interface CoinBalance {
  home: string;
  balance: number;
  vested: number;
  unvested: number;
  locked: number;
  escrowed: number;
  free: number;
  free_vested: number;
}

/** Where a tracker's coin lives, as its well-known says under stake: the coin's home, the tracker that keeps the coin log, and the burn rate a point of standing costs there; null where it honours none. */
export async function coinAt(door: Door, tracker: string): Promise<{ coinHome: string; burn_rate: number } | null> {
  const t = tracker.endsWith('/') ? tracker : `${tracker}/`;
  const wk = await door.wellKnown(t);
  const stake = wk?.stake as { coin?: string | null; burn_rate?: number } | undefined;
  if (!stake?.coin || typeof stake.burn_rate !== 'number') return null;
  const coinHome = stake.coin === 'here' ? t : stake.coin.endsWith('/') ? stake.coin : `${stake.coin}/`;
  return { coinHome, burn_rate: stake.burn_rate };
}

/** The coin's home among this client's trackers: the first that carries the coin, or null. */
export async function coinHome(door: Door): Promise<string | null> {
  return door.firstAnswer(door.config.trackers, async (t) => (await coinAt(door, t))?.coinHome ?? null);
}

/** This key's coin at a home: balance, vested, locked, escrowed, free; null with no key or no answer. */
export async function coinBalance(door: Door, home: string): Promise<CoinBalance | null> {
  const address = door.identity?.address;
  if (!address) return null;
  const j = await askJson<Omit<CoinBalance, 'home'>>(`${home}coin/balance/${address}`);
  return j && { home, balance: j.balance, vested: j.vested, unvested: j.unvested, locked: j.locked, escrowed: j.escrowed, free: j.free, free_vested: j.free_vested };
}

/** This key's coin at the first of this client's trackers that carries one, or null. */
export async function balance(door: Door): Promise<CoinBalance | null> {
  const home = await coinHome(door);
  return home ? coinBalance(door, home) : null;
}

/** A pay to a problem: coin escrowed on the coin log of the problem's home, paid per square to the roots of each set accepted after it, the rest back to this key when the problem completes. */
export async function pay(door: Door, problem: Hash, amount: number, perSquare: number): Promise<Posted & { id: Hash; home: string }> {
  if (!Number.isInteger(amount) || amount < 1 || !Number.isInteger(perSquare) || perSquare < 1) throw new Error('a pay is a whole amount and a whole price per square, each at least 1');
  const home = await door.firstAnswer(door.trackersFor(problem), async (t) => (await coinAt(door, t))?.coinHome ?? null);
  if (!home) throw new Error('no tracker this client knows for that problem carries the coin');
  const { event, posted } = await door.postSigned({ quilt: 1, type: 'pay', key: door.needKey().address, ts: door.stamp(), body: { problem, amount, per_square: perSquare } }, 'coin', [home], 'pay');
  return { id: eventId(event), ...posted, home };
}

/**
 * A transfer of this key's coin to an address: vested free coin moved on the coin log of the coin's home, from the
 * time the home's parameters name. The recipient need not be a key anywhere yet.
 */
export async function transfer(door: Door, to: Address, amount: number): Promise<Posted & { id: Hash; home: string }> {
  if (!isAddress(to)) throw new Error('the recipient is an address with its checksum');
  if (!Number.isInteger(amount) || amount < 1) throw new Error('a transfer is a whole number of units, at least 1');
  const home = await coinHome(door);
  if (!home) throw new Error('no tracker this client knows carries the coin');
  const { event, posted } = await door.postSigned({ quilt: 1, type: 'transfer', key: door.needKey().address, ts: door.stamp(), body: { to, amount } }, 'coin', [home], 'transfer');
  return { id: eventId(event), ...posted, home };
}

/**
 * A redeem of this key's coin (the door out): vested free coin taken off the ledger as a signed line on the coin log,
 * to be minted on the chain to this key's address or the one named once the bridge's poster carries the line under a
 * posted head. Final on the ledger from its receipt.
 */
export async function redeem(door: Door, amount: number, to?: Address): Promise<Posted & { id: Hash; home: string }> {
  if (to !== undefined && !isAddress(to)) throw new Error('the recipient is an address with its checksum');
  if (!Number.isInteger(amount) || amount < 1) throw new Error('a redeem is a whole number of units, at least 1');
  const home = await coinHome(door);
  if (!home) throw new Error('no tracker this client knows carries the coin');
  const { event, posted } = await door.postSigned({ quilt: 1, type: 'redeem', key: door.needKey().address, ts: door.stamp(), body: { amount, ...(to ? { to } : {}) } }, 'coin', [home], 'redeem');
  return { id: eventId(event), ...posted, home };
}
