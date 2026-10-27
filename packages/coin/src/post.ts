/**
 * The poster job: reads the coin log's head and its redeem lines from the home tracker, builds the Merkle tree over
 * them, and puts the head and the root into `Anchors` when the home's head is newer than the last one posted. A head
 * already posted is kept as it is, so running the job twice over the same head posts once. The chain is reached only
 * through the functions of `chain.ts`, which the caller may stand in for, as it may stand in for `fetch`.
 */
import { type Chain, type Hex, lastPosted, postHead } from './chain.js';
import { leaf, root as treeRoot } from './merkle.js';

/** One redeem line as the home serves it at `GET /coin/redeems`. */
export interface Redeem {
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
  redeems: Redeem[];
}

/** The chain functions the job uses; a test hands in its own. */
export interface Door {
  lastPosted(chain: Chain): Promise<number>;
  postHead(chain: Chain, post: { seq: number; head: Hex; root: Hex }): Promise<{ tx: Hex }>;
}

export interface PostOptions {
  /** The home tracker's address. */
  home: string;
  chain: Chain;
  door?: Door;
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

const HEX64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The home's answer checked for shape; anything else is refused with what was wrong. */
export function checkRedeems(answer: unknown): Redeems {
  const a = answer as { head?: { seq?: unknown; hash?: unknown }; redeems?: unknown } | null;
  if (!a || typeof a !== 'object') throw new Error('the home answered with something other than an object');
  const seq = a.head?.seq;
  const hash = a.head?.hash;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) throw new Error('the head has no whole sequence');
  if (typeof hash !== 'string' || !HEX64.test(hash)) throw new Error('the head has no hash of 64 lowercase hex characters');
  if (!Array.isArray(a.redeems)) throw new Error('the redeems are not a list');
  const redeems = a.redeems.map((r: unknown, i: number): Redeem => {
    const x = r as Partial<Redeem> | null;
    const at = `redeem ${i + 1}`;
    if (!x || typeof x !== 'object') throw new Error(`${at} is not an object`);
    if (typeof x.id !== 'string' || !HEX64.test(x.id)) throw new Error(`${at} has no id of 64 lowercase hex characters`);
    if (typeof x.seq !== 'number' || !Number.isSafeInteger(x.seq) || x.seq < 1 || x.seq > seq) throw new Error(`${at} has no sequence at or before the head`);
    if (typeof x.root !== 'string' || !ADDRESS.test(x.root)) throw new Error(`${at} has no root address`);
    if (typeof x.to !== 'string' || !ADDRESS.test(x.to)) throw new Error(`${at} has no address to mint to`);
    if (typeof x.amount !== 'number' || !Number.isSafeInteger(x.amount) || x.amount < 0) throw new Error(`${at} has no whole amount`);
    return { id: x.id, seq: x.seq, root: x.root, to: x.to, amount: x.amount };
  });
  const ids = new Set(redeems.map((r) => r.id));
  if (ids.size !== redeems.length) throw new Error('two redeems carry one id');
  return { head: { seq, hash }, redeems };
}

/** `GET /coin/redeems` at the home, checked. */
export async function readRedeems(home: string, fetchImpl: typeof fetch = fetch, upto?: number): Promise<Redeems> {
  const url = `${home.replace(/\/+$/, '')}/coin/redeems${upto === undefined ? '' : `?upto=${upto}`}`;
  const r = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'bitquilt-poster' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`the home answered ${r.status} at /coin/redeems`);
  return checkRedeems(await r.json());
}

/** The Merkle root over the redeem lines, as `Anchors` holds it. */
export function redeemRoot(redeems: readonly Redeem[]): Hex {
  return treeRoot(redeems.map((r) => leaf(`0x${r.id}`, r.to, r.amount)));
}

/** One run of the poster: the home's head and root go up when the head is newer than the last posted. */
export async function post(options: PostOptions): Promise<PostReport> {
  const door: Door = options.door ?? { lastPosted, postHead };
  const { head, redeems } = await readRedeems(options.home, options.fetchImpl, options.upto);
  const root = redeemRoot(redeems);
  const last = await door.lastPosted(options.chain);
  const report: PostReport = { seq: head.seq, head: head.hash, root, posted: false, redeems: redeems.length };
  if (head.seq <= last) return report;
  const { tx } = await door.postHead(options.chain, { seq: head.seq, head: `0x${head.hash}`, root });
  return { ...report, posted: true, tx };
}
