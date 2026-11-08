/**
 * What the directory window's reader answers (APP.md, "The window"; window.ts, `windowAnswer`), op by op, the handle
 * the tool that shows the card hands it (tools.ts, quilt_window), and the piece on a problem's map that the page's
 * /api/open shares with the window's `open`: the JSON the card (packages/client/window) and the page read, declared
 * once. The reader's return type holds the server to these, and the card takes them with `import type`, which the
 * build erases, so nothing of the server enters the card. Types alone, with no import, since the card's own program
 * has neither Node nor the core.
 */

/** The work on a problem as a search row carries it, the tracker's numbers or an announce's. */
export interface Work {
  returned: number;
  accepted: number;
  verified: number;
  disputed: number;
  traced: { both: number; one: number; none: number };
  readers: number;
  vendors: number;
  last: string | null;
}

/** One problem a search found, with the link the card fills a phrase with. */
export interface Row {
  problem: string;
  title: string;
  slug: string;
  owner: string;
  owner_name?: string | null;
  from?: string | null;
  root?: string;
  pieces: number;
  counts: Record<string, number>;
  work?: Work | null;
  topics: string[];
  tracker: string;
  via: 'tracker' | 'relay';
  held?: string[];
  announced?: string | null;
  link: string;
}

/** The answer to `search`: the query and the problems found. */
export interface Searched {
  op: 'search';
  query: string;
  rows: Row[];
}

/**
 * One piece on a problem's map as the page and the window both read it: its verifier and kind, its state beside the
 * core's, and its stake and gold. Each adds its own fields.
 */
export interface MapPiece {
  hash: string;
  name: string;
  verifier: string;
  kind: string | null;
  strength: string | null;
  weakest: boolean;
  attested: boolean;
  state: string;
  core: string;
  stake: number;
  gold: string | null;
  verified: boolean;
}

/** One piece on the window's map: its kind and state as the tracker's layer holds them, and its counts. */
export interface PieceRow extends MapPiece {
  traced: 'both' | 'one' | 'none' | null;
  traces: number;
  reveals: number;
  claims: number;
  seams: number;
}

/** The answer to `open`: a problem's map, with each piece's kind, grade and counts, and no briefs. */
export interface ProblemMap {
  op: 'open';
  problem: string;
  link: string;
  title: string;
  done_when: string;
  slug: string;
  owner: string;
  owner_name: string | null;
  tracker: string | null;
  complete: boolean;
  superseded: string | null;
  hidden: { by: string; why: string; at: string } | null;
  seeders: number;
  seeding: boolean;
  gold: { committed: number; pending: number; verified: number; missed: number } | null;
  readers: number;
  vendors: string[];
  pieces: PieceRow[];
}

/** The answer to `hot` and to `follow`: the keys this person follows, each with its standing. */
export interface Hot {
  op: 'hot';
  keys: { key: string; name: string | null; since: string; standing: number | null }[];
}

/** The answer to `library`: what this home keeps and serves, names and counts, with no gold answer in it. */
export interface Lib {
  op: 'library';
  problems: Record<
    string,
    { title: string; slug: string; trackers: string[]; first: string; last: string; next?: string; link: string }
  >;
  pieces: Record<
    string,
    { problem: string; name: string; when: string; what: 'claimed' | 'returned'; verifier?: string }
  >;
  seeding: Record<string, string>;
  gold: Record<string, { committed: number; revealed: number }>;
  serving: { problems: number; ledgers: number; blobs: number; bytes: number };
  queued: number;
}

/** The answer to `me`: who this client is, with its standing and coin and the phrase templates. */
export interface Me {
  op: 'me';
  address: string | null;
  name: string | null;
  model: string;
  trackers: string[];
  relays: string[];
  queued: number;
  problems: number;
  standing: { tracker: string; standing: number; locked: number; free: number } | null;
  coin: { balance: number; free: number; home: string } | null;
  witness: string | null;
  /** The person's own phrases, each with {link} where a problem's link goes. */
  phrases: Record<string, string>;
}

/** The answer to `totals`: the swarm counted once per problem, with what each tracker lists. */
export interface Totals {
  op: 'totals';
  problems: number;
  pieces: number;
  counts: Record<string, number>;
  trackers: { tracker: string; problems: number | null }[];
}

/** The phrase templates alone, for the card on a site, where there is no person to be. */
export interface Phrases {
  op: 'phrases';
  phrases: Record<string, string>;
}

/** What the tool that showed this card handed it: who the client is and what to open on. No one's words. */
export interface Handle {
  address?: string | null;
  name?: string | null;
  trackers?: string[];
  host?: string | null;
  view?: string;
  query?: string | null;
  link?: string | null;
}

/**
 * One piece on the page's map (page.ts, /api/open): the kind in this client's own words, never null, what the piece
 * needs, and whether this key's gold on it is committed and due.
 */
export interface PagePiece extends MapPiece {
  kind: string;
  strength: string;
  says: string;
  requires: string[];
  mine_gold: boolean;
  gold_due: boolean;
}

/** An answer of the reader, one per op; `follow` answers as `hot` does. */
export type WindowAnswer = Searched | ProblemMap | Lib | Hot | Me | Totals | Phrases;
