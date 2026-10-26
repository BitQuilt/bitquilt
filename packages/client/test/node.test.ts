import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { DEFAULT_CONFIG, createKey, loadKey, type Config } from '../src/config.js';
import { probeNode, remoteRunner } from '../src/node.js';
import { createPage } from '../src/page.js';
import { Resolver } from '../src/resolver.js';
import { localRunner, runTool } from '../src/tools.js';
import { type Pattern, Quilt } from '../src/worker.js';

/**
 * One node per home. A second copy of quilt finds the node holding this home's page by its key and works through it:
 * its tools run at /api/tool/<name> under the host it names, the claim is signed there, and the one library records
 * it. A node with another key is another home's. When the node goes away the copy works alone from then on. The API
 * refuses a browser's request from another site, and a one-shot command's write to the library is seen, not written
 * over.
 */
const hex = (n: number) => '00'.repeat(31) + n.toString(16).padStart(2, '0');
let tracker: Server;
let node: Server;
let port: number;
let site: string;
let config: Config;
const homes = { owner: mkdtempSync(join(tmpdir(), 'quilt-owner-')), a: mkdtempSync(join(tmpdir(), 'quilt-a-')) };
let owner: Quilt;
let problem: Hash;

const pattern: Pattern = {
  title: 'Headers, read twice',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'headers-twice',
  topics: ['reading'],
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: {claim.text}',
      data: { claim: 'claims' },
      schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } },
      agree: ['verdict'],
    },
    'seat/*': { count: 1, verifier: 'human', requires: [], brief: 'A person reads statement {n} and says whether the paper says so.', schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } }, agree: ['verdict'] },
  },
  data: { claims: [{ text: 'Headers are about 80 bytes.' }, { text: 'Difficulty never changes.' }] },
};

beforeAll(async () => {
  const t = createTracker({ store: new Store(':memory:'), url: 'http://tracker.test/', ipSalt: 's' });
  tracker = await t.listen(0);
  const addr = tracker.address();
  const base = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/` : '';
  config = { ...DEFAULT_CONFIG, trackers: [base] };
  createKey(homes.owner, { secretHex: hex(9) });
  createKey(homes.a, { secretHex: hex(1) });
  owner = new Quilt(config, loadKey(homes.owner), new Resolver(config, homes.owner), 'Claude Code');
  problem = (await owner.publish(pattern)).hash;
  // The node of home a: one resolver, the page's Quilt and the person's over it.
  const resolver = new Resolver(config, homes.a);
  const identity = loadKey(homes.a);
  const quilt = new Quilt(config, identity, resolver, undefined);
  const person = new Quilt({ ...config, model: 'human', can: ['person', 'web', 'files'] }, identity, resolver, 'human');
  node = await createPage({ quilt, person, resolver }).listen(0);
  const na = node.address();
  port = typeof na === 'object' && na ? na.port : 0;
  site = `http://127.0.0.1:${port}/`;
});

afterAll(async () => {
  await new Promise<void>((r) => node.close(() => r()));
  await new Promise<void>((r) => tracker.close(() => r()));
});

describe('one node per home', () => {
  it('is found by its key: mine with this home\'s address, other with another\'s, none where nothing listens', async () => {
    expect(await probeNode(port, loadKey(homes.a)!.address)).toEqual({ found: 'mine' });
    expect(await probeNode(port, loadKey(homes.owner)!.address)).toEqual({ found: 'other', address: loadKey(homes.a)!.address });
    expect(await probeNode(port, null)).toEqual({ found: 'other', address: loadKey(homes.a)!.address });
    const ta = tracker.address();
    expect(await probeNode(typeof ta === 'object' && ta ? ta.port : 0, loadKey(homes.a)!.address)).toEqual({ found: 'other', address: null });
    // A port with nothing on it: the node's own, once closed, would do, but any free port serves; 1 is never ours.
    expect(await probeNode(1, loadKey(homes.a)!.address)).toEqual({ found: 'none' });
  });

  it('runs the tools through the node under the host named, signing there, and the one library records the claim', async () => {
    let fellBack = false;
    const run = remoteRunner(site, () => {
      fellBack = true;
      return localRunner(() => owner);
    });
    const me = await run('quilt_me', {}, 'Claude Desktop');
    expect(me.text).toContain(`Address: ${loadKey(homes.a)!.address}`);
    expect(me.text).toContain('Declares: anthropic/claude-desktop');
    expect(me.handles.address).toBe(loadKey(homes.a)!.address);
    const found = await run('quilt_search', { query: 'headers' }, 'Claude Desktop');
    expect(found.text).toContain('Headers, read twice');
    const next = await run('quilt_next', { problem }, 'Claude Desktop');
    expect(next.text).toContain('The claim was posted to');
    expect(typeof next.handles.piece).toBe('string');
    // The library on disk, the node's, has the claim; the copy that asked holds no library of its own.
    const lib = JSON.parse(readFileSync(join(homes.a, 'library.json'), 'utf8')) as { pieces: Record<string, { what: string }> };
    expect(lib.pieces[next.handles.piece as string]?.what).toBe('claimed');
    // The tracker saw the claim under the host's model.
    const events = await (await fetch(`${config.trackers[0]}p/${problem}/events`)).text();
    expect(events).toContain('"model":"anthropic/claude-desktop"');
    expect(fellBack).toBe(false);
    // A tool's own error comes back as the error, not as a fall-back.
    await expect(run('quilt_open', { link: 'nothing' }, 'Claude Desktop')).rejects.toThrow();
    expect(fellBack).toBe(false);
    // A name the node does not know is refused at the door.
    const r = await fetch(`${site}api/tool/quilt_nothing`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(404);
  });

  it('works alone from the first call that finds the node gone', async () => {
    let made = 0;
    const run = remoteRunner('http://127.0.0.1:1/', () => {
      made += 1;
      return localRunner(() => owner);
    });
    const me = await run('quilt_me', {}, undefined);
    expect(me.text).toContain(`Address: ${loadKey(homes.owner)!.address}`);
    await run('quilt_me', {}, undefined);
    expect(made).toBe(1);
  });

  it('refuses the API to a browser page of another site and answers the page and programs here', async () => {
    const evil = await fetch(`${site}api/me`, { headers: { origin: 'http://evil.example' } });
    expect(evil.status).toBe(403);
    const cross = await fetch(`${site}api/me`, { headers: { 'sec-fetch-site': 'cross-site' } });
    expect(cross.status).toBe(403);
    const sameSite = await fetch(`${site}api/me`, { headers: { 'sec-fetch-site': 'same-site', origin: `http://127.0.0.1:${port}` } });
    expect(sameSite.status).toBe(403);
    const own = await fetch(`${site}api/me`, { headers: { 'sec-fetch-site': 'same-origin', origin: `http://127.0.0.1:${port}` } });
    expect(own.status).toBe(200);
    expect(own.headers.get('access-control-allow-origin')).toBeNull();
    const program = await fetch(`${site}api/me`);
    expect(program.status).toBe(200);
    // The node's own routes stay open to any site.
    const wk = await fetch(`${site}.well-known/quilt`);
    expect(wk.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('sees a one-shot command\'s write to the library rather than writing over it', async () => {
    // Another process (a one-shot `quilt seed`) writes the standing list while the node runs.
    const file = join(homes.a, 'library.json');
    const lib = JSON.parse(readFileSync(file, 'utf8')) as { seeding: Record<string, string> };
    await new Promise((r) => setTimeout(r, 20));
    lib.seeding[problem] = '2026-10-27T10:00:00.000Z';
    writeFileSync(file, JSON.stringify(lib, null, 2) + '\n');
    const seen = (await (await fetch(`${site}api/library`)).json()) as { seeding: Record<string, string> };
    expect(seen.seeding[problem]).toBe('2026-10-27T10:00:00.000Z');
  });

  it('lists what waits on the person: a human piece with a seat open in a kept problem, and nothing from a problem not kept or worked', async () => {
    const a = (await (await fetch(`${site}api/attention`)).json()) as { items: { why: string; name: string; problem: string }[]; checked: string };
    expect(a.checked).toMatch(/^\d{4}-/);
    const persons = a.items.filter((i) => i.why === 'person');
    expect(persons.map((i) => i.name)).toEqual(['seat/1']);
    expect(persons[0]!.problem).toBe(problem);
    // Reading attention left the library's dates alone.
    const lib = JSON.parse(readFileSync(join(homes.a, 'library.json'), 'utf8')) as { problems: Record<string, { last: string }> };
    const before = lib.problems[problem]!.last;
    await fetch(`${site}api/attention`);
    expect((JSON.parse(readFileSync(join(homes.a, 'library.json'), 'utf8')) as typeof lib).problems[problem]!.last).toBe(before);
  });

  it('runs the same tools alone, through runTool', async () => {
    const r = await runTool(owner, 'quilt_me', {});
    expect(r.text).toContain(`Address: ${loadKey(homes.owner)!.address}`);
  });
});
