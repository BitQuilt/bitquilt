/**
 * The reader job, the poster's mirror image: reads the deposits `Quilt` holds as of the chain's finalized block, reads
 * the credits the home has kept, and posts a signed `credit` line on the coin log for each deposit not credited yet,
 * in order. The ledger admits a credit from the reader's root alone and once per deposit; the mirror checks every
 * credit against the chain, and a false one is answered by vetoing the reader's post in `Anchors`, which takes its
 * bond. The chain is reached only through chain.ts, which the caller may stand in for, as it may stand in for fetch.
 */
import { type Event, addressOf, isRecord, signEvent } from '@bitquilt/core';
import { type Chain, type Deposit, depositAt, depositCount } from './chain.js';
import { type HomeRead, fromHome, homeUrl } from './home.js';
import { address, checkLine, hex64, wholeNumber } from './shapes.js';

/** One credit line as the home serves it at `GET /coin/credits`: the shape `packages/tracker/src/coin.ts` serves there; keep the two the same. */
export interface CreditLine {
  /** The coin log line's hash, 64 lowercase hex characters. */
  id: string;
  seq: number;
  /** The deposit's number on the chain, from 1. */
  deposit: number;
  /** The ledger root the deposit credits, an address. */
  root: string;
  /** Whole units. */
  amount: number;
}

export interface Credits {
  head: { seq: number; hash: string } | null;
  reader: string | null;
  credits: CreditLine[];
}

/** The chain functions the reader calls; a test hands in its own. */
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

/** The home's answer checked for shape; anything else is refused with what was wrong. */
export function checkCredits(answer: unknown): Credits {
  if (!isRecord(answer)) throw new Error('the home answered with something other than an object');
  if (!Array.isArray(answer.credits)) throw new Error('the credits are not a list');
  const head = isRecord(answer.head) ? answer.head : null;
  const credits = answer.credits.map((c: unknown, i: number) =>
    checkLine<CreditLine>(c, `credit ${i + 1}`, {
      id: (v, at) => hex64(v, at, 'id'),
      seq: (v, at) => wholeNumber(v, at, 'sequence', 1),
      deposit: (v, at) => wholeNumber(v, at, 'deposit number', 1),
      root: (v, at) => address(v, at, 'root address'),
      amount: (v, at) => wholeNumber(v, at, 'whole amount', 1),
    }),
  );
  return {
    head: head && typeof head.seq === 'number' && typeof head.hash === 'string' ? { seq: head.seq, hash: head.hash } : null,
    reader: typeof answer.reader === 'string' ? answer.reader : null,
    credits,
  };
}

/** `GET /coin/credits` at the home, checked; `agent` names the job asking. */
export function readCredits(home: string, options: HomeRead): Promise<Credits> {
  return fromHome(home, '/coin/credits', options, checkCredits);
}

/** One run of the reader: every finalized deposit the home has not credited yet goes up as a signed credit line, in order. */
export async function read(options: ReadOptions): Promise<ReadReport> {
  const door: ReaderDoor = options.door ?? { depositCount, depositAt };
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const deposits = await door.depositCount(options.chain, options.finalized ?? true);
  const held = await readCredits(options.home, { agent: 'bitquilt-reader', fetchImpl });
  const done = new Set(held.credits.map((c) => c.deposit));
  const report: ReadReport = { deposits, held: held.credits.length, posted: [], refused: [] };
  const reader = addressOf(options.key);
  for (let n = 1; n <= deposits; n++) {
    if (done.has(n)) continue;
    const d = await door.depositAt(options.chain, n);
    if (!d.made) continue;
    const amount = Number(d.amount);
    if (!Number.isSafeInteger(amount)) {
      report.refused.push({ deposit: n, why: 'the amount is beyond what the ledger counts' });
      continue;
    }
    const event: Event = signEvent({ quilt: 1, type: 'credit', key: reader, ts: now(), body: { deposit: n, root: d.root, amount } }, options.key);
    const r = await fetchImpl(`${homeUrl(options.home)}/coin/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'bitquilt-reader' }, body: JSON.stringify(event), signal: AbortSignal.timeout(20000) });
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
