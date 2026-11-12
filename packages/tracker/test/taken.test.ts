import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Envelope, type Hash, eventId } from '@bitquilt/core';
import { VERDICT, boot, envelope, key } from './helpers.js';

/**
 * A take read along the chain and the proposals a reader passes over, through a booted tracker, read by reading 2
 * (docs/v2/READING.md section 3). docs/ext/QX-22.md section 3 reads a take along `prev` from the version read, so a
 * read at a version made beside the one a proposal names says null, though a version on the other branch holds the
 * piece. docs/ext/QX-22.md section 1 holds a proposal's brief and its reason to the plain-text gate and asks a reason
 * that says something, and a reader holds the same, so a proposal that fails one stands nowhere. This tracker's door
 * refuses such a proposal, so each here is written into the store past the door, as a line pulled from a door that
 * asked less would be. The ledger this file leaves holds:
 * - a line with two branches from its first version, one of one version and one of two;
 * - a proposal under the first version, taken on the first branch and on neither version of the second;
 * - a proposal under the first branch's version, whose piece the second branch's last version holds, taken nowhere;
 * - three proposals a reader passes over: a brief with a link, a reason with a handle to write to, and a reason of
 *   spaces alone.
 */
const owner = key(9),
  X = key(1),
  Y = key(2),
  Z = key(3);
const agree = { verifier: 'agree', requires: ['web' as const], schema: VERDICT, agree: ['verdict'] };
const one = { ...agree, brief: 'Is the first claim in the paper?' };
const three = { ...agree, brief: 'Is the third claim in the paper?' };
const extra = { ...agree, brief: 'Is there a claim the pattern left out?' };
const late = { ...agree, brief: 'Does the paper say when the trial ended?' };

const t = boot('2026-11-11T23:30:00.000Z', { limits: { keyPerHour: 1000, ipPerHour: 10000 } });
const { ev, post, get, accepted, refused } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

type Row = { id: Hash; under: Hash; name: string; taken: Hash | null };
const listed = async (problem: Hash) => (await get<{ proposals: Row[] }>(`/p/${problem}/proposals`)).proposals;

describe('a take read along the chain, and the proposals a reader passes over (QX-22 sections 1 and 3)', () => {
  let P1: Hash, P2a: Hash, P2b: Hash, P3b: Hash;
  let first: Hash, second: Hash;
  const publish = async (e: Envelope): Promise<Hash> => {
    const r = await post('/p', { envelope: e });
    expect(r.status, await r.clone().text()).toBe(201);
    return ((await r.json()) as { hash: Hash }).hash;
  };
  const taken = async (problem: Hash) => (await listed(problem)).map((p) => [p.id, p.taken]);

  beforeAll(async () => {
    P1 = await publish(envelope(owner, 'taken', { one }));
    first = await accepted(
      `/p/${P1}/events`,
      ev(X, 'propose', { name: 'extra', piece: extra, why: 'The pattern asks nothing of the claim it left out.' }, P1),
    );
    P2a = await publish(envelope(owner, 'taken', { one, extra }, { prev: P1 }));
    P2b = await publish(envelope(owner, 'taken', { one, three }, { prev: P1 }));
    second = await accepted(
      `/p/${P2a}/events`,
      ev(
        Y,
        'propose',
        { name: 'late', piece: late, why: 'The paper gives two dates and the pattern asks neither.' },
        P2a,
      ),
    );
    P3b = await publish(envelope(owner, 'taken', { one, three, late }, { prev: P2b }));
  });

  it('says the version that took a piece where the chain read holds it, and null at the version named', async () => {
    expect(await taken(P1)).toEqual([
      [first, null],
      [second, null],
    ]);
    expect(await taken(P2a)).toEqual([
      [first, P2a],
      [second, null],
    ]);
  });

  it('says null on the other branch, though a version there holds the piece', async () => {
    expect(await taken(P2b)).toEqual([
      [first, null],
      [second, null],
    ]);
    expect(await taken(P3b)).toEqual([
      [first, null],
      [second, null],
    ]);
  });

  it('passes over a proposal whose brief or reason the gate refuses, and one whose reason says nothing', async () => {
    const why = 'The pattern leaves this out.';
    const over: [Uint8Array, Record<string, unknown>, string][] = [
      [
        X,
        { name: 'linked', piece: { ...agree, brief: 'Read https://example.org/paper and say what it claims.' }, why },
        'body.piece.brief: no links or markup',
      ],
      [
        Y,
        {
          name: 'mailed',
          piece: { ...agree, brief: 'Is the fourth claim in the paper?' },
          why: 'Ask @reader_two for the rest.',
        },
        'body.why: no contact details',
      ],
      [
        Z,
        { name: 'blank', piece: { ...agree, brief: 'Is the fifth claim in the paper?' }, why: '   ' },
        'body.why: text of at most 500 characters',
      ],
    ];
    for (const [k, body, reason] of over) {
      const event = ev(k, 'propose', body, P1);
      expect(await refused(`/p/${P1}/events`, event)).toBe(reason);
      t.store.appendReceipt(P1, event, eventId(event), 'http://tracker.test/', event.ts, 'self');
    }
    for (const version of [P1, P2a, P3b]) expect((await listed(version)).map((p) => p.id)).toEqual([first, second]);
  });
});
