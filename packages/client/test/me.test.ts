/**
 * quilt_me against trackers that answer in part: one from before the standing route (QX-15) is named as older rather
 * than as silent, and a tracker's well-known is asked again once it has answered nothing, so one that comes up or gains
 * the coin after the node started is seen without a restart.
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, createKey, loadKey } from '../src/config.js';
import { Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { runTool } from '../src/tools.js';
import { baseOf, hex, tempHome } from './helpers.js';

let older: Server;
let flipping: Server;
let answers = false;

beforeAll(async () => {
  // A tracker from before QX-15: a well-known whose routes have no standing, and nothing else.
  older = createServer((req, res) => {
    if (req.url === '/.well-known/quilt') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ quilt: 1, routes: ['/p', '/p/<hash>', '/k/events'] }));
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no such route' }));
    }
  });
  await new Promise<void>((r) => older.listen(0, '127.0.0.1', r));
  // A tracker that answers nothing until told to.
  flipping = createServer((req, res) => {
    if (answers && req.url === '/.well-known/quilt') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ quilt: 1, routes: ['/k/<address>/standing'], stake: { coin: 'here', burn_rate: 1000 } }));
    } else {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'no such route' }));
    }
  });
  await new Promise<void>((r) => flipping.listen(0, '127.0.0.1', r));
});

afterAll(async () => {
  for (const s of [older, flipping]) await new Promise<void>((r) => s.close(() => r()));
});

function over(trackers: string[]): Quilt {
  const home = tempHome('quilt-me-');
  createKey(home, { secretHex: hex(4) });
  const config = { ...DEFAULT_CONFIG, trackers };
  return new Quilt(config, loadKey(home), new Resolver(config, home), 'Claude Code');
}

describe('quilt_me and the trackers it asks', () => {
  it('names a tracker that answered without the standing route as older, not as silent', async () => {
    const me = await runTool(over([baseOf(older)]), 'quilt_me', {});
    expect(me.text).toContain(`Standing: none; the tracker at ${baseOf(older)} answered but is an older one without the standing route (QX-15)`);
    expect(me.text).not.toContain('Coin (QX-17)');
  });
  it('says no tracker answered when none does', async () => {
    const me = await runTool(over(['http://127.0.0.1:9/']), 'quilt_me', {});
    expect(me.text).toContain('Standing: no tracker answered');
  });
  it('asks a tracker\'s well-known again once it answered nothing, so a tracker that comes up with the coin is seen', async () => {
    const quilt = over([baseOf(flipping)]);
    expect(await quilt.wellKnown(baseOf(flipping))).toBeNull();
    expect(await quilt.coinAt(baseOf(flipping))).toBeNull();
    answers = true;
    expect(await quilt.coinAt(baseOf(flipping))).toEqual({ coinHome: baseOf(flipping), burn_rate: 1000 });
  });
});
