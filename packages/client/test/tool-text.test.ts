/**
 * The text runTool gives a model for quilt_search, quilt_open, quilt_read and quilt_me (tools.ts), pinned whole. The
 * inputs fire every branch tools.ts builds for these four: each clause given or left out, one or many, a fork under
 * its problem, a relay's row, a tracker that is older or silent. A change to how tools.ts builds the text that moves a
 * space, a separator or a clause fails here. The render.ts functions inside quilt_read's text have branches of their
 * own that these inputs leave unfired: a challenge or a panel present, a record piece recorded, a reading not counted,
 * a seam side resting on a passage, and found over two fields. Some of those are held where their extensions are
 * tested (challenge.test.ts, verifiers.test.ts, record.test.ts, trace.test.ts), and this file does not hold them.
 * Open and read run over a tracker in this process. Search and me run over a Quilt whose reads answer fixed values,
 * since their branches want a coin, a founding, relays and forks that one tracker does not give.
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash } from '@bitquilt/core';
import { HOW_QUILT_WORKS } from '../src/about.js';
import { type Config, DEFAULT_CONFIG } from '../src/config.js';
import { type Found, type Pattern, Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { runTool } from '../src/tools.js';
import { quiltOver, startTracker, tempHome } from './helpers.js';

let server: Server;
let base: string;
let owner: Quilt;
let p: Hash, q: Hash, r: Hash;

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

beforeAll(async () => {
  ({ server, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  const mk = quiltOver(base);
  owner = mk(9, 'anthropic/claude');
  const a = mk(1, 'anthropic/claude');
  const b = mk(2, 'openai/gpt-5', 'ChatGPT');
  const c = mk(3, 'google/gemini', 'Gemini');
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
});
afterAll(() => new Promise<void>((done) => server.close(() => done())));

/** The text with this run's tracker and problem hashes named, since the port and so the hashes differ from run to run. */
function named(text: string): string {
  const pairs: [string, string][] = [[encodeURIComponent(base), '<tracker>'], [base, '<tracker>'], [p, '<p>'], [q, '<q>'], [r, '<r>']];
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
      me: me({ wordsDue: true, relays: ['wss://relay.example/'], witness: { via: 'claude.ai', client: 'Claude', by: 'key' } }),
      standing: async () => ({ tracker: 'https://t.example/', standing: 12, locked: 3, free: 9, founding: 5, locks: [{ problem: A64, piece: B64, amount: 2, at: '2026-11-07T00:00:00.000Z' }, { problem: A64, piece: C64, amount: 1, at: '2026-11-07T00:00:00.000Z' }] }),
      coin: async () => ({ home: 'https://t.example/', balance: 100, vested: 70, unvested: 30, locked: 10, escrowed: 20, free: 70, free_vested: 40, pending: { amount: 7, pays_at: '2026-11-08T00:00:00.000Z', epoch: 3 } }),
    });
    expect((await runTool(quilt, 'quilt_me', {})).text).toBe([
      TOP[0],
      'The key was made here at first use; its twelve words wait on the page at http://localhost:3978/#me to be written down once',
      ...TOP.slice(1),
      'Relays: wss://relay.example/',
      `Standing: 12, of which 5 was declared at the founding and the rest earned by work, not for sale (locked 3, free to stake 9) at https://t.example/; locks: 2 on ${B64} of ${A64}, 1 on ${C64} of ${A64}`,
      'Coin (QX-17): 100 units (transferable now 40, still vesting 30, locked 10, escrowed 20, free to stake or pay 70) at https://t.example/; owed from the squares verified so far today: 7 units, paid at 2026-11-08T00:00:00.000Z',
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

describe('quilt_search', () => {
  it('says each problem in three lines: a tracker\'s row with every count, a fork under it, a relay\'s row from its owner and one from a seeder', async () => {
    const quilt = answering({
      search: async () => [
        row({
          title: 'Does the paper say so?', slug: 'says', owner_name: 'Ada', topics: ['history', 'law'], kinds: { agree: 3, attest: 1 }, held: ['https://t.example/', 'https://u.example/'],
          work: { returned: 9, accepted: 4, verified: 2, disputed: 1, recorded: 1, traced: { both: 2, one: 1, none: 1 }, readers: 3, vendors: 2, last: '2026-11-06T10:00:00.000Z', declined: 2, found: { verdict: { supports: 3, contradicts: 1 } } },
        }),
        row({ problem: B64, from: A64, root: A64, title: 'Does the paper say so? A fork', slug: 'says-fork', work: { returned: 1, accepted: 0, verified: 0, disputed: 0, traced: { both: 0, one: 0, none: 0 }, readers: 1, vendors: 1, last: null } }),
        row({ problem: C64, root: C64, title: 'Announced', slug: 'announced', owner: '0xOWNER2', via: 'relay', held: ['wss://relay.example/'], announcer: '0xowner2', announced: '2026-11-05T09:00:00.000Z', counts: { open: 2, needs_verify: 1 }, tracker: 'https://u.example/' }),
        row({ problem: D64, root: D64, title: 'Seeded', slug: 'seeded', owner: '0xowner3', via: 'relay', held: ['wss://relay.example/'], announcer: '0xseeder', counts: {}, kinds: { 'judge:3': 1 } }),
      ],
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
