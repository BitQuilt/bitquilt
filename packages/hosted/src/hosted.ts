/**
 * The hosted on-ramp (PROTOCOL.md, Identity; APP.md, Three things in one process): for a person who cannot run
 * anything, a tracker makes a root key, holds it encrypted at rest, and mounts Quilt's connector at an address they
 * paste into their AI. Every receipt for its events says custody: hosted, so a reader can tell. The key is theirs:
 * they can fetch it with their address and move it into a Quilt of their own.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { type Address, addressOf, randomSecretKey, secretFromHex, secretToHex } from '@bitquilt/core';
import type { Store } from '@bitquilt/tracker';
import { type Config, DEFAULT_CONFIG, Quilt, Resolver, createMcpServer, localRunner } from 'quilt';

export interface HostedOptions {
  store: Store;
  /** The tracker's own address, which the connector posts to and which addresses are made from; a function when it is known only once the tracker listens. */
  trackerUrl: string | (() => string);
  /** The secret the keys are encrypted with at rest; from the environment, never from code. */
  keySecret: string;
  /** A folder for each member's cache, library and queue. */
  home: string;
  /** The secret the tracker recognises as its own connector's, so it marks custody. */
  custodySecret: string;
  /** How many addresses an address may be handed out to per hour, per network address. */
  joinsPerHour?: number;
  now?: () => string;
  fetchImpl?: typeof fetch;
}

export interface Hosted {
  routes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean>;
  join(): { token: string; address: Address; url: string };
  sessions(): number;
}

const SESSION_IDLE_MS = 60 * 60 * 1000;

function encrypt(keySecret: string, plain: string): string {
  const key = createHash('sha256').update(keySecret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${enc.toString('hex')}`;
}

function decrypt(keySecret: string, stored: string): string {
  const key = createHash('sha256').update(keySecret).digest();
  const [ivHex, tagHex, encHex] = stored.split('.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex!, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex!, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex!, 'hex')), decipher.final()]).toString('utf8');
}

const tokenHash = (token: string): string => createHash('sha256').update(token).digest('hex');

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

const JOIN_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>An address on this tracker</title>
<style>body{margin:0;font:17px/1.5 system-ui,sans-serif;background:#eef0f3;color:#17213a}main{max-width:620px;margin:0 auto;padding:40px 16px}button{font:inherit;padding:10px 18px;border-radius:6px;border:1.5px solid #2b3f7a;background:#2b3f7a;color:#fff;cursor:pointer}code{font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere}pre{background:#e3e6eb;padding:12px;border-radius:6px;white-space:pre-wrap;word-break:break-all}.q{color:#4a546b}</style></head>
<body><main><h1>An address on this tracker</h1>
<p>For a person who cannot run Quilt. This tracker makes a key, keeps it encrypted, and signs for you until you take the key home. Every event it writes for you says so.</p>
<p><button id="go">Make me an address</button></p>
<div id="out" hidden><p>Your address, to paste into your AI's connectors:</p><pre id="url"></pre><p>Your key's public address: <code id="addr"></code></p><p class="q">The address above is the key to your key. Anyone who has it can act as you here. To take the key home, open the address with <code>/key</code> after it, once, and import the secret into Quilt.</p></div>
<p id="err" class="q" hidden></p>
<script>document.getElementById('go').addEventListener('click',function(){fetch('/join',{method:'POST'}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||r.status);return j;});}).then(function(j){document.getElementById('url').textContent=j.url;document.getElementById('addr').textContent=j.address;document.getElementById('out').hidden=false;}).catch(function(e){var p=document.getElementById('err');p.textContent=e.message;p.hidden=false;});});</script>
</main></body></html>`;

export function createHosted(options: HostedOptions): Hosted {
  const { store, keySecret, custodySecret } = options;
  const trackerUrl = (): string => {
    const u = typeof options.trackerUrl === 'function' ? options.trackerUrl() : options.trackerUrl;
    return u.endsWith('/') ? u : `${u}/`;
  };
  const now = options.now ?? (() => new Date().toISOString());
  const joinsPerHour = options.joinsPerHour ?? 20;
  mkdirSync(options.home, { recursive: true });
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; token: string; last: number }>();

  function mint(): { token: string; address: Address; url: string } {
    const token = randomBytes(32).toString('hex');
    const secret = randomSecretKey();
    const address = addressOf(secret);
    store.putMember(tokenHash(token), address, encrypt(keySecret, secretToHex(secret)), now());
    return { token, address, url: `${trackerUrl()}mcp/${token}` };
  }

  function quiltFor(token: string, hostName: string | undefined): Quilt | null {
    const member = store.getMember(tokenHash(token));
    if (!member) return null;
    const secret = secretFromHex(decrypt(keySecret, member.keyEnc));
    const config: Config = { ...DEFAULT_CONFIG, trackers: [trackerUrl()], can: ['web'], ...(member.name ? { name: member.name } : {}) };
    const home = join(options.home, tokenHash(token));
    const resolver = new Resolver(config, home, options.fetchImpl ?? fetch, { 'x-quilt-custody': custodySecret });
    return new Quilt(config, { secret, address: addressOf(secret) }, resolver, hostName);
  }

  function sweep(): void {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    for (const [id, s] of sessions) if (s.last < cutoff) {
      sessions.delete(id);
      void s.transport.close().catch(() => undefined);
    }
  }

  async function mcp(req: IncomingMessage, res: ServerResponse, token: string): Promise<void> {
    if (!store.getMember(tokenHash(token))) {
      json(res, 404, { error: 'no such address here' });
      return;
    }
    sweep();
    const sid = req.headers['mcp-session-id'];
    const sessionId = Array.isArray(sid) ? sid[0] : sid;
    const method = req.method ?? 'GET';
    if (sessionId && sessions.has(sessionId)) {
      const s = sessions.get(sessionId)!;
      if (s.token !== token) {
        json(res, 403, { error: 'that session belongs to another address' });
        return;
      }
      s.last = Date.now();
      const body = method === 'POST' ? await readJson(req) : undefined;
      await s.transport.handleRequest(req, res, body);
      return;
    }
    if (method !== 'POST') {
      json(res, 400, { error: 'a session begins with an initialize request' });
      return;
    }
    const body = await readJson(req);
    if (!isInitializeRequest(body)) {
      json(res, 400, { error: 'no session with that id; begin with an initialize request' });
      return;
    }
    let transport: StreamableHTTPServerTransport;
    let server: McpServer;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id: string) => {
        sessions.set(id, { transport, server, token, last: Date.now() });
      },
    });
    server = createMcpServer(localRunner((hostName) => {
      const q = quiltFor(token, hostName);
      if (!q) throw new Error('this address is gone');
      return q;
    }));
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function routes(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method ?? 'GET';
    if (path === '/join') {
      if (method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(JOIN_PAGE);
        return true;
      }
      if (method === 'POST') {
        const fwd = req.headers['x-forwarded-for'];
        const ip = (Array.isArray(fwd) ? fwd[0] : fwd?.split(',')[0]) ?? req.socket.remoteAddress ?? 'unknown';
        const bucket = `join:${createHash('sha256').update(custodySecret + ip.trim()).digest('hex').slice(0, 16)}`;
        if (store.hit(bucket, now().slice(0, 13), joinsPerHour)) {
          json(res, 429, { error: 'over the hour\'s limit for new addresses from here' });
          return true;
        }
        const made = mint();
        json(res, 201, { address: made.address, url: made.url });
        return true;
      }
    }
    let m: RegExpExecArray | null;
    if ((m = /^\/mcp\/([0-9a-f]{64})(?:\/(key))?$/.exec(path))) {
      const token = m[1]!;
      if (m[2] === 'key') {
        if (method !== 'GET') {
          json(res, 405, { error: 'GET' });
          return true;
        }
        const member = store.getMember(tokenHash(token));
        if (!member) {
          json(res, 404, { error: 'no such address here' });
          return true;
        }
        json(res, 200, { address: member.address, secret: decrypt(keySecret, member.keyEnc), note: 'This is the key itself. Import it into Quilt with quilt init --secret, and treat this address as spent.' });
        return true;
      }
      await mcp(req, res, token);
      return true;
    }
    return false;
  }

  return { routes, join: mint, sessions: () => sessions.size };
}
