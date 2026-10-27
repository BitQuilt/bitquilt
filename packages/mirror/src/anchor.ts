/**
 * QX-12, anchoring: each chain head the mirror holds is stamped through OpenTimestamps, so that the time a head
 * existed is attested by Bitcoin's blocks and not by anyone's word, the tracker's keeper included. A head is the hash
 * of the last chained receipt line (QX-11); the stamp is a detached `.ots` file in the OpenTimestamps format beside a
 * sidecar naming the problem, the sequence and the head. The calendar answers with a pending attestation; the standard
 * `ots upgrade` completes it once a block carries it, and `ots verify` checks the file against the head.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The detached-file header the reference client writes: magic, then the version as a varint. */
export const OTS_HEADER = new Uint8Array([0x00, 0x4f, 0x70, 0x65, 0x6e, 0x54, 0x69, 0x6d, 0x65, 0x73, 0x74, 0x61, 0x6d, 0x70, 0x73, 0x00, 0x00, 0x50, 0x72, 0x6f, 0x6f, 0x66, 0x00, 0xbf, 0x89, 0xe2, 0xe8, 0x84, 0xe8, 0x92, 0x94, 0x01]);
/** The op tag for a sha256 file digest. */
export const OP_SHA256 = 0x08;
/** The tag of a pending attestation, as a calendar answers with. */
export const PENDING_TAG = 'pending';
export const DEFAULT_CALENDARS = ['https://a.pool.opentimestamps.org', 'https://b.pool.opentimestamps.org', 'https://a.pool.eternitywall.com'];

/** The head of one chain the mirror holds: the last receipt line's sequence and hash. */
export interface ChainHead {
  /** The problem hash, or `identity` for the identity log, or `coin` for the coin log. */
  problem: string;
  seq: number;
  /** The head's hash, 64 hex characters. */
  hash: string;
}

export interface AnchorReport {
  stamped: { problem: string; seq: number; calendar: string }[];
  kept: number;
  failed: { problem: string; seq: number; why: string }[];
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error('a head is 64 hex characters');
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** A detached timestamp file for a sha256 digest, from what a calendar answered for it. */
export function otsFile(digest: Uint8Array, calendarTimestamp: Uint8Array): Uint8Array {
  if (digest.length !== 32) throw new Error('a sha256 digest is 32 bytes');
  const out = new Uint8Array(OTS_HEADER.length + 1 + 32 + calendarTimestamp.length);
  out.set(OTS_HEADER, 0);
  out[OTS_HEADER.length] = OP_SHA256;
  out.set(digest, OTS_HEADER.length + 1);
  out.set(calendarTimestamp, OTS_HEADER.length + 33);
  return out;
}

/** The digest submitted to one calendar; its answer is the timestamp from that digest on. */
export async function stampDigest(digest: Uint8Array, calendar: string, fetchImpl: typeof fetch = fetch): Promise<Uint8Array> {
  const r = await fetchImpl(`${calendar.replace(/\/$/, '')}/digest`, {
    method: 'POST',
    headers: { accept: 'application/vnd.opentimestamps.v1', 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'bitquilt-mirror' },
    body: digest,
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${calendar} answered ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length === 0) throw new Error(`${calendar} answered with nothing`);
  return bytes;
}

/**
 * Every head not yet anchored under `out/anchors/<problem>/<seq>.ots` is stamped through the first calendar that
 * answers, and a sidecar `.json` names what the stamp is of. A head already stamped is kept as it is: a stamp is of a
 * moment, and a second one would say nothing the first does not.
 */
export async function anchorHeads(options: { out: string; heads: ChainHead[]; calendars?: string[]; fetchImpl?: typeof fetch; now?: () => string }): Promise<AnchorReport> {
  const calendars = options.calendars ?? DEFAULT_CALENDARS;
  const now = options.now ?? (() => new Date().toISOString());
  const report: AnchorReport = { stamped: [], kept: 0, failed: [] };
  for (const head of options.heads) {
    const dir = join(options.out, 'anchors', head.problem);
    const file = join(dir, `${head.seq}.ots`);
    if (existsSync(file)) {
      report.kept++;
      continue;
    }
    const digest = hexToBytes(head.hash);
    let done = false;
    const reasons: string[] = [];
    for (const calendar of calendars) {
      try {
        const answer = await stampDigest(digest, calendar, options.fetchImpl);
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, otsFile(digest, answer));
        writeFileSync(join(dir, `${head.seq}.json`), JSON.stringify({ problem: head.problem, seq: head.seq, hash: head.hash, calendar, stamped_at: now(), attestation: PENDING_TAG }, null, 2) + '\n');
        report.stamped.push({ problem: head.problem, seq: head.seq, calendar });
        done = true;
        break;
      } catch (e) {
        reasons.push((e as Error).message);
      }
    }
    if (!done) report.failed.push({ problem: head.problem, seq: head.seq, why: reasons.join('; ') || 'no calendar' });
  }
  return report;
}

/** The anchors a mirror holds, read back: one entry per stamped head, in sequence order. Nothing in the job calls it; it is for a script or a test that reads a mirror. */
export function anchorsHeld(out: string, problem: string): { seq: number; hash: string; calendar: string; stamped_at: string }[] {
  const dir = join(out, 'anchors', problem);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const list: { seq: number; hash: string; calendar: string; stamped_at: string }[] = [];
  for (const name of names) if (name.endsWith('.json')) list.push(JSON.parse(readFileSync(join(dir, name), 'utf8')) as { seq: number; hash: string; calendar: string; stamped_at: string });
  return list.sort((a, b) => a.seq - b.seq);
}
