/**
 * The phrases (phrases.ts): what a person says to their AI, as the menu bar copies them and the connector offers them.
 * Each passes the plain-text gate with its slots filled, describes rather than instructs, and the sheet reads the home's
 * state from the key and the library's record of a connector, with the phrases that fit what the person keeps and is
 * wanted for. How Quilt works (about.ts) is held here too, with every file in the repository that reads it, which its
 * header and AGENTS.md name, and so is the count AGENTS.md gives of the places a person or a model reads, against its
 * own list.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { textIssues } from '@bitquilt/core';
import { HOW_QUILT_WORKS } from '../src/about.js';
import { ARG_WORDS, COIN_PHRASES, FIRST_PHRASE, PHRASES, phrase, say, sheetOf } from '../src/phrases.js';
import type { Library } from '../src/resolver.js';
import { instructs } from './helpers.js';

const link = 'quilt:sha256:' + 'ab'.repeat(32) + '?dn=report&tr=http%3A%2F%2Flocalhost%3A3977%2F';
const sample = {
  link,
  words: 'herbarium labels',
  path: '/Users/someone/patterns/first.json',
  amount: '500',
  per_square: '10',
  to: '0x' + 'Ab'.repeat(20),
  name: 'Mira',
};
const claude = { installed: false, config: '/tmp/claude_desktop_config.json', running: false };
const hash = ('sha256:' + 'cd'.repeat(32)) as `sha256:${string}`;
const other = ('sha256:' + 'ef'.repeat(32)) as `sha256:${string}`;
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const agents = (): string => readFileSync(join(root, 'AGENTS.md'), 'utf8');

/** Every source file in the repository outside the tests, by its path from the root, with dependencies, build output and dot folders left out. */
function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || ['node_modules', 'dist', 'coverage', 'lib', 'out', 'cache', 'test'].includes(name))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.[cm]?[jt]sx?$/.test(name) && !/\.test\.[cm]?[jt]sx?$/.test(name))
      out.push(relative(root, path).split(sep).join('/'));
  }
  return out;
}

describe('how Quilt works, in plain words', () => {
  it('passes the gate, describes rather than instructs, and says that anyone can add a problem', () => {
    expect(textIssues(HOW_QUILT_WORKS)).toEqual([]);
    expect(HOW_QUILT_WORKS).not.toMatch(instructs);
    expect(HOW_QUILT_WORKS).toMatch(/^How Quilt works, in plain words\. /);
    expect(HOW_QUILT_WORKS).toContain('Anyone can add a problem, big or small');
    expect(HOW_QUILT_WORKS).toContain('asks them before anything is written');
  });

  // Its header once named the hosted join page, which shows the sentence a person says to ask, and AGENTS.md took the
  // claim from it. The check reads every package, since another package would read it through the index, and it reads
  // AGENTS.md's whole clause, so a carrier added there fails until a file carries it.
  it('is read by the files its header names in any package, and AGENTS.md names the ones that carry it', () => {
    const about = 'packages/client/src/about.ts';
    const index = 'packages/client/src/index.ts';
    const readers = sources(root)
      .filter(
        (f) => f !== about && /\bHOW_QUILT_WORKS\b|from '\.\/about\.js'/.test(readFileSync(join(root, f), 'utf8')),
      )
      .sort();
    expect(readers).toContain(index);
    expect(readers).toContain('packages/client/src/mcp.ts');
    // The header names each file that reads it in parentheses: the client's own by its name, another package's by its
    // path from the root.
    const client = 'packages/client/src/';
    const local = (f: string): string => (f.startsWith(client) ? f.slice(client.length) : f);
    const text = readFileSync(join(root, about), 'utf8');
    const header = text.slice(0, text.indexOf('*/'));
    expect([...header.matchAll(/\(([^)]+)\)/g)].map((m) => m[1]!).sort()).toEqual(readers.map(local).sort());
    // AGENTS.md names what carries it by what a model reads, so each name maps to the file that carries it. The index
    // only hands it on to another package, and carries it to no reader.
    const carriers: Record<string, string> = {
      "the connector's instructions": 'packages/client/src/mcp.ts',
      '`quilt_me`': 'packages/client/src/tools.ts',
    };
    const bullet =
      agents()
        .split('\n')
        .find((line) => line.startsWith('- how Quilt works, in `about.ts`')) ?? '';
    const named = /^- how Quilt works, in `about\.ts`, which (.+) carry, held by /.exec(bullet)?.[1];
    expect(named, bullet).toBeDefined();
    expect(
      named!
        .split(/, and |, | and /)
        .map((n) => carriers[n] ?? n)
        .sort(),
    ).toEqual(readers.filter((f) => f !== index));
  });
});

describe('where the words live (AGENTS.md, The words)', () => {
  // The count once said eight while the list grew; a place added to the list changes the number beside it. Each word
  // from one to twenty maps to its number, and a word not on the list fails on its own.
  it('gives the number of places its list names', () => {
    const text = agents();
    const section = text.slice(text.indexOf('## The words'), text.indexOf('## Commands'));
    const said = /lives in (\w+) places/.exec(section)?.[1] ?? '';
    const numbers = [
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
      'thirteen',
      'fourteen',
      'fifteen',
      'sixteen',
      'seventeen',
      'eighteen',
      'nineteen',
      'twenty',
    ];
    const places = section.split('\n').filter((line) => line.startsWith('- ')).length;
    expect(numbers, `"${said}" is not a number word from one to twenty`).toContain(said);
    expect(numbers.indexOf(said) + 1, `${said} places, ${places} listed`).toBe(places);
  });
});

describe('the phrases', () => {
  it('pass the gate with their slots filled, and describe rather than instruct', () => {
    for (const p of PHRASES) {
      const said = p.say(sample);
      expect(textIssues(said), p.name).toEqual([]);
      expect(said, p.name).not.toMatch(instructs);
      expect(p.title).not.toMatch(instructs);
      expect(p.about).not.toMatch(instructs);
      expect(textIssues(p.about), p.name).toEqual([]);
      for (const a of p.args) expect(said).toContain(sample[a]);
    }
    for (const words of Object.values(ARG_WORDS)) expect(words).not.toMatch(instructs);
  });
  it("have distinct names that are verb phrases, not the tools' names", () => {
    const names = PHRASES.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).not.toMatch(/^quilt_/);
    expect(names).toContain(FIRST_PHRASE);
    for (const n of COIN_PHRASES) expect(phrase(n).args).toContain('amount');
  });
  it('are said whole with the arguments given and empty slots otherwise', () => {
    expect(say('find_something_to_do')).toBe('Find me something to do on Quilt.');
    expect(say('take_piece', { link })).toBe(`Open ${link} on Quilt and take a piece.`);
    expect(() => phrase('no_such_phrase')).toThrow(/no phrase named/);
  });
});

describe('the sheet', () => {
  const library = (): Library => ({ problems: {}, pieces: {}, seeding: {} });
  it('is in the no-key state with no address, and offers the first phrase and no groups', () => {
    const sheet = sheetOf({ address: null, name: null, library: library(), attention: [], claude });
    expect(sheet.state).toBe('no_key');
    expect(sheet.first.say).toBe(say(FIRST_PHRASE));
    expect(sheet.groups).toEqual([]);
    expect(sheet.prompts.map((p) => p.name)).toEqual(PHRASES.map((p) => p.name));
  });
  it('is in the no-connector state until the library records one, and connected after', () => {
    const address = ('0x' + 'Ab'.repeat(20)) as `0x${string}`;
    const lib = library();
    expect(sheetOf({ address, name: 'me', library: lib, attention: [], claude }).state).toBe('no_connector');
    lib.connector = { host: 'Claude Desktop', first: '2026-10-27T20:00:00.000Z', last: '2026-10-27T20:00:00.000Z' };
    const sheet = sheetOf({ address, name: 'me', library: lib, attention: [], claude });
    expect(sheet.state).toBe('connected');
    expect(sheet.connector?.host).toBe('Claude Desktop');
    expect(sheet.groups.map((g) => g.title)).toEqual(['To start']);
    expect(sheet.groups[0]!.phrases.map((p) => p.name)).toEqual(['find_something_to_do', 'who_am_i', 'how_it_works']);
    expect(sheet.backup).toBeNull();
    // The words kept at first use are a backup due until the page has shown them; a name is offered once there is work behind the address.
    expect(sheetOf({ address, name: 'me', library: lib, attention: [], wordsDue: true, claude }).backup).toBe('due');
    const named = sheetOf({ address, name: null, library: lib, attention: [], standing: 2, claude });
    expect(named.groups.map((g) => g.title)).toEqual(['To start', 'Your name']);
    expect(named.groups[1]!.phrases[0]!.say).toBe('Call me ____ on Quilt.');
    expect(
      sheetOf({ address, name: null, library: lib, attention: [], standing: 1, claude }).groups.map((g) => g.title),
    ).toEqual(['To start']);
  });
  it("groups what is wanted, what is kept, what was opened lately and the gold to reveal, each phrase carrying the problem's link and no title", () => {
    const address = ('0x' + 'Ab'.repeat(20)) as `0x${string}`;
    const lib = library();
    lib.connector = { host: 'Claude Desktop', first: '2026-10-27T20:00:00.000Z', last: '2026-10-27T20:00:00.000Z' };
    lib.problems[hash] = {
      title: 'Does the report say what its sources say?',
      slug: 'report',
      trackers: ['http://localhost:3977/'],
      first: '2026-10-27T19:00:00.000Z',
      last: '2026-10-27T19:00:00.000Z',
    };
    lib.problems[other] = {
      title: 'Another',
      slug: 'other',
      trackers: [],
      first: '2026-10-27T18:00:00.000Z',
      last: '2026-10-27T18:30:00.000Z',
    };
    lib.seeding[hash] = '2026-10-27T19:00:00.000Z';
    lib.gold = { [other]: { 'sha256:x': { name: 'statement/1', projection: {}, nonce: 'n' } } };
    const attention = [
      {
        problem: hash,
        title: 'Does the report say what its sources say?',
        piece: null,
        name: 'statement/1',
        why: 'verdict' as const,
        tracker: 'http://localhost:3977/',
      },
      {
        problem: hash,
        title: 'Does the report say what its sources say?',
        piece: null,
        name: 'statement/2',
        why: 'verdict' as const,
        tracker: 'http://localhost:3977/',
      },
      { problem: other, title: 'Another', piece: null, name: null, why: 'gold' as const, tracker: null },
    ];
    const sheet = sheetOf({ address, name: 'me', library: lib, attention, claude });
    expect(sheet.groups.map((g) => g.title)).toEqual([
      'Wanted from you',
      'To start',
      'Keeping',
      'Opened lately',
      'Your gold',
    ]);
    const wanted = sheet.groups[0]!.phrases;
    // Two seats on one problem say one sentence; the gold reveal names its problem.
    expect(wanted.map((p) => p.name)).toEqual(['give_verdict', 'reveal_my_gold']);
    expect(wanted[0]!.say).toBe(
      `Open quilt:${hash}?dn=report&tr=http%3A%2F%2Flocalhost%3A3977%2F on Quilt and give my verdict on the challenge I was drawn to judge.`,
    );
    expect(wanted[0]!.problem).toEqual({ hash, title: 'Does the report say what its sources say?' });
    expect(wanted[0]!.say).not.toContain('sources say');
    expect(sheet.groups[2]!.phrases[0]!.name).toBe('take_piece');
    expect(sheet.groups[3]!.phrases.map((p) => p.problem?.hash)).toEqual([other]);
    expect(sheet.groups[4]!.phrases[0]!.say).toBe(
      `Open quilt:${other}?dn=other on Quilt and reveal my gold on every piece of it that has been accepted.`,
    );
    for (const g of sheet.groups) for (const p of g.phrases) expect(textIssues(p.say), p.say).toEqual([]);
  });
});
