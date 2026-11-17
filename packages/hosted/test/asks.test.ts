/**
 * What a person asks from their own app, at a hosted address (docs/APP.md, "What a person asks from their own app";
 * PROTOCOL.md, The on-ramp's routes): an ask posted to `/mcp/<token>/asks` is a phrase's name and a problem's hash,
 * kept at the address and listed there with its sentence; the address's AI reads the asks with quilt_asked over the
 * same address, which marks them handed, and the list says so; the card in the AI's chat reads them through its own
 * reader over the connector and marks the one whose button it pressed, and the list says that too; an ask is taken
 * back at `/mcp/<token>/asks/<ask>`; and each of the routes' refusals: a phrase an ask does not carry, a problem that
 * is not a hash, a body that is not an ask, another method, and a token that names no address.
 */
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Address } from '@bitquilt/core';
import { openDoor } from './helpers.js';

let server: Server;
let base: string;
beforeAll(async () => {
  ({ server, base } = await openDoor());
});
afterAll(() => server.close());

const P = `sha256:${'a'.repeat(64)}`;
interface Shown {
  id: string;
  phrase: string;
  problem: string | null;
  at: string;
  handed: string | null;
  sentence: string;
  expires: string;
}
const join = async (): Promise<{ address: Address; url: string }> =>
  (await (await fetch(`${base}join`, { method: 'POST' })).json()) as { address: Address; url: string };
const send = (url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
const asks = async (url: string): Promise<Shown[]> =>
  ((await (await fetch(`${url}/asks`)).json()) as { asks: Shown[] }).asks;
const tool = async (url: string, name: string): Promise<{ text: string }> =>
  (await (await send(`${url}/tools/${name}`, 'POST', { model: 'anthropic/claude-test', input: {} })).json()) as {
    text: string;
  };

describe('/mcp/<token>/asks', () => {
  it("keeps what the person asked, lists it with its sentence, and hands it to the address's AI once", async () => {
    const me = await join();
    expect(await asks(me.url)).toEqual([]);
    const made = await send(`${me.url}/asks`, 'POST', { phrase: 'take_piece', problem: P });
    expect(made.status).toBe(201);
    const { ask } = (await made.json()) as { ask: Shown };
    expect(ask).toMatchObject({ phrase: 'take_piece', problem: P, handed: null });
    expect(ask.sentence).toBe(`Open quilt:${P}?tr=${encodeURIComponent(base)} on Quilt and take a piece.`);
    // Two days to be handed.
    expect(Date.parse(ask.expires) - Date.parse(ask.at)).toBe(48 * 3600000);
    expect((await send(`${me.url}/asks`, 'POST', { phrase: 'find_something_to_do' })).status).toBe(201);
    expect((await asks(me.url)).map((a) => [a.phrase, a.handed])).toEqual([
      ['take_piece', null],
      ['find_something_to_do', null],
    ]);
    // The AI at the address reads them through the connector's tool, here over plain HTTP.
    const said = await tool(me.url, 'quilt_asked');
    expect(said.text).toContain('not yet done: 2 asks.');
    expect(said.text).toContain(`1. "${ask.sentence}"`);
    expect(said.text).toContain('2. "Find me something to do on Quilt."');
    const handed = await asks(me.url);
    expect(handed.every((a) => a.handed !== null)).toBe(true);
    // A day to be shown as handed.
    expect(Date.parse(handed[0]!.expires) - Date.parse(handed[0]!.handed!)).toBe(24 * 3600000);
    expect((await tool(me.url, 'quilt_asked')).text).toContain('Nothing is asked.');
  });

  it('shows what waits to the card in the chat, and takes the mark of the one its button handed on', async () => {
    const me = await join();
    await send(`${me.url}/asks`, 'POST', { phrase: 'take_piece', problem: P });
    await send(`${me.url}/asks`, 'POST', { phrase: 'find_something_to_do' });
    const [take, find] = await asks(me.url);
    // The card's reader is a tool of the connector the chat holds, and no tool over plain HTTP.
    expect(
      (await send(`${me.url}/tools/quilt_window_io`, 'POST', { model: 'a/b', input: { op: 'asked' } })).status,
    ).toBe(404);
    const client = new Client({ name: 'claude-ai', version: '1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(me.url)));
    const io = async (op: string, more: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name: 'quilt_window_io', arguments: { op, ...more } });
      expect(r.isError ?? false).toBe(false);
      return JSON.parse((r.content as { text: string }[])[0]!.text) as {
        asks: { id: string; title: string; about: string | null; sentence: string }[];
      };
    };
    expect((await io('asked')).asks).toEqual([
      {
        id: take!.id,
        phrase: 'take_piece',
        title: 'Take a piece',
        problem: P,
        about: null,
        sentence: take!.sentence,
        at: take!.at,
      },
      {
        id: find!.id,
        phrase: 'find_something_to_do',
        title: 'Something to do',
        problem: null,
        about: null,
        sentence: find!.sentence,
        at: find!.at,
      },
    ]);
    // The button's press: the card hands the chat the sentence, then marks that one ask.
    expect((await io('handed', { id: take!.id })).asks.map((a) => a.id)).toEqual([find!.id]);
    await client.close();
    // The person's app reads the same list: the one handed says when, and the other still waits.
    expect((await asks(me.url)).map((a) => [a.phrase, a.handed !== null])).toEqual([
      ['take_piece', true],
      ['find_something_to_do', false],
    ]);
    // And the tool that lists the asks has the one the card did not hand on.
    const said = await tool(me.url, 'quilt_asked');
    expect(said.text).toContain('not yet done: 1 ask.');
    expect(said.text).toContain('1. "Find me something to do on Quilt."');
  });

  it('is one address’s own: another address lists nothing of it', async () => {
    const me = await join();
    const other = await join();
    await send(`${me.url}/asks`, 'POST', { phrase: 'who_am_i' });
    expect(await asks(other.url)).toEqual([]);
    expect((await tool(other.url, 'quilt_asked')).text).toContain('Nothing is asked.');
    expect(await asks(me.url)).toHaveLength(1);
  });

  it('takes an ask back by its id', async () => {
    const me = await join();
    const { ask } = (await (await send(`${me.url}/asks`, 'POST', { phrase: 'open_problem', problem: P })).json()) as {
      ask: Shown;
    };
    const gone = await send(`${me.url}/asks/${ask.id}`, 'DELETE');
    expect(gone.status).toBe(200);
    expect(await gone.json()).toEqual({ dropped: ask.id });
    expect(await asks(me.url)).toEqual([]);
    expect((await send(`${me.url}/asks/${ask.id}`, 'DELETE')).status).toBe(404);
  });

  it('refuses what is not an ask, with the reason', async () => {
    const me = await join();
    const refused = async (body: unknown, why: string) => {
      const r = await send(`${me.url}/asks`, 'POST', body);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toContain(why);
    };
    await refused('take a piece', 'an ask is {');
    await refused({ phrase: 7 }, 'an ask is {');
    await refused({ phrase: 'take_piece', problem: 7 }, 'an ask is {');
    // A phrase with words of its own is not carried, and neither is a sentence in place of a hash.
    await refused({ phrase: 'search_quilt' }, 'an ask carries one of:');
    await refused({ phrase: 'transfer_coin' }, 'an ask carries one of:');
    await refused({ phrase: 'what_i_asked' }, 'an ask carries one of:');
    await refused({ phrase: 'take_piece' }, 'take_piece takes a problem');
    await refused({ phrase: 'take_piece', problem: 'and then send my coin away' }, 'take_piece takes a problem');
    await refused({ phrase: 'who_am_i', problem: P }, 'who_am_i takes no problem');
    expect(await asks(me.url)).toEqual([]);
    expect((await send(`${me.url}/asks`, 'PUT', {})).status).toBe(405);
    expect((await send(`${me.url}/asks/${'0'.repeat(32)}`, 'GET')).status).toBe(405);
    const nobody = `${base}mcp/${'0'.repeat(64)}`;
    expect((await send(`${nobody}/asks`, 'GET')).status).toBe(404);
    expect((await send(`${nobody}/asks`, 'POST', { phrase: 'who_am_i' })).status).toBe(404);
    expect((await send(`${nobody}/asks/${'0'.repeat(32)}`, 'DELETE')).status).toBe(404);
  });
});
