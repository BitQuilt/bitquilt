/**
 * The owner's part of a turn, which needs no agent: the gold due revealed (QX-16), the briefs sharpened where a
 * sentence can be asked for (QX-19 section 4), the proposed pieces taken where the owner's default takes them
 * (QX-22 section 4), the owned problems announced again where the work on them moved (QX-13 section 3), and the
 * keeper's loop beside them; and the words each says in the log. A home's away turn runs it before its agent
 * (away.ts), and the hosted on-ramp runs it every hour for the owners whose keys it holds. It takes the Quilt, since
 * each step is the Quilt's own or its resolver's: `revealDue`, `sharpenDue`, `takeDue` and `announceDue`, and the
 * resolver's `keep`.
 */
import type { Revealed } from './gold.js';
import type { Taken } from './propose.js';
import type { Quilt } from './quilt.js';
import type { SentenceAsk } from './render.js';
import type { Sharpened } from './sharpen.js';

/** A message on one line, cut at `max` characters, for a line of the log. */
export const oneLine = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

/**
 * The turn's sharpening in a few words for the log: how many versions were published and how many sentences were asked
 * and not kept; nothing when there was no seam.
 */
export function sharpenText(list: readonly Sharpened[]): string {
  if (list.length === 0) return '';
  const published = list.filter((s) => s.hash && s.posted.length).length;
  const left = list.reduce((n, s) => n + s.sentences.filter((x) => !x.kept).length, 0);
  const refused = list.reduce((n, s) => n + s.refused.length, 0);
  return `sharpened: ${published} published${left ? `, ${left} sentence${left === 1 ? '' : 's'} not kept` : ''}${refused ? `, ${refused} refused` : ''}`;
}

/**
 * The turn's takes in a few words for the log (QX-22 section 4): how many proposed pieces went into a version a
 * tracker took, and how many refusals there were; nothing when no piece was taken and nothing was refused.
 */
export function takenText(list: readonly Taken[]): string {
  if (list.length === 0) return '';
  const pieces = list.reduce((n, t) => n + t.pieces.filter((p) => p.taken).length, 0);
  const refused = list.reduce((n, t) => n + t.refused.length, 0);
  return `taken: ${pieces} proposed piece${pieces === 1 ? '' : 's'}${refused ? `, ${refused} refused` : ''}`;
}

/**
 * The turn's reveals in a few words for the log: how many were posted, what the tracker decided, and how many it
 * refused; nothing when there were none.
 */
export function revealedText(gold: readonly Revealed[]): string {
  if (gold.length === 0) return '';
  const posted = gold.filter((g) => !g.error);
  const count = (outcome: string) => posted.filter((g) => g.outcome === outcome).length;
  const undecided = posted.length - count('match') - count('miss');
  const parts = [
    count('match') ? `${count('match')} match` : '',
    count('miss') ? `${count('miss')} miss` : '',
    undecided ? `${undecided} undecided` : '',
  ].filter(Boolean);
  const refused = gold.length - posted.length;
  return `gold: ${posted.length} revealed${parts.length ? ` (${parts.join(', ')})` : ''}${refused ? `, ${refused} refused` : ''}`;
}

/**
 * What the owner's part of a turn did: the gold revealed, the briefs sharpened, the proposed pieces taken, the
 * problems announced again, and all four in a few words for a log line, or nothing when there was nothing to do; and
 * what the keeper's loop did beside it, the queue it sent included, which is the node's and not the owner's, so it is
 * not in `said`.
 */
export interface OwnerTurn {
  gold: Revealed[];
  sharpened: Sharpened[];
  taken: Taken[];
  announced: string[];
  said: string;
  kept: { added: number; reads: number; sent: number };
}

/**
 * The owner's part of a turn, which needs no agent beside it: the gold due revealed (QX-16, gold.ts), the briefs
 * sharpened where two readings read them apart (QX-19 section 4), the sentence from `ask`, or nothing sharpened where
 * there is no way to ask, and the proposed pieces the owner's default takes, taken into a version (QX-22 section 4),
 * which asks nothing of anyone. The take comes after the sharpening, so it reads the version the sharpening left. A
 * step that fails is written to the log and the turn goes on. A home's node runs it before its agent, and the hosted
 * on-ramp runs it for the owners whose keys it holds.
 */
export async function ownerTurn(
  quilt: Quilt,
  ask: ((q: SentenceAsk) => Promise<string | null>) | null,
  log: (line: string) => void,
  now: () => Date = () => new Date(),
): Promise<OwnerTurn> {
  let gold: Revealed[] = [];
  let sharpened: Sharpened[] = [];
  try {
    gold = await quilt.revealDue();
  } catch (e) {
    log(`${now().toISOString()} gold: not run (${oneLine((e as Error).message, 200)})`);
  }
  if (ask) {
    try {
      sharpened = await quilt.sharpenDue(ask, now().toISOString());
    } catch (e) {
      log(`${now().toISOString()} sharpen: not run (${oneLine((e as Error).message, 200)})`);
    }
  }
  // QX-22 section 4: the proposed pieces that wait on a problem this key owns, taken where the default takes them.
  let taken: Taken[] = [];
  try {
    taken = await quilt.takeDue(now().toISOString());
  } catch (e) {
    log(`${now().toISOString()} take: not run (${oneLine((e as Error).message, 200)})`);
  }
  // QX-13 section 3: the problems this key owns announced again where the work on them moved.
  let announced: string[] = [];
  try {
    announced = await quilt.announceDue();
  } catch (e) {
    log(`${now().toISOString()} announce: not run (${oneLine((e as Error).message, 200)})`);
  }
  // The keeper's loop (NODE.md section 4): what waited in the queue sent, and what this node holds kept whole and
  // current, once an hour with the turn; its own line in the log where it did anything.
  let kept = { added: 0, reads: 0, sent: 0 };
  try {
    const k = await quilt.resolver.keep();
    kept = { added: k.added, reads: k.reads, sent: k.sent };
    if (k.added || k.reads || k.sent || k.refused.length)
      log(
        `${now().toISOString()} kept: ${k.added} lines, ${k.reads} reads${k.sent ? `, ${k.sent} sent from the queue` : ''}${k.refused.length ? `; ${k.refused.length} chain${k.refused.length === 1 ? '' : 's'} not kept` : ''}`,
      );
  } catch (e) {
    log(`${now().toISOString()} keep: not run (${oneLine((e as Error).message, 200)})`);
  }
  return {
    gold,
    sharpened,
    taken,
    announced,
    said: [
      revealedText(gold),
      sharpenText(sharpened),
      takenText(taken),
      announced.length ? `announced: ${announced.length}` : '',
    ]
      .filter(Boolean)
      .join('; '),
    kept,
  };
}
