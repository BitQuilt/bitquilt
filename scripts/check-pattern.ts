#!/usr/bin/env tsx
/**
 * check-pattern: says whether a pattern file would publish, without a tracker. It builds the envelope as `quilt publish`
 * does (a throwaway key as the owner), checks the envelope, the blobs and the schema subset, renders every piece's brief
 * and runs the plain-text gate over the title, the statement of done and every brief, checks that each family's rows
 * match its count, that every gold answer names a piece and carries its agreed fields, and that a stake rule names
 * families or pieces the problem has. Prints the problems found, or the pieces with their rendered briefs when asked.
 *
 *   npx tsx scripts/check-pattern.ts examples/<pattern>.json [--briefs]
 */
import { readFileSync } from 'node:fs';
import { type Envelope, type Hash, type Problem, addressOf, agreeFields, blobProblems, envelopeProblems, expandPieces, hashBytes, plainTextProblems, problemHash, signObject } from '../packages/core/src/index.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: check-pattern <pattern.json> [--briefs]');
  process.exit(2);
}
const showBriefs = process.argv.includes('--briefs');
const pattern = JSON.parse(readFileSync(file, 'utf8')) as {
  title: string; done_when: string; slug: string; settings?: Record<string, number>; pieces: Problem['pieces']; data?: Record<string, unknown[]>; topics?: string[];
  stake?: { min: number; pieces?: string[] }; gold?: { answers: Record<string, Record<string, unknown>>; stake?: number };
};
const secret = new Uint8Array(32);
secret[31] = 7;
const owner = addressOf(secret);
const out: string[] = [];
const blobs = new Map<Hash, Uint8Array>();
const data: Record<string, Hash> = {};
for (const [name, rows] of Object.entries(pattern.data ?? {})) {
  if (!Array.isArray(rows)) out.push(`data.${name}: a list of rows, one per piece`);
  const bytes = new TextEncoder().encode(JSON.stringify(rows));
  const h = hashBytes(bytes);
  blobs.set(h, bytes);
  data[name] = h;
}
for (const k of Object.keys(pattern)) if (!['title', 'done_when', 'slug', 'prev', 'from', 'settings', 'pieces', 'data', 'topics', 'stake', 'gold'].includes(k)) out.push(`${k}: not a field of a pattern`);
const problem: Problem = {
  title: pattern.title, done_when: pattern.done_when, owner, slug: pattern.slug, prev: null, from: null,
  settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 10, budget: 1000, patch_max: 100000, ...(pattern.settings ?? {}) } as Problem['settings'],
  pieces: pattern.pieces, data,
};
const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
const envelope: Envelope = { ...unsigned, sig: signObject(unsigned, secret) };
out.push(...envelopeProblems(envelope));
out.push(...blobProblems(problem, blobs));
for (const [label, text] of [['title', problem.title], ['done_when', problem.done_when]] as const) out.push(...plainTextProblems(text, label));
for (const t of pattern.topics ?? []) if (typeof t !== 'string' || t.length > 40) out.push(`topics: ${JSON.stringify(t)} is not a short topic`);
if ((pattern.topics ?? []).length > 8) out.push('topics: at most eight');
// Rows against counts: a family with fewer rows than pieces renders empty slots; more rows than pieces are never used.
for (const [name, d] of Object.entries(pattern.pieces)) {
  const count = 'count' in d ? (d.count as number) : 1;
  for (const [slot, blob] of Object.entries(d.data ?? {})) {
    const rows = pattern.data?.[blob];
    if (Array.isArray(rows) && rows.length !== count) out.push(`pieces.${name}: ${count} pieces but data.${blob} has ${rows.length} rows (slot ${slot})`);
  }
  const brief = d.brief ?? '';
  for (const m of brief.matchAll(/\{([A-Za-z_][\w-]*)(?:\.[\w.-]+)?\}/g)) {
    const slot = m[1]!;
    if (slot !== 'n' && !(slot in (d.data ?? {})) && !(d.inputs ?? []).includes(slot) && !(d.inputs ?? []).includes(`${slot}/*`)) out.push(`pieces.${name}.brief: slot {${slot}} names no data slot and no input`);
  }
}
let pieces: ReturnType<typeof expandPieces> = [];
if (out.length === 0) {
  try {
    pieces = expandPieces(problem, blobs);
  } catch (err) {
    out.push(`expand: ${(err as Error).message}`);
  }
}
const byName = new Map(pieces.map((p) => [p.name, p] as const));
for (const p of pieces) {
  out.push(...plainTextProblems(p.brief, `pieces.${p.name}.brief`));
  if (/\{[A-Za-z_][\w-]*(?:\.[\w.-]+)?\}/.test(p.brief) && !(p.inputs.length)) out.push(`pieces.${p.name}.brief: a slot stayed unfilled`);
  if (p.brief.length > 4000) out.push(`pieces.${p.name}.brief: ${p.brief.length} characters is long for one piece`);
}
if (pattern.stake) {
  const names = new Set<string>();
  for (const p of pieces) { names.add(p.family); names.add(p.name); }
  if (!Number.isInteger(pattern.stake.min) || pattern.stake.min < 0) out.push('stake.min: a whole number from 0');
  for (const n of pattern.stake.pieces ?? []) if (!names.has(n)) out.push(`stake.pieces: ${n} is not a family or piece of this problem`);
}
if (pattern.gold) {
  for (const [name, answer] of Object.entries(pattern.gold.answers ?? {})) {
    const p = byName.get(name);
    if (!p) { out.push(`gold.answers.${name}: no such piece`); continue; }
    if (!p.schema || p.verifier === 'check' || p.verifier === 'score') { out.push(`gold.answers.${name}: the piece has no agreed fields`); continue; }
    for (const f of agreeFields(p.schema, p.agree)) if (!(f in answer)) out.push(`gold.answers.${name}: lacks the agreed field ${f}`);
  }
}
if (showBriefs) for (const p of pieces) console.log(`--- ${p.name} (${p.verifier}${p.agree ? `, agree on ${p.agree.join(', ')}` : ''})\n${p.brief}\n`);
if (out.length) {
  for (const line of out) console.log(line);
  console.log(`\n${out.length} problem${out.length === 1 ? '' : 's'} in ${file}`);
  process.exit(1);
}
console.log(`${file}: ${pieces.length} pieces, hash ${problemHash(envelope)} under a throwaway owner; every brief passes the gate${pattern.gold ? `; gold on ${Object.keys(pattern.gold.answers).length}` : ''}${pattern.stake ? `; stake ${pattern.stake.min}` : ''}`);
