import { describe, expect, it } from 'vitest';
import type { Chain, Hex } from '../src/chain.js';
import { leaf, root } from '../src/merkle.js';
import { type Door, type Redeems, checkRedeems, post, redeemRoot } from '../src/post.js';

/**
 * The poster over a fake home and a fake chain: it posts the head and the root over the redeem lines once, reports
 * posted=false on the same head, and posts again when the home's head is newer; `upto` reaches the home; an answer
 * of the wrong shape is refused before anything is read from the chain.
 */
const chain: Chain = { rpc: 'http://chain.test', chainId: 1, contracts: { anchors: '0x1111111111111111111111111111111111111111', quilt: '0x2222222222222222222222222222222222222222' } };
const HOLDER = '0x3333333333333333333333333333333333333333';
const hex = (n: number) => n.toString(16).padStart(64, '0');
const line = (n: number, seq: number, amount: number, to = HOLDER) => ({ id: hex(n), seq, root: HOLDER, to, amount });

function home(answer: () => Redeems | number, calls: string[]): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(String(input));
    const a = answer();
    if (typeof a === 'number') return new Response('no', { status: a });
    return Response.json(a);
  }) as typeof fetch;
}

function door(): Door & { last: number; posts: { seq: number; head: Hex; root: Hex }[] } {
  const d = {
    last: 0,
    posts: [] as { seq: number; head: Hex; root: Hex }[],
    async lastPosted(c: Chain) {
      expect(c).toBe(chain);
      return d.last;
    },
    async postHead(c: Chain, p: { seq: number; head: Hex; root: Hex }) {
      expect(c).toBe(chain);
      d.posts.push(p);
      d.last = Math.max(d.last, p.seq);
      return { tx: `0x${hex(d.posts.length)}` as Hex };
    },
  };
  return d;
}

describe('the poster', () => {
  it('posts a new head once, keeps it on the next run, and posts again on a newer one', async () => {
    const calls: string[] = [];
    let answer: Redeems = { head: { seq: 5, hash: hex(0xaaaa) }, redeems: [line(1, 2, 1_000_000), line(2, 5, 42, '0x4444444444444444444444444444444444444444')] };
    const fetchImpl = home(() => answer, calls);
    const d = door();
    const first = await post({ home: 'http://home.test/', chain, door: d, fetchImpl });
    const expectedRoot = root(answer.redeems.map((r) => leaf(`0x${r.id}`, r.to, r.amount)));
    expect(first).toEqual({ seq: 5, head: hex(0xaaaa), root: expectedRoot, posted: true, redeems: 2, tx: `0x${hex(1)}` });
    expect(d.posts).toEqual([{ seq: 5, head: `0x${hex(0xaaaa)}`, root: expectedRoot }]);
    expect(calls).toEqual(['http://home.test/coin/redeems']);

    const again = await post({ home: 'http://home.test', chain, door: d, fetchImpl });
    expect(again).toEqual({ seq: 5, head: hex(0xaaaa), root: expectedRoot, posted: false, redeems: 2 });
    expect(d.posts).toHaveLength(1);

    answer = { head: { seq: 7, hash: hex(0xbbbb) }, redeems: [...answer.redeems, line(3, 7, 9)] };
    const third = await post({ home: 'http://home.test', chain, door: d, fetchImpl, upto: 7 });
    expect(third.posted).toBe(true);
    expect(third.seq).toBe(7);
    expect(third.redeems).toBe(3);
    expect(third.root).toBe(redeemRoot(answer.redeems));
    expect(third.root).not.toBe(expectedRoot);
    expect(d.posts).toHaveLength(2);
    expect(d.posts[1]).toEqual({ seq: 7, head: `0x${hex(0xbbbb)}`, root: third.root });
    expect(calls[2]).toBe('http://home.test/coin/redeems?upto=7');

    const behind = await post({ home: 'http://home.test', chain, door: { ...d, lastPosted: async () => 9 }, fetchImpl });
    expect(behind.posted).toBe(false);
    expect(d.posts).toHaveLength(2);
  });
  it('posts nothing for a head of sequence zero, and the root of no redeems is zero', async () => {
    const d = door();
    const r = await post({ home: 'http://home.test', chain, door: d, fetchImpl: home(() => ({ head: { seq: 0, hash: hex(0) }, redeems: [] }), []) });
    expect(r).toEqual({ seq: 0, head: hex(0), root: `0x${hex(0)}`, posted: false, redeems: 0 });
    expect(d.posts).toEqual([]);
  });
  it('refuses a home that is down or answers in the wrong shape, before touching the chain', async () => {
    const d = door();
    await expect(post({ home: 'http://home.test', chain, door: d, fetchImpl: home(() => 503, []) })).rejects.toThrow(/answered 503/);
    const bad = (answer: unknown) => post({ home: 'http://home.test', chain, door: d, fetchImpl: home(() => answer as Redeems, []) });
    await expect(bad({ redeems: [] })).rejects.toThrow(/whole sequence/);
    await expect(bad({ head: { seq: 1, hash: hex(0xabc).toUpperCase() }, redeems: [] })).rejects.toThrow(/64 lowercase hex/);
    await expect(bad({ head: { seq: 1, hash: hex(1) } })).rejects.toThrow(/not a list/);
    await expect(bad({ head: { seq: 1, hash: hex(1) }, redeems: [line(1, 2, 5)] })).rejects.toThrow(/redeem 1 has no sequence at or before the head/);
    await expect(bad({ head: { seq: 3, hash: hex(1) }, redeems: [{ ...line(1, 2, 5), to: 'nobody' }] })).rejects.toThrow(/address to mint to/);
    await expect(bad({ head: { seq: 3, hash: hex(1) }, redeems: [line(1, 2, 1.5)] })).rejects.toThrow(/whole amount/);
    await expect(bad({ head: { seq: 3, hash: hex(1) }, redeems: [line(1, 2, 5), line(1, 3, 6)] })).rejects.toThrow(/one id/);
    expect(d.posts).toEqual([]);
    expect(checkRedeems({ head: { seq: 3, hash: hex(1) }, redeems: [line(1, 2, 5)] })).toEqual({ head: { seq: 3, hash: hex(1) }, redeems: [line(1, 2, 5)] });
  });
});
