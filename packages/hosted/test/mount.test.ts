/**
 * The on-ramp mounted beside a door (packages/hosted/src/mount.ts), the one wiring bitquilt-hosted, a node with host
 * and these tests share: the door answers the on-ramp's routes beside its own, and its well-known document says it is
 * hosted and, where the authorization server is on, the witness the on-ramp binds (QX-18). That every event a member
 * posts through the door is marked custody: hosted is held in hosted.test.ts, over the same wiring. And the owners'
 * turn (QX-19 section 4, QX-16) a minute after the start and every hour after, one at a time, each member's line said
 * and a turn that failed said as not run, until the timers it returns are cleared.
 */
import type { Server } from 'node:http';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Address } from '@bitquilt/core';
import type { MemberTurn } from '../src/hosted.js';
import { scheduleOwnersTurn } from '../src/mount.js';
import { openDoor } from './helpers.js';

const servers: Server[] = [];
afterAll(() => Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r())))));

/** One door with the on-ramp beside it, listening, and its address once it does. */
async function door(oauth: boolean): Promise<string> {
  const { server, base } = await openDoor({
    hosted: { sentence: null, ...(oauth ? { oauth: { secret: 'oauth-test-secret' } } : {}) },
  });
  servers.push(server);
  return base;
}

describe('the on-ramp mounted beside a door', () => {
  it("answers the on-ramp's routes beside the door's own", async () => {
    const base = await door(false);
    const joined = await fetch(`${base}join`, { method: 'POST' });
    expect(joined.status).toBe(201);
    const { url } = (await joined.json()) as { url: string };
    expect(url).toMatch(new RegExp(`^${base}mcp/[0-9a-f]{64}$`));
    expect((await fetch(`${base}.well-known/quilt`)).status).toBe(200);
  });

  it('says at the well-known document that the door is hosted, and names the witness only where OAuth is on', async () => {
    const known = async (base: string) =>
      (await (await fetch(`${base}.well-known/quilt`)).json()) as { hosted: boolean; witness?: { extension: string } };
    const bare = await known(await door(false));
    expect(bare.hosted).toBe(true);
    expect(bare.witness).toBeUndefined();
    const witnessed = await known(await door(true));
    expect(witnessed.hosted).toBe(true);
    expect(witnessed.witness?.extension).toBe('QX-18');
  });
});

describe("the owners' turn every hour", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A member's turn that said `said`, as hosted.turn() hands it back. */
  const member = (n: number, said: string): MemberTurn => ({
    address: `0x${n.toString(16).padStart(40, '0')}` as Address,
    gold: [],
    sharpened: [],
    taken: [],
    announced: [],
    said,
    kept: { added: 0, reads: 0, sent: 0 },
  });

  it("runs a minute after the start and every hour after, saying what each member's turn said", async () => {
    vi.useFakeTimers();
    const said: string[] = [];
    const turn = vi.fn(async () => [member(1, 'revealed 1 gold'), member(2, '')]);
    const timers = scheduleOwnersTurn({ turn }, (line) => said.push(line));
    expect(timers).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(turn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(turn).toHaveBeenCalledTimes(1);
    expect(said).toEqual([`owners' turn, ${member(1, '').address}: revealed 1 gold`]);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(turn).toHaveBeenCalledTimes(2);
    for (const t of timers) clearTimeout(t);
    await vi.advanceTimersByTimeAsync(3 * 3_600_000);
    expect(turn).toHaveBeenCalledTimes(2);
  });

  it('leaves a turn still running when the hour comes round to finish, and says why a turn was not run', async () => {
    vi.useFakeTimers();
    const said: string[] = [];
    let finish: (turns: MemberTurn[]) => void = () => {};
    const turn = vi
      .fn<() => Promise<MemberTurn[]>>()
      .mockImplementationOnce(() => new Promise((done) => (finish = done)))
      .mockRejectedValueOnce(new Error('the store is closed'));
    const timers = scheduleOwnersTurn({ turn }, (line) => said.push(line));
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(turn).toHaveBeenCalledTimes(1);
    finish([]);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(turn).toHaveBeenCalledTimes(2);
    expect(said).toEqual(["owners' turn: not run (the store is closed)"]);
    for (const t of timers) clearTimeout(t);
  });
});
