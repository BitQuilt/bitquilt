// The vectors the iPhone app's wire is held to (apps/ios/Sources/Wire.swift), written by the reference:
//   node node_modules/tsx/dist/cli.mjs apps/ios/Tests/vectors.ts > apps/ios/Tests/vectors.json
// Fixed secrets and fixed times, so the file is the same at every run.
import { canonical } from '../../../packages/core/src/canonical.js';
import { problemHash } from '../../../packages/core/src/envelope.js';
import { eventId, signEvent } from '../../../packages/core/src/events.js';
import { addressOf, personalHash, secretFromHex, signMessage, signObject } from '../../../packages/core/src/keys.js';

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const secrets = [
  '0000000000000000000000000000000000000000000000000000000000000001',
  '4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
  'f8f8a2f43c8376ccb0871305060d7b27b0554d2cc72bccf41b2705608452f315',
];
// Lengths on each side of Keccak's block of 136 bytes, once the prefix of EIP-191 is before them.
const hashed = ['', 'abc', 'quilt:identity', 'a'.repeat(105), 'a'.repeat(106), 'a'.repeat(107), 'a'.repeat(300), 'é and 縫 and 🧵'];
const values: unknown[] = [
  { b: 1, a: [true, false, null], '': 'empty key', A: 'upper before lower' },
  { text: 'a "quote", a \\ backslash, a tab\t, a line\n, a return\r, a bell\u0007, a form feed\f, a backspace\b' },
  { '€': 'euro', '🧵': 'thread sorts by its UTF-16 units', 'ﬁ': 'ligature', z: 'é 縫 🧵  ' },
  { nested: { z: { y: { x: [1, 2, { w: 0 }] } } }, n: -12, big: 9007199254740991 },
];
const root = secretFromHex(secrets[1]!);
const next = secretFromHex(secrets[2]!);
const delegate = signEvent(
  {
    quilt: 1,
    type: 'delegate',
    key: addressOf(root),
    ts: '2026-11-15T20:38:35.828Z',
    body: { to: addressOf(secretFromHex(secrets[0]!)), scope: ['claim', 'commit', 'reveal'], expires: '2036-11-15T20:38:35.828Z' },
  },
  root,
);
const revoke = signEvent(
  { quilt: 1, type: 'revoke', key: addressOf(root), ts: '2026-11-16T08:00:00.000Z', body: { of: addressOf(secretFromHex(secrets[0]!)) } },
  root,
);
// A rotation, signed by the old root in `sig` and by the new in `sig_to` over the same bytes.
const unsignedRotate = { quilt: 1 as const, type: 'rotate', key: addressOf(root), ts: '2026-11-16T09:00:00.000Z', body: { to: addressOf(next) } };
const rotate = { ...signEvent(unsignedRotate, root), sig_to: signObject(unsignedRotate, next) };

// A publish that waits on the root: the envelope without its `sig`, as the on-ramp hands it to be signed, with the
// hash the problem will have, the root's signature over it, and the `version` the root signs beside it.
const draft = {
  quilt: 1 as const,
  problem: {
    title: 'Does the paper say this, in these words?',
    done_when: 'Every sentence has two readings: "agreed", or kept apart.',
    owner: addressOf(root),
    slug: 'paper-sentences',
    prev: null,
    from: null,
    settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 10, budget: 1000, patch_max: 100000 },
    pieces: {
      'sentence/*': {
        verifier: 'agree',
        count: 3,
        data: { row: 'rows' },
        brief: 'Does the paper say this: {row.claim} Quote the words it rests on.',
        schema: { type: 'object', additionalProperties: false, required: ['verdict'], properties: { verdict: { enum: ['supports', 'contradicts'] } } },
        agree: ['verdict'],
      },
      summary: { verifier: 'record:2', brief: 'Say in a sentence what the paper claims.', inputs: ['sentence/*'] },
    },
    data: { rows: 'sha256:4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' },
  },
  hints: { trackers: ['https://tracker.example/'], mirrors: [] },
};
const drafted = { ...draft, sig: signObject(draft, root) };
const hash = problemHash(drafted as never);
const version = signEvent(
  { quilt: 1, type: 'version', problem: hash, key: addressOf(root), ts: '2026-11-16T10:00:00.000Z', body: { slug: draft.problem.slug, hash } },
  root,
);

console.log(
  JSON.stringify(
    {
      keys: secrets.map((s) => ({ secret: s, address: addressOf(secretFromHex(s)) })),
      personal: hashed.map((text) => ({ text, hash: Buffer.from(personalHash(utf8(text))).toString('hex') })),
      canonical: values.map((value) => ({ value, canonical: canonical(value) })),
      messages: ['', 'hello', '{"quilt":1}'].map((text) => ({ text, secret: secrets[1], sig: signMessage(utf8(text), root) })),
      events: [delegate, revoke, rotate].map((e) => ({ event: e, id: eventId(e), signer: secrets[1], second: 'sig_to' in e ? secrets[2] : null })),
      draft: { envelope: canonical(draft), hash, signer: secrets[1], sig: drafted.sig, version },
    },
    null,
    2,
  ),
);
