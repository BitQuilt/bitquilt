/**
 * Stake at the door from the client's side (QX-15 section 6, and coin in its place, QX-17 section 9): the owner's
 * stake rule, posted at publish and later, and the lock before a claim, of standing or of coin, with the plan that
 * picks a piece this key's free coin covers where its free standing cannot. Each works through the door its Quilt
 * hands it (door.ts), so the key signs here as everywhere else and nothing posts but through the Quilt. `next` keeps
 * its numbered steps in quilt.ts and calls `coinInstead` at step 3 and `lockBefore` at step 4; the Quilt's
 * `stakeRule` and `publish` call the other two.
 */
import { type Hash, type Pick, type State, eventId } from '@bitquilt/core';
import { coinAt, coinBalance } from './coin.js';
import type { Door } from './door.js';
import type { Published } from './quilt.js';
import { layerByHash } from './render.js';
import type { Posted } from './resolver.js';

/**
 * A plan to lock coin in place of standing (QX-17): where the coin log is, how many units at the burn rate, and the
 * stake they stand for.
 */
export interface CoinPlan {
  coinHome: string;
  units: number;
  stake: number;
}

/**
 * QX-17: standing is short. Where the tracker honours coin and this key's free coin covers a piece's stake at the
 * burn rate, that piece is picked and the plan says where the coin is locked and how much; null where no piece can
 * be covered that way.
 */
export async function coinInstead(
  door: Door,
  hash: Hash,
  state: State,
  tracker: string,
  unaffordable: Hash[],
): Promise<{ pick: Pick; plan: CoinPlan } | null> {
  const coin = await coinAt(door, tracker);
  if (!coin) return null;
  const layer = await door.layerOf(hash, tracker);
  const mine = await coinBalance(door, coin.coinHome);
  if (!layer || !mine) return null;
  const byHash = layerByHash(layer);
  for (const candidate of unaffordable) {
    const asked = byHash.get(candidate)?.stake ?? 0;
    const units = asked * coin.burn_rate;
    if (asked <= 0 || units > mine.free) continue;
    const pick = door.pickOnly(state, candidate, door.stamp());
    if (pick) return { pick, plan: { coinHome: coin.coinHome, units, stake: asked } };
  }
  return null;
}

/**
 * The lock before the claim: of standing where the problem asks a stake (QX-15); of coin where the plan says so
 * (QX-17), the coin locked on the home's log first and then the lock at the door naming it. The person's own client
 * asked once for the lock and the claim together. What was locked, or null where nothing was asked.
 */
export async function lockBefore(
  door: Door,
  hash: Hash,
  piece: Hash,
  trackers: string[],
  stake: number,
  plan: CoinPlan | null,
): Promise<'standing' | 'coin' | null> {
  const key = door.needKey().address;
  if (plan) {
    const onLog = door.sign({
      quilt: 1,
      type: 'lock',
      key,
      ts: door.stamp(),
      body: { problem: hash, piece, amount: plan.units },
    });
    const c = await door.post(onLog, 'coin', [plan.coinHome]);
    // A queued lock is no lock, since the door would refuse the claim: this one is not left to the queue.
    if (c.error || c.queued)
      throw new Error(
        `the coin's home did not take the lock of ${plan.units} units${c.error ? `: ${c.error}` : ''}; nothing was claimed`,
      );
    await door.postSigned(
      {
        quilt: 1,
        type: 'lock',
        problem: hash,
        piece,
        key,
        ts: door.stamp(1),
        body: { kind: 'coin', amount: plan.stake, id: eventId(onLog) },
      },
      hash,
      trackers,
      `coin lock of ${plan.stake}`,
    );
    return 'coin';
  }
  if (stake > 0) {
    await door.postSigned(
      {
        quilt: 1,
        type: 'lock',
        problem: hash,
        piece,
        key,
        ts: door.stamp(),
        body: { kind: 'standing', amount: stake },
      },
      hash,
      trackers,
      `lock of ${stake}`,
    );
    return 'standing';
  }
  return null;
}

/**
 * The stake a problem asks of a claim on its pieces (QX-15): a stake_rule event from the owner on the problem's log,
 * replacing the one before.
 */
export async function stakeRule(door: Door, problem: Hash, min: number, pieces?: string[]): Promise<Posted> {
  if (!Number.isInteger(min) || min < 0) throw new Error('the stake is a whole number from 0');
  const { posted } = await door.postSigned(
    {
      quilt: 1,
      type: 'stake_rule',
      problem,
      key: door.needKey().address,
      ts: door.stamp(),
      body: { min, ...(pieces && pieces.length ? { pieces } : {}) },
    },
    problem,
    door.trackersFor(problem),
    'stake rule',
  );
  return posted;
}

/**
 * QX-15: the stake the owner asks, on the problem's log right after the envelope, where the envelope went; a refusal
 * is listed rather than thrown, since the problem is out.
 */
export async function ruleAtPublish(
  door: Door,
  out: Published,
  stake: { min: number; pieces?: string[] },
): Promise<void> {
  const id = door.needKey();
  const rule = door.sign({
    quilt: 1,
    type: 'stake_rule',
    problem: out.hash,
    key: id.address,
    ts: door.stamp(),
    body: { min: stake.min, ...(stake.pieces?.length ? { pieces: stake.pieces } : {}) },
  });
  const r = await door.post(rule, out.hash, out.posted);
  if (r.error && !r.queued) out.refused.push(`stake rule: ${r.error}`);
}
