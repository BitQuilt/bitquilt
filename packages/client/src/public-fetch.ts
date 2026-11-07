/**
 * A GET made on a stranger's word by a connector many people share (`QUILT_READS=public`, which the hosted binary
 * sets). Every connection is checked as it is made: a literal address before it is dialled, a name at the lookup the
 * connection itself uses, so a name cannot answer one address to the check and another to the socket. A redirect is
 * followed by hand, a few at most, and its hop is checked the same way. Nothing is pooled, so no connection made
 * without the check is reused. What is refused is the machine itself, the private and shared networks, link-local
 * addresses, the ranges set aside for documentation, tests and multicast, and the IPv6 forms that carry an IPv4
 * address inside them.
 */
import { type LookupAddress, lookup as dnsLookup } from 'node:dns';
import { type IncomingMessage, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, type LookupFunction, isIP } from 'node:net';
import { Readable, pipeline } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

/** The most redirects one GET follows. */
export const REDIRECTS_MAX = 5;

// One list for each family: a BlockList checks an IPv4 address against its IPv6 rules as the mapped form, which `::ffff:0:0/96` would refuse whole.
const BLOCKED4 = new BlockList();
const BLOCKED6 = new BlockList();
const V4: [string, number][] = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
// `::/96` holds the unspecified address, loopback and the old IPv4-compatible form; the rest carry IPv4 inside (mapped, NAT64, 6to4, Teredo) or are not public.
const V6: [string, number][] = [
  ['::', 96], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
];
for (const [net, prefix] of V4) BLOCKED4.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of V6) BLOCKED6.addSubnet(net, prefix, 'ipv6');

/** Whether an IP address is on the public internet, outside every range above. A name, or anything that is not an address, is not. */
export function publicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  try {
    return family === 4 ? !BLOCKED4.check(ip, 'ipv4') : !BLOCKED6.check(ip, 'ipv6');
  } catch {
    return false;
  }
}

/** A GET this connector will not make, with the reason in words a person reads. */
export class Refused extends Error {
  constructor(readonly why: string) {
    super(why);
  }
}
const PRIVATE = 'a private address, which this connector does not fetch';

/** The lookup a guarded connection dials through: every address the name answers is public, or the connection is refused. */
function guardedLookup(isPublic: (ip: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { family: options.family, hints: options.hints, all: true }, (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => {
      if (err) return callback(err, '');
      if (addresses.length === 0 || addresses.some((a) => !isPublic(a.address))) return callback(new Refused(PRIVATE), '');
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

function once(url: URL, accept: string, signal: AbortSignal, isPublic: (ip: string) => boolean): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && !isPublic(host)) return reject(new Refused(PRIVATE));
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(url, {
      method: 'GET', agent: false, lookup: guardedLookup(isPublic), signal,
      headers: { accept, 'accept-encoding': 'gzip, deflate, br', 'user-agent': 'quilt' },
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/** The response as a fetch Response, its body decoded as served and not yet read. */
function asResponse(res: IncomingMessage): Response {
  const status = res.statusCode ?? 0;
  if (status < 200 || status > 599) {
    res.destroy();
    throw new Refused(`the page answered ${status}`);
  }
  const headers = new Headers();
  for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) for (const one of Array.isArray(v) ? v : [v]) headers.append(k, one);
  if ([204, 205, 304].includes(status)) {
    res.destroy();
    return new Response(null, { status, headers });
  }
  const coding = (res.headers['content-encoding'] ?? '').trim().toLowerCase();
  const decoder = coding === 'gzip' || coding === 'x-gzip' ? createGunzip() : coding === 'deflate' ? createInflate() : coding === 'br' ? createBrotliDecompress() : null;
  if (decoder) {
    headers.delete('content-encoding');
    headers.delete('content-length');
  }
  const body: Readable = decoder ? pipeline(res, decoder, () => {}) : res;
  return new Response(Readable.toWeb(body) as unknown as ReadableStream<Uint8Array>, { status, statusText: res.statusMessage ?? '', headers });
}

/**
 * A GET of an http or https URL, refused at a private address on any hop, following at most REDIRECTS_MAX redirects.
 * Resolves to the last response with its body still to be read, so the caller holds it to a size; rejects with
 * `Refused`, or with the network's own error. `isPublic` is the check, the tests' way in.
 */
export async function publicGet(target: string, o: { accept: string; signal: AbortSignal }, isPublic: (ip: string) => boolean = publicAddress): Promise<Response> {
  let url = new URL(target);
  for (let hop = 0; ; hop++) {
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Refused('a redirect to something other than http or https');
    const res = await once(url, o.accept, o.signal, isPublic);
    const status = res.statusCode ?? 0;
    const location = res.headers.location;
    if (status < 300 || status > 399 || !location) return asResponse(res);
    res.destroy();
    if (hop >= REDIRECTS_MAX) throw new Refused(`more than ${REDIRECTS_MAX} redirects`);
    url = new URL(location, url);
  }
}

/** A response's body read to at most `max` bytes, or null where it is longer; the rest is not read. */
export async function readCapped(r: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(r.headers.get('content-length') ?? '');
  if (declared > max) {
    await r.body?.cancel().catch(() => {});
    return null;
  }
  if (!r.body) return new Uint8Array();
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
