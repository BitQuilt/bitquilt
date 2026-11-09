import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, canonicalBytes, hashBytes, problemHash } from '@bitquilt/core';
import { CHAIN_PIECES_MAX, DATA_MAX, EXPANDED_MAX, INPUTS_MAX, expandedBytes } from '../src/admit.js';
import { VERDICT, boot, envelope, key } from './helpers.js';

/**
 * PROTOCOL.md, What the door answers: a problem a door takes is one its fold can take in work the door bounds before
 * it reads a blob or expands a piece, since every read folds every problem. Its inputs make at most a million links
 * (`INPUTS_MAX`), each piece to each piece an entry names and a repeated entry again; its data blobs weigh at most
 * 16 MB (`DATA_MAX`), each blob once, held already or sent; and its pieces expand to at most 32 MB (`EXPANDED_MAX`),
 * each definition once a piece and each slot that names a data slot the bytes of that slot's blob, so a long brief
 * over many pieces and a slot written many times over a long row are refused from an envelope of a few kilobytes. A
 * version's chain is held to two million pieces between the folds of its versions (`CHAIN_PIECES_MAX`), since each
 * version's fold expands every version before it. A problem at each bound is taken, and the door answers its pages
 * throughout.
 */
const owner = key(9);
const START = '2026-11-08T12:00:00Z';
const t = boot(START, { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
beforeAll(() => t.listen());
afterAll(() => t.close());

const q = { verifier: 'agree' as const, brief: 'Statement {n}.', schema: VERDICT, agree: ['verdict'] };
const SETTINGS = { settings: { budget: 1e9 } };
/** A publish of the envelope with these blobs sent beside it, and what the door answered. */
async function publishing(e: Envelope, sent: Uint8Array[] = []) {
  const blobs = Object.fromEntries(sent.map((b) => [hashBytes(b), Buffer.from(b).toString('base64')]));
  const r = await t.post('/p', { envelope: e, blobs });
  const body = (await r.json()) as { error?: string };
  return { status: r.status, ...(body.error ? { error: body.error } : {}) };
}
/** Bytes of JSON text: a list of `rows` strings, each `width` characters long, told apart by `tag`. */
const rows = (n: number, width: number, tag: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(Array.from({ length: n }, (_, i) => `${tag}${i}`.padEnd(width, 'r'))));

describe("a problem's inputs", () => {
  it('make at most a million links, a repeated entry counted again', async () => {
    const reading = (count: number, entries: number) =>
      envelope(
        owner,
        `links-${count}-${entries}`,
        { 'a/*': { ...q, count, inputs: Array(entries).fill('b/*') }, 'b/*': { ...q, count: 1000 } },
        SETTINGS,
      );
    expect(await publishing(reading(1001, 1))).toEqual({
      status: 400,
      error: `problem.pieces: inputs that make 1001000 links, over the ${INPUTS_MAX} a door takes`,
    });
    expect(await publishing(reading(10, 101))).toEqual({
      status: 400,
      error: `problem.pieces: inputs that make 1010000 links, over the ${INPUTS_MAX} a door takes`,
    });
    expect(await publishing(reading(1000, 1))).toEqual({ status: 201 });
  });
});

describe("a problem's data blobs", () => {
  it('weigh at most 16 MB, each blob once, held already or sent', async () => {
    const MB = 1024 * 1024;
    // Fifteen blobs of a megabyte held here already, and a list of rows the pieces read.
    const held = Array.from({ length: 15 }, (_, i) => rows(1, MB - 6, `held${i}-`));
    for (const b of held) t.store.putBlob(hashBytes(b), b);
    const list = rows(1, 1000, 'row');
    const data = (extra: Uint8Array[]) =>
      Object.fromEntries([list, ...held, ...extra].map((b, i) => [`d${i}.json`, hashBytes(b)] as const));
    const over = rows(1, 2 * MB, 'sent');
    const weighing = (extra: Uint8Array[], slug: string, more: Record<string, Hash> = {}) =>
      envelope(
        owner,
        slug,
        { 'c/*': { ...q, count: 1, brief: '{c}', data: { c: 'd0.json' } } },
        {
          ...SETTINGS,
          data: { ...data(extra), ...more },
        },
      );
    const total = [list, ...held, over].reduce((n, b) => n + b.length, 0);
    expect(total).toBeGreaterThan(DATA_MAX);
    expect(await publishing(weighing([over], 'data-over'), [list, over])).toEqual({
      status: 400,
      error: `problem.data: blobs of ${total} bytes, over the ${DATA_MAX} a door takes`,
    });
    // A blob named twice weighs once.
    const twice = weighing([], 'data-twice', { 'again.json': hashBytes(held[0]!) });
    expect(await publishing(twice, [list])).toEqual({ status: 201 });
  });
});

describe("a problem's pieces", () => {
  it('expand to at most 32 MB, bounded before they are expanded', async () => {
    const long = (width: number) => ({
      'a/*': { ...q, count: 10_000, brief: `${'Read it again. '.repeat(width)}{n}` },
    });
    const per = (width: number) => canonicalBytes(long(width)['a/*']).length;
    const over = envelope(owner, 'long-briefs', long(240), SETTINGS);
    expect(per(240) * 10_000).toBeGreaterThan(EXPANDED_MAX);
    expect(await publishing(over)).toEqual({
      status: 400,
      error: `problem.pieces: expand to as much as ${per(240) * 10_000} bytes, over the ${EXPANDED_MAX} a door takes`,
    });
    const under = envelope(owner, 'long-enough', long(200), SETTINGS);
    expect(expandedBytes(under.problem, () => null)).toBeLessThan(EXPANDED_MAX);
    expect(await publishing(under)).toEqual({ status: 201 });
  });

  it('count a slot written many times over a long row as many times over', async () => {
    const row = rows(1, 40_000, 'one');
    const repeated = envelope(
      owner,
      'slot-many-times',
      { 'c/*': { ...q, count: 1, brief: '{c} '.repeat(1000), data: { c: 'row.json' } } },
      { ...SETTINGS, data: { 'row.json': hashBytes(row) } },
    );
    expect(JSON.stringify(repeated).length).toBeLessThan(8000);
    const bound = expandedBytes(repeated.problem, (h) => (h === hashBytes(row) ? row.length : null));
    expect(bound).toBeGreaterThan(EXPANDED_MAX);
    expect(await publishing(repeated, [row])).toEqual({
      status: 400,
      error: `problem.pieces: expand to as much as ${bound} bytes, over the ${EXPANDED_MAX} a door takes`,
    });
  });

  it('of a chain expand at most two million between the folds of its versions', async () => {
    // Each version of ten thousand pieces folds every version before it: nineteen fold 1900000 pieces between them,
    // and a twentieth would make it 2100000.
    let prev: Hash | null = null;
    for (let v = 1; v <= 20; v++) {
      const version = envelope(
        owner,
        'a-long-chain',
        { 'q/*': { ...q, count: 10_000, brief: `Statement {n}, as version ${v} puts it.` } },
        { ...SETTINGS, prev },
      );
      const answer = await publishing(version);
      if (v < 20) expect(answer).toEqual({ status: 201 });
      else
        expect(answer).toEqual({
          status: 400,
          error: `problem.prev: the folds of its chain would expand 2100000 pieces, over the ${CHAIN_PIECES_MAX} a door takes`,
        });
      prev = problemHash(version);
    }
  });

  it('leave the door answering', async () => {
    for (const path of ['/', '/search', '/.well-known/quilt']) expect((await fetch(t.base + path)).status).toBe(200);
  });
});
