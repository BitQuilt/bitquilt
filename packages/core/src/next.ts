/**
 * next (CORE.md section 7): one piece for one key. Candidates are every piece not yet done, the ones in flight and
 * sealed included, since a claim is an intent and the second production is the point; rarest first; ties by dependents,
 * then by a hash of the piece, the key and the hour so two keys at one instant spread out and one key retrying gets the
 * same answer for an hour; file position last. Verifies first when they outnumber the open; endgame when few remain.
 */
import { canonical } from './canonical.js';
import { type Capability, type Piece, inputPieces } from './envelope.js';
import { hashCanonical } from './hash.js';
import type { Address } from './keys.js';
import { type PieceState, type PieceView, type State, availabilityOf } from './reduce.js';
import type { Schema } from './schema.js';

export interface Client {
  can: Capability[];
  model: string;
}

export interface Pick {
  piece: Piece;
  state: PieceState;
  brief: string;
  schema?: Schema;
  agree: string[];
  requires: Capability[];
  lease_h: number;
  availability: number;
}

const CANDIDATE_STATES: ReadonlySet<PieceState> = new Set(['open', 'in_flight', 'sealed', 'needs_verify', 'disputed']);
const VERIFY_STATES: ReadonlySet<PieceState> = new Set(['needs_verify', 'disputed']);

/** The hour, `YYYY-MM-DDTHH` in UTC. */
export function hourOf(now: string): string {
  return new Date(Date.parse(now)).toISOString().slice(0, 13);
}

/** The tie-break: sha256 over the canonical list of the piece hash, the key and the hour. */
export function tieBreak(piece: Piece, key: Address, now: string): string {
  return hashCanonical([piece.hash, key, hourOf(now)]);
}

function vendorOf(model: string): string {
  const i = model.indexOf('/');
  return i < 0 ? model : model.slice(0, i);
}

export function next(state: State, key: Address, client: Client, now: string): Pick | null {
  const root = state.rootOf(key, now);
  const owner = state.envelope.problem.owner as Address;
  const settings = state.envelope.problem.settings;
  const remaining = state.pieces.filter((v) => v.state !== 'accepted' && v.state !== 'unreachable').length;
  const endgame = remaining <= settings.endgame_at;
  const can = new Set(client.can);

  const candidates = state.pieces.filter((v) => {
    if (!CANDIDATE_STATES.has(v.state)) return false;
    if (!v.piece.requires.every((r) => can.has(r))) return false;
    if (state.related(root, owner, now)) return false;
    if (v.reveals.some((r) => state.related(r.root, root, now))) return false;
    if (v.runs.some((r) => state.related(r.root, root, now))) return false;
    if (v.claims.some((c) => c.until > now && state.related(c.root, root, now))) return false;
    if ([...v.declined].some((d) => state.related(d, root, now))) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  const verifies = state.pieces.filter((v) => VERIFY_STATES.has(v.state)).length;
  const open = state.pieces.filter((v) => v.state === 'open').length;
  let pool = candidates;
  if (verifies > open) {
    const needing = candidates.filter((v) => VERIFY_STATES.has(v.state));
    if (needing.length) {
      const vendor = vendorOf(client.model);
      const fresh = needing.filter((v) => !v.reveals.some((r) => r.vendor === vendor));
      pool = fresh.length ? fresh : needing;
    }
  }

  const position = new Map(state.pieces.map((v, i) => [v.piece.hash, i] as const));
  const scored = pool.map((v) => ({
    v,
    availability: endgame ? availabilityOf(v, state.weights, null, now, true) : v.availability,
    tie: tieBreak(v.piece, key, now),
    pos: position.get(v.piece.hash)!,
  }));
  scored.sort((a, b) => a.availability - b.availability || b.v.dependents - a.v.dependents || (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0) || a.pos - b.pos);
  const best = scored[0]!;
  return {
    piece: best.v.piece,
    state: best.v.state,
    brief: renderInputs(best.v, state),
    ...(best.v.piece.schema ? { schema: best.v.piece.schema } : {}),
    agree: best.v.piece.agree ?? best.v.piece.schema?.required ?? [],
    requires: best.v.piece.requires,
    lease_h: best.v.piece.lease_h ?? settings.lease_h,
    availability: best.availability,
  };
}

/** The brief with slots that name the piece's inputs filled with the accepting sets' returns as quoted text with the signers' addresses. */
export function renderInputs(v: PieceView, state: State): string {
  let brief = v.piece.brief;
  for (const entry of v.piece.inputs) {
    const lines: string[] = [];
    for (const dep of inputPieces(entry, state.pieces.map((x) => x.piece))) {
      const dv = state.byHash.get(dep.hash);
      if (!dv?.accepting) continue;
      if (dv.accepting.kind === 'agree') for (const r of dv.accepting.reveals) lines.push(`${dep.name}, by ${r.root}: ${canonical(r.return)}`);
      else lines.push(`${dep.name}, by ${dv.accepting.patch.root}: ${canonical(dv.accepting.patch.return)}`);
    }
    const slot = `{${entry}}`;
    brief = brief.split(slot).join(lines.join('\n'));
  }
  return brief;
}
