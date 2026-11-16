/**
 * The answers of a piece, by who gave them, and the keys a reader leaves out. QX-24 section 1: "An answer is what
 * the readings of a piece that agree on its agree fields say, with every reading that says it and the key each was
 * signed by." Nothing is decided here and nothing is picked: the readings are the record's (READING.md section 3),
 * each with how it counts, and this file sets beside each other the ones that say the same, in the order the first
 * of each was received. No answer is ranked above another.
 *
 * QX-24 section 2: "A reader may leave keys out. A reading is left out where its root or the key that signed it is
 * one of them, and the answers are told again over the readings that remain." The list is the reader's own and no
 * event carries it, so it is an argument here: the tally is a function of the readings and the list, and a tracker,
 * a client and a phone that hold the same readings and the same list tell the same answers.
 */
import { PATCH_VERIFIERS } from './envelope.js';
import type { Hash } from './hash.js';
import type { LayerState } from './challenge.js';
import type { ProblemLayer } from './layer.js';
import type { HowCounts } from './readings.js';
import type { Reveal } from './reduce.js';
import { type Return, type Schema, agreeFields, returnsAgree } from './schema.js';

/** The extension this file carries out, as a tracker's well-known document names it. */
export const ANSWERS = 'QX-24';

/** One reading as an answer is told from: the record's entry for it (READING.md section 3), with what it said. */
export interface Said {
  /** The reveal's id, which names the reading. */
  id: Hash;
  /** The key that signed it and the root it counts for, as addresses; text, since a reader holds a listing. */
  key: string;
  root: string;
  vendor: string;
  /** The model the reveal declares, its `by.model`. */
  model: string;
  at: string;
  counts: HowCounts;
  why: string | null;
  /** The hash of the return, by which two patches are the same answer. */
  digest: Hash;
  /** The return whole; null on a check or score piece, whose return is a patch and the square page's to show. */
  return: Return | null;
}

/** One answer of a piece: what it says, and every reading that says it, in receipt order. */
export interface Answer<S extends Said = Said> {
  /** The agree fields as the first reading gave them; null where the piece has no schema or returns a patch. */
  says: Record<string, unknown> | null;
  readings: S[];
  /**
   * QX-24 section 1: the roots and the vendors of its readings that are neither struck nor set aside, each once. A
   * reading struck or set aside is listed with the rest and counted in neither.
   */
  roots: number;
  vendors: number;
}

/** A piece's answers over the readings a reader did not leave out. */
export interface Tally<S extends Said = Said> {
  answers: Answer<S>[];
  /** The readings told, and the readings left out because the reader's list names their root or their key. */
  readings: number;
  left_out: number;
}

/** A reader's list as the tally reads it: each address in lower case, so a checksum's capitals never hide a key. */
export function leftOut(addresses: Iterable<string>): Set<string> {
  return new Set([...addresses].map((a) => a.toLowerCase()));
}

const NOBODY: ReadonlySet<string> = new Set();

/**
 * The answers of one piece. QX-24 section 1: two readings say the same answer where they agree on the piece's agree
 * fields as the core reads agreement (CORE.md section 6), and where the piece has no schema or returns a patch,
 * where their returns have one hash. A reading joins the first answer it agrees with, in receipt order, so the
 * answers stand in the order the first reading of each was received.
 */
export function tally<S extends Said>(
  schema: Schema | undefined,
  agree: string[] | undefined,
  said: readonly S[],
  without: ReadonlySet<string> = NOBODY,
): Tally<S> {
  const told = said.filter((r) => !without.has(r.root.toLowerCase()) && !without.has(r.key.toLowerCase()));
  const fields = schema ? agreeFields(schema, agree) : [];
  const same = (a: S, b: S): boolean =>
    schema && a.return && b.return ? returnsAgree(schema, fields, a.return, b.return) : a.digest === b.digest;
  const groups: S[][] = [];
  for (const r of told) {
    const group = groups.find((g) => same(g[0]!, r));
    if (group) group.push(r);
    else groups.push([r]);
  }
  const answers = groups.map((readings): Answer<S> => {
    const first = readings[0]!;
    const standing = readings.filter((r) => r.counts === 'counted' || r.counts === 'kept');
    return {
      says: schema && first.return ? Object.fromEntries(fields.map((f) => [f, first.return![f] ?? null])) : null,
      readings,
      roots: new Set(standing.map((r) => r.root.toLowerCase())).size,
      vendors: new Set(standing.map((r) => r.vendor)).size,
    };
  });
  return { answers, readings: told.length, left_out: said.length - told.length };
}

/** A piece's answers as a tracker lists them (QX-24 section 3): the piece, its one state, and the tally. */
export interface PieceAnswers extends Tally {
  piece: Hash;
  name: string;
  verifier: string;
  state: LayerState;
}

/**
 * The answers of every piece of a problem that has a reading, in the problem's file order. The readings are the
 * layer's (READING.md section 3), each with the return its reveal gave: the fold's where the fold holds the reveal,
 * and the record's with nothing struck where the read set it aside or struck it, so no reading is told without what
 * it said.
 */
export function answersIn(pl: ProblemLayer, without: ReadonlySet<string> = NOBODY): PieceAnswers[] {
  const out: PieceAnswers[] = [];
  for (const l of pl.pieces) {
    if (l.readings.length === 0) continue;
    const reveals = new Map<Hash, Reveal>();
    for (const r of pl.core.byHash.get(l.hash)?.reveals ?? []) reveals.set(r.id, r);
    const v = pl.fold.byHash.get(l.hash);
    for (const r of v?.reveals ?? []) reveals.set(r.id, r);
    const piece = v?.piece ?? pl.core.byHash.get(l.hash)?.piece;
    if (!piece) continue;
    const patch = PATCH_VERIFIERS.includes(piece.verifier);
    const said = l.readings.flatMap((x): Said[] => {
      const reveal = reveals.get(x.id);
      if (!reveal) return [];
      return [
        {
          id: x.id,
          key: x.key,
          root: x.root,
          vendor: x.vendor,
          model: reveal.by.model,
          at: x.at,
          counts: x.counts,
          why: x.why,
          digest: reveal.digest,
          return: patch ? null : reveal.return,
        },
      ];
    });
    out.push({
      piece: l.hash,
      name: l.name,
      verifier: piece.verifier,
      state: l.state,
      ...tally(patch ? undefined : piece.schema, piece.agree, said, without),
    });
  }
  return out;
}
