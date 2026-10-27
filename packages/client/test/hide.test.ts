import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, addressOf } from '@bitquilt/core';
import { type Pattern, Quilt } from '../src/quilt.js';
import { quiltOver, startTracker } from './helpers.js';

/** Quilt's side of QX-6: a maintainer's hide verb, and what a person sees when a problem is taken down on the tracker that answered. */
const secret = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
let server: Server;
let owner: Quilt, a: Quilt, m: Quilt;
let problem: Hash;

const pattern: Pattern = {
  title: 'Does the paper say what people say it says?',
  done_when: 'Every statement has a verdict agreed by two vendors.',
  slug: 'paper-says',
  topics: ['citations'],
  settings: { endgame_at: 1 },
  pieces: {
    'statement/*': {
      count: 2, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: {claim.text} Return whether the paper says this, with a quote.',
      data: { claim: 'claims' },
      schema: { type: 'object', additionalProperties: false, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'partly', 'contradicts', 'unreachable'] }, quote: { type: 'string', maxLength: 160 } } },
      agree: ['verdict'],
    },
  },
  data: { claims: [{ text: 'The coin is a chain of signatures.' }, { text: 'Difficulty never changes.' }] },
};

beforeAll(async () => {
  const t = await startTracker({ maintainers: [addressOf(secret(7))] });
  server = t.server;
  const mk = quiltOver(t.base);
  owner = mk(9);
  a = mk(1);
  m = mk(7);
  problem = (await owner.publish(pattern)).hash;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('a takedown seen from Quilt (QX-6)', () => {
  it('is refused from a key that is not a maintainer of the tracker', async () => {
    await expect(a.hide(problem, 'Not mine to say.')).rejects.toThrow(/maintainer/);
  });
  it('a maintainer hides the problem; the tracker stops listing it and a person opening it is told so; a lift restores it', async () => {
    const r = await m.hide(problem, 'The brief names a private person.');
    expect(r.queued).toBe(false);
    expect(await a.search('citations')).toEqual([]);
    const opened = await a.open(problem);
    expect(opened.hidden?.by).toBe(addressOf(secret(7)));
    expect(a.summary(opened.hash, opened.state, opened.tracker, opened.layer, opened.hidden)).toContain('Taken down on');
    expect(a.summary(opened.hash, opened.state, opened.tracker, opened.layer, opened.hidden)).toContain('"The brief names a private person."');
    await expect(a.next(problem)).rejects.toThrow(/taken down|nothing for this key/);
    await m.hide(problem, 'Lifted: the brief was changed.', false);
    expect((await a.search('citations')).map((p) => p.problem)).toEqual([problem]);
    expect((await a.open(problem)).hidden).toBeNull();
  });
});
