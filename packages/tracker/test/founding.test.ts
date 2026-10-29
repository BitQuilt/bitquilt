import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Hash, commitHash, newNonce, problemHash } from '@bitquilt/core';
import { foundingFromEnv, trackerOptionsFromEnv } from '../src/env.js';
import { addr, boot, envelope as signed, key } from './helpers.js';

/**
 * The founding standing (QX-1 section 2, amended 29 October 2026): a tracker may declare an amount per root, published
 * at its well-known document and counted into that root's standing from the ledger's beginning. It covers a gold stake
 * the same owner could not cover on a tracker that declares none, and is locked behind the gold like any standing; a
 * root not named gets nothing; the environment's `<address>=<amount>` list is read and a malformed pair refused.
 */
const owner = key(9), other = key(3);
const schema = { type: 'object' as const, additionalProperties: false as const, required: ['verdict', 'quote'], properties: { verdict: { enum: ['supports', 'contradicts'] }, quote: { type: 'string' as const, maxLength: 160 } } };
const P = signed(owner, 'founded', { 'statement/*': { count: 3, verifier: 'agree', requires: ['web'], brief: 'Statement {n}: does the paper say so?', schema, agree: ['verdict'] } });
const p = problemHash(P);

const founded = boot('2026-10-29T12:00:00Z', { founding: { [addr(owner)]: 10 } });
const plain = boot('2026-10-29T12:00:00Z');
beforeAll(async () => { await founded.listen(); await plain.listen(); });
afterAll(async () => { await founded.close(); await plain.close(); });

type Standing = { standing: number; locked: number; free: number; founding: number };
const commitmentsFor = (pieces: Hash[]) => pieces.map((piece) => commitHash({ piece, projection: { verdict: 'supports' } }, newNonce())).sort();

describe('a founding standing', () => {
  it('is published at the well-known document and counted into that root\'s standing from the beginning, and into nobody else\'s', async () => {
    expect((await founded.get<{ founding: Record<string, number> }>('/.well-known/quilt')).founding).toEqual({ [addr(owner)]: 10 });
    expect(await founded.get<Standing>(`/k/${addr(owner)}/standing`)).toMatchObject({ standing: 11, locked: 0, free: 11, founding: 10 });
    expect(await founded.get<Standing>(`/k/${addr(other)}/standing`)).toMatchObject({ standing: 1, locked: 0, free: 1, founding: 0 });
    expect((await plain.get<{ founding: Record<string, number> }>('/.well-known/quilt')).founding).toEqual({});
    expect(await plain.get<Standing>(`/k/${addr(owner)}/standing`)).toMatchObject({ standing: 1, founding: 0 });
  });
  it('covers a gold stake the same owner cannot cover where none is declared, and is locked behind the gold like any standing', async () => {
    for (const t of [founded, plain]) expect((await t.post('/p', { envelope: P })).status).toBe(201);
    const pieces = (await founded.get<{ pieces: { hash: Hash }[] }>(`/p/${p}/state`)).pieces.map((x) => x.hash);
    // Three commitments where no stake is asked: a share of two each, six in all.
    const commitments = commitmentsFor(pieces);
    expect(await plain.refused(`/p/${p}/events`, plain.ev(owner, 'gold', { commitments, stake: 6 }, p))).toBe('free standing 1 is below the gold stake of 6');
    await founded.accepted(`/p/${p}/events`, founded.ev(owner, 'gold', { commitments, stake: 6 }, p));
    expect(await founded.get<Standing>(`/k/${addr(owner)}/standing`)).toMatchObject({ standing: 11, locked: 6, free: 5, founding: 10 });
  });
  it('is read from the environment as <address>=<amount> pairs, and a malformed pair is refused by name', () => {
    const a = addr(owner), b = addr(other);
    expect(foundingFromEnv(`${a}=400, ${b}=1`)).toEqual({ [a]: 400, [b]: 1 });
    expect(foundingFromEnv(undefined)).toEqual({});
    expect(trackerOptionsFromEnv({ QUILT_FOUNDING_STANDING: `${a}=400` }).options.founding).toEqual({ [a]: 400 });
    expect(trackerOptionsFromEnv({}).options.founding).toBeUndefined();
    expect(() => foundingFromEnv(`${a}=0`)).toThrow('is not <address>=<amount>');
    expect(() => foundingFromEnv('somebody=5')).toThrow('somebody=5');
  });
});
