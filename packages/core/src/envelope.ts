/**
 * The problem envelope (CORE.md section 2) and the piece hash (section 3). The problem's name is the hash of its
 * `problem` alone; `hints` and `sig` sit outside it. A family expands to pieces whose ids are the hash of what they
 * are, so every client arrives at the same ids, and a return made against a piece is good in every version that
 * contains that piece.
 */
import { canonical } from './canonical.js';
import { type Hash, hashBytes, hashCanonical, isHash } from './hash.js';
import { type Schema, schemaProblems } from './schema.js';

export const CAPABILITIES = ['web', 'files', 'shell', 'person'] as const;
export type Capability = (typeof CAPABILITIES)[number];
export const CORE_VERIFIERS = ['check', 'score', 'agree'] as const;
export type CoreVerifier = (typeof CORE_VERIFIERS)[number];

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

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const SIG_RE = /^0x[0-9a-f]{130}$/;
const FAMILY = /^(.+)\/\*$/;
const MACHINE: ReadonlySet<string> = new Set(['check', 'score']);

export function problemHash(e: Envelope): Hash {
  return hashCanonical(e.problem);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function positive(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/**
 * Why this is not a valid envelope (section 2), apart from the owner's signature and the blobs' presence, which the
 * caller checks with `envelopeSignatureOk` and `blobProblems`; or nothing. Whether a brief may be published is a
 * tracker's decision and not part of validity.
 */
export function envelopeProblems(e: unknown): string[] {
  if (!isRecord(e)) return ['envelope: not an object'];
  const out: string[] = [];
  if (e.quilt !== 1) out.push('envelope: quilt is 1');
  if (typeof e.sig !== 'string' || !SIG_RE.test(e.sig)) out.push('envelope: sig is a 65-byte signature in hex');
  if (!isRecord(e.hints) || !Array.isArray(e.hints.trackers) || !Array.isArray(e.hints.mirrors)) out.push('envelope: hints has trackers and mirrors');
  const p = e.problem;
  if (!isRecord(p)) return [...out, 'problem: not an object'];
  const keys = new Set(Object.keys(p));
  for (const k of ['title', 'done_when', 'owner', 'slug', 'prev', 'from', 'settings', 'pieces', 'data']) if (!keys.has(k)) out.push(`problem.${k}: required`);
  for (const k of keys) if (!['title', 'done_when', 'owner', 'slug', 'prev', 'from', 'settings', 'pieces', 'data'].includes(k)) out.push(`problem.${k}: not a field of a problem`);
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 200) out.push('problem.title: text of at most 200 characters');
  if (typeof p.done_when !== 'string' || !p.done_when.trim() || p.done_when.length > 1000) out.push('problem.done_when: text of at most 1000 characters');
  if (typeof p.owner !== 'string' || !ADDRESS_RE.test(p.owner)) out.push('problem.owner: an address');
  if (typeof p.slug !== 'string' || !SLUG_RE.test(p.slug)) out.push('problem.slug: lower-case letters, digits and hyphens, at most 64');
  if (p.prev !== null && !isHash(p.prev)) out.push('problem.prev: a hash or null');
  if (p.from !== null && !isHash(p.from)) out.push('problem.from: a hash or null');
  const s = p.settings;
  if (!isRecord(s)) out.push('problem.settings: an object');
  else {
    for (const k of ['challenge_window_h', 'lease_h', 'endgame_at', 'budget']) if (!positive(s[k])) out.push(`problem.settings.${k}: a number above 0`);
    if (!(typeof s.patch_max === 'number' && Number.isInteger(s.patch_max) && s.patch_max >= 0)) out.push('problem.settings.patch_max: a whole number from 0');
    for (const k of Object.keys(s)) if (!['challenge_window_h', 'lease_h', 'endgame_at', 'budget', 'patch_max'].includes(k)) out.push(`problem.settings.${k}: not a setting`);
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
    if (isFamily !== ('count' in d)) out.push(`${at}: a family is named with /* and has a count; a single piece has neither`);
    if ('count' in d && !(Number.isInteger(d.count) && (d.count as number) >= 1)) out.push(`${at}.count: a whole number from 1`);
    total += isFamily && Number.isInteger(d.count) ? (d.count as number) : 1;
    if (typeof d.verifier !== 'string' || !d.verifier) out.push(`${at}.verifier: a kind`);
    if (typeof d.brief !== 'string' || !d.brief.trim()) out.push(`${at}.brief: text`);
    const machine = MACHINE.has(d.verifier as string);
    if (machine) {
      if ('schema' in d) out.push(`${at}.schema: a check or score piece has none; its return is a patch`);
      if (!isRecord(d.workspace) || typeof d.workspace.repo !== 'string' || typeof d.workspace.base !== 'string') out.push(`${at}.workspace: repo and base`);
      if (!isRecord(d.check) || typeof d.check.file !== 'string' || (d.check.image !== undefined && typeof d.check.image !== 'string')) out.push(`${at}.check: file, and optionally image`);
      if ('agree' in d) out.push(`${at}.agree: a check or score piece has none`);
    } else {
      if (d.schema === undefined) out.push(`${at}.schema: required`);
      else {
        const sp = schemaProblems(d.schema);
        out.push(...sp.map((x) => x.replace(/^schema/, `${at}.schema`)));
        if (sp.length === 0 && d.agree !== undefined) {
          const props = (d.schema as Schema).properties;
          if (!Array.isArray(d.agree) || !d.agree.every((f) => typeof f === 'string' && f in props)) out.push(`${at}.agree: names fields the schema has`);
        }
      }
      if ('workspace' in d || 'check' in d) out.push(`${at}: workspace and check belong to check and score pieces`);
    }
    if (d.requires !== undefined && (!Array.isArray(d.requires) || !d.requires.every((r) => (CAPABILITIES as readonly string[]).includes(r as string)))) out.push(`${at}.requires: from ${CAPABILITIES.join(', ')}`);
    if (d.inputs !== undefined) {
      if (!Array.isArray(d.inputs) || !d.inputs.every((i) => typeof i === 'string')) out.push(`${at}.inputs: a list of piece or family names`);
      else for (const i of d.inputs) if (!names.includes(i)) out.push(`${at}.inputs: ${i} is not a piece of this problem`);
    }
    if (d.lease_h !== undefined && !positive(d.lease_h)) out.push(`${at}.lease_h: a number above 0`);
    if (d.candidates !== undefined && !(Number.isInteger(d.candidates) && (d.candidates as number) >= 1)) out.push(`${at}.candidates: a whole number from 1`);
    if (d.data !== undefined) {
      if (!isRecord(d.data) || !Object.values(d.data).every((v) => typeof v === 'string')) out.push(`${at}.data: slot names to blob names`);
      else if (isRecord(p.data)) for (const blob of Object.values(d.data as Record<string, string>)) if (!(blob in p.data)) out.push(`${at}.data: ${blob} is not a blob of this problem`);
    }
    for (const k of Object.keys(d)) if (!['verifier', 'brief', 'schema', 'agree', 'requires', 'inputs', 'lease_h', 'count', 'data', 'candidates', 'workspace', 'check'].includes(k)) out.push(`${at}.${k}: not a field of a piece`);
  }
  if (isRecord(s) && positive(s.budget) && total > (s.budget as number)) out.push(`problem.pieces: ${total} pieces after expansion, over the budget of ${s.budget}`);
  return out;
}

/** Why the blobs handed in do not match what the problem names, or nothing. */
export function blobProblems(p: Problem, blobs: Blobs): string[] {
  const out: string[] = [];
  for (const [name, h] of Object.entries(p.data)) {
    const b = blobs.get(h);
    if (!b) out.push(`blob ${name}: ${h} not present`);
    else if (hashBytes(b) !== h) out.push(`blob ${name}: does not match its hash`);
  }
  return out;
}

/** A data blob as the rows a family's slots draw on: a JSON list, one entry per piece, or an object for a single piece. */
function parseBlob(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes));
}

const SLOT = /\{([A-Za-z_][\w-]*)(?:\.([A-Za-z_][\w.-]*))?\}/g;

/**
 * The brief with `{n}` and the piece's data slots filled; slots that name nothing in the piece's `data` stay as
 * written, since they render other pieces' returns, which are not known when the piece is named.
 */
export function renderBrief(template: string, n: number, data: Record<string, unknown>): string {
  return template.replace(SLOT, (whole, name: string, path: string | undefined) => {
    if (name === 'n' && path === undefined) return String(n);
    if (!(name in data)) return whole;
    let v: unknown = data[name];
    for (const step of path ? path.split('.') : []) v = isRecord(v) ? v[step] : undefined;
    if (v === undefined || v === null) return '';
    return typeof v === 'string' ? v : canonical(v);
  });
}

/** The pieces of a problem, expanded and named by hash (section 3). The blobs must already have been checked. */
export function expandPieces(p: Problem, blobs: Blobs): Piece[] {
  const out: Piece[] = [];
  for (const [name, d] of Object.entries(p.pieces)) {
    const fam = FAMILY.exec(name);
    const family = fam ? fam[1]! : name;
    const count = fam ? (d.count ?? 1) : 1;
    const rows: Record<string, unknown[]> = {};
    for (const [slot, blobName] of Object.entries(d.data ?? {})) {
      const h = p.data[blobName];
      const bytes = h ? blobs.get(h) : undefined;
      const parsed = bytes ? parseBlob(bytes) : undefined;
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
