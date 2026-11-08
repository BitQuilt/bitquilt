/**
 * NODE.md section 6, the names: `names/<owner>/<slug>` holds the latest version hash from the owner's own version
 * events, and is written only for a slug by the envelope's rule, "problem.slug: lower-case letters, digits and hyphens,
 * at most 64" (`isSlug` in the core's envelope.ts). A tracker holds a version whose slug is not one, written to its
 * store directly, as a tracker serves one it took before its door refused it. CORE.md section 4 gives a version
 * `{ slug, hash }` and no form for the slug, and the core's shape (`eventProblems` in the core's events.ts) asks only
 * that it is a string, so a core client folds it. The slugs climb out of the names, over a problem's ledger, the coin's
 * balances or out of the folder, name a folder, or break the rule some other way. The mirror holds the event on its
 * chain, which verifies, writes nothing for it anywhere, refuses nothing for it, so a run exits 0, and still writes the
 * owner's good name beside it. The section's sentences on the names are held to that, and the rule's words to the
 * envelope's check.
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  type Envelope,
  type Hash,
  type Receipt,
  type Unsigned,
  SLUG_RULE,
  envelopeProblems,
  eventId,
  problemHash,
  signEvent,
  signObject,
  verifyChain,
} from '@bitquilt/core';
import { Store, createTracker } from '@bitquilt/tracker';
import { mirror } from '../src/mirror.js';
import { VERDICT, addr, key } from './helpers.js';

const NODE = readFileSync(new URL('../../../docs/NODE.md', import.meta.url), 'utf8');
const owner = key(9);

const problem: Envelope['problem'] = {
  title: 'Names',
  done_when: 'Done.',
  owner: addr(owner),
  slug: 'names',
  prev: null,
  from: null,
  settings: { challenge_window_h: 1, lease_h: 2, endgame_at: 1, budget: 10, patch_max: 0 },
  pieces: { statement: { verifier: 'agree', brief: 'Does the page say so?', schema: VERDICT, agree: ['verdict'] } },
  data: {},
};
const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
const env: Envelope = { ...unsigned, sig: signObject(unsigned, owner) };
const P = problemHash(env);
/** What a version that is not a slug names: a hash no file here holds, so a file that holds it was written for it. */
const ELSEWHERE = `sha256:${'b'.repeat(64)}` as Hash;

let tick = Date.parse('2026-11-08T09:00:00Z');
const now = () => new Date(tick).toISOString();
function version(slug: string, hash: Hash) {
  tick += 1000;
  const u: Unsigned = { quilt: 1, type: 'version', key: addr(owner), ts: now(), body: { slug, hash }, problem: P };
  return signEvent(u, owner);
}

/** Every file under a folder, by its path from there. */
function files(dir: string, under = ''): string[] {
  return readdirSync(join(dir, under)).flatMap((name) => {
    const path = join(under, name);
    return statSync(join(dir, path)).isDirectory() ? files(dir, path) : [path];
  });
}

/**
 * A tracker holding the problem, the owner's version under its own slug taken at the door, and a version whose slug is
 * not one written to its store directly, as a tracker that held it before its door refused it would serve it.
 */
async function holding(slug: string): Promise<{ server: Server; base: string; bad: Hash }> {
  const store = new Store(':memory:');
  const t = createTracker({ store, url: 'http://t.test/', now, ipSalt: 's' });
  const server = await t.listen(0);
  const a = server.address();
  const base = typeof a === 'object' && a ? `http://127.0.0.1:${a.port}/` : '';
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  expect((await post('p', { envelope: env, blobs: {} })).status).toBe(201);
  expect((await post(`p/${P}/events`, version('names', P))).status).toBe(202);
  const bad = version(slug, ELSEWHERE);
  store.appendReceipt(P, bad, eventId(bad), 'http://t.test/', now(), 'self');
  return { server, base, bad: eventId(bad) };
}

describe('the names a mirror writes (NODE.md section 6)', () => {
  it.each([
    '..',
    'a/b',
    '../../x',
    `../../ledger/${P}.jsonl`,
    '../../coin/balances.json',
    '../../../outside',
    'Door',
    '',
    'a'.repeat(65),
  ])(
    'holds a version whose slug is %j and writes nothing for it, refuses nothing, and writes the good name',
    async (slug) => {
      const { server, base, bad } = await holding(slug);
      try {
        const root = mkdtempSync(join(tmpdir(), 'bitquilt-names-'));
        const out = join(root, 'mirror');
        const report = await mirror({ trackers: [base], out, now });
        expect(report.refused).toEqual([]);
        expect(report.errors).toEqual([]);
        // The event is held on the mirror's chain, which verifies, as a core client holds it.
        const ledger = join('mirror', 'ledger', `${P}.jsonl`);
        const lines = readFileSync(join(root, ledger), 'utf8')
          .trim()
          .split('\n')
          .map((l) => JSON.parse(l) as Receipt);
        expect(verifyChain(lines, P).ok).toBe(true);
        expect(lines.map((l) => eventId(l.event))).toContain(bad);
        // The owner's names are the good one alone; nothing is written beside the mirror's folder, and no file in it
        // but the chain that holds the event names the hash the bad version set.
        expect(readdirSync(join(out, 'names'))).toEqual([addr(owner)]);
        expect(readdirSync(join(out, 'names', addr(owner)))).toEqual(['names']);
        expect(readFileSync(join(out, 'names', addr(owner), 'names'), 'utf8')).toBe(`${P}\n`);
        expect(readdirSync(root)).toEqual(['mirror']);
        for (const f of files(root).filter((f) => f !== ledger))
          expect(readFileSync(join(root, f), 'utf8'), f).not.toContain(ELSEWHERE);
        expect(existsSync(join(out, 'coin'))).toBe(false);
      } finally {
        await new Promise<void>((r) => server.close(() => r()));
      }
    },
  );

  it('says in NODE.md section 6 which versions name a file, and that the rest are held, passed over and refuse nothing', () => {
    const section = NODE.slice(NODE.indexOf('## 6. The mirror job'), NODE.indexOf('## 7. The programs'));
    expect(section).toContain(
      "names/<owner>/<slug>             the latest version hash, from the owner's own version events whose slug is a slug",
    );
    expect(section).toContain(
      "**The names.** A name is written only for a version whose `slug` is a slug by the rule the envelope's check holds a problem's slug to, lower-case letters, digits and hyphens, at most 64 (`isSlug` in `packages/core/src/envelope.ts`), so its file is `names/<owner>/<slug>` and nowhere else.",
    );
    expect(section).toContain(
      "The mirror holds such a version on its chain and passes it over: no file is written for it, and it is no refusal. CORE.md section 4 gives a version `{ slug, hash }` and no form for the slug, and the core's shape (`eventProblems` in `packages/core/src/events.ts`) asks only that it is a string, so a core client holds it, and a refusal would stop `main` growing on every run.",
    );
    // The rule's words are the envelope's check's own, and the door's refusal of such a version says them.
    expect(envelopeProblems({ ...env, problem: { ...env.problem, slug: '../x' } })).toEqual([
      'problem.slug: lower-case letters, digits and hyphens, at most 64',
    ]);
    expect(SLUG_RULE).toBe('lower-case letters, digits and hyphens, at most 64');
  });
});
