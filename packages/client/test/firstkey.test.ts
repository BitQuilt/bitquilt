import { existsSync, readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPhrase } from '@bitquilt/core';
import { DEFAULT_CONFIG, type Config } from '../src/config.js';
import { createPage } from '../src/page.js';
import { Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { runTool } from '../src/tools.js';
import { baseOf, startTracker, tempHome } from './helpers.js';

/**
 * A key at first use (JOURNEY-AUDIT.md, fix 2): a home with no key signs when first asked, making the key then and
 * keeping its twelve words for the page to show once; quilt_me says where they wait; the page shows them one time
 * and the sheet calls the backup due until it has; a second Quilt over the same home sees the key the first made.
 */
let tracker: Server;
let base: string;
let page: Server;
let pageBase: string;
let home: string;
let quilt: Quilt;
let person: Quilt;

beforeAll(async () => {
  ({ server: tracker, base } = await startTracker());
  home = tempHome('quilt-firstkey-');
  const config: Config = { ...DEFAULT_CONFIG, trackers: [base], port: 0 };
  const resolver = new Resolver(config, home);
  quilt = new Quilt(config, null, resolver, 'Claude Desktop');
  person = Quilt.asPerson(config, null, resolver);
  page = await createPage({ quilt, person, resolver }).listen(0);
  pageBase = baseOf(page);
});
afterAll(async () => {
  await new Promise<void>((r) => page.close(() => r()));
  await new Promise<void>((r) => tracker.close(() => r()));
});

const api = async (path: string, init?: RequestInit) => (await fetch(`${pageBase}${path.replace(/^\//, '')}`, { ...init, headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin', ...(init?.headers ?? {}) } })).json() as Promise<Record<string, unknown>>;

describe('a key at first use', () => {
  it('has none until something is signed, and says so without a command to run', async () => {
    expect(quilt.identity).toBeNull();
    expect(quilt.me().wordsDue).toBe(false);
    const me = await runTool(quilt, 'quilt_me', {});
    expect(me.text).toContain('Address: none yet (made at first use)');
    expect(me.text).not.toContain('quilt init');
  });
  it('makes the key when first asked to sign, keeps the words, and the other Quilt over the home sees it', async () => {
    const r = await runTool(quilt, 'quilt_name', { name: 'Mira' });
    expect(r.text).toContain('Name set');
    expect(quilt.identity?.address).toMatch(/^0x/);
    expect(existsSync(join(home, 'key'))).toBe(true);
    expect(existsSync(join(home, 'words'))).toBe(true);
    expect(person.identity?.address).toBe(quilt.identity?.address);
    expect(quilt.me().wordsDue).toBe(true);
    const me = await runTool(quilt, 'quilt_me', {});
    expect(me.text).toContain('its twelve words wait on the page');
    const sheet = await api('/api/phrases');
    expect(sheet.backup).toBe('due');
  });
  it('shows the words once at the page, and then the backup is done', async () => {
    const first = await api('/api/words', { method: 'POST' });
    const words = first.words as string;
    expect(isPhrase(words)).toBe(true);
    expect(words.split(' ')).toHaveLength(12);
    // The words are the key: the secret at the home is the one they make.
    expect(readFileSync(join(home, 'key'), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect((await api('/api/words', { method: 'POST' })).words).toBeNull();
    expect(existsSync(join(home, 'words'))).toBe(false);
    expect((await api('/api/phrases')).backup).toBeNull();
    expect(quilt.me().wordsDue).toBe(false);
  });
});
