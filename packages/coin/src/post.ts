/**
 * The poster job: reads the coin log's head and its redeem lines from the home tracker, builds the Merkle tree over
 * them, and puts the head and the root into `Anchors` when the home's head is newer than the last one posted. A head
 * already posted is kept as it is, so running the job twice over the same head posts once. The chain is reached only
 * through the functions of `chain.ts`, which the caller may stand in for, as it may stand in for `fetch`: a door here
 * is the few chain functions a job calls, which a test stands in for.
 */
import { isRecord } from '@bitquilt/core';
import { type Chain, lastPosted, postHead } from './chain.js';
import { type HomeRead, fromHome } from './home.js';
import { type Hex, leaf, root as treeRoot } from './merkle.js';
import { address, checkLine, hex64, wholeNumber } from './shapes.js';

/** One redeem line as the home serves it at `GET /coin/redeems`: the shape `packages/tracker/src/coin.ts` serves there; keep the two the same. */
export interface RedeemLine {
  /** The coin log line's hash, 64 lowercase hex characters. */
  id: string;
  seq: number;
  /** The holder's root, an address. */
  root: string;
  /** The address the coin is minted to. */
  to: string;
  /** Whole units; a unit is one millionth of a coin. */
  amount: number;
}

export interface Redeems {
  head: { seq: number; hash: string };
  redeems: RedeemLine[];
}

/** The chain functions the poster calls; a test hands in its own. */
export interface PosterDoor {
  lastPosted(chain: Chain): Promise<number>;
  postHead(chain: Chain, post: { seq: number; head: Hex; root: Hex }): Promise<{ tx: Hex }>;
}

export interface PostOptions {
  /** The home tracker's address. */
  home: string;
  chain: Chain;
  door?: PosterDoor;
  fetchImpl?: typeof fetch;
  /** Ask the home for the ledger as it stood at this sequence; absent, its current head. */
  upto?: number;
}

export interface PostReport {
  seq: number;
  /** The head as the home says it, 64 hex characters. */
  head: string;
  root: Hex;
  posted: boolean;
  redeems: number;
  tx?: Hex;
}

/** The home's answer checked for shape; anything else is refused with what was wrong. */
export function checkRedeems(answer: unknown): Redeems {
  if (!isRecord(answer)) throw new Error('the home answered with something other than an object');
  const head = isRecord(answer.head) ? answer.head : {};
  const seq = wholeNumber(head.seq, 'the head', 'whole sequence', 0);
  const hash = hex64(head.hash, 'the head', 'hash');
  if (!Array.isArray(answer.redeems)) throw new Error('the redeems are not a list');
  const redeems = answer.redeems.map((r: unknown, i: number) =>
    checkLine<RedeemLine>(r, `redeem ${i + 1}`, {
      id: (v, at) => hex64(v, at, 'id'),
      seq: (v, at) => {
        const s = wholeNumber(v, at, 'sequence at or before the head', 1);
        if (s > seq) throw new Error(`${at} has no sequence at or before the head`);
        return s;
      },
      root: (v, at) => address(v, at, 'root address'),
      to: (v, at) => address(v, at, 'address to mint to'),
      amount: (v, at) => wholeNumber(v, at, 'whole amount', 0),
    }),
  );
  const ids = new Set(redeems.map((r) => r.id));
  if (ids.size !== redeems.length) throw new Error('two redeems carry one id');
  return { head: { seq, hash }, redeems };
}

/** `GET /coin/redeems` at the home, checked; `agent` names the job asking. */
export function readRedeems(home: string, options: HomeRead): Promise<Redeems> {
  return fromHome(home, '/coin/redeems', options, checkRedeems);
}

/** The Merkle root over the redeem lines, as `Anchors` holds it. */
export function redeemRoot(redeems: readonly RedeemLine[]): Hex {
  return treeRoot(redeems.map((r) => leaf(`0x${r.id}`, r.to, r.amount)));
}

/** One run of the poster: the home's head and root go up when the head is newer than the last posted. */
export async function post(options: PostOptions): Promise<PostReport> {
  const door: PosterDoor = options.door ?? { lastPosted, postHead };
  const { head, redeems } = await readRedeems(options.home, { upto: options.upto, agent: 'bitquilt-poster', fetchImpl: options.fetchImpl });
  const root = redeemRoot(redeems);
  const last = await door.lastPosted(options.chain);
  const report: PostReport = { seq: head.seq, head: head.hash, root, posted: false, redeems: redeems.length };
  if (head.seq <= last) return report;
  const { tx } = await door.postHead(options.chain, { seq: head.seq, head: `0x${head.hash}`, root });
  return { ...report, posted: true, tx };
}
