#!/usr/bin/env tsx
/**
 * bitquilt-mirror --trackers https://a/,https://b/ --out ./mirror [--anchor [--calendars https://a.pool.opentimestamps.org,...]]
 * Pulls, verifies, and writes the mirror's files; with --anchor, stamps every chain's head through OpenTimestamps (QX-12).
 * Exits 1 when a tracker's chain is refused, so a job notices.
 */
import { mirror } from './mirror.js';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const trackers = (flag('--trackers') ?? process.env.BITQUILT_TRACKERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const out = flag('--out') ?? process.env.BITQUILT_MIRROR ?? 'mirror';
const calendars = (flag('--calendars') ?? process.env.BITQUILT_CALENDARS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const anchor = args.includes('--anchor') || process.env.BITQUILT_ANCHOR === '1' ? (calendars.length ? { calendars } : true) : false;
if (!trackers.length) {
  console.error('usage: bitquilt-mirror --trackers <url,...> --out <dir>');
  process.exit(2);
}
mirror({ trackers, out, anchor }).then((report) => {
  for (const p of report.problems) console.log(`${p.hash}: ${p.lines} lines, ${p.added} new${p.complete ? ', complete' : ''}`);
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
