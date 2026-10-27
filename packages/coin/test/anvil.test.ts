import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { accessSync, constants, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Abi, type Address, type Chain, type Hex, balanceOf, bond, deploy, headAt, isFinal, isRedeemed, lastPosted, redeem } from '../src/chain.js';
import { leaf, proof } from '../src/merkle.js';
import { post } from '../src/post.js';

/**
 * The door out over a local chain, where forge and anvil are on this machine: the contracts are built and deployed
 * through chain.ts, the poster bonds and posts a head over a real tree of two redeems, time moves past the window,
 * one line is redeemed with its proof, the balance is the amount, and the same line is refused a second time. The
 * test goes through chain.ts for every call, so the RPC library stays behind its one door.
 */
const here = dirname(fileURLToPath(import.meta.url));
const contracts = join(here, '..', '..', '..', 'contracts');

function tool(name: string): string | null {
  for (const dir of [...(process.env.PATH ?? '').split(':'), join(homedir(), '.foundry', 'bin')]) {
    if (!dir) continue;
    const path = join(dir, name);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      continue;
    }
  }
  return null;
}
const forge = tool('forge');
const anvil = tool('anvil');

/** anvil's first default account: its key is published with anvil and holds nothing but a local chain's test ether. */
const KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const DEPLOYER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const TREASURY: Address = '0x0000000000000000000000000000000000007ea5';
const HOLDER: Address = '0x0000000000000000000000000000000000000b0b';
const WINDOW = 60;
const MIN_BOND = 10n ** 18n;

async function rpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const answer = (await r.json()) as { result?: unknown; error?: { message: string } };
  if (answer.error) throw new Error(answer.error.message);
  return answer.result;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const a = s.address();
      s.close(() => (a && typeof a === 'object' ? resolve(a.port) : reject(new Error('no port'))));
    });
  });
}

async function untilAnswering(url: string): Promise<void> {
  for (let i = 0; i < 150; i++) {
    try {
      await rpc(url, 'eth_chainId');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('anvil did not answer in fifteen seconds');
}

function artifact(name: string): { abi: Abi; bytecode: Hex } {
  const json = JSON.parse(readFileSync(join(contracts, 'out', `${name}.sol`, `${name}.json`), 'utf8')) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

describe.skipIf(!forge || !anvil)('the door out over anvil', () => {
  let proc: ChildProcess | undefined;
  let url = '';
  let chain: Chain;

  beforeAll(async () => {
    execFileSync(forge!, ['build'], { cwd: contracts, stdio: 'pipe' });
    const port = await freePort();
    url = `http://127.0.0.1:${port}`;
    proc = spawn(anvil!, ['--port', String(port)], { stdio: 'ignore' });
    await untilAnswering(url);
    const base = { rpc: url, chainId: 31337, key: KEY };
    const anchorsArtifact = artifact('Anchors');
    const quiltArtifact = artifact('Quilt');
    const anchors = await deploy(base, { abi: anchorsArtifact.abi, bytecode: anchorsArtifact.bytecode, args: [DEPLOYER, TREASURY, MIN_BOND, BigInt(WINDOW)] });
    const quilt = await deploy(base, { abi: quiltArtifact.abi, bytecode: quiltArtifact.bytecode, args: [anchors] });
    chain = { ...base, contracts: { anchors, quilt } };
  }, 60_000);

  afterAll(() => {
    proc?.kill();
  });

  it('bonds, posts a head over two redeems, waits out the window, redeems one line once and refuses it twice', async () => {
    const redeems = [
      { id: 'a1'.repeat(32), seq: 3, root: DEPLOYER, to: DEPLOYER, amount: 1_250_000 },
      { id: 'b2'.repeat(32), seq: 5, root: DEPLOYER, to: HOLDER, amount: 42 },
    ];
    const head = { seq: 5, hash: 'c3'.repeat(32) };
    const fetchImpl = (async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://home.test/coin/redeems');
      return Response.json({ head, redeems });
    }) as typeof fetch;

    await bond(chain, MIN_BOND);
    expect(await lastPosted(chain)).toBe(0);
    const first = await post({ home: 'http://home.test', chain, fetchImpl });
    expect(first).toMatchObject({ seq: 5, head: head.hash, posted: true, redeems: 2 });
    expect(first.tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await lastPosted(chain)).toBe(5);
    const at = await headAt(chain, 5);
    expect(at).toMatchObject({ seq: 5, head: `0x${head.hash}`, root: first.root, poster: DEPLOYER, vetoed: false, posted: true });
    expect(at.postedAt).toBeGreaterThan(0);
    expect((await headAt(chain, 4)).posted).toBe(false);

    const again = await post({ home: 'http://home.test', chain, fetchImpl });
    expect(again.posted).toBe(false);
    expect(await lastPosted(chain)).toBe(5);

    const leaves = redeems.map((r) => leaf(`0x${r.id}`, r.to, r.amount));
    const line = { seq: 5, id: `0x${redeems[0]!.id}` as Hex, to: DEPLOYER, amount: 1_250_000n, proof: proof(leaves, leaves[0]!) };
    expect(line.proof).toHaveLength(1);
    expect(await isFinal(chain, 5)).toBe(false);
    await expect(redeem(chain, line)).rejects.toThrow(/not final/);

    await rpc(url, 'evm_increaseTime', [WINDOW + 1]);
    await rpc(url, 'evm_mine', []);
    expect(await isFinal(chain, 5)).toBe(true);
    expect(await isRedeemed(chain, line.id)).toBe(false);
    expect(await balanceOf(chain, DEPLOYER)).toBe(0n);

    await expect(redeem(chain, { ...line, amount: 1_250_001n })).rejects.toThrow(/does not reach the root/);
    const minted = await redeem(chain, line);
    expect(minted.tx).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await balanceOf(chain, DEPLOYER)).toBe(1_250_000n);
    expect(await isRedeemed(chain, line.id)).toBe(true);
    await expect(redeem(chain, line)).rejects.toThrow(/redeemed already/);
    expect(await balanceOf(chain, DEPLOYER)).toBe(1_250_000n);
    expect(await balanceOf(chain, HOLDER)).toBe(0n);
  }, 60_000);
});

if (!forge || !anvil) it.skip('forge and anvil were not found on PATH or under ~/.foundry/bin, so the chain test is skipped', () => {});
