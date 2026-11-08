/**
 * What the tracker's door answers with (PROTOCOL.md, The tracker): a refusal, which `handle` writes as `{ error }` with
 * its status, and the JSON writer every JSON answer goes through. The hosted on-ramp and its authorization server write
 * their JSON answers with the same writer and keep their own body readers, since each caps and parses a body its own
 * way. An answer that is not JSON, such as a page of a chain's lines, the preflight, a blob's bytes or one of the
 * on-ramp's pages, is written by its own route.
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
