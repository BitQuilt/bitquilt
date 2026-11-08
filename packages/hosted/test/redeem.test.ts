/**
 * COIN.md, What it is not: a tracker keeps a record and never money, and a custodial root redeems its coin after taking
 * the key home. The Quilt the on-ramp signs with for a member refuses quilt_redeem with that reason before anything is
 * signed, with or without `to`, so the coin log keeps no redeem of the hosted root's, while its transfer goes through
 * as Quilt's does, with custody: hosted on the receipt. A key held at home redeems at the same door as it always did.
 * The coin comes from the bridge's reader as credits (QX-17 section 2), vested as a transfer's coin is. PROTOCOL.md
 * gives COIN.md's reason for the refusal, which covers a redeem that names `to`, and not where the chain mints a
 * redeem, which does not. The authorization page says the same to the person: a token pays or moves their coin and
 * redeems none.
 */
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type Address, type Receipt, addressOf, signEvent } from '@bitquilt/core';
import { runTool } from 'quilt';
import { AUTHORIZE_PAGE } from '../src/authorize-page.js';
import { openDoor, quiltOver } from './helpers.js';

const T0 = '2026-01-01T00:00:00.000Z';
const key = (n: number): Uint8Array => new Uint8Array(32).fill(n);
const READER = key(0x41);
/** The refusal a hosted session's redeem meets, with or without `to`, which gives COIN.md's reason. */
const CUSTODIAL_REDEEM =
  'the on-ramp refused the redeem: a tracker keeps a record and not money, so a custodial root redeems its coin after taking the key home; the sheet at its long address says how';

let server: Server;
let base: string;

beforeAll(async () => {
  ({ server, base } = await openDoor({
    tracker: {
      coin: {
        genesis: T0,
        epoch_h: 24,
        emission: { per_epoch: 1000, decline_bp: 5000, period_epochs: 2 },
        vesting_h: 48,
        infra_bp: 1000,
        treasury: addressOf(key(0x42)),
        unit: 1000,
        weights: { cross_vendor: 2, same_vendor: 1, attest: 0 },
        burn_rate: 50,
        transfers_from: T0,
        redeem_from: T0,
        reader: addressOf(READER),
      },
    },
    hosted: { sentence: null },
  }));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

/** A deposit credited by the reader to a root, admitted at the door. */
let deposit = 0;
async function credit(root: Address, amount: number): Promise<void> {
  deposit += 1;
  const event = signEvent(
    { quilt: 1, type: 'credit', key: addressOf(READER), ts: new Date().toISOString(), body: { deposit, root, amount } },
    READER,
  );
  const r = await fetch(`${base}coin/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  expect(r.status, await r.clone().text()).toBe(202);
}

const redeems = async (): Promise<{ root: string; to: string; amount: number }[]> =>
  ((await (await fetch(`${base}coin/redeems`)).json()) as { redeems: { root: string; to: string; amount: number }[] })
    .redeems;
const balance = async (root: Address): Promise<number> =>
  ((await (await fetch(`${base}coin/balance/${root}`)).json()) as { balance: number }).balance;

describe('a redeem through the hosted on-ramp', () => {
  it('is refused for a key the tracker holds, with the reason, while the transfer goes through and a key at home redeems', async () => {
    const joined = (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { address: Address; url: string };
    const home = quiltOver(base, 0x43);
    const own = home.identity!.address;
    await credit(joined.address, 100);
    await credit(own, 100);

    const client = new Client({ name: 'claude-ai', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(joined.url)));
    for (const args of [{ amount: 20 }, { amount: 20, to: own }]) {
      const out = await client.callTool({ name: 'quilt_redeem', arguments: args });
      expect(out.isError, JSON.stringify(out)).toBe(true);
      expect(out.content).toEqual([{ type: 'text', text: CUSTODIAL_REDEEM }]);
    }
    expect(await redeems()).toEqual([]);
    expect(await balance(joined.address)).toBe(100);

    // The coin stays the root's record: it moves on the ledger as Quilt's does, marked as the tracker's signature.
    const moved = await client.callTool({ name: 'quilt_transfer', arguments: { to: own, amount: 30 } });
    expect(moved.isError, JSON.stringify(moved)).toBeFalsy();
    await client.close();
    const lines = (await (await fetch(`${base}coin/events`)).text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Receipt);
    const hosted = lines.filter((l) => l.event.key === joined.address);
    expect(hosted.map((l) => l.event.type)).toEqual(['transfer']);
    expect(hosted[0]!.received[0]!.custody).toBe('hosted');
    expect(await balance(joined.address)).toBe(70);

    // A key held at home redeems at the same door, as it always did.
    const redeemed = await runTool(home, 'quilt_redeem', { amount: 20 });
    expect(redeemed.text).toContain(`Redeem of 20 units posted to the coin log at ${base}`);
    expect(await redeems()).toEqual([expect.objectContaining({ root: own, to: own, amount: 20 })]);
    expect(await balance(own)).toBe(110);
  });

  it("is refused in PROTOCOL.md for COIN.md's reason, not for where the chain mints a redeem", () => {
    const doc = (name: string): string => readFileSync(new URL(`../../../docs/${name}`, import.meta.url), 'utf8');
    expect(doc('COIN.md')).toContain(
      'A tracker keeps a record and never money; a custodial root holds coin as a record like any other and redeems it after taking the key home.',
    );
    const protocol = doc('PROTOCOL.md');
    expect(protocol).toContain(
      'A tracker keeps a record and never money, so a custodial root redeems after taking the key home, and the on-ramp refuses a redeem for a key it holds, with or without `to` ([COIN.md](COIN.md), What it is not).',
    );
    expect(protocol).not.toContain('or to the root (QX-17 section 2), so a custodial root redeems');
  });

  it('is what the authorization page says a token cannot do', () => {
    expect(AUTHORIZE_PAGE).toContain('and pays or moves your coin, each when you say so in the chat.');
    expect(AUTHORIZE_PAGE).toContain(
      'it redeems no coin to the chain: this tracker holds your key, so a redeem waits until the key is on your own machine.',
    );
    expect(AUTHORIZE_PAGE).not.toContain('redeems your coin');
  });
});
