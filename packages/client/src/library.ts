/**
 * The home's library (library.json; APP.md, "The library"; QX-4 section 5 for the standing list, QX-16 section 8 for
 * the gold): what a home has touched, written by Quilt after each act it records and read again whenever the file has
 * changed, so a second copy of quilt on the same home is seen rather than written over. Each resolver holds one, so
 * every Quilt over that resolver shares it. `publicLibrary` is the library as the page's API and the window show it,
 * with the gold's answers left in the home.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Hash } from '@bitquilt/core';
import type { Held } from './chains.js';

/**
 * What a home has touched: the problems opened, the pieces claimed and returned, and the standing list (QX-4). Written
 * by Quilt after each act it records (opening, claiming, returning, seeding, committing gold) and never by the resolver
 * on its own; `pieces` is this key's own claims and returns.
 */
export interface Library {
  /**
   * Every problem opened or published here; `next` is the version this key published in its place (QX-19 section 4), so
   * it is not sharpened twice; `topics` the ones this key announced with (QX-13), and `announced` the work its last
   * announce stated and the relays an announce was offered to, so the owner's turn announces again only where the work
   * moved or a relay has not been offered one.
   *
   * `frozen` is when the owner froze the brief here (`quilt freeze`): the owner's turn sharpens it no more, and nothing
   * republishes it.
   */
  problems: Record<
    string,
    {
      title: string;
      slug: string;
      trackers: string[];
      first: string;
      last: string;
      next?: Hash;
      topics?: string[];
      announced?: { at: string; mark: string; relays?: string[] };
      frozen?: string;
    }
  >;
  pieces: Record<
    string,
    { problem: Hash; name: string; when: string; what: 'claimed' | 'returned'; verifier?: string }
  >;
  /** The standing list (QX-4): the problems this key seeds, by the time it said so. */
  seeding: Record<string, string>;
  /**
   * The owner's gold (QX-16), by problem then piece: the projection and nonce behind each commitment, which never leave
   * the home, and when it was revealed.
   */
  gold?: Record<
    string,
    Record<string, { name: string; projection: Record<string, unknown>; nonce: string; revealed?: string }>
  >;
  /**
   * The AI that connected through the connector: its host's name, the first time and the latest. Its presence is what
   * moves the menu bar from install instructions to the phrases (phrases.ts).
   */
  connector?: { host: string | null; first: string; last: string };
  /**
   * The hot list (APP.md, "The window"): the keys this person follows, by address, with the name they knew them by. A
   * choice at the edge; no rule reads it and no event carries it.
   */
  follows?: Record<string, { name: string | null; since: string }>;
}

const EMPTY_LIBRARY = (): Library => ({ problems: {}, pieces: {}, seeding: {} });

/**
 * The library as the page's API and the window show it: names and counts, and what the node serves. The gold's
 * projections and nonces never leave the home (the Library says so of itself), so each problem's gold is two counts.
 */
export function publicLibrary(
  library: Library,
  held: Held,
): {
  problems: Record<string, Library['problems'][string]>;
  pieces: Library['pieces'];
  seeding: Library['seeding'];
  follows: NonNullable<Library['follows']>;
  connector: Library['connector'] | null;
  gold: Record<string, { committed: number; revealed: number }>;
  serving: Held;
} {
  const gold: Record<string, { committed: number; revealed: number }> = {};
  for (const [problem, pieces] of Object.entries(library.gold ?? {}))
    gold[problem] = {
      committed: Object.keys(pieces).length,
      revealed: Object.values(pieces).filter((g) => g.revealed).length,
    };
  return {
    problems: library.problems,
    pieces: library.pieces,
    seeding: library.seeding,
    follows: library.follows ?? {},
    connector: library.connector ?? null,
    gold,
    serving: held,
  };
}

/** The library's file under a home, and the library read from it. */
export class LibraryFile {
  private readonly libraryFile: string;
  private held: Library | null = null;
  /**
   * The file's size and time when it was last read or written, so another process's write is seen before this one's
   * next.
   */
  private stamp = '';

  constructor(home: string) {
    this.libraryFile = join(home, 'library.json');
  }

  private fileStamp(): string {
    try {
      const s = statSync(this.libraryFile);
      return `${s.size}:${s.mtimeMs}`;
    } catch {
      return '';
    }
  }

  /**
   * The home's library, one for every Quilt over this resolver. It is read from disk when first asked for and again
   * whenever the file has changed since, so a second copy of quilt on the same home (a one-shot command, say) is seen
   * rather than written over.
   */
  get library(): Library {
    const now = this.fileStamp();
    if (this.held === null || now !== this.stamp) {
      this.held = now === '' ? EMPTY_LIBRARY() : (JSON.parse(readFileSync(this.libraryFile, 'utf8')) as Library);
      if (!this.held.seeding) this.held.seeding = {};
      this.stamp = now;
    }
    return this.held;
  }

  /**
   * Records that an AI connected through the connector, under the host's name, and saves: the first time is kept, the
   * latest moves.
   */
  sawConnector(host: string | null, now = new Date().toISOString()): void {
    const was = this.library.connector;
    this.library.connector = { host: host ?? was?.host ?? null, first: was?.first ?? now, last: now };
    this.saveLibrary();
  }

  saveLibrary(): void {
    writeFileSync(this.libraryFile, JSON.stringify(this.library, null, 2) + '\n');
    this.stamp = this.fileStamp();
  }
}
