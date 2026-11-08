/**
 * What the tracker's door answers with (PROTOCOL.md, The tracker): a refusal, which `handle` writes as `{ error }` with
 * its status, and the JSON writer the door's JSON answers go through. The hosted on-ramp and its authorization server
 * write the JSON answers of their own routes with the same writer and keep their own body readers, since each caps and
 * parses a body its own way. An answer the writer does not write is written where it is made: a page of a chain's
 * lines, the preflight, a blob's bytes, one of the on-ramp's pages, or the connector's JSON-RPC, which the MCP SDK's
 * transport writes, and the on-ramp in the transport's form for a body that is not JSON at a session's start.
 */
import type { ServerResponse } from 'node:http';

/**
 * What the door answers a request with when it refuses: a status and one sentence saying why, which `handle` writes as
 * `{ error }`.
 */
export class Refusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** A JSON answer that any origin may read; `headers` add to the two written first, or replace them. */
export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    ...headers,
  });
  res.end(text);
}
