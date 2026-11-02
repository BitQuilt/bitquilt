import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, type Receipt, eventId, hashBytes, signEvent } from '@bitquilt/core';
import { type Pattern, Quilt } from '../src/quilt.js';
import { quiltOver, startTracker } from './helpers.js';

/**
 * The client's node as keeper (WORKSHOP.md section 2, stage one; PROTOCOL.md, The mirror): a node that opened a
 * problem holds its chain, and `keep` pulls it again from where it is held, keeps the lines that came since, fetches the
 * read a trace names so the node serves it, and keeps the identity log; a second tracker's chain for the same problem,
 * the same events in its own order, is read for the state it gives and not kept, since a node follows one place's
 * chain per problem; and a second keep adds nothing.
 */
let one: Server, two: Server;
let base: string, other: string;
let owner: Quilt, a: Quilt, b: Quilt, node: Quilt;
let problem: Hash, piece: Hash;

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?', done_when: 'Every statement has a verdict agreed by two vendors.', slug: 'paper-says',
  settings: { endgame_at: 1 },
  pieces: { 'statement/*': { count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } }, agree: ['verdict'] } },
};
const enc = new TextEncoder();
const PAGE = 'We define an electronic coin as a chain of digital signatures.';
const pageHash = hashBytes(enc.encode(PAGE));

beforeAll(async () => {
  ({ server: one, base } = await startTracker());
  ({ server: two, base: other } = await startTracker());
  const mk = quiltOver(base);
  owner = mk(9);
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  node = mk(5);
  problem = (await owner.publish(pattern)).hash;
  piece = (await node.open(problem)).state.pieces[0]!.piece.hash;
});
afterAll(async () => {
  await new Promise<void>((r) => one.close(() => r()));
  await new Promise<void>((r) => two.close(() => r()));
});

const linesAt = async (tracker: string): Promise<Receipt[]> => (await (await fetch(`${tracker}p/${problem}/events`)).text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt);

describe('the node keeps what it holds', () => {
  it('pulls the lines that came since it opened the problem, fetches the read a trace names, and serves both; a second keep adds nothing', async () => {
    // The publish put an announce and a version on the chain; the node holds those two from its open.
    expect(node.resolver.heldProblems().find((p) => p.problem === problem)!.lines).toBe(2);
    await a.return(problem, piece, { verdict: 'supports' });
    // A's trace, resting the verdict on a page the tracker holds; signed with A's key and posted by hand, since the node under test is not A.
    expect((await fetch(`${base}b/${pageHash}`, { method: 'PUT', body: enc.encode(PAGE) })).status).toBe(202);
    const reveal = (await linesAt(base)).find((l) => l.event.type === 'reveal' && l.event.key === a.identity!.address)!.event;
    const trace = signEvent({ quilt: 1, type: 'trace', problem, piece, key: a.identity!.address, ts: new Date().toISOString(), body: { reveal: eventId(reveal), reads: [{ url: 'https://example.org/paper', hash: pageHash, at: new Date().toISOString() }], rests: [{ field: 'verdict', read: 0, span: [0, 24] }] } }, a.identity!.secret);
    expect((await fetch(`${base}p/${problem}/events`, { method: 'POST', body: JSON.stringify(trace), headers: { 'content-type': 'application/json' } })).status).toBe(202);
    expect(node.resolver.cachedBlob(pageHash)).toBeNull();
    const kept = await node.resolver.keep();
    expect(kept).toMatchObject({ problems: 1, added: 3, reads: 1, refused: [] });
    expect(node.resolver.heldProblems().find((p) => p.problem === problem)!.lines).toBe(5);
    expect(node.resolver.cachedReceipts(problem).map((l) => l.event.type)).toEqual(['announce', 'version', 'commit', 'reveal', 'trace']);
    expect(new TextDecoder().decode(node.resolver.cachedBlob(pageHash)!)).toBe(PAGE);
    expect(await node.resolver.keep()).toMatchObject({ problems: 1, added: 0, reads: 0, refused: [] });
  });

  it('keeps the identity log too, and reads another tracker\'s chain for the same problem without keeping it, since it follows one place\'s chain', async () => {
    await owner.setName('Ada');
    const before = node.resolver.cachedIdentity().length;
    expect((await node.resolver.keep()).added).toBe(1);
    expect(node.resolver.cachedIdentity().length).toBe(before + 1);
    // The same problem on a second tracker, with B's reading there alone: its chain has other events in another order.
    const env = (await (await fetch(`${base}p/${problem}`)).json()) as unknown;
    expect((await fetch(`${other}p`, { method: 'POST', body: JSON.stringify({ envelope: env }), headers: { 'content-type': 'application/json' } })).status).toBe(201);
    const bOnTwo = quiltOver(other)(2, 'openai/gpt-5', 'ChatGPT');
    await bOnTwo.return(problem, piece, { verdict: 'supports' });
    const opened = await node.open(`quilt:${problem}?tr=${encodeURIComponent(other)}`);
    expect(opened.tracker).toBe(other);
    expect(opened.state.pieces[0]!.reveals.map((r) => r.root)).toEqual([b.identity!.address]);
    // Read, not kept: the cache still holds the first tracker's chain, and a keep pointed at the second says why.
    expect(node.resolver.cachedReceipts(problem).map((l) => l.event.type)).toEqual(['announce', 'version', 'commit', 'reveal', 'trace']);
    const notes: string[] = [];
    const read = await node.resolver.receipts(problem, { hash: problem, trackers: [other], mirrors: [] }, problem, (line) => notes.push(line));
    expect(read).toHaveLength(2);
    expect(notes).toEqual([expect.stringMatching(new RegExp(`^${problem}: chain from ${other} did not only grow: `))]);
    expect(node.resolver.cachedReceipts(problem)).toHaveLength(5);
    // The open put the second tracker first among the problem's places; a keep passes over its chain and its log, says so, and grows from the first as before.
    const again = await node.resolver.keep();
    expect(again).toMatchObject({ problems: 1, added: 0, reads: 0 });
    expect(again.refused).toHaveLength(2);
    expect(again.refused.every((r) => r.includes(other) && r.includes('did not only grow'))).toBe(true);
    expect(node.resolver.cachedReceipts(problem)).toHaveLength(5);
  });
});
