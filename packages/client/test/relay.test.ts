import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { KIND, announcementEvent, readAnnouncement } from '../src/relay.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { hex, quiltOver, startTracker, tempHome } from './helpers.js';
import { startRelay } from './relay-server.js';

/**
 * QX-14: a publish reaches the relays as a signed event of its own; a client with no tracker finds the problem there
 * and can open it from the tracker the announce named; a relay event that fails any check is dropped.
 */
let server: Server;
let base: string;
let relay: Awaited<ReturnType<typeof startRelay>>;
let owner: Quilt, finder: Quilt;
let problem: Hash;

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'paper-says',
  topics: ['citations', 'reading'],
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: {claim.text} Return whether the paper says this, with a quote.',
      data: { claim: 'claims' },
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
  data: { claims: [{ text: 'The coin is a chain of signatures.' }, { text: 'Difficulty never changes.' }] },
};

beforeAll(async () => {
  ({ server, base } = await startTracker());
  relay = await startRelay();
  owner = quiltOver(base, { relays: [relay.url] })(9);
  // The finder knows no tracker at all: only the relay.
  const finderHome = tempHome('quilt-finder-');
  createKey(finderHome, { secretHex: hex(1) });
  const finderConfig: Config = { ...DEFAULT_CONFIG, trackers: [], relays: [relay.url] };
  finder = new Quilt(finderConfig, loadKey(finderHome), new Resolver(finderConfig, finderHome), 'Claude Code');
});
afterAll(async () => {
  await relay.close();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('discovery over relays (QX-14)', () => {
  it('posts the announcement to the relay on publish, as one event per key and problem', async () => {
    const r = await owner.publish(pattern);
    problem = r.hash;
    expect(r.posted).toEqual([base]);
    expect(r.relays).toEqual([relay.url]);
    expect(relay.events.size).toBe(1);
    const ev = [...relay.events.values()][0]!;
    expect(ev.kind).toBe(KIND);
    expect(ev.tags).toContainEqual(['d', problem]);
    expect(ev.tags).toContainEqual(['t', 'citations']);
    expect(ev.pubkey).toHaveLength(64);
    expect(ev.sig).toHaveLength(128);
  });
  it('is found on the relay by a client with no tracker, with the tracker the announce named, and opens from there', async () => {
    const found = await finder.search('reading');
    expect(found).toHaveLength(1);
    expect(found[0]!.problem).toBe(problem);
    expect(found[0]!.via).toBe('relay');
    expect(found[0]!.tracker).toBe(base);
    expect(found[0]!.title).toBe(pattern.title);
    expect(await finder.search('nothing of the kind')).toHaveLength(0);
    const opened = await finder.open(`quilt:${problem}?tr=${encodeURIComponent(base)}`);
    expect(opened.hash).toBe(problem);
    expect(opened.state.pieces).toHaveLength(2);
  });
  it('drops a relay event whose signature, kind or problem tag does not hold, and keeps the latest per problem', async () => {
    const good = [...relay.events.values()][0]!;
    expect(readAnnouncement(good, relay.url)?.problem).toBe(problem);
    expect(readAnnouncement({ ...good, sig: good.sig.replace(/^./, good.sig[0] === 'a' ? 'b' : 'a') }, relay.url)).toBeNull();
    expect(readAnnouncement({ ...good, kind: 1 }, relay.url)).toBeNull();
    expect(readAnnouncement({ ...good, tags: good.tags.map((t) => (t[0] === 'd' ? ['d', 'sha256:' + '0'.repeat(64)] : t)) }, relay.url)).toBeNull();
    expect(readAnnouncement({ ...good, content: good.content.replace('"topics"', '"topicz"') }, relay.url)).toBeNull();
    // A later event for the same problem from the same key replaces the earlier one on the relay.
    const announce = JSON.parse(good.content);
    const later = announcementEvent(announce, owner.identity!.secret, good.created_at + 60);
    const ws = new WebSocket(relay.url);
    await new Promise<void>((resolve) => { ws.addEventListener('open', () => { ws.send(JSON.stringify(['EVENT', later])); }); ws.addEventListener('message', () => { ws.close(); resolve(); }); });
    expect(relay.events.size).toBe(1);
    expect([...relay.events.values()][0]!.id).toBe(later.id);
  });
});
