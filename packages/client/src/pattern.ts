/**
 * What is wrong with a pattern, all of it at once: the checks `quilt publish` makes before it posts and the
 * maintainers' `scripts/check-pattern.ts` runs without a tracker, in one place. An AI drafting a pattern from a
 * conversation is told every fault in one answer, in the checker's words, and fixes them in one turn. Nothing here
 * posts anything.
 */
import { type Address, type Envelope, type Hash, type Problem, agreeFields, blobProblems, envelopeProblems, expandPieces, hashBytes, plainTextProblems, signObject } from '@bitquilt/core';
import type { Pattern } from './quilt.js';

/** The fields a pattern may carry; any other is a fault, since a misspelt one would be ignored in silence. */
export const PATTERN_FIELDS: readonly string[] = ['title', 'done_when', 'slug', 'prev', 'from', 'settings', 'pieces', 'data', 'topics', 'stake', 'gold'];

/** The settings a pattern gets where it names none. */
export const DEFAULT_SETTINGS: Problem['settings'] = { challenge_window_h: 48, lease_h: 2, endgame_at: 10, budget: 1000, patch_max: 100000 };

export interface Drafted { envelope: Envelope; blobs: Map<Hash, Uint8Array>; problem: Problem }

/** The envelope a pattern makes under an owner, signed, with the blobs its data rows become: what `publish` posts. */
export function draftEnvelope(pattern: Pattern, owner: { secret: Uint8Array; address: Address }, hints: { trackers: string[]; mirrors: string[] }): Drafted {
  const blobs = new Map<Hash, Uint8Array>();
  const data: Record<string, Hash> = {};
  for (const [name, rows] of Object.entries(pattern.data ?? {})) {
    const bytes = new TextEncoder().encode(JSON.stringify(rows));
    const h = hashBytes(bytes);
    blobs.set(h, bytes);
    data[name] = h;
  }
  const problem: Problem = {
    title: pattern.title,
    done_when: pattern.done_when,
    owner: owner.address,
    slug: pattern.slug,
    prev: pattern.prev ?? null,
    from: pattern.from ?? null,
    settings: { ...DEFAULT_SETTINGS, ...pattern.settings },
    pieces: pattern.pieces,
    data,
  };
  const unsigned = { quilt: 1 as const, problem, hints };
  return { envelope: { ...unsigned, sig: signObject(unsigned, owner.secret) }, blobs, problem };
}

/**
 * Every fault in the pattern as drafted, in the order a reader fixes them: fields that are not a pattern's, the
 * envelope's and the blobs' own checks, the title and the statement of done through the plain-text gate, the topics,
 * each family's rows against its count and its brief's slots against its data and inputs, then, where the pieces
 * expand, every brief through the gate, an unfilled slot, a brief long for one piece, a stake rule naming what the
 * problem has not, and a gold answer naming no piece, a piece with no agreed fields, or lacking one. Empty when the
 * pattern would publish.
 */
export function patternProblems(pattern: Pattern, drafted: Drafted): string[] {
  const out: string[] = [];
  const { envelope, blobs, problem } = drafted;
  for (const k of Object.keys(pattern)) if (!PATTERN_FIELDS.includes(k)) out.push(`${k}: not a field of a pattern`);
  for (const [name, rows] of Object.entries(pattern.data ?? {})) if (!Array.isArray(rows)) out.push(`data.${name}: a list of rows, one per piece`);
  out.push(...envelopeProblems(envelope));
  out.push(...blobProblems(problem, blobs));
  for (const [label, text] of [['title', problem.title], ['done_when', problem.done_when]] as const) out.push(...plainTextProblems(text, label));
  for (const t of pattern.topics ?? []) if (typeof t !== 'string' || t.length > 40) out.push(`topics: ${JSON.stringify(t)} is not a short topic`);
  if ((pattern.topics ?? []).length > 8) out.push('topics: at most eight');
  // Rows against counts: a family with fewer rows than pieces renders empty slots; more rows than pieces are never used.
  for (const [name, d] of Object.entries(pattern.pieces ?? {})) {
    const count = 'count' in d ? (d.count as number) : 1;
    for (const [slot, blob] of Object.entries(d.data ?? {})) {
      const rows = pattern.data?.[blob];
      if (Array.isArray(rows) && rows.length !== count) out.push(`pieces.${name}: ${count} pieces but data.${blob} has ${rows.length} rows (slot ${slot})`);
    }
    const brief = d.brief ?? '';
    // The template through the gate as written, so a link or an address in it is named beside the other faults, before any piece is rendered.
    out.push(...plainTextProblems(brief, `pieces.${name}.brief`));
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
    // The rendered brief: what the template let through, the rows may have brought in.
    out.push(...plainTextProblems(p.brief, `pieces.${p.name}.brief`));
    if (/\{[A-Za-z_][\w-]*(?:\.[\w.-]+)?\}/.test(p.brief) && !p.inputs.length) out.push(`pieces.${p.name}.brief: a slot stayed unfilled`);
    if (p.brief.length > 4000) out.push(`pieces.${p.name}.brief: ${p.brief.length} characters is long for one piece`);
  }
  if (pattern.stake) {
    const names = new Set<string>();
    for (const p of pieces) {
      names.add(p.family);
      names.add(p.name);
    }
    if (!Number.isInteger(pattern.stake.min) || pattern.stake.min < 0) out.push('stake.min: a whole number from 0');
    for (const n of pattern.stake.pieces ?? []) if (!names.has(n)) out.push(`stake.pieces: ${n} is not a family or piece of this problem`);
  }
  if (pattern.gold) {
    for (const [name, answer] of Object.entries(pattern.gold.answers ?? {})) {
      const p = byName.get(name);
      if (!p) {
        out.push(`gold.answers.${name}: no such piece`);
        continue;
      }
      if (!p.schema || p.verifier === 'check' || p.verifier === 'score') {
        out.push(`gold.answers.${name}: the piece has no agreed fields`);
        continue;
      }
      for (const f of agreeFields(p.schema, p.agree)) if (!(f in answer)) out.push(`gold.answers.${name}: lacks the agreed field ${f}`);
    }
  }
  return out;
}

/** The faults as one message: how many, then each on its line, so a tool's refusal reads whole. */
export function patternProblemsText(problems: string[]): string {
  return `${problems.length} problem${problems.length === 1 ? '' : 's'} in the pattern, each to fix before it publishes:\n${problems.join('\n')}`;
}
