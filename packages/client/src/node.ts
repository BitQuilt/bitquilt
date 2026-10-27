/**
 * One node per home. Claude Desktop starts a copy of quilt for its connector; the menu-bar app starts one for the page;
 * a person runs `quilt serve`. Two of them over one home would sign with one key from two processes and write one
 * library from both. So a copy that starts asks the page's port whether a node that signs with this home's key is
 * already there: if so, its tools run through that node (POST /api/tool/<name>), and it holds no page of its own; if
 * not, or when that node goes away, it works alone as before. A node on the port with another key is another home's,
 * and this copy works alone without the page.
 */
import { type Address, withSlash } from '@bitquilt/core';
import { type ToolInput, type ToolName, type ToolResult, type ToolRunner } from './tools.js';

export type NodeProbe = { found: 'mine' } | { found: 'other'; address: string | null } | { found: 'none' };

/** Whether a node answers on the port, and whether it signs with this address. A tracker or anything else there is 'other'. */
export async function probeNode(port: number, address: Address | null, fetchImpl: typeof fetch = fetch): Promise<NodeProbe> {
  try {
    const r = await fetchImpl(`http://127.0.0.1:${port}/api/me`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { found: 'other', address: null };
    const me = (await r.json()) as { address?: string | null };
    if (typeof me !== 'object' || me === null || !('address' in me)) return { found: 'other', address: null };
    const theirs = me.address ?? null;
    return address !== null && theirs === address ? { found: 'mine' } : { found: 'other', address: theirs };
  } catch {
    return { found: 'none' };
  }
}

/** A fetch that never reached the node: the connection refused or reset, or nothing listening. A tool's own error is not one. */
function unreachable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const code = (err.cause as { code?: string } | undefined)?.code ?? '';
  return err.message === 'fetch failed' || /ECONNREFUSED|ECONNRESET|EPIPE|ENOTFOUND/.test(code);
}

/**
 * The runner for a copy working through the node at `url`. The first call that finds the node gone switches to the
 * runner `alone` makes, for good: the node's page and key are then this copy's own until it exits.
 */
export function remoteRunner(url: string, alone: () => ToolRunner, fetchImpl: typeof fetch = fetch, log: (s: string) => void = () => {}): ToolRunner {
  const base = withSlash(url);
  let own: ToolRunner | null = null;
  return async (name: ToolName, input: ToolInput, host: string | undefined): Promise<ToolResult> => {
    if (own) return own(name, input, host);
    let r: Response;
    try {
      r = await fetchImpl(`${base}api/tool/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input, host: host ?? null }), signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      if (!unreachable(err)) throw err;
      log(`the node at ${base} went away; this copy works alone from here`);
      own = alone();
      return own(name, input, host);
    }
    const body = (await r.json()) as ToolResult & { error?: string };
    if (!r.ok) throw new Error(body.error ?? `the node answered ${r.status}`);
    return { text: body.text, handles: body.handles ?? {} };
  };
}
