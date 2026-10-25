/**
 * The page on localhost and the node: one HTTP server that serves Quilt's page, a small API the page talks to and
 * nothing else does, and read-only mirror routes for what this node holds in its cache, so another client can resolve a
 * hash from here. The page sets text with textContent, loads nothing from another server, and has no free-text box
 * beyond its forms.
 */
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Hash, IDENTITY_LOG, isHash } from '@bitquilt/core';
import type { Resolver } from './resolver.js';
import type { Pattern, Quilt } from './worker.js';

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

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export interface PageOptions {
  quilt: Quilt;
  /** The person at the page hands in as a person: the same key, model `human`, capability `person`. */
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
      if (path === '/' && method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self'" });
        res.end(html);
        return;
      }
      if (path === '/api/me') return json(res, 200, quilt.me());
      if (path === '/api/search') return json(res, 200, { problems: await quilt.search(u.searchParams.get('q') ?? '') });
      if (path === '/api/open') {
        const { hash, state, tracker } = await quilt.open(u.searchParams.get('link') ?? '');
        return json(res, 200, {
          problem: hash, tracker, title: state.envelope.problem.title, done_when: state.envelope.problem.done_when, owner: state.envelope.problem.owner, complete: state.complete,
          pieces: state.pieces.map((v) => ({ name: v.piece.name, hash: v.piece.hash, verifier: v.piece.verifier, state: v.state, requires: v.piece.requires })),
          accepted: quilt.acceptedText(state), summary: quilt.summary(hash, state, tracker),
        });
      }
      if (path === '/api/library') return json(res, 200, quilt.library);
      if (path === '/api/next' && method === 'GET') {
        const { hash, pick, posted, author } = await person.next(u.searchParams.get('problem') ?? '');
        return json(res, 200, { problem: hash, piece: pick.piece.hash, name: pick.piece.name, brief: pick.brief, author, schema: pick.schema ?? null, agree: pick.agree, requires: pick.requires, lease_h: pick.lease_h, posted });
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
      if (path === '/.well-known/quilt') return json(res, 200, { quilt: 1, node: true, identity: IDENTITY_LOG, routes: ['/p/<hash>', '/p/<hash>/events', '/b/<hash>'] });
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
        return e ? json(res, 200, e) : json(res, 404, { error: 'not held here' });
      }
      if ((m = /^\/b\/(sha256:[0-9a-f]{64})$/.exec(path)) && method === 'GET' && isHash(m[1])) {
        const b = resolver.cachedBlob(m[1] as Hash);
        if (!b) return json(res, 404, { error: 'not held here' });
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
    return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
  }

  return { handle, listen };
}
