import { execFile } from 'node:child_process';
import type { Server } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, addressOf, secretFromHex } from '@bitquilt/core';
import { type Config, DEFAULT_CONFIG, createKey, loadKey } from '../src/config.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { handedJson } from '../src/render.js';
import { Resolver } from '../src/resolver.js';
import { runTool } from '../src/tools.js';
import { hex, quiltOver, startTracker, tempHome } from './helpers.js';

/**
 * The command line says what the tools say (bin.ts against tools.ts): `quilt open`, `quilt read` and `quilt next` print
 * the text runTool gives for quilt_open, quilt_read and quilt_next over the same home and the same ledger. So the lines
 * the command line once left out are there: the owner's gold (QX-16), the version that replaced a problem (QX-19
 * section 4), what the accepted squares found, and the record pieces' readings (QX-20). quilt_read opens with what
 * quilt_open says, the replaced-by line included. `quilt next --json` prints the piece as handedJson makes it, as
 * before.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const run = promisify(execFile);
let server: Server;
let base: string;
let home: string;
let config: Config;
let older: Hash, newer: Hash;

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?',
  done_when: 'Every statement has a verdict agreed by two vendors, and the question has its readings.',
  slug: 'cli-text',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: does the paper say so? Return the verdict and a quote.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'quote'],
        properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string', maxLength: 160 } },
      },
      agree: ['verdict'],
    },
    question: {
      verifier: 'record:2',
      requires: ['web'],
      brief: 'Does the paper ground its claim in its data? Read it your way.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['stance', 'reading'],
        properties: { stance: { enum: ['grounds', 'does not ground'] }, reading: { type: 'string', maxLength: 200 } },
      },
      agree: ['stance'],
    },
  },
};

/**
 * A Quilt over the reader's home as the command line makes one (bin.ts, `make`): the same config and key, and no host
 * named.
 */
const asCli = (fetchImpl: typeof fetch = fetch): Quilt =>
  new Quilt(config, loadKey(home), new Resolver(config, home, fetchImpl));

/**
 * A fetch that takes every post as a tracker would and keeps it from the tracker, so the command line's claim after it
 * meets the same ledger.
 */
const keepsPosts: typeof fetch = async (input, init) =>
  init?.method === 'POST' ? new Response('{}', { status: 202 }) : fetch(input, init);

/** One run of the command line over the reader's home and the test's tracker: what it printed. */
async function cli(...args: string[]): Promise<string> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('QUILT_')));
  const { stdout } = await run(
    process.execPath,
    ['--import', 'tsx', join(root, 'packages', 'client', 'src', 'bin.ts'), ...args],
    { cwd: root, encoding: 'utf8', env: { ...env, QUILT_HOME: home, QUILT_TRACKERS: base } },
  );
  return stdout;
}

beforeAll(async () => {
  // The owner's gold asks a stake of standing, which a founding standing covers here.
  ({ server, base } = await startTracker({
    limits: { keyPerHour: 1000, ipPerHour: 10000 },
    founding: { [addressOf(secretFromHex(hex(9)))]: 10 },
  }));
  config = { ...DEFAULT_CONFIG, trackers: [base] };
  home = tempHome('quilt-cli-');
  createKey(home, { secretHex: hex(3) });
  const mk = quiltOver(base);
  const owner = mk(9);
  const a = mk(1, 'anthropic/claude');
  const b = mk(2, 'openai/gpt-5', 'ChatGPT');
  const r = await owner.publish({
    ...pattern,
    gold: { answers: { 'statement/2': { verdict: 'supports', quote: 'not committed' } } },
  });
  expect(r.refused).toEqual([]);
  expect(r.gold?.pieces).toBe(1);
  older = r.hash;
  const first = (await a.open(older)).state.pieces.find((v) => v.piece.name === 'statement/1')!.piece.hash;
  await a.return(older, first, { verdict: 'supports', quote: 'as the paper says' });
  await b.return(older, first, { verdict: 'supports', quote: 'the paper says so' });
  // The owner replaces it with a version naming it as prev, and the work goes on there.
  newer = (await owner.publish({ ...pattern, prev: older })).hash;
}, 90_000);
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('the command line says what the tools say', () => {
  it("prints quilt_open's text for `quilt open`, the gold and the replaced-by line with it", async () => {
    const text = (await runTool(asCli(), 'quilt_open', { link: older })).text;
    expect(text).toContain(
      'Gold (QX-16): the owner committed answers for 1 of the pieces before the work, without saying which',
    );
    expect(text).toContain(`Its owner replaced this version with ${newer}; the work is there.`);
    expect(await cli('open', older)).toBe(`${text}\n`);
  });

  it("prints quilt_read's text for `quilt read`, which opens with what quilt_open says and adds what was found and recorded", async () => {
    const opened = (await runTool(asCli(), 'quilt_open', { link: older })).text;
    const text = (await runTool(asCli(), 'quilt_read', { problem: older })).text;
    expect(text.startsWith(`${opened}\n\n`)).toBe(true);
    expect(text).toContain('Found: the accepted squares agreed on verdict: 1 "supports".');
    expect(text).toContain('\n\nAccepted so far:\nstatement/1 (rests on no kept read), ');
    expect(text).toContain('\n\nRecorded:\nquestion (record:2; recording: 0 of 2 readings');
    expect(await cli('read', older)).toBe(`${text}\n`);
  });

  it('prints the piece as handedJson makes it for `quilt next --json`, as before', async () => {
    const handed = await asCli(keepsPosts).next(newer);
    const out = JSON.parse(await cli('next', newer, '--json')) as unknown;
    expect(out).toEqual(JSON.parse(JSON.stringify(handedJson(handed))));
    expect(out).toMatchObject({ problem: newer, posted: { at: base, queued: false } });
  });

  it("prints quilt_next's text for `quilt next`, the claim said as the tool says it", async () => {
    const text = (await runTool(asCli(keepsPosts), 'quilt_next', { problem: newer })).text;
    expect(text).toContain(`of problem ${newer}`);
    expect(text.endsWith(`\nThe claim was posted to ${base}.`)).toBe(true);
    expect(await cli('next', newer)).toBe(`${text}\n`);
  });
});
