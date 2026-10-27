/**
 * Chained ledger lines, extension QX-11: every line a resolver keeps carries `seq`, `prev` and `hash`. A line's hash is
 * sha256 over seq, a newline, prev, a newline, and the canonical JSON of the wrapper without the chain fields; the
 * first line's `prev` is the problem's hash in hex, so a chain belongs to one problem. A change to any line changes its
 * hash, so the `prev` of the next, so the head. The reducer ignores these three fields; a client that reads a file
 * verifies them.
 */
import { canonical } from './canonical.js';
import { type Hash, hashHex, sha256Hex } from './hash.js';
import type { Receipt } from './events.js';

/** The hash of a line: sha256 over seq, a newline, prev, a newline, and the canonical JSON of the wrapper without the chain fields. */
export function lineHash(seq: number, prev: string, r: Pick<Receipt, 'event' | 'received'>): string {
  const body = canonical({ event: r.event, received: r.received });
  return sha256Hex(new TextEncoder().encode(`${seq}\n${prev}\n${body}`));
}

/** The short form of a head: its first sixteen hex characters as two groups of eight joined by a colon. */
export function shortHead(hash: string): string {
  return `${hash.slice(0, 8)}:${hash.slice(8, 16)}`;
}

/** The receipts with their chain fields filled, from `problem`'s hash on. */
export function chainLines(receipts: Receipt[], problem: Hash): Receipt[] {
  let prev = hashHex(problem);
  return receipts.map((r, i) => {
    const seq = i + 1;
    const hash = lineHash(seq, prev, r);
    const line: Receipt = { event: r.event, received: r.received, seq, prev, hash };
    prev = hash;
    return line;
  });
}

/** The next line after `lines`, chained. */
export function nextLine(lines: Receipt[], problem: Hash, r: Pick<Receipt, 'event' | 'received'>): Receipt {
  const last = lines[lines.length - 1];
  const seq = (last?.seq ?? 0) + 1;
  const prev = last?.hash ?? hashHex(problem);
  return { event: r.event, received: r.received, seq, prev, hash: lineHash(seq, prev, r) };
}

export interface ChainCheck {
  ok: boolean;
  problems: string[];
  head: { seq: number; hash: string; short: string } | null;
}

/** The chain checked from its first line: each seq one more than the last, each prev the hash before, each hash its own. */
export function verifyChain(lines: Receipt[], problem: Hash): ChainCheck {
  const problems: string[] = [];
  let prev = hashHex(problem);
  lines.forEach((l, i) => {
    const n = i + 1;
    if (l.seq !== n) problems.push(`line ${n}: seq is ${l.seq}`);
    if (l.prev !== prev) problems.push(`line ${n}: prev is not the hash of ${n === 1 ? 'the problem' : `line ${n - 1}`}`);
    const own = lineHash(n, prev, l);
    if (l.hash !== own) problems.push(`line ${n}: hash is not its own (${shortHead(own)} expected)`);
    prev = l.hash ?? own;
  });
  const last = lines[lines.length - 1];
  return { ok: problems.length === 0, problems, head: last?.hash ? { seq: last.seq ?? lines.length, hash: last.hash, short: shortHead(last.hash) } : null };
}

/** Whether `now` only adds to `before`: every earlier line is the same line in the same place. */
export function onlyAppends(before: Receipt[], now: Receipt[]): { ok: boolean; problem?: string; added: number } {
  if (now.length < before.length) return { ok: false, problem: `${before.length - now.length} removed`, added: 0 };
  for (let i = 0; i < before.length; i++) if (before[i]!.hash !== now[i]!.hash) return { ok: false, problem: `line ${i + 1} changed`, added: 0 };
  return { ok: true, added: now.length - before.length };
}
