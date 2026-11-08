/**
 * The home's library (library.ts, the standing list of QX-4 and the gold of QX-16 among what it keeps): the file is
 * library.json under the home, empty until Quilt first writes it, written as indented JSON with a newline, and read
 * again whenever another process has written it. Each resolver holds one, so every Quilt over that resolver reads and
 * saves the same library. The connector's record keeps its first time and moves its latest.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { LibraryFile } from '../src/library.js';
import { Quilt } from '../src/quilt.js';
import { Resolver } from '../src/resolver.js';
import { tempHome } from './helpers.js';

const problem = `sha256:${'a'.repeat(64)}`;

describe("the home's library", () => {
  it('is empty until written, is written to library.json as indented JSON, and is read again after another write', async () => {
    const home = tempHome('quilt-library-');
    const books = new LibraryFile(home);
    expect(books.library).toEqual({ problems: {}, pieces: {}, seeding: {} });
    books.library.seeding[problem] = '2026-11-07T10:00:00.000Z';
    books.saveLibrary();
    const file = join(home, 'library.json');
    expect(readFileSync(file, 'utf8')).toBe(
      `${JSON.stringify({ problems: {}, pieces: {}, seeding: { [problem]: '2026-11-07T10:00:00.000Z' } }, null, 2)}\n`,
    );
    // Another process, a one-shot command, writes the file; the next read sees it, the seeding list filled in.
    await new Promise((r) => setTimeout(r, 20));
    writeFileSync(file, `${JSON.stringify({ problems: {}, pieces: { x: 1 } })}\n`);
    expect(books.library).toEqual({ problems: {}, pieces: { x: 1 }, seeding: {} });
  });

  it("keeps the connector's first time and host, and moves its latest", () => {
    const books = new LibraryFile(tempHome('quilt-library-'));
    books.sawConnector('claude-ai', '2026-11-07T10:00:00.000Z');
    books.sawConnector(null, '2026-11-07T11:00:00.000Z');
    expect(books.library.connector).toEqual({
      host: 'claude-ai',
      first: '2026-11-07T10:00:00.000Z',
      last: '2026-11-07T11:00:00.000Z',
    });
  });

  it('is held once by a resolver, so every Quilt over it reads and saves the one library', () => {
    const home = tempHome('quilt-library-');
    const config = { ...DEFAULT_CONFIG, trackers: [] };
    const resolver = new Resolver(config, home);
    const one = new Quilt(config, null, resolver);
    const two = new Quilt(config, null, resolver);
    expect(one.library).toBe(two.library);
    one.library.seeding[problem] = '2026-11-07T10:00:00.000Z';
    resolver.saveLibrary();
    expect(two.library.seeding[problem]).toBe('2026-11-07T10:00:00.000Z');
    expect(new LibraryFile(home).library.seeding[problem]).toBe('2026-11-07T10:00:00.000Z');
    resolver.sawConnector('claude-ai', '2026-11-07T10:00:00.000Z');
    expect(new LibraryFile(home).library.connector?.host).toBe('claude-ai');
  });
});
