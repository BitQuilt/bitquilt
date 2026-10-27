/**
 * The link (CORE.md section 8): `quilt:sha256:<hex>?dn=&tr=&mr=`, `quilt:<owner>/<slug>?tr=`, or a tracker's own
 * `https://<tracker>/p/sha256:<hex>`. A bare hash is a link with no hints.
 */
import { type Hash, isAddress, isHash, withSlash } from '@bitquilt/core';

// The trailing slash a tracker's address carries is the core's rule; it stays reachable from here for what imports it from the link module.
export { withSlash } from '@bitquilt/core';

export interface Link {
  hash?: Hash;
  owner?: string;
  slug?: string;
  name?: string;
  trackers: string[];
  mirrors: string[];
}

export function parseLink(input: string): Link {
  const s = input.trim();
  if (isHash(s)) return { hash: s, trackers: [], mirrors: [] };
  if (s.startsWith('quilt:')) {
    const rest = s.slice('quilt:'.length);
    const q = rest.indexOf('?');
    const head = q < 0 ? rest : rest.slice(0, q);
    const params = new URLSearchParams(q < 0 ? '' : rest.slice(q + 1));
    const link: Link = { trackers: params.getAll('tr').map(withSlash), mirrors: params.getAll('mr').map(withSlash) };
    const dn = params.get('dn');
    if (dn) link.name = dn;
    if (isHash(head)) link.hash = head;
    else {
      const m = /^(0x[0-9a-fA-F]{40})\/([a-z0-9-]{1,64})$/.exec(head);
      if (!m || !isAddress(m[1])) throw new Error('not a quilt link: a hash, or an owner and a slug');
      link.owner = m[1];
      link.slug = m[2]!;
    }
    return link;
  }
  if (/^https?:\/\//.test(s)) {
    const u = new URL(s);
    const m = /^\/p\/(sha256:[0-9a-f]{64})/.exec(u.pathname);
    if (m) return { hash: m[1] as Hash, trackers: [withSlash(u.origin + '/')], mirrors: [] };
    const n = /^\/n\/(0x[0-9a-fA-F]{40})\/([a-z0-9-]{1,64})$/.exec(u.pathname);
    if (n) return { owner: n[1]!, slug: n[2]!, trackers: [withSlash(u.origin + '/')], mirrors: [] };
  }
  throw new Error('not a quilt link');
}

/** A link for a problem, with the trackers it is known at. */
export function makeLink(hash: Hash, trackers: string[], name?: string, mirrors: string[] = []): string {
  const params = new URLSearchParams();
  if (name) params.set('dn', name);
  for (const t of trackers) params.append('tr', t);
  for (const m of mirrors) params.append('mr', m);
  const q = params.toString();
  return `quilt:${hash}${q ? `?${q}` : ''}`;
}
