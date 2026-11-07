/**
 * The owner's gold as a client keeps it (QX-16): answers committed blind before the work, each bound to its piece under
 * its own nonce so the ledger counts them and names no piece, and revealed piece by piece once accepted. The
 * projections and nonces stay in the home's library and never leave it. Each works through the door its Quilt hands it
 * (door.ts); the Quilt's `commitGold` and `revealGold` call these.
 */
import { type Hash, type Piece, agreeFields, commitHash, eventId, isHash, newNonce } from '@bitquilt/core';
import type { Door } from './door.js';
import type { LayerPiece } from './listings.js';
import { layerByHash } from './render.js';
import type { Library, Posted } from './resolver.js';

/**
 * The owner's gold on a problem, posted after publishing or at it: each answer projected to the piece's agreed fields
 * and committed by hash together with the piece, under its own nonce, so the ledger shows how many answers are
 * committed and not which pieces; the projections and nonces stay in the library. The stake, left out, is the largest
 * share among the pieces a gold can be on, for each commitment: for each root a miss would dock, two for a piece whose
 * set is two reveals, the stake the rule asks of the piece, or one. A piece already worked takes no gold, since the
 * reveal on it would be refused.
 */
export async function commitGold(
  door: Door,
  problem: Hash,
  answers: Record<string, Record<string, unknown>>,
  stakeAsked?: number,
  pieces?: Piece[],
  trackers?: string[],
  rule?: { min: number; pieces?: string[] },
): Promise<{ pieces: number; stake: number }> {
  let all = pieces;
  let where = trackers;
  const worked = new Set<Hash>();
  if (!all || !where) {
    const opened = await door.open(problem);
    all ??= opened.state.pieces.map((v) => v.piece);
    where ??= door.trackersFor(problem);
    for (const v of opened.state.pieces)
      if (v.claims.length || v.commits.length || v.reveals.length || v.runs.length) worked.add(v.piece.hash);
    if (!rule && opened.layer) {
      // The rule in force, as the tracker shows it per piece: the share of each committed piece follows it.
      const stakes = new Map(opened.layer.map((l) => [l.hash, l.stake ?? 0] as const));
      rule = { min: 0, pieces: [] };
      for (const p of all)
        if ((stakes.get(p.hash) ?? 0) > 0)
          rule = { min: Math.max(rule.min, stakes.get(p.hash)!), pieces: [...(rule.pieces ?? []), p.name] };
    }
  }
  const golden = (x: Piece) => x.schema !== undefined && x.verifier !== 'check' && x.verifier !== 'score';
  const covered = (x: Piece) =>
    rule !== undefined &&
    rule.min > 0 &&
    (!rule.pieces?.length || rule.pieces.includes(x.family) || rule.pieces.includes(x.name));
  // Each blind commitment costs the largest share among the pieces a gold can be on, since the ledger cannot tell which piece it names.
  const share = Math.max(
    0,
    ...all.filter(golden).map((x) => (x.verifier === 'attest' ? 1 : 2) * Math.max(1, covered(x) ? rule!.min : 0)),
  );
  const commitments: Hash[] = [];
  const kept: Record<string, { name: string; projection: Record<string, unknown>; nonce: string }> = {};
  for (const [name, answer] of Object.entries(answers)) {
    const piece = all.find((x) => x.name === name);
    if (!piece) throw new Error(`no piece named ${name}`);
    if (!golden(piece)) throw new Error(`${name} has no agreed fields to commit to`);
    if (worked.has(piece.hash)) throw new Error(`${name} is already worked, and a reveal on it would be refused`);
    const fields = agreeFields(piece.schema!, piece.agree);
    const projection: Record<string, unknown> = {};
    for (const f of fields) {
      if (!(f in answer)) throw new Error(`the answer for ${name} lacks ${f}`);
      projection[f] = answer[f];
    }
    const nonce = newNonce();
    commitments.push(commitHash({ piece: piece.hash, projection }, nonce));
    kept[piece.hash] = { name, projection, nonce };
  }
  if (commitments.length === 0) throw new Error('no answers to commit');
  // In hash order, so the order of the list says nothing about which piece is which.
  commitments.sort();
  const stake = stakeAsked ?? share * commitments.length;
  const r = await door.post(
    door.sign({
      quilt: 1,
      type: 'gold',
      problem,
      key: door.needKey().address,
      ts: door.stamp(),
      body: { commitments, stake },
    }),
    problem,
    where,
  );
  // The tracker's reason alone, since `publish` lists it under "gold:" and `quilt gold commit` prints it as it is.
  if (r.error && !r.queued) throw new Error(r.error);
  door.library.gold ??= {};
  door.library.gold[problem] = { ...(door.library.gold[problem] ?? {}), ...kept };
  door.save();
  return { pieces: Object.keys(kept).length, stake };
}

/**
 * The owner's reveal of the gold on a piece, from the projection and nonce kept at publishing: posted to the problem's
 * trackers, and the tracker that took it says what it decided, a match or a miss.
 */
export async function revealGold(
  door: Door,
  problem: Hash,
  piece: Hash,
): Promise<Posted & { id: Hash; name: string; outcome: string | null }> {
  const kept = door.library.gold?.[problem]?.[piece];
  if (!kept)
    throw new Error(
      "no gold kept here for that piece: the projection and nonce are the owner's, in the library of the home that published",
    );
  const { event, posted } = await door.postSigned(
    {
      quilt: 1,
      type: 'gold_reveal',
      problem,
      piece,
      key: door.needKey().address,
      ts: door.stamp(),
      body: { projection: kept.projection, nonce: kept.nonce },
    },
    problem,
    door.trackersFor(problem),
    'reveal',
  );
  kept.revealed = event.ts;
  door.save();
  const layer = posted.at ? await door.layerOf(problem, posted.at) : null;
  const outcome = layer?.find((l) => l.hash === piece)?.gold ?? null;
  return { id: eventId(event), ...posted, name: kept.name, outcome };
}

/** A piece whose gold is due: committed from this home, not yet revealed, and its window open as the tracker holds it. */
export interface GoldDue {
  problem: Hash;
  piece: Hash;
  name: string;
}

/**
 * The states in which the gold on a piece can be due: an accepting set stands and its window is open, so a match
 * verifies it and a miss strikes it (QX-16 section 3). Once the window has closed the piece is `accepted`, the tracker
 * refuses the reveal, and the commitment has lapsed: the square is accepted and not verified, and nothing is due on it.
 * Until 2 November 2026 `accepted` was listed as due, and the owner's turn posted reveals the tracker refused. A
 * `challenged` piece stays `challenged` while the panel sits, after its window has closed too (QX-1 section 7), so from
 * 7 November 2026 these states stand in only where a tracker does not say `window_open` (`windowOpen` below).
 */
export const GOLD_DUE_STATES: readonly string[] = ['accepted_provisional', 'challenged'];

/**
 * Whether the tracker holds the piece's window open, which is where it takes a reveal: the tracker's `window_open`. A
 * tracker older than 7 November 2026 does not say it, and the states stand in, a challenged piece counting only while
 * the core does not call its acceptance final. The core says `accepted` once the window closes while the panel sits
 * (QX-1 section 7), but `unknown` for a piece of a kind it does not know, so there a late reveal can still be offered,
 * and the tracker refuses it with its reason.
 */
export function windowOpen(l: LayerPiece): boolean {
  if (typeof l.window_open === 'boolean') return l.window_open;
  return GOLD_DUE_STATES.includes(l.state) && l.core !== 'accepted' && l.core !== 'unreachable';
}

/** The pieces of a problem whose gold is due, from the library and the tracker's layer over the problem. */
export function goldDue(library: Library, problem: Hash, over: Map<Hash, LayerPiece>): GoldDue[] {
  const due: GoldDue[] = [];
  for (const [piece, g] of Object.entries(library.gold?.[problem] ?? {})) {
    const l = over.get(piece as Hash);
    if (l && !l.gold && !g.revealed && windowOpen(l)) due.push({ problem, piece: piece as Hash, name: g.name });
  }
  return due;
}

/** One piece of a run: what the tracker decided on the reveal, or why the reveal was not posted. */
export interface Revealed extends GoldDue {
  outcome: string | null;
  error: string | null;
}

/**
 * The owner's reveals, run with nobody asked: every problem this home holds gold on is read from its tracker, and each
 * piece whose gold is due is revealed in turn, so a square verifies and the coin mints on it without anyone remembering.
 * The away turn runs this every hour and `quilt gold reveal` with no piece runs it once. A reveal the tracker refuses is
 * recorded with its reason and left for the next run; a tracker that does not answer leaves its problem for the next
 * run too. With `post` false the due pieces are listed and nothing is posted.
 */
export async function revealDue(door: Door, post = true): Promise<Revealed[]> {
  const out: Revealed[] = [];
  for (const problem of Object.keys(door.library.gold ?? {}).filter((h) => isHash(h)) as Hash[]) {
    const layer = await door.firstAnswer(door.trackersFor(problem), (t) => door.layerOf(problem, t));
    for (const d of goldDue(door.library, problem, layerByHash(layer))) {
      if (!post) {
        out.push({ ...d, outcome: null, error: null });
        continue;
      }
      try {
        const r = await revealGold(door, problem, d.piece);
        out.push({ ...d, outcome: r.outcome, error: null });
      } catch (e) {
        out.push({ ...d, outcome: null, error: (e as Error).message });
      }
    }
  }
  return out;
}
