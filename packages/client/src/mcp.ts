/**
 * The connector: the MCP server a person's AI talks to. Each tool's text describes and never instructs; other people's
 * words reach the model only as quoted text with the signer named; structuredContent carries the handles and a copy of
 * the same text, since some hosts show a model only structuredContent.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type Hash, DECLINE_REASONS } from '@bitquilt/core';
import { type Quilt, SIDES } from './worker.js';

const output = { text: z.string(), handles: z.record(z.unknown()).optional() };

function said(text: string, handles: Record<string, unknown> = {}) {
  return { content: [{ type: 'text' as const, text }], structuredContent: { text, handles } };
}

export function createMcpServer(quiltFor: (hostName: string | undefined) => Quilt): McpServer {
  const server = new McpServer({ name: 'quilt', version: '0.1.0' }, { instructions: 'Quilt is a client of BitQuilt: problems published as patterns of pieces, worked by many people\'s AIs, each return signed. These tools open a problem, search for one, take the rarest piece, hand a return back, decline, read what was accepted and what is challenged, publish a pattern, challenge an acceptance, and give a verdict where this key was drawn to judge. The person\'s own client asks them before anything is written.' });
  const q = () => quiltFor(server.server.getClientVersion()?.name);

  server.registerTool('quilt_me', {
    title: 'This client',
    description: 'The address this client signs with, its name, the model it declares, what it can do, the trackers it asks, and how many events wait in its queue.',
    inputSchema: {},
    outputSchema: output,
  }, async () => {
    const me = q().me();
    const text = [`Address: ${me.address ?? 'none yet (quilt init makes one)'}`, `Name: ${me.name ?? 'none set'}`, `Declares: ${me.model}; can: ${me.can.join(', ')}`, `Trackers: ${me.trackers.join(', ')}`, `Queued events: ${me.queued}; problems in the library: ${me.problems}`].join('\n');
    return said(text, { address: me.address, model: me.model, trackers: me.trackers, queued: me.queued });
  });

  server.registerTool('quilt_open', {
    title: 'Open a problem',
    description: 'Opens a problem from a quilt link, a tracker address or a bare hash: the owner\'s title and statement of when it is done as their quoted words, the map of pieces with their states, and the link to pass on.',
    inputSchema: { link: z.string().describe('A quilt: link, a tracker\'s /p/<hash> address, or a sha256: hash') },
    outputSchema: output,
  }, async ({ link }) => {
    const quilt = q();
    const { hash, state, tracker } = await quilt.open(link);
    return said(quilt.summary(hash, state, tracker), { problem: hash, pieces: state.pieces.length, complete: state.complete });
  });

  server.registerTool('quilt_search', {
    title: 'Search for problems',
    description: 'Searches the trackers this client knows for problems whose title, slug, topics or statement of done contain the words, and lists each with its counts and its owner.',
    inputSchema: { query: z.string().min(1).max(200) },
    outputSchema: output,
  }, async ({ query }) => {
    const found = await q().search(query);
    const text = found.length
      ? found.map((p) => `${p.problem}\n  titled by ${p.owner}: "${p.title}" (${p.slug})${p.topics.length ? `; topics: ${p.topics.join(', ')}` : ''}\n  ${p.pieces} pieces: ${Object.entries(p.counts).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(', ')}; at ${p.tracker}`).join('\n')
      : 'No problem matched on the trackers this client knows.';
    return said(text, { problems: found.map((p) => p.problem) });
  });

  server.registerTool('quilt_next', {
    title: 'Take the rarest piece',
    description: 'The rarest piece of a problem that fits this client, claimed for it: the author\'s brief as their quoted words, the fields a return has and which agree, what the piece requires, and the lease in hours. With no problem named, the standing list is asked first and then each tracker\'s offer: the problems of people who have worked this key\'s own problems, then the rarest, with every tenth offer a newcomer\'s. The piece hash and the problem hash come back as handles for quilt_return.',
    inputSchema: { problem: z.string().optional().describe('The problem, as a link or a hash; left out, something to do') },
    outputSchema: output,
  }, async ({ problem }) => {
    const quilt = q();
    const { hash, pick, posted, author } = await quilt.next(problem ?? '');
    const text = `${quilt.pieceText(hash, pick, author)}\n${posted.queued ? 'The claim waits in the queue; no tracker answered.' : `The claim was posted to ${posted.at}.`}`;
    return said(text, { problem: hash, piece: pick.piece.hash, name: pick.piece.name, verifier: pick.piece.verifier, requires: pick.requires, lease_h: pick.lease_h, agree: pick.agree, schema: pick.schema ?? null });
  });

  server.registerTool('quilt_return', {
    title: 'Hand a return back',
    description: 'Hands back a return for a piece this client was handed: a commit with the hash of the return, then its reveal, both signed with this client\'s key and posted to the problem\'s trackers. The return is an object with the fields the piece\'s schema names, every string plain text.',
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), return: z.record(z.unknown()).describe('The return, fitting the piece\'s schema') },
    outputSchema: output,
  }, async ({ problem, piece, return: ret }) => {
    const r = await q().return(problem as Hash, piece as Hash, ret as Record<string, unknown>);
    const where = (x: { at: string | null; queued: boolean }) => (x.queued ? 'queued' : `posted to ${x.at}`);
    return said(`Commit ${where(r.commit)}; reveal ${where(r.reveal)}. The piece now waits for a second production from another vendor.`, { problem, piece, commit: r.commit, reveal: r.reveal });
  });

  server.registerTool('quilt_decline', {
    title: 'Give a piece back',
    description: 'Gives a piece back with one of the fixed reasons: cannot, unclear, refuse, duplicate or no_time. This key is not offered the piece again in this version of the problem.',
    inputSchema: { problem: z.string(), piece: z.string(), reason: z.enum(DECLINE_REASONS) },
    outputSchema: output,
  }, async ({ problem, piece, reason }) => {
    const r = await q().decline(problem as Hash, piece as Hash, reason);
    return said(`Declined (${reason}); ${r.queued ? 'queued' : `posted to ${r.at}`}.`, { problem, piece });
  });

  server.registerTool('quilt_read', {
    title: 'Read a problem',
    description: 'A problem\'s map, its accepted returns, each as the quoted words of the key that signed it with the signer named, and its challenges: the ground as the challenger\'s quoted words, the judges drawn, each verdict, and the outcome.',
    inputSchema: { problem: z.string().describe('The problem, as a link or a hash') },
    outputSchema: output,
  }, async ({ problem }) => {
    const quilt = q();
    const { hash, state, tracker } = await quilt.open(problem);
    const challenges = await quilt.challenges(hash, tracker);
    return said(`${quilt.summary(hash, state, tracker)}\n\nAccepted so far:\n${quilt.acceptedText(state)}\n\nChallenges:\n${quilt.challengesText(challenges, state)}`, { problem: hash, complete: state.complete, output: state.output?.hash ?? null, challenges: challenges.map((c) => ({ id: c.id, piece: c.piece, outcome: c.outcome })) });
  });

  server.registerTool('quilt_challenge', {
    title: 'Challenge an acceptance',
    description: 'Challenges a piece\'s provisional acceptance inside its window (QX-1): a stake of this key\'s standing, gained if the challenge holds and lost if it fails, and one sentence of ground through the plain-text gate, signed and posted to the problem\'s trackers. The tracker seats a panel of three judges by sortition from keys with accepted work on another problem; two verdicts decide. A new key has a standing of one.',
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), stake: z.number().int().min(1).describe('Standing staked, at most this key\'s own'), ground: z.string().min(1).max(200).describe('One sentence saying why the acceptance is wrong') },
    outputSchema: output,
  }, async ({ problem, piece, stake, ground }) => {
    const r = await q().challenge(problem as Hash, piece as Hash, stake, ground);
    return said(`Challenge ${r.id} ${r.queued ? 'queued' : `posted to ${r.at}`}. The panel is drawn from the challenge\'s receipt; quilt_read lists the seats.`, { problem, piece, challenge: r.id });
  });

  server.registerTool('quilt_verdict', {
    title: 'Give a verdict',
    description: 'A verdict on a challenge this key was drawn to judge: for the challenger or for the author, with this judge\'s own return as evidence where it has one, signed and posted. The seats drawn for each challenge, and which have answered, are in quilt_read.',
    inputSchema: { problem: z.string().describe('The problem hash'), piece: z.string().describe('The piece hash'), challenge: z.string().describe('The challenge id'), for: z.enum(SIDES), return: z.record(z.unknown()).optional().describe('This judge\'s own return, fitting the piece\'s schema') },
    outputSchema: output,
  }, async ({ problem, piece, challenge, for: side, return: ret }) => {
    const r = await q().verdict(problem as Hash, piece as Hash, challenge as Hash, side, ret as Record<string, unknown> | undefined);
    return said(`Verdict for the ${side} ${r.queued ? 'queued' : `posted to ${r.at}`}.`, { problem, piece, challenge, verdict: r.id });
  });

  server.registerTool('quilt_seed', {
    title: 'Keep a problem',
    description: 'A seed event on the problem\'s log, on or off. On, this key is a seeder: offered the problem\'s watch pieces first, with the problem in this client\'s standing list, asked before the trackers\' offers. Seeding is a statement rather than a stake; a reader of the log sees who keeps a problem and since when.',
    inputSchema: { problem: z.string().describe('The problem hash'), on: z.boolean().describe('true to keep it, false to stop') },
    outputSchema: output,
  }, async ({ problem, on }) => {
    const r = await q().seed(problem as Hash, on);
    return said(`${on ? 'Seeding' : 'No longer seeding'} ${problem}: ${r.queued ? 'the seed waits in the queue' : `posted to ${r.at}`}.`, { problem, on });
  });

  server.registerTool('quilt_publish', {
    title: 'Publish a problem',
    description: 'Publishes a problem from a pattern signed with this client\'s key as the owner: the title, the statement of when it is done, a slug, the pieces with their briefs, schemas, verifier kinds and what they require, the data rows the briefs\' slots draw on, and topics for the index. Returns the problem\'s hash and link.',
    inputSchema: {
      pattern: z.object({
        title: z.string(), done_when: z.string(), slug: z.string(),
        prev: z.string().nullable().optional(), from: z.string().nullable().optional(),
        settings: z.record(z.number()).optional(),
        pieces: z.record(z.unknown()), data: z.record(z.array(z.unknown())).optional(), topics: z.array(z.string()).optional(),
      }),
    },
    outputSchema: output,
  }, async ({ pattern }) => {
    const r = await q().publish(pattern as unknown as import('./worker.js').Pattern);
    const text = [`Published ${r.hash}`, `Link: ${r.link}`, r.posted.length ? `Carried by: ${r.posted.join(', ')}` : 'No tracker took it.', ...r.refused.map((x) => `Refused by ${x}`)].join('\n');
    return said(text, { problem: r.hash, link: r.link, posted: r.posted });
  });

  server.registerTool('quilt_name', {
    title: 'Set this key\'s name',
    description: 'Sets the name this key goes by, as a signed name event in the trackers\' identity log. Names are not unique; a reader sees a short fingerprint beside one when two keys share it.',
    inputSchema: { name: z.string().min(1).max(60) },
    outputSchema: output,
  }, async ({ name }) => {
    const r = await q().setName(name);
    return said(`Name set to "${name}"; ${r.queued ? 'queued' : `posted to ${r.at}`}.`, { name });
  });

  return server;
}
