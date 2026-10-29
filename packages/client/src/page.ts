/**
 * The page on localhost and the node: one HTTP server that serves Quilt's page, a small API the page talks to and
 * nothing else does, and read-only mirror routes for what this node holds in its cache, so another client can resolve a
 * hash from here. The page sets text with textContent, loads nothing from another server, and has no free-text box
 * beyond its forms. The API answers the page and programs on this machine: a request a browser marks as coming from
 * another site is refused, since the page's key signs what the API is asked to, and only the node's own routes carry
 * the header that lets any site read them.
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Hash, IDENTITY_LOG, isHash } from '@bitquilt/core';
import { awayState, awaySwitch } from './away.js';
import { claudeDesktopConfigPath, claudeHasQuilt, claudeRunning, entryHere, installHere } from './install.js';
import { makeLink } from './link.js';
import { sheetOf } from './phrases.js';
import { type Pattern, Quilt } from './quilt.js';
import { goldText, kindWords, kindsText, layerByHash, stakeText } from './render.js';
import type { Resolver } from './resolver.js';
import { isToolName, runTool } from './tools.js';

/** The page's HTML: an asset of the single executable when this runs as one, else the file beside the source. */
function pageHtml(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sea = (globalThis as { process?: { getBuiltinModule?: (n: string) => { isSea(): boolean; getAsset(k: string, enc: string): string } } }).process?.getBuiltinModule?.('node:sea');
    if (sea?.isSea()) return sea.getAsset('index.html', 'utf8');
  } catch {
    /* not a single executable */
  }
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'page', 'index.html'), 'utf8');
}

function json(res: ServerResponse, status: number, body: unknown, anySite = false): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...(anySite ? { 'access-control-allow-origin': '*' } : {}) });
  res.end(JSON.stringify(body));
}

/** Whether a browser sent this from a page of another origin: an Origin not ours, or a Sec-Fetch-Site that is not same-origin. A program on this machine sends neither header. */
function fromAnotherSite(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  if (origin !== undefined && origin !== `http://${req.headers.host ?? ''}`) return true;
  return site !== undefined && site !== 'same-origin' && site !== 'none';
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export interface PageOptions {
  quilt: Quilt;
  /** The person at the page hands in as a person (`Quilt.asPerson`): the same key, model `human`, capability `person`. */
  person: Quilt;
  resolver: Resolver;
}

export function createPage(options: PageOptions): { handle(req: IncomingMessage, res: ServerResponse): Promise<void>; listen(port: number): Promise<Server> } {
  const { quilt, person, resolver } = options;
  const html = pageHtml();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const u = new URL(req.url ?? '/', 'http://localhost/');
      const path = u.pathname.replace(/\/+$/, '') || '/';
      const method = req.method ?? 'GET';
      if (path.startsWith('/api/') && fromAnotherSite(req)) return json(res, 403, { error: 'the page\'s API answers the page and programs on this machine, not another site' });
      if (path === '/' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'" });
        res.end(html);
        return;
      }
      if (path === '/api/me') return json(res, 200, quilt.me());
      if (path === '/api/standing') {
        // Unlike /api/me, which answers from memory so a probe (node.ts) can read it at once, this one asks the trackers.
        const [standing, coin] = await Promise.all([quilt.standing(), quilt.coin()]);
        return json(res, 200, { standing, coin });
      }
      // Each result with its link, so the menu bar can say a phrase about it (phrases.ts).
      if (path === '/api/search') return json(res, 200, { problems: (await quilt.search(u.searchParams.get('q') ?? '')).map((r) => ({ ...r, link: makeLink(r.problem, r.tracker ? [r.tracker] : [], r.slug) })) });
      if (path === '/api/open') {
        // Everything the problem tab draws, in one answer: the problem and its map, the lines said in the render module's words, the panels this person judges, who keeps it, and the forms to offer.
        const opened = await quilt.open(u.searchParams.get('link') ?? '');
        const { hash, state, tracker, layer, hidden, gold, scrape } = opened;
        const over = layerByHash(layer);
        // The judge panels this person sits on with a seat still live: the page offers a ranking form for each.
        const me = person.identity?.address ?? null;
        const judging = me === null ? [] : (await person.panels(hash, tracker)).filter((p) => p.outcome === 'open' && p.seats.some((s) => s.root === me && s.lapsed_at === null && !s.rank));
        // QX-16: the gold this key committed here, by piece, so the page can offer the reveal; QX-17: where the coin lives, so it can offer a pay.
        const mineGold = Object.keys(quilt.library.gold?.[hash] ?? {});
        const coin = tracker ? await quilt.coinAt(tracker) : null;
        return json(res, 200, {
          problem: hash, tracker, hidden, seeders: scrape?.seeders ?? 0, last_seeded: scrape?.last_seeded ?? null, seeding: Boolean(quilt.library.seeding[hash]), title: state.envelope.problem.title, done_when: state.envelope.problem.done_when, owner: state.envelope.problem.owner, complete: state.complete,
          pieces: state.pieces.map((v) => {
            const l = over.get(v.piece.hash);
            const k = kindWords(v.piece.verifier);
            return {
              name: v.piece.name, hash: v.piece.hash, verifier: v.piece.verifier, state: l?.state ?? v.state, core: v.state, requires: v.piece.requires, kind: k.kind, strength: k.strength, says: k.says, weakest: k.weakest, attested: l?.attested ?? false,
              stake: l?.stake ?? 0, gold: l?.gold ?? null, verified: l?.verified ?? false, mine_gold: mineGold.includes(v.piece.hash),
            };
          }),
          kinds: kindsText(state), stake: stakeText(layer), goldLine: goldText(layer, gold),
          judging: judging.map((p) => ({ piece: p.piece, name: p.name, verifier: p.verifier, majority: p.majority, panel: p.panel, candidates: p.candidates.map((c) => ({ digest: c.digest, return: c.return })) })),
          accepted: quilt.acceptedText(state, layer), summary: quilt.summary(hash, state, tracker, layer, hidden, gold), gold, coin,
        });
      }
      if (path === '/api/reveal' && method === 'POST') {
        const b = (await body(req)) as { problem: Hash; piece: Hash };
        return json(res, 200, await quilt.revealGold(b.problem, b.piece));
      }
      if (path === '/api/pay' && method === 'POST') {
        const b = (await body(req)) as { problem: Hash; amount: number; per_square: number };
        return json(res, 200, await quilt.pay(b.problem, Number(b.amount), Number(b.per_square)));
      }
      if (path === '/api/transfer' && method === 'POST') {
        const b = (await body(req)) as { to: `0x${string}`; amount: number };
        return json(res, 200, await quilt.transfer(b.to, Number(b.amount)));
      }
      if (path === '/api/redeem' && method === 'POST') {
        const b = (await body(req)) as { amount: number; to?: `0x${string}` };
        return json(res, 200, await quilt.redeem(Number(b.amount), b.to || undefined));
      }
      if (path === '/api/rank' && method === 'POST') {
        const b = (await body(req)) as { problem: Hash; piece: Hash; ranking: Hash[] };
        return json(res, 200, await person.rank(b.problem, b.piece, b.ranking));
      }
      if (path === '/api/words' && method === 'POST') {
        // The key's twelve words, kept at first use, shown this once: read and removed (resolver.ts, takeWords).
        return json(res, 200, { words: resolver.takeWords() });
      }
      if (path === '/api/library') return json(res, 200, quilt.library);
      if (path === '/api/attention') return json(res, 200, await person.attention());
      if (path === '/api/phrases') {
        // The sheet the menu bar draws (phrases.ts): the home's state, the first phrase to say, and the phrases for what this person keeps, has worked and is wanted for. The trackers are asked only once an AI has connected.
        const connected = quilt.identity !== null && quilt.library.connector !== undefined;
        const [attention, standing] = connected ? await Promise.all([person.attention().then((a) => a.items), quilt.standing().then((s) => s?.standing ?? null)]) : [[], null];
        const file = claudeDesktopConfigPath();
        return json(res, 200, sheetOf({ address: quilt.identity?.address ?? null, name: quilt.config.name ?? null, library: quilt.library, attention, standing, wordsDue: resolver.wordsDue(), claude: { installed: claudeHasQuilt(file), config: file, running: claudeRunning() } }));
      }
      if (path === '/api/connector' && method === 'POST') {
        // A copy of quilt working through this node says an AI has connected to it (bin.ts, mcp): the record moves the menu bar from the install instructions to the phrases.
        const b = (await body(req)) as { host?: string | null };
        resolver.sawConnector(typeof b.host === 'string' ? b.host : null);
        return json(res, 200, { connector: quilt.library.connector });
      }
      if (path === '/api/install' && method === 'POST') {
        // The menu bar's button: the connector written into Claude Desktop's config for this very program, as `quilt install claude` does; refused while Claude runs unless told to go ahead.
        const b = (await body(req)) as { anyway?: boolean };
        return json(res, 200, installHere(resolver.home, b.anyway === true));
      }
      if (path === '/api/away') {
        // The menu bar's switch (away.ts): what runs while the person is away, how it went, and the switch itself, which schedules this very program as `quilt away --install` does.
        const o = { home: resolver.home, env: process.env, entry: entryHere(resolver.home), quilt };
        if (method === 'POST') {
          const b = (await body(req)) as { on?: boolean; cap?: number };
          return json(res, 200, await awaySwitch({ ...o, on: typeof b.on === 'boolean' ? b.on : undefined, cap: typeof b.cap === 'number' ? b.cap : undefined }));
        }
        return json(res, 200, await awayState(o));
      }
      // The tools, for a second copy of quilt on this home that works through this node rather than beside it (node.ts). Each run is an AI's, and is recorded as the connector's latest.
      let tool: RegExpExecArray | null;
      if ((tool = /^\/api\/tool\/([a-z_]+)$/.exec(path)) && method === 'POST') {
        const name = tool[1] ?? '';
        if (!isToolName(name)) return json(res, 404, { error: 'no such tool' });
        const b = (await body(req)) as { input?: Record<string, unknown>; host?: string | null };
        const host = typeof b.host === 'string' ? b.host : null;
        resolver.sawConnector(host);
        const forHost = new Quilt(quilt.config, quilt.identity, quilt.resolver, host ?? undefined);
        return json(res, 200, await runTool(forHost, name, b.input ?? {}));
      }
      if (path === '/api/next' && method === 'GET') {
        const { hash, pick, posted, owner, stake, lock } = await person.next(u.searchParams.get('problem') ?? '');
        return json(res, 200, { problem: hash, piece: pick.piece.hash, name: pick.piece.name, verifier: pick.piece.verifier, kind: kindWords(pick.piece.verifier), brief: pick.brief, owner, schema: pick.schema ?? null, agree: pick.agree, requires: pick.requires, lease_h: pick.lease_h, posted, stake, lock });
      }
      if (path === '/api/seed' && method === 'POST') {
        const b = (await body(req)) as { problem: Hash; on: boolean };
        return json(res, 200, await quilt.seed(b.problem, b.on !== false));
      }
      if (path === '/api/return' && method === 'POST') {
        const b = (await body(req)) as { problem: Hash; piece: Hash; return: Record<string, unknown> };
        return json(res, 200, await person.return(b.problem, b.piece, b.return));
      }
      if (path === '/api/publish' && method === 'POST') {
        const b = (await body(req)) as Pattern;
        return json(res, 200, await quilt.publish(b));
      }
      if (path === '/api/flush' && method === 'POST') return json(res, 200, await resolver.flush());
      // The node: what this client holds, served to anyone who asks.
      if (path === '/.well-known/quilt') return json(res, 200, { quilt: 1, node: true, identity: IDENTITY_LOG, routes: ['/p/<hash>', '/p/<hash>/events', '/b/<hash>'] }, true);
      let m: RegExpExecArray | null;
      if ((m = /^\/p\/(sha256:[0-9a-f]{64})(?:\/(events))?$/.exec(path)) && method === 'GET') {
        const hash = m[1] as Hash;
        if (m[2] === 'events') {
          const lines = resolver.cachedReceipts(hash);
          res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'access-control-allow-origin': '*' });
          res.end(lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
          return;
        }
        const e = resolver.cachedEnvelope(hash);
        return e ? json(res, 200, e, true) : json(res, 404, { error: 'not held here' }, true);
      }
      if ((m = /^\/b\/(sha256:[0-9a-f]{64})$/.exec(path)) && method === 'GET' && isHash(m[1])) {
        const b = resolver.cachedBlob(m[1] as Hash);
        if (!b) return json(res, 404, { error: 'not held here' }, true);
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.end(Buffer.from(b));
        return;
      }
      json(res, 404, { error: 'no such route' });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
  }

  function listen(port: number): Promise<Server> {
    const server = createServer((req, res) => void handle(req, res));
    // A port already taken (a second copy of quilt, say) is this promise's rejection, never a crash of the process around it.
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        resolve(server);
      });
    });
  }

  return { handle, listen };
}
