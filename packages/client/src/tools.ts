/**
 * The tools' work in one place, with no MCP and no HTTP in it: each takes the Quilt that signs and the tool's input,
 * and answers with the text a model reads and the handles a card uses. The MCP server registers these under their
 * schemas, and the node serves them at /api/tool/<name>, so a second copy of quilt on the same home (Claude Desktop's,
 * say) works through the one holding the page instead of signing and writing the library beside it. Other people's
 * words come out of here only as quoted text with the signer named.
 */
import type { Address, DeclineReason, Hash } from '@bitquilt/core';
import { HOW_QUILT_WORKS } from './about.js';
import type { CoinBalance } from './coin.js';
import type { Side } from './listings.js';
import type { Pattern, Quilt, SearchResult, Standing } from './quilt.js';
import { foundIn, foundText, kindWords, recordedText, seamsText, sessionWitnessText } from './render.js';
import type { Posted } from './resolver.js';
import { type RestAsked, traceText } from './trace.js';
import { windowAnswer } from './window.js';

export interface ToolResult {
  text: string;
  handles: Record<string, unknown>;
}

export type ToolInput = Record<string, unknown>;

/**
 * Runs one tool by name for the host that asked (the client's name at connection, which the model declared follows).
 */
export type ToolRunner = (name: ToolName, input: ToolInput, host: string | undefined) => Promise<ToolResult>;

/**
 * Every tool's name, in the order the connector registers them (mcp.ts), which is the order a host lists them in. The
 * bundle's manifest (scripts/build-mcpb.mjs) and the tests' list keep the same order, and the tests hold all of them to
 * it.
 */
export const TOOL_NAMES = [
  'quilt_me',
  'quilt_open',
  'quilt_search',
  'quilt_window',
  'quilt_window_io',
  'quilt_next',
  'quilt_return',
  'quilt_decline',
  'quilt_read',
  'quilt_rank',
  'quilt_challenge',
  'quilt_verdict',
  'quilt_seed',
  'quilt_publish',
  'quilt_pay',
  'quilt_transfer',
  'quilt_redeem',
  'quilt_reveal_gold',
  'quilt_name',
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export function isToolName(s: string): s is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(s);
}

const where = (x: Posted) => (x.queued ? 'queued' : `posted to ${x.at}`);

/** Where a write on the coin log went (QX-17): the words for one still in the queue, else the coin's home. */
const onCoinLog = (x: Posted & { home: string }, waits: string): string =>
  x.queued ? waits : `posted to the coin log at ${x.home}`;

/** A count and its noun, plural unless the count is one. */
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/** One of quilt_read's sections: its heading, then its lines. */
const section = (heading: string, body: string): string => `${heading}:\n${body}`;

/**
 * quilt_me's standing (QX-1, QX-15): how much and how it came, what is locked and free and at which tracker, then the
 * locks behind it. Its clauses are joined by "; " and the locks by ", ".
 */
function standingText(s: Standing): string {
  const how = s.founding
    ? `of which ${s.founding} was declared at the founding and the rest earned by work, not for sale`
    : 'earned by work and not for sale';
  const locks = s.locks.map((l) => `${l.amount} on ${l.piece} of ${l.problem}`);
  return [
    `Standing: ${s.standing}, ${how} (locked ${s.locked}, free to stake ${s.free}) at ${s.tracker}`,
    ...(locks.length ? [`locks: ${locks.join(', ')}`] : []),
  ].join('; ');
}

/**
 * quilt_me's coin (QX-17): the balance with its parts and where it is kept, then what the squares verified today owe.
 * Its clauses are joined by "; " and the parts by ", ".
 */
function coinText(c: CoinBalance): string {
  const parts = [
    `transferable now ${c.free_vested}`,
    `still vesting ${c.unvested}`,
    `locked ${c.locked}`,
    `escrowed ${c.escrowed}`,
    `free to stake or pay ${c.free}`,
  ];
  const owed = c.pending && c.pending.amount > 0 ? c.pending : null;
  return [
    `Coin (QX-17): ${c.balance} units (${parts.join(', ')}) at ${c.home}`,
    ...(owed ? [`owed from the squares verified so far today: ${owed.amount} units, paid at ${owed.pays_at}`] : []),
  ].join('; ');
}

/**
 * The work on a tracker's row, as quilt_search says it: the counts, how the accepted squares rest, who read, and when
 * it was last worked. The counts are one clause joined by ", ", and the clauses are joined by "; ".
 */
function workText(w: NonNullable<SearchResult['work']>): string {
  const counts = [
    `${w.returned} returned`,
    `${w.accepted} accepted`,
    ...(w.verified ? [`${w.verified} of them verified by the owner's gold`] : []),
    ...(w.disputed ? [`${w.disputed} disputed`] : []),
    ...(w.recorded ? [`${w.recorded} recorded`] : []),
  ];
  const rests = [
    `of the accepted, ${w.traced.both} rest on kept reads on both sides`,
    `${w.traced.one} on one`,
    `${w.traced.none} on none`,
  ];
  return [
    counts.join(', '),
    ...(w.accepted ? [rests.join(', ')] : []),
    `${plural(w.readers, 'reader')} from ${plural(w.vendors, 'vendor')}`,
    ...(w.last ? [`last worked ${w.last.slice(0, 10)}`] : []),
  ].join('; ');
}

/** A relay's row (QX-13): whether its owner or a seeder announced it, and on which day. */
function announcedText(p: SearchResult): string {
  const who = p.announcer && p.announcer.toLowerCase() === p.owner.toLowerCase() ? 'its owner' : 'a seeder';
  const on = p.announced ? ` on ${p.announced.slice(0, 10)}` : '';
  return `as announced by ${who}${on}`;
}

/**
 * One problem as quilt_search says it (APP.md, Search), in three lines: its hash; who titled it and what, with its
 * topics; then how much is done and how well it stands, what the accepted squares found, the problem it was proposed
 * from, how many proposals of it there are (`forks` counts the others in the same answer), where it is held, and where
 * it opens. The clauses of a line are joined by "; ".
 */
function searchLine(p: SearchResult, forks: number): string {
  const w = p.work;
  const kindCount = ([k, n]: [string, number]) => `${n} ${k}${kindWords(k).weakest ? ', the weakest kind' : ''}`;
  const kinds = p.kinds ? ` (${Object.entries(p.kinds).map(kindCount).join(', ')})` : '';
  const counts = Object.entries(p.counts).map(([k, n]) => `${n} ${k.replace('_', ' ')}`);
  const done = w ? workText(w) : counts.join(', ') || 'nothing yet';
  const said = w ? foundText(w.found) : '';
  const owner = p.owner_name ? `${p.owner_name} (${p.owner})` : p.owner;
  const titled = [
    `titled by ${owner}: "${p.title}" (${p.slug})`,
    ...(p.topics.length ? [`topics: ${p.topics.join(', ')}`] : []),
  ];
  const stands = [
    `${p.pieces} pieces${kinds}: ${done}`,
    ...(w?.declined ? [`${w.declined} declined`] : []),
    ...(said ? [said] : []),
    ...(p.from ? [`proposed from ${p.from}`] : []),
    ...(forks ? [`${forks + 1} proposals of this problem; the first has the most work`] : []),
    `held at ${plural(p.held.length, 'place')} (${p.held.join(', ')})`,
    ...(p.via === 'relay' ? [announcedText(p)] : []),
    `opens at ${p.tracker}`,
  ];
  return [p.problem, `  ${titled.join('; ')}`, `  ${stands.join('; ')}`].join('\n');
}

/**
 * QX-19 section 4: a problem its owner sharpened says which version replaced it, under its summary in quilt_open and
 * quilt_read alike.
 */
const replacedText = (superseded: Hash | null): string =>
  superseded ? `\nIts owner replaced this version with ${superseded}; the work is there.` : '';

/**
 * Why no tracker gave a standing: one that answered its well-known without the standing route (QX-15) is an older
 * tracker and is named as such; otherwise none answered at all.
 */
async function noStanding(quilt: Quilt): Promise<string> {
  for (const t of quilt.config.trackers) {
    const wk = await quilt.wellKnown(t);
    if (!wk) continue;
    const routes = Array.isArray(wk.routes) ? (wk.routes as string[]) : [];
    if (!routes.some((r) => r.endsWith('/standing')))
      return `Standing: none; the tracker at ${t} answered but is an older one without the standing route (QX-15)`;
  }
  return 'Standing: no tracker answered';
}

export async function runTool(quilt: Quilt, name: ToolName, input: ToolInput): Promise<ToolResult> {
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '');
  const hash = (k: string): Hash => str(k) as Hash;
  switch (name) {
    case 'quilt_me': {
      const me = quilt.me();
      const [s, c] = await Promise.all([quilt.standing(), quilt.coin()]);
      const text = [
        `Address: ${me.address ?? 'none yet (made at first use)'}`,
        ...(me.wordsDue
          ? [
              `The key was made here at first use; its twelve words wait on the page at http://localhost:${quilt.config.port}/#me to be written down once`,
            ]
          : []),
        `Name: ${me.name ?? 'none set'}`,
        `Declares: ${me.model}; can: ${me.can.join(', ')}`,
        `Trackers: ${me.trackers.join(', ')}`,
        ...(me.relays.length ? [`Relays: ${me.relays.join(', ')}`] : []),
        s ? standingText(s) : await noStanding(quilt),
        ...(c ? [coinText(c)] : []),
        ...(me.witness ? [sessionWitnessText(me.witness)] : []),
        `Queued events: ${me.queued}; problems in the library: ${me.problems}`,
        // A key that has opened no problem yet is new here: the account of how Quilt works comes with who it is.
        ...(me.problems === 0 ? [`New here, with no problem opened yet. ${HOW_QUILT_WORKS}`] : []),
      ].join('\n');
      return {
        text,
        handles: {
          address: me.address,
          model: me.model,
          trackers: me.trackers,
          queued: me.queued,
          standing: s,
          coin: c,
          witness: me.witness?.via ?? null,
        },
      };
    }
    case 'quilt_open': {
      const { hash: h, state, tracker, layer, hidden, gold, superseded } = await quilt.open(str('link'));
      return {
        text: `${quilt.summary(h, state, tracker, layer, hidden, gold)}${replacedText(superseded)}`,
        handles: { problem: h, pieces: state.pieces.length, complete: state.complete, superseded },
      };
    }
    case 'quilt_search': {
      const found = await quilt.search(str('query'));
      const forksOf = (p: SearchResult) => found.filter((x) => x.root === p.problem && x.problem !== p.problem).length;
      const text = found.length
        ? found.map((p) => searchLine(p, forksOf(p))).join('\n')
        : 'No problem matched on the trackers and relays this client knows.';
      return { text, handles: { problems: found.map((p) => p.problem), query: str('query') } };
    }
    case 'quilt_window': {
      // The handle the card reads: who this client is and what to open on. No one's words; the card reads the rest
      // through quilt_window_io.
      const me = quilt.me();
      const query = str('query');
      const link = str('link');
      const named = me.name ? ` (${me.name})` : '';
      const over = [me.trackers.join(', '), ...(me.relays.length ? [plural(me.relays.length, 'relay')] : [])];
      const text = `The directory window for ${me.address ?? 'a key not yet made'}${named}, over ${over.join(' and ')}: a search over the problems they know, each with its pieces and counts, and who this client is.`;
      return {
        text,
        handles: {
          window: {
            address: me.address,
            name: me.name,
            trackers: me.trackers,
            host: quilt.hostName ?? null,
            view: 'search',
            query: query || null,
            link: link || null,
          },
        },
      };
    }
    case 'quilt_window_io':
      return { text: JSON.stringify(await windowAnswer(quilt, input)), handles: {} };
    case 'quilt_next': {
      const { hash: h, pick, posted, owner, stake, lock, seams } = await quilt.next(str('problem'));
      const locked =
        lock === 'coin'
          ? `, after a lock of ${stake} backed by coin on the coin log`
          : lock === 'standing'
            ? `, after a lock of ${stake}`
            : '';
      const claimed = posted.queued
        ? 'The claim waits in the queue; no tracker answered.'
        : `The claim was posted to ${posted.at}${locked}.`;
      // QX-19: a disputed piece comes with its seams, one a line, so the reader replays both sides before it reads.
      const text = [quilt.pieceText(h, pick, owner, stake), ...seamsText(seams, (k) => k), claimed].join('\n');
      const k = kindWords(pick.piece.verifier);
      return {
        text,
        handles: {
          problem: h,
          piece: pick.piece.hash,
          name: pick.piece.name,
          verifier: pick.piece.verifier,
          kind: k.kind,
          strength: k.strength,
          weakest: k.weakest,
          requires: pick.requires,
          lease_h: pick.lease_h,
          agree: pick.agree,
          schema: pick.schema ?? null,
          stake,
          lock,
        },
      };
    }
    case 'quilt_return': {
      // QX-19: the rests as given, each a field, a page and the words on it; anything else in the list is left out.
      const rests = (Array.isArray(input.rests) ? input.rests : []).filter(
        (x): x is RestAsked =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as RestAsked).field === 'string' &&
          typeof (x as RestAsked).url === 'string' &&
          typeof (x as RestAsked).passage === 'string',
      );
      const r = await quilt.return(
        hash('problem'),
        hash('piece'),
        (input.return ?? {}) as Record<string, unknown>,
        rests,
      );
      const traced = r.trace ? ` ${traceText(r.trace)}` : '';
      return {
        text: `Commit ${where(r.commit)}; reveal ${where(r.reveal)}. ${r.waits}${traced}`,
        handles: {
          problem: input.problem,
          piece: input.piece,
          commit: r.commit,
          reveal: r.reveal,
          trace: r.trace ? { reads: r.trace.reads, rested: r.trace.rested, missing: r.trace.missing } : null,
        },
      };
    }
    case 'quilt_decline': {
      // One of the core's DECLINE_REASONS; `decline` refuses any other before it is signed.
      const reason = str('reason') as DeclineReason;
      const r = await quilt.decline(hash('problem'), hash('piece'), reason);
      return { text: `Declined (${reason}); ${where(r)}.`, handles: { problem: input.problem, piece: input.piece } };
    }
    case 'quilt_read': {
      const { hash: h, state, tracker, layer, hidden, gold, witnessed, superseded } = await quilt.open(str('problem'));
      const [challenges, panels] = await Promise.all([quilt.challenges(h, tracker), quilt.panels(h, tracker)]);
      // QX-20: a problem with a record piece says its readings so far, between the accepted and the disputed.
      const recorded = recordedText(state, layer);
      const found = foundText(foundIn(state, layer));
      // It opens with what quilt_open says, the replaced-by line included, and goes on to the work, a blank line
      // between the parts.
      const text = [
        `${quilt.summary(h, state, tracker, layer, hidden, gold)}${replacedText(superseded)}`,
        ...(found ? [`Found: ${found}.`] : []),
        section('Accepted so far', quilt.acceptedText(state, layer, witnessed)),
        ...(recorded ? [section('Recorded', recorded)] : []),
        section('Disputed', quilt.disputedText(state, layer)),
        section('Challenges', quilt.challengesText(challenges, state)),
        section('Panels', quilt.panelsText(panels, state)),
      ].join('\n\n');
      return {
        text,
        handles: {
          problem: h,
          complete: state.complete,
          output: state.output?.hash ?? null,
          challenges: challenges.map((c) => ({ id: c.id, piece: c.piece, outcome: c.outcome })),
          panels: panels.map((p) => ({
            piece: p.piece,
            outcome: p.outcome,
            candidates: p.candidates.map((c) => c.digest),
          })),
        },
      };
    }
    case 'quilt_rank': {
      const r = await quilt.rank(
        hash('problem'),
        hash('piece'),
        (Array.isArray(input.ranking) ? input.ranking : []) as Hash[],
      );
      return { text: `Ranking ${where(r)}.`, handles: { problem: input.problem, piece: input.piece, rank: r.id } };
    }
    case 'quilt_challenge': {
      const r = await quilt.challenge(hash('problem'), hash('piece'), Number(input.stake), str('ground'));
      return {
        text: `Challenge ${r.id} ${where(r)}. The panel is drawn from the challenge's receipt; quilt_read lists the seats.`,
        handles: { problem: input.problem, piece: input.piece, challenge: r.id },
      };
    }
    case 'quilt_verdict': {
      const side = str('for') as Side;
      const r = await quilt.verdict(
        hash('problem'),
        hash('piece'),
        hash('challenge'),
        side,
        input.return as Record<string, unknown> | undefined,
      );
      return {
        text: `Verdict for the ${side} ${where(r)}.`,
        handles: { problem: input.problem, piece: input.piece, challenge: input.challenge, verdict: r.id },
      };
    }
    case 'quilt_seed': {
      const on = input.on !== false;
      const r = await quilt.seed(hash('problem'), on);
      const doing = on ? 'Seeding' : 'No longer seeding';
      const went = r.queued ? 'the seed waits in the queue' : `posted to ${r.at}`;
      return {
        text: `${doing} ${str('problem')}: ${went}.`,
        handles: { problem: input.problem, on },
      };
    }
    case 'quilt_publish': {
      const r = await quilt.publish(input.pattern as Pattern);
      const text = [
        `Published ${r.hash}`,
        `Link: ${r.link}`,
        r.posted.length ? `Carried by: ${r.posted.join(', ')}` : 'No tracker took it.',
        ...(r.gold
          ? [
              `Gold committed on ${plural(r.gold.pieces, 'piece')} with a stake of ${r.gold.stake}; the answers stay in this home's library until each piece is accepted and revealed.`,
            ]
          : []),
        ...r.refused.map((x) => `Refused by ${x}`),
      ].join('\n');
      return { text, handles: { problem: r.hash, link: r.link, posted: r.posted, gold: r.gold } };
    }
    case 'quilt_pay': {
      const r = await quilt.pay(hash('problem'), Number(input.amount), Number(input.per_square));
      return {
        text: `Escrowed ${input.amount} units to ${str('problem')} at ${input.per_square} a square; ${onCoinLog(r, 'the pay waits in the queue')}. Each square accepted from now pays the roots of its set from the escrow; what is left comes back when the problem completes.`,
        handles: {
          problem: input.problem,
          pay: r.id,
          amount: input.amount,
          per_square: input.per_square,
          home: r.home,
        },
      };
    }
    case 'quilt_transfer': {
      const r = await quilt.transfer(str('to') as Address, Number(input.amount));
      return {
        text: `Transferred ${input.amount} units to ${str('to')}; ${onCoinLog(r, 'the transfer waits in the queue')}. The units are the recipient's on the ledger from the receipt.`,
        handles: { to: input.to, amount: input.amount, transfer: r.id, home: r.home },
      };
    }
    case 'quilt_redeem': {
      const to = str('to');
      const r = await quilt.redeem(Number(input.amount), to ? (to as Address) : undefined);
      const toWhom = to ? `, to ${to}` : '';
      return {
        text: `Redeem of ${input.amount} units ${onCoinLog(r, 'waits in the queue')}${toWhom}. The coin has left the ledger; the line is minted on the chain once the bridge's poster carries it under a head whose veto window has passed, and the holder claims it with the proof.`,
        handles: { amount: input.amount, to: to || null, redeem: r.id, home: r.home },
      };
    }
    case 'quilt_reveal_gold': {
      const r = await quilt.revealGold(hash('problem'), hash('piece'));
      const said: Record<string, string> = {
        match: 'The set agreed with the gold: the square is verified.',
        miss: 'The set differed from the gold: it is struck, its roots are docked and their locks forfeited, and the piece is open again; a struck root may challenge the gold inside the window, staking nothing.',
      };
      const decided = r.outcome && said[r.outcome] ? said[r.outcome] : 'The tracker has not said what it decided yet.';
      return {
        text: `Gold on ${r.name} revealed; ${where(r)}. ${decided}`,
        handles: { problem: input.problem, piece: input.piece, reveal: r.id, outcome: r.outcome },
      };
    }
    case 'quilt_name': {
      const r = await quilt.setName(str('name'));
      return { text: `Name set to "${str('name')}"; ${where(r)}.`, handles: { name: input.name } };
    }
  }
}

/** The runner for a copy of quilt working alone: a Quilt for the host, the tool run in this process. */
export function localRunner(quiltFor: (host: string | undefined) => Quilt): ToolRunner {
  return (name, input, host) => runTool(quiltFor(host), name, input);
}
