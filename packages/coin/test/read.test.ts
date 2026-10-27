import { describe, expect, it } from 'vitest';
import { type Event, addressOf, eventSignedByKey } from '@bitquilt/core';
import type { Address, Chain, Deposit } from '../src/chain.js';
import { type ReaderDoor, checkCredits, read } from '../src/read.js';

/**
 * The reader over a fake chain and a fake home: it credits each finalized deposit the home has not credited yet, in
 * order, as a credit line signed with the reader's key; a run with nothing new posts nothing; a refusal from the home is
 * reported with its reason and the run goes on; an answer of the wrong shape is refused before anything is signed.
 */
const chain: Chain = { rpc: 'http://chain.test', chainId: 1, contracts: { anchors: '0x1111111111111111111111111111111111111111', quilt: '0x2222222222222222222222222222222222222222' } };
const key = (n: number): Uint8Array => { const k = new Uint8Array(32); k[31] = n; return k; };
const READER = key(5);
const HOLDER: Address = '0x3333333333333333333333333333333333333333';
const OTHER: Address = '0x4444444444444444444444444444444444444444';
const hex = (n: number) => n.toString(16).padStart(64, '0');

function door(deposits: Deposit[]): ReaderDoor {
  return {
    async depositCount(_c, finalized) { expect(finalized).toBe(true); return deposits.length; },
    async depositAt(_c, n) { return deposits[n - 1] ?? { n, from: OTHER, root: OTHER, amount: 0n, at: 0, made: false }; },
  };
}
const dep = (n: number, root: Address, amount: bigint): Deposit => ({ n, from: OTHER, root, amount, at: 1_800_000_000 + n, made: true });

function home(credits: { deposit: number; root: string; amount: number }[], answer: (e: Event) => Response = () => Response.json({ id: 'sha256:' + hex(9) }, { status: 202 })) {
  const posted: Event[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/coin/credits')) return Response.json({ head: { seq: credits.length, hash: hex(7) }, reader: addressOf(READER), credits: credits.map((c, i) => ({ id: hex(i + 1), seq: i + 1, ...c })) });
    if (url.endsWith('/coin/events') && init?.method === 'POST') {
      const e = JSON.parse(String(init.body)) as Event;
      posted.push(e);
      return answer(e);
    }
    return new Response('no', { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, posted };
}

describe('the reader', () => {
  it('credits each finalized deposit not credited yet, in order, signed with its key, and then nothing more', async () => {
    const deposits = [dep(1, HOLDER, 1_000_000n), dep(2, OTHER, 42n), dep(3, HOLDER, 7n)];
    const h = home([{ deposit: 1, root: HOLDER, amount: 1_000_000 }]);
    const report = await read({ home: 'http://home.test/', chain, key: READER, door: door(deposits), fetchImpl: h.fetchImpl, now: () => '2026-10-27T20:00:00.000Z' });
    expect(report).toEqual({ deposits: 3, held: 1, posted: [{ deposit: 2, root: OTHER, amount: 42, id: 'sha256:' + hex(9) }, { deposit: 3, root: HOLDER, amount: 7, id: 'sha256:' + hex(9) }], refused: [] });
    expect(h.posted).toHaveLength(2);
    for (const e of h.posted) {
      expect(e.type).toBe('credit');
      expect(e.key).toBe(addressOf(READER));
      expect(eventSignedByKey(e)).toBe(true);
      expect(e.problem).toBeUndefined();
    }
    expect(h.posted.map((e) => e.body)).toEqual([{ deposit: 2, root: OTHER, amount: 42 }, { deposit: 3, root: HOLDER, amount: 7 }]);
    const quiet = home([{ deposit: 1, root: HOLDER, amount: 1_000_000 }, { deposit: 2, root: OTHER, amount: 42 }, { deposit: 3, root: HOLDER, amount: 7 }]);
    const again = await read({ home: 'http://home.test', chain, key: READER, door: door(deposits), fetchImpl: quiet.fetchImpl });
    expect(again).toEqual({ deposits: 3, held: 3, posted: [], refused: [] });
    expect(quiet.posted).toEqual([]);
  });
  it('reports a credit the home refuses, with the reason, and goes on; and refuses a home that answers in the wrong shape', async () => {
    const deposits = [dep(1, HOLDER, 5n), dep(2, HOLDER, 6n)];
    const h = home([], (e) => ((e.body as { deposit: number }).deposit === 1 ? Response.json({ error: 'the reader alone credits a deposit' }, { status: 400 }) : Response.json({ id: 'sha256:' + hex(8) }, { status: 202 })));
    const report = await read({ home: 'http://home.test', chain, key: READER, door: door(deposits), fetchImpl: h.fetchImpl });
    expect(report.refused).toEqual([{ deposit: 1, why: 'the reader alone credits a deposit' }]);
    expect(report.posted).toEqual([{ deposit: 2, root: HOLDER, amount: 6, id: 'sha256:' + hex(8) }]);
    expect(() => checkCredits({ credits: [{ id: 'x' }] })).toThrow(/credit 1 has no id/);
    expect(() => checkCredits({ credits: 'none' })).toThrow(/not a list/);
    expect(checkCredits({ head: null, reader: null, credits: [] })).toEqual({ head: null, reader: null, credits: [] });
  });
});
