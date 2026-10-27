/**
 * The event line (CORE.md section 4) and the receipt wrapper (section 5). An event's id is the hash of the event without
 * its signature fields. This module knows the shape of each core type's body and how to sign and recover; whether an
 * event counts, against a problem's pieces and the other events, is the reducer's question.
 */
import { randomBytes } from '@noble/hashes/utils.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { canonicalBytes } from './canonical.js';
import { CAPABILITIES, type Capability } from './envelope.js';
import { type Hash, hashBytes, hashCanonical, hashText, isHash } from './hash.js';
import { type Address, type Signature, isAddress, isSignature, recoverSigner, signObject } from './keys.js';
import { isRecord, unknownKeys } from './plain.js';
import type { Return } from './schema.js';

export const CORE_EVENT_TYPES = ['claim', 'commit', 'reveal', 'decline', 'run', 'name', 'delegate', 'revoke', 'rotate', 'version', 'output'] as const;
export type CoreEventType = (typeof CORE_EVENT_TYPES)[number];
/** The events about one piece: each names a problem and a piece, and the reducer checks both are this chain's. */
export const PIECE_EVENT_TYPES: readonly string[] = ['claim', 'commit', 'reveal', 'decline', 'run'];
/** The events only a root signs (section 4); from a delegate, or a key rotated from, they are dropped. */
export const ROOT_ONLY_TYPES: readonly string[] = ['delegate', 'revoke', 'rotate', 'version'];
/** The fields of an event line (section 4); any other makes it malformed. */
export const EVENT_FIELDS: readonly string[] = ['quilt', 'type', 'problem', 'piece', 'key', 'ts', 'body', 'sig', 'sig_to', 'nonce'];
export const DECLINE_REASONS = ['cannot', 'unclear', 'refuse', 'duplicate', 'no_time'] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];
export const NONCE_RE = /^[0-9a-f]{32}$/;
/** The pseudo-problem under which a resolver keeps identity events (name, delegate, revoke, rotate): a log of their own. */
export const IDENTITY_LOG: Hash = hashText('quilt:identity');

/** The client's declaration on a claim, a reveal and a run: the model that did the work, the client, and what it can do. */
export interface By {
  model: string;
  client: string;
  can: Capability[];
}

export interface ClaimBody { by: By; lease_h?: number }
export interface CommitBody { h: Hash }
export interface RevealBody { return: Return | { patch: string }; nonce: string; by: By }
export interface DeclineBody { reason: DeclineReason }
export interface RunBody { digest: Hash; exit: number; score?: number; image?: string; host: string; by: By }
export interface NameBody {
  name: string;
  agent?: boolean;
  /** An extension's field (PROTOCOL.md, ERC-8004); the core carries it unread. */
  erc8004?: { agentRegistry: string; agentId: string };
}
export interface DelegateBody { to: Address; scope: string[]; expires: string }
export interface RevokeBody { of: Address }
export interface RotateBody { to: Address }
export interface VersionBody { slug: string; hash: Hash }
export interface OutputBody { hash: Hash }

export interface Event {
  quilt: 1;
  type: string;
  problem?: Hash;
  piece?: Hash;
  key: Address;
  ts: string;
  body: Record<string, unknown>;
  sig: Signature;
  sig_to?: Signature;
  nonce?: string;
}

/** An event about to be signed by its key. A rotate already carries the new root's `sig_to`, which `sig` does not cover (section 4). */
export type Unsigned = Omit<Event, 'sig' | 'sig_to'> & { sig_to?: Signature };

/** What a resolver says about an event: when it took it, and what it knew about the seat that sent it. */
export interface Received {
  by: string;
  at: string;
  custody?: 'self' | 'hosted';
  seat?: 'person' | 'ai';
}

export interface Receipt {
  event: Event;
  received: Received[];
  seq?: number;
  prev?: string;
  hash?: string;
}

/** The id of an event: the hash of the event without `sig` and `sig_to`. */
export function eventId(e: Unsigned | Event): Hash {
  const { sig: _s, sig_to: _t, ...rest } = e as Event;
  return hashCanonical(rest);
}

/** A commit's `h`: SHA-256 over the UTF-8 bytes of the return's canonical JSON followed by the UTF-8 bytes of the nonce. */
export function commitHash(ret: unknown, nonce: string): Hash {
  const a = canonicalBytes(ret);
  const b = new TextEncoder().encode(nonce);
  const both = new Uint8Array(a.length + b.length);
  both.set(a, 0);
  both.set(b, a.length);
  return hashBytes(both);
}

/** A fresh nonce for a commit: sixteen random bytes as thirty-two hex characters (section 1). */
export function newNonce(): string {
  return bytesToHex(randomBytes(16));
}

/** The vendor of a declared model: the part before the first slash; `human` is a vendor. */
export function vendorOf(model: string): string {
  const i = model.indexOf('/');
  return i < 0 ? model : model.slice(0, i);
}

/** The event with its `sig` by `secret`, which is the key's. */
export function signEvent(unsigned: Unsigned, secret: Uint8Array): Event {
  const sig = signObject(unsigned as Record<string, unknown>, secret);
  return { ...unsigned, sig } as Event;
}

/** The address that signed `sig`, or null. */
export function eventSigner(e: Event): Address | null {
  return recoverSigner(e as unknown as Record<string, unknown>, 'sig');
}

/** Whether `sig` is the signature of the event's `key`. */
export function eventSignedByKey(e: Event): boolean {
  return eventSigner(e) === e.key;
}

/** The address that signed a rotate's `sig_to`, or null. */
export function rotateSecondSigner(e: Event): Address | null {
  return recoverSigner(e as unknown as Record<string, unknown>, 'sig_to');
}

/** A time as section 4 writes `ts` and a delegate's `expires`: ISO 8601 with a zone. Stricter than plain.ts's `isTime`, which takes anything `Date.parse` reads. */
function isTimeWithZone(s: unknown): boolean {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
}

function byProblems(by: unknown, at: string): string[] {
  if (!isRecord(by)) return [`${at}: model, client and can`];
  const out: string[] = [];
  if (typeof by.model !== 'string' || !by.model || by.model.length > 80) out.push(`${at}.model: vendor/model or human`);
  if (typeof by.client !== 'string' || !by.client || by.client.length > 80) out.push(`${at}.client: a name`);
  if (!Array.isArray(by.can) || !by.can.every((c) => (CAPABILITIES as readonly string[]).includes(c as string))) out.push(`${at}.can: from ${CAPABILITIES.join(', ')}`);
  return out;
}

/**
 * Why this is not a well-formed event of a core type, or nothing. The signature is not checked here, nor whether the
 * event's problem and piece exist; the reducer does both. An event of a type the core does not define is well-formed
 * when its envelope fields are, and its body is anyone's.
 */
export function eventProblems(e: unknown): string[] {
  if (!isRecord(e)) return ['event: not an object'];
  const out: string[] = [];
  if (e.quilt !== 1) out.push('event.quilt: 1');
  if (typeof e.type !== 'string' || !e.type) out.push('event.type: a name');
  if (!isAddress(e.key)) out.push('event.key: an address with its checksum');
  if (!isTimeWithZone(e.ts)) out.push('event.ts: a time, ISO 8601 with a zone');
  if (!isSignature(e.sig)) out.push('event.sig: a signature');
  if (e.sig_to !== undefined && !isSignature(e.sig_to)) out.push('event.sig_to: a signature');
  if (e.problem !== undefined && !isHash(e.problem)) out.push('event.problem: a hash');
  if (e.piece !== undefined && !isHash(e.piece)) out.push('event.piece: a hash');
  if (e.nonce !== undefined && (typeof e.nonce !== 'string' || !NONCE_RE.test(e.nonce))) out.push('event.nonce: 32 hex characters');
  for (const k of unknownKeys(e, EVENT_FIELDS)) out.push(`event.${k}: not a field of an event`);
  const b = e.body;
  if (!isRecord(b)) return [...out, 'event.body: an object'];
  const type = e.type as string;
  if (PIECE_EVENT_TYPES.includes(type) && (e.problem === undefined || e.piece === undefined)) out.push(`event: a ${type} names a problem and a piece`);
  if (['version', 'output'].includes(type) && e.problem === undefined) out.push(`event: a ${type} names a problem`);
  switch (type) {
    case 'claim':
      out.push(...byProblems(b.by, 'body.by'));
      if (b.lease_h !== undefined && !(typeof b.lease_h === 'number' && b.lease_h > 0)) out.push('body.lease_h: a number above 0');
      break;
    case 'commit':
      if (!isHash(b.h)) out.push('body.h: a hash');
      break;
    case 'reveal':
      if (!isRecord(b.return)) out.push('body.return: an object');
      if (typeof b.nonce !== 'string' || !NONCE_RE.test(b.nonce)) out.push('body.nonce: 32 hex characters');
      out.push(...byProblems(b.by, 'body.by'));
      break;
    case 'decline':
      if (!(DECLINE_REASONS as readonly string[]).includes(b.reason as string)) out.push(`body.reason: one of ${DECLINE_REASONS.join(', ')}`);
      break;
    case 'run':
      if (!isHash(b.digest)) out.push('body.digest: a hash');
      if (!Number.isInteger(b.exit)) out.push('body.exit: a whole number');
      if (b.score !== undefined && !(typeof b.score === 'number' && Number.isFinite(b.score))) out.push('body.score: a number');
      if (b.image !== undefined && typeof b.image !== 'string') out.push('body.image: a digest');
      if (typeof b.host !== 'string') out.push('body.host: the platform');
      out.push(...byProblems(b.by, 'body.by'));
      break;
    case 'name':
      if (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60) out.push('body.name: a name of at most 60 characters');
      if (b.agent !== undefined && typeof b.agent !== 'boolean') out.push('body.agent: true or false');
      break;
    case 'delegate':
      if (!isAddress(b.to)) out.push('body.to: an address');
      if (!Array.isArray(b.scope) || !b.scope.every((s) => typeof s === 'string')) out.push('body.scope: a list of event types');
      if (!isTimeWithZone(b.expires)) out.push('body.expires: a time');
      break;
    case 'revoke':
      if (!isAddress(b.of)) out.push('body.of: an address');
      break;
    case 'rotate':
      if (!isAddress(b.to)) out.push('body.to: an address');
      if (!isSignature(e.sig_to)) out.push('event.sig_to: the new root\'s signature');
      break;
    case 'version':
      if (typeof b.slug !== 'string') out.push('body.slug: a slug');
      if (!isHash(b.hash)) out.push('body.hash: a hash');
      break;
    case 'output':
      if (!isHash(b.hash)) out.push('body.hash: a hash');
      break;
    default:
      break;
  }
  return out;
}

/** The earliest time any resolver took the event, or null when it has no receipt. */
export function earliestReceipt(r: Receipt): string | null {
  let best: string | null = null;
  for (const x of r.received) if (best === null || x.at < best) best = x.at;
  return best;
}
