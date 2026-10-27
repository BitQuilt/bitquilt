/**
 * The one door to the chain. This is the only file in the repository that imports an RPC library (`viem`), as the
 * rally's gateway is the only file that imports a model SDK; `packages/coin/test/tripwire.test.ts` holds it there.
 * Everything here takes its connection as an argument: the RPC address, the chain id, the two contract addresses, and
 * a key where a write needs one. A read needs no key. The functions are thin: `postHead`, `redeem` and `deposit` send
 * one transaction each and wait for its receipt; the reads answer what `Anchors` and `Quilt` hold. `chainFromEnv` is
 * the one place the environment is read. A key is kept on the connection as a property that neither JSON nor the
 * console shows, and no function here puts one in a message or a report.
 */
import { type Abi, type Address, createPublicClient, createWalletClient, defineChain, getAddress, http, isAddress, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { homeUrl } from './home.js';
import type { Hex } from './merkle.js';
import { KEY_HEX_RE } from './shapes.js';

export type { Abi, Address };

/** Where the contracts are and how to reach them; `key` only where a write is meant. */
export interface Chain {
  rpc: string;
  chainId: number;
  contracts: { anchors: Address; quilt: Address };
  /** A private key, 0x and 64 hex characters. */
  key?: Hex;
}

/** A connection with no contracts yet: what `deploy` takes. */
export type Connection = Pick<Chain, 'rpc' | 'chainId' | 'key'>;

export const ANCHORS_ABI = parseAbi([
  'function bond() payable',
  'function bonds(address poster) view returns (uint256)',
  'function allowed(address poster) view returns (bool)',
  'function lastSeq() view returns (uint64)',
  'function post(uint64 seq, bytes32 head, bytes32 redeemRoot)',
  'function headAt(uint64 seq) view returns (bytes32 head, bytes32 root, uint64 postedAt, address poster, bool vetoed)',
  'function isFinal(uint64 seq) view returns (bool)',
]);

export const QUILT_ABI = parseAbi([
  'function redeem(uint64 seq, bytes32 id, address to, uint256 amount, bytes32[] proof)',
  'function redeemed(bytes32 id) view returns (bool)',
  'function balanceOf(address who) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function deposit(uint256 amount, address root) returns (uint64)',
  'function depositCount() view returns (uint64)',
  'function depositAt(uint64 n) view returns (address from, address root, uint256 amount, uint64 at)',
]);

/** A deposit as `Quilt` records it; `made` is false where there is none at that number. */
export interface Deposit {
  n: number;
  from: Address;
  root: Address;
  amount: bigint;
  at: number;
  made: boolean;
}

/** What `Anchors` holds at a sequence; `posted` is false where nothing was. */
export interface PostedHead {
  seq: number;
  head: Hex;
  root: Hex;
  postedAt: number;
  poster: Address;
  vetoed: boolean;
  posted: boolean;
}

function chainOf(c: Connection) {
  return defineChain({
    id: c.chainId,
    name: `chain ${c.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [c.rpc] } },
  });
}

/** The client every read goes through; it needs no key. */
function publicClient(c: Connection) {
  return createPublicClient({ chain: chainOf(c), transport: http(c.rpc) });
}

/** The account and wallet of the key on the connection, for a write. */
function walletOf(c: Connection) {
  if (!c.key) throw new Error('a write needs a key on the connection');
  const account = privateKeyToAccount(c.key);
  return { account, wallet: createWalletClient({ account, chain: chainOf(c), transport: http(c.rpc) }) };
}

/** One transaction: simulated first, so a refusal comes back as its reason, then sent and waited for. */
async function write(c: Connection, call: { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; value?: bigint }): Promise<Hex> {
  const pub = publicClient(c);
  const { account, wallet } = walletOf(c);
  const { request } = await pub.simulateContract({ account, address: call.address, abi: call.abi, functionName: call.functionName, args: call.args, ...(call.value === undefined ? {} : { value: call.value }) });
  const hash = await wallet.writeContract(request);
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error(`the transaction ${hash} reverted`);
  return hash;
}

/** Puts a contract on the chain from its compiled ABI and bytecode and answers its address: for a deployment script and the anvil test. DEPLOY.md deploys with `forge create`. */
export async function deploy(c: Connection, contract: { abi: Abi; bytecode: Hex; args?: readonly unknown[] }): Promise<Address> {
  const pub = publicClient(c);
  const { wallet } = walletOf(c);
  const hash = await wallet.deployContract({ abi: contract.abi, bytecode: contract.bytecode, args: contract.args ?? [] });
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success' || !receipt.contractAddress) throw new Error(`the deployment ${hash} did not land`);
  return getAddress(receipt.contractAddress);
}

/** Adds `amount` wei to the sender's bond in `Anchors`. */
export async function bond(c: Chain, amount: bigint): Promise<{ tx: Hex }> {
  return { tx: await write(c, { address: c.contracts.anchors, abi: ANCHORS_ABI, functionName: 'bond', args: [], value: amount }) };
}

/** The highest sequence posted to `Anchors`, 0 before any. */
export async function lastPosted(c: Chain): Promise<number> {
  const seq = await publicClient(c).readContract({ address: c.contracts.anchors, abi: ANCHORS_ABI, functionName: 'lastSeq' });
  return Number(seq);
}

/** What `Anchors` holds at `seq`. */
export async function headAt(c: Chain, seq: number): Promise<PostedHead> {
  const [head, root, postedAt, poster, vetoed] = await publicClient(c).readContract({ address: c.contracts.anchors, abi: ANCHORS_ABI, functionName: 'headAt', args: [BigInt(seq)] });
  return { seq, head, root, postedAt: Number(postedAt), poster, vetoed, posted: Number(postedAt) !== 0 };
}

/** Whether the head at `seq` is posted, not vetoed, and past its window. */
export async function isFinal(c: Chain, seq: number): Promise<boolean> {
  return publicClient(c).readContract({ address: c.contracts.anchors, abi: ANCHORS_ABI, functionName: 'isFinal', args: [BigInt(seq)] });
}

/** Posts the coin log's head and the redeem root at `seq`, from the key on the connection. */
export async function postHead(c: Chain, post: { seq: number; head: Hex; root: Hex }): Promise<{ tx: Hex }> {
  return { tx: await write(c, { address: c.contracts.anchors, abi: ANCHORS_ABI, functionName: 'post', args: [BigInt(post.seq), post.head, post.root] }) };
}

/** Mints the redeem line `id` to `to` through `Quilt`, with its proof against the root at `seq`. */
export async function redeem(c: Chain, line: { seq: number; id: Hex; to: Address; amount: bigint; proof: readonly Hex[] }): Promise<{ tx: Hex }> {
  return { tx: await write(c, { address: c.contracts.quilt, abi: QUILT_ABI, functionName: 'redeem', args: [BigInt(line.seq), line.id, line.to, line.amount, line.proof] }) };
}

/** Whether `Quilt` has minted the redeem line `id`. */
export async function isRedeemed(c: Chain, id: Hex): Promise<boolean> {
  return publicClient(c).readContract({ address: c.contracts.quilt, abi: QUILT_ABI, functionName: 'redeemed', args: [id] });
}

/** The address of the key on the connection: what a deposit credits where the holder names no other root. */
export function selfAddress(c: Connection): Address {
  if (!c.key) throw new Error('the connection carries no key to take an address from');
  return privateKeyToAccount(c.key).address;
}

/** Burns `amount` of the sender's `Quilt` for the ledger to credit to `root`: the way back. */
export async function deposit(c: Chain, d: { amount: bigint; root: Address }): Promise<{ tx: Hex }> {
  return { tx: await write(c, { address: c.contracts.quilt, abi: QUILT_ABI, functionName: 'deposit', args: [d.amount, d.root] }) };
}

/** How many deposits `Quilt` holds, as of the chain's finalized block unless `finalized` is false. */
export async function depositCount(c: Chain, finalized = true): Promise<number> {
  const n = await publicClient(c).readContract({ address: c.contracts.quilt, abi: QUILT_ABI, functionName: 'depositCount', blockTag: finalized ? 'finalized' : 'latest' });
  return Number(n);
}

/** Deposit `n` as `Quilt` records it. */
export async function depositAt(c: Chain, n: number): Promise<Deposit> {
  const [from, root, amount, at] = await publicClient(c).readContract({ address: c.contracts.quilt, abi: QUILT_ABI, functionName: 'depositAt', args: [BigInt(n)] });
  return { n, from, root, amount, at: Number(at), made: Number(at) !== 0 };
}

/** The `Quilt` balance of `who`, in base units, which are the ledger's units. */
export async function balanceOf(c: Chain, who: Address): Promise<bigint> {
  return publicClient(c).readContract({ address: c.contracts.quilt, abi: QUILT_ABI, functionName: 'balanceOf', args: [who] });
}

/**
 * The connection from the environment: `QUILT_CHAIN_RPC`, `QUILT_CHAIN_ID`, `QUILT_CONTRACTS` (JSON with `anchors`
 * and `quilt`), the key named by `keyVar` (`QUILT_POSTER_KEY` unless another is named; hex, with or without 0x; absent
 * for a read) and `QUILT_COIN_HOME`, the home tracker's address, which is null when unset. An error names the variable
 * and nothing of its value.
 */
export function chainFromEnv(env: NodeJS.ProcessEnv = process.env, { keyVar = 'QUILT_POSTER_KEY' }: { keyVar?: string } = {}): { chain: Chain; home: string | null } {
  const rpc = env.QUILT_CHAIN_RPC?.trim();
  if (!rpc) throw new Error('QUILT_CHAIN_RPC names the chain RPC address');
  const chainId = Number(env.QUILT_CHAIN_ID);
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('QUILT_CHAIN_ID is a whole number');
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.QUILT_CONTRACTS ?? '');
  } catch {
    throw new Error('QUILT_CONTRACTS is JSON with anchors and quilt');
  }
  const addresses = parsed as { anchors?: unknown; quilt?: unknown } | null;
  const anchors = addresses?.anchors;
  const quilt = addresses?.quilt;
  if (typeof anchors !== 'string' || !isAddress(anchors) || typeof quilt !== 'string' || !isAddress(quilt)) throw new Error('QUILT_CONTRACTS is JSON with anchors and quilt, each an address');
  const chain: Chain = { rpc, chainId, contracts: { anchors: getAddress(anchors), quilt: getAddress(quilt) } };
  const rawKey = env[keyVar]?.trim();
  if (rawKey) {
    const hex = rawKey.startsWith('0x') ? rawKey.slice(2) : rawKey;
    if (!KEY_HEX_RE.test(hex)) throw new Error(`${keyVar} is 64 hex characters`);
    Object.defineProperty(chain, 'key', { value: `0x${hex.toLowerCase()}` as Hex, enumerable: false, writable: false });
  }
  const home = homeUrl(env.QUILT_COIN_HOME?.trim() ?? '') || null;
  return { chain, home };
}
