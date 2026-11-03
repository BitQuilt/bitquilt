import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type Envelope, type Hash, IDENTITY_LOG } from '@bitquilt/core';
import { FileChains } from '../src/chains.js';
import { tempHome } from './helpers.js';

/**
 * The node's store of chained logs under a home (WORKSHOP.md section 2, one peer): its file names carry no colon, so a
 * Windows file system holds them where a listing finds them (a colon there writes an alternate stream that a read by
 * name finds and no listing shows); a cache written before 3 November 2026, with the colon in every name, is renamed
 * when the store opens, so a home made on a Mac or Linux keeps what it held; and the identity log keeps its own name.
 * On Windows the old names were never files, so that part of the test has nothing to set up there.
 */
const hashOf = (byte: string): Hash => `sha256:${byte.repeat(32)}` as Hash;
const envelopeOf = (title: string): Envelope => ({ problem: { title } } as unknown as Envelope);
const before = process.platform !== 'win32';

describe('the file store', () => {
  it('names every file without a colon, lists what it holds, and renames the old names when it opens', () => {
    const home = tempHome('quilt-chains-');
    const cache = join(home, 'cache');
    for (const d of [cache, join(cache, 'ledger'), join(cache, 'blobs')]) mkdirSync(d, { recursive: true });
    writeFileSync(join(cache, 'identity.jsonl'), `${JSON.stringify({ seq: 1 })}\n`);
    // A cache as a home from before had it: the colon in the envelope's, the chain's and the blob's names.
    const old = hashOf('ab');
    if (before) {
      writeFileSync(join(cache, `${old}.json`), JSON.stringify(envelopeOf('from before')));
      writeFileSync(join(cache, 'ledger', `${old}.jsonl`), `${JSON.stringify({ seq: 1 })}\n`);
      writeFileSync(join(cache, 'blobs', old), 'bytes');
    }
    const chains = new FileChains(home);
    expect(chains.lines(IDENTITY_LOG)).toHaveLength(1);
    if (before) {
      expect(chains.listEnvelopes()).toEqual([{ hash: old, envelope: envelopeOf('from before') }]);
      expect(chains.lines(old)).toHaveLength(1);
      expect(new TextDecoder().decode(chains.getBlob(old)!)).toBe('bytes');
      expect(existsSync(join(cache, `${old}.json`))).toBe(false);
    }
    // What is written now is named the same way, and nothing under the cache carries a colon.
    const fresh = hashOf('cd');
    chains.putEnvelope(fresh, envelopeOf('new'));
    chains.appendLines(fresh, [{ seq: 1 } as never]);
    chains.putBlob(fresh, new TextEncoder().encode('more'));
    expect(chains.envelopeOf(fresh)).toEqual(envelopeOf('new'));
    const held = before ? [old, fresh] : [fresh];
    expect(chains.listEnvelopes().map((e) => e.hash)).toEqual(held);
    for (const d of [cache, join(cache, 'ledger'), join(cache, 'blobs')]) for (const name of readdirSync(d)) expect(name).not.toContain(':');
    expect(readdirSync(cache)).toContain(`sha256-${'cd'.repeat(32)}.json`);
    expect(chains.held()).toMatchObject({ problems: held.length, ledgers: held.length, blobs: held.length });
    // Opening the store again renames nothing and loses nothing.
    expect(new FileChains(home).listEnvelopes().map((e) => e.hash)).toEqual(held);
  });
});
