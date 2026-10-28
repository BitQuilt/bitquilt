/**
 * The connector: the MCP server a person's AI talks to. Each tool's text describes and never instructs; other people's
 * words reach the model only as quoted text with the signer named; structuredContent carries the handles and a copy of
 * the same text, since some hosts show a model only structuredContent. The long texts here are written one sentence a
 * line and joined with a space, so a sentence can be read and changed on its own.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DECLINE_REASONS } from '@bitquilt/core';
import { SIDES } from './listings.js';
import { ARG_WORDS, PHRASES, type PhraseArg } from './phrases.js';
import { type ToolInput, type ToolName, type ToolResult, type ToolRunner } from './tools.js';

/** What every tool answers with: the text a model reads, and the handles a card uses (a problem hash, a piece hash, where a post went). */
const toolOutput = { text: z.string(), handles: z.record(z.unknown()).optional() };

function said({ text, handles }: ToolResult) {
  return { content: [{ type: 'text' as const, text }], structuredContent: { text, handles } };
}

const instructions = [
  'Quilt is a client of BitQuilt: problems published as patterns of pieces, worked by many people\'s AIs, each return signed.',
  'These tools open a problem, search for one, take the rarest piece, hand a return back, decline, read what was accepted, what is challenged and what a panel is ranking, publish a pattern, challenge an acceptance, give a verdict where this key was drawn to judge a challenge, rank the candidates of a judge piece where it sits on the panel, and, where a tracker carries the coin, pay a problem\'s workers, move coin to an address, and redeem coin to the chain.',
  'Each piece names its verifier kind and how strongly that kind earns a square; an attest piece is the actor\'s own word and the weakest.',
  'The prompts are the sentences a person says to start each of these, in their own words.',
  'The person\'s own client asks them before anything is written.',
].join(' ');

export interface McpServerOptions {
  /** Called once the client has finished its handshake, with the host's name: the record the menu bar reads as an AI having connected (phrases.ts). */
  connected?: (host: string | null) => void;
}

/**
 * The server over a runner: alone, the runner is `localRunner` over this process's Quilt; through a node already
 * holding this home's page, it is `remoteRunner` (node.ts). Each tool's schema and words are here; its work is in
 * tools.ts. The prompts are the phrases (phrases.ts), one each, with what each takes asked for by the chat.
 */
export function createMcpServer(run: ToolRunner, options: McpServerOptions = {}): McpServer {
  const server = new McpServer({ name: 'quilt', version: '0.1.0' }, { instructions });
  const call = (name: ToolName) => async (input: ToolInput) => said(await run(name, input, server.server.getClientVersion()?.name));
  if (options.connected) {
    const connected = options.connected;
    server.server.oninitialized = () => connected(server.server.getClientVersion()?.name ?? null);
  }

  for (const p of PHRASES) {
    const argsSchema: Record<string, z.ZodString> = {};
    for (const a of p.args) argsSchema[a] = z.string().min(1).describe(ARG_WORDS[a]);
    server.registerPrompt(p.name, { title: p.title, description: p.about, argsSchema }, (args) => {
      const given: Record<PhraseArg, string> = { link: '', words: '', path: '', amount: '', per_square: '', to: '', ...(args as Partial<Record<PhraseArg, string>>) };
      return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text: p.say(given) } }] };
    });
  }

  server.registerTool('quilt_me', {
    title: 'This client',
    description: 'The address this client signs with, its name, the model it declares, what it can do, the trackers it asks, how many events wait in its queue, from the first tracker that answers its standing (what it has, what is locked behind its claims under QX-15, what is free to stake), and, where a tracker carries the coin (QX-17), its coin: the balance in units, what has vested, what is locked or escrowed, and what is free.',
    inputSchema: {},
    outputSchema: toolOutput,
  }, call('quilt_me'));

  server.registerTool('quilt_open', {
    title: 'Open a problem',
    description: 'Opens a problem from a quilt link, a tracker address or a bare hash: the owner\'s title and statement of when it is done as their quoted words, the map of pieces with their states, the verifier kinds and how strongly each earns a square, and the link to pass on.',
    inputSchema: { link: z.string().describe('A quilt: link, a tracker\'s /p/<hash> address, or a sha256: hash') },
    outputSchema: toolOutput,
  }, call('quilt_open'));

  server.registerTool('quilt_search', {
    title: 'Search for problems',
    description: 'Searches the trackers and the relays this client knows for problems whose title, slug, topics or statement of done contain the words, and lists each with its counts and its owner; a result from a relay names the tracker to open it from.',
    inputSchema: { query: z.string().min(1).max(200) },
    outputSchema: toolOutput,
  }, call('quilt_search'));

  server.registerTool('quilt_next', {
    title: 'Take the rarest piece',
    description: [
      'The rarest piece of a problem that fits this client, claimed for it: its verifier kind and how strongly that kind earns a square, the author\'s brief as their quoted words, the fields a return has and which must agree, what the piece requires, and the lease in hours.',
      'With no problem named, the standing list is asked first and then each tracker\'s offer: the problems of people who have worked this key\'s own problems, then the rarest, with every tenth offer a newcomer\'s.',
      'Where the problem asks a stake of the piece (QX-15), a lock of that much of this key\'s standing is posted before the claim; it is released when the window closes and forfeited if the acceptance is struck.',
      'A piece the key\'s free standing cannot cover is not offered, except where the tracker carries the coin (QX-17) and this key\'s free coin covers the stake at the burn rate: then coin is locked on the coin log in its place.',
      'The piece hash and the problem hash come back as handles for quilt_return.',
    ].join(' '),
    inputSchema: { problem: z.string().optional().describe('The problem, as a link or a hash; left out, something to do') },
    outputSchema: toolOutput,
  }, call('quilt_next'));

  server.registerTool('quilt_return', {
    title: 'Hand a return back',
    description: [
      'Hands back a return for a piece this client was handed: a commit with the hash of the return, then its reveal, both signed with this client\'s key and posted to the problem\'s trackers.',
      'The return is an object with the fields the piece\'s schema names, every string plain text.',
      'What the piece waits for next depends on its kind: another vendor\'s agreement, a second person, a panel\'s ranking, or nothing, for an attest piece, which is accepted at once on this record.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), return: z.record(z.unknown()).describe('The return, fitting the piece\'s schema') },
    outputSchema: toolOutput,
  }, call('quilt_return'));

  server.registerTool('quilt_decline', {
    title: 'Give a piece back',
    description: [
      'Gives a piece back with one of the fixed reasons: cannot, unclear, refuse, duplicate or no_time.',
      'This key is not offered the piece again in this version of the problem.',
    ].join(' '),
    inputSchema: { problem: z.string(), piece: z.string(), reason: z.enum(DECLINE_REASONS) },
    outputSchema: toolOutput,
  }, call('quilt_decline'));

  server.registerTool('quilt_read', {
    title: 'Read a problem',
    description: 'A problem\'s map with its kinds, the stake it asks and the gold its owner committed (how many squares are verified, missed or awaiting the reveal), its accepted returns, each as the quoted words of the key that signed it with the signer named and a verified square said so, its challenges (the ground as the challenger\'s quoted words, the judges drawn, each verdict, the outcome), and its judge panels (each candidate\'s return quoted, the seats drawn, each rank, the outcome).',
    inputSchema: { problem: z.string().describe('The problem, as a link or a hash') },
    outputSchema: toolOutput,
  }, call('quilt_read'));

  server.registerTool('quilt_rank', {
    title: 'Rank a judge piece\'s candidates',
    description: [
      'A ranking of a judge piece\'s candidates (QX-2) by a key drawn to its panel: every candidate\'s digest once, first choice first, signed and posted to the problem\'s trackers.',
      'The panels this key sits on, each candidate\'s return quoted beside its digest, and which seats have ranked are in quilt_read; the candidate a majority of the panel ranks first is accepted.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), ranking: z.array(z.string()).min(1).describe('The candidates\' digests, first choice first, each once') },
    outputSchema: toolOutput,
  }, call('quilt_rank'));

  server.registerTool('quilt_challenge', {
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

  server.registerTool('quilt_verdict', {
    title: 'Give a verdict',
    description: [
      'A verdict on a challenge this key was drawn to judge: for the challenger or for the author, with this judge\'s own return as evidence where it has one, signed and posted.',
      'The seats drawn for each challenge, and which have answered, are in quilt_read.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), challenge: z.string().describe('The challenge id'), for: z.enum(SIDES), return: z.record(z.unknown()).optional().describe('This judge\'s own return, fitting the piece\'s schema') },
    outputSchema: toolOutput,
  }, call('quilt_verdict'));

  server.registerTool('quilt_seed', {
    title: 'Keep a problem',
    description: [
      'A seed event on the problem\'s log, on or off.',
      'On, this key is a seeder: offered the problem\'s watch pieces first, with the problem in this client\'s standing list, asked before the trackers\' offers.',
      'Seeding is a statement rather than a stake; a reader of the log sees who keeps a problem and since when.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), on: z.boolean().describe('true to keep it, false to stop') },
    outputSchema: toolOutput,
  }, call('quilt_seed'));

  server.registerTool('quilt_publish', {
    title: 'Publish a problem',
    description: [
      'Publishes a problem from a pattern signed with this client\'s key as the owner: the title, the statement of when it is done, a slug, the pieces with their briefs, schemas, verifier kinds and what they require, the data rows the briefs\' slots draw on, topics for the index, where the owner asks it the stake of standing a claim on the pieces is backed by (QX-15), and where the owner knows some answers in advance the gold (QX-16): each answer committed by hash before the work, bound to its piece inside the commitment so the ledger shows how many answers are committed and not which pieces, backed by a stake of the owner\'s standing, kept in this home\'s library for the reveal.',
      'Returns the problem\'s hash and link.',
    ].join(' '),
    inputSchema: {
      pattern: z.object({
        title: z.string(), done_when: z.string(), slug: z.string(),
        prev: z.string().nullable().optional(), from: z.string().nullable().optional(),
        settings: z.record(z.number()).optional(),
        pieces: z.record(z.unknown()), data: z.record(z.array(z.unknown())).optional(), topics: z.array(z.string()).optional(),
        stake: z.object({ min: z.number().int().min(0).describe('The standing a claim locks; 0 asks nothing'), pieces: z.array(z.string()).optional().describe('The families or pieces it covers; left out, every piece') }).optional(),
        gold: z.object({ answers: z.record(z.record(z.unknown())).describe('Piece names to the owner\'s answers; each is projected to the piece\'s agreed fields'), stake: z.number().int().min(1).optional().describe('The owner\'s standing locked behind the gold; left out, the sum of the pieces\' shares') }).optional(),
      }),
    },
    outputSchema: toolOutput,
  }, call('quilt_publish'));

  server.registerTool('quilt_pay', {
    title: 'Pay a problem\'s workers in coin',
    description: [
      'Escrows coin of this key to a problem, on the coin log of the tracker that is the coin\'s home (QX-17): each square accepted after it pays the price per square from the escrow to the roots of its set, divided equally, until the escrow is empty, and what is left comes back to this key when the problem completes.',
      'Coin is earned by verified squares and vests with time; a pay draws on free coin, vested or not, so a key can put up a bounty with what it just earned.',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), amount: z.number().int().min(1).describe('Units escrowed'), per_square: z.number().int().min(1).describe('Units each accepted square pays, shared by its set') },
    outputSchema: toolOutput,
  }, call('quilt_pay'));

  server.registerTool('quilt_transfer', {
    title: 'Move coin to an address',
    description: [
      'Moves vested free coin of this key to another address, as a signed transfer on the coin log of the tracker that is the coin\'s home (QX-17), from the time the home\'s parameters name.',
      'Coin is earned by verified squares and vests with time; a transfer draws on what has vested and is not locked or escrowed.',
      'The recipient need not be a key anywhere yet; the units are theirs on the ledger from the receipt.',
    ].join(' '),
    inputSchema: { to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).describe('The recipient\'s address'), amount: z.number().int().min(1).describe('Units moved') },
    outputSchema: toolOutput,
  }, call('quilt_transfer'));

  server.registerTool('quilt_redeem', {
    title: 'Redeem coin to the chain',
    description: [
      'Takes vested free coin of this key off the ledger, as a signed redeem on the coin log (QX-17, the door out), to be minted as the Quilt token on Ethereum to this key\'s address or to the one named, once the bridge\'s poster carries the line under a posted head and the head\'s veto window has passed; the holder then claims it on the chain with the proof, paying gas once.',
      'A redeem is final on the ledger from its receipt.',
    ].join(' '),
    inputSchema: { amount: z.number().int().min(1).describe('Units taken off the ledger'), to: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe('The address minted to on the chain; left out, this key\'s own') },
    outputSchema: toolOutput,
  }, call('quilt_redeem'));

  server.registerTool('quilt_reveal_gold', {
    title: 'Reveal the gold on a piece',
    description: [
      'The owner\'s reveal of the answer committed to a piece before the work (QX-16), naming the piece on the ledger for the first time, from the projection and nonce this home kept at publishing, posted once the piece has an accepted set and inside its window.',
      'The tracker compares the set\'s returns to the gold on the agreed fields: a match marks the square verified; a miss strikes the set, docks its roots and forfeits their locks, and a root of the struck set may challenge the gold inside the window.',
      'The page and the menu-bar app list the reveals due (GET /api/attention).',
    ].join(' '),
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash') },
    outputSchema: toolOutput,
  }, call('quilt_reveal_gold'));

  server.registerTool('quilt_name', {
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
