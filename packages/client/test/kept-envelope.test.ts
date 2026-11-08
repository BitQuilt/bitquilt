/**
 * What the resolver keeps of a problem it reads (CORE.md section 6, Envelopes: "Each is checked against its hash and
 * its owner's signature; each blob against its hash"): an envelope is kept only once its owner's signature checks and
 * every data blob it names is held, the blobs kept first, since a node with `work` beside `admit` keeps in the door's
 * store and the door's layer folds every problem there (NODE.md section 2). An envelope whose blob no place serves,
 * or that its owner did not sign, is read and not kept.
 */
import { describe, expect, it } from 'vitest';
import { type Envelope, type Hash, addressOf, hashBytes, problemHash, signObject } from '@bitquilt/core';
import { DEFAULT_CONFIG } from '../src/config.js';
import { FileChains } from '../src/chains.js';
import { Resolver } from '../src/resolver.js';
import { tempHome } from './helpers.js';

const T = 'http://t.test/';
const secret = (n: number): Uint8Array => {
  const k = new Uint8Array(32);
  k[31] = n;
  return k;
};
const owner = secret(9);
const claims = new TextEncoder().encode(JSON.stringify([{ text: 'The coin is a chain of signatures.' }]));
const claimsHash = hashBytes(claims);

/** An envelope naming the claims blob, signed by `signer`, which is its owner unless a test says otherwise. */
function envelope(slug: string, signer = owner): Envelope {
  const problem = {
    title: 'Does the paper say so?',
    done_when: 'Every statement has a verdict.',
    owner: addressOf(owner),
    slug,
    prev: null,
    from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 1, budget: 100, patch_max: 10000 },
    pieces: {
      'statement/*': {
        count: 1,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Statement {n}: {claim.text} Does the paper say so?',
        schema: {
          type: 'object',
          additionalProperties: false,
          required: ['verdict'],
          properties: { verdict: { enum: ['supports', 'contradicts'] } },
        },
        agree: ['verdict'],
        data: { claim: 'claims' },
      },
    },
    data: { claims: claimsHash },
  };
  const unsigned = { quilt: 1 as const, problem, hints: { trackers: [], mirrors: [] } };
  return { ...unsigned, sig: signObject(unsigned, signer) } as unknown as Envelope;
}

/** A tracker at T serving one envelope, and its blob only where `blob` is true; every other path is 404. */
function serving(e: Envelope, blob: boolean): typeof fetch {
  const hash = problemHash(e);
  return (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${T}p/${hash}`) return new Response(JSON.stringify(e));
    if (blob && url === `${T}b/${claimsHash}`) return new Response(claims);
    return new Response('', { status: 404 });
  }) as typeof fetch;
}

/** A resolver over its own file store, with every write to the store recorded in order. */
function over(fetchImpl: typeof fetch): { resolver: Resolver; chains: FileChains; writes: string[] } {
  const home = tempHome('quilt-kept-envelope-');
  const chains = new FileChains(home);
  const writes: string[] = [];
  const { putBlob, putEnvelope } = chains;
  chains.putBlob = (h, bytes) => {
    writes.push(`blob ${h}`);
    putBlob.call(chains, h, bytes);
  };
  chains.putEnvelope = (h, e, at) => {
    writes.push(`envelope ${h}`);
    putEnvelope.call(chains, h, e, at);
  };
  const config = { ...DEFAULT_CONFIG, trackers: [], relays: [] };
  return { resolver: new Resolver(config, home, fetchImpl, null, chains), chains, writes };
}

const linkTo = (hash: Hash) => ({ hash, trackers: [T], mirrors: [] });

describe('the envelope the resolver keeps', () => {
  it('is not kept where no place serves the data blob it names', async () => {
    const e = envelope('no-blob');
    const hash = problemHash(e);
    const { resolver, chains, writes } = over(serving(e, false));
    await expect(resolver.resolve(linkTo(hash))).rejects.toThrow(`blob claims: ${claimsHash} not present`);
    expect(chains.envelopeOf(hash)).toBeNull();
    expect(writes).toEqual([]);
  });

  it('is kept once the blob is served, the blob before the envelope', async () => {
    const e = envelope('with-blob');
    const hash = problemHash(e);
    const { resolver, chains, writes } = over(serving(e, true));
    const resolved = await resolver.resolve(linkTo(hash));
    expect(resolved?.envelopes).toEqual([e]);
    expect(chains.envelopeOf(hash)).toEqual(e);
    expect(writes).toEqual([`blob ${claimsHash}`, `envelope ${hash}`]);
  });

  it('is not kept where its owner did not sign it, though its blob is served', async () => {
    const e = envelope('not-signed', secret(1));
    const hash = problemHash(e);
    const { resolver, chains } = over(serving(e, true));
    await resolver.resolve(linkTo(hash));
    expect(chains.envelopeOf(hash)).toBeNull();
  });
});
