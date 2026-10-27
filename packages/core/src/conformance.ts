/**
 * The conformance runner (CORE.md section 9): every fixture under a folder is an envelope chain, blobs, receipts, a
 * time, and the state and picks it must produce. A client conforms when it reproduces them all. Run against this
 * library it is a test; run against another implementation it is the definition of being a BitQuilt client.
 *
 *   tsx src/conformance.ts fixtures
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Envelope } from './envelope.js';
import type { Receipt } from './events.js';
import { type Hash, hashBytes } from './hash.js';
import type { Address } from './keys.js';
import { type Client, next } from './next.js';
import { reduce } from './reduce.js';

export interface Fixture {
  name: string;
  description: string;
  envelopes: Envelope[];
  blobs: Record<string, string>;
  receipts: Receipt[];
  now: string;
  expect: {
    states: Record<string, string>;
    dropped: string[];
    complete: boolean;
    output: Hash | null;
    picks: { key: Address; client: Client; now: string; piece: string | null }[];
  };
}

/** A fixture's blobs as the reducer takes them, each decoded from base64 and checked against the hash that names it. */
export function blobsOf(f: Fixture): Map<Hash, Uint8Array> {
  const m = new Map<Hash, Uint8Array>();
  for (const [h, b64] of Object.entries(f.blobs)) {
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    if (hashBytes(bytes) !== h) throw new Error(`${f.name}: blob ${h} does not match its hash`);
    m.set(h as Hash, bytes);
  }
  return m;
}

/** The ways this implementation's answer differs from the fixture's, or nothing. */
export function checkFixture(f: Fixture): string[] {
  const problems: string[] = [];
  const state = reduce({ envelopes: f.envelopes, blobs: blobsOf(f), receipts: f.receipts, now: f.now });
  const states: Record<string, string> = {};
  for (const v of state.pieces) states[v.piece.name] = v.state;
  for (const [name, want] of Object.entries(f.expect.states)) if (states[name] !== want) problems.push(`${name}: ${states[name] ?? 'missing'}, expected ${want}`);
  for (const name of Object.keys(states)) if (!(name in f.expect.states)) problems.push(`${name}: not in the fixture`);
  // Dropped events are compared by count: the reasons in a fixture are the reference's wording, not part of conformance.
  if (state.dropped.length !== f.expect.dropped.length) problems.push(`dropped: ${state.dropped.length} (${state.dropped.map((d) => d.why).join('; ')}), expected ${f.expect.dropped.length}`);
  if (state.complete !== f.expect.complete) problems.push(`complete: ${state.complete}, expected ${f.expect.complete}`);
  const out = state.output?.hash ?? null;
  if (out !== f.expect.output) problems.push(`output: ${out}, expected ${f.expect.output}`);
  for (const p of f.expect.picks) {
    const pick = next(state, p.key, p.client, p.now);
    const got = pick?.piece.name ?? null;
    if (got !== p.piece) problems.push(`next for ${p.key} at ${p.now}: ${got}, expected ${p.piece}`);
  }
  return problems;
}

/** Every `.json` file under `dir`, in name order, read as a fixture; the folder's README says what one holds. */
export function loadFixtures(dir: string): Fixture[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Fixture);
}

// Run as a script when invoked directly (`pnpm conform`); imported by the tests, this file only exports.
if (process.argv[1] && /conformance\.(ts|js)$/.test(process.argv[1])) {
  const dir = process.argv[2] ?? 'fixtures';
  const fixtures = loadFixtures(dir);
  let failed = 0;
  for (const f of fixtures) {
    const problems = checkFixture(f);
    if (problems.length) {
      failed++;
      console.log(`FAIL ${f.name}`);
      for (const p of problems) console.log(`  ${p}`);
    } else console.log(`ok   ${f.name}`);
  }
  console.log(`${fixtures.length - failed} of ${fixtures.length} fixtures pass`);
  process.exit(failed ? 1 : 0);
}
