import { WebSocketServer, type WebSocket } from 'ws';

/**
 * A relay for the tests: the slice of NIP-01 the client uses. EVENT stores (one per key, kind and `d`, the latest
 * winning) and answers OK; REQ answers the matching events then EOSE; CLOSE is ignored. Nothing is verified here:
 * the client's reading of what comes back is what the tests hold.
 */
interface Ev { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string }

export async function startRelay(): Promise<{ url: string; events: Map<string, Ev>; close(): Promise<void> }> {
  const events = new Map<string, Ev>();
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
        const f = (msg[2] ?? {}) as { kinds?: number[]; limit?: number; '#d'?: string[]; '#t'?: string[] };
        let list = [...events.values()];
        if (f.kinds) list = list.filter((e) => f.kinds!.includes(e.kind));
        if (f['#d']) list = list.filter((e) => e.tags.some((t) => t[0] === 'd' && f['#d']!.includes(t[1]!)));
        if (f['#t']) list = list.filter((e) => e.tags.some((t) => t[0] === 't' && f['#t']!.includes(t[1]!)));
        list.sort((a, b) => b.created_at - a.created_at);
        for (const e of list.slice(0, f.limit ?? 100)) ws.send(JSON.stringify(['EVENT', sub, e]));
        ws.send(JSON.stringify(['EOSE', sub]));
      }
    });
  });
  await new Promise<void>((r) => wss.once('listening', r));
  const a = wss.address();
  const port = typeof a === 'object' && a ? a.port : 0;
  return { url: `ws://127.0.0.1:${port}`, events, close: () => new Promise<void>((r) => wss.close(() => r())) };
}
