/**
 * The connector: the MCP server a person's AI talks to. Each tool's text describes and never instructs; other people's
 * words reach the model only as quoted text with the signer named; structuredContent carries the handles and a copy of
 * the same text, since some hosts show a model only structuredContent. The long texts here are written one sentence a
 * line and joined with a space, so a sentence can be read and changed on its own.
 */
import { RESOURCE_MIME_TYPE, getUiCapability, registerAppResource, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DECLINE_REASONS } from '@bitquilt/core';
import { HOW_QUILT_WORKS } from './about.js';
import { AWAY_TOOLS, type AwayRecord, capReached, capText, readAway, recordReturn } from './away.js';
import { SIDES } from './listings.js';
import { ARG_WORDS, PHRASES, type PhraseArg } from './phrases.js';
import { type ToolInput, type ToolName, type ToolResult, type ToolRunner } from './tools.js';
import { WINDOW_HTML } from './window.generated.js';
import { WINDOW_OPS, WINDOW_URI, WINDOW_URI_NOW } from './window.js';

/** What every tool answers with: the text a model reads, and the handles a card uses (a problem hash, a piece hash, where a post went). */
const toolOutput = { text: z.string(), handles: z.record(z.string(), z.unknown()).optional() };

function said({ text, handles }: ToolResult) {
  return { content: [{ type: 'text' as const, text }], structuredContent: { text, handles } };
}

// The plain account first (about.ts), so an AI asked how Quilt works has it to hand from the handshake on; then what the tools are.
const instructions = [
  HOW_QUILT_WORKS,
  'Quilt is a client of BitQuilt: problems published as patterns of pieces, worked by many people\'s AIs, each return signed.',
  'These tools open a problem, search for one, take the rarest piece, hand a return back, decline, read what was accepted, what is challenged and what a panel is ranking, publish a pattern, challenge an acceptance, give a verdict where this key was drawn to judge a challenge, rank the candidates of a judge piece where it sits on the panel, and, where a tracker carries the coin, pay a problem\'s workers, move coin to an address, and redeem coin to the chain.',
  'Each piece names its verifier kind and how strongly that kind earns a square; an attest piece is the actor\'s own word and the weakest. A record piece (QX-20) keeps every reading from an unrelated root as given and accepts none: a question with no empirical answer, answered several ways on the record, with what each reading rests on.',
  'The prompts are the sentences a person says to start each of these, in their own words.',
  'Where the chat shows MCP apps, the window is a view of the same beside a result: a search over the trackers and relays this client knows, each problem with its pieces and counts, and who this client is; its buttons hand the chat one of the prompts.',
  'The person\'s own client asks them before anything is written.',
].join(' ');

/** The sentence added for a run while away (away.ts): what this connector is, in words that describe. */
export function awayInstructions(record: AwayRecord): string {
  return `This connector was started for a run while nobody is at the keyboard: the claims it posts leave out the person capability, today's allowance is ${record.cap} pieces of which ${record.returned} are returned, and the tools that publish, pay, move coin, challenge, judge, seed, name or reveal gold are not offered.`;
}

export interface McpServerOptions {
  /** Called once the client has finished its handshake, with the host's name: the record the menu bar reads as an AI having connected (phrases.ts). */
  connected?: (host: string | null) => void;
  /** The record of a run while away (away.ts): set, only the tools such a run may call are offered, and quilt_next and quilt_return stop at the day's cap. QUILT_AWAY when left out. */
  away?: string;
}

/**
 * The server over a runner: alone, the runner is `localRunner` over this process's Quilt; through a node already
 * holding this home's page, it is `remoteRunner` (node.ts). Each tool's schema and words are here; its work is in
 * tools.ts. The prompts are the phrases (phrases.ts), one each, with what each takes asked for by the chat.
 */
export function createMcpServer(run: ToolRunner, options: McpServerOptions = {}): McpServer {
  const away = options.away ?? process.env.QUILT_AWAY;
  const server = new McpServer({ name: 'quilt', version: '0.2.5' }, { instructions: away ? `${instructions} ${awayInstructions(readAway(away))}` : instructions });
  // While away, a claim or a return past the day's cap is answered with the cap and writes nothing; each return handed back is counted in the record.
  const call = (name: ToolName) => async (input: ToolInput) => {
    if (away && (name === 'quilt_next' || name === 'quilt_return')) {
      const record = readAway(away);
      if (capReached(record)) return said({ text: capText(record), handles: { away: { cap: record.cap, returned: record.returned, day: record.day } } });
    }
    const result = await run(name, input, server.server.getClientVersion()?.name);
    if (away && name === 'quilt_return') recordReturn(away, String(input.problem ?? ''), String(input.piece ?? ''));
    return said(result);
  };
  // A tool registered, and taken off again before the handshake when this is a run while away and the tool is not among the ones such a run may call.
  const tool: McpServer['registerTool'] = (name, config, cb) => {
    const registered = server.registerTool(name, config, cb);
    if (away && !(AWAY_TOOLS as readonly string[]).includes(name)) registered.remove();
    return registered;
  };
  // A tool that shows the window beside its result (window.ts): registered with the card's address in its _meta, which
  // the MCP apps extension reads; a run while away has no chat to show a card in, so there it is a plain tool.
  const cardTool = (name: ToolName, config: object, cb: (input: ToolInput) => Promise<unknown>) => {
    if (away) return tool(name, config as Parameters<typeof tool>[1], cb as never);
    return registerAppTool(server, name, { ...config, _meta: { ui: { resourceUri: WINDOW_URI_NOW } } } as never, cb as never);
  };
  if (options.connected) {
    const connected = options.connected;
    server.server.oninitialized = () => connected(server.server.getClientVersion()?.name ?? null);
  }

  for (const p of PHRASES) {
    const argsSchema: Record<string, z.ZodString> = {};
    for (const a of p.args) argsSchema[a] = z.string().min(1).describe(ARG_WORDS[a]);
    server.registerPrompt(p.name, { title: p.title, description: p.about, argsSchema }, (args) => {
      const given: Record<PhraseArg, string> = { link: '', words: '', path: '', amount: '', per_square: '', to: '', name: '', ...(args as Partial<Record<PhraseArg, string>>) };
      return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.say(given) } }] };
    });
  }

  tool('quilt_me', {
    title: 'This client',
    description: 'The address this client signs with, its name, the model it declares, what it can do, the trackers it asks, how many events wait in its queue, from the first tracker that answers its standing (what it has, earned by work and not for sale; what is locked behind its claims under QX-15; what is free to stake), and, where a tracker carries the coin (QX-17), its coin: the balance in units, what is transferable now, what is still vesting, what is locked or escrowed, and what is free to stake or pay.',
    inputSchema: {},
    outputSchema: toolOutput,
  }, call('quilt_me'));

  cardTool('quilt_open', {
    title: 'Open a problem',
    description: 'Opens a problem from a quilt link, a tracker address or a bare hash: the owner\'s title and statement of when it is done as their quoted words, the map of pieces with their states, the verifier kinds and how strongly each earns a square, and the link to pass on. Where the chat shows MCP apps, the window comes up beside the result on the problem\'s map.',
    inputSchema: { link: z.string().describe('A quilt: link, a tracker\'s /p/<hash> address, or a sha256: hash') },
    outputSchema: toolOutput,
  }, call('quilt_open'));

  cardTool('quilt_search', {
    title: 'Search for problems',
    description: 'Searches the trackers and the relays this client knows for problems whose title, slug, topics or statement of done contain the words, and lists each with its counts and its owner; a result from a relay names the tracker to open it from. Where the chat shows MCP apps, the window comes up beside the result with the same search in it.',
    inputSchema: { query: z.string().min(1).max(200) },
    outputSchema: toolOutput,
  }, call('quilt_search'));

  cardTool('quilt_window', {
    title: 'Open the window',
    description: [
      'Quilt\'s directory window, shown beside this result where the chat shows MCP apps: a search over the problems the trackers and relays this client knows, each with its pieces and how many are returned, accepted and disputed, who proposed it and where it is held; a problem\'s map with each piece\'s kind, grade and readers; the keys this person follows; this home\'s library and what its node serves; and who this client is, with its standing and coin.',
      'Its buttons hand the person\'s own sentence to this chat, so a piece is taken or a problem opened through quilt_next and quilt_open as from any other sentence of theirs; following a key is written in this home\'s library alone.',
      'Where the chat shows no MCP apps, quilt_search, quilt_open, quilt_read and quilt_me say the same in text.',
    ].join(' '),
    inputSchema: { query: z.string().max(200).optional().describe('Words to open the search on'), link: z.string().max(400).optional().describe('A problem to open it on') },
    outputSchema: toolOutput,
  }, async (input: ToolInput) => {
    const r = await run('quilt_window', input, server.server.getClientVersion()?.name);
    // The capability as the host declared it at the handshake; the SDK's own type for it is read through the extension's.
    const cap = getUiCapability(server.server.getClientCapabilities() as Parameters<typeof getUiCapability>[0]);
    const shown = Boolean(cap && (!cap.mimeTypes || cap.mimeTypes.includes(RESOURCE_MIME_TYPE)));
    return said({ text: `${r.text} ${shown ? 'This chat said it shows MCP apps, so the window is beside this result.' : 'This chat has not said it shows MCP apps; quilt_search and quilt_me say the same in text.'}`, handles: r.handles });
  });

  // The window's own reader (window.ts): the card calls it through the host, over this same session; the model is not
  // offered it. Its answer is JSON as text, nothing in structuredContent.
  const reader = registerAppTool(server, 'quilt_window_io', {
    title: 'What the window reads',
    description: 'The window\'s own reader, for the card and not for the model: a search over the trackers and relays, a problem\'s map and grades, this home\'s library and what its node serves, the keys this person follows, who this client is, the trackers\' totals, and the phrase templates alone, each answered as JSON text for the window to draw. Its one write is the list of followed keys in this home\'s library. Hidden from the model by its visibility.',
    inputSchema: { op: z.enum(WINDOW_OPS), query: z.string().max(200).optional(), link: z.string().max(400).optional(), key: z.string().max(64).optional(), on: z.boolean().optional(), name: z.string().max(60).optional() },
    _meta: { ui: { resourceUri: WINDOW_URI_NOW, visibility: ['app'] } },
  }, async (input) => ({ content: [{ type: 'text' as const, text: (await run('quilt_window_io', input as ToolInput, server.server.getClientVersion()?.name)).text }] }));
  if (away) reader.remove();
  else {
    // The card, at this build's address (what the tools point at) and at its standing one (for results from before).
    const card = (uri: string) => async () => ({ contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: WINDOW_HTML, _meta: { ui: { prefersBorder: true } } }] });
    registerAppResource(server, 'The window', WINDOW_URI_NOW, { description: 'Quilt\'s directory window: a search over the trackers and relays this client knows, and who this client is, beside a result.' }, card(WINDOW_URI_NOW));
    registerAppResource(server, 'The window at its standing address', WINDOW_URI, { description: 'The same window, at the address a result from before names.' }, card(WINDOW_URI));
  }

  tool('quilt_next', {
    title: 'Take the rarest piece',
    description: [
      'The rarest piece of a problem that fits this client, claimed for it: its verifier kind and how strongly that kind earns a square, the author\'s brief as their quoted words, the fields a return has and which must agree, what the piece requires, and the lease in hours.',
      'With no problem named, the standing list is asked first and then each tracker\'s offer: the problems of people who have worked this key\'s own problems, then the rarest, with every tenth offer a newcomer\'s.',
      'Where the problem asks a stake of the piece (QX-15), a lock of that much of this key\'s standing is posted before the claim; it is released when the window closes and forfeited if the acceptance is struck.',
      'A piece the key\'s free standing cannot cover is not offered, except where the tracker carries the coin (QX-17) and this key\'s free coin covers the stake at the burn rate: then coin is locked on the coin log in its place.',
      'A disputed piece comes with its seams (QX-19): each field the two readings differ on, why, and what each side rests on, quoted with its signer named.',
      'The piece hash and the problem hash come back as handles for quilt_return.',
    ].join(' '),
    inputSchema: { problem: z.string().optional().describe('The problem, as a link or a hash; left out, something to do') },
    outputSchema: toolOutput,
  }, call('quilt_next'));

  tool('quilt_return', {
    title: 'Hand a return back',
    description: [
      'Hands back a return for a piece this client was handed: a commit with the hash of the return, then its reveal, both signed with this client\'s key and posted to the problem\'s trackers.',
      'The return is an object with the fields the piece\'s schema names, every string plain text.',
      'What the piece waits for next depends on its kind: another vendor\'s agreement, a second person, a panel\'s ranking, or nothing, for an attest piece, which is accepted at once on this record, and for a record piece, where the reading stands as given beside the others.',
      'Beside the return, rests may say for a field which page it rests on and the words on it (QX-19): the client fetches the page, keeps its text under its hash, finds the words, and posts the trace beside the reveal; a passage not found on the page as fetched is left out and said.',
    ].join(' '),
    inputSchema: {
      problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), return: z.record(z.string(), z.unknown()).describe('The return, fitting the piece\'s schema'),
      rests: z.array(z.object({ field: z.string().describe('A field of the return'), url: z.string().describe('The page it rests on'), passage: z.string().describe('The words on that page it rests on, as they appear there') })).optional().describe('What the fields rest on (QX-19)'),
    },
    outputSchema: toolOutput,
  }, call('quilt_return'));

  tool('quilt_decline', {
    title: 'Give a piece back',
    description: [
      'Gives a piece back with one of the fixed reasons: cannot, unclear, refuse, duplicate or no_time.',
      'This key is not offered the piece again in this version of the problem.',
    ].join(' '),
    inputSchema: { problem: z.string(), piece: z.string(), reason: z.enum(DECLINE_REASONS) },
    outputSchema: toolOutput,
  }, call('quilt_decline'));

  cardTool('quilt_read', {
    title: 'Read a problem',
    description: 'A problem\'s map with its kinds, the stake it asks and the gold its owner committed (how many squares are verified, missed or awaiting the reveal), its accepted returns, each as the quoted words of the key that signed it with the signer named and a verified square said so, its disputed pieces (every return on each quoted with its signer and model named, the ones this key signed marked, and the fields they differ on), its challenges (the ground as the challenger\'s quoted words, the judges drawn, each verdict, the outcome), and its judge panels (each candidate\'s return quoted, the seats drawn, each rank, the outcome). Where the tracker keeps traces (QX-19), each accepted square says whether both returns rest on kept reads, and each disputed piece\'s seams say on which fields the two readings differ, why, and what each side rests on, quoted with its signer named. A record piece (QX-20) shows its readings so far, each quoted with its signer named, how many rest on kept reads, and the seams between them.',
    inputSchema: { problem: z.string().describe('The problem, as a link or a hash') },
    outputSchema: toolOutput,
  }, call('quilt_read'));
  // (quilt_read names the window too, so it comes up on the problem's map beside the reading where the chat shows MCP apps.)

  tool('quilt_rank', {
    title: 'Rank a judge piece\'s candidates',
    description: [
      'A ranking of a judge piece\'s candidates (QX-2) by a key drawn to its panel: every candidate\'s digest once, first choice first, signed and posted to the problem\'s trackers.',
      'The panels this key sits on, each candidate\'s return quoted beside its digest, and which seats have ranked are in quilt_read; the candidate a majority of the panel ranks first is accepted.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), ranking: z.array(z.string()).min(1).describe('The candidates\' digests, first choice first, each once') },
    outputSchema: toolOutput,
  }, call('quilt_rank'));

  tool('quilt_challenge', {
    title: 'Challenge an acceptance',
    description: [
      'Challenges a piece\'s provisional acceptance inside its window (QX-1): a stake of this key\'s standing, gained if the challenge holds and lost if it fails, and one sentence of ground through the plain-text gate, signed and posted to the problem\'s trackers.',
      'The tracker seats a panel of three judges by sortition from keys with accepted work on another problem; two verdicts decide.',
      'A new key has a standing of one.',
      'A key whose set a gold miss struck (QX-16) challenges the gold the same way inside the miss\'s window, and may stake nothing.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), stake: z.number().int().min(0).describe('Standing staked, at most this key\'s free standing: at least 1 against an acceptance, and 0 allowed against a gold miss by a key the miss struck'), ground: z.string().min(1).max(200).describe('One sentence saying why the acceptance is wrong') },
    outputSchema: toolOutput,
  }, call('quilt_challenge'));

  tool('quilt_verdict', {
    title: 'Give a verdict',
    description: [
      'A verdict on a challenge this key was drawn to judge: for the challenger or for the author, with this judge\'s own return as evidence where it has one, signed and posted.',
      'The seats drawn for each challenge, and which have answered, are in quilt_read.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), challenge: z.string().describe('The challenge id'), for: z.enum(SIDES), return: z.record(z.string(), z.unknown()).optional().describe('This judge\'s own return, fitting the piece\'s schema') },
    outputSchema: toolOutput,
  }, call('quilt_verdict'));

  tool('quilt_seed', {
    title: 'Keep a problem',
    description: [
      'A seed event on the problem\'s log, on or off.',
      'On, this key is a seeder: offered the problem\'s watch pieces first, with the problem in this client\'s standing list, asked before the trackers\' offers.',
      'Seeding is a statement rather than a stake; a reader of the log sees who keeps a problem and since when.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), on: z.boolean().describe('true to keep it, false to stop') },
    outputSchema: toolOutput,
  }, call('quilt_seed'));

  tool('quilt_publish', {
    title: 'Publish a problem',
    description: [
      'Publishes a problem from a pattern signed with this client\'s key as the owner: the title, the statement of when it is done, a slug, the pieces with their briefs, schemas, verifier kinds and what they require, the data rows the briefs\' slots draw on, topics for the index, where the owner asks it the stake of standing a claim on the pieces is backed by (QX-15), and where the owner knows some answers in advance the gold (QX-16): each answer committed by hash before the work, bound to its piece inside the commitment so the ledger shows how many answers are committed and not which pieces, backed by a stake of the owner\'s standing, kept in this home\'s library for the reveal.',
      'A draft with faults is refused with every fault at once, in the checker\'s words, so a pattern drafted from a conversation is fixed in one turn. Returns the problem\'s hash and link.',
    ].join(' '),
    inputSchema: {
      pattern: z.object({
        title: z.string(), done_when: z.string(), slug: z.string(),
        prev: z.string().nullable().optional(), from: z.string().nullable().optional(),
        settings: z.record(z.string(), z.number()).optional(),
        pieces: z.record(z.string(), z.unknown()), data: z.record(z.string(), z.array(z.unknown())).optional(), topics: z.array(z.string()).optional(),
        stake: z.object({ min: z.number().int().min(0).describe('The standing a claim locks; 0 asks nothing'), pieces: z.array(z.string()).optional().describe('The families or pieces it covers; left out, every piece') }).optional(),
        gold: z.object({ answers: z.record(z.string(), z.record(z.string(), z.unknown())).describe('Piece names to the owner\'s answers; each is projected to the piece\'s agreed fields'), stake: z.number().int().min(1).optional().describe('The owner\'s standing locked behind the gold; left out, the sum of the pieces\' shares') }).optional(),
      }),
    },
    outputSchema: toolOutput,
  }, call('quilt_publish'));

  tool('quilt_pay', {
    title: 'Pay a problem\'s workers in coin',
    description: [
      'Escrows coin of this key to a problem, on the coin log of the tracker that is the coin\'s home (QX-17): each square accepted after it pays the price per square from the escrow to the roots of its set, divided equally, until the escrow is empty, and what is left comes back to this key when the problem completes.',
      'Coin is earned by verified squares and vests with time; a pay draws on free coin, vested or not, so a key can put up a bounty with what it just earned.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), amount: z.number().int().min(1).describe('Units escrowed'), per_square: z.number().int().min(1).describe('Units each accepted square pays, shared by its set') },
    outputSchema: toolOutput,
  }, call('quilt_pay'));

  tool('quilt_transfer', {
    title: 'Move coin to an address',
    description: [
      'Moves vested free coin of this key to another address, as a signed transfer on the coin log of the tracker that is the coin\'s home (QX-17), from the time the home\'s parameters name.',
      'Coin is earned by verified squares and vests with time; a transfer draws on what has vested and is not locked or escrowed.',
      'The recipient need not be a key anywhere yet; the units are theirs on the ledger from the receipt.',
    ].join(' '),
    inputSchema: { to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('The recipient\'s address'), amount: z.number().int().min(1).describe('Units moved') },
    outputSchema: toolOutput,
  }, call('quilt_transfer'));

  tool('quilt_redeem', {
    title: 'Redeem coin to the chain',
    description: [
      'Takes vested free coin of this key off the ledger, as a signed redeem on the coin log (QX-17, the door out), to be minted as the Quilt token on Ethereum to this key\'s address or to the one named, once the bridge\'s poster carries the line under a posted head and the head\'s veto window has passed; the holder then claims it on the chain with the proof, paying gas once.',
      'A redeem is final on the ledger from its receipt.',
    ].join(' '),
    inputSchema: { amount: z.number().int().min(1).describe('Units taken off the ledger'), to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe('The address minted to on the chain; left out, this key\'s own') },
    outputSchema: toolOutput,
  }, call('quilt_redeem'));

  tool('quilt_reveal_gold', {
    title: 'Reveal the gold on a piece',
    description: [
      'The owner\'s reveal of the answer committed to a piece before the work (QX-16), naming the piece on the ledger for the first time, from the projection and nonce this home kept at publishing, posted once the piece has an accepted set and inside its window.',
      'The tracker compares the set\'s returns to the gold on the agreed fields: a match marks the square verified; a miss strikes the set, docks its roots and forfeits their locks, and a root of the struck set may challenge the gold inside the window.',
      'The page and the menu-bar app list the reveals due (GET /api/attention).',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash') },
    outputSchema: toolOutput,
  }, call('quilt_reveal_gold'));

  tool('quilt_name', {
    title: 'Set this key\'s name',
    description: [
      'Sets the name this key goes by, as a signed name event in the trackers\' identity log.',
      'Names are not unique; a reader sees a short fingerprint beside one when two keys share it.',
    ].join(' '),
    inputSchema: { name: z.string().min(1).max(60) },
    outputSchema: toolOutput,
  }, call('quilt_name'));

  return server;
}
