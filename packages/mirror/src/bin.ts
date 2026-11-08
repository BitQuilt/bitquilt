#!/usr/bin/env tsx
/**
 * bitquilt-mirror --trackers https://a/,https://b/ --out ./mirror [--by <name>] [--no-peers]
 *   [--anchor [--calendars https://a.pool.opentimestamps.org,...]]
 * Pulls from the sources and each one's peers one hop, verifies, keeps a chain of its own per log as the union of
 * their events, and writes the mirror's files; with --anchor, stamps every chain's head through OpenTimestamps (QX-12).
 * Each flag has a variable of the repository job's: BITQUILT_TRACKERS, BITQUILT_MIRROR, BITQUILT_MIRROR_BY (what the
 * mirror's own wrapper says), BITQUILT_PEERS (0 to follow none), BITQUILT_CALENDARS and BITQUILT_ANCHOR (set to 1).
 * At the coin's home, the balances are checked over the home's own chains as it serves them, cut at the heads its
 * /coin/state names (QX-17 section 7), and a chain it names that it does not serve as named is refused.
 * QUILT_CHAIN_RPC, QUILT_CHAIN_ID and QUILT_CONTRACTS are shared with the coin's jobs: set, the bin opens the
 * connection and the mirror checks every credit line on the coin log against the deposit the chain holds (the way
 * back); without them the balances of a ledger with credits are not kept and the credits alone refuse nothing, and a
 * `coin:` line says why where the balances reproduce. Exits 1 when anything is refused, so a job notices.
 */
import { chainFromEnv, depositAt } from '@bitquilt/coin';
import { type DepositReader, mirror } from './mirror.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const trackers = (flag('--trackers') ?? process.env.BITQUILT_TRACKERS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const out = flag('--out') ?? process.env.BITQUILT_MIRROR ?? 'mirror';
const calendars = (flag('--calendars') ?? process.env.BITQUILT_CALENDARS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const anchor =
  args.includes('--anchor') || process.env.BITQUILT_ANCHOR === '1' ? (calendars.length ? { calendars } : true) : false;
const by = flag('--by') ?? process.env.BITQUILT_MIRROR_BY;
const peers = !(args.includes('--no-peers') || process.env.BITQUILT_PEERS === '0');
if (!trackers.length) {
  console.error('usage: bitquilt-mirror --trackers <url,...> --out <dir>');
  process.exit(2);
}
let chain: DepositReader | null = null;
if (process.env.QUILT_CHAIN_RPC) {
  const connection = chainFromEnv().chain;
  chain = { depositAt: (n) => depositAt(connection, n) };
}
mirror({ trackers, out, anchor, chain, peers, ...(by ? { by } : {}) }).then((report) => {
  console.log(`sources: ${report.sources.join(', ')}`);
  if (report.coin?.credits)
    console.log(`coin: ${report.coin.credits} credit${report.coin.credits === 1 ? '' : 's'} checked against the chain`);
  if (report.coin?.notKept) console.log(`coin: ${report.coin.notKept}`);
  for (const p of report.problems)
    console.log(`${p.hash}: ${p.lines} lines, ${p.added} new${p.complete ? ', complete' : ''}`);
  console.log(`identity: ${report.identity.lines} lines, ${report.identity.added} new`);
  for (const r of report.refused) console.log(`refused: ${r}`);
  for (const e of report.errors) console.log(`error: ${e}`);
  if (report.anchors) {
    for (const a of report.anchors.stamped) console.log(`anchored ${a.problem} at ${a.seq} through ${a.calendar}`);
    if (report.anchors.kept) console.log(`anchors kept: ${report.anchors.kept}`);
    for (const x of report.anchors.failed) console.log(`anchor failed: ${x.problem} at ${x.seq}: ${x.why}`);
  }
  process.exit(report.refused.length ? 1 : 0);
});
