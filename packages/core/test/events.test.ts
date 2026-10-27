/**
 * CORE.md section 4, the event line: its id without the signature fields, the signature by its key, the shape of each
 * core body, the commit's hash and a rotate's second signer. Beside them, the chained lines of QX-11 and the stamp of
 * QX-7, which section 11 names and the reducer ignores.
 */
import { describe, expect, it } from 'vitest';
import { commitHash, eventId, eventProblems, eventSignedByKey, newNonce, rotateSecondSigner, signEvent, vendorOf, type Unsigned } from '../src/events.js';
import { addressOf, randomSecretKey } from '../src/keys.js';
import { chainLines, nextLine, onlyAppends, verifyChain } from '../src/chain.js';
import { leadingZeroBits, stamp, stampOk } from '../src/stamp.js';
import { type Hash, hashText } from '../src/hash.js';
import { byOf } from './helpers.js';

const secret = randomSecretKey();
const me = addressOf(secret);
const problem = hashText('problem');
const piece = hashText('piece');
const by = byOf('anthropic/claude-fable-5-1', ['web']);

function claim(ts = '2026-10-24T18:00:00Z'): Unsigned {
  return { quilt: 1, type: 'claim', problem, piece, key: me, ts, body: { by } };
}

describe('events', () => {
  it('has an id that ignores the signature and a signature by its key', () => {
    const e = signEvent(claim(), secret);
    expect(eventProblems(e)).toEqual([]);
    expect(eventId(e)).toBe(eventId(claim()));
    expect(eventSignedByKey(e)).toBe(true);
    expect(eventSignedByKey({ ...e, ts: '2026-10-24T18:00:01Z' })).toBe(false);
  });
  it('names what is wrong with a malformed event', () => {
    expect(eventProblems({ ...signEvent(claim(), secret), key: me.toLowerCase() })).toContain('event.key: an address with its checksum');
    expect(eventProblems(signEvent({ ...claim(), body: { by: { model: 'x', client: 'c', can: ['fly'] } } }, secret))).toContain('body.by.can: from web, files, shell, person');
    expect(eventProblems(signEvent({ quilt: 1, type: 'decline', problem, piece, key: me, ts: '2026-10-24T18:00:00Z', body: { reason: 'bored' } }, secret))[0]).toMatch(/body.reason: one of/);
    expect(eventProblems(signEvent({ quilt: 1, type: 'commit', key: me, ts: '2026-10-24T18:00:00Z', body: { h: 'nope' } }, secret))).toEqual(expect.arrayContaining(['event: a commit names a problem and a piece', 'body.h: a hash']));
    expect(eventProblems(signEvent({ quilt: 1, type: 'announce', problem, key: me, ts: '2026-10-24T18:00:00Z', body: { anything: 1 } }, secret))).toEqual([]);
  });
  it('computes a commit hash over the canonical return and the nonce, and recovers a rotate\'s second signer', () => {
    const nonce = newNonce();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(commitHash({ b: 1, a: 'x' }, nonce)).toBe(commitHash({ a: 'x', b: 1 }, nonce));
    expect(commitHash({ a: 'x' }, nonce)).not.toBe(commitHash({ a: 'x' }, newNonce()));
    const other = randomSecretKey();
    const unsigned: Unsigned = { quilt: 1, type: 'rotate', key: me, ts: '2026-10-24T18:00:00Z', body: { to: addressOf(other) } };
    const withTo = { ...unsigned, sig_to: signEvent(unsigned, other).sig };
    const rotate = signEvent(withTo, secret);
    expect(rotateSecondSigner(rotate)).toBe(addressOf(other));
    expect(eventSignedByKey(rotate)).toBe(true);
    expect(vendorOf('anthropic/claude-fable-5-1')).toBe('anthropic');
    expect(vendorOf('human')).toBe('human');
  });
});

describe('chained lines', () => {
  const receipts = [0, 1, 2].map((i) => ({ event: signEvent(claim(`2026-10-24T18:00:0${i}Z`), secret), received: [{ by: 'https://t.example/', at: `2026-10-24T18:00:0${i}Z` }] }));
  it('chains from the problem and verifies', () => {
    const lines = chainLines(receipts, problem);
    expect(lines.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(lines[0]!.prev).toBe(problem.slice('sha256:'.length));
    expect(lines[1]!.prev).toBe(lines[0]!.hash);
    const check = verifyChain(lines, problem);
    expect(check.ok).toBe(true);
    expect(check.head?.seq).toBe(3);
    expect(check.head?.short).toMatch(/^[0-9a-f]{8}:[0-9a-f]{8}$/);
    const more = [...lines, nextLine(lines, problem, receipts[0]!)];
    expect(verifyChain(more, problem).ok).toBe(true);
    expect(onlyAppends(lines, more)).toEqual({ ok: true, added: 1 });
  });
  it('catches a changed, reordered or removed line', () => {
    const lines = chainLines(receipts, problem);
    const tampered = lines.map((l, i) => (i === 1 ? { ...l, received: [{ by: 'https://t.example/', at: '2026-10-24T19:00:00Z' }] } : l));
    expect(verifyChain(tampered, problem).problems[0]).toMatch(/line 2: hash is not its own/);
    expect(verifyChain([lines[1]!, lines[0]!, lines[2]!], problem).ok).toBe(false);
    expect(onlyAppends(lines, lines.slice(0, 2)).problem).toBe('1 removed');
    const rewritten = chainLines([receipts[0]!, receipts[2]!, receipts[1]!], problem);
    expect(verifyChain(rewritten, problem).ok).toBe(true);
    expect(onlyAppends(lines, rewritten).problem).toBe('line 2 changed');
  });
});

describe('the stamp', () => {
  it('counts leading zero bits and mines a nonce', () => {
    expect(leadingZeroBits(('sha256:' + '0'.repeat(64)) as Hash)).toBe(256);
    expect(leadingZeroBits(('sha256:1' + '0'.repeat(63)) as Hash)).toBe(3);
    expect(leadingZeroBits(('sha256:f' + '0'.repeat(63)) as Hash)).toBe(0);
    const e = claim();
    expect(stampOk(e, 0)).toBe(true);
    expect(stampOk(e, 1)).toBe(false);
    const stamped = stamp(e, 10);
    expect(stamped).not.toBeNull();
    expect(stampOk(stamped!, 10)).toBe(true);
    expect(stamped!.nonce).toMatch(/^[0-9a-f]{32}$/);
  });
});
