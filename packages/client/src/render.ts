/**
 * Text for a model, and lines for the page, from what Quilt read: the map as a strip of marks, the kinds, the stake
 * and the gold, a problem's summary, a piece as it is handed, the accepted returns, the challenges, the panels and the
 * pieces proposed.
 * Every function here is pure: it takes the state the resolver reduced and what the tracker's layer said, and reads no
 * clock, file or network. AGENTS.md rule 3 holds here: other people's words (a title, a brief, a return, a ground,
 * a client's name for itself) come out only as quoted text with the signer named, and nothing here tells a model what
 * to do.
 *
 * One convention for what comes back: a string of one or more lines joined by a newline, and the empty string where
 * there is nothing to say, which a caller leaves out.
 */
import {
  type Address,
  type Hash,
  type Pick,
  type PieceView,
  type Receipt,
  type State,
  agreeFields,
  canonical,
  isSlug,
  returnsAgree,
  textIssues,
} from '@bitquilt/core';
import { makeLink } from './link.js';
import {
  ACCEPTED_STATES,
  type ChallengeListing,
  type GoldCount,
  type KindWords,
  type LayerPiece,
  type Opened,
  type PanelListing,
  type ProposalListing,
  type Seam,
  type SeamSide,
  type Witness,
} from './listings.js';
import type { Posted } from './resolver.js';

/**
 * Each state in the words the legend uses, in the legend's order: the core's ten, then the two the layer adds, then the
 * mark for a kind nobody here implements.
 */
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
  recording: 'readings being recorded',
  recorded: 'recorded, every reading standing',
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
  recording: 'r',
  recorded: 'R',
  unknown: '?',
};

/** The legend under a map: each mark and its state in words, from STATE_MARK and STATE_WORDS. */
export function legendText(): string {
  return `Legend: ${Object.entries(STATE_WORDS)
    .map(([state, words]) => `${STATE_MARK[state]} ${words}`)
    .join(', ')}.`;
}

/** A verifier kind in words: how a square of it is earned, how strongly, and that attest is the weakest. */
export function kindWords(verifier: string): KindWords {
  const judge = /^judge:([1-9]\d*)$/.exec(verifier);
  if (judge)
    return {
      kind: 'judge',
      extension: 'QX-2',
      strength: 'judged',
      says: `a panel of ${judge[1]} drawn by sortition ranks the candidates and a majority's first choice is accepted`,
      weakest: false,
    };
  const record = /^record:([2-9]|[1-9]\d{1,2})$/.exec(verifier);
  if (record)
    return {
      kind: 'record',
      extension: 'QX-20',
      strength: 'recorded',
      says: `${record[1]} readings from roots unrelated to the owner and to each other are kept as given; none is accepted and none struck`,
      weakest: false,
    };
  switch (verifier) {
    case 'check':
      return {
        kind: 'check',
        extension: null,
        strength: 'reproduced',
        says: 'two unrelated runs reproduce the patch',
        weakest: false,
      };
    case 'score':
      return {
        kind: 'score',
        extension: null,
        strength: 'reproduced',
        says: 'two unrelated runs score the patch within tolerance',
        weakest: false,
      };
    case 'agree':
      return {
        kind: 'agree',
        extension: null,
        strength: 'agreed',
        says: 'two returns from different vendors agree',
        weakest: false,
      };
    case 'human':
      return {
        kind: 'human',
        extension: 'QX-3',
        strength: 'agreed',
        says: 'two people at seats a tracker opened for them agree',
        weakest: false,
      };
    case 'attest':
      return {
        kind: 'attest',
        extension: 'QX-10',
        strength: 'attested',
        says: "the actor's own signed record is accepted at once and may be challenged for the window; the weakest kind",
        weakest: true,
      };
    default:
      return {
        kind: verifier,
        extension: null,
        strength: 'unknown',
        says: 'a kind this client does not implement',
        weakest: false,
      };
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
      return "The record is accepted at once as the actor's own word, marked attested, and may be challenged for the window.";
    case 'record':
      return 'The reading stands as given. The piece is recorded once the readings it asks for are in, each from a root unrelated to the owner and to the other readers; nothing is accepted and nothing struck.';
    default:
      return "What the piece waits for next is its verifier's to say.";
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

/**
 * The map as a strip of marks, one per piece in file order, and the counts; the tracker's states where it answered, the
 * core's otherwise.
 */
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
  return `Kinds: ${[...counts]
    .map(([verifier, n]) => {
      const k = kindWords(verifier);
      return `${n} ${verifier} (${k.strength}: ${k.says})`;
    })
    .join('; ')}.`;
}

/**
 * The stake the problem asks (QX-15), as the tracker that answered holds it: one line, or nothing where nothing is
 * asked.
 */
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
  const g =
    gold ??
    ((layer ?? []).some((l) => l.gold)
      ? {
          committed: n('match') + n('miss') + n('overruled'),
          pending: 0,
          verified: n('match'),
          missed: n('miss'),
          overruled: n('overruled'),
          lapsed: 0,
        }
      : null);
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
    hidden
      ? `Taken down on ${tracker} by ${hidden.by}: "${hidden.why}" (${hidden.at}). The map above is still what the chain says.`
      : '',
    `Link: ${makeLink(hash, tracker ? [tracker] : fallbackTrackers, p.slug)}`,
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * The piece said as text: its kind and how strongly that kind earns a square, the brief as the author's quoted words,
 * the schema, what it requires, the lease, and the stake where one is asked.
 */
export function pieceText(hash: Hash, pick: Pick, owner: string, stake = 0): string {
  const k = kindWords(pick.piece.verifier);
  const lines = [
    `Piece ${pick.piece.name} (${pick.piece.hash}) of problem ${hash}, verifier ${pick.piece.verifier}, state ${pick.state.replace('_', ' ')}.`,
    `A square of this kind is ${k.strength}: ${k.says}.`,
    `The author, ${owner}, wrote this brief: "${pick.brief}"`,
    pick.schema
      ? `A return is an object with these fields: ${canonical(pick.schema.properties)}; required: ${pick.schema.required.join(', ')}; agreement is on: ${pick.agree.join(', ')}.`
      : `A return is { patch }: a unified diff against ${pick.piece.workspace?.repo ?? 'the workspace'} at ${pick.piece.workspace?.base ?? 'base'}, or the empty string; the check is ${pick.piece.check?.file ?? 'the check file'}.`,
    pick.requires.length ? `It requires: ${pick.requires.join(', ')}.` : 'It requires nothing in particular.',
    `The lease is ${pick.lease_h} hours.`,
    stake > 0
      ? `It asks a stake of ${stake} (QX-15): that much of this key's standing is locked behind the claim until the piece's window closes, and forfeited if the acceptance is struck.`
      : '',
  ];
  return lines.filter(Boolean).join('\n');
}

/**
 * QX-18: a witness is a product's host name in lower case, or `other`, as the tracker's door holds it in witness.ts.
 */
const WITNESS_VIA = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

/** Where a reveal's witness is kept in the map `witnessesOf` makes: the piece and the key that revealed. */
export const witnessKey = (piece: string, key: string): string => `${piece}:${key.toLowerCase()}`;

/**
 * QX-18: the witness on each reveal, by piece and key, as the receipts' wrappers carry it: the first wrapper that names
 * one, kept where the mark is a host name or `other` and the client's name is short plain text. A mark of any other
 * shape is left out, and so is a name that is not plain text.
 */
export function witnessesOf(receipts: Receipt[]): Map<string, Witness> {
  const out = new Map<string, Witness>();
  for (const r of receipts) {
    if (r.event.type !== 'reveal' || !r.event.piece) continue;
    const w = r.received.find((x) => typeof (x as { via?: unknown }).via === 'string') as
      | { via: string; via_by?: unknown; via_client?: unknown }
      | undefined;
    if (!w || w.via.length > 64 || !WITNESS_VIA.test(w.via)) continue;
    const name =
      w.via === 'other' &&
      typeof w.via_client === 'string' &&
      w.via_client.length <= 80 &&
      textIssues(w.via_client).length === 0
        ? w.via_client
        : null;
    const by = w.via !== 'other' && (w.via_by === 'address' || w.via_by === 'key') ? w.via_by : null;
    out.set(witnessKey(r.event.piece, r.event.key), { via: w.via, client: name, by });
  }
  return out;
}

/**
 * A witness in words after a signer's name: "witnessed by claude.ai" for a product, the client's own name quoted for
 * another, the empty string where none.
 */
export function witnessWords(w: Witness | null | undefined): string {
  if (!w) return '';
  if (w.via !== 'other') return `witnessed by ${w.via}`;
  return w.client ? `through a client that calls itself "${w.client}"` : 'through a client that gave no name';
}

/**
 * QX-18 for `quilt_me`: the witness this session's token carries, as the tracker writes it on each event it posts for
 * the key.
 */
export function sessionWitnessText(w: Witness): string {
  if (w.via !== 'other') {
    const bound =
      w.by === 'key'
        ? `, and the token request was signed with the key ${w.via} publishes`
        : w.by === 'address'
          ? `, and the token request came from the addresses ${w.via} publishes for its servers`
          : '';
    return `Witnessed by ${w.via}: this session's token came through ${w.via}'s OAuth callback${bound}, so the tracker writes via: ${w.via} beside custody: hosted on each event it posts for this key (QX-18). It says ${w.via} made the calls, not who wrote the answer, and it is the tracker's word.`;
  }
  return `Witness: none. This session's token came through a client that is no product the tracker knows${w.client ? `, which calls itself "${w.client}"` : ''}, so the tracker writes via: other beside custody: hosted on each event it posts for this key (QX-18).`;
}

/**
 * The accepted returns of a problem as quoted text with the signers named: the core's accepting sets, and on a piece of
 * a kind the core does not implement that the tracker holds as accepted, every return on it, with the kind and its
 * strength beside the name, since which of them the tracker counted is the tracker's word. Where a return's receipt
 * names a witness (QX-18), it is beside the name, and one line under the list says what a witness is.
 */
export function acceptedText(
  state: State,
  layer: LayerPiece[] | null = null,
  witnessed: Map<string, Witness> = new Map(),
): string {
  const over = layerByHash(layer);
  const lines: string[] = [];
  let anyWitness = false;
  let anyTraced = false;
  const who = (piece: Hash, key: string, root: string): string => {
    const w = witnessed.get(witnessKey(piece, key));
    if (w) anyWitness = true;
    return w ? `${nameOf(state, root)} (${witnessWords(w)})` : nameOf(state, root);
  };
  for (const v of state.pieces) {
    if (v.accepting) {
      const l = over.get(v.piece.hash);
      const verified = l?.verified
        ? ' (verified: the set agreed with the answer the owner committed to before the work)'
        : '';
      const rests = tracedWords(l?.traced);
      if (rests) anyTraced = true;
      if (v.accepting.kind === 'agree')
        for (const r of v.accepting.reveals)
          lines.push(
            `${v.piece.name}${verified}${rests}, ${who(v.piece.hash, r.key, r.root)} returned: ${canonical(r.return)}`,
          );
      else
        lines.push(
          `${v.piece.name}${verified}, ${who(v.piece.hash, v.accepting.patch.key, v.accepting.patch.root)} returned a patch of ${(v.accepting.patch.return.patch as string).length} characters, run by ${v.accepting.runs.map((r) => r.root).join(' and ')}`,
        );
      continue;
    }
    const l = over.get(v.piece.hash);
    if (!l || !['accepted', 'accepted_provisional', 'challenged'].includes(l.state) || v.state !== 'unknown') continue;
    const how = l.attested ? "attested, the actor's own word" : `${l.strength ?? 'accepted'} as the tracker holds it`;
    for (const r of v.reveals)
      lines.push(
        `${v.piece.name} (${l.verifier}; ${how}), ${who(v.piece.hash, r.key, r.root)} returned: ${canonical(r.return)}`,
      );
  }
  if (anyWitness)
    lines.push(
      "A witness is the tracker's word (QX-18): its hosted on-ramp saw the token behind that return come through the product's OAuth callback. It says the product made the calls, not who wrote the answer.",
    );
  if (anyTraced)
    lines.push(
      "A kept read is what a return rests on (QX-19): a page's text under its hash and the span of it a field stands on, which anyone can fetch from the tracker and compare with the page.",
    );
  return lines.length ? lines.join('\n') : 'Nothing accepted yet.';
}

/** QX-19: the grade of an accepted square in a few words, or nothing where the tracker gave none. */
export function tracedWords(traced: LayerPiece['traced']): string {
  return traced === 'both'
    ? ' (rests on kept reads on both sides)'
    : traced === 'one'
      ? ' (rests on kept reads on one side)'
      : traced === 'none'
        ? ' (rests on no kept read)'
        : '';
}

const SEAM_WHY: Record<Seam['why'], string> = {
  source: 'the two rest on different reads',
  span: 'the same read, at different places',
  reading: 'the same words, read two ways',
  unknown: 'one side rests on nothing kept',
};

/**
 * One side of a seam as words: who, and the passage quoted where it passes the plain-text gate, else where to fetch it.
 */
function sideWords(x: SeamSide, name: (key: string) => string): string {
  const who = x.name ?? name(x.key);
  if (!x.read || !x.span)
    return `${who} rests it on nothing kept${x.aside ? ', and that reading is set aside until it does' : ''}`;
  const where = `${x.read.url} (${x.read.hash}, bytes ${x.span[0]} to ${x.span[1]})`;
  if (x.passage === null) return `${who} rests it on ${where}`;
  return textIssues(x.passage).length
    ? `${who} rests it on a passage of ${x.span[1] - x.span[0]} bytes at ${where}, which does not pass the plain-text gate and is not shown here`
    : `${who} rests it on "${x.passage}" at ${where}`;
}

/**
 * QX-19: the seams of a disputed piece, one line each: the field, why the two readings differ, and what each side rests
 * on, quoted with its signer named.
 */
export function seamsText(seams: readonly Seam[], name: (key: string) => string): string[] {
  return seams.map(
    (s) => `On ${s.field}, ${SEAM_WHY[s.why]}: ${sideWords(s.sides[0], name)}; ${sideWords(s.sides[1], name)}.`,
  );
}

/**
 * QX-20: the record pieces of a problem, each with its grade and every reading on it as the quoted words of the key
 * that signed it, with the signer named; a reading that does not stand says why; and the seams between the standing
 * readings, one line each. Empty where the problem has no record piece.
 */
export function recordedText(state: State, layer: LayerPiece[] | null = null): string {
  const over = layerByHash(layer);
  const lines: string[] = [];
  const name = (k: string) => nameOf(state, k);
  for (const v of state.pieces) {
    const l = over.get(v.piece.hash);
    const g = l?.record;
    if (!g) continue;
    const keys = new Set(g.keys.map((k) => k.toLowerCase()));
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
    lines.push(
      `${v.piece.name} (${v.piece.verifier}; ${l!.state === 'recorded' ? 'recorded' : 'recording'}: ${g.standing} of ${g.wanted} readings, ${g.grounded} resting on kept reads, from ${plural(g.roots, 'root')} and ${plural(g.vendors, 'vendor')})`,
    );
    for (const r of v.reveals)
      lines.push(
        `  ${name(r.root)}${keys.has(r.key.toLowerCase()) ? '' : ' (not counted: related to the owner or to an earlier reader)'} returned: ${canonical(r.return)}`,
      );
    for (const s of seamsText(l!.seams ?? [], name)) lines.push(`  ${s}`);
  }
  return lines.join('\n');
}

/**
 * QX-19 section 4: a seam the owner's node puts to its agent for the sentence the brief lacks. `grounded` says both
 * readings rest on the record; false, neither does, and the dispute has stood a lease with nothing to prefer.
 */
export interface SentenceAsk {
  family: string;
  brief: string;
  field: string;
  seam: Seam;
  piece: string;
  grounded: boolean;
}

/**
 * What the owner's node asks for: fixed text around the seam's own words, each side's passage quoted with its signer
 * named where there is one, and the one sentence wanted back. Two grounded readings want the sentence that decides
 * between them; two that rest on nothing want the sentence that says which record governs and where it is read.
 */
export function sentenceAsk(q: SentenceAsk): string {
  const rested = (s: SeamSide) =>
    `${s.key} answered ${canonical(s.value)} and rested it on ${s.passage !== null && textIssues(s.passage).length === 0 ? `"${s.passage}"` : `a passage of ${s.span ? s.span[1] - s.span[0] : 0} bytes`}${s.read ? ` at ${s.read.url}` : ''}`;
  const bare = (s: SeamSide) => `${s.key} answered ${canonical(s.value)}`;
  const [one, two] = q.seam.sides;
  return [
    `A brief reads: "${q.brief}"`,
    q.grounded
      ? `On piece ${q.piece}, two readers rested the field ${q.field} on the record and answered differently, ${SEAM_WHY[q.seam.why]}: ${rested(one)}; ${rested(two)}.`
      : `On piece ${q.piece}, two readers answered the field ${q.field} differently and neither rested it on the record: ${bare(one)}; ${bare(two)}.`,
    q.grounded
      ? 'Write the one sentence the brief lacks, to be added at its end for every piece of the family, that decides between these two readings: which record governs, or which category the passage falls under. Plain text under 400 characters, with no address and no markup. Answer with the sentence alone.'
      : 'Write the one sentence the brief lacks, to be added at its end for every piece of the family, that says which record governs and where it is read, so the next reader rests on it. Plain text under 400 characters, with no address and no markup. Answer with the sentence alone.',
  ].join('\n\n');
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
    const l = over.get(v.piece.hash);
    const layered = l?.state ?? v.state;
    if ((layered !== 'disputed' && v.state !== 'disputed') || v.reveals.length === 0) continue;
    const returns = `${v.reveals.length} ${v.reveals.length === 1 ? 'return' : 'returns'}`;
    // QX-19 section 4: the tracker may have set one reading aside, so the core's dispute stands while the tracker calls
    // the piece something else.
    const lines = [
      layered === 'disputed'
        ? `${v.piece.name} is disputed, with ${returns}.`
        : `${v.piece.name} is disputed in the core's fold, with ${returns}; the tracker set one reading aside and calls it ${String(layered).replace('_', ' ')}.`,
    ];
    const schema = v.piece.schema;
    if (schema && v.reveals.length > 1) {
      const differ = agreeFields(schema, v.piece.agree).filter((f) =>
        v.reveals.some((a, i) => v.reveals.slice(i + 1).some((b) => !returnsAgree(schema, [f], a.return, b.return))),
      );
      if (differ.length) lines.push(`The returns differ on ${differ.join(', ')}.`);
    }
    // QX-19: why they differ, from what each rests on, as the tracker read the traces.
    lines.push(...seamsText(over.get(v.piece.hash)?.seams ?? [], (k) => nameOf(state, k)));
    for (const r of v.reveals) {
      const who = `${nameOf(state, r.root)} (${r.by.model})${mine(r.root) || mine(r.key) ? ', this key,' : ''}`;
      lines.push(`${who} returned: ${canonical(r.return)}`);
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.length ? blocks.join('\n\n') : 'No piece is disputed.';
}

/**
 * The challenges said as text: the ground as the challenger's quoted words, the seats, each verdict with the judge
 * named and its return quoted.
 */
export function challengesText(list: ChallengeListing[], state: State): string {
  if (list.length === 0) return 'No challenge on this problem.';
  const outcome: Record<ChallengeListing['outcome'], string> = {
    open: 'open: the piece is challenged while the panel sits',
    held: 'held: the acceptance was struck and the piece is open again',
    failed: 'failed: the acceptance stands and the stake was lost',
    void: 'void: no panel could decide it and the acceptance stands',
  };
  return list
    .map((c) => {
      const lines = [
        `Challenge ${c.id} on ${c.name ?? c.piece}, by ${nameOf(state, c.root)} with a stake of ${c.stake}, ${outcome[c.outcome]}.`,
        `${nameOf(state, c.root)} wrote as the ground: "${c.ground}"`,
      ];
      if (c.seats.length === 0) lines.push('No seats drawn yet.');
      for (const s of c.seats) {
        const judge = nameOf(state, s.root);
        if (s.verdict)
          lines.push(
            `${judge}, drawn, answered for the ${s.verdict.for}${s.verdict.return ? ` and returned: ${canonical(s.verdict.return)}` : ''}.`,
          );
        else if (s.lapsed_at) lines.push(`${judge}, drawn, let the seat lapse.`);
        else lines.push(`${judge}, drawn, has not answered.`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * The panels said as text: each candidate's return quoted, its signer named once the panel has decided and "a
 * candidate" while the judges rank blind, the seats, each rank, the outcome.
 */
export function panelsText(list: PanelListing[], state: State): string {
  if (list.length === 0) return 'No judge panel on this problem.';
  const outcome: Record<PanelListing['outcome'], string> = {
    open: 'sitting: the candidates are in and the judges drawn are ranking them',
    decided: 'decided: the candidate a majority ranked first is accepted',
    void: 'void: the panel ran out before a majority agreed, and the piece is disputed',
  };
  return list
    .map((p) => {
      const lines = [
        `Panel on ${p.name} (${p.verifier ?? 'judge'}, ${p.majority} of ${p.panel} decide), ${outcome[p.outcome]}.`,
      ];
      for (const c of p.candidates)
        lines.push(
          `${c.root ? nameOf(state, c.root) : 'A candidate'}${c.digest === p.winner ? ', ranked first by the majority,' : ''} returned, as digest ${c.digest}: ${canonical(c.return)}`,
        );
      if (p.seats.length === 0) lines.push('No seats drawn yet.');
      for (const s of p.seats) {
        const judge = nameOf(state, s.root);
        if (s.rank) lines.push(`${judge}, drawn, ranked: ${s.rank.ranking.join(', ')}.`);
        else if (s.lapsed_at) lines.push(`${judge}, drawn, let the seat lapse.`);
        else lines.push(`${judge}, drawn, has not ranked.`);
      }
      return lines.join('\n');
    })
    .join('\n\n');
}

/**
 * QX-22: the pieces proposed beside a problem said as text, in receipt order. Each has the name and the hash it was
 * proposed under, its proposer named and whether that root's work stands on the problem, the version that took it or
 * that it waits, and the forks that hold it; then the reason and the brief as the proposer's quoted words, and how
 * strongly a square of its kind is earned. A name that is not a slug, and a text that does not pass the plain-text
 * gate, is not shown. Empty where nothing is proposed.
 */
export function proposedText(list: ProposalListing[], state: State): string {
  return list
    .map((p) => {
      const who = nameOf(state, p.root);
      const k = kindWords(p.piece.verifier);
      const quoted = (text: string, lead: string, what: string): string =>
        textIssues(text).length
          ? `${who} wrote ${what} of ${text.length} characters, which does not pass the plain-text gate and is not shown here.`
          : `${who} wrote ${lead}: "${text}"`;
      const name = isSlug(p.name) ? `the name "${p.name}"` : 'a name that is not a slug and is not shown here';
      const work = p.worked ? 'whose work stands on this problem' : 'with no work standing on this problem';
      const where = p.taken ? `was taken into version ${p.taken}` : 'waits: no version of the problem holds it';
      const forks = p.pursued.length;
      return [
        `A piece proposed under ${name} (${p.hash}) by ${who}, ${work}, ${where}.`,
        quoted(p.why, 'as the reason', 'a reason'),
        quoted(p.piece.brief, 'this brief', 'a brief'),
        k.strength === 'unknown'
          ? `Its verifier is ${k.says}.`
          : `Its verifier is ${p.piece.verifier}; a square of this kind is ${k.strength}: ${k.says}.`,
        ...(forks
          ? [`It is pursued in ${forks} fork${forks === 1 ? '' : 's'} of this problem: ${p.pursued.join(', ')}.`]
          : []),
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * What a problem's accepted squares found: for each agreed field whose schema is a list of choices, how many accepted
 * squares agreed on each choice.
 */
export type FoundCounts = Record<string, Record<string, number>>;

/**
 * The same count the tracker's row carries, from the fold this client reduced and the layer's states where a tracker
 * answered.
 */
export function foundIn(state: State, layer: LayerPiece[] | null): FoundCounts {
  const byHash = new Map((layer ?? []).map((l) => [l.hash, l.state as string]));
  const out: FoundCounts = Object.create(null);
  for (const v of state.pieces) {
    const s = byHash.get(v.piece.hash) ?? v.state;
    if (!ACCEPTED_STATES.includes(s) || v.accepting?.kind !== 'agree') continue;
    for (const field of v.piece.agree ?? []) {
      const choices = (v.piece.schema?.properties?.[field] as { enum?: unknown[] } | undefined)?.enum;
      const value = (v.accepting.reveals[0].return as Record<string, unknown>)[field];
      if (!Array.isArray(choices) || typeof value !== 'string' || !choices.includes(value)) continue;
      const by = (out[field] ??= Object.create(null) as Record<string, number>);
      by[value] = (by[value] ?? 0) + 1;
    }
  }
  return out;
}

/**
 * What the accepted squares found, in words: each field and its choices, the choices quoted as the owner's own words
 * and each with its count, most first. A count, and nothing about chance; empty where nothing is found, and a choice
 * or a field that fails the plain-text gate is left out.
 */
export function foundText(found: FoundCounts | null | undefined): string {
  if (!found || typeof found !== 'object') return '';
  const parts = Object.entries(found).flatMap(([field, by]) => {
    if (textIssues(field).length || !by || typeof by !== 'object') return [];
    const values = Object.entries(by)
      .filter(([v, n]) => Number.isInteger(n) && n > 0 && textIssues(v).length === 0)
      .sort((a, b) => b[1] - a[1]);
    return values.length ? [`${field}: ${values.map(([v, n]) => `${n} "${v}"`).join(', ')}`] : [];
  });
  return parts.length ? `the accepted squares agreed on ${parts.join('; ')}` : '';
}

/**
 * A piece handed over, as JSON for a program that works it (`quilt next --json`, the page's `/api/next`): the problem
 * and the piece, its state, its kind and how strongly that kind earns a square, the brief, the schema, the fields that
 * agree, what it requires, the lease, where the claim went and what was locked, and the seams of a piece whose two
 * readings differ, each a line with every side's passage quoted and its signer named, as quilt_next says them.
 */
export function handedJson(
  h: {
    hash: Hash;
    pick: Pick;
    posted: Posted;
    owner: string;
    stake: number;
    lock: 'standing' | 'coin' | null;
    seams: readonly Seam[];
  },
  name: (key: string) => string = (k) => k,
) {
  const p = h.pick;
  return {
    problem: h.hash,
    piece: p.piece.hash,
    name: p.piece.name,
    state: p.state,
    verifier: p.piece.verifier,
    kind: kindWords(p.piece.verifier),
    brief: p.brief,
    owner: h.owner,
    schema: p.schema ?? null,
    agree: p.agree,
    requires: p.requires,
    lease_h: p.lease_h,
    posted: h.posted,
    stake: h.stake,
    lock: h.lock,
    seams: seamsText(h.seams, name),
  };
}
