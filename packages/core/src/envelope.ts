/**
 * The problem envelope (CORE.md section 2) and the piece hash (section 3). The problem's name is the hash of its
 * `problem` alone; `hints` and `sig` sit outside it. A family expands to pieces whose ids are the hash of what they
 * are, so every client arrives at the same ids, and a return made against a piece is good in every version that
 * contains that piece.
 */
import { canonical } from './canonical.js';
import { type Hash, hashBytes, hashCanonical, isHash } from './hash.js';
import { isAddress, isSignature } from './keys.js';
import { isRecord, unknownKeys, whole } from './plain.js';
import { type Schema, schemaProblems } from './schema.js';

export const CAPABILITIES = ['web', 'files', 'shell', 'person'] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CORE_VERIFIERS = ['check', 'score', 'agree'] as const;
/** check and score: the return is a patch, section 2. */
export const PATCH_VERIFIERS: readonly string[] = ['check', 'score'];

export interface Settings {
  challenge_window_h: number;
  lease_h: number;
  endgame_at: number;
  budget: number;
  patch_max: number;
}

export interface Workspace {
  repo: string;
  base: string;
}

export interface Check {
  file: string;
  image?: string;
  /**
   * For a score piece: how far apart two scores may be and still agree (0 when absent), and which direction is better
   * (higher when absent).
   */
  tolerance?: number;
  better?: 'higher' | 'lower';
}

export interface PieceDef {
  verifier: string;
  brief: string;
  schema?: Schema;
  agree?: string[];
  requires?: Capability[];
  inputs?: string[];
  lease_h?: number;
  count?: number;
  data?: Record<string, string>;
  candidates?: number;
  workspace?: Workspace;
  check?: Check;
}

export interface Problem {
  title: string;
  done_when: string;
  owner: string;
  slug: string;
  prev: Hash | null;
  from: Hash | null;
  settings: Settings;
  pieces: Record<string, PieceDef>;
  data: Record<string, Hash>;
}

export interface Envelope {
  quilt: 1;
  problem: Problem;
  hints: { trackers: string[]; mirrors: string[] };
  sig: string;
}

/** A piece after expansion: what a return names, by hash. */
export interface Piece {
  hash: Hash;
  name: string;
  family: string;
  n: number;
  brief: string;
  verifier: string;
  schema?: Schema;
  agree?: string[];
  requires: Capability[];
  inputs: string[];
  lease_h?: number;
  candidates?: number;
  workspace?: Workspace;
  check?: Check;
}

export type Blobs = ReadonlyMap<Hash, Uint8Array>;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const FAMILY = /^(.+)\/\*$/;

/** What the envelope's check holds a slug to, in the words a refusal says after the field it names. */
export const SLUG_RULE = 'lower-case letters, digits and hyphens, at most 64';

/**
 * A slug as `envelopeProblems` holds `problem.slug` to one: "problem.slug: lower-case letters, digits and hyphens, at
 * most 64", beginning and ending with a letter or a digit. Section 2 names the slug, a short name stable across
 * versions. The export changes no check the core makes; it lets another slug be held to the same rule.
 */
export function isSlug(s: unknown): s is string {
  return typeof s === 'string' && SLUG_RE.test(s);
}

/** The closed objects of section 2: what each may carry and nothing else. */
const PROBLEM_FIELDS: readonly string[] = [
  'title',
  'done_when',
  'owner',
  'slug',
  'prev',
  'from',
  'settings',
  'pieces',
  'data',
];
const SETTING_FIELDS: readonly string[] = ['challenge_window_h', 'lease_h', 'endgame_at', 'budget', 'patch_max'];
const PIECE_FIELDS: readonly string[] = [
  'verifier',
  'brief',
  'schema',
  'agree',
  'requires',
  'inputs',
  'lease_h',
  'count',
  'data',
  'candidates',
  'workspace',
  'check',
];
const CHECK_FIELDS: readonly string[] = ['file', 'image', 'tolerance', 'better'];

/**
 * What is computed once for an envelope frozen as a store hands out what it keeps, and once for a blob's bytes their
 * holder fixed (`fixedBytes`): a tracker folds every version of a chain, and the fold of each version reads every
 * version before it (CORE.md section 6), so a problem's hash, its checks, its pieces and its blobs' hashes are asked
 * for again and again. An envelope that is not frozen, and bytes not fixed, may still be written to, so what is asked
 * of them is computed each time.
 */
const kept = {
  hashes: new WeakMap<object, Hash>(),
  faults: new WeakMap<object, string[]>(),
  pieces: new WeakMap<object, { blobs: (Uint8Array | undefined)[]; pieces: Piece[] }>(),
  fixed: new WeakSet<Uint8Array>(),
  blobs: new WeakMap<Uint8Array, Hash>(),
};

/**
 * A blob's bytes, marked as bytes their holder will not write to, as a store keeps a blob: the core checks the hash of
 * fixed bytes once, however many folds read them. A non-empty typed array cannot be frozen, so the holder says so.
 */
export function fixedBytes(bytes: Uint8Array): Uint8Array {
  kept.fixed.add(bytes);
  return bytes;
}
/** Whether an envelope is frozen as a store hands out what it keeps, so what is computed from it holds. */
export const frozenEnvelope = (e: unknown): boolean => isRecord(e) && Object.isFrozen(e) && Object.isFrozen(e.problem);

export function problemHash(e: Envelope): Hash {
  const keep = frozenEnvelope(e);
  const known = keep ? kept.hashes.get(e) : undefined;
  if (known !== undefined) return known;
  const h = hashCanonical(e.problem);
  if (keep) kept.hashes.set(e, h);
  return h;
}

function positive(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Why this is not a valid envelope (section 2), apart from the owner's signature and the blobs' presence, which the
 * caller checks with `signedBy` and `blobProblems`; or nothing. Whether a brief may be published is a tracker's
 * decision and not part of validity.
 */
export function envelopeProblems(e: unknown): string[] {
  const keep = frozenEnvelope(e);
  const known = keep ? kept.faults.get(e as object) : undefined;
  if (known !== undefined) return [...known];
  const out = faultsOf(e);
  if (keep) kept.faults.set(e as object, [...out]);
  return out;
}

function faultsOf(e: unknown): string[] {
  if (!isRecord(e)) return ['envelope: not an object'];
  const out: string[] = [];
  if (e.quilt !== 1) out.push('envelope: quilt is 1');
  if (!isSignature(e.sig)) out.push('envelope: sig is a 65-byte signature in hex');
  if (!isRecord(e.hints) || !Array.isArray(e.hints.trackers) || !Array.isArray(e.hints.mirrors))
    out.push('envelope: hints has trackers and mirrors');
  const p = e.problem;
  if (!isRecord(p)) return [...out, 'problem: not an object'];
  for (const k of PROBLEM_FIELDS) if (!Object.hasOwn(p, k)) out.push(`problem.${k}: required`);
  for (const k of unknownKeys(p, PROBLEM_FIELDS)) out.push(`problem.${k}: not a field of a problem`);
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200)
    out.push('problem.title: text of at most 200 characters');
  if (typeof p.done_when !== 'string' || !p.done_when.trim() || p.done_when.length > 1000)
    out.push('problem.done_when: text of at most 1000 characters');
  if (!isAddress(p.owner)) out.push('problem.owner: an address with its checksum');
  if (!isSlug(p.slug)) out.push(`problem.slug: ${SLUG_RULE}`);
  if (p.prev !== null && !isHash(p.prev)) out.push('problem.prev: a hash or null');
  if (p.from !== null && !isHash(p.from)) out.push('problem.from: a hash or null');
  const s = p.settings;
  if (!isRecord(s)) out.push('problem.settings: an object');
  else {
    for (const k of ['challenge_window_h', 'lease_h', 'endgame_at', 'budget'])
      if (!positive(s[k])) out.push(`problem.settings.${k}: a number above 0`);
    if (!whole(s.patch_max, 0)) out.push('problem.settings.patch_max: a whole number from 0');
    for (const k of unknownKeys(s, SETTING_FIELDS)) out.push(`problem.settings.${k}: not a setting`);
  }
  if (!isRecord(p.data)) out.push('problem.data: an object of blob names to hashes');
  else for (const [name, h] of Object.entries(p.data)) if (!isHash(h)) out.push(`problem.data.${name}: a hash`);
  if (!isRecord(p.pieces) || Object.keys(p.pieces).length === 0) return [...out, 'problem.pieces: at least one piece'];
  let total = 0;
  const names = Object.keys(p.pieces);
  for (const name of names) {
    const at = `problem.pieces.${name}`;
    const d = p.pieces[name];
    if (!isRecord(d)) {
      out.push(`${at}: an object`);
      continue;
    }
    const isFamily = FAMILY.test(name);
    if (isFamily !== 'count' in d)
      out.push(`${at}: a family is named with /* and has a count; a single piece has neither`);
    if ('count' in d && !whole(d.count, 1)) out.push(`${at}.count: a whole number from 1`);
    total += isFamily && Number.isInteger(d.count) ? (d.count as number) : 1;
    if (typeof d.verifier !== 'string' || !d.verifier) out.push(`${at}.verifier: a kind`);
    if (typeof d.brief !== 'string' || !d.brief.trim()) out.push(`${at}.brief: text`);
    if (PATCH_VERIFIERS.includes(d.verifier as string)) {
      if ('schema' in d) out.push(`${at}.schema: a check or score piece has none; its return is a patch`);
      if (!isRecord(d.workspace) || typeof d.workspace.repo !== 'string' || typeof d.workspace.base !== 'string')
        out.push(`${at}.workspace: repo and base`);
      if (
        !isRecord(d.check) ||
        typeof d.check.file !== 'string' ||
        (d.check.image !== undefined && typeof d.check.image !== 'string')
      )
        out.push(`${at}.check: file, and optionally image`);
      else {
        if (
          d.check.tolerance !== undefined &&
          !(typeof d.check.tolerance === 'number' && d.check.tolerance >= 0 && Number.isFinite(d.check.tolerance))
        )
          out.push(`${at}.check.tolerance: a number from 0`);
        if (d.check.better !== undefined && d.check.better !== 'higher' && d.check.better !== 'lower')
          out.push(`${at}.check.better: higher or lower`);
        for (const k of unknownKeys(d.check, CHECK_FIELDS)) out.push(`${at}.check.${k}: not a field of a check`);
      }
      if ('agree' in d) out.push(`${at}.agree: a check or score piece has none`);
    } else {
      if (d.schema === undefined) out.push(`${at}.schema: required`);
      else {
        const sp = schemaProblems(d.schema);
        out.push(...sp.map((x) => x.replace(/^schema/, `${at}.schema`)));
        if (sp.length === 0 && d.agree !== undefined) {
          const props = (d.schema as Schema).properties;
          if (!Array.isArray(d.agree) || !d.agree.every((f) => typeof f === 'string' && f in props))
            out.push(`${at}.agree: names fields the schema has`);
        }
      }
      if ('workspace' in d || 'check' in d) out.push(`${at}: workspace and check belong to check and score pieces`);
    }
    if (
      d.requires !== undefined &&
      (!Array.isArray(d.requires) ||
        !d.requires.every((r) => (CAPABILITIES as readonly string[]).includes(r as string)))
    )
      out.push(`${at}.requires: from ${CAPABILITIES.join(', ')}`);
    if (d.inputs !== undefined) {
      if (!Array.isArray(d.inputs) || !d.inputs.every((i) => typeof i === 'string'))
        out.push(`${at}.inputs: a list of piece or family names`);
      else
        for (const i of d.inputs) if (!names.includes(i)) out.push(`${at}.inputs: ${i} is not a piece of this problem`);
    }
    if (d.lease_h !== undefined && !positive(d.lease_h)) out.push(`${at}.lease_h: a number above 0`);
    if (d.candidates !== undefined && !whole(d.candidates, 1)) out.push(`${at}.candidates: a whole number from 1`);
    if (d.data !== undefined) {
      if (!isRecord(d.data) || !Object.values(d.data).every((v) => typeof v === 'string'))
        out.push(`${at}.data: slot names to blob names`);
      else if (isRecord(p.data))
        for (const blob of Object.values(d.data as Record<string, string>))
          if (!(blob in p.data)) out.push(`${at}.data: ${blob} is not a blob of this problem`);
    }
    for (const k of unknownKeys(d, PIECE_FIELDS)) out.push(`${at}.${k}: not a field of a piece`);
  }
  if (isRecord(s) && positive(s.budget) && total > (s.budget as number))
    out.push(`problem.pieces: ${total} pieces after expansion, over the budget of ${s.budget}`);
  return out;
}

/** Why the blobs handed in differ from what the problem names, or nothing. */
export function blobProblems(p: Problem, blobs: Blobs): string[] {
  const out: string[] = [];
  for (const [name, h] of Object.entries(p.data)) {
    const b = blobs.get(h);
    if (!b) out.push(`blob ${name}: ${h} not present`);
    else if (blobHash(b) !== h) out.push(`blob ${name}: does not match its hash`);
  }
  return out;
}

/** A blob's hash, once for bytes their holder fixed (`fixedBytes`), and each time for any other. */
function blobHash(b: Uint8Array): Hash {
  if (!kept.fixed.has(b)) return hashBytes(b);
  const known = kept.blobs.get(b);
  if (known !== undefined) return known;
  const h = hashBytes(b);
  kept.blobs.set(b, h);
  return h;
}

/**
 * A data blob as the rows a family's slots draw on: a JSON list, one entry per piece, or an object for a single piece.
 */
function parseBlob(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

const SLOT = /\{([A-Za-z_][\w-]*)(?:\.([A-Za-z_][\w.-]*))?\}/g;

/**
 * The brief with `{n}` and the piece's data slots filled; slots that name nothing in the piece's `data` stay as
 * written, since they render other pieces' returns, which are not known when the piece is named.
 */
export function renderBrief(template: string, n: number, data: Record<string, unknown>): string {
  return template.replace(SLOT, (slot, name: string, path: string | undefined) => {
    if (name === 'n' && path === undefined) return String(n);
    if (!(name in data)) return slot;
    let v: unknown = data[name];
    for (const step of path ? path.split('.') : []) v = isRecord(v) ? v[step] : undefined;
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : canonical(v);
  });
}

/**
 * The pieces of a problem, expanded and named by hash (section 3). The blobs must already have been checked. A problem
 * frozen as a store hands out what it keeps is expanded once for the same blobs, and its pieces are frozen with it.
 */
export function expandPieces(p: Problem, blobs: Blobs): Piece[] {
  if (typeof p !== 'object' || p === null || !Object.isFrozen(p)) return expand(p, blobs);
  const given = Object.values(p.data).map((h) => blobs.get(h));
  const known = kept.pieces.get(p);
  if (known && known.blobs.length === given.length && known.blobs.every((b, i) => b === given[i])) return known.pieces;
  const pieces = expand(p, blobs);
  for (const piece of pieces) Object.freeze(piece);
  Object.freeze(pieces);
  kept.pieces.set(p, { blobs: given, pieces });
  return pieces;
}

function expand(p: Problem, blobs: Blobs): Piece[] {
  const out: Piece[] = [];
  // Each blob read once, however many families' slots draw on it.
  const read = new Map<Hash, unknown>();
  for (const [name, d] of Object.entries(p.pieces)) {
    const fam = FAMILY.exec(name);
    const family = fam ? fam[1]! : name;
    const count = fam ? (d.count ?? 1) : 1;
    const rows: Record<string, unknown[]> = {};
    for (const [slot, blobName] of Object.entries(d.data ?? {})) {
      const h = p.data[blobName];
      const bytes = h ? blobs.get(h) : undefined;
      if (h && bytes && !read.has(h)) read.set(h, parseBlob(bytes));
      const parsed = h && bytes ? read.get(h) : undefined;
      rows[slot] = Array.isArray(parsed) ? parsed : [parsed];
    }
    for (let n = 1; n <= count; n++) {
      const data: Record<string, unknown> = {};
      for (const [slot, list] of Object.entries(rows)) data[slot] = list[n - 1];
      const brief = renderBrief(d.brief, n, data);
      const named = {
        family,
        n,
        brief,
        schema: d.schema,
        verifier: d.verifier,
        agree: d.agree,
        requires: d.requires,
        inputs: d.inputs,
        lease_h: d.lease_h,
        workspace: d.workspace,
        check: d.check,
      };
      const piece: Piece = {
        hash: hashCanonical(named),
        name: fam ? `${family}/${n}` : name,
        family,
        n,
        brief,
        verifier: d.verifier,
        requires: d.requires ?? [],
        inputs: d.inputs ?? [],
      };
      if (d.schema) piece.schema = d.schema;
      if (d.agree) piece.agree = d.agree;
      if (d.lease_h !== undefined) piece.lease_h = d.lease_h;
      if (d.candidates !== undefined) piece.candidates = d.candidates;
      if (d.workspace) piece.workspace = d.workspace;
      if (d.check) piece.check = d.check;
      out.push(piece);
    }
  }
  return out;
}

/** The pieces an `inputs` entry names: every piece of a family, or the one piece. */
export function inputPieces(entry: string, pieces: Piece[]): Piece[] {
  const fam = FAMILY.exec(entry);
  return fam ? pieces.filter((x) => x.family === fam[1]) : pieces.filter((x) => x.name === entry);
}

/**
 * What `inputPieces` answers for each entry, over the pieces indexed once by family and by name, in their order: a
 * problem whose every piece names an input then costs a lookup a piece, not a pass over every piece.
 */
export function inputsBy(pieces: Piece[]): (entry: string) => Piece[] {
  const byFamily = new Map<string, Piece[]>();
  const byName = new Map<string, Piece[]>();
  for (const x of pieces) {
    const family = byFamily.get(x.family);
    if (family) family.push(x);
    else byFamily.set(x.family, [x]);
    const named = byName.get(x.name);
    if (named) named.push(x);
    else byName.set(x.name, [x]);
  }
  return (entry) => {
    const fam = FAMILY.exec(entry);
    return (fam ? byFamily.get(fam[1]!) : byName.get(entry)) ?? [];
  };
}
