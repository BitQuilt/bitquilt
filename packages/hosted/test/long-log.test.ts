import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, type Receipt, type Signature, addressOf } from '@bitquilt/core';
import { Store } from '@bitquilt/tracker';
import type { Pattern, Quilt } from 'quilt';
import { openDoor, quiltOver } from './helpers.js';

/**
 * The page of a square over a long chain (QX-19): what a reading rests on is found though its reveal and its trace
 * come after line ten thousand of the problem's chain, where the store once cut a read that named no bounds. The
 * filler goes into the store directly so the test stays fast; the store keeps the lines it is given, and the door is
 * what checks a signature.
 */
const OLD_PAGE = 10_000;
const store = new Store(':memory:');
const PAGE = '<!doctype html><html><body><p>The paper says the effect holds in every trial.</p></body></html>';
const HOLDS = 'the effect holds in every trial';
let server: Server;
let pages: Server;
let base: string;
let site: string;

beforeAll(async () => {
  pages = createServer((req, res) => {
    res.writeHead(req.url === '/paper' ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(req.url === '/paper' ? PAGE : 'no');
  });
  await new Promise<void>((r) => pages.listen(0, '127.0.0.1', () => r()));
  site = `http://127.0.0.1:${(pages.address() as AddressInfo).port}`;
  ({ server, base } = await openDoor({ store, hosted: { relays: ['ws://127.0.0.1:1'], sentence: null } }));
});
afterAll(() =>
  Promise.all([new Promise<void>((r) => server.close(() => r())), new Promise<void>((r) => pages.close(() => r()))]),
);

const quilt = (n: number, model: string): Quilt => quiltOver(base, n, model);

/** `n` lines of an event no reader folds, received before anything else on the chain. */
function fill(log: Hash, n: number): void {
  const at = '2026-01-01T00:00:00.000Z';
  const key = addressOf(new Uint8Array(32).fill(7));
  const sig = `0x${'00'.repeat(65)}` as Signature;
  const lines: Receipt[] = Array.from({ length: n }, (_, i) => ({
    event: { quilt: 1, type: 'note', key, ts: at, body: { n: i }, sig },
    received: [{ by: 'http://t.test/', at }],
  }));
  store.appendLines(log, lines);
}

describe('the page of a square over a long chain', () => {
  it('quotes what each reading rests on when the reveals and traces come past the old page', async () => {
    const owner = quilt(0x31, 'anthropic/claude'),
      a = quilt(0x32, 'anthropic/claude'),
      b = quilt(0x33, 'openai/gpt-5');
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['verdict'],
      properties: { verdict: { enum: ['supports', 'contradicts'] } },
    };
    const pattern = {
      title: 'A long chain',
      done_when: 'Every claim has a verdict.',
      slug: 'long',
      pieces: {
        'claim/*': {
          count: 1,
          verifier: 'agree',
          requires: ['web'],
          brief: 'Claim {n}: does the paper say so?',
          schema,
          agree: ['verdict'],
        },
      },
    } as Pattern;
    const p = (await owner.publish(pattern)).hash as Hash;
    fill(p, OLD_PAGE);
    const claim = (await a.open(p)).state.pieces.find((x) => x.piece.name === 'claim/1')!.piece.hash;
    const at = [{ field: 'verdict', url: `${site}/paper`, passage: HOLDS }];
    await a.return(p, claim, { verdict: 'supports' }, at);
    await b.return(p, claim, { verdict: 'supports' }, at);
    expect(store.lines(p).findIndex((l) => l.event.type === 'reveal')).toBeGreaterThanOrEqual(OLD_PAGE);
    const r = await fetch(`${base}r/${p}/${claim}`);
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('Both readings rest on pages kept here.');
    expect(html).toContain(`verdict rests on “${HOLDS}” at <a href="${site}/paper"`);
  });
});
