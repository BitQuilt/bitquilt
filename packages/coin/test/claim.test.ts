import { describe, expect, it } from 'vitest';
import type { Chain, Head, Hex } from '../src/chain.js';
import { type ClaimDoor, claim } from '../src/claim.js';
import { leaf, root, verify } from '../src/merkle.js';
import { type Redeems, redeemRoot } from '../src/post.js';

/**
 * The holder's claim over a fake home and a fake chain: it finds the line under the last posted head, checks the
 * posted head and root against the home's lines, waits for the head to be final, and calls redeem with a proof that
 * verifies; a line not yet under a posted head, a head still inside its window, a line redeemed already, and a posted
 * root that is not the home's are each refused with the reason, before anything is sent.
 */
const chain: Chain = { rpc: 'http://chain.test', chainId: 1, contracts: { anchors: '0x1111111111111111111111111111111111111111', quilt: '0x2222222222222222222222222222222222222222' } };
const HOLDER = '0x3333333333333333333333333333333333333333';
const OTHER = '0x4444444444444444444444444444444444444444';
const hex = (n: number) => n.toString(16).padStart(64, '0');
const answer: Redeems = { head: { seq: 5, hash: hex(0xaaaa) }, redeems: [{ id: hex(1), seq: 2, root: HOLDER, to: HOLDER, amount: 1_000_000 }, { id: hex(2), seq: 5, root: HOLDER, to: OTHER, amount: 42 }] };
const home = (calls: string[]) => (async (input: string | URL | Request) => { calls.push(String(input)); return Response.json(answer); }) as typeof fetch;

function door(over: Partial<ClaimDoor> & { final?: boolean; redeemed?: boolean; root?: Hex } = {}) {
  const calls: unknown[] = [];
  const d: ClaimDoor & { calls: unknown[] } = {
    calls,
    async lastPosted() { return 5; },
    async headAt(_c: Chain, seq: number): Promise<Head> { return { seq, head: `0x${hex(0xaaaa)}`, root: over.root ?? redeemRoot(answer.redeems), postedAt: 1, poster: HOLDER, vetoed: false, posted: true }; },
    async isFinal() { return over.final ?? true; },
    async isRedeemed() { return over.redeemed ?? false; },
    async redeem(_c: Chain, line) { calls.push(line); return { tx: `0x${hex(7)}` as Hex }; },
    ...over,
  };
  return d;
}

describe('the claim', () => {
  it('mints the line under the last posted head with a proof that verifies', async () => {
    const calls: string[] = [];
    const d = door();
    const r = await claim({ home: 'http://home.test/', chain, id: `0x${hex(2)}`, door: d, fetchImpl: home(calls) });
    expect(r).toEqual({ id: hex(2), seq: 5, to: OTHER, amount: 42, tx: `0x${hex(7)}` });
    expect(calls).toEqual(['http://home.test/coin/redeems?upto=5']);
    const sent = d.calls[0] as { seq: number; id: Hex; to: string; amount: bigint; proof: Hex[] };
    expect(sent).toMatchObject({ seq: 5, id: `0x${hex(2)}`, to: OTHER, amount: 42n });
    const leaves = answer.redeems.map((x) => leaf(`0x${x.id}`, x.to, x.amount));
    expect(verify(root(leaves), leaf(`0x${hex(2)}`, OTHER, 42), sent.proof)).toBe(true);
  });
  it('refuses a line not under the head, a head inside its window, a line redeemed already, and a root that is not the home\'s', async () => {
    await expect(claim({ home: 'http://home.test', chain, id: hex(9), door: door(), fetchImpl: home([]) })).rejects.toThrow(/no redeem line .* under the posted head 5/);
    await expect(claim({ home: 'http://home.test', chain, id: hex(2), door: door({ final: false }), fetchImpl: home([]) })).rejects.toThrow(/not final yet/);
    await expect(claim({ home: 'http://home.test', chain, id: hex(2), door: door({ redeemed: true }), fetchImpl: home([]) })).rejects.toThrow(/redeemed already/);
    await expect(claim({ home: 'http://home.test', chain, id: hex(2), door: door({ root: `0x${hex(0xbeef)}` }), fetchImpl: home([]) })).rejects.toThrow(/not the one the home's lines give/);
    await expect(claim({ home: 'http://home.test', chain, id: 'nope', door: door(), fetchImpl: home([]) })).rejects.toThrow(/64 hex characters/);
    await expect(claim({ home: 'http://home.test', chain, id: hex(2), door: door({ lastPosted: async () => 0 }), fetchImpl: home([]) })).rejects.toThrow(/nothing is posted yet/);
  });
});
