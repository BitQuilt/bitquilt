/**
 * The phrases (phrases.ts): what a person says to their AI, as the menu bar copies them and the connector offers them.
 * Each passes the plain-text gate with its slots filled, describes rather than instructs, and the sheet reads the home's
 * state from the key and the library's record of a connector, with the phrases that fit what the person keeps and is
 * wanted for.
 */
import { describe, expect, it } from 'vitest';
import { textIssues } from '@bitquilt/core';
import { ARG_WORDS, COIN_PHRASES, FIRST_PHRASE, PHRASES, phrase, say, sheetOf } from '../src/phrases.js';
import type { Library } from '../src/resolver.js';
import { instructs } from './helpers.js';

const link = 'quilt:sha256:' + 'ab'.repeat(32) + '?dn=report&tr=http%3A%2F%2Flocalhost%3A3977%2F';
const sample = { link, words: 'herbarium labels', path: '/Users/someone/patterns/first.json', amount: '500', per_square: '10', to: '0x' + 'Ab'.repeat(20) };
const claude = { installed: false, config: '/tmp/claude_desktop_config.json', running: false };
const hash = ('sha256:' + 'cd'.repeat(32)) as `sha256:${string}`;
const other = ('sha256:' + 'ef'.repeat(32)) as `sha256:${string}`;

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
  it('have distinct names that are verb phrases, not the tools\' names', () => {
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
    expect(sheet.groups[0]!.phrases.map((p) => p.name)).toEqual(['find_something_to_do', 'who_am_i']);
  });
  it('groups what is wanted, what is kept, what was opened lately and the gold to reveal, each phrase carrying the problem\'s link and no title', () => {
    const address = ('0x' + 'Ab'.repeat(20)) as `0x${string}`;
    const lib = library();
    lib.connector = { host: 'Claude Desktop', first: '2026-10-27T20:00:00.000Z', last: '2026-10-27T20:00:00.000Z' };
    lib.problems[hash] = { title: 'Does the report say what its sources say?', slug: 'report', trackers: ['http://localhost:3977/'], first: '2026-10-27T19:00:00.000Z', last: '2026-10-27T19:00:00.000Z' };
    lib.problems[other] = { title: 'Another', slug: 'other', trackers: [], first: '2026-10-27T18:00:00.000Z', last: '2026-10-27T18:30:00.000Z' };
    lib.seeding[hash] = '2026-10-27T19:00:00.000Z';
    lib.gold = { [other]: { 'sha256:x': { name: 'statement/1', projection: {}, nonce: 'n' } } };
    const attention = [
      { problem: hash, title: 'Does the report say what its sources say?', piece: null, name: 'statement/1', why: 'verdict' as const, tracker: 'http://localhost:3977/' },
      { problem: hash, title: 'Does the report say what its sources say?', piece: null, name: 'statement/2', why: 'verdict' as const, tracker: 'http://localhost:3977/' },
      { problem: other, title: 'Another', piece: null, name: null, why: 'gold' as const, tracker: null },
    ];
    const sheet = sheetOf({ address, name: 'me', library: lib, attention, claude });
    expect(sheet.groups.map((g) => g.title)).toEqual(['Wanted from you', 'To start', 'Keeping', 'Opened lately', 'Your gold']);
    const wanted = sheet.groups[0]!.phrases;
    // Two seats on one problem say one sentence; the gold reveal names its problem.
    expect(wanted.map((p) => p.name)).toEqual(['give_verdict', 'reveal_my_gold']);
    expect(wanted[0]!.say).toBe(`Open quilt:${hash}?dn=report&tr=http%3A%2F%2Flocalhost%3A3977%2F on Quilt and give my verdict on the challenge I was drawn to judge.`);
    expect(wanted[0]!.problem).toEqual({ hash, title: 'Does the report say what its sources say?' });
    expect(wanted[0]!.say).not.toContain('sources say');
    expect(sheet.groups[2]!.phrases[0]!.name).toBe('take_piece');
    expect(sheet.groups[3]!.phrases.map((p) => p.problem?.hash)).toEqual([other]);
    expect(sheet.groups[4]!.phrases[0]!.say).toBe(`Open quilt:${other}?dn=other on Quilt and reveal my gold on every piece of it that has been accepted.`);
    for (const g of sheet.groups) for (const p of g.phrases) expect(textIssues(p.say), p.say).toEqual([]);
  });
});
