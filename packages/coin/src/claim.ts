/**
 * The holder's claim: mints a redeemed line on the chain. It reads the last sequence the poster put into `Anchors`,
 * reads the home's redeem lines up to that sequence, builds the tree and checks its root and the head against what is
 * posted, waits for the head to be final, takes the proof for the line, and calls `Quilt.redeem` through chain.ts
 * with the holder's key. The gas is the holder's, paid once; a line posted after the last head waits for the next.
 */
import { type Address, type Chain, type Head, type Hex, headAt, isFinal, isRedeemed, lastPosted, redeem } from './chain.js';
import { leaf, proof as proofOf } from './merkle.js';
import { readRedeems, redeemRoot } from './post.js';

/** The chain functions the claim uses; a test hands in its own. */
export interface ClaimDoor {
  lastPosted(chain: Chain): Promise<number>;
  headAt(chain: Chain, seq: number): Promise<Head>;
  isFinal(chain: Chain, seq: number): Promise<boolean>;
  isRedeemed(chain: Chain, id: Hex): Promise<boolean>;
  redeem(chain: Chain, line: { seq: number; id: Hex; to: Address; amount: bigint; proof: readonly Hex[] }): Promise<{ tx: Hex }>;
}

export interface ClaimOptions {
  /** The home tracker's address. */
  home: string;
  chain: Chain;
  /** The redeem line's id: the coin log line's hash, 64 hex characters, with or without 0x. */
  id: string;
  door?: ClaimDoor;
  fetchImpl?: typeof fetch;
}

export interface ClaimReport {
  id: string;
  seq: number;
  to: string;
  amount: number;
  tx: Hex;
}

const HEX64 = /^[0-9a-f]{64}$/;

/** One claim: the line under the last posted head, minted once the head is final. */
export async function claim(options: ClaimOptions): Promise<ClaimReport> {
  const door: ClaimDoor = options.door ?? { lastPosted, headAt, isFinal, isRedeemed, redeem };
  const id = options.id.replace(/^0x/i, '').toLowerCase();
  if (!HEX64.test(id)) throw new Error('the line id is 64 hex characters, the coin log line\'s hash');
  const last = await door.lastPosted(options.chain);
  if (last === 0) throw new Error('nothing is posted yet; the poster carries the line first');
  const { head, redeems } = await readRedeems(options.home, options.fetchImpl, last);
  if (head.seq !== last) throw new Error(`the home answers for sequence ${head.seq}, not the posted ${last}`);
  const line = redeems.find((r) => r.id === id);
  if (!line) throw new Error(`no redeem line ${id} under the posted head ${last}; a line after it waits for the next post`);
  const posted = await door.headAt(options.chain, last);
  if (!posted.posted || posted.head.toLowerCase() !== `0x${head.hash}`) throw new Error(`the head posted at ${last} is not the home's`);
  const root = redeemRoot(redeems);
  if (posted.root.toLowerCase() !== root.toLowerCase()) throw new Error(`the redeem root posted at ${last} is not the one the home's lines give`);
  if (!(await door.isFinal(options.chain, last))) throw new Error(`the head at ${last} is not final yet; its veto window is still open`);
  if (await door.isRedeemed(options.chain, `0x${id}`)) throw new Error('this line is redeemed already');
  const leaves = redeems.map((r) => leaf(`0x${r.id}`, r.to, r.amount));
  const p = proofOf(leaves, leaf(`0x${id}`, line.to, line.amount));
  const { tx } = await door.redeem(options.chain, { seq: last, id: `0x${id}`, to: line.to as Address, amount: BigInt(line.amount), proof: p });
  return { id, seq: last, to: line.to, amount: line.amount, tx };
}
