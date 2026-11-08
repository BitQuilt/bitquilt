/**
 * CLIENT.md, What the door checks, in order: the door admits before it dedupes, so a reveal or a trace posted again
 * after a lost answer is refused where the door holds it already, and a worker that lost the answer to its post looks
 * for its event in the problem's log. Held over a tracker in this process where the answer to the first post is lost
 * after the door took it: Quilt's config names the tracker without its slash and the library with it, so a post is
 * offered to one door twice, and the repeat is refused at row 16 for a reveal and at row 19 for a trace. Quilt looks in
 * the log and says the event was taken there, posted and not refused, and nothing waits in the queue. A refusal stays
 * a refusal where the event is in no log, and where no answer before it was lost.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Event, type Hash, eventId } from '@bitquilt/core';
import { type Config, DEFAULT_CONFIG, createKey, loadKey } from '../src/config.js';
import { type Pattern, Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { traceText } from '../src/trace.js';
import { hex, quiltOver, startTracker, tempHome } from './helpers.js';

const DOC = readFileSync(new URL('../../../docs/CLIENT.md', import.meta.url), 'utf8');
const PASSAGE = 'the lamp was lit at dusk';

const pattern: Pattern = {
  title: 'Does the lighthouse log say what the keeper said?',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'lost-answer',
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 4,
      verifier: 'agree',
      requires: ['web'],
      brief: 'Statement {n}: does the log say the lamp was lit at dusk? Return the verdict and a quote.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict', 'quote'],
        properties: { verdict: { enum: ['holds', 'fails'] }, quote: { type: 'string', maxLength: 160 } },
      },
      agree: ['verdict'],
    },
  },
};

let tracker: Server;
let pages: Server;
let base: string;
let site: string;
let worker: Quilt;
let p: Hash;
const pieces: Hash[] = [];

/** The type of event whose next post loses its answer, and whether that post reaches the door first. */
let lose: { type: string; reached: boolean } | null = null;
/** Every post the worker made: the event's type and what the door answered, or `lost`. */
let posts: { type: string; answer: number | 'lost' }[] = [];

/**
 * The worker's way to the network: what it posts reaches the tracker, and the answer to the one post `lose` names is
 * lost, after the door took it or before it reached the door.
 */
const losing: typeof fetch = async (input, init) => {
  const type = init?.method === 'POST' && typeof init.body === 'string' ? (JSON.parse(init.body) as Event).type : null;
  if (type && lose?.type === type) {
    const { reached } = lose;
    lose = null;
    posts.push({ type, answer: 'lost' });
    if (reached) await (await fetch(input, init)).arrayBuffer();
    throw new TypeError('fetch failed');
  }
  const r = await fetch(input, init);
  if (type) posts.push({ type, answer: r.status });
  return r;
};

/** The ids of the events of a type the tracker's log holds for the problem. */
async function held(type: string): Promise<Hash[]> {
  const text = await (await fetch(`${base}p/${p}/events`)).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((l) => (JSON.parse(l) as { event: Event }).event)
    .filter((e) => e.type === type)
    .map((e) => eventId(e));
}

beforeAll(async () => {
  ({ server: tracker, base } = await startTracker({ limits: { keyPerHour: 1000, ipPerHour: 10000 } }));
  pages = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`The keeper's log says ${PASSAGE}, and out at dawn.`);
  });
  await new Promise<void>((r) => pages.listen(0, '127.0.0.1', () => r()));
  site = `http://127.0.0.1:${(pages.address() as AddressInfo).port}`;
  p = (await quiltOver(base)(9).publish(pattern)).hash;
  const home = tempHome('quilt-lost-');
  createKey(home, { secretHex: hex(1) });
  // The tracker as a person may write it in QUILT_TRACKERS, without its slash; the library keeps it with one.
  const config: Config = { ...DEFAULT_CONFIG, trackers: [base.slice(0, -1)] };
  worker = new Quilt(config, loadKey(home), new Resolver(config, home, losing), 'Claude Code');
  for (const v of (await worker.open(p)).state.pieces) pieces.push(v.piece.hash);
  expect(worker.library.problems[p]!.trackers).toEqual([base, base.slice(0, -1)]);
});
afterAll(async () => {
  await new Promise<void>((r) => pages.close(() => r()));
  await new Promise<void>((r) => tracker.close(() => r()));
});

describe('CLIENT.md, What the door checks, in order: a post again after a lost answer', () => {
  it('says the door holds a reveal posted again where the first answer was lost, and does not say refused', async () => {
    expect(DOC).toContain(
      "In each case, a worker that lost the answer to its post looks for its event in the problem's log",
    );
    expect(DOC).toContain(
      'Where a tracker it offered the event to was down, Quilt looks for the event in the log of each tracker it offered it to before it says the post was refused, and one that holds it took it.',
    );
    posts = [];
    lose = { type: 'reveal', reached: true };
    const r = await worker.return(p, pieces[0]!, { verdict: 'holds', quote: PASSAGE });
    expect(posts).toEqual([
      { type: 'commit', answer: 202 },
      { type: 'reveal', answer: 'lost' },
      { type: 'reveal', answer: 400 },
    ]);
    expect(r.commit).toEqual({ at: base, queued: false });
    expect(r.reveal).toEqual({ at: base, queued: false });
    expect(await held('reveal')).toHaveLength(1);
    expect(worker.resolver.queued()).toBe(0);
  });

  it('says the door holds a trace posted again where the first answer was lost', async () => {
    posts = [];
    lose = { type: 'trace', reached: true };
    const r = await worker.return(p, pieces[1]!, { verdict: 'holds', quote: PASSAGE }, [
      { field: 'quote', url: `${site}/log`, passage: PASSAGE },
    ]);
    expect(posts).toEqual([
      { type: 'commit', answer: 202 },
      { type: 'reveal', answer: 202 },
      { type: 'trace', answer: 'lost' },
      { type: 'trace', answer: 400 },
    ]);
    expect(r.trace!.posted).toEqual({ at: base, queued: false });
    expect(traceText(r.trace)).toBe(`Trace posted to ${base}: quote rests on 1 kept read (QX-19).`);
    expect(await held('trace')).toHaveLength(1);
  });

  it('says refused where the event is in no log after a lost answer, and where no answer was lost', async () => {
    posts = [];
    lose = { type: 'reveal', reached: false };
    await expect(worker.return(p, pieces[2]!, { verdict: 'maybe', quote: PASSAGE })).rejects.toThrow(
      'the tracker refused the reveal: return.verdict: one of holds, fails',
    );
    expect(posts.map((x) => x.answer)).toEqual([202, 'lost', 400]);
    posts = [];
    await expect(worker.return(p, pieces[3]!, { verdict: 'maybe', quote: PASSAGE })).rejects.toThrow(
      'the tracker refused the reveal: return.verdict: one of holds, fails',
    );
    expect(posts.map((x) => x.answer)).toEqual([202, 400]);
    expect(worker.resolver.queued()).toBe(0);
  });
});
