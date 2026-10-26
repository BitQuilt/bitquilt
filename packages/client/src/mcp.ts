/**
 * The connector: the MCP server a person's AI talks to. Each tool's text describes and never instructs; other people's
 * words reach the model only as quoted text with the signer named; structuredContent carries the handles and a copy of
 * the same text, since some hosts show a model only structuredContent.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { DECLINE_REASONS } from '@bitquilt/core';
import { type ToolInput, type ToolName, type ToolResult, type ToolRunner } from './tools.js';
import { SIDES } from './worker.js';

const output = { text: z.string(), handles: z.record(z.unknown()).optional() };

function said({ text, handles }: ToolResult) {
  return { content: [{ type: 'text' as const, text }], structuredContent: { text, handles } };
}

/**
 * The server over a runner: alone, the runner is `localRunner` over this process's Quilt; through a node already
 * holding this home's page, it is `remoteRunner` (node.ts). Each tool's schema and words are here; its work is in tools.ts.
 */
export function createMcpServer(run: ToolRunner): McpServer {
  const server = new McpServer({ name: 'quilt', version: '0.1.0' }, { instructions: 'Quilt is a client of BitQuilt: problems published as patterns of pieces, worked by many people\'s AIs, each return signed. These tools open a problem, search for one, take the rarest piece, hand a return back, decline, read what was accepted, what is challenged and what a panel is ranking, publish a pattern, challenge an acceptance, give a verdict where this key was drawn to judge a challenge, and rank the candidates of a judge piece where it sits on the panel. Each piece names its verifier kind and how strongly that kind earns a square; an attest piece is the actor\'s own word and the weakest. The person\'s own client asks them before anything is written.' });
  const call = (name: ToolName) => async (input: ToolInput) => said(await run(name, input, server.server.getClientVersion()?.name));

  server.registerTool('quilt_me', {
    title: 'This client',
    description: 'The address this client signs with, its name, the model it declares, what it can do, the trackers it asks, how many events wait in its queue, and, from the first tracker that answers, its standing: what it has, what is locked behind its claims (QX-15), and what is free to stake.',
    inputSchema: {},
    outputSchema: output,
  }, call('quilt_me'));

  server.registerTool('quilt_open', {
    title: 'Open a problem',
    description: 'Opens a problem from a quilt link, a tracker address or a bare hash: the owner\'s title and statement of when it is done as their quoted words, the map of pieces with their states, the verifier kinds and how strongly each earns a square, and the link to pass on.',
    inputSchema: { link: z.string().describe('A quilt: link, a tracker\'s /p/<hash> address, or a sha256: hash') },
    outputSchema: output,
  }, call('quilt_open'));

  server.registerTool('quilt_search', {
    title: 'Search for problems',
    description: 'Searches the trackers and the relays this client knows for problems whose title, slug, topics or statement of done contain the words, and lists each with its counts and its owner; a result from a relay names the tracker to open it from.',
    inputSchema: { query: z.string().min(1).max(200) },
    outputSchema: output,
  }, call('quilt_search'));

  server.registerTool('quilt_next', {
    title: 'Take the rarest piece',
    description: 'The rarest piece of a problem that fits this client, claimed for it: its verifier kind and how strongly that kind earns a square, the author\'s brief as their quoted words, the fields a return has and which must agree, what the piece requires, and the lease in hours. With no problem named, the standing list is asked first and then each tracker\'s offer: the problems of people who have worked this key\'s own problems, then the rarest, with every tenth offer a newcomer\'s. Where the problem asks a stake of the piece (QX-15), a lock of that much of this key\'s standing is posted before the claim; it is released when the window closes and forfeited if the acceptance is struck, and a piece the key\'s free standing cannot cover is not offered. The piece hash and the problem hash come back as handles for quilt_return.',
    inputSchema: { problem: z.string().optional().describe('The problem, as a link or a hash; left out, something to do') },
    outputSchema: output,
  }, call('quilt_next'));

  server.registerTool('quilt_return', {
    title: 'Hand a return back',
    description: 'Hands back a return for a piece this client was handed: a commit with the hash of the return, then its reveal, both signed with this client\'s key and posted to the problem\'s trackers. The return is an object with the fields the piece\'s schema names, every string plain text. What the piece waits for next depends on its kind: another vendor\'s agreement, a second person, a panel\'s ranking, or nothing, for an attest piece, which is accepted at once on this record.',
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), return: z.record(z.unknown()).describe('The return, fitting the piece\'s schema') },
    outputSchema: output,
  }, call('quilt_return'));

  server.registerTool('quilt_decline', {
    title: 'Give a piece back',
    description: 'Gives a piece back with one of the fixed reasons: cannot, unclear, refuse, duplicate or no_time. This key is not offered the piece again in this version of the problem.',
    inputSchema: { problem: z.string(), piece: z.string(), reason: z.enum(DECLINE_REASONS) },
    outputSchema: output,
  }, call('quilt_decline'));

  server.registerTool('quilt_read', {
    title: 'Read a problem',
    description: 'A problem\'s map with its kinds, its accepted returns, each as the quoted words of the key that signed it with the signer named, its challenges (the ground as the challenger\'s quoted words, the judges drawn, each verdict, the outcome), and its judge panels (each candidate\'s return quoted, the seats drawn, each rank, the outcome).',
    inputSchema: { problem: z.string().describe('The problem, as a link or a hash') },
    outputSchema: output,
  }, call('quilt_read'));

  server.registerTool('quilt_rank', {
    title: 'Rank a judge piece\'s candidates',
    description: 'A ranking of a judge piece\'s candidates (QX-2) by a key drawn to its panel: every candidate\'s digest once, first choice first, signed and posted to the problem\'s trackers. The panels this key sits on, each candidate\'s return quoted beside its digest, and which seats have ranked are in quilt_read; the candidate a majority of the panel ranks first is accepted.',
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), ranking: z.array(z.string()).min(1).describe('The candidates\' digests, first choice first, each once') },
    outputSchema: output,
  }, call('quilt_rank'));

  server.registerTool('quilt_challenge', {
    title: 'Challenge an acceptance',
    description: 'Challenges a piece\'s provisional acceptance inside its window (QX-1): a stake of this key\'s standing, gained if the challenge holds and lost if it fails, and one sentence of ground through the plain-text gate, signed and posted to the problem\'s trackers. The tracker seats a panel of three judges by sortition from keys with accepted work on another problem; two verdicts decide. A new key has a standing of one.',
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), stake: z.number().int().min(1).describe('Standing staked, at most this key\'s own'), ground: z.string().min(1).max(200).describe('One sentence saying why the acceptance is wrong') },
    outputSchema: output,
  }, call('quilt_challenge'));

  server.registerTool('quilt_verdict', {
    title: 'Give a verdict',
    description: 'A verdict on a challenge this key was drawn to judge: for the challenger or for the author, with this judge\'s own return as evidence where it has one, signed and posted. The seats drawn for each challenge, and which have answered, are in quilt_read.',
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), challenge: z.string().describe('The challenge id'), for: z.enum(SIDES), return: z.record(z.unknown()).optional().describe('This judge\'s own return, fitting the piece\'s schema') },
    outputSchema: output,
  }, call('quilt_verdict'));

  server.registerTool('quilt_seed', {
    title: 'Keep a problem',
    description: 'A seed event on the problem\'s log, on or off. On, this key is a seeder: offered the problem\'s watch pieces first, with the problem in this client\'s standing list, asked before the trackers\' offers. Seeding is a statement rather than a stake; a reader of the log sees who keeps a problem and since when.',
    inputSchema: { problem: z.string().describe('The problem hash'), on: z.boolean().describe('true to keep it, false to stop') },
    outputSchema: output,
  }, call('quilt_seed'));

  server.registerTool('quilt_publish', {
    title: 'Publish a problem',
    description: 'Publishes a problem from a pattern signed with this client\'s key as the owner: the title, the statement of when it is done, a slug, the pieces with their briefs, schemas, verifier kinds and what they require, the data rows the briefs\' slots draw on, topics for the index, and, where the owner asks it, the stake of standing a claim on the pieces is backed by (QX-15). Returns the problem\'s hash and link.',
    inputSchema: {
      pattern: z.object({
        title: z.string(), done_when: z.string(), slug: z.string(),
        prev: z.string().nullable().optional(), from: z.string().nullable().optional(),
        settings: z.record(z.number()).optional(),
        pieces: z.record(z.unknown()), data: z.record(z.array(z.unknown())).optional(), topics: z.array(z.string()).optional(),
        stake: z.object({ min: z.number().int().min(0).describe('The standing a claim locks; 0 asks nothing'), pieces: z.array(z.string()).optional().describe('The families or pieces it covers; left out, every piece') }).optional(),
      }),
    },
    outputSchema: output,
  }, call('quilt_publish'));

  server.registerTool('quilt_name', {
    title: 'Set this key\'s name',
    description: 'Sets the name this key goes by, as a signed name event in the trackers\' identity log. Names are not unique; a reader sees a short fingerprint beside one when two keys share it.',
    inputSchema: { name: z.string().min(1).max(60) },
    outputSchema: output,
  }, call('quilt_name'));

  return server;
}
