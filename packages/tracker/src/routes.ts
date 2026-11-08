/**
 * The door's routes as one table (PROTOCOL.md, The tracker; QX-17 for the coin's): what a row of it holds, and how a
 * request's path finds its row. tracker.ts writes the rows in the order `handle` tries them, and the well-known
 * document lists the rows' paths in that order, so each route is written once. A row's path is written as the
 * well-known lists it and matched whole against a request's path with its trailing slashes cut: a placeholder stands
 * for one segment of its kind, and a `*` at the end takes every path that starts with what comes before it. The file
 * holds no handler: each row's handlers are the tracker's, written beside the row.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Hash } from '@bitquilt/core';

/**
 * The segments a path's placeholders took, by name; a name the row's path does not have is absent. `<hash>` and `<id>`
 * take a hash, `<address>`, `<owner>` and `<root>` an address in any case, whose checksum is the handler's to check,
 * and `<slug>` a slug.
 */
export interface Segments {
  hash: Hash;
  id: Hash;
  address: string;
  owner: string;
  root: string;
  slug: string;
}

/** What a row's handler is handed: the request, the response, the query, and the path's segments by name. */
export type Asked = { req: IncomingMessage; res: ServerResponse; query: URLSearchParams } & Readonly<Partial<Segments>>;

/** What a row runs for one method. */
export type Handler = (asked: Asked) => void | Promise<void>;

/** The methods a row answers by name. OPTIONS is answered before any row is asked, on every path. */
const METHODS = ['GET', 'POST', 'PUT'] as const;
type Method = (typeof METHODS)[number];

/** One route of the door: its path, what is asked before any method, its handler for each method, and the rest. */
export interface Route {
  /** The path, as the well-known document lists it. */
  path: string;
  /** False where the well-known document leaves the path out. */
  listed?: false;
  /**
   * Asked before any method: `problem`, that the problem the path names is held here; `coin`, that this tracker
   * carries the coin. Each answers 404 where it does not hold.
   */
  guard?: 'problem' | 'coin';
  GET?: Handler;
  POST?: Handler;
  PUT?: Handler;
  /**
   * What a method the row has no handler for gets: 405 naming GET, or the row's GET answer. Left out, the request goes
   * on to the routes mounted beside the tracker, and then to 404.
   */
  otherwise?: 405 | 'GET';
}

/** What each placeholder takes. */
const SEGMENT: Readonly<Record<keyof Segments, string>> = {
  hash: 'sha256:[0-9a-f]{64}',
  id: 'sha256:[0-9a-f]{64}',
  address: '0x[0-9a-fA-F]{40}',
  owner: '0x[0-9a-fA-F]{40}',
  root: '0x[0-9a-fA-F]{40}',
  slug: '[a-z0-9-]{1,64}',
};

/** A row's path as a pattern: its literal text escaped, each placeholder a named group of its kind. */
function patternOf(path: string): RegExp {
  const prefix = path.endsWith('*');
  const parts = (prefix ? path.slice(0, -1) : path).split(/(<[a-z]+>)/).map((part) => {
    const name = /^<([a-z]+)>$/.exec(part)?.[1];
    if (name === undefined) return part.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    if (!Object.hasOwn(SEGMENT, name)) throw new Error(`a route's path names <${name}>, which is no kind of segment`);
    return `(?<${name}>${SEGMENT[name as keyof Segments]})`;
  });
  return new RegExp(`^${parts.join('')}${prefix ? '' : '$'}`);
}

/** Each path's pattern, made the first time a request is matched against it. */
const patterns = new Map<string, RegExp>();

/** The segments a path as a row writes it takes from a request's path, or null where the row is not that path's. */
export function segmentsOf(written: string, path: string): Partial<Segments> | null {
  let pattern = patterns.get(written);
  if (!pattern) patterns.set(written, (pattern = patternOf(written)));
  const m = pattern.exec(path);
  return m ? ({ ...m.groups } as Partial<Segments>) : null;
}

/** The first row whose path takes a request's path, with the segments it took; null where none does. */
export function routeOf(routes: readonly Route[], path: string): { route: Route; segments: Partial<Segments> } | null {
  for (const route of routes) {
    const segments = segmentsOf(route.path, path);
    if (segments) return { route, segments };
  }
  return null;
}

/** The handler a row runs for a method: the method's own, or the row's GET where any other method is answered so. */
export function handlerOf(route: Route, method: string): Handler | undefined {
  const own = (METHODS as readonly string[]).includes(method) ? route[method as Method] : undefined;
  return own ?? (route.otherwise === 'GET' ? route.GET : undefined);
}
