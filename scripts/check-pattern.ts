#!/usr/bin/env tsx
/**
 * check-pattern: says whether a pattern file would publish, without a tracker. It drafts the envelope as `quilt publish`
 * does, under a throwaway key as the owner, and runs the same checks publish runs (packages/client/src/pattern.ts):
 * the envelope, the blobs and the schema subset, every brief rendered and through the plain-text gate with the title
 * and the statement of done, each family's rows against its count, every gold answer naming a piece with its agreed
 * fields, a stake rule naming families or pieces the problem has. Prints the problems found, or the pieces with their
 * rendered briefs when asked.
 *
 *   npx tsx scripts/check-pattern.ts examples/<pattern>.json [--briefs]
 */
import { readFileSync } from 'node:fs';
import { addressOf, expandPieces, problemHash } from '../packages/core/src/index.js';
import { draftEnvelope, patternProblems } from '../packages/client/src/pattern.js';
import type { Pattern } from '../packages/client/src/quilt.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: check-pattern <pattern.json> [--briefs]');
  process.exit(2);
}
const showBriefs = process.argv.includes('--briefs');
const pattern = JSON.parse(readFileSync(file, 'utf8')) as Pattern;
const secret = new Uint8Array(32);
secret[31] = 7;
const owner = { secret, address: addressOf(secret) };
const drafted = draftEnvelope(pattern, owner, { trackers: [], mirrors: [] });
const out = patternProblems(pattern, drafted);
const pieces = out.length ? [] : expandPieces(drafted.problem, drafted.blobs);
if (showBriefs) for (const p of pieces) console.log(`--- ${p.name} (${p.verifier}${p.agree ? `, agree on ${p.agree.join(', ')}` : ''})\n${p.brief}\n`);
if (out.length) {
  for (const line of out) console.log(line);
  console.log(`\n${out.length} problem${out.length === 1 ? '' : 's'} in ${file}`);
  process.exit(1);
}
console.log(`${file}: ${pieces.length} pieces, hash ${problemHash(drafted.envelope)} under a throwaway owner; every brief passes the gate${pattern.gold ? `; gold on ${Object.keys(pattern.gold.answers).length}` : ''}${pattern.stake ? `; stake ${pattern.stake.min}` : ''}`);
