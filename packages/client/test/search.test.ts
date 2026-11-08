import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hash } from '@bitquilt/core';
import type { Pattern, Quilt } from '../src/quilt.js';
import { runTool } from '../src/tools.js';
import { quiltOver, startTracker } from './helpers.js';

/**
 * APP.md, Search, on forks: Quilt's search puts a fork under the problem it forks, the problem first and its forks
 * after it by the work on each, and the groups in the order of their latest reading, a fork's readings counted in its
 * group; a problem alike in name with no `from` between them is a group of its own. The envelope section of
 * PROTOCOL.md points there. quilt_search says that order on the problem's own line, where a fork can have more work
 * than the problem it forks. The tracker's clock moves a millisecond at least between two readings, so their order is
 * the order they were written in.
 */
const APP = readFileSync(new URL('../../../docs/APP.md', import.meta.url), 'utf8');
const PROTOCOL = readFileSync(new URL('../../../docs/PROTOCOL.md', import.meta.url), 'utf8');
let server: Server;
let worker: Quilt, other: Quilt;
let P: Hash, Q: Hash, more: Hash, less: Hash;

const pattern: Pattern = {
  title: 'Does the lighthouse log say what the keeper said?',
  done_when: 'The statement has a verdict agreed by two vendors.',
  slug: 'lighthouse',
  settings: { endgame_at: 1 },
  pieces: {
    statement: {
      verifier: 'agree',
      requires: ['web'],
      brief: 'Does the log say the lamp was lit at dusk? Answer holds or fails.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['verdict'],
        properties: { verdict: { enum: ['holds', 'fails'] } },
      },
      agree: ['verdict'],
    },
  },
};

/** A return on the one piece of a problem, by the key the Quilt holds. */
async function returned(q: Quilt, problem: Hash): Promise<void> {
  const { pick } = await q.next(problem);
  await q.return(problem, pick.piece.hash, { verdict: 'holds' });
}

beforeAll(async () => {
  let last = 0;
  const now = (): string => {
    last = Math.max(Date.now(), last + 1);
    return new Date(last).toISOString();
  };
  const t = await startTracker({ now });
  server = t.server;
  const mk = quiltOver(t.base);
  worker = mk(1);
  other = mk(5, 'openai/gpt-5', 'ChatGPT');
  P = (await mk(9).publish(pattern)).hash;
  const forks = [
    (await mk(2).publish({ ...pattern, title: `${pattern.title} Asked again.`, from: P })).hash,
    (await mk(3).publish({ ...pattern, title: `${pattern.title} Asked a third way.`, from: P })).hash,
  ].sort();
  // The fork with the larger hash has the work, so the hash's order would put the other first.
  [less, more] = forks as [Hash, Hash];
  Q = (await mk(4).publish(pattern)).hash;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('APP.md, Search: forks under the problem they fork', () => {
  it('says what the search does, and PROTOCOL.md points to it', () => {
    expect(APP).toContain(
      "puts the problem first and its forks after it by the work on each. The groups come in the order of their latest reading, a fork's readings counted in its group. Two problems alike in name with no `from` between them are two groups, side by side.",
    );
    expect(PROTOCOL).toContain("Quilt's search shows each fork under the problem it forks (APP.md, Search)");
  });

  it('puts the problem first and its forks by their work, and a group by the latest reading in it', async () => {
    await returned(worker, Q);
    await returned(worker, more);
    const found = await worker.search('lighthouse');
    expect(found.map((f) => [f.problem, f.root, f.from])).toEqual([
      [P, P, null],
      [more, P, P],
      [less, P, P],
      [Q, Q, null],
    ]);
    expect(found.map((f) => f.work?.returned)).toEqual([0, 1, 0, 1]);
    // A later reading on the problem alike in name puts its group first.
    await returned(other, Q);
    expect((await worker.search('lighthouse')).map((f) => f.problem)).toEqual([Q, P, more, less]);
  });

  it("says the order on the problem's line, where a fork has more work than the problem", async () => {
    const text = (await runTool(worker, 'quilt_search', { query: 'lighthouse' })).text;
    const lines = text.split('\n');
    expect(lines.filter((l) => !l.startsWith(' '))).toEqual([Q, P, more, less]);
    const stands = lines[lines.indexOf(P) + 2]!;
    expect(stands).toContain(
      '3 proposals of this problem, this one listed first and its forks after it by the work on each;',
    );
    expect(text).not.toContain('the most work');
  });
});
