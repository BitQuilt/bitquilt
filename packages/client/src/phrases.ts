/**
 * The phrases: what a person says to their AI to do one thing on Quilt, in the person's own words. The person sits in
 * a chat and their AI holds the connector, so the thing a person needs from Quilt's own window is not a button but a
 * sentence to say. The menu-bar app shows them for copying (GET /api/phrases, page.ts), the connector offers them as
 * MCP prompts (mcp.ts), and the bundle's manifest lists them (scripts/build-mcpb.mjs). Each is fixed text in reviewed
 * code with at most a link, a path, some words or a number filled in: none carries another member's words, a brief or
 * a title, so nothing anyone wrote reaches a model through them. The AI's own client asks the person before anything
 * is written, so a phrase carries no caution.
 *
 * The sheet (`sheetOf`) is what the menu bar draws: which of three states the home is in (no key yet; a key but no AI
 * has connected; connected), the one phrase to say first, and the phrases that fit what this person keeps, has worked
 * and is wanted for.
 */
import type { Address, Hash } from '@bitquilt/core';
import { makeLink } from './link.js';
import type { AttentionItem } from './quilt.js';
import type { Library } from './resolver.js';

/** What a phrase takes to be said whole: a link to a problem, words to search for, a file's path, a number of units, a price per square, an address. */
export type PhraseArg = 'link' | 'words' | 'path' | 'amount' | 'per_square' | 'to';

export interface PhraseSpec {
  /** The prompt's name in the chat, a verb phrase: distinct from the tools' names, which say what the connector does. */
  name: string;
  title: string;
  /** What saying it leads the AI to do, in one sentence; a prompt's description. */
  about: string;
  args: PhraseArg[];
  /** The sentence, with the arguments filled in. */
  say: (a: Record<PhraseArg, string>) => string;
}

/** What each argument is, in the words the chat shows when it asks for one. */
export const ARG_WORDS: Record<PhraseArg, string> = {
  link: 'The problem, as a quilt link or a sha256 hash',
  words: 'The words to search for',
  path: 'The path of the pattern file on this machine',
  amount: 'How many units of coin',
  per_square: 'How many units each accepted square pays',
  to: 'The address the coin goes to, with its checksum',
};

export const PHRASES: readonly PhraseSpec[] = [
  { name: 'find_something_to_do', title: 'Something to do', about: 'The AI takes the rarest piece of a problem that fits it, from the problems this key keeps first and then from the trackers.', args: [], say: () => 'Find me something to do on Quilt.' },
  { name: 'who_am_i', title: 'Who I am on Quilt', about: 'The AI says the address this key signs with, its name, its standing and its coin.', args: [], say: () => 'Open Quilt and tell me who I am: my address, my standing and my coin.' },
  { name: 'search_quilt', title: 'Search for a problem', about: 'The AI searches the trackers and relays for problems whose title, topics or statement of done carry the words.', args: ['words'], say: (a) => `Search Quilt for ${a.words} and tell me what you find.` },
  { name: 'open_problem', title: 'Open a problem', about: 'The AI opens the problem and says what it asks, how far it has got, and what each piece\'s verifier is.', args: ['link'], say: (a) => `Open ${a.link} on Quilt and tell me what it asks.` },
  { name: 'take_piece', title: 'Take a piece', about: 'The AI opens the problem, takes its rarest piece that fits, works it, and hands the return back after asking.', args: ['link'], say: (a) => `Open ${a.link} on Quilt and take a piece.` },
  { name: 'keep_problem', title: 'Keep a problem', about: 'The AI seeds the problem, so it sits in this key\'s standing list and its pieces are offered to this key first.', args: ['link'], say: (a) => `Keep ${a.link} on Quilt: seed it, so its pieces come to me first.` },
  { name: 'give_verdict', title: 'Give a verdict', about: 'The AI opens the problem, reads the challenge this key was drawn to judge, and gives the verdict after asking.', args: ['link'], say: (a) => `Open ${a.link} on Quilt and give my verdict on the challenge I was drawn to judge.` },
  { name: 'rank_panel', title: 'Rank a panel', about: 'The AI opens the problem, reads the candidates of the judge piece this key sits on, and ranks them after asking.', args: ['link'], say: (a) => `Open ${a.link} on Quilt and rank the candidates of the panel I sit on.` },
  { name: 'my_disputed_return', title: 'A return of mine is disputed', about: 'The AI opens the problem and shows the return of this key\'s that another vendor read differently.', args: ['link'], say: (a) => `Open ${a.link} on Quilt and show me the return of mine that is disputed.` },
  { name: 'piece_for_a_person', title: 'A piece wants a person', about: 'The AI opens the problem and names the piece whose verifier is a person\'s own word, which the person hands in at the page.', args: ['link'], say: (a) => `Open ${a.link} on Quilt and tell me which piece wants a person, so I can hand it in myself at the page.` },
  { name: 'reveal_my_gold', title: 'Reveal my gold', about: 'The AI reveals the gold this key committed on each piece of its own problem that has been accepted, after asking.', args: ['link'], say: (a) => `Open ${a.link} on Quilt and reveal my gold on every piece of it that has been accepted.` },
  { name: 'publish_pattern', title: 'Publish a pattern', about: 'The AI reads the pattern file, publishes it as a signed problem on this key\'s trackers, and posts its gold where the file carries any.', args: ['path'], say: (a) => `Publish the pattern at ${a.path} on Quilt.` },
  { name: 'pay_workers', title: 'Pay a problem\'s workers', about: 'The AI escrows coin to the problem on the coin\'s home, paid per accepted square to the workers, after asking.', args: ['link', 'amount', 'per_square'], say: (a) => `Pay the workers of ${a.link} on Quilt: escrow ${a.amount} coin, ${a.per_square} a square.` },
  { name: 'transfer_coin', title: 'Transfer coin', about: 'The AI moves vested free coin of this key\'s to an address on the coin log, after asking.', args: ['to', 'amount'], say: (a) => `Transfer ${a.amount} of my Quilt coin to ${a.to}.` },
  { name: 'redeem_coin', title: 'Redeem coin to the chain', about: 'The AI takes vested free coin of this key\'s off the ledger as a redeem line, to be minted on the chain to this key\'s address, after asking.', args: ['amount'], say: (a) => `Redeem ${a.amount} of my Quilt coin to the chain.` },
];

/** The phrase by name; a name the list has not is a programming error. */
export function phrase(name: string): PhraseSpec {
  const p = PHRASES.find((x) => x.name === name);
  if (!p) throw new Error(`no phrase named ${name}`);
  return p;
}

/** A phrase said whole: the arguments given fill its slots, the rest are empty. */
export function say(name: string, args: Partial<Record<PhraseArg, string>> = {}): string {
  return phrase(name).say({ link: '', words: '', path: '', amount: '', per_square: '', to: '', ...args });
}

/** The first thing to say once the connector is in, and the test of the connection: the AI that answers it has arrived. */
export const FIRST_PHRASE = 'who_am_i';

/** The phrases the coin moves with: offered in the chat as prompts, and named on the sheet, not spelled out with amounts. */
export const COIN_PHRASES: readonly string[] = ['pay_workers', 'transfer_coin', 'redeem_coin'];

/** One phrase on the sheet, ready to copy: the sentence, what it leads to, and the problem it is about where there is one. */
export interface SheetPhrase {
  name: string;
  title: string;
  say: string;
  about: string;
  /** The problem the phrase names, by hash, with the title the library remembers for it; the title is for the person reading the sheet and is in no phrase. */
  problem?: { hash: Hash; title: string };
}

export interface SheetGroup { title: string; phrases: SheetPhrase[] }

/** Which of three states the home is in: no key made yet; a key, and no AI has connected through the connector; an AI has connected. */
export type HomeState = 'no_key' | 'no_connector' | 'connected';

/** The record a connecting AI leaves in the library: its host's name, the first time, the latest time. */
export interface ConnectorSeen { host: string | null; first: string; last: string }

export interface Sheet {
  state: HomeState;
  address: Address | null;
  name: string | null;
  connector: ConnectorSeen | null;
  /** Whether Claude Desktop's config names the quilt connector, and where that file is, and whether Claude is running now. */
  claude: { installed: boolean; config: string; running: boolean };
  /** The one phrase to say first: it tests the connection, and the record it leaves moves the state to connected. */
  first: SheetPhrase;
  groups: SheetGroup[];
  /** Every prompt the connector offers, by name, with what each takes, so the sheet can name the ones it does not spell out. */
  prompts: { name: string; title: string; about: string; args: PhraseArg[] }[];
  /** Each phrase with its arguments in braces, by name, so the menu bar can say one about a problem it found itself. */
  templates: Record<string, string>;
}

export interface SheetInput {
  address: Address | null;
  name: string | null;
  library: Library;
  attention: AttentionItem[];
  claude: { installed: boolean; config: string; running: boolean };
}

/** The phrase about a problem, with its link made from the trackers the library remembers for it. */
function about(name: string, hash: Hash, library: Library, extra: Partial<Record<PhraseArg, string>> = {}): SheetPhrase {
  const remembered = library.problems[hash];
  const link = makeLink(hash, remembered?.trackers ?? [], remembered?.slug);
  const p = phrase(name);
  return { name, title: p.title, say: say(name, { link, ...extra }), about: p.about, problem: { hash, title: remembered?.title ?? hash } };
}

/** The phrase for something wanted (quilt.ts, `attention`): each reason has its sentence. */
const WANTED: Record<AttentionItem['why'], string> = { rank: 'rank_panel', verdict: 'give_verdict', disputed: 'my_disputed_return', person: 'piece_for_a_person', gold: 'reveal_my_gold' };

/**
 * The sheet for this home. The state is read from the key and the library's record of a connector. The groups, when
 * connected: what is wanted from this person, the two phrases to start with, the problems they keep, the problems
 * they opened lately, and their own problems with gold still to reveal; the coin's phrases are named, not spelled.
 */
export function sheetOf(input: SheetInput): Sheet {
  const { address, library, attention, claude } = input;
  const connector = library.connector ?? null;
  const state: HomeState = address === null ? 'no_key' : connector === null ? 'no_connector' : 'connected';
  const first = phrase(FIRST_PHRASE);
  const groups: SheetGroup[] = [];
  if (state === 'connected') {
    const wanted = attention.filter((it) => it.why in WANTED).map((it) => about(WANTED[it.why], it.problem, library));
    if (wanted.length) groups.push({ title: 'Wanted from you', phrases: dedupe(wanted) });
    groups.push({ title: 'To start', phrases: ['find_something_to_do', 'who_am_i'].map((n) => ({ name: n, title: phrase(n).title, say: say(n), about: phrase(n).about })) });
    const kept = Object.entries(library.seeding).sort((x, y) => (x[1] < y[1] ? 1 : -1)).map(([h]) => h as Hash).filter((h) => library.problems[h]);
    if (kept.length) groups.push({ title: 'Keeping', phrases: kept.map((h) => about('take_piece', h, library)) });
    const lately = Object.entries(library.problems).filter(([h]) => !library.seeding[h]).sort((x, y) => (x[1].last < y[1].last ? 1 : -1)).slice(0, 8).map(([h]) => h as Hash);
    if (lately.length) groups.push({ title: 'Opened lately', phrases: lately.map((h) => about('take_piece', h, library)) });
    const golden = Object.entries(library.gold ?? {}).filter(([, pieces]) => Object.values(pieces).some((g) => !g.revealed)).map(([h]) => h as Hash);
    if (golden.length) groups.push({ title: 'Your gold', phrases: golden.map((h) => about('reveal_my_gold', h, library)) });
  }
  return {
    state, address, name: input.name, connector, claude,
    first: { name: first.name, title: first.title, say: say(first.name), about: first.about },
    groups,
    prompts: PHRASES.map((p) => ({ name: p.name, title: p.title, about: p.about, args: p.args })),
    templates: Object.fromEntries(PHRASES.map((p) => [p.name, say(p.name, Object.fromEntries(p.args.map((a) => [a, `{${a}}`])))])),
  };
}

/** One phrase per problem and reason: two seats on one problem say the same sentence once. */
function dedupe(phrases: SheetPhrase[]): SheetPhrase[] {
  const seen = new Set<string>();
  return phrases.filter((p) => !seen.has(p.say) && seen.add(p.say));
}
