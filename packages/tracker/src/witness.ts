/**
 * QX-18 at the tracker's door (docs/ext/QX-18.md, section 3): a post the hosted on-ramp made for a key it holds, known
 * by the custody secret, and the witness the on-ramp names on it, written beside custody in the receipt's wrapper and
 * listed by piece in a problem's state. The headers are read only on a post that carries the secret, and a mark that is
 * not well formed is left out. Their names are written here once, for the door that reads them and the on-ramp that
 * writes them with `custodyHeaders`. The client keeps its own copy of `WITNESS_VIA` in render.ts, since it cannot
 * import the tracker.
 */
import type { IncomingMessage } from 'node:http';
import { type Hash, problemHash, textIssues } from '@bitquilt/core';
import type { Store } from './store.js';

/** QX-18: a witness is a product's host name in lower case, or `other`. */
export const WITNESS_VIA = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;
/** QX-18: the most characters of a client's own name the receipt carries. */
export const CLIENT_NAME_MAX = 80;
/**
 * QX-18: how a product's mark was bound to the product: the token exchange came from its published addresses, or was
 * signed with its published key.
 */
export const WITNESS_BOUND_BY: readonly string[] = ['address', 'key'];
/** QX-18: what the wrapper of a hosted post carries beside custody, when the on-ramp named a witness. */
type Witnessed = { via?: string; via_by?: string; via_client?: string };
/**
 * QX-18 section 3: the headers a hosted post carries to its own door: the custody secret, then the witness, its
 * binding, and the client's own name, encoded.
 */
export const CUSTODY_HEADERS = {
  custody: 'x-quilt-custody',
  via: 'x-quilt-via',
  via_by: 'x-quilt-via-by',
  via_client: 'x-quilt-via-client',
} as const;

/**
 * QX-18: the headers the hosted on-ramp sends with a member's post to its own door, the custody secret and the
 * session's witness, which `hostedPost` and `witnessOf` read; the client's own name is encoded, since it is any text
 * that passed the gate. The witness is the client's, taken by its shape, since the tracker does not import the client.
 */
export function custodyHeaders(
  secret: string,
  w: { via: string; by?: string | null; client?: string | null } | null,
): Record<string, string> {
  if (!w) return { [CUSTODY_HEADERS.custody]: secret };
  return {
    [CUSTODY_HEADERS.custody]: secret,
    [CUSTODY_HEADERS.via]: w.via,
    ...(w.by ? { [CUSTODY_HEADERS.via_by]: w.by } : {}),
    ...(w.client ? { [CUSTODY_HEADERS.via_client]: encodeURIComponent(w.client) } : {}),
  };
}

/**
 * Whether a post was made by the connector mounted beside this tracker, for a key it holds: a seat this tracker
 * opened for a person.
 */
export function hostedPost(req: IncomingMessage, custodySecret: string | undefined): boolean {
  return custodySecret !== undefined && req.headers[CUSTODY_HEADERS.custody] === custodySecret;
}

/**
 * QX-18: the witness the hosted on-ramp names on a post it made, written beside custody: the product whose OAuth
 * callback the session's token came through, or `other` with the client's own name through the gate. Read only on a
 * post `hostedPost` recognised, so nobody else can set it; a mark that is not well formed is left out.
 */
export function witnessOf(req: IncomingMessage): Witnessed {
  const via = req.headers[CUSTODY_HEADERS.via];
  if (typeof via !== 'string' || via.length > 64 || !WITNESS_VIA.test(via)) return {};
  if (via !== 'other') {
    const by = req.headers[CUSTODY_HEADERS.via_by];
    return typeof by === 'string' && WITNESS_BOUND_BY.includes(by) ? { via, via_by: by } : { via };
  }
  const raw = req.headers[CUSTODY_HEADERS.via_client];
  let name: string | null = null;
  try {
    name = typeof raw === 'string' ? decodeURIComponent(raw).trim() : null;
  } catch {
    name = null;
  }
  return name && name.length <= CLIENT_NAME_MAX && textIssues(name).length === 0 ? { via, via_client: name } : { via };
}

/**
 * QX-18: the reveals on a problem's chain whose receipt names a witness, by piece: the key that revealed, the root it
 * counts for, the product or `other`, and the client's own name with `other`. The tracker's word, as custody is.
 */
export function witnessedReveals(
  store: Store,
  hash: Hash,
): Map<Hash, { key: string; via: string; via_by?: string; via_client?: string }[]> {
  const out = new Map<Hash, { key: string; via: string; via_by?: string; via_client?: string }[]>();
  for (const envelope of store.chain(hash))
    for (const r of store.witnessedReveals(problemHash(envelope))) {
      const w = r.received.find((x) => typeof (x as Witnessed).via === 'string') as Witnessed | undefined;
      if (!w?.via) continue;
      const list = out.get(r.piece) ?? [];
      list.push({
        key: r.key,
        via: w.via,
        ...(w.via_by ? { via_by: w.via_by } : {}),
        ...(w.via_client ? { via_client: w.via_client } : {}),
      });
      out.set(r.piece, list);
    }
  return out;
}
