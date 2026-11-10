/**
 * The owner's side of QX-19 section 4: a brief sharpened where two readings read it apart, the brief frozen in this
 * home, and the sharpening over every problem the home knows and this key owns, which the owner's turn runs
 * (owner-turn.ts). Each works through the door its Quilt hands it (door.ts): the version is published as `publish`
 * publishes it and the gold the home holds is committed again on it (gold.ts), and the Quilt's `sharpen`, `freeze`
 * and `sharpenDue` call these. The sentence itself comes from `ask`, which the caller supplies. `republish` is the
 * publishing of an owner's next version, which the take of a proposed piece shares (propose.ts).
 */
import { type Envelope, type Hash, type Problem, expandPieces, isHash, signObject, textIssues } from '@bitquilt/core';
import type { Door } from './door.js';
import { commitGold } from './gold.js';
import { parseLink } from './link.js';
import type { Seam, SeamSide } from './listings.js';
import type { Published } from './quilt.js';
import { type SentenceAsk, layerByHash } from './render.js';
import type { Resolved } from './resolver.js';

/**
 * QX-19 section 4: a brief sharpened, or not: the sentence asked for each family with a seam, whether it was kept and
 * why not, and the version published with those kept.
 */
export interface Sharpened {
  problem: Hash;
  sentences: { family: string; field: string; sentence: string | null; kept: boolean; why: string | null }[];
  hash: Hash | null;
  posted: string[];
  refused: string[];
}

/** The most a sentence added to a brief may run (QX-19 section 4). */
export const SENTENCE_MAX = 400;
const NOT_OWNER = 'only the owner sharpens a brief';
export const FROZEN = "that problem's brief is frozen in this home; `quilt freeze <problem> off` thaws it";

/**
 * QX-19 section 4: the owner's node sharpens a brief two readings read apart. For each family of this problem with a
 * piece the core calls disputed on a `source`, `span` or `reading` seam, or disputed between readings that rest on
 * nothing once the dispute has stood a lease past its last reveal, `ask` is given the brief, the field and both
 * sides, and answers with the sentence the brief lacks, or null to leave it. Each sentence kept goes at the end of
 * its family's brief in a version of the problem, `prev` this one, posted as `publish` posts, with the announce's
 * topics, and the gold the home holds for this problem is committed again on the new pieces. A problem already
 * replaced is left as it is, and the home notes which version replaced which. `now` is the clock the lease is read
 * by.
 */
export async function sharpen(
  door: Door,
  problem: Hash,
  ask: (q: SentenceAsk) => Promise<string | null>,
  now = new Date().toISOString(),
): Promise<Sharpened> {
  const id = door.needKey();
  if (door.library.problems[problem]?.frozen) throw new Error(FROZEN);
  // The owner's turn reads every problem of the home each hour, so the read leaves the library's dates as they were.
  const { state, layer, superseded } = await door.open(problem, false);
  const old = state.envelope.problem;
  if (old.owner.toLowerCase() !== id.address.toLowerCase()) throw new Error(NOT_OWNER);
  const entry = door.library.problems[problem];
  if (superseded) {
    if (entry && entry.next !== superseded) {
      entry.next = superseded;
      door.save();
    }
    return { problem, sentences: [], hash: superseded, posted: [], refused: [] };
  }
  const over = layerByHash(layer);
  const seams = new Map<string, { piece: string; seam: Seam; grounded: boolean }>();
  const grounded = (x: SeamSide) => x.read !== null && x.span !== null;
  for (const v of state.pieces) {
    const l = over.get(v.piece.hash);
    if ((l?.core ?? v.state) !== 'disputed' || seams.has(v.piece.family) || !l?.seams?.length) continue;
    // Two readings that both rest on the record: the seam says why they differ, and the sentence decides between
    // them.
    const both = l.seams.find((s) => s.why !== 'unknown');
    if (both) {
      seams.set(v.piece.family, { piece: v.piece.name, seam: both, grounded: true });
      continue;
    }
    // Readings that rest on nothing, none set aside, and the dispute a lease old since its last reveal: nothing a
    // reader could prefer, so the sentence says which record governs and where it is read.
    if (l.state !== 'disputed' || l.seams.some((s) => s.sides.some(grounded))) continue;
    const leaseMs = (v.piece.lease_h ?? old.settings.lease_h) * 3_600_000;
    const last = v.reveals.reduce((t, r) => (r.at > t ? r.at : t), '');
    if (!last || Date.parse(last) + leaseMs > Date.parse(now)) continue;
    seams.set(v.piece.family, { piece: v.piece.name, seam: l.seams[0]!, grounded: false });
  }
  const sentences: Sharpened['sentences'] = [];
  const pieces = structuredClone(old.pieces);
  for (const [family, { piece, seam, grounded: both }] of seams) {
    const key = Object.keys(pieces).find((k) => k === `${family}/*` || k === family || k === piece);
    const def = key ? pieces[key] : undefined;
    if (!def) continue;
    const said =
      (await ask({ family, brief: def.brief, field: seam.field, seam, piece, grounded: both }))
        ?.replace(/\s+/g, ' ')
        .trim() ?? '';
    const why = !said
      ? 'no sentence'
      : said.length > SENTENCE_MAX
        ? `over ${SENTENCE_MAX} characters`
        : (textIssues(said)[0] ?? null);
    sentences.push({ family, field: seam.field, sentence: said || null, kept: why === null, why });
    if (why === null) def.brief = `${def.brief} ${said}`;
  }
  if (!sentences.some((s) => s.kept)) return { problem, sentences, hash: null, posted: [], refused: [] };
  const resolved = await door.resolve(parseLink(problem));
  if (!resolved) throw new Error('no resolver answered for that hash');
  const out = await republish(door, problem, { ...old, prev: problem, pieces }, resolved);
  return { problem, sentences, hash: out.posted.length ? out.hash : null, posted: out.posted, refused: out.refused };
}

/**
 * The next version of a problem this key owns, published: the envelope signed with the home's key and the config's
 * hints, posted as `publish` posts with the topics of this key's announce, the gold the home holds for the problem
 * committed again on the new pieces, and the home's library noting which version replaced which. The sharpening
 * publishes through it, and the take of a proposed piece (propose.ts).
 */
export async function republish(door: Door, problem: Hash, next: Problem, resolved: Resolved): Promise<Published> {
  const id = door.needKey();
  const unsigned = {
    quilt: 1 as const,
    problem: next,
    hints: { trackers: door.config.trackers, mirrors: door.config.mirrors },
  };
  const envelope: Envelope = { ...unsigned, sig: signObject(unsigned, id.secret) };
  const announce = resolved.receipts.find(
    (r) => r.event.type === 'announce' && r.event.key.toLowerCase() === id.address.toLowerCase(),
  );
  const topics = (announce?.event.body as { topics?: string[] } | undefined)?.topics ?? [];
  const out = await door.publishEnvelope(envelope, resolved.blobs, next, Array.isArray(topics) ? topics : []);
  if (out.posted.length) {
    const kept = door.library.gold?.[problem];
    if (kept && Object.keys(kept).length) {
      try {
        out.gold = await commitGold(
          door,
          out.hash,
          Object.fromEntries(Object.values(kept).map((g) => [g.name, g.projection])),
          undefined,
          expandPieces(next, resolved.blobs),
          out.posted,
        );
      } catch (err) {
        out.refused.push(`gold: ${(err as Error).message}`);
      }
    }
    const was = door.library.problems[problem];
    if (was) was.next = out.hash;
    door.save();
  }
  return out;
}

/**
 * The owner's freeze of a problem's brief in this home (QX-19 section 4): from now on the owner's turn does not
 * sharpen it, so a dispute after the freeze waits beside the brief as written and no version moves the squares
 * already made onto another hash; the gold due is still revealed. Off thaws it. Only a problem this home's library
 * knows and this key owns.
 */
export async function freeze(door: Door, problem: Hash, on = true): Promise<{ problem: Hash; frozen: string | null }> {
  const id = door.needKey();
  const entry = door.library.problems[problem];
  if (!entry) throw new Error("that problem is not in this home's library");
  const { state } = await door.open(problem);
  if (state.envelope.problem.owner.toLowerCase() !== id.address.toLowerCase())
    throw new Error('only the owner freezes a brief');
  const kept = door.library.problems[problem]!;
  if (on) kept.frozen ??= door.stamp();
  else delete kept.frozen;
  door.save();
  return { problem, frozen: kept.frozen ?? null };
}

/**
 * The owner's sharpening over every problem the home knows and this key owns, each once (QX-19 section 4); the away
 * turn runs it before its agent. A problem with no such seam, or one frozen here, is passed over in silence.
 */
export async function sharpenDue(
  door: Door,
  ask: (q: SentenceAsk) => Promise<string | null>,
  now = new Date().toISOString(),
): Promise<Sharpened[]> {
  if (!door.identity) return [];
  const out: Sharpened[] = [];
  for (const h of new Set([...Object.keys(door.library.problems), ...Object.keys(door.library.gold ?? {})])) {
    if (!isHash(h) || door.library.problems[h]?.next || door.library.problems[h]?.frozen) continue;
    try {
      const r = await sharpen(door, h, ask, now);
      if (r.sentences.length) out.push(r);
    } catch (e) {
      if ((e as Error).message !== NOT_OWNER)
        out.push({ problem: h, sentences: [], hash: null, posted: [], refused: [(e as Error).message] });
    }
  }
  return out;
}
