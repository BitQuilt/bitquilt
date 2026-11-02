import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, signEvent } from '@bitquilt/core';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { KIND, announcementEvent, readAnnouncement, searchFilters, searchRelays, findOnRelays } from '../src/relay.js';
import { Resolver } from '../src/resolver.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { hex, quiltOver, startTracker, tempHome } from './helpers.js';
import { startRelay } from './relay-server.js';

/**
 * QX-14: a publish reaches the relays as a signed event of its own; a client with no tracker finds the problem there
 * and can open it from the tracker the announce named; a relay event that fails any check is dropped. And QX-13: the
 * announce states the owner, the fork, the pieces, the counts and the work; the owner's turn announces again once the
 * work has moved and not while it has not; a search merges the tracker's row and the relay's announce as one problem
 * held at both; a slow relay's events are kept, a topic is asked by its tag, a gated title is dropped, and the owner's
 * announce is kept over a seeder's.
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
  it('opens a bare hash with no tracker configured: the relays name where the problem is held, and the places learned serve the rest of the session (QX-14 section 3)', async () => {
    // A finder of its own, so nothing is in its cache: the hash alone, no tracker, the relay knows where it is held.
    const home = tempHome('quilt-finder-bare-');
    createKey(home, { secretHex: hex(5) });
    const config: Config = { ...DEFAULT_CONFIG, trackers: [], relays: [relay.url] };
    const bare = new Quilt(config, loadKey(home), new Resolver(config, home), 'Claude Code');
    expect(await findOnRelays([relay.url], problem)).toMatchObject([{ problem, trackers: [base], announcer: owner.identity!.address }]);
    const opened = await bare.open(problem);
    expect(opened.hash).toBe(problem);
    expect(opened.tracker).toBe(base);
    expect(opened.state.pieces).toHaveLength(2);
    expect(bare.resolver.places({ trackers: [], mirrors: [] })).toEqual([{ url: base, kind: 'tracker' }]);
    // A hash no relay knows opens nothing, and the relays are asked once for it.
    const unknown = `sha256:${'0'.repeat(64)}` as Hash;
    await expect(bare.open(unknown)).rejects.toThrow();
    expect(await findOnRelays([relay.url], unknown)).toEqual([]);
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
    // That event is dated a minute ahead, and a relay keeps the latest, so an announce made now could not replace it; put the present one back.
    relay.events.set(`${good.pubkey}:${good.kind}:${problem}`, good);
  });
  it('states the owner, the fork, the pieces, the counts and the work at publish (QX-13)', () => {
    const ev = [...relay.events.values()][0]!;
    const body = (JSON.parse(ev.content) as { body: Record<string, unknown> }).body;
    expect(body).toMatchObject({ owner: owner.identity!.address, from: null, pieces: 2, counts: { open: 2 }, work: { returned: 0, accepted: 0, verified: 0, disputed: 0, traced: { both: 0, one: 0, none: 0 }, readers: 0, vendors: 0, last: null } });
    expect(readAnnouncement(ev, relay.url)).toMatchObject({ owner: owner.identity!.address, announcer: owner.identity!.address, from: null, pieces: 2, counts: { open: 2 }, work: { returned: 0 } });
  });
  it("announces again from the owner's turn once the work has moved, with the tracker's row and the same topics, and not again while it has not; a search then names the problem once, held at the tracker and the relay", async () => {
    const mk = quiltOver(base);
    const a = mk(2, 'anthropic/claude');
    const b = mk(3, 'openai/gpt-5', 'ChatGPT');
    const piece = (await a.open(problem)).state.pieces[0]!.piece.hash;
    await a.return(problem, piece, { verdict: 'supports', quote: 'q' });
    await b.return(problem, piece, { verdict: 'supports', quote: 'q' });
    expect(await owner.announceDue()).toEqual([problem]);
    const body = (JSON.parse([...relay.events.values()][0]!.content) as { body: { owner: string; topics: string[]; work: { accepted: number; readers: number; vendors: number } } }).body;
    expect(body).toMatchObject({ owner: owner.identity!.address, topics: ['citations', 'reading'], work: { accepted: 1, readers: 2, vendors: 2 } });
    expect(await owner.announceDue()).toEqual([]);
    expect(owner.library.problems[problem]!.announced?.mark).toBe('1/1/0/0/2');
    const found = await owner.search('reading');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ problem, via: 'tracker', held: [base, relay.url], root: problem, from: null, announcer: null });
    expect(found[0]!.work).toMatchObject({ accepted: 1, readers: 2 });
    // The finder, with the relay alone, reads the same numbers from the announce, and says who announced and when.
    const afar = await finder.search('reading');
    expect(afar[0]).toMatchObject({ problem, via: 'relay', held: [relay.url], announcer: owner.identity!.address });
    expect(afar[0]!.work).toMatchObject({ accepted: 1 });
    expect(afar[0]!.announced).toMatch(/^20/);
  });
  it("keeps what a slow relay sent before the deadline, asks a topic by its tag, drops an announce whose words fail the gate, and keeps the owner's announce over a seeder's", async () => {
    const slow = await startRelay({ holdEose: true });
    const ev = [...relay.events.values()][0]!;
    const put = (url: string, e: unknown) => new Promise<void>((resolve) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => ws.send(JSON.stringify(['EVENT', e])));
      ws.addEventListener('message', () => { ws.close(); resolve(); });
    });
    await put(slow.url, ev);
    const got = await searchRelays([slow.url], 'reading', 400);
    expect(got.map((x) => x.problem)).toEqual([problem]);
    expect(slow.requests.at(-1)).toEqual([{ kinds: [KIND], limit: 200 }, { kinds: [KIND], '#t': ['reading'], limit: 200 }]);
    expect(searchFilters('two words', 10)).toEqual([{ kinds: [KIND], limit: 10 }]);
    await slow.close();
    // A title with an address in it: every signature holds, and the reader drops it all the same, since a relay admits anything.
    const bad = signEvent({ quilt: 1, type: 'announce', problem, key: owner.identity!.address, ts: new Date().toISOString(), body: { title: 'See https://example.org now', slug: pattern.slug, done_when: pattern.done_when, topics: [], trackers: [base], mirrors: [] } }, owner.identity!.secret);
    expect(readAnnouncement(announcementEvent(bad, owner.identity!.secret), relay.url)).toBeNull();
    // A seeder's announce, later than the owner's and naming the owner: the owner's is the one kept.
    const seeded = signEvent({ quilt: 1, type: 'announce', problem, key: finder.identity!.address, ts: new Date().toISOString(), body: { title: pattern.title, slug: pattern.slug, done_when: pattern.done_when, topics: ['reading', 'seeded'], owner: owner.identity!.address, trackers: [base], mirrors: [] } }, finder.identity!.secret);
    await put(relay.url, announcementEvent(seeded, finder.identity!.secret, ev.created_at + 600));
    expect(relay.events.size).toBe(2);
    const found = await searchRelays([relay.url], 'reading');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ announcer: owner.identity!.address, owner: owner.identity!.address });
  });
});
