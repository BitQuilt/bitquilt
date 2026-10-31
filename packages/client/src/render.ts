/**
 * Text for a model, and lines for the page, from what Quilt read: the map as a strip of marks, the kinds, the stake
 * and the gold, a problem's summary, a piece as it is handed, the accepted returns, the challenges and the panels.
 * Every function here is pure: it takes the state the resolver reduced and what the tracker's layer said, and reads no
 * clock, file or network. AGENTS.md rule 3 holds here: other people's words (a title, a brief, a return, a ground)
 * come out only as quoted text with the signer named, and nothing here tells a model what to do.
 *
 * One convention for what comes back: a string of one or more lines joined by a newline, and the empty string where
 * there is nothing to say, which a caller leaves out.
 */
import { type Address, type Hash, type Pick, type PieceView, type State, agreeFields, canonical, returnsAgree } from '@bitquilt/core';
import { makeLink } from './link.js';
import type { ChallengeListing, GoldCount, KindWords, LayerPiece, Opened, PanelListing } from './listings.js';

/** Each state in the words the legend uses, in the legend's order: the core's ten, then the two the layer adds, then the mark for a kind nobody here implements. */
export const STATE_WORDS: Record<string, string> = {
  open: 'open',
  in_flight: 'in flight',
  sealed: 'sealed',
  needs_verify: 'needs a second production',
  disputed: 'disputed',
  accepted_provisional: 'accepted within the window',
  accepted: 'accepted',
  unreachable: 'unreachable',
  locked: 'locked',
  challenged: 'challenged',
  judging: 'a panel ranking candidates',
  unknown: 'a kind neither this client nor the tracker that answered implements',
};

/** Each state's one-character mark in the strip, in the same order as STATE_WORDS. */
export const STATE_MARK: Record<string, string> = {
  open: '.',
  in_flight: 'i',
  sealed: 's',
  needs_verify: 'v',
  disputed: 'd',
  accepted_provisional: 'p',
  accepted: 'a',
  unreachable: 'u',
  locked: 'l',
  challenged: 'c',
  judging: 'j',
  unknown: '?',
};

/** The legend under a map: each mark and its state in words, from STATE_MARK and STATE_WORDS. */
export function legendText(): string {
  return `Legend: ${Object.entries(STATE_WORDS).map(([state, words]) => `${STATE_MARK[state]} ${words}`).join(', ')}.`;
}

/** A verifier kind in words: how a square of it is earned, how strongly, and that attest is the weakest. */
export function kindWords(verifier: string): KindWords {
  const judge = /^judge:([1-9]\d*)$/.exec(verifier);
  if (judge) return { kind: 'judge', extension: 'QX-2', strength: 'judged', says: `a panel of ${judge[1]} drawn by sortition ranks the candidates and a majority's first choice is accepted`, weakest: false };
  switch (verifier) {
    case 'check':
      return { kind: 'check', extension: null, strength: 'reproduced', says: 'two unrelated runs reproduce the patch', weakest: false };
    case 'score':
      return { kind: 'score', extension: null, strength: 'reproduced', says: 'two unrelated runs score the patch within tolerance', weakest: false };
    case 'agree':
      return { kind: 'agree', extension: null, strength: 'agreed', says: 'two returns from different vendors agree', weakest: false };
    case 'human':
      return { kind: 'human', extension: 'QX-3', strength: 'agreed', says: 'two people at seats a tracker opened for them agree', weakest: false };
    case 'attest':
      return { kind: 'attest', extension: 'QX-10', strength: 'attested', says: 'the actor\'s own signed record is accepted at once and may be challenged for the window; the weakest kind', weakest: true };
    default:
      return { kind: verifier, extension: null, strength: 'unknown', says: 'a kind this client does not implement', weakest: false };
  }
}

/** What a piece waits for after a return, by its kind. */
export function waitsText(verifier: string | undefined): string {
  switch (verifier ? kindWords(verifier).kind : null) {
    case 'check':
    case 'score':
      return 'The patch now waits for two runs by others.';
    case 'agree':
      return 'The piece now waits for a second production from another vendor.';
    case 'human':
      return 'The piece now waits for a second person at a seat to agree.';
    case 'judge':
      return 'The return is a candidate; once the candidates are in, a panel drawn by sortition ranks them.';
    case 'attest':
      return 'The record is accepted at once as the actor\'s own word, marked attested, and may be challenged for the window.';
    default:
      return 'What the piece waits for next is its verifier\'s to say.';
  }
}

/** The name a key chose for itself on the identity log, or the address where it chose none. */
export function nameOf(state: State, address: string): string {
  return state.names.get(address as Address)?.name ?? address;
}

/** The tracker's layer by piece hash, empty where no tracker answered. */
export function layerByHash(layer: LayerPiece[] | null | undefined): Map<Hash, LayerPiece> {
  return new Map((layer ?? []).map((l) => [l.hash, l] as const));
}

/** The map as a strip of marks, one per piece in file order, and the counts; the tracker's states where it answered, the core's otherwise. */
export function mapText(state: State, layer: LayerPiece[] | null = null): string {
  const over = layerByHash(layer);
  const shown = (v: PieceView): string => over.get(v.piece.hash)?.state ?? v.state;
  const strip = state.pieces.map((v) => STATE_MARK[shown(v)] ?? '?').join('');
  const counts: Record<string, number> = {};
  for (const v of state.pieces) counts[shown(v)] = (counts[shown(v)] ?? 0) + 1;
  const parts = Object.entries(counts).map(([k, n]) => `${n} ${k.replace('_', ' ')}`);
  return `${strip}\n${parts.join(', ')}${state.complete ? '; complete' : ''}`;
}

/** The kinds of the problem's pieces and how each earns its square, the weakest said so. */
export function kindsText(state: State): string {
  const counts = new Map<string, number>();
  for (const v of state.pieces) counts.set(v.piece.verifier, (counts.get(v.piece.verifier) ?? 0) + 1);
  return `Kinds: ${[...counts].map(([verifier, n]) => {
    const k = kindWords(verifier);
    return `${n} ${verifier} (${k.strength}: ${k.says})`;
  }).join('; ')}.`;
}

/** The stake the problem asks (QX-15), as the tracker that answered holds it: one line, or nothing where nothing is asked. */
export function stakeText(layer: LayerPiece[] | null): string {
  const staked = (layer ?? []).filter((l) => (l.stake ?? 0) > 0);
  if (staked.length === 0) return '';
  const amounts = [...new Set(staked.map((l) => l.stake!))].sort((a, b) => a - b);
  return `Stake asked (QX-15): ${staked.length} of the pieces ask ${amounts.join(' or ')} of a key's standing, locked before the claim and forfeited if the acceptance is struck.`;
}

/**
 * The owner's gold (QX-16), as the tracker that answered sums it: one line counting the commitments, which name no
 * piece until revealed, or nothing where nothing was committed. Without the sum, what the pieces show once revealed.
 */
export function goldText(layer: LayerPiece[] | null, gold: GoldCount | null = null): string {
  const n = (s: string) => (layer ?? []).filter((l) => l.gold === s).length;
  const g = gold ?? ((layer ?? []).some((l) => l.gold) ? { committed: n('match') + n('miss') + n('overruled'), pending: 0, verified: n('match'), missed: n('miss'), overruled: n('overruled'), lapsed: 0 } : null);
  if (!g || g.committed === 0) return '';
  const parts = [`${g.verified} verified`, `${g.missed} missed`, `${g.pending} awaiting the owner's reveal`];
  if (g.overruled) parts.push(`${g.overruled} overruled by a challenge`);
  if (g.lapsed) parts.push(`${g.lapsed} lapsed unrevealed`);
  return `Gold (QX-16): the owner committed answers for ${g.committed} of the pieces before the work, without saying which; ${parts.join(', ')}.`;
}

/**
 * A problem said whole, as quilt_open answers: the owner's title and statement of done as their quoted words, the
 * count of pieces and versions, the map with its counts, the kinds, the stake and the gold where asked or committed,
 * the legend, who answered, a takedown where the tracker reports one, and the link to pass on. The link names the
 * tracker that answered, or `fallbackTrackers` (the config's) where the answer came from the cache or a mirror.
 */
export function summary(opened: Opened, fallbackTrackers: string[]): string {
  const { hash, state, tracker } = opened;
  const layer = opened.layer ?? null;
  const hidden = opened.hidden ?? null;
  const p = state.envelope.problem;
  const lines = [
    `Problem ${hash}`,
    `The owner, ${nameOf(state, p.owner)}, titled it: "${p.title}"`,
    `and wrote of when it is done: "${p.done_when}"`,
    `${state.pieces.length} pieces, version ${state.chain.length} along prev.`,
    mapText(state, layer),
    kindsText(state),
    stakeText(layer),
    goldText(layer, opened.gold ?? null),
    legendText(),
    tracker ? `Answered by ${tracker}.` : 'Answered from the cache or a mirror.',
    hidden ? `Taken down on ${tracker} by ${hidden.by}: "${hidden.why}" (${hidden.at}). The map above is still what the chain says.` : '',
    `Link: ${makeLink(hash, tracker ? [tracker] : fallbackTrackers, p.slug)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** The piece said as text: its kind and how strongly that kind earns a square, the brief as the author's quoted words, the schema, what it requires, the lease, and the stake where one is asked. */
export function pieceText(hash: Hash, pick: Pick, owner: string, stake = 0): string {
  const k = kindWords(pick.piece.verifier);
  const lines = [
    `Piece ${pick.piece.name} (${pick.piece.hash}) of problem ${hash}, verifier ${pick.piece.verifier}, state ${pick.state.replace('_', ' ')}.`,
    `A square of this kind is ${k.strength}: ${k.says}.`,
    `The author, ${owner}, wrote this brief: "${pick.brief}"`,
    pick.schema ? `A return is an object with these fields: ${canonical(pick.schema.properties)}; required: ${pick.schema.required.join(', ')}; agreement is on: ${pick.agree.join(', ')}.` : `A return is { patch }: a unified diff against ${pick.piece.workspace?.repo ?? 'the workspace'} at ${pick.piece.workspace?.base ?? 'base'}, or the empty string; the check is ${pick.piece.check?.file ?? 'the check file'}.`,
    pick.requires.length ? `It requires: ${pick.requires.join(', ')}.` : 'It requires nothing in particular.',
    `The lease is ${pick.lease_h} hours.`,
    stake > 0 ? `It asks a stake of ${stake} (QX-15): that much of this key's standing is locked behind the claim until the piece's window closes, and forfeited if the acceptance is struck.` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * The accepted returns of a problem as quoted text with the signers named: the core's accepting sets, and on a piece of
 * a kind the core does not implement that the tracker holds as accepted, every return on it, with the kind and its
 * strength beside the name, since which of them the tracker counted is the tracker's word.
 */
export function acceptedText(state: State, layer: LayerPiece[] | null = null): string {
  const over = layerByHash(layer);
  const lines: string[] = [];
  for (const v of state.pieces) {
    if (v.accepting) {
      const verified = over.get(v.piece.hash)?.verified ? ' (verified: the set agreed with the answer the owner committed to before the work)' : '';
      if (v.accepting.kind === 'agree') for (const r of v.accepting.reveals) lines.push(`${v.piece.name}${verified}, ${nameOf(state, r.root)} returned: ${canonical(r.return)}`);
      else lines.push(`${v.piece.name}${verified}, ${nameOf(state, v.accepting.patch.root)} returned a patch of ${(v.accepting.patch.return.patch as string).length} characters, run by ${v.accepting.runs.map((r) => r.root).join(' and ')}`);
      continue;
    }
    const l = over.get(v.piece.hash);
    if (!l || !['accepted', 'accepted_provisional', 'challenged'].includes(l.state) || v.state !== 'unknown') continue;
    const how = l.attested ? 'attested, the actor\'s own word' : `${l.strength ?? 'accepted'} as the tracker holds it`;
    for (const r of v.reveals) lines.push(`${v.piece.name} (${l.verifier}; ${how}), ${nameOf(state, r.root)} returned: ${canonical(r.return)}`);
  }
  return lines.length ? lines.join('\n') : 'Nothing accepted yet.';
}

/**
 * The disputed pieces of a problem, each return on them as quoted text with the signer named, their vendor and model
 * beside the name, and "this key" where the reader signed it; and the agree fields on which the returns differ. A
 * piece is disputed where the tracker holds it so, or, where no tracker answered, where the core does.
 */
export function disputedText(state: State, layer: LayerPiece[] | null = null, me: string | null = null): string {
  const over = layerByHash(layer);
  const mine = (a: string) => me !== null && a.toLowerCase() === me.toLowerCase();
  const blocks: string[] = [];
  for (const v of state.pieces) {
    if ((over.get(v.piece.hash)?.state ?? v.state) !== 'disputed' || v.reveals.length === 0) continue;
    const lines = [`${v.piece.name} is disputed, with ${v.reveals.length} ${v.reveals.length === 1 ? 'return' : 'returns'}.`];
    const schema = v.piece.schema;
    if (schema && v.reveals.length > 1) {
      const differ = agreeFields(schema, v.piece.agree).filter((f) => v.reveals.some((a, i) => v.reveals.slice(i + 1).some((b) => !returnsAgree(schema, [f], a.return, b.return))));
      if (differ.length) lines.push(`The returns differ on ${differ.join(', ')}.`);
    }
    for (const r of v.reveals) {
      const who = `${nameOf(state, r.root)} (${r.by.model})${mine(r.root) || mine(r.key) ? ', this key,' : ''}`;
      lines.push(`${who} returned: ${canonical(r.return)}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.length ? blocks.join('\n\n') : 'No piece is disputed.';
}

/** The challenges said as text: the ground as the challenger's quoted words, the seats, each verdict with the judge named and its return quoted. */
export function challengesText(list: ChallengeListing[], state: State): string {
  if (list.length === 0) return 'No challenge on this problem.';
  const outcome: Record<ChallengeListing['outcome'], string> = {
    open: 'open: the piece is challenged while the panel sits',
    held: 'held: the acceptance was struck and the piece is open again',
    failed: 'failed: the acceptance stands and the stake was lost',
    void: 'void: no panel could decide it and the acceptance stands',
  };
  return list.map((c) => {
    const lines = [
      `Challenge ${c.id} on ${c.name ?? c.piece}, by ${nameOf(state, c.root)} with a stake of ${c.stake}, ${outcome[c.outcome]}.`,
      `${nameOf(state, c.root)} wrote as the ground: "${c.ground}"`,
    ];
    if (c.seats.length === 0) lines.push('No seats drawn yet.');
    for (const s of c.seats) {
      const judge = nameOf(state, s.root);
      if (s.verdict) lines.push(`${judge}, drawn, answered for the ${s.verdict.for}${s.verdict.return ? ` and returned: ${canonical(s.verdict.return)}` : ''}.`);
      else if (s.lapsed_at) lines.push(`${judge}, drawn, let the seat lapse.`);
      else lines.push(`${judge}, drawn, has not answered.`);
    }
    return lines.join('\n');
  }).join('\n\n');
}

/** The panels said as text: each candidate's return quoted, its signer named once the panel has decided and "a candidate" while the judges rank blind, the seats, each rank, the outcome. */
export function panelsText(list: PanelListing[], state: State): string {
  if (list.length === 0) return 'No judge panel on this problem.';
  const outcome: Record<PanelListing['outcome'], string> = {
    open: 'sitting: the candidates are in and the judges drawn are ranking them',
    decided: 'decided: the candidate a majority ranked first is accepted',
    void: 'void: the panel ran out before a majority agreed, and the piece is disputed',
  };
  return list.map((p) => {
    const lines = [`Panel on ${p.name} (${p.verifier ?? 'judge'}, ${p.majority} of ${p.panel} decide), ${outcome[p.outcome]}.`];
    for (const c of p.candidates) lines.push(`${c.root ? nameOf(state, c.root) : 'A candidate'}${c.digest === p.winner ? ', ranked first by the majority,' : ''} returned, as digest ${c.digest}: ${canonical(c.return)}`);
    if (p.seats.length === 0) lines.push('No seats drawn yet.');
    for (const s of p.seats) {
      const judge = nameOf(state, s.root);
      if (s.rank) lines.push(`${judge}, drawn, ranked: ${s.rank.ranking.join(', ')}.`);
      else if (s.lapsed_at) lines.push(`${judge}, drawn, let the seat lapse.`);
      else lines.push(`${judge}, drawn, has not ranked.`);
    }
    return lines.join('\n');
  }).join('\n\n');
}
