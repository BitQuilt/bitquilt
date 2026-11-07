/**
 * The descriptions the connector shows a host for its tools, pinned by the SHA-256 of each one's text. A change of
 * their form (a string written as a list of sentences, a description moved to another file) changes no byte a host
 * shows, and fails here if it does. A change of their words updates the digest here on purpose; e2e.test.ts and
 * mcpb.test.ts hold what the words may say.
 */
import { describe, expect, it } from 'vitest';
import { hashText } from '@bitquilt/core';
import { LISTED_TOOLS, mcpPair, quiltOver } from './helpers.js';

/** Each tool's description as a host lists it, by the digest of its text. */
const DESCRIBED: Record<(typeof LISTED_TOOLS)[number], string> = {
  quilt_me: 'sha256:e2f7b6d102e62fed2d8dc87c942d3962ba7e77903fb2d5e59991bd4ac2ee4143',
  quilt_open: 'sha256:62b6d243936f78c00f8da2723f2a7846db0476103ae96b46bd93910da5d80051',
  quilt_search: 'sha256:ee1753ff2f2794534ede6f105947c141518f2a7572a5d03827c7a42edee2a938',
  quilt_window: 'sha256:791e2f77fdbe3ca7705e51b72a07bcc157636c950af391e7db74e57b800befc4',
  quilt_window_io: 'sha256:d4f5c96d218f71b5a4bc28ac26114c429de1b10d10b427f63b65e5b54327e0d9',
  quilt_next: 'sha256:09b6fcc671aa744207e18e5bb9e870c742d9cd53c6a846d70080e9dbf547f901',
  quilt_return: 'sha256:d209a188b17a099045b7459d80083db0b7aeee90f21c8ba19b904a5cd79a00fd',
  quilt_decline: 'sha256:b8c624672a5cf36dea5544f02a67cc8b3f04d2704c9a5c7c3d4f64603e99bb74',
  quilt_read: 'sha256:6a909cb0177b8cb5f49d183a3054428d3b59a1f91ce47e519d77173522185ca5',
  quilt_rank: 'sha256:453fa63348354e58f51b8d50635573a489226acece13ef566ae7326cb3e8f6d4',
  quilt_challenge: 'sha256:761e30ddd0731f6dca94c0e15fbd5742a6876a2519df1bc0ab559bed0903995e',
  quilt_verdict: 'sha256:a8b06fb0f9cb4b64ca7064f0c3171c69555215a66e331b31a04a3635808aecd5',
  quilt_seed: 'sha256:9be84c1ac8570e0e79385926f5badae8d731b585a8fff7aaa40564bb464a9414',
  quilt_publish: 'sha256:4ba9729a21278a87e1b98bd6e182e01ea45ff23fb8f9b0db4711b3ffb3432b09',
  quilt_pay: 'sha256:fa703bfd11233866b95cbbc73ba9cdf2dbf7ac980fcd1b8c6637940f508effed',
  quilt_transfer: 'sha256:2a58c02a5de62fd946007872c89db10f3c1063a5bdb0c62da17da4293b105c5e',
  quilt_redeem: 'sha256:a8394d383ab47e78fd6ff3228399c0aa211cc9ad592c8dc5c61c4d562a305590',
  quilt_reveal_gold: 'sha256:d820a9fdc248a387b42fe6cbd19e6bc5dc01b7ec1f0c310d315dc453eecce2dd',
  quilt_name: 'sha256:1fcd0391a60ac450952a3795a603c502f7529b3f2f00515757adf268e3f31354',
};

describe('the tool descriptions', () => {
  it('are the bytes pinned for each tool, in whatever form the source writes them', async () => {
    const { client, close } = await mcpPair(quiltOver('http://tracker.test/')(1));
    const { tools } = await client.listTools();
    expect(Object.fromEntries(tools.map((t) => [t.name, hashText(t.description ?? '')]))).toEqual(DESCRIBED);
    await close();
  });
});
