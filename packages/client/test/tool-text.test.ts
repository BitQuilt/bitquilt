/**
 * The text runTool gives a model for quilt_search, quilt_open, quilt_read and quilt_me, pinned whole: the framing
 * tools.ts builds and the render.ts functions inside it. The inputs fire every branch of that text, each clause given
 * or left out, one or many, every outcome and every kind. A change that moves a space, a separator or a clause fails
 * here.
 *
 * Open and read run over a tracker in this process, which gives the states and the returns. Where a branch wants what
 * one tracker does not give (a stake, the gold, a takedown, witnesses, seams of each kind, challenges and panels of
 * each outcome, an answer from the cache, a state outside the legend, a patch accepted or disputed, a key signing for
 * another root), the Quilt's open, challenges and panels answer a fixed view over the real state. Search and me run
 * over a Quilt whose reads answer fixed values, since their branches want a coin, a founding, relays and forks that
 * one tracker does not give.
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Address, type By, type Hash, type PieceView, type Reveal, type Run, type Schema, hashCanonical } from '@bitquilt/core';
import { HOW_QUILT_WORKS } from '../src/about.js';
import { type Config, DEFAULT_CONFIG } from '../src/config.js';
import { parseLink } from '../src/link.js';
import type { ChallengeListing, GoldCount, LayerPiece, LayerState, PanelListing, Seam, Takedown, Witness } from '../src/listings.js';
import { type Found, type Pattern, Quilt } from '../src/quilt.js';
import { kindWords, witnessKey } from '../src/render.js';
import { Resolver } from '../src/resolver.js';
import { runTool } from '../src/tools.js';
import { quiltOver, startTracker, tempHome } from './helpers.js';

let server: Server;
let base: string;
let mk: ReturnType<typeof quiltOver>;
let owner: Quilt, a: Quilt, b: Quilt, c: Quilt, d: Quilt;
let p: Hash, q: Hash, r: Hash, m: Hash, k: Hash, w: Hash;

const verdict = { type: 'object' as const, additionalProperties: false as const, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } };
/** Three agree pieces and a record piece: one accepted, one disputed, one open, one recording. */
const worked: Pattern = {
  title: 'Does the paper say so?', done_when: 'Every statement has a verdict.', slug: 'says',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': { count: 3, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema: verdict, agree: ['verdict'] },
    question: { verifier: 'record:3', requires: ['web'], brief: 'Read it your way.', schema: { type: 'object', additionalProperties: false, required: ['stance'], properties: { stance: { enum: ['asserts', 'denies'] } } }, agree: ['stance'] },
  },
};
/** One agree piece nobody has worked: nothing found, nothing recorded. */
const untouched: Pattern = {
  title: 'Is the date right?', done_when: 'The date has a verdict.', slug: 'quiet',
  pieces: { date: { verifier: 'agree', requires: ['web'], brief: 'Is the date right?', schema: verdict, agree: ['verdict'] } },
};
const threeFields = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'tone', 'page'], properties: { verdict: { enum: ['supports', 'contradicts'] }, tone: { enum: ['plain', 'hedged'] }, page: { type: 'integer' as const } } };
const said = { type: 'object', additionalProperties: false, required: ['said'], properties: { said: { type: 'string', maxLength: 200 } } } as unknown as Schema;
const sentence = { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string', maxLength: 200 } } } as unknown as Schema;
/**
 * A problem whose pieces carry, once the layer below is laid over them, every mark render.ts says: agree pieces with
 * one field and with three, two of them choices and one a number, an attest piece, judge pieces and a record piece. Its
 * returns are real; the tracker's view of them is fixed in the describe that reads it.
 */
const marked: Pattern = {
  title: 'What does the report claim?', done_when: 'Every claim is read.', slug: 'claims',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': { count: 3, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the report say so?', schema: verdict, agree: ['verdict'] },
    'claim/*': { count: 3, verifier: 'agree', requires: ['web'], brief: 'Claim {n}: what does the report say, how, and on which page?', schema: threeFields, agree: ['verdict', 'tone', 'page'] },
    tell: { verifier: 'attest', requires: ['web'], brief: 'Who did you tell about the report?', schema: said },
    'sentence/*': { count: 4, verifier: 'judge:3', candidates: 2, requires: ['web'], brief: 'Sentence {n}: say the report in one sentence.', schema: sentence },
    question: { verifier: 'record:2', requires: ['web'], brief: 'Does the report say the board voted?', schema: { type: 'object', additionalProperties: false, required: ['stance'], properties: { stance: { enum: ['asserts', 'denies'] } } }, agree: ['stance'] },
  },
};
/** One piece of each kind the problems above lack: the core's two patch kinds, a person's kind, and one nobody implements. */
const kinds: Pattern = {
  title: 'Which kinds are here?', done_when: 'Each kind has a piece.', slug: 'kinds',
  pieces: {
    patch: { verifier: 'check', requires: ['files'], brief: 'Make the failing test pass.', workspace: { repo: 'https://github.com/example/repo', base: 'main' }, check: { file: 'check.sh' } },
    scored: { verifier: 'score', requires: ['files'], brief: 'Make the benchmark faster.', workspace: { repo: 'https://github.com/example/repo', base: 'main' }, check: { file: 'score.sh', better: 'higher' } },
    seat: { verifier: 'human', requires: ['person'], brief: 'Is the letter signed?', schema: verdict, agree: ['verdict'] },
    oracle: { verifier: 'oracle', requires: ['web'], brief: 'What does the oracle say?', schema: verdict, agree: ['verdict'] },
  },
};
/**
 * One agree piece two vendors agree on: a problem that is whole once its window has run. It agrees on a choice and on
 * free text, and only the choice is something the found says.
 */
const yearSchema = { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string', maxLength: 200 } } } as unknown as Schema;
const whole: Pattern = {
  title: 'Is the year right?', done_when: 'The year has a verdict.', slug: 'year',
  pieces: { year: { verifier: 'agree', requires: ['web'], brief: 'Is the year in the report right?', schema: yearSchema, agree: ['verdict', 'quote'] } },
};
const YEAR = { verdict: 'supports', quote: 'The report gives the year as 1918.' };

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  mk = quiltOver(base);
  owner = mk(9, 'anthropic/claude');
  a = mk(1, 'anthropic/claude');
  b = mk(2, 'openai/gpt-5', 'ChatGPT');
  c = mk(3, 'google/gemini', 'Gemini');
  d = mk(4, 'anthropic/claude');
  await a.setName('Ada');
  p = (await owner.publish(worked)).hash;
  const [s1, s2, , question] = (await owner.open(p)).state.pieces.map((v) => v.piece.hash) as [Hash, Hash, Hash, Hash];
  await a.return(p, s1, { verdict: 'supports' });
  await b.return(p, s1, { verdict: 'supports' });
  await a.return(p, s2, { verdict: 'supports' });
  await b.return(p, s2, { verdict: 'contradicts' });
  await a.return(p, question, { stance: 'asserts' });
  await c.return(p, question, { stance: 'denies' });
  // The owner's next version of the first problem, so the first says it was replaced.
  q = (await owner.publish({ ...worked, slug: 'says-2', prev: p })).hash;
  r = (await owner.publish(untouched)).hash;
  m = (await owner.publish(marked)).hash;
  const piece = new Map((await owner.open(m)).state.pieces.map((v) => [v.piece.name, v.piece.hash] as const));
  const at = (name: string): Hash => piece.get(name)!;
  await a.return(m, at('statement/1'), { verdict: 'supports' });
  await b.return(m, at('statement/1'), { verdict: 'supports' });
  await a.return(m, at('statement/2'), { verdict: 'contradicts' });
  await c.return(m, at('statement/2'), { verdict: 'contradicts' });
  await a.return(m, at('statement/3'), { verdict: 'supports' });
  await d.return(m, at('statement/3'), { verdict: 'supports' });
  await a.return(m, at('claim/1'), { verdict: 'supports', tone: 'plain', page: 4 });
  await b.return(m, at('claim/1'), { verdict: 'supports', tone: 'plain', page: 4 });
  await a.return(m, at('claim/2'), { verdict: 'supports', tone: 'plain', page: 4 });
  await b.return(m, at('claim/2'), { verdict: 'contradicts', tone: 'hedged', page: 9 });
  await a.return(m, at('claim/3'), { verdict: 'supports', tone: 'plain', page: 4 });
  await c.return(m, at('claim/3'), { verdict: 'contradicts', tone: 'hedged', page: 4 });
  await a.return(m, at('tell'), { said: 'I told the editor of a newsletter about the report.' });
  await b.return(m, at('sentence/1'), { text: 'The report finds the board never voted.' });
  await a.return(m, at('sentence/1'), { text: 'The board acted without a vote.' });
  await c.return(m, at('sentence/2'), { text: 'A report on a vote that did not happen.' });
  await d.return(m, at('sentence/3'), { text: 'The board skipped its vote.' });
  await c.return(m, at('sentence/4'), { text: 'No vote, says the report.' });
  // The owner's own reading stands on the record and is not counted, so the piece takes two more.
  await owner.return(m, at('question'), { stance: 'asserts' });
  await a.return(m, at('question'), { stance: 'asserts' });
  await d.return(m, at('question'), { stance: 'denies' });
  // Ada owns this one, so its summary names its owner by the name she chose.
  k = (await a.publish(kinds)).hash;
  w = (await owner.publish(whole)).hash;
  const year = (await owner.open(w)).state.pieces[0]!.piece.hash;
  await a.return(w, year, YEAR);
  await b.return(w, year, YEAR);
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

/** The text with this run's tracker and problem hashes named, since the port and so the hashes differ from run to run. */
function named(text: string): string {
  const pairs: [string, string][] = [[encodeURIComponent(base), '<tracker>'], [base, '<tracker>'], [p, '<p>'], [q, '<q>'], [r, '<r>'], [m, '<m>'], [k, '<k>'], [w, '<w>']];
  return pairs.reduce((t, [from, to]) => t.split(from).join(to), text);
}

const LEGEND = 'Legend: . open, i in flight, s sealed, v needs a second production, d disputed, p accepted within the window, a accepted, u unreachable, l locked, c challenged, j a panel ranking candidates, r readings being recorded, R recorded, every reading standing, ? a kind neither this client nor the tracker that answered implements.';
const OWNER = '0xF7Edc8FA1eCc32967F827C9043FcAe6ba73afA5c';
const B = '0x2B5AD5c4795c026514f8317c7a215E218DcCD6cF';
const C = '0x6813Eb9362372EEF6200f3b1dbC3f819671cBA69';
const HEAD_P = [
  'Problem <p>',
  `The owner, ${OWNER}, titled it: "Does the paper say so?"`,
  'and wrote of when it is done: "Every statement has a verdict."',
  '4 pieces, version 1 along prev.',
  'pd.r',
  '1 accepted provisional, 1 disputed, 1 open, 1 recording',
  'Kinds: 3 agree (agreed: two returns from different vendors agree); 1 record:3 (recorded: 3 readings from roots unrelated to the owner and to each other are kept as given; none is accepted and none struck).',
  LEGEND,
  'Answered by <tracker>.',
  'Link: quilt:<p>?dn=says&tr=<tracker>',
];
const HEAD_R = [
  'Problem <r>',
  `The owner, ${OWNER}, titled it: "Is the date right?"`,
  'and wrote of when it is done: "The date has a verdict."',
  '1 pieces, version 1 along prev.',
  '.',
  '1 open',
  'Kinds: 1 agree (agreed: two returns from different vendors agree).',
  LEGEND,
  'Answered by <tracker>.',
  'Link: quilt:<r>?dn=quiet&tr=<tracker>',
];

describe('quilt_open', () => {
  it('says the problem whole, and where its owner replaced it, the version that did', async () => {
    expect(named((await runTool(owner, 'quilt_open', { link: p })).text)).toBe([...HEAD_P, 'Its owner replaced this version with <q>; the work is there.'].join('\n'));
    expect(named((await runTool(owner, 'quilt_open', { link: r })).text)).toBe(HEAD_R.join('\n'));
  });

  it('names an owner by the name chosen, and says each kind in its words and a kind nobody implements as one this client does not', async () => {
    expect(named((await runTool(owner, 'quilt_open', { link: k })).text)).toBe([
      'Problem <k>',
      'The owner, Ada, titled it: "Which kinds are here?"',
      'and wrote of when it is done: "Each kind has a piece."',
      '4 pieces, version 1 along prev.',
      '...?',
      '3 open, 1 unknown',
      'Kinds: 1 check (reproduced: two unrelated runs reproduce the patch); 1 score (reproduced: two unrelated runs score the patch within tolerance); 1 human (agreed: two people at seats a tracker opened for them agree); 1 oracle (unknown: a kind this client does not implement).',
      LEGEND,
      'Answered by <tracker>.',
      'Link: quilt:<k>?dn=kinds&tr=<tracker>',
    ].join('\n'));
  });
});

describe('quilt_read', () => {
  it('says what was found, accepted, recorded, disputed, challenged and ranked, each under its heading', async () => {
    expect(named((await runTool(owner, 'quilt_read', { problem: p })).text)).toBe([
      ...HEAD_P,
      '',
      'Found: the accepted squares agreed on verdict: 1 "supports".',
      '',
      'Accepted so far:',
      'statement/1 (rests on no kept read), Ada returned: {"verdict":"supports"}',
      `statement/1 (rests on no kept read), ${B} returned: {"verdict":"supports"}`,
      'A kept read is what a return rests on (QX-19): a page\'s text under its hash and the span of it a field stands on, which anyone can fetch from the tracker and compare with the page.',
      '',
      'Recorded:',
      'question (record:3; recording: 2 of 3 readings, 0 resting on kept reads, from 2 roots and 2 vendors)',
      '  Ada returned: {"stance":"asserts"}',
      `  ${C} returned: {"stance":"denies"}`,
      `  On stance, one side rests on nothing kept: Ada rests it on nothing kept; ${C} rests it on nothing kept.`,
      '',
      'Disputed:',
      'statement/2 is disputed, with 2 returns.',
      'The returns differ on verdict.',
      `On verdict, one side rests on nothing kept: Ada rests it on nothing kept; ${B} rests it on nothing kept.`,
      'Ada (anthropic/claude) returned: {"verdict":"supports"}',
      `${B} (openai/gpt-5) returned: {"verdict":"contradicts"}`,
      '',
      'Challenges:',
      'No challenge on this problem.',
      '',
      'Panels:',
      'No judge panel on this problem.',
    ].join('\n'));
  });

  it('leaves out the found and the recorded where there are none', async () => {
    expect(named((await runTool(owner, 'quilt_read', { problem: r })).text)).toBe([
      ...HEAD_R,
      '',
      'Accepted so far:',
      'Nothing accepted yet.',
      '',
      'Disputed:',
      'No piece is disputed.',
      '',
      'Challenges:',
      'No challenge on this problem.',
      '',
      'Panels:',
      'No judge panel on this problem.',
    ].join('\n'));
  });
});

/** Two pages the tracker keeps (QX-19), for the seams below. */
const READ_A = { url: 'https://a.example/report', hash: `sha256:${'e'.repeat(64)}` as Hash, at: '2026-11-06T09:00:00.000Z' };
const READ_B = { url: 'https://b.example/report', hash: `sha256:${'f'.repeat(64)}` as Hash, at: '2026-11-06T09:05:00.000Z' };
const AT_A = `https://a.example/report (sha256:${'e'.repeat(64)}`;
const AT_B = `https://b.example/report (sha256:${'f'.repeat(64)}`;
const E = '0x1111111111111111111111111111111111111111';
const T = '2026-11-06T13:00:00.000Z';
const ID = (n: number) => `sha256:${String(n).repeat(64)}` as Hash;

/**
 * The real problem `marked`, with the tracker's view of it fixed: a layer that carries a stake, the gold, a verified
 * square, each grade of a kept read, a reading set aside, a seam of each kind and each side, a record piece recorded,
 * and kinds the core does not implement held as accepted; a takedown, a gold count, the witnesses, challenges and panels
 * of every outcome. Then the same problem, and one that is whole, as the cache answers them with no tracker. The reader
 * is Ada's key, so her disputed returns are marked as this key's.
 */
type Opened = Awaited<ReturnType<Quilt['open']>>;
/** A Quilt with Ada's key whose reads answer a fixed view; the text is still built by runTool and render.ts. */
function over(opened: Opened, challenges: ChallengeListing[] = [], panels: PanelListing[] = []): Quilt {
  return Object.assign(mk(1, 'anthropic/claude'), {
    open: async () => opened,
    challenges: async () => challenges,
    panels: async () => panels,
  } satisfies Partial<Pick<Quilt, 'open' | 'challenges' | 'panels'>>);
}

describe('quilt_open and quilt_read over a tracker\'s view with every mark', () => {
  let reader: Quilt;
  let real: Opened;
  let at: (name: string) => Hash;
  let layer: LayerPiece[];
  let ADA: string, D: string;
  const ret = {
    b1: { text: 'The report finds the board never voted.' },
    a1: { text: 'The board acted without a vote.' },
    d3: { text: 'The board skipped its vote.' },
    c4: { text: 'No vote, says the report.' },
  };
  const gold: GoldCount = { committed: 6, pending: 1, verified: 2, missed: 1, overruled: 1, lapsed: 1 };
  const takedown: Takedown = { id: 'takedown-1', by: E, why: 'The title names a private person.', at: '2026-11-06T12:00:00.000Z' };

  beforeAll(async () => {
    reader = mk(1, 'anthropic/claude');
    real = await reader.open(m);
    ADA = a.identity!.address;
    D = d.identity!.address;
    const views = new Map(real.state.pieces.map((v) => [v.piece.name, v] as const));
    at = (name) => views.get(name)!.piece.hash;
    const lp = (name: string, fields: Partial<LayerPiece>): LayerPiece => {
      const v: PieceView = views.get(name)!;
      const k = kindWords(v.piece.verifier);
      return { hash: v.piece.hash, name, verifier: v.piece.verifier, state: v.state, core: v.state, kind: k.kind, strength: k.strength, extension: k.extension, says: k.says, weakest: k.weakest, attested: false, panel: null, challenge: null, ...fields };
    };
    const claim2: Seam[] = [
      { field: 'verdict', why: 'source', sides: [{ key: ADA, value: 'supports', read: READ_A, span: [10, 40], passage: null }, { key: B, value: 'contradicts', read: READ_B, span: [0, 27], passage: 'The minutes record no vote.' }] },
      { field: 'tone', why: 'span', sides: [{ key: ADA, value: 'plain', read: READ_A, span: [50, 90], passage: 'Write to desk@example.org for the figures.' }, { key: B, value: 'hedged', read: READ_A, span: [100, 119], passage: 'It says so plainly.' }] },
    ];
    const claim3: Seam[] = [
      { field: 'verdict', why: 'unknown', sides: [{ key: ADA, value: 'supports', read: READ_B, span: [40, 72], passage: 'The report says the board voted.' }, { key: C, value: 'contradicts', read: null, span: null, passage: null, aside: true }] },
    ];
    const stance: Seam[] = [
      { field: 'stance', why: 'reading', sides: [{ key: ADA, value: 'asserts', read: READ_A, span: [5, 28], passage: 'The board did not vote.' }, { key: D, value: 'denies', read: READ_A, span: [5, 28], passage: 'The board did not vote.' }] },
    ];
    layer = [
      lp('statement/1', { state: 'accepted_provisional', verified: true, traced: 'both', stake: 2, gold: 'match' }),
      lp('statement/2', { state: 'accepted_provisional', traced: 'one', stake: 1, gold: 'miss' }),
      lp('statement/3', { state: 'disputed' }),
      lp('claim/1', { state: 'accepted_provisional', traced: 'none', stake: 1, gold: 'overruled' }),
      lp('claim/2', { state: 'disputed', seams: claim2 }),
      lp('claim/3', { state: 'accepted_provisional', aside: [C], seams: claim3 }),
      lp('tell', { state: 'accepted_provisional', attested: true }),
      lp('sentence/1', { state: 'accepted', panel: 'decided' }),
      lp('sentence/2', { state: 'challenged', kind: null, strength: null, challenge: ID(2) }),
      lp('sentence/3', { state: 'disputed', panel: 'void' }),
      lp('sentence/4', { state: 'judging', panel: 'open' }),
      lp('question', { state: 'recorded', record: { wanted: 2, standing: 2, grounded: 2, roots: 2, vendors: 1, keys: [ADA, D] }, seams: stance }),
    ];
  });

  const KINDS_M = 'Kinds: 6 agree (agreed: two returns from different vendors agree); 1 attest (attested: the actor\'s own signed record is accepted at once and may be challenged for the window; the weakest kind); 4 judge:3 (judged: a panel of 3 drawn by sortition ranks the candidates and a majority\'s first choice is accepted); 1 record:2 (recorded: 2 readings from roots unrelated to the owner and to each other are kept as given; none is accepted and none struck).';
  const HEAD_M = [
    'Problem <m>',
    `The owner, ${OWNER}, titled it: "What does the report claim?"`,
    'and wrote of when it is done: "Every claim is read."',
    '12 pieces, version 1 along prev.',
    'ppdpdppacdjR',
    '5 accepted provisional, 3 disputed, 1 accepted, 1 challenged, 1 judging, 1 recorded',
    KINDS_M,
    'Stake asked (QX-15): 3 of the pieces ask 1 or 2 of a key\'s standing, locked before the claim and forfeited if the acceptance is struck.',
  ];

  it('quilt_open says the stake, the gold the tracker summed with each count, and a takedown', async () => {
    const text = (await runTool(over({ ...real, layer, hidden: takedown, gold }), 'quilt_open', { link: m })).text;
    expect(named(text)).toBe([
      ...HEAD_M,
      'Gold (QX-16): the owner committed answers for 6 of the pieces before the work, without saying which; 2 verified, 1 missed, 1 awaiting the owner\'s reveal, 1 overruled by a challenge, 1 lapsed unrevealed.',
      LEGEND,
      'Answered by <tracker>.',
      `Taken down on <tracker> by ${E}: "The title names a private person." (2026-11-06T12:00:00.000Z). The map above is still what the chain says.`,
      'Link: quilt:<m>?dn=claims&tr=<tracker>',
    ].join('\n'));
  });

  it('quilt_open says a whole problem answered from the cache, with the config\'s trackers in its link', async () => {
    const resolved = (await reader.resolver.resolve(parseLink(w)))!;
    // Reduced once the window has run, so the accepted square is final and the problem whole.
    const state = reader.resolver.state(resolved, '2100-01-01T00:00:00.000Z');
    const cached = { ...(await reader.open(w)), state, tracker: null, layer: null, hidden: null, gold: null };
    expect(named((await runTool(over(cached), 'quilt_open', { link: w })).text)).toBe([
      'Problem <w>',
      `The owner, ${OWNER}, titled it: "Is the year right?"`,
      'and wrote of when it is done: "The year has a verdict."',
      '1 pieces, version 1 along prev.',
      'a',
      '1 accepted; complete',
      'Kinds: 1 agree (agreed: two returns from different vendors agree).',
      LEGEND,
      'Answered from the cache or a mirror.',
      'Link: quilt:<w>?dn=year&tr=<tracker>',
    ].join('\n'));
  });

  it('quilt_read says what a whole problem found, from the cache: the choice, and not the free text', async () => {
    const resolved = (await reader.resolver.resolve(parseLink(w)))!;
    const state = reader.resolver.state(resolved, '2100-01-01T00:00:00.000Z');
    const cached = { ...(await reader.open(w)), state, tracker: null, layer: null, hidden: null, gold: null, witnessed: new Map<string, Witness>() };
    const returned = '{"quote":"The report gives the year as 1918.","verdict":"supports"}';
    expect(named((await runTool(over(cached), 'quilt_read', { problem: w })).text)).toBe([
      'Problem <w>',
      `The owner, ${OWNER}, titled it: "Is the year right?"`,
      'and wrote of when it is done: "The year has a verdict."',
      '1 pieces, version 1 along prev.',
      'a',
      '1 accepted; complete',
      'Kinds: 1 agree (agreed: two returns from different vendors agree).',
      LEGEND,
      'Answered from the cache or a mirror.',
      'Link: quilt:<w>?dn=year&tr=<tracker>',
      '',
      'Found: the accepted squares agreed on verdict: 1 "supports".',
      '',
      'Accepted so far:',
      `year, Ada returned: ${returned}`,
      `year, ${B} returned: ${returned}`,
      '',
      'Disputed:',
      'No piece is disputed.',
      '',
      'Challenges:',
      'No challenge on this problem.',
      '',
      'Panels:',
      'No judge panel on this problem.',
    ].join('\n'));
  });

  it('quilt_read says every mark the layer, the witnesses, the challenges and the panels carry', async () => {
    const witnessed = new Map<string, Witness>([
      [witnessKey(at('statement/1'), ADA), { via: 'claude.ai', client: null, by: 'key' }],
      [witnessKey(at('statement/1'), B), { via: 'other', client: 'Cursor' }],
      [witnessKey(at('statement/2'), C), { via: 'other', client: null }],
    ]);
    const seat = { offered_at: T, lapsed_at: null };
    const challenges: ChallengeListing[] = [
      {
        id: ID(1), piece: at('statement/1'), name: 'statement/1', root: C, at: T, stake: 3, ground: 'The quote is not on the page.', outcome: 'failed', decided_at: T,
        seats: [
          { root: ADA, ...seat, verdict: { at: T, for: 'challenger', return: { verdict: 'contradicts' } } },
          { root: B, ...seat, verdict: { at: T, for: 'author', return: null } },
          { root: D, offered_at: T, lapsed_at: T, verdict: null },
          { root: E, ...seat, verdict: null },
        ],
      },
      { id: ID(2), piece: at('sentence/2'), name: null, root: B, at: T, stake: 1, ground: 'The sentence says more than the report.', outcome: 'open', decided_at: null, seats: [] },
      { id: ID(3), piece: at('claim/1'), name: 'claim/1', root: D, at: T, stake: 2, ground: 'The tone is hedged.', outcome: 'held', decided_at: T, seats: [] },
      { id: ID(4), piece: at('tell'), name: 'tell', root: B, at: T, stake: 1, ground: 'Nobody was told.', outcome: 'void', decided_at: T, seats: [] },
    ];
    const [dB, dA, dD, dC] = [ret.b1, ret.a1, ret.d3, ret.c4].map((x) => hashCanonical(x)) as [Hash, Hash, Hash, Hash];
    const panels: PanelListing[] = [
      {
        piece: at('sentence/1'), name: 'sentence/1', verifier: 'judge:3', panel: 3, majority: 2, outcome: 'decided', winner: dB, decided_at: T,
        candidates: [{ digest: dB, return: ret.b1, root: B }, { digest: dA, return: ret.a1, root: ADA }],
        seats: [{ root: C, ...seat, rank: { at: T, ranking: [dB, dA] } }, { root: D, offered_at: T, lapsed_at: T, rank: null }, { root: E, ...seat, rank: null }],
      },
      { piece: at('sentence/3'), name: 'sentence/3', verifier: 'judge:3', panel: 3, majority: 2, outcome: 'void', winner: null, decided_at: T, candidates: [{ digest: dD, return: ret.d3, root: D }], seats: [{ root: C, offered_at: T, lapsed_at: T, rank: null }] },
      { piece: at('sentence/4'), name: 'sentence/4', verifier: null, panel: 3, majority: 2, outcome: 'open', winner: null, decided_at: null, candidates: [{ digest: dC, return: ret.c4 }], seats: [] },
    ];
    const text = (await runTool(over({ ...real, layer, hidden: null, gold: null, witnessed }, challenges, panels), 'quilt_read', { problem: m })).text;
    expect(named(text)).toBe([
      ...HEAD_M,
      'Gold (QX-16): the owner committed answers for 3 of the pieces before the work, without saying which; 1 verified, 1 missed, 0 awaiting the owner\'s reveal, 1 overruled by a challenge.',
      LEGEND,
      'Answered by <tracker>.',
      'Link: quilt:<m>?dn=claims&tr=<tracker>',
      '',
      'Found: the accepted squares agreed on verdict: 2 "supports", 1 "contradicts"; tone: 1 "plain".',
      '',
      'Accepted so far:',
      'statement/1 (verified: the set agreed with the answer the owner committed to before the work) (rests on kept reads on both sides), Ada (witnessed by claude.ai) returned: {"verdict":"supports"}',
      `statement/1 (verified: the set agreed with the answer the owner committed to before the work) (rests on kept reads on both sides), ${B} (through a client that calls itself "Cursor") returned: {"verdict":"supports"}`,
      'statement/2 (rests on kept reads on one side), Ada returned: {"verdict":"contradicts"}',
      `statement/2 (rests on kept reads on one side), ${C} (through a client that gave no name) returned: {"verdict":"contradicts"}`,
      'claim/1 (rests on no kept read), Ada returned: {"page":4,"tone":"plain","verdict":"supports"}',
      `claim/1 (rests on no kept read), ${B} returned: {"page":4,"tone":"plain","verdict":"supports"}`,
      'tell (attest; attested, the actor\'s own word), Ada returned: {"said":"I told the editor of a newsletter about the report."}',
      `sentence/1 (judge:3; judged as the tracker holds it), ${B} returned: {"text":"The report finds the board never voted."}`,
      'sentence/1 (judge:3; judged as the tracker holds it), Ada returned: {"text":"The board acted without a vote."}',
      `sentence/2 (judge:3; accepted as the tracker holds it), ${C} returned: {"text":"A report on a vote that did not happen."}`,
      'A witness is the tracker\'s word (QX-18): its hosted on-ramp saw the token behind that return come through the product\'s OAuth callback. It says the product made the calls, not who wrote the answer.',
      'A kept read is what a return rests on (QX-19): a page\'s text under its hash and the span of it a field stands on, which anyone can fetch from the tracker and compare with the page.',
      '',
      'Recorded:',
      'question (record:2; recorded: 2 of 2 readings, 2 resting on kept reads, from 2 roots and 1 vendor)',
      `  ${OWNER} (not counted: related to the owner or to an earlier reader) returned: {"stance":"asserts"}`,
      '  Ada returned: {"stance":"asserts"}',
      `  ${D} returned: {"stance":"denies"}`,
      `  On stance, the same words, read two ways: Ada rests it on "The board did not vote." at ${AT_A}, bytes 5 to 28); ${D} rests it on "The board did not vote." at ${AT_A}, bytes 5 to 28).`,
      '',
      'Disputed:',
      'statement/3 is disputed, with 2 returns.',
      'Ada (anthropic/claude), this key, returned: {"verdict":"supports"}',
      `${D} (anthropic/claude) returned: {"verdict":"supports"}`,
      '',
      'claim/2 is disputed, with 2 returns.',
      'The returns differ on verdict, tone, page.',
      `On verdict, the two rest on different reads: Ada rests it on ${AT_A}, bytes 10 to 40); ${B} rests it on "The minutes record no vote." at ${AT_B}, bytes 0 to 27).`,
      `On tone, the same read, at different places: Ada rests it on a passage of 40 bytes at ${AT_A}, bytes 50 to 90), which does not pass the plain-text gate and is not shown here; ${B} rests it on "It says so plainly." at ${AT_A}, bytes 100 to 119).`,
      'Ada (anthropic/claude), this key, returned: {"page":4,"tone":"plain","verdict":"supports"}',
      `${B} (openai/gpt-5) returned: {"page":9,"tone":"hedged","verdict":"contradicts"}`,
      '',
      'claim/3 is disputed in the core\'s fold, with 2 returns; the tracker set one reading aside and calls it accepted provisional.',
      'The returns differ on verdict, tone.',
      `On verdict, one side rests on nothing kept: Ada rests it on "The report says the board voted." at ${AT_B}, bytes 40 to 72); ${C} rests it on nothing kept, and that reading is set aside until it does.`,
      'Ada (anthropic/claude), this key, returned: {"page":4,"tone":"plain","verdict":"supports"}',
      `${C} (google/gemini) returned: {"page":4,"tone":"hedged","verdict":"contradicts"}`,
      '',
      'sentence/3 is disputed, with 1 return.',
      `${D} (anthropic/claude) returned: {"text":"The board skipped its vote."}`,
      '',
      'Challenges:',
      `Challenge ${ID(1)} on statement/1, by ${C} with a stake of 3, failed: the acceptance stands and the stake was lost.`,
      `${C} wrote as the ground: "The quote is not on the page."`,
      'Ada, drawn, answered for the challenger and returned: {"verdict":"contradicts"}.',
      `${B}, drawn, answered for the author.`,
      `${D}, drawn, let the seat lapse.`,
      `${E}, drawn, has not answered.`,
      '',
      `Challenge ${ID(2)} on ${at('sentence/2')}, by ${B} with a stake of 1, open: the piece is challenged while the panel sits.`,
      `${B} wrote as the ground: "The sentence says more than the report."`,
      'No seats drawn yet.',
      '',
      `Challenge ${ID(3)} on claim/1, by ${D} with a stake of 2, held: the acceptance was struck and the piece is open again.`,
      `${D} wrote as the ground: "The tone is hedged."`,
      'No seats drawn yet.',
      '',
      `Challenge ${ID(4)} on tell, by ${B} with a stake of 1, void: no panel could decide it and the acceptance stands.`,
      `${B} wrote as the ground: "Nobody was told."`,
      'No seats drawn yet.',
      '',
      'Panels:',
      'Panel on sentence/1 (judge:3, 2 of 3 decide), decided: the candidate a majority ranked first is accepted.',
      `${B}, ranked first by the majority, returned, as digest ${dB}: {"text":"The report finds the board never voted."}`,
      `Ada returned, as digest ${dA}: {"text":"The board acted without a vote."}`,
      `${C}, drawn, ranked: ${dB}, ${dA}.`,
      `${D}, drawn, let the seat lapse.`,
      `${E}, drawn, has not ranked.`,
      '',
      'Panel on sentence/3 (judge:3, 2 of 3 decide), void: the panel ran out before a majority agreed, and the piece is disputed.',
      `${D} returned, as digest ${dD}: {"text":"The board skipped its vote."}`,
      `${C}, drawn, let the seat lapse.`,
      '',
      'Panel on sentence/4 (judge, 2 of 3 decide), sitting: the candidates are in and the judges drawn are ranking them.',
      `A candidate returned, as digest ${dC}: {"text":"No vote, says the report."}`,
      'No seats drawn yet.',
    ].join('\n'));
  });

  it('quilt_read from the cache says the core\'s fold alone: its states, what it accepted and found, and no grade, record or kind it does not implement', async () => {
    const cached = { ...real, tracker: null, layer: null, hidden: null, gold: null, witnessed: new Map<string, Witness>() };
    expect(named((await runTool(over(cached), 'quilt_read', { problem: m })).text)).toBe([
      'Problem <m>',
      `The owner, ${OWNER}, titled it: "What does the report claim?"`,
      'and wrote of when it is done: "Every claim is read."',
      '12 pieces, version 1 along prev.',
      'ppvpdd??????',
      '3 accepted provisional, 1 needs verify, 2 disputed, 6 unknown',
      KINDS_M,
      LEGEND,
      'Answered from the cache or a mirror.',
      'Link: quilt:<m>?dn=claims&tr=<tracker>',
      '',
      'Found: the accepted squares agreed on verdict: 2 "supports", 1 "contradicts"; tone: 1 "plain".',
      '',
      'Accepted so far:',
      'statement/1, Ada returned: {"verdict":"supports"}',
      `statement/1, ${B} returned: {"verdict":"supports"}`,
      'statement/2, Ada returned: {"verdict":"contradicts"}',
      `statement/2, ${C} returned: {"verdict":"contradicts"}`,
      'claim/1, Ada returned: {"page":4,"tone":"plain","verdict":"supports"}',
      `claim/1, ${B} returned: {"page":4,"tone":"plain","verdict":"supports"}`,
      '',
      'Disputed:',
      'claim/2 is disputed, with 2 returns.',
      'The returns differ on verdict, tone, page.',
      'Ada (anthropic/claude), this key, returned: {"page":4,"tone":"plain","verdict":"supports"}',
      `${B} (openai/gpt-5) returned: {"page":9,"tone":"hedged","verdict":"contradicts"}`,
      '',
      'claim/3 is disputed, with 2 returns.',
      'The returns differ on verdict, tone.',
      'Ada (anthropic/claude), this key, returned: {"page":4,"tone":"plain","verdict":"supports"}',
      `${C} (google/gemini) returned: {"page":4,"tone":"hedged","verdict":"contradicts"}`,
      '',
      'Challenges:',
      'No challenge on this problem.',
      '',
      'Panels:',
      'No judge panel on this problem.',
    ].join('\n'));
  });
});

/**
 * What no tracker in this process gives, fixed over the real problems. A state outside the legend, which only a tracker
 * newer than this client names. A patch accepted by two runs, and a patch disputed between two returns, on the kinds
 * problem: the client posts no run, so the core's check and score sets are built here as the reducer builds them. Keys
 * that sign for another root (CORE.md section 6), which no key here is delegated to do. A seam side whose rest names a
 * read its trace does not hold, and one carrying its own name, which a tracker's layer does not send and quilt_next sets.
 */
describe('quilt_open and quilt_read over what no tracker here gives', () => {
  const by = (model: string): By => ({ model, client: 'Claude Code', can: ['files'] });
  const PATCH = 'diff --git a/check.sh b/check.sh';
  /** A return of a patch, signed by the key and counted for the root, the key's own unless a root delegated to it (CORE.md section 6). */
  const patched = (key: string, model: string, patch: string, root = key): Reveal => ({ key: key as Address, root: root as Address, at: T, return: { patch }, vendor: model.split('/')[0]!, by: by(model), digest: hashCanonical({ patch }) });
  /** A run of a patch: the check exited cleanly on the run's host. */
  const ran = (key: string, model: string, digest: Hash): Run => ({ key: key as Address, root: key as Address, at: T, digest, exit: 0, host: 'runner.example', by: by(model) });

  it('quilt_open marks a state outside the legend with ? and counts it under its own name', async () => {
    const opened = await mk(1, 'anthropic/claude').open(r);
    const v = opened.state.pieces[0]!;
    const k = kindWords(v.piece.verifier);
    const paused: LayerPiece = { hash: v.piece.hash, name: v.piece.name, verifier: v.piece.verifier, state: 'paused' as LayerState, core: v.state, kind: k.kind, strength: k.strength, extension: k.extension, says: k.says, weakest: k.weakest, attested: false, panel: null, challenge: null };
    expect(named((await runTool(over({ ...opened, layer: [paused] }), 'quilt_open', { link: r })).text)).toBe([
      ...HEAD_R.slice(0, 4),
      '?',
      '1 paused',
      ...HEAD_R.slice(6),
    ].join('\n'));
  });

  it('quilt_read says a patch accepted by two runs, and a patch disputed with no schema to differ on, between keys signing for other roots', async () => {
    const opened = await mk(1, 'anthropic/claude').open(k);
    const ADA = a.identity!.address;
    const D = d.identity!.address;
    const views = new Map(opened.state.pieces.map((v) => [v.piece.name, v] as const));
    const patch = patched(ADA, 'anthropic/claude', PATCH);
    const runs: [Run, Run] = [ran(B, 'openai/gpt-5', patch.digest), ran(C, 'google/gemini', patch.digest)];
    const accepted: PieceView = { ...views.get('patch')!, state: 'accepted_provisional', reveals: [patch], runs, accepting: { kind: 'check', patch, runs, completedAt: T } };
    // The reader's key signing for another root, and another key signing for the reader's root: each is this key's.
    const disputed: PieceView = { ...views.get('scored')!, state: 'disputed', reveals: [patched(ADA, 'anthropic/claude', PATCH, E), patched(D, 'anthropic/claude', `${PATCH} b`, ADA)] };
    const pieces = opened.state.pieces.map((v) => (v.piece.name === 'patch' ? accepted : v.piece.name === 'scored' ? disputed : v));
    const state = { ...opened.state, pieces, byHash: new Map(pieces.map((v) => [v.piece.hash, v] as const)) };
    // One side's rest names a read its trace does not hold, so it rests on nothing kept; the other side carries its own name.
    const seams: Seam[] = [{ field: 'patch', why: 'unknown', sides: [{ key: ADA, value: PATCH, read: null, span: [0, 32], passage: null }, { key: D, name: 'Bea', value: `${PATCH} b`, read: READ_B, span: [0, 34], passage: null }] }];
    const layer = (opened.layer ?? []).map((l) => (l.name === 'patch' ? { ...l, state: 'accepted_provisional' as const, verified: true } : l.name === 'scored' ? { ...l, state: 'disputed' as const, seams } : l));
    expect(named((await runTool(over({ ...opened, state, layer }), 'quilt_read', { problem: k })).text)).toBe([
      'Problem <k>',
      'The owner, Ada, titled it: "Which kinds are here?"',
      'and wrote of when it is done: "Each kind has a piece."',
      '4 pieces, version 1 along prev.',
      'pd.?',
      '1 accepted provisional, 1 disputed, 1 open, 1 unknown',
      'Kinds: 1 check (reproduced: two unrelated runs reproduce the patch); 1 score (reproduced: two unrelated runs score the patch within tolerance); 1 human (agreed: two people at seats a tracker opened for them agree); 1 oracle (unknown: a kind this client does not implement).',
      LEGEND,
      'Answered by <tracker>.',
      'Link: quilt:<k>?dn=kinds&tr=<tracker>',
      '',
      'Accepted so far:',
      `patch (verified: the set agreed with the answer the owner committed to before the work), Ada returned a patch of 32 characters, run by ${B} and ${C}`,
      '',
      'Disputed:',
      'scored is disputed, with 2 returns.',
      `On patch, one side rests on nothing kept: Ada rests it on nothing kept; Bea rests it on ${AT_B}, bytes 0 to 34).`,
      `${E} (anthropic/claude), this key, returned: {"patch":"${PATCH}"}`,
      `Ada (anthropic/claude), this key, returned: {"patch":"${PATCH} b"}`,
      '',
      'Challenges:',
      'No challenge on this problem.',
      '',
      'Panels:',
      'No judge panel on this problem.',
    ].join('\n'));
  });
});

/** What a Quilt reads, answered with fixed values; the text is still built by runTool and render.ts. */
type Answers = Partial<Pick<Quilt, 'me' | 'standing' | 'coin' | 'wellKnown' | 'search'>>;
function answering(answers: Answers, trackers = ['https://t.example/']): Quilt {
  const config: Config = { ...DEFAULT_CONFIG, trackers };
  return Object.assign(new Quilt(config, null, new Resolver(config, tempHome())), answers);
}

type Me = ReturnType<Quilt['me']>;
const me = (over: Partial<Me>): (() => Me) => () => ({
  address: '0x1111111111111111111111111111111111111111', name: 'Ada', model: 'anthropic/claude', can: ['web', 'files'], trackers: ['https://t.example/', 'https://u.example/'],
  mirrors: [], relays: [], queued: 2, problems: 3, wordsDue: false, witness: null, ...over,
});
const TOP = ['Address: 0x1111111111111111111111111111111111111111', 'Name: Ada', 'Declares: anthropic/claude; can: web, files', 'Trackers: https://t.example/, https://u.example/'];
const A64 = `sha256:${'a'.repeat(64)}` as Hash;
const B64 = `sha256:${'b'.repeat(64)}` as Hash;
const C64 = `sha256:${'c'.repeat(64)}` as Hash;
const D64 = `sha256:${'d'.repeat(64)}` as Hash;

describe('quilt_me', () => {
  it('says the words due, the relays, a standing with a founding and locks, the coin owed today and a product\'s witness bound by its key', async () => {
    const quilt = answering({
      me: me({ wordsDue: true, relays: ['wss://relay.example/', 'wss://relay2.example/'], witness: { via: 'claude.ai', client: 'Claude', by: 'key' } }),
      standing: async () => ({ tracker: 'https://t.example/', standing: 12, locked: 3, free: 9, founding: 5, locks: [{ problem: A64, piece: B64, amount: 2, at: '2026-11-07T00:00:00.000Z' }, { problem: A64, piece: C64, amount: 1, at: '2026-11-07T00:00:00.000Z' }] }),
      coin: async () => ({ home: 'https://t.example/', balance: 100, vested: 70, unvested: 30, locked: 10, escrowed: 20, free: 70, free_vested: 40, pending: { amount: 1, pays_at: '2026-11-08T00:00:00.000Z', epoch: 3 } }),
    });
    expect((await runTool(quilt, 'quilt_me', {})).text).toBe([
      TOP[0],
      'The key was made here at first use; its twelve words wait on the page at http://localhost:3978/#me to be written down once',
      ...TOP.slice(1),
      'Relays: wss://relay.example/, wss://relay2.example/',
      `Standing: 12, of which 5 was declared at the founding and the rest earned by work, not for sale (locked 3, free to stake 9) at https://t.example/; locks: 2 on ${B64} of ${A64}, 1 on ${C64} of ${A64}`,
      'Coin (QX-17): 100 units (transferable now 40, still vesting 30, locked 10, escrowed 20, free to stake or pay 70) at https://t.example/; owed from the squares verified so far today: 1 units, paid at 2026-11-08T00:00:00.000Z',
      'Witnessed by claude.ai: this session\'s token came through claude.ai\'s OAuth callback, and the token request was signed with the key claude.ai publishes, so the tracker writes via: claude.ai beside custody: hosted on each event it posts for this key (QX-18). It says claude.ai made the calls, not who wrote the answer, and it is the tracker\'s word.',
      'Queued events: 2; problems in the library: 3',
    ].join('\n'));
  });

  it('says a standing earned alone, a coin with nothing owed today and a product\'s witness bound by its addresses', async () => {
    const quilt = answering({
      me: me({ witness: { via: 'chatgpt.com', client: null, by: 'address' } }),
      standing: async () => ({ tracker: 'https://t.example/', standing: 4, locked: 0, free: 4, founding: 0, locks: [] }),
      coin: async () => ({ home: 'https://t.example/', balance: 0, vested: 0, unvested: 0, locked: 0, escrowed: 0, free: 0, free_vested: 0, pending: { amount: 0, pays_at: '2026-11-08T00:00:00.000Z', epoch: 3 } }),
    });
    expect((await runTool(quilt, 'quilt_me', {})).text).toBe([
      ...TOP,
      'Standing: 4, earned by work and not for sale (locked 0, free to stake 4) at https://t.example/',
      'Coin (QX-17): 0 units (transferable now 0, still vesting 0, locked 0, escrowed 0, free to stake or pay 0) at https://t.example/',
      'Witnessed by chatgpt.com: this session\'s token came through chatgpt.com\'s OAuth callback, and the token request came from the addresses chatgpt.com publishes for its servers, so the tracker writes via: chatgpt.com beside custody: hosted on each event it posts for this key (QX-18). It says chatgpt.com made the calls, not who wrote the answer, and it is the tracker\'s word.',
      'Queued events: 2; problems in the library: 3',
    ].join('\n'));
  });

  it('says a product\'s witness from before the binding without saying how it was bound', async () => {
    const quilt = answering({ me: me({ witness: { via: 'claude.ai', client: null, by: null } }), standing: async () => null, coin: async () => null, wellKnown: async () => null });
    expect((await runTool(quilt, 'quilt_me', {})).text).toBe([
      ...TOP,
      'Standing: no tracker answered',
      'Witnessed by claude.ai: this session\'s token came through claude.ai\'s OAuth callback, so the tracker writes via: claude.ai beside custody: hosted on each event it posts for this key (QX-18). It says claude.ai made the calls, not who wrote the answer, and it is the tracker\'s word.',
      'Queued events: 2; problems in the library: 3',
    ].join('\n'));
  });

  it('names a tracker that answered without the standing route as older, and says how Quilt works to a key with no problem opened', async () => {
    const quilt = answering({
      me: me({ address: null, name: null, problems: 0, queued: 0 }),
      standing: async () => null,
      coin: async () => null,
      wellKnown: async () => ({ routes: ['/p/:hash/state'] }),
    });
    expect((await runTool(quilt, 'quilt_me', {})).text).toBe([
      'Address: none yet (made at first use)',
      'Name: none set',
      ...TOP.slice(2),
      'Standing: none; the tracker at https://t.example/ answered but is an older one without the standing route (QX-15)',
      'Queued events: 0; problems in the library: 0',
      `New here, with no problem opened yet. ${HOW_QUILT_WORKS}`,
    ].join('\n'));
  });

  it('says no tracker answered where none gave a standing, with a coin owing nothing and a client\'s witness by its own name or none', async () => {
    const byName = answering({
      me: me({ problems: 1, witness: { via: 'other', client: 'Cursor' } }),
      standing: async () => null,
      coin: async () => null,
      wellKnown: async (t) => (t.startsWith('https://u.') ? { routes: ['/k/:address/standing'] } : null),
    }, ['https://t.example/', 'https://u.example/']);
    expect((await runTool(byName, 'quilt_me', {})).text).toBe([
      ...TOP,
      'Standing: no tracker answered',
      'Witness: none. This session\'s token came through a client that is no product the tracker knows, which calls itself "Cursor", so the tracker writes via: other beside custody: hosted on each event it posts for this key (QX-18).',
      'Queued events: 2; problems in the library: 1',
    ].join('\n'));
    const nameless = answering({
      me: me({ witness: { via: 'other', client: null } }),
      standing: async () => null,
      coin: async () => ({ home: 'https://t.example/', balance: 5, vested: 5, unvested: 0, locked: 0, escrowed: 0, free: 5, free_vested: 5 }),
      wellKnown: async () => null,
    });
    expect((await runTool(nameless, 'quilt_me', {})).text).toBe([
      ...TOP,
      'Standing: no tracker answered',
      'Coin (QX-17): 5 units (transferable now 5, still vesting 0, locked 0, escrowed 0, free to stake or pay 5) at https://t.example/',
      'Witness: none. This session\'s token came through a client that is no product the tracker knows, so the tracker writes via: other beside custody: hosted on each event it posts for this key (QX-18).',
      'Queued events: 2; problems in the library: 3',
    ].join('\n'));
  });
});

const row = (over: Partial<Found>): Found => ({
  problem: A64, title: 'T', slug: 's', owner: '0xowner', owner_name: null, from: null, root: A64, pieces: 4, counts: {}, kinds: null, work: null, topics: [],
  tracker: 'https://t.example/', via: 'tracker', held: ['https://t.example/'], announcer: null, announced: null, ...over,
});

/**
 * What a tracker's row says its accepted squares found, as it comes over the wire: the text leaves out a field or a
 * choice that fails the gate, a count of zero or a fraction, and a field with no choice left or none at all, and says
 * the choices most first whatever order they came in.
 */
const rowFound = { verdict: { contradicts: 1, supports: 3, 'see www.example.com/x': 2, maybe: 0, half: 1.5 }, 'www.example.com/x': { yes: 1 }, quiet: { none: 0 }, odd: null } as unknown as Record<string, Record<string, number>>;

describe('quilt_search', () => {
  it('says each problem in three lines: a tracker\'s row with every count, a fork under it, a relay\'s row from its owner and one from a seeder', async () => {
    const quilt = answering({
      search: async (query) => (query !== 'paper' ? [] : [
        row({
          title: 'Does the paper say so?', slug: 'says', owner_name: 'Ada', topics: ['history', 'law'], kinds: { agree: 3, attest: 1 }, held: ['https://t.example/', 'https://u.example/'],
          work: { returned: 9, accepted: 4, verified: 2, disputed: 1, recorded: 1, traced: { both: 2, one: 1, none: 1 }, readers: 3, vendors: 2, last: '2026-11-06T10:00:00.000Z', declined: 2, found: rowFound },
        }),
        // A row whose found is null, as a tracker's JSON may carry it.
        row({ problem: B64, from: A64, root: A64, title: 'Does the paper say so? A fork', slug: 'says-fork', work: { returned: 1, accepted: 0, verified: 0, disputed: 0, traced: { both: 0, one: 0, none: 0 }, readers: 1, vendors: 1, last: null, found: null as unknown as Record<string, Record<string, number>> } }),
        row({ problem: C64, root: C64, title: 'Announced', slug: 'announced', owner: '0xOWNER2', via: 'relay', held: ['wss://relay.example/'], announcer: '0xowner2', announced: '2026-11-05T09:00:00.000Z', counts: { open: 2, needs_verify: 1 }, tracker: 'https://u.example/' }),
        row({ problem: D64, root: D64, title: 'Seeded', slug: 'seeded', owner: '0xowner3', via: 'relay', held: ['wss://relay.example/'], announcer: '0xseeder', counts: {}, kinds: { 'judge:3': 1 } }),
      ]),
    });
    expect((await runTool(quilt, 'quilt_search', { query: 'paper' })).text).toBe([
      A64,
      '  titled by Ada (0xowner): "Does the paper say so?" (says); topics: history, law',
      '  4 pieces (3 agree, 1 attest, the weakest kind): 9 returned, 4 accepted, 2 of them verified by the owner\'s gold, 1 disputed, 1 recorded; of the accepted, 2 rest on kept reads on both sides, 1 on one, 1 on none; 3 readers from 2 vendors; last worked 2026-11-06; 2 declined; the accepted squares agreed on verdict: 3 "supports", 1 "contradicts"; 2 proposals of this problem; the first has the most work; held at 2 places (https://t.example/, https://u.example/); opens at https://t.example/',
      B64,
      '  titled by 0xowner: "Does the paper say so? A fork" (says-fork)',
      `  4 pieces: 1 returned, 0 accepted; 1 reader from 1 vendor; proposed from ${A64}; held at 1 place (https://t.example/); opens at https://t.example/`,
      C64,
      '  titled by 0xOWNER2: "Announced" (announced)',
      '  4 pieces: 2 open, 1 needs verify; held at 1 place (wss://relay.example/); as announced by its owner on 2026-11-05; opens at https://u.example/',
      D64,
      '  titled by 0xowner3: "Seeded" (seeded)',
      '  4 pieces (1 judge:3): nothing yet; held at 1 place (wss://relay.example/); as announced by a seeder; opens at https://t.example/',
    ].join('\n'));
  });

  it('says so when nothing matched', async () => {
    expect((await runTool(answering({ search: async () => [] }), 'quilt_search', { query: 'paper' })).text).toBe('No problem matched on the trackers and relays this client knows.');
  });
});
