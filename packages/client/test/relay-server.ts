import { WebSocketServer, type WebSocket } from 'ws';

/**
 * A relay for the tests: the slice of NIP-01 the client uses. EVENT stores (one per key, kind and `d`, the latest
 * winning) and answers OK; REQ answers the events matching any of its filters, then EOSE; CLOSE is ignored. Nothing
 * is verified here: the client's reading of what comes back is what the tests hold. `requests` keeps every REQ's
 * filters, so a test can see what the client asked; with `holdEose` the relay sends its events and never the EOSE, as
 * a slow relay does past a client's deadline.
 */
interface Ev { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }
type Filter = { kinds?: number[]; limit?: number; '#d'?: string[]; '#t'?: string[] };

export async function startRelay(options: { holdEose?: boolean } = {}): Promise<{ url: string; events: Map<string, Ev>; requests: Filter[][]; close(): Promise<void> }> {
  const events = new Map<string, Ev>();
  const requests: Filter[][] = [];
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', (data) => {
      let msg: unknown[];
      try {
        msg = JSON.parse(String(data)) as unknown[];
      } catch {
        return;
      }
      if (msg[0] === 'EVENT') {
        const ev = msg[1] as Ev;
        const d = ev.tags.find((t) => t[0] === 'd')?.[1] ?? '';
        const k = `${ev.pubkey}:${ev.kind}:${d}`;
        const have = events.get(k);
        if (!have || have.created_at <= ev.created_at) events.set(k, ev);
        ws.send(JSON.stringify(['OK', ev.id, true, '']));
      } else if (msg[0] === 'REQ') {
        const sub = msg[1] as string;
        const filters = msg.slice(2) as Filter[];
        requests.push(filters);
        const matches = (e: Ev, f: Filter): boolean =>
          (!f.kinds || f.kinds.includes(e.kind))
          && (!f['#d'] || e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1]!)))
          && (!f['#t'] || e.tags.some((t) => t[0] === 't' && f['#t']!.includes(t[1]!)));
        const sent = new Set<string>();
        for (const f of filters.length ? filters : [{}]) {
          const list = [...events.values()].filter((e) => matches(e, f)).sort((a, b) => b.created_at - a.created_at).slice(0, f.limit ?? 100);
          for (const e of list) {
            if (sent.has(e.id)) continue;
            sent.add(e.id);
            ws.send(JSON.stringify(['EVENT', sub, e]));
          }
        }
        if (!options.holdEose) ws.send(JSON.stringify(['EOSE', sub]));
      }
    });
  });
  await new Promise<void>((r) => wss.once('listening', r));
  const a = wss.address();
  const port = typeof a === 'object' && a ? a.port : 0;
  return { url: `ws://127.0.0.1:${port}`, events, requests, close: () => new Promise<void>((r) => wss.close(() => r())) };
}
