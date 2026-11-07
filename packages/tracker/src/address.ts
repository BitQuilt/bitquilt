/**
 * The network address a request came from, behind a proxy or not. A proxy writes the addresses it saw into
 * X-Forwarded-For, and anyone can write that header too, so it is believed only when the connection itself comes from
 * a proxy this tracker trusts, and then read from the right: the first address that is not a trusted proxy's is the
 * client. The rate-limit buckets count by it, and the hosted on-ramp's witness (QX-18) checks it against a product's
 * published ranges, so what counts as a trusted proxy is the deployment's word (`QUILT_TRUSTED_PROXIES`).
 */
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP, isIPv4, isIPv6 } from 'node:net';

/** What a tracker trusts unless told otherwise: the machine itself and the private networks a compose file or a host puts its proxy on. */
export const PRIVATE_RANGES: readonly string[] = [
  '127.0.0.0/8',
  '::1/128',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  'fc00::/7',
  'fe80::/10',
];

/** An address as the socket or a header gives it, in one form: an IPv4 address mapped into IPv6 is IPv4 again, and a zone is dropped. */
export function plainAddress(raw: string): string {
  let a = raw.trim();
  if (a.startsWith('[') && a.endsWith(']')) a = a.slice(1, -1);
  const zone = a.indexOf('%');
  if (zone >= 0) a = a.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(a);
  return mapped ? mapped[1]! : a;
}

/** A list of ranges (`a.b.c.d/n`, `x::/n`, or a single address) as one block list; a range that does not parse throws, naming it. */
export function rangesOf(cidrs: readonly string[]): BlockList {
  const list = new BlockList();
  for (const raw of cidrs) {
    const text = raw.trim();
    if (!text) continue;
    const slash = text.indexOf('/');
    const address = plainAddress(slash < 0 ? text : text.slice(0, slash));
    const family = isIPv4(address) ? 'ipv4' : isIPv6(address) ? 'ipv6' : null;
    if (!family) throw new Error(`not an address range: ${raw}`);
    if (slash < 0) {
      list.addAddress(address, family);
      continue;
    }
    const prefix = Number(text.slice(slash + 1));
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > (family === 'ipv4' ? 32 : 128))
      throw new Error(`not an address range: ${raw}`);
    list.addSubnet(address, prefix, family);
  }
  return list;
}

/** Whether an address is inside a block list; false for anything that is not an address. */
export function inRanges(list: BlockList, raw: string): boolean {
  const a = plainAddress(raw);
  return isIPv4(a) ? list.check(a, 'ipv4') : isIPv6(a) ? list.check(a, 'ipv6') : false;
}

/**
 * The client's address from the connection's peer and the X-Forwarded-For header. The header is read only when the
 * peer is a trusted proxy, and then from the right, past every trusted proxy, to the first address that is not one;
 * when every address in it is a proxy's, the leftmost is the client. An entry that is not an address ends the walk,
 * and the peer stands for the client.
 */
export function clientAddressOf(peer: string, forwardedFor: string | undefined, trusted: BlockList): string {
  const direct = plainAddress(peer);
  if (!forwardedFor || !inRanges(trusted, direct)) return direct;
  const hops = forwardedFor
    .split(',')
    .map(plainAddress)
    .filter((h) => h.length > 0);
  for (let i = hops.length - 1; i >= 0; i -= 1) {
    const hop = hops[i]!;
    if (!isIP(hop)) return direct;
    if (!inRanges(trusted, hop)) return hop;
  }
  return hops[0] ?? direct;
}

/** The client's address of a request, by the rule above. */
export function clientAddress(req: IncomingMessage, trusted: BlockList): string {
  const fwd = req.headers['x-forwarded-for'];
  return clientAddressOf(req.socket.remoteAddress ?? 'unknown', Array.isArray(fwd) ? fwd.join(',') : fwd, trusted);
}
