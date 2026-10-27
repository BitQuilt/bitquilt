/**
 * The verify script: given a problem's chained receipts, and optionally its envelope (with its ancestors) and blobs,
 * checks the chain from the problem's hash, every event's signature against its key, and, with the envelope, runs the
 * reducer and prints the map. Clone and compute, with no trust in any site.
 *
 *   tsx src/verify.ts <events.jsonl> <problem hash> [envelope.json ...] [--blob <file> ...] [--identity <identity.jsonl>]
 */
import { readFileSync } from 'node:fs';
import { verifyChain } from './chain.js';
import type { Envelope } from './envelope.js';
import { type Receipt, eventSignedByKey, IDENTITY_LOG } from './events.js';
import { type Hash, hashBytes, isHash } from './hash.js';
import type { Address } from './keys.js';
import { reduce } from './reduce.js';

/** The chain checked from the problem's hash, and how many events are not signed by their key. */
export function verifyFile(lines: Receipt[], problem: Hash): { chain: ReturnType<typeof verifyChain>; unsigned: number } {
  const chain = verifyChain(lines, problem);
  const unsigned = lines.filter((l) => !eventSignedByKey(l.event)).length;
  return { chain, unsigned };
}

// Run as a script when invoked directly (`pnpm verify`); imported by the tests, this file only exports.
if (process.argv[1] && /verify\.(ts|js)$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const file = args[0];
  const problem = args[1];
  if (!file || !isHash(problem)) {
    console.error('usage: verify <events.jsonl> <problem hash> [envelope.json ...] [--blob <file>] [--identity <identity.jsonl>]');
    process.exit(2);
  }
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
  const { chain, unsigned } = verifyFile(lines, problem);
  console.log(`${lines.length} lines; chain ${chain.ok ? 'ok' : 'BROKEN'}${chain.head ? `; head ${chain.head.seq} ${chain.head.short}` : ''}; ${unsigned === 0 ? 'every signature is its key\'s' : `${unsigned} signatures are not their keys\'`}`);
  for (const p of chain.problems) console.log(`  ${p}`);
  const envelopes: Envelope[] = [];
  const blobs = new Map<Hash, Uint8Array>();
  let identity: Receipt[] = [];
  for (let i = 2; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--blob') {
      const bytes = new Uint8Array(readFileSync(args[++i]!));
      blobs.set(hashBytes(bytes), bytes);
    } else if (a === '--identity') identity = readFileSync(args[++i]!, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);
    else envelopes.push(JSON.parse(readFileSync(a, 'utf8')) as Envelope);
  }
  if (envelopes.length) {
    if (identity.length) {
      const ic = verifyChain(identity, IDENTITY_LOG);
      console.log(`identity log: ${identity.length} lines; chain ${ic.ok ? 'ok' : 'BROKEN'}`);
    }
    const state = reduce({ envelopes, blobs, receipts: [...lines, ...identity], now: new Date().toISOString() });
    console.log(`"${state.envelope.problem.title}" by ${state.envelope.problem.owner}`);
    for (const v of state.pieces) {
      const set = v.accepting;
      const signers: { root: Address }[] = set ? (set.kind === 'agree' ? set.reveals : set.runs) : [];
      const acceptedBy = set ? ` accepted by ${signers.map((r) => r.root).join(' and ')}` : '';
      console.log(`  ${v.piece.name.padEnd(12)} ${v.state.padEnd(20)} claims ${v.claims.length} reveals ${v.reveals.length}${acceptedBy}`);
    }
    if (state.dropped.length) for (const d of state.dropped) console.log(`  dropped ${d.type}: ${d.why}`);
    console.log(state.complete ? `complete; output ${state.output?.hash}` : 'not complete');
  }
  process.exit(chain.ok && unsigned === 0 ? 0 : 1);
}
