/**
 * The directory window (APP.md, "The window"): the Napster-like view the connector serves as an MCP app, one HTML
 * document at a ui:// resource a host shows beside a tool result, and the reader behind it. The document is built by
 * scripts/build-window.mjs into window.generated.ts from packages/client/window. Its address carries the hash of its
 * text, since a host keeps a card by its address and a changed card must have a new one; the plain address stays
 * served for results from before. The card draws everything from `windowAnswer`, reached through the app-only tool
 * `quilt_window_io` over the same session, so the server knows who asks and the card loads nothing from anywhere
 * else; what the card hands the person's AI is one of the person's own phrases (phrases.ts) with a link filled in,
 * never anyone else's words. The model-visible tools' structuredContent is unchanged: the owners' titles the reader
 * returns are data for the card, as the page shows them, and the same words quilt_search quotes.
 */
import { createHash } from 'node:crypto';
import { makeLink } from './link.js';
import { say } from './phrases.js';
import { inParallel } from './pool.js';
import type { Quilt } from './quilt.js';
import { askJson } from './resolver.js';
import { WINDOW_HTML } from './window.generated.js';

export const WINDOW_URI = 'ui://quilt/window.html';
/** This build of the card, by its content. */
export const WINDOW_HASH = createHash('sha256').update(WINDOW_HTML).digest('hex').slice(0, 10);
export const WINDOW_URI_NOW = `ui://quilt/window.${WINDOW_HASH}.html`;
/** What the card may ask the reader for. */
export const WINDOW_OPS = ['search', 'me', 'totals'] as const;
export type WindowOp = (typeof WINDOW_OPS)[number];
/** The phrases the card's buttons hand the person's AI, each with `{link}` where a problem's link goes (phrases.ts). */
export const WINDOW_PHRASES = ['open_problem', 'take_piece', 'keep_problem', 'find_something_to_do', 'who_am_i'] as const;

/**
 * The reader: one op, one JSON answer, small enough for a card (a result over about 150,000 characters never reaches
 * one). `search` is `Quilt.search` with a quilt: link on each row, so the card fills a phrase with it; `me` is who this
 * client is, with its standing and coin and the phrase templates; `totals` sums each tracker's index.
 */
export async function windowAnswer(quilt: Quilt, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const op = String(input.op ?? '');
  switch (op) {
    case 'search': {
      const query = typeof input.query === 'string' ? input.query.slice(0, 200) : '';
      const found = await quilt.search(query);
      return { op, query, rows: found.map((p) => ({ ...p, link: makeLink(p.problem, p.via === 'tracker' ? [p.tracker] : [], p.slug) })) };
    }
    case 'me': {
      const me = quilt.me();
      const [standing, coin] = await Promise.all([quilt.standing(), quilt.coin()]);
      const phrases = Object.fromEntries(WINDOW_PHRASES.map((name) => [name, say(name, { link: '{link}' })]));
      return { op, address: me.address, name: me.name, model: me.model, trackers: me.trackers, relays: me.relays, queued: me.queued, problems: me.problems, standing, coin, witness: me.witness?.via ?? null, phrases };
    }
    case 'totals': {
      const trackers = await inParallel(quilt.config.trackers, 4, async (tracker) => {
        const index = await askJson<{ problems?: { pieces?: number; counts?: Record<string, number> }[] }>(`${tracker}search?q=`);
        const rows = index?.problems ?? null;
        const counts: Record<string, number> = {};
        for (const r of rows ?? []) for (const [k, n] of Object.entries(r.counts ?? {})) counts[k] = (counts[k] ?? 0) + n;
        return { tracker, problems: rows ? rows.length : null, pieces: (rows ?? []).reduce((n, r) => n + (r.pieces ?? 0), 0), counts };
      });
      return { op, trackers };
    }
    default:
      throw new Error(`op: one of ${WINDOW_OPS.join(', ')}`);
  }
}
