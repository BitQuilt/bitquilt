/**
 * Client ID metadata documents (QX-18 section 1; the MCP authorization spec's client registration, and the OAuth
 * draft it cites): a client whose id is an https URL under its own control, where a JSON document says its name, its
 * redirect URIs, how it authenticates and where its keys are. The on-ramp fetches the document when such a client
 * asks to be authorized, holds it to the rules here, and keeps it for as long as its cache headers say, within bounds.
 * A document on a product's origin is that product's own word about itself, which is what makes the key binding
 * (`via_by: key`) mean something: the key that signs the token request is published where only the product can
 * publish. The signed assertion is RFC 7523's: a JWT whose issuer and subject are the client id, whose audience is
 * the token endpoint or the issuer, with an expiry and an id presented once.
 */
import { createHash, createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';
import { isIP } from 'node:net';
import { OAuthClientMetadataSchema } from '@modelcontextprotocol/sdk/shared/auth.js';
import type { Store } from '@bitquilt/tracker';
import { Refused, readCapped } from 'quilt';

/** The most a document or a key set may be. */
export const DOCUMENT_MAX = 16 * 1024;
/** How long a document or a key set is kept when its headers say nothing, and the bounds on what they may say. */
const CACHE_DEFAULT_MS = 60 * 60 * 1000;
const CACHE_MIN_MS = 60 * 1000;
const CACHE_MAX_MS = 24 * 60 * 60 * 1000;
/** A key set is asked for again, for a key it does not have, at most this often. */
const REFETCH_MS = 60 * 1000;
/** The clock skew allowed on an assertion's times. */
const SKEW_S = 60;
/** The signing algorithms an assertion may use: RSA and P-256 with SHA-256, which is what the products publish. */
const ALGORITHMS: Record<string, { key: 'RSA' | 'EC'; options: Record<string, unknown> }> = {
  RS256: { key: 'RSA', options: {} },
  PS256: { key: 'RSA', options: { padding: 6, saltLength: 32 } },
  ES256: { key: 'EC', options: { dsaEncoding: 'ieee-p1363' } },
};
export const ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/**
 * A client metadata document as the on-ramp keeps it: the metadata the registration schema reads, the methods it allows
 * at the token endpoint, and where its keys are.
 */
export interface ClientDocument {
  clientId: string;
  metadata: Record<string, unknown>;
  methods: string[];
  jwksUri: string | null;
  jwks: { keys: JsonWebKey[] } | null;
}

export class DocumentError extends Error {}

/** Why a URL cannot be a client id, or null: https, a path, no fragment, no credentials, and a public host by name. */
export function clientIdProblem(id: string): string | null {
  let u: URL;
  try {
    u = new URL(id);
  } catch {
    return 'a client id that is a URL parses as one';
  }
  if (u.protocol !== 'https:') return 'a client metadata document is served over https';
  if (u.pathname === '/' || u.pathname === '') return 'a client id URL has a path';
  if (u.hash) return 'a client id URL has no fragment';
  if (u.username || u.password) return 'a client id URL carries no credentials';
  const host = u.hostname.toLowerCase();
  if (
    isIP(host.replace(/^\[|\]$/g, '')) ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.')
  )
    return 'a client metadata document lives on a public host by name';
  return null;
}

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');

function base64urlJson(part: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * How long a response may be kept: its max-age within the bounds, the default when it says nothing, and nothing at all
 * when it says no-store.
 */
function keepFor(headers: Headers): number {
  const cc = headers.get('cache-control') ?? '';
  if (/\bno-store\b/i.test(cc)) return 0;
  const m = /\bmax-age=(\d+)/i.exec(cc);
  if (!m) return CACHE_DEFAULT_MS;
  return Math.min(CACHE_MAX_MS, Math.max(CACHE_MIN_MS, Number(m[1]) * 1000));
}

export interface DocumentsOptions {
  store: Store;
  fetchImpl: typeof fetch;
  now: () => string;
}

/**
 * The documents and key sets the on-ramp has read, by URL. One instance serves the authorization server; its cache is
 * in memory, since a document is cheap to read again and its freshness is the product's to decide.
 */
export class Documents {
  private readonly documents = new Map<string, { doc: ClientDocument; until: number }>();
  private readonly keySets = new Map<string, { keys: JsonWebKey[]; until: number; fetchedAt: number }>();

  constructor(private readonly options: DocumentsOptions) {}

  private nowMs(): number {
    return Date.parse(this.options.now());
  }

  /**
   * A small JSON document from a public URL: no redirect followed, read to DOCUMENT_MAX bytes and no further, JSON or
   * nothing.
   */
  private async read(url: string): Promise<{ json: unknown; headers: Headers }> {
    let r: Response;
    try {
      r = await this.options.fetchImpl(url, {
        redirect: 'manual',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      throw new DocumentError(`${url} could not be read: ${err instanceof Refused ? err.why : (err as Error).message}`);
    }
    if (r.status !== 200) {
      await r.body?.cancel().catch(() => {});
      throw new DocumentError(`${url} answered ${r.status}`);
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await readCapped(r, DOCUMENT_MAX);
    } catch (err) {
      throw new DocumentError(`${url} could not be read: ${(err as Error).message}`);
    }
    if (!bytes) throw new DocumentError(`${url} is over ${DOCUMENT_MAX} bytes`);
    const text = new TextDecoder().decode(bytes);
    try {
      return { json: JSON.parse(text) as unknown, headers: r.headers };
    } catch {
      throw new DocumentError(`${url} is not JSON`);
    }
  }

  /** The client metadata document at a client id, read or kept; a DocumentError says what is wrong with it. */
  async document(clientId: string): Promise<ClientDocument> {
    const why = clientIdProblem(clientId);
    if (why) throw new DocumentError(why);
    const kept = this.documents.get(clientId);
    if (kept && kept.until > this.nowMs()) return kept.doc;
    const { json, headers } = await this.read(clientId);
    const doc = this.check(clientId, json);
    const keep = keepFor(headers);
    if (keep > 0) this.documents.set(clientId, { doc, until: this.nowMs() + keep });
    return doc;
  }

  /**
   * The document held to the rules: its client_id is the URL, its redirect URIs parse, it authenticates as none or with
   * a key, and a key is published on its own host.
   */
  private check(clientId: string, json: unknown): ClientDocument {
    if (!json || typeof json !== 'object' || Array.isArray(json))
      throw new DocumentError('the client metadata document is not a JSON object');
    const raw = json as Record<string, unknown>;
    if (raw.client_id !== clientId)
      throw new DocumentError("the client metadata document's client_id is not its own URL");
    const parsed = OAuthClientMetadataSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new DocumentError(
        `the client metadata document does not parse: ${issue ? `${issue.path.join('.') || 'metadata'}: ${issue.message}` : 'malformed'}`,
      );
    }
    const m = parsed.data;
    if (m.redirect_uris.length === 0) throw new DocumentError('the client metadata document names no redirect URI');
    const listed = Array.isArray(raw.token_endpoint_auth_methods_supported)
      ? (raw.token_endpoint_auth_methods_supported as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    const methods = [...new Set([...(m.token_endpoint_auth_method ? [m.token_endpoint_auth_method] : []), ...listed])];
    if (methods.length === 0) methods.push('none');
    for (const method of methods)
      if (method !== 'none' && method !== 'private_key_jwt')
        throw new DocumentError(
          `a client metadata document authenticates as none or with private_key_jwt, not ${method}`,
        );
    let jwksUri: string | null = null;
    let jwks: { keys: JsonWebKey[] } | null = null;
    if (methods.includes('private_key_jwt')) {
      if (typeof m.jwks_uri === 'string') {
        let u: URL;
        try {
          u = new URL(m.jwks_uri);
        } catch {
          throw new DocumentError('jwks_uri is a URL');
        }
        if (u.protocol !== 'https:' || u.host !== new URL(clientId).host)
          throw new DocumentError("a client's keys are published on its own host over https");
        jwksUri = m.jwks_uri;
      } else if (m.jwks && typeof m.jwks === 'object' && Array.isArray((m.jwks as { keys?: unknown }).keys)) {
        jwks = { keys: (m.jwks as { keys: JsonWebKey[] }).keys };
      } else throw new DocumentError('a client that signs its requests publishes jwks_uri or jwks');
    }
    return { clientId, metadata: m as Record<string, unknown>, methods, jwksUri, jwks };
  }

  /**
   * The keys of a document: inline, or from its jwks_uri, read again for a key it does not have when the last reading
   * is old enough.
   */
  private async keysOf(doc: ClientDocument, kid: string | undefined): Promise<JsonWebKey[]> {
    if (doc.jwks) return doc.jwks.keys;
    if (!doc.jwksUri) return [];
    const kept = this.keySets.get(doc.jwksUri);
    const fresh = kept && kept.until > this.nowMs();
    const has = (keys: JsonWebKey[]) => kid === undefined || keys.some((k) => (k as { kid?: string }).kid === kid);
    if (fresh && (has(kept.keys) || this.nowMs() - kept.fetchedAt < REFETCH_MS)) return kept.keys;
    const { json, headers } = await this.read(doc.jwksUri);
    const keys =
      json && typeof json === 'object' && Array.isArray((json as { keys?: unknown }).keys)
        ? ((json as { keys: unknown[] }).keys.filter((k) => k && typeof k === 'object') as JsonWebKey[])
        : null;
    if (!keys) throw new DocumentError('the key set is not a JWKS');
    const keep = keepFor(headers);
    this.keySets.set(doc.jwksUri, {
      keys,
      until: this.nowMs() + Math.max(keep, CACHE_MIN_MS),
      fetchedAt: this.nowMs(),
    });
    return keys;
  }

  /**
   * A client assertion checked against its document: a JWT in one of the algorithms above, signed by a key the document
   * publishes, naming the client as issuer and subject and this server as audience, in time, and not seen before.
   * Answers the client id it stands for; a DocumentError says why it does not.
   */
  async verifyAssertion(assertion: string, doc: ClientDocument, audiences: string[]): Promise<void> {
    const parts = assertion.split('.');
    if (parts.length !== 3) throw new DocumentError('the client assertion is not a signed JWT');
    const header = base64urlJson(parts[0]!);
    const payload = base64urlJson(parts[1]!);
    if (!header || !payload) throw new DocumentError('the client assertion does not parse');
    const alg = typeof header.alg === 'string' ? header.alg : '';
    const how = ALGORITHMS[alg];
    if (!how)
      throw new DocumentError(
        `the client assertion is signed with ${alg || 'nothing'}; this server takes ${Object.keys(ALGORITHMS).join(', ')}`,
      );
    if (!doc.methods.includes('private_key_jwt'))
      throw new DocumentError('the client metadata document does not say the client signs its requests');
    if (payload.iss !== doc.clientId || payload.sub !== doc.clientId)
      throw new DocumentError("the client assertion's issuer and subject are the client id");
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    const same = (a: unknown, b: string) => typeof a === 'string' && a.replace(/\/$/, '') === b.replace(/\/$/, '');
    if (!aud.some((a) => audiences.some((b) => same(a, b))))
      throw new DocumentError("the client assertion's audience is this server's token endpoint or its issuer");
    const nowS = Math.floor(this.nowMs() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp <= nowS - SKEW_S)
      throw new DocumentError('the client assertion has expired');
    if (payload.exp > nowS + 24 * 60 * 60) throw new DocumentError('the client assertion expires too far ahead');
    if (typeof payload.nbf === 'number' && payload.nbf > nowS + SKEW_S)
      throw new DocumentError('the client assertion is not yet valid');
    if (typeof payload.jti !== 'string' || !payload.jti) throw new DocumentError('the client assertion carries a jti');
    const kid = typeof header.kid === 'string' ? header.kid : undefined;
    const keys = await this.keysOf(doc, kid);
    const candidates = keys.filter(
      (k) => (kid === undefined || (k as { kid?: string }).kid === kid) && k.kty === how.key,
    );
    if (candidates.length === 0) throw new DocumentError('no published key signs the client assertion');
    const data = Buffer.from(`${parts[0]}.${parts[1]}`);
    const signature = Buffer.from(parts[2]!, 'base64url');
    const signed = candidates.some((jwk) => {
      let key: KeyObject;
      try {
        key = createPublicKey({ key: jwk, format: 'jwk' });
      } catch {
        return false;
      }
      try {
        return verifySignature('sha256', data, { key, ...how.options }, signature);
      } catch {
        return false;
      }
    });
    if (!signed) throw new DocumentError("the client assertion's signature is not by a published key");
    if (
      !this.options.store.putAssertion(
        sha(`${doc.clientId}\n${payload.jti}`),
        new Date(payload.exp * 1000).toISOString(),
      )
    )
      throw new DocumentError('the client assertion was presented before');
  }
}
