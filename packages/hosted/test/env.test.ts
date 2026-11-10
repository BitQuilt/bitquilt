/**
 * What the hosted on-ramp reads from the environment (packages/hosted/src/env.ts), written once for bitquilt-hosted and
 * for bitquilt-node with host: the relays, the members' folder and the authorization server (QX-18) from the on-ramp's
 * names, the tracker's name and the proxies it believes from the tracker's options, a malformed QUILT_WITNESS_RANGES
 * refused naming the fault, and QUILT_READS made public where it is unset or empty (QX-19 section 6). And the two
 * lines both binaries say of the on-ramp once the door listens: the authorization server, and the owners' turn.
 */
import { describe, expect, it } from 'vitest';
import { guardReads, hostedOptionsFromEnv, onrampStartLines } from '../src/env.js';

describe("the on-ramp's environment", () => {
  it('names no relay, no folder and no authorization server where nothing is set', () => {
    expect(hostedOptionsFromEnv({}, { url: 'http://t.test/' })).toEqual({ relays: [] });
  });

  it("reads the on-ramp's names, and takes the tracker's name and its proxies from the tracker's options", () => {
    const env = {
      QUILT_RELAYS: ' wss://relay.test/one , ,wss://relay.test/two',
      QUILT_HOSTED_HOME: '/data/hosted',
      QUILT_OAUTH_SECRET: 'oauth-secret',
      QUILT_OAUTH_ISSUER: 'https://t.test',
      QUILT_WITNESS_RANGES: '{"claude.ai":["160.79.104.0/21"],"chatgpt.com":[]}',
    };
    expect(
      hostedOptionsFromEnv(env, { url: 'https://t.test/', name: 'Test tracker', trustedProxies: ['10.0.0.0/8'] }),
    ).toEqual({
      relays: ['wss://relay.test/one', 'wss://relay.test/two'],
      home: '/data/hosted',
      name: 'Test tracker',
      oauth: {
        secret: 'oauth-secret',
        issuer: 'https://t.test',
        ranges: { 'claude.ai': ['160.79.104.0/21'], 'chatgpt.com': [] },
      },
      trustedProxies: ['10.0.0.0/8'],
    });
  });

  it('reads the issuer and the ranges only beside a token key, and an empty folder as none', () => {
    const env = { QUILT_OAUTH_ISSUER: 'https://t.test', QUILT_WITNESS_RANGES: '{}', QUILT_HOSTED_HOME: '' };
    expect(hostedOptionsFromEnv(env, { url: 'http://t.test/' })).toEqual({ relays: [] });
  });

  it('refuses ranges that are not one JSON object of product to a list of ranges, naming the fault', () => {
    const read = (ranges: string) => () => hostedOptionsFromEnv({ QUILT_WITNESS_RANGES: ranges }, { url: 'x' });
    expect(read('["160.79.104.0/21"]')).toThrow('QUILT_WITNESS_RANGES is a JSON object of product to ranges');
    expect(read('{"claude.ai":"160.79.104.0/21"}')).toThrow('QUILT_WITNESS_RANGES: claude.ai is a list of ranges');
    expect(read('{"claude.ai":[21]}')).toThrow('QUILT_WITNESS_RANGES: claude.ai is a list of ranges');
    expect(read('not json')).toThrow(SyntaxError);
  });

  it('makes QUILT_READS public where it is unset or empty, and leaves a value that is set', () => {
    const unset: NodeJS.ProcessEnv = {};
    const empty: NodeJS.ProcessEnv = { QUILT_READS: '' };
    const set: NodeJS.ProcessEnv = { QUILT_READS: 'any' };
    for (const env of [unset, empty, set]) guardReads(env);
    expect([unset.QUILT_READS, empty.QUILT_READS, set.QUILT_READS]).toEqual(['public', 'public', 'any']);
  });

  it("says whether the authorization server is on and what the owners' turn does with the vendor keys there are", () => {
    const url = 'https://t.test/';
    expect(onrampStartLines(url, { relays: [] }, {})).toEqual([
      'QUILT_OAUTH_SECRET is unset: no OAuth, and an address is its own credential',
      "the owners' turn runs every hour: the gold due revealed and the proposed pieces taken; no vendor key is set, so no brief is sharpened",
    ]);
    expect(onrampStartLines(url, { relays: [], oauth: { secret: 's' } }, { OPENAI_API_KEY: 'k' })).toEqual([
      'the authorization server is on: products connect at https://t.test/mcp and the events say which (QX-18)',
      "the owners' turn runs every hour: the gold due revealed, the briefs sharpened and the proposed pieces taken for the keys held here",
    ]);
  });
});
