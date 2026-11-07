import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { type Hash, type Receipt, commitHash, newNonce, problemHash } from '@bitquilt/core';
import { PRIVATE_RANGES, clientAddressOf, inRanges, plainAddress, rangesOf } from '../src/address.js';
import { Store } from '../src/store.js';
import { addr, boot, envelope, key } from './helpers.js';

/**
 * QX-18 at the tracker's door: the witness the hosted on-ramp names in `x-quilt-via` is written beside
 * `custody: hosted` on a post that carries the custody secret, and on no other, with `via_by` saying how a product's
 * mark was bound; a mark that is not a host name in lower case or `other` is left out, and so is a client's name that
 * does not pass the gate and a binding of another shape; `/p/<hash>/state` lists the witnessed reveals of each piece;
 * the routes mounted beside the tracker say their piece at the well-known document. The client's address behind a
 * proxy (address.ts): X-Forwarded-For believed only from a trusted peer, read from the right past the trusted hops.
 * And the store's schema for the authorization server: an older database gains the tables on open and keeps its
 * members, and a grant goes in, rotates and is revoked.
 */
const owner = key(9),
  A = key(1),
  B = key(2),
  C = key(3),
  D = key(4);
const by = (model: string) => ({ model, client: 'test/0', can: ['web' as const] });
const schema = {
  type: 'object' as const,
  additionalProperties: false as const,
  required: ['verdict'],
  properties: { verdict: { enum: ['supports', 'contradicts'] } },
};
const CUSTODY = 'custody-secret';
const t = boot('2026-11-01T10:00:00.000Z', {
  limits: { keyPerHour: 1000, ipPerHour: 10000 },
  custodySecret: CUSTODY,
  extraWellKnown: () => ({ witness: { extension: 'QX-18', connector: 'http://tracker.test/mcp' } }),
});
const { post, get, ev, accepted } = t;
beforeAll(() => t.listen());
afterAll(() => t.close());

async function handIn(
  problem: Hash,
  piece: Hash,
  k: Uint8Array,
  model: string,
  headers: Record<string, string>,
): Promise<void> {
  const ret = { verdict: 'supports' };
  const nonce = newNonce();
  await accepted(`/p/${problem}/events`, ev(k, 'commit', { h: commitHash(ret, nonce) }, problem, piece), headers);
  await accepted(
    `/p/${problem}/events`,
    ev(k, 'reveal', { return: ret, nonce, by: by(model) }, problem, piece),
    headers,
  );
}

describe('the witness at the door (QX-18)', () => {
  let p: Hash;
  let pieces: Hash[];
  const wrappersOf = async (k: Uint8Array): Promise<Record<string, unknown>[]> => {
    const lines = (await (await fetch(`${t.base}/p/${p}/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    return lines.filter((l) => l.event.key === addr(k)).map((l) => l.received[0] as unknown as Record<string, unknown>);
  };

  it('writes via beside custody on a hosted post, and reads nothing from a post without the custody secret', async () => {
    const e = envelope(owner, 'witness', {
      'statement/*': {
        count: 4,
        verifier: 'agree',
        requires: ['web'],
        brief: 'Statement {n}: does the paper say so?',
        schema,
      },
    });
    expect((await post('/p', { envelope: e })).status).toBe(201);
    p = problemHash(e);
    pieces = (await get<{ pieces: { hash: Hash }[] }>(`/p/${p}/state`)).pieces.map((x) => x.hash);
    await handIn(p, pieces[0]!, A, 'anthropic/claude-ai', {
      'x-quilt-custody': CUSTODY,
      'x-quilt-via': 'claude.ai',
      'x-quilt-via-by': 'address',
    });
    await handIn(p, pieces[0]!, B, 'openai/gpt', { 'x-quilt-via': 'chatgpt.com', 'x-quilt-via-by': 'key' });
    for (const w of await wrappersOf(A))
      expect(w).toMatchObject({ custody: 'hosted', seat: 'ai', via: 'claude.ai', via_by: 'address' });
    for (const w of await wrappersOf(B)) {
      expect(w.custody).toBe('self');
      expect(w).not.toHaveProperty('via');
    }
  });

  it("carries a client's own name with other, and leaves out a mark or a name of the wrong shape", async () => {
    // A binding comes with a product alone, and only in the two shapes the extension names.
    await handIn(p, pieces[1]!, C, 'meta/llama', {
      'x-quilt-custody': CUSTODY,
      'x-quilt-via': 'other',
      'x-quilt-via-by': 'key',
      'x-quilt-via-client': encodeURIComponent('Acme Agent'),
    });
    for (const w of await wrappersOf(C)) {
      expect(w).toMatchObject({ custody: 'hosted', via: 'other', via_client: 'Acme Agent' });
      expect(w).not.toHaveProperty('via_by');
    }
    await handIn(p, pieces[2]!, D, 'meta/llama', {
      'x-quilt-custody': CUSTODY,
      'x-quilt-via': 'Claude.AI!',
      'x-quilt-via-by': 'address',
    });
    for (const w of await wrappersOf(D)) {
      expect(w.custody).toBe('hosted');
      expect(w).not.toHaveProperty('via');
      expect(w).not.toHaveProperty('via_by');
    }
    const F = key(6);
    await handIn(p, pieces[3]!, F, 'meta/llama', {
      'x-quilt-custody': CUSTODY,
      'x-quilt-via': 'chatgpt.com',
      'x-quilt-via-by': 'magic',
    });
    for (const w of await wrappersOf(F)) {
      expect(w.via).toBe('chatgpt.com');
      expect(w).not.toHaveProperty('via_by');
    }
    const E = key(5);
    await handIn(p, pieces[3]!, E, 'meta/llama', {
      'x-quilt-custody': CUSTODY,
      'x-quilt-via': 'other',
      'x-quilt-via-client': encodeURIComponent('see https://example.com now'),
    });
    for (const w of await wrappersOf(E)) {
      expect(w.via).toBe('other');
      expect(w).not.toHaveProperty('via_client');
    }
  });

  it('says at the well-known document what the routes beside it say of themselves', async () => {
    const wk = await get<{ hosted: boolean; witness: { extension: string; connector: string } }>('/.well-known/quilt');
    expect(wk.hosted).toBe(false);
    expect(wk.witness).toEqual({ extension: 'QX-18', connector: 'http://tracker.test/mcp' });
  });

  it('lists the witnessed reveals of each piece in the state', async () => {
    const state = await get<{
      pieces: { hash: Hash; witnessed: { key: string; via: string; via_client?: string }[] }[];
    }>(`/p/${p}/state`);
    const of = (h: Hash) => state.pieces.find((x) => x.hash === h)!.witnessed;
    expect(of(pieces[0]!)).toEqual([{ key: addr(A), via: 'claude.ai', via_by: 'address' }]);
    expect(of(pieces[1]!)).toEqual([{ key: addr(C), via: 'other', via_client: 'Acme Agent' }]);
    expect(of(pieces[2]!)).toEqual([]);
    expect(of(pieces[3]!)).toEqual([
      { key: addr(key(6)), via: 'chatgpt.com' },
      { key: addr(key(5)), via: 'other' },
    ]);
  });
});

describe("the client's address behind a proxy", () => {
  const trusted = rangesOf(PRIVATE_RANGES);
  it('reads an address in one form and a range list into a block list, and refuses a range that does not parse', () => {
    expect(plainAddress('::ffff:160.79.104.10')).toBe('160.79.104.10');
    expect(plainAddress('[fe80::1%en0]')).toBe('fe80::1');
    expect(inRanges(rangesOf(['160.79.104.0/21']), '160.79.111.254')).toBe(true);
    expect(inRanges(rangesOf(['160.79.104.0/21']), '160.79.112.1')).toBe(false);
    expect(inRanges(rangesOf(['160.79.104.0/21']), '::ffff:160.79.105.1')).toBe(true);
    expect(inRanges(rangesOf(['203.0.113.9', 'fd00::/8']), '203.0.113.9')).toBe(true);
    expect(inRanges(rangesOf(['fd00::/8']), 'fd12::1')).toBe(true);
    expect(inRanges(trusted, 'not an address')).toBe(false);
    for (const bad of ['160.79.104.0/33', 'claude.ai/21', '10.0.0.0/x', 'fd00::/129'])
      expect(() => rangesOf([bad]), bad).toThrow('not an address range');
  });
  it('believes X-Forwarded-For only from a trusted peer, and reads it from the right past the trusted hops', () => {
    // No proxy: the peer is the client, whatever the header says.
    expect(clientAddressOf('203.0.113.9', '160.79.104.10', trusted)).toBe('203.0.113.9');
    expect(clientAddressOf('203.0.113.9', undefined, trusted)).toBe('203.0.113.9');
    // One proxy on the compose network, which wrote the header itself: the client is what it wrote.
    expect(clientAddressOf('172.18.0.2', '160.79.104.10', trusted)).toBe('160.79.104.10');
    expect(clientAddressOf('::ffff:172.18.0.2', '160.79.104.10', trusted)).toBe('160.79.104.10');
    // A proxy that appended to a header the client sent: the client's forgery is to the left of the proxy's own entry.
    expect(clientAddressOf('172.18.0.2', '160.79.104.10, 203.0.113.9', trusted)).toBe('203.0.113.9');
    // Two trusted hops in a row: past both to the client; all trusted, the leftmost.
    expect(clientAddressOf('172.18.0.2', '203.0.113.9, 10.0.0.5', trusted)).toBe('203.0.113.9');
    expect(clientAddressOf('172.18.0.2', '127.0.0.1, 10.0.0.5', trusted)).toBe('127.0.0.1');
    // An entry that is not an address ends the walk, and the peer stands for the client.
    expect(clientAddressOf('172.18.0.2', '160.79.104.10, nonsense', trusted)).toBe('172.18.0.2');
    // Trusting no proxy at all: the header is never read.
    expect(clientAddressOf('127.0.0.1', '160.79.104.10', rangesOf([]))).toBe('127.0.0.1');
  });
});

describe("the authorization server's tables (QX-18)", () => {
  it('gives an older database the three tables on open, keeps its members, and keeps a grant through rotation and revocation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'quilt-oauth-'));
    const path = join(dir, 'tracker.db');
    try {
      const before = new DatabaseSync(path);
      before.exec(
        'create table members (token_hash text primary key, address text not null, key_enc text not null, created_at text not null, name text)',
      );
      before
        .prepare('insert into members (token_hash, address, key_enc, created_at) values (?, ?, ?, ?)')
        .run('old', addr(key(33)), 'enc', '2026-10-30T10:00:00.000Z');
      before.close();
      const store = new Store(path);
      const columns = (table: string) =>
        (store.db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      expect(columns('oauth_clients')).toEqual(['client_id', 'json', 'secret_hash', 'created_at']);
      expect(columns('oauth_codes')).toEqual([
        'code_hash',
        'client_id',
        'token_hash',
        'redirect_uri',
        'challenge',
        'resource',
        'expires_at',
        'used_at',
        'grant_id',
      ]);
      expect(columns('oauth_grants')).toEqual([
        'id',
        'token_hash',
        'client_id',
        'redirect_uri',
        'via',
        'client_name',
        'resource',
        'created_at',
        'refresh_gen',
        'revoked_at',
        'via_by',
      ]);
      expect(columns('oauth_assertions')).toEqual(['jti_hash', 'expires_at']);
      expect(store.getMember('old')?.address).toBe(addr(key(33)));
      store.putGrant({
        id: 'g1',
        tokenHash: 'old',
        clientId: 'c1',
        redirectUri: 'https://claude.ai/api/mcp/auth_callback',
        via: 'claude.ai',
        viaBy: 'address',
        clientName: null,
        resource: null,
        createdAt: '2026-11-01T10:00:00.000Z',
      });
      expect(store.rotateGrant('g1', 0)).toBe(true);
      expect(store.rotateGrant('g1', 0)).toBe(false);
      store.close();
      const again = new Store(path);
      expect(again.grantsOf('old')).toMatchObject([
        {
          id: 'g1',
          clientId: 'c1',
          redirectUri: 'https://claude.ai/api/mcp/auth_callback',
          via: 'claude.ai',
          viaBy: 'address',
          refreshGen: 1,
          revokedAt: null,
        },
      ]);
      expect(again.putAssertion('j1', '2026-11-01T12:00:00.000Z')).toBe(true);
      expect(again.putAssertion('j1', '2026-11-01T12:00:00.000Z')).toBe(false);
      again.revokeGrant('g1', '2026-11-01T11:00:00.000Z');
      expect(again.rotateGrant('g1', 1)).toBe(false);
      expect(again.getGrant('g1')?.revokedAt).toBe('2026-11-01T11:00:00.000Z');
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
