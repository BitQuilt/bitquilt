/**
 * The directory window (APP.md, "The window"): the Napster-like view the connector serves as an MCP app, one HTML
 * document at a ui:// resource a host shows beside a tool result, and the reader behind it. The document is built by
 * scripts/build-window.mjs into window.generated.ts from packages/client/window. Its address carries the hash of its
 * text, since a host keeps a card by its address and a changed card must have a new one; the plain address stays
 * served for results from before. The card draws everything from `windowAnswer`, reached through the app-only tool
 * `quilt_window_io` over the same session, so the server knows who asks and the card loads nothing from anywhere
 * else; what the card hands the person's AI is one of the person's own phrases (phrases.ts) with a link filled in,
 * never anyone else's words. The model-visible tools' structuredContent is unchanged: the owners' titles the reader
 * returns are data for the card, as the page shows them, and the same words quilt_search and quilt_open quote. What
 * the reader answers is declared once, in window-answers.ts, which the card imports as types alone.
 */
import { createHash } from 'node:crypto';
import { type Address, type Hash, isAddress } from '@bitquilt/core';
import { makeLink } from './link.js';
import { say } from './phrases.js';
import { inParallel } from './pool.js';
import type { Quilt } from './quilt.js';
import { inheritedOf, kindWords, layerByHash, nameOf } from './render.js';
import { type Library, publicLibrary } from './library.js';
import { askJson } from './resolver.js';
import type { Hot, WindowAnswer } from './window-answers.js';
import { WINDOW_HTML } from './window.generated.js';

export const WINDOW_URI = 'ui://quilt/window.html';
/** This build of the card, by its content. */
export const WINDOW_HASH = createHash('sha256').update(WINDOW_HTML).digest('hex').slice(0, 10);
export const WINDOW_URI_NOW = `ui://quilt/window.${WINDOW_HASH}.html`;
/** What the card may ask the reader for. */
export const WINDOW_OPS = ['search', 'open', 'library', 'hot', 'follow', 'me', 'totals', 'phrases'] as const;
export type WindowOp = (typeof WINDOW_OPS)[number];
/**
 * What a reader with no person behind it answers, the on-ramp's `/window/io` for a site: nothing of a home, and nothing
 * written.
 */
export const WINDOW_READ_OPS: readonly WindowOp[] = ['search', 'open', 'totals', 'phrases'];
/** The phrases the card's buttons hand the person's AI, each with `{link}` where a problem's link goes (phrases.ts). */
export const WINDOW_PHRASES = [
  'open_problem',
  'take_piece',
  'keep_problem',
  'find_something_to_do',
  'who_am_i',
] as const;

/** The keys this person follows, as the card lists them: the hot list is a choice at the edge that no rule reads. */
async function hot(quilt: Quilt, library: Library): Promise<Hot> {
  const follows = Object.entries(library.follows ?? {});
  const standings = await inParallel(follows, 4, ([key]) => quilt.standingOf(key as Address).catch(() => null));
  return {
    op: 'hot',
    keys: follows.map(([key, f], i) => ({
      key,
      name: f.name ?? null,
      since: f.since,
      standing: standings[i]?.standing ?? null,
    })),
  };
}

/**
 * The reader: one op, one JSON answer, small enough for a card (a result over about 150,000 characters never reaches
 * one). `search` is `Quilt.search` with a quilt: link on each row, so the card fills a phrase with it; `open` is a
 * problem's map as the tracker's layer holds it, with each piece's kind, grade and how many have read it, and no
 * briefs; `library` is what the home keeps and serves, names and counts, with no gold answer in it; `hot` is the keys
 * this person follows and `follow` adds or drops one; `me` is who this client is, with its standing and coin and the
 * phrase templates; `totals` is the swarm counted once per problem, by hash, over every tracker's index, with what each
 * tracker lists; `phrases` is the phrase templates alone, for the card on a site, where there is no person to be.
 */
const phrasesOf = (): Record<string, string> =>
  Object.fromEntries(WINDOW_PHRASES.map((name) => [name, say(name, { link: '{link}' })]));

export async function windowAnswer(quilt: Quilt, input: Record<string, unknown>): Promise<WindowAnswer> {
  const op = String(input.op ?? '');
  const str = (k: string): string => (typeof input[k] === 'string' ? (input[k] as string) : '');
  switch (op) {
    case 'search': {
      const query = str('query').slice(0, 200);
      const found = await quilt.search(query);
      return {
        op,
        query,
        rows: found.map((p) => ({ ...p, link: makeLink(p.problem, p.via === 'tracker' ? [p.tracker] : [], p.slug) })),
      };
    }
    case 'open': {
      const { hash, state, tracker, layer, hidden, gold, scrape, superseded } = await quilt.open(str('link'));
      const over = layerByHash(layer);
      const p = state.envelope.problem;
      const roots = new Set<string>();
      const vendors = new Set<string>();
      for (const v of state.pieces)
        for (const r of v.reveals) {
          roots.add(r.root);
          vendors.add(r.vendor);
        }
      const pieces = state.pieces.map((v) => {
        const l = over.get(v.piece.hash);
        const k = kindWords(v.piece.verifier);
        return {
          hash: v.piece.hash,
          name: v.piece.name,
          verifier: v.piece.verifier,
          kind: l?.kind ?? k.kind,
          strength: l?.strength ?? k.strength,
          weakest: l?.weakest ?? k.weakest,
          attested: l?.attested ?? false,
          state: l?.state ?? v.state,
          core: v.state,
          stake: l?.stake ?? 0,
          gold: l?.gold ?? null,
          verified: l?.verified ?? false,
          inherited: inheritedOf(l),
          traced: l?.traced ?? null,
          traces: l?.traces ?? 0,
          reveals: v.reveals.length,
          claims: v.claims.length,
          seams: l?.seams?.length ?? 0,
        };
      });
      const owner = nameOf(state, p.owner);
      return {
        op,
        problem: hash,
        link: makeLink(hash, tracker ? [tracker] : [], p.slug),
        title: p.title,
        done_when: p.done_when,
        slug: p.slug,
        owner: p.owner,
        owner_name: owner === p.owner ? null : owner,
        tracker,
        complete: state.complete,
        superseded,
        hidden: hidden ? { by: hidden.by, why: hidden.why, at: hidden.at } : null,
        seeders: scrape?.seeders ?? 0,
        seeding: Boolean(quilt.library.seeding[hash]),
        gold,
        readers: roots.size,
        vendors: [...vendors].sort(),
        pieces,
      };
    }
    case 'library': {
      const lib = publicLibrary(quilt.library, quilt.resolver.serving());
      // Each problem with its link, so the card fills a phrase with it, as the page's search does.
      const problems = Object.fromEntries(
        Object.entries(lib.problems).map(([h, e]) => [h, { ...e, link: makeLink(h as Hash, e.trackers, e.slug) }]),
      );
      return { op, ...lib, problems, queued: quilt.resolver.queued() };
    }
    case 'hot':
      return hot(quilt, quilt.library);
    case 'follow': {
      const key = str('key');
      if (!isAddress(key)) throw new Error('key: an address');
      const name = str('name').slice(0, 60);
      await quilt.follow(key, input.on !== false, name || null);
      return hot(quilt, quilt.library);
    }
    case 'me': {
      const me = quilt.me();
      const [standing, coin] = await Promise.all([quilt.standing(), quilt.coin()]);
      return {
        op,
        address: me.address,
        name: me.name,
        model: me.model,
        trackers: me.trackers,
        relays: me.relays,
        queued: me.queued,
        problems: me.problems,
        standing,
        coin,
        witness: me.witness?.via ?? null,
        phrases: phrasesOf(),
      };
    }
    case 'phrases':
      return { op, phrases: phrasesOf() };
    case 'totals': {
      // Doors that fold each other hold the same problems (QX-21), so the swarm is counted once per problem, by hash,
      // over every tracker's index; where two differ on one, the row further along its chain is read. Each tracker says
      // how many it lists, or null where it gave no answer.
      type Row = { problem?: string; pieces?: number; counts?: Record<string, number>; head?: { seq?: number } | null };
      const indexes = await inParallel(quilt.config.trackers, 4, async (tracker) => ({
        tracker,
        rows:
          (await askJson<{ problems?: Row[] }>(`${tracker}search?q=`, 8000, quilt.resolver.fetchImpl))?.problems ??
          null,
      }));
      const byHash = new Map<string, Row>();
      for (const { rows } of indexes) {
        for (const r of rows ?? []) {
          if (!r.problem) continue;
          const had = byHash.get(r.problem);
          if (!had || (r.head?.seq ?? 0) > (had.head?.seq ?? 0)) byHash.set(r.problem, r);
        }
      }
      const counts: Record<string, number> = {};
      let pieces = 0;
      for (const r of byHash.values()) {
        pieces += r.pieces ?? 0;
        for (const [k, n] of Object.entries(r.counts ?? {})) counts[k] = (counts[k] ?? 0) + n;
      }
      return {
        op,
        problems: byHash.size,
        pieces,
        counts,
        trackers: indexes.map(({ tracker, rows }) => ({ tracker, problems: rows ? rows.length : null })),
      };
    }
    default:
      throw new Error(`op: one of ${WINDOW_OPS.join(', ')}`);
  }
}
