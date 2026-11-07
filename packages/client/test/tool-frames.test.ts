/**
 * The text runTool gives a model for the tools tool-text.test.ts does not pin, pinned whole: quilt_window, quilt_next,
 * quilt_seed, quilt_publish, quilt_pay, quilt_transfer, quilt_redeem and quilt_reveal_gold. The Quilt answers each
 * with fixed values, so what is held is the framing tools.ts builds around them: a change that moves a space, a
 * separator or a clause fails here. The inputs take each side of every condition tools.ts puts on that text.
 */
import { describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import { type Config, DEFAULT_CONFIG } from '../src/config.js';
import type { Seam } from '../src/listings.js';
import { type Handed, Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { runTool } from '../src/tools.js';
import { tempHome } from './helpers.js';

type Answers = Partial<
  Pick<Quilt, 'me' | 'next' | 'pieceText' | 'seed' | 'publish' | 'pay' | 'transfer' | 'redeem' | 'revealGold'>
>;

/** A Quilt whose reads and writes answer fixed values; the text around them is still built by runTool. */
function answering(answers: Answers): Quilt {
  const config: Config = { ...DEFAULT_CONFIG, trackers: ['https://t.example/'] };
  return Object.assign(new Quilt(config, null, new Resolver(config, tempHome())), answers);
}

const A64 = `sha256:${'a'.repeat(64)}` as Hash;
const B64 = `sha256:${'b'.repeat(64)}` as Hash;
const T = 'https://t.example/';
const posted = { at: T, queued: false };
const queued = { at: null, queued: true };
const text = async (quilt: Quilt, name: Parameters<typeof runTool>[1], input: Record<string, unknown> = {}) =>
  (await runTool(quilt, name, input)).text;

type Me = ReturnType<Quilt['me']>;
const me =
  (over: Partial<Me>): (() => Me) =>
  () => ({
    address: '0x1111111111111111111111111111111111111111',
    name: 'Ada',
    model: 'anthropic/claude',
    can: [],
    trackers: [T, 'https://u.example/'],
    mirrors: [],
    relays: [],
    queued: 0,
    problems: 0,
    wordsDue: false,
    witness: null,
    ...over,
  });

describe('quilt_window', () => {
  it('names who this client is and what the window searches over: the trackers and the relays, one or many or none', async () => {
    const tail = ': a search over the problems they know, each with its pieces and counts, and who this client is.';
    expect(await text(answering({ me: me({ relays: ['wss://a/', 'wss://b/'] }) }), 'quilt_window')).toBe(
      `The directory window for 0x1111111111111111111111111111111111111111 (Ada), over https://t.example/, https://u.example/ and 2 relays${tail}`,
    );
    expect(
      await text(
        answering({ me: me({ address: null, name: null, trackers: [T], relays: ['wss://a/'] }) }),
        'quilt_window',
      ),
    ).toBe(`The directory window for a key not yet made, over https://t.example/ and 1 relay${tail}`);
    expect(await text(answering({ me: me({ trackers: [T] }) }), 'quilt_window')).toBe(
      `The directory window for 0x1111111111111111111111111111111111111111 (Ada), over https://t.example/${tail}`,
    );
  });
});

describe('quilt_next', () => {
  const seam: Seam = {
    field: 'verdict',
    why: 'source',
    sides: [
      {
        key: '0xaaa',
        name: 'Ada',
        value: 'supports',
        read: { url: 'https://a.example/', hash: A64, at: '2026-11-07T00:00:00.000Z' },
        span: [3, 12],
        passage: 'the words',
      },
      { key: '0xbbb', value: 'contradicts', read: null, span: null, passage: null, aside: true },
    ],
  };
  const handed =
    (over: Partial<Handed>): (() => Promise<Handed>) =>
    async () => ({
      hash: A64,
      // The pick as far as the handles read it; the piece's text is pieceText's, answered below.
      pick: {
        piece: { hash: B64, name: 'cite/1', verifier: 'agree' },
        requires: [],
        lease_h: 2,
        agree: [],
      } as unknown as Handed['pick'],
      posted,
      owner: 'Ada',
      stake: 0,
      lock: null,
      seams: [],
      ...over,
    });
  const quilt = (over: Partial<Handed>) =>
    answering({
      next: handed(over),
      pieceText: (h, _pick, owner, stake) => `The piece of ${h} by ${owner}, stake ${stake}.`,
    });

  it('says the piece, then its seams one a line, then where the claim went and the lock posted before it', async () => {
    expect(await text(quilt({ seams: [seam], stake: 3, lock: 'coin' }), 'quilt_next')).toBe(
      [
        `The piece of ${A64} by Ada, stake 3.`,
        `On verdict, the two rest on different reads: Ada rests it on "the words" at https://a.example/ (${A64}, bytes 3 to 12); 0xbbb rests it on nothing kept, and that reading is set aside until it does.`,
        'The claim was posted to https://t.example/, after a lock of 3 backed by coin on the coin log.',
      ].join('\n'),
    );
    expect(await text(quilt({ stake: 2, lock: 'standing' }), 'quilt_next')).toBe(
      [`The piece of ${A64} by Ada, stake 2.`, 'The claim was posted to https://t.example/, after a lock of 2.'].join(
        '\n',
      ),
    );
    expect(await text(quilt({}), 'quilt_next')).toBe(
      [`The piece of ${A64} by Ada, stake 0.`, 'The claim was posted to https://t.example/.'].join('\n'),
    );
    expect(await text(quilt({ posted: queued }), 'quilt_next')).toBe(
      [`The piece of ${A64} by Ada, stake 0.`, 'The claim waits in the queue; no tracker answered.'].join('\n'),
    );
  });
});

describe('quilt_seed', () => {
  it('says whether the problem is seeded or no longer, and where the seed went', async () => {
    const quilt = (r: typeof posted | typeof queued) => answering({ seed: async () => r });
    expect(await text(quilt(posted), 'quilt_seed', { problem: A64 })).toBe(
      `Seeding ${A64}: posted to https://t.example/.`,
    );
    expect(await text(quilt(queued), 'quilt_seed', { problem: A64, on: false })).toBe(
      `No longer seeding ${A64}: the seed waits in the queue.`,
    );
  });
});

describe('quilt_publish', () => {
  const published = (over: Partial<Awaited<ReturnType<Quilt['publish']>>>) =>
    answering({
      publish: async () => ({
        hash: A64,
        link: `quilt:${A64}`,
        posted: [T],
        refused: [],
        relays: [],
        gold: null,
        ...over,
      }),
    });

  it('says the hash, the link, who carried it and who refused it, and the gold committed on one piece or many', async () => {
    expect(
      await text(published({ refused: ['https://u.example/'], gold: { pieces: 1, stake: 2 } }), 'quilt_publish', {
        pattern: {},
      }),
    ).toBe(
      [
        `Published ${A64}`,
        `Link: quilt:${A64}`,
        'Carried by: https://t.example/',
        "Gold committed on 1 piece with a stake of 2; the answers stay in this home's library until each piece is accepted and revealed.",
        'Refused by https://u.example/',
      ].join('\n'),
    );
    expect(await text(published({ posted: [], gold: { pieces: 3, stake: 6 } }), 'quilt_publish', { pattern: {} })).toBe(
      [
        `Published ${A64}`,
        `Link: quilt:${A64}`,
        'No tracker took it.',
        "Gold committed on 3 pieces with a stake of 6; the answers stay in this home's library until each piece is accepted and revealed.",
      ].join('\n'),
    );
    expect(await text(published({}), 'quilt_publish', { pattern: {} })).toBe(
      [`Published ${A64}`, `Link: quilt:${A64}`, 'Carried by: https://t.example/'].join('\n'),
    );
  });
});

describe('the coin tools', () => {
  const onLog = { ...posted, id: B64, home: T };
  const waiting = { ...queued, id: B64, home: T };

  it('quilt_pay says the escrow, where the pay went, and how the squares are paid from it', async () => {
    const tail =
      '. Each square accepted from now pays the roots of its set from the escrow; what is left comes back when the problem completes.';
    const input = { problem: A64, amount: 10, per_square: 2 };
    expect(await text(answering({ pay: async () => onLog }), 'quilt_pay', input)).toBe(
      `Escrowed 10 units to ${A64} at 2 a square; posted to the coin log at https://t.example/${tail}`,
    );
    expect(await text(answering({ pay: async () => waiting }), 'quilt_pay', input)).toBe(
      `Escrowed 10 units to ${A64} at 2 a square; the pay waits in the queue${tail}`,
    );
  });

  it('quilt_transfer says the units moved and where the transfer went', async () => {
    const tail = ". The units are the recipient's on the ledger from the receipt.";
    const input = { to: '0x2222222222222222222222222222222222222222', amount: 5 };
    expect(await text(answering({ transfer: async () => onLog }), 'quilt_transfer', input)).toBe(
      `Transferred 5 units to 0x2222222222222222222222222222222222222222; posted to the coin log at https://t.example/${tail}`,
    );
    expect(await text(answering({ transfer: async () => waiting }), 'quilt_transfer', input)).toBe(
      `Transferred 5 units to 0x2222222222222222222222222222222222222222; the transfer waits in the queue${tail}`,
    );
  });

  it('quilt_redeem says where the redeem went and to whom, and how the line reaches the chain', async () => {
    const tail =
      ". The coin has left the ledger; the line is minted on the chain once the bridge's poster carries it under a head whose veto window has passed, and the holder claims it with the proof.";
    expect(await text(answering({ redeem: async () => onLog }), 'quilt_redeem', { amount: 7 })).toBe(
      `Redeem of 7 units posted to the coin log at https://t.example/${tail}`,
    );
    expect(
      await text(answering({ redeem: async () => waiting }), 'quilt_redeem', {
        amount: 7,
        to: '0x3333333333333333333333333333333333333333',
      }),
    ).toBe(`Redeem of 7 units waits in the queue, to 0x3333333333333333333333333333333333333333${tail}`);
  });
});

describe('quilt_reveal_gold', () => {
  it('says the reveal, where it went, and what the tracker decided: a match, a miss, nothing yet or a word it does not know', async () => {
    const quilt = (outcome: string | null, r: typeof posted | typeof queued = posted) =>
      answering({ revealGold: async () => ({ ...r, id: B64, name: 'cite/1', outcome }) });
    const input = { problem: A64, piece: B64 };
    expect(await text(quilt('match'), 'quilt_reveal_gold', input)).toBe(
      'Gold on cite/1 revealed; posted to https://t.example/. The set agreed with the gold: the square is verified.',
    );
    expect(await text(quilt('miss'), 'quilt_reveal_gold', input)).toBe(
      'Gold on cite/1 revealed; posted to https://t.example/. The set differed from the gold: it is struck, its roots are docked and their locks forfeited, and the piece is open again; a struck root may challenge the gold inside the window, staking nothing.',
    );
    expect(await text(quilt(null, queued), 'quilt_reveal_gold', input)).toBe(
      'Gold on cite/1 revealed; queued. The tracker has not said what it decided yet.',
    );
    expect(await text(quilt('lapsed'), 'quilt_reveal_gold', input)).toBe(
      'Gold on cite/1 revealed; posted to https://t.example/. The tracker has not said what it decided yet.',
    );
  });
});
