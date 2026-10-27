/**
 * The reader job, the poster's mirror image: reads the deposits `Quilt` holds as of the chain's finalized block, reads
 * the credits the home has kept, and posts a signed `credit` line on the coin log for each deposit not credited yet,
 * in order. The ledger admits a credit from the reader's root alone and once per deposit; the mirror checks every
 * credit against the chain, and a false one is answered by vetoing the reader's post in `Anchors`, which takes its
 * bond. The chain is reached only through chain.ts, which the caller may stand in for, as it may stand in for fetch.
 */
import { type Event, addressOf, signEvent } from '@bitquilt/core';
import { type Chain, type Deposit, depositAt, depositCount } from './chain.js';

/** One credit line as the home serves it at `GET /coin/credits`. */
export interface Credit {
  id: string;
  seq: number;
  deposit: number;
  root: string;
  amount: number;
}

export interface Credits {
  head: { seq: number; hash: string } | null;
  reader: string | null;
  credits: Credit[];
}

/** The chain functions the job uses; a test hands in its own. */
export interface ReaderDoor {
  depositCount(chain: Chain, finalized?: boolean): Promise<number>;
  depositAt(chain: Chain, n: number): Promise<Deposit>;
}

export interface ReadOptions {
  /** The home tracker's address. */
  home: string;
  chain: Chain;
  /** The reader's ledger key: the 32-byte secret the credit lines are signed with. */
  key: Uint8Array;
  door?: ReaderDoor;
  fetchImpl?: typeof fetch;
  now?: () => string;
  /** Count deposits as of the chain's finalized block, which is the default; false reads the latest block, for a local chain that finalizes nothing. */
  finalized?: boolean;
}

export interface ReadReport {
  /** Deposits on the chain as of its finalized block. */
  deposits: number;
  /** Credits the home held before this run. */
  held: number;
  posted: { deposit: number; root: string; amount: number; id: string }[];
  refused: { deposit: number; why: string }[];
}

const HEX64 = /^[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The home's answer checked for shape; anything else is refused with what was wrong. */
export function checkCredits(answer: unknown): Credits {
  const a = answer as { head?: unknown; reader?: unknown; credits?: unknown } | null;
  if (!a || typeof a !== 'object') throw new Error('the home answered with something other than an object');
  if (!Array.isArray(a.credits)) throw new Error('the credits are not a list');
  const head = a.head as { seq?: unknown; hash?: unknown } | null;
  const credits = a.credits.map((c: unknown, i: number): Credit => {
    const x = c as Partial<Credit> | null;
    const at = `credit ${i + 1}`;
    if (!x || typeof x !== 'object') throw new Error(`${at} is not an object`);
    if (typeof x.id !== 'string' || !HEX64.test(x.id)) throw new Error(`${at} has no id of 64 lowercase hex characters`);
    if (typeof x.seq !== 'number' || !Number.isSafeInteger(x.seq) || x.seq < 1) throw new Error(`${at} has no sequence`);
    if (typeof x.deposit !== 'number' || !Number.isSafeInteger(x.deposit) || x.deposit < 1) throw new Error(`${at} has no deposit number`);
    if (typeof x.root !== 'string' || !ADDRESS.test(x.root)) throw new Error(`${at} has no root address`);
    if (typeof x.amount !== 'number' || !Number.isSafeInteger(x.amount) || x.amount < 1) throw new Error(`${at} has no whole amount`);
    return { id: x.id, seq: x.seq, deposit: x.deposit, root: x.root, amount: x.amount };
  });
  return {
    head: head && typeof head === 'object' && typeof head.seq === 'number' && typeof head.hash === 'string' ? { seq: head.seq, hash: head.hash } : null,
    reader: typeof a.reader === 'string' ? a.reader : null,
    credits,
  };
}

/** `GET /coin/credits` at the home, checked. */
export async function readCredits(home: string, fetchImpl: typeof fetch = fetch, upto?: number): Promise<Credits> {
  const url = `${home.replace(/\/+$/, '')}/coin/credits${upto === undefined ? '' : `?upto=${upto}`}`;
  const r = await fetchImpl(url, { headers: { accept: 'application/json', 'user-agent': 'bitquilt-reader' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`the home answered ${r.status} at /coin/credits`);
  return checkCredits(await r.json());
}

/** One run of the reader: every finalized deposit the home has not credited yet goes up as a signed credit line, in order. */
export async function read(options: ReadOptions): Promise<ReadReport> {
  const door: ReaderDoor = options.door ?? { depositCount, depositAt };
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const base = options.home.replace(/\/+$/, '');
  const deposits = await door.depositCount(options.chain, options.finalized ?? true);
  const held = await readCredits(options.home, fetchImpl);
  const done = new Set(held.credits.map((c) => c.deposit));
  const report: ReadReport = { deposits, held: held.credits.length, posted: [], refused: [] };
  const address = addressOf(options.key);
  for (let n = 1; n <= deposits; n++) {
    if (done.has(n)) continue;
    const d = await door.depositAt(options.chain, n);
    if (!d.made) continue;
    const amount = Number(d.amount);
    if (!Number.isSafeInteger(amount)) {
      report.refused.push({ deposit: n, why: 'the amount is beyond what the ledger counts' });
      continue;
    }
    const event: Event = signEvent({ quilt: 1, type: 'credit', key: address, ts: now(), body: { deposit: n, root: d.root, amount } }, options.key);
    const r = await fetchImpl(`${base}/coin/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bitquilt-reader' }, body: JSON.stringify(event), signal: AbortSignal.timeout(20000) });
    if (r.status === 202) {
      const { id } = (await r.json()) as { id: string };
      report.posted.push({ deposit: n, root: d.root, amount, id });
    } else {
      const why = ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `the home answered ${r.status}`;
      report.refused.push({ deposit: n, why });
    }
  }
  return report;
}
