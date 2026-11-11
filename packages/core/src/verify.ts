/**
 * The verify script: given a problem's chained receipts, and optionally its envelope (with its ancestors) and blobs,
 * checks the chain from the problem's hash, every event's signature against its key, and, with the envelope, reads the
 * problem by reading 2 and prints the map (docs/v2/READING.md section 1). The ledger is what "a reader holds", and a
 * clone of one chain is a ledger of one problem: each piece has the one state the reading gives it, a
 * record piece's and a judge piece's among them, and what rests on another problem's chain is not read here, the
 * standing behind a challenge or a gold, a panel's seats and an inherited square. A blob given is a read held.
 * Clone and compute, with no trust in any site.
 *
 *   tsx src/verify.ts <events.jsonl> <problem hash> [envelope.json ...] [--blob <file> ...]
 *     [--identity <identity.jsonl>]
 */
import { readFileSync } from 'node:fs';
import { verifyChain } from './chain.js';
import { type Envelope, problemHash } from './envelope.js';
import { type Receipt, eventSignedByKey, IDENTITY_LOG } from './events.js';
import { type Hash, hashBytes, isHash } from './hash.js';
import type { Address } from './keys.js';
import { read } from './read.js';

/** The chain checked from the problem's hash, and how many events are not signed by their key. */
export function verifyFile(
  lines: Receipt[],
  problem: Hash,
): { chain: ReturnType<typeof verifyChain>; unsigned: number } {
  const chain = verifyChain(lines, problem);
  const unsigned = lines.filter((l) => !eventSignedByKey(l.event)).length;
  return { chain, unsigned };
}

/**
 * The map of one problem read as a ledger of its own (docs/v2/READING.md section 1), a line of text for each piece:
 * its name, its one state, its claims, its readings and how many count, and the roots of its accepting set. The first
 * envelope is the problem's and the rest its ancestors.
 */
export function verifyMap(
  envelopes: Envelope[],
  blobs: Map<Hash, Uint8Array>,
  receipts: Receipt[],
  now: string,
): string[] {
  const reading = read({
    problems: [{ envelopes, blobs, receipts, now }],
    now,
    blobLength: (h) => blobs.get(h)?.length ?? null,
  });
  const held = problemHash(envelopes[0]!);
  const pl = reading.problems.get(held);
  if (!pl) return [`refused: ${reading.refused.get(held) ?? 'the core does not read this envelope'}`];
  const { envelope } = pl.fold;
  const out = [`"${envelope.problem.title}" by ${envelope.problem.owner}`];
  for (const p of pl.pieces) {
    const view = pl.fold.byHash.get(p.hash);
    const set = view?.accepting;
    const signers: { root: Address }[] = set ? (set.kind === 'agree' ? set.reveals : set.runs) : [];
    const acceptedBy = set ? ` accepted by ${signers.map((r) => r.root).join(' and ')}` : '';
    const counted = p.readings.filter((r) => r.counts === 'counted').length;
    const counts = `claims ${view?.claims.length ?? 0} readings ${p.readings.length} counted ${counted}`;
    out.push(`  ${p.name.padEnd(12)} ${p.state.padEnd(20)} ${counts}${acceptedBy}`);
  }
  for (const d of pl.dropped) out.push(`  dropped ${d.type}: ${d.why}`);
  out.push(pl.complete ? `complete; output ${pl.fold.output?.hash}` : 'not complete');
  return out;
}

// Run as a script when invoked directly (`pnpm verify`); imported by the tests, this file only exports.
if (process.argv[1] && /verify\.(ts|js)$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const file = args[0];
  const problem = args[1];
  if (!file || !isHash(problem)) {
    console.error(
      'usage: verify <events.jsonl> <problem hash> [envelope.json ...] [--blob <file>] [--identity <identity.jsonl>]',
    );
    process.exit(2);
  }
  const lines = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Receipt);
  const { chain, unsigned } = verifyFile(lines, problem);
  console.log(
    `${lines.length} lines; chain ${chain.ok ? 'ok' : 'BROKEN'}${chain.head ? `; head ${chain.head.seq} ${chain.head.short}` : ''}; ${unsigned === 0 ? "every signature is its key's" : `${unsigned} signatures are not their keys\'`}`,
  );
  for (const p of chain.problems) console.log(`  ${p}`);
  const envelopes: Envelope[] = [];
  const blobs = new Map<Hash, Uint8Array>();
  let identity: Receipt[] = [];
  for (let i = 2; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--blob') {
      const bytes = new Uint8Array(readFileSync(args[++i]!));
      blobs.set(hashBytes(bytes), bytes);
    } else if (a === '--identity')
      identity = readFileSync(args[++i]!, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Receipt);
    else envelopes.push(JSON.parse(readFileSync(a, 'utf8')) as Envelope);
  }
  if (envelopes.length) {
    if (identity.length) {
      const ic = verifyChain(identity, IDENTITY_LOG);
      console.log(`identity log: ${identity.length} lines; chain ${ic.ok ? 'ok' : 'BROKEN'}`);
    }
    const map = verifyMap(envelopes, blobs, [...lines, ...identity], new Date().toISOString());
    for (const line of map) console.log(line);
  }
  process.exit(chain.ok && unsigned === 0 ? 0 : 1);
}
