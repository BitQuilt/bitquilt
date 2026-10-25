/**
 * The verbs' work, with no MCP and no HTTP in it: open a problem, search, be handed a piece, hand one back, decline,
 * read, publish, challenge an acceptance, give a verdict. The MCP server and the page are thin shells over this. Other
 * people's words come out of here only as quoted text with the signer named.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Capability, type Envelope, type Event, type Hash, type Pick, type Problem, type State, type Unsigned,
  commitHash, eventId, hashBytes, newNonce, next, plainTextProblems, problemHash, signEvent, signObject, canonical, envelopeProblems,
} from '@bitquilt/core';
import type { Config, Identity } from './config.js';
import { type Link, makeLink, parseLink } from './link.js';
import type { Resolver } from './resolver.js';

export const SIDES = ['challenger', 'author'] as const;
export type Side = (typeof SIDES)[number];

/** A challenge as a tracker lists it at /p/<hash>/challenges (QX-1): the seats drawn, each verdict, the outcome. */
export interface ChallengeListing {
  id: Hash;
  piece: Hash;
  name: string | null;
  root: string;
  at: string;
  stake: number;
  ground: string;
  seats: { root: string; offered_at: string; lapsed_at: string | null; verdict: { at: string; for: Side; return: Record<string, unknown> | null } | null }[];
  outcome: 'open' | 'held' | 'failed' | 'void';
  decided_at: string | null;
}

export const STATE_MARK: Record<string, string> = { locked: 'l', unknown: '?', open: '.', in_flight: 'i', sealed: 's', needs_verify: 'v', disputed: 'd', accepted_provisional: 'p', accepted: 'a', unreachable: 'u' };

/** The vendor and model a host declares, from the name it gives at connection. */
export function modelFor(hostName: string | undefined, override?: string): string {
  if (override) return override;
  const n = (hostName ?? '').toLowerCase();
  if (!n) return 'unknown/unknown';
  if (n.includes('claude')) return `anthropic/${n.replace(/\s+/g, '-')}`;
  if (n.includes('openai') || n.includes('chatgpt') || n.includes('codex')) return `openai/${n.replace(/\s+/g, '-')}`;
  if (n.includes('gemini') || n.includes('google')) return `google/${n.replace(/\s+/g, '-')}`;
  return `${n.replace(/\s+/g, '-')}/${n.replace(/\s+/g, '-')}`;
}

export interface Pattern {
  title: string;
  done_when: string;
  slug: string;
  prev?: Hash | null;
  from?: Hash | null;
  settings?: Partial<Problem['settings']>;
  pieces: Problem['pieces'];
  /** Blob names to their rows, inline. */
  data?: Record<string, unknown[]>;
  topics?: string[];
}

interface Library {
  problems: Record<string, { title: string; slug: string; trackers: string[]; first: string; last: string }>;
  pieces: Record<string, { problem: Hash; name: string; when: string; what: string }>;
}

export class Quilt {
  readonly library: Library;
  private readonly libraryFile: string;
  readonly hostName: string | undefined;

  constructor(readonly config: Config, readonly identity: Identity | null, readonly resolver: Resolver, hostName?: string) {
    this.hostName = hostName;
    this.libraryFile = join(resolver.home, 'library.json');
    this.library = existsSync(this.libraryFile) ? (JSON.parse(readFileSync(this.libraryFile, 'utf8')) as Library) : { problems: {}, pieces: {} };
  }

  model(): string {
    return modelFor(this.hostName, this.config.model);
  }

  by(can: Capability[] = this.config.can) {
    return { model: this.model(), client: 'quilt/0.1', can };
  }

  private save(): void {
    writeFileSync(this.libraryFile, JSON.stringify(this.library, null, 2) + '\n');
  }

  private needKey(): Identity {
    if (!this.identity) throw new Error('no key yet: run quilt init');
    return this.identity;
  }

  /** Where posts about a problem go: the trackers the library remembers for it, then the config's. */
  private trackersFor(problem: Hash): string[] {
    const entry = this.library.problems[problem];
    return entry ? [...new Set([...entry.trackers, ...this.config.trackers])] : this.config.trackers;
  }

  me() {
    return { address: this.identity?.address ?? null, name: this.config.name ?? null, model: this.model(), can: this.config.can, trackers: this.config.trackers, mirrors: this.config.mirrors, queued: this.resolver.queued(), problems: Object.keys(this.library.problems).length };
  }

  /** The problem behind a link or hash, resolved and reduced. */
  async open(input: string): Promise<{ link: Link; hash: Hash; state: State; tracker: string | null }> {
    const link = parseLink(input);
    const resolved = await this.resolver.resolve(link);
    if (!resolved) throw new Error('no resolver answered for that hash');
    const state = this.resolver.state(resolved);
    const now = new Date().toISOString();
    const trackers = [...new Set([...(resolved.tracker ? [resolved.tracker] : []), ...link.trackers, ...this.config.trackers])];
    const entry = this.library.problems[resolved.hash];
    this.library.problems[resolved.hash] = { title: state.envelope.problem.title, slug: state.envelope.problem.slug, trackers, first: entry?.first ?? now, last: now };
    this.save();
    return { link, hash: resolved.hash, state, tracker: resolved.tracker };
  }

  /** The map as a strip of marks, one per piece in file order, and the counts. */
  mapText(state: State): string {
    const strip = state.pieces.map((v) => STATE_MARK[v.state] ?? '?').join('');
    const counts: Record<string, number> = {};
    for (const v of state.pieces) counts[v.state] = (counts[v.state] ?? 0) + 1;
    const parts = Object.entries(counts).map(([k, n]) => `${n} ${k.replace('_', ' ')}`);
    return `${strip}\n${parts.join(', ')}${state.complete ? '; complete' : ''}`;
  }

  /** A problem said as text: title and done_when as the owner's quoted words, the map, the trackers. */
  summary(hash: Hash, state: State, tracker: string | null): string {
    const p = state.envelope.problem;
    const owner = state.names.get(p.owner as `0x${string}`)?.name ?? p.owner;
    const lines = [
      `Problem ${hash}`,
      `The owner, ${owner}, titled it: "${p.title}"`,
      `and wrote of when it is done: "${p.done_when}"`,
      `${state.pieces.length} pieces, version ${state.chain.length} along prev.`,
      this.mapText(state),
      `Legend: . open, i in flight, s sealed, v needs a second production, d disputed, p accepted within the window, a accepted, u unreachable, l locked, ? a kind this client does not implement.`,
      tracker ? `Answered by ${tracker}.` : 'Answered from the cache or a mirror.',
      `Link: ${makeLink(hash, tracker ? [tracker] : this.config.trackers, p.slug)}`,
    ];
    return lines.join('\n');
  }

  async search(query: string): Promise<{ problem: Hash; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[]; tracker: string }[]> {
    const out = new Map<string, { problem: Hash; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[]; tracker: string }>();
    for (const t of this.config.trackers) {
      try {
        const r = await fetch(`${t}search?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        const j = (await r.json()) as { problems: { problem: Hash; title: string; slug: string; owner: string; pieces: number; counts: Record<string, number>; topics: string[] }[] };
        for (const p of j.problems) if (!out.has(p.problem)) out.set(p.problem, { ...p, tracker: t });
      } catch {
        /* a tracker that does not answer is skipped */
      }
    }
    return [...out.values()];
  }

  /** The rarest piece for this key: the tracker's assisted next when one answers and names a piece, else computed here from the map; then a claim. */
  async next(input: string): Promise<{ hash: Hash; pick: Pick; posted: { at: string | null; queued: boolean; error?: string }; author: string }> {
    const id = this.needKey();
    const { hash, state, tracker } = await this.open(input);
    const trackers = tracker ? [tracker, ...this.config.trackers] : this.config.trackers;
    let pick: Pick | null = null;
    if (tracker) {
      try {
        const r = await fetch(`${tracker}p/${hash}/next?key=${id.address}&can=${this.config.can.join(',')}&model=${encodeURIComponent(this.model())}`, { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
          const j = (await r.json()) as { piece: Hash | null };
          if (j.piece) {
            const view = state.byHash.get(j.piece);
            if (view) pick = next(state, id.address, { can: this.config.can, model: this.model() }, new Date().toISOString(), { exclude: new Set(state.pieces.filter((v) => v.piece.hash !== j.piece).map((v) => v.piece.hash)) });
          }
          // A tracker that names nothing is only saying its holds are taken; the map decides below.
        }
      } catch {
        pick = null;
      }
    }
    if (!pick) pick = next(state, id.address, { can: this.config.can, model: this.model() }, new Date().toISOString());
    if (!pick) throw new Error('nothing for this key on that problem right now');
    const claim = this.sign({ quilt: 1, type: 'claim', problem: hash, piece: pick.piece.hash, key: id.address, ts: new Date().toISOString(), body: { by: this.by() } });
    const posted = await this.resolver.post(claim, hash, trackers);
    this.library.pieces[pick.piece.hash] = { problem: hash, name: pick.piece.name, when: claim.ts, what: 'claimed' };
    this.save();
    const owner = state.names.get(state.envelope.problem.owner as `0x${string}`)?.name ?? state.envelope.problem.owner;
    return { hash, pick, posted, author: owner };
  }

  /** The piece said as text: the brief as the author's quoted words, the schema, what it requires, the lease. */
  pieceText(hash: Hash, pick: Pick, author: string): string {
    const lines = [
      `Piece ${pick.piece.name} (${pick.piece.hash}) of problem ${hash}, verifier ${pick.piece.verifier}, state ${pick.state.replace('_', ' ')}.`,
      `The author, ${author}, wrote this brief: "${pick.brief}"`,
      pick.schema ? `A return is an object with these fields: ${canonical(pick.schema.properties)}; required: ${pick.schema.required.join(', ')}; agreement is on: ${pick.agree.join(', ')}.` : `A return is { patch }: a unified diff against ${pick.piece.workspace?.repo ?? 'the workspace'} at ${pick.piece.workspace?.base ?? 'base'}, or the empty string; the check is ${pick.piece.check?.file ?? 'the check file'}.`,
      pick.requires.length ? `It requires: ${pick.requires.join(', ')}.` : 'It requires nothing in particular.',
      `The lease is ${pick.lease_h} hours.`,
    ];
    return lines.join('\n');
  }

  /** A return handed in: a commit, then its reveal. */
  async return(problem: Hash, piece: Hash, ret: Record<string, unknown>): Promise<{ commit: { at: string | null; queued: boolean; error?: string }; reveal: { at: string | null; queued: boolean; error?: string } }> {
    const id = this.needKey();
    const entry = this.library.problems[problem];
    const trackers = entry ? [...new Set([...entry.trackers, ...this.config.trackers])] : this.config.trackers;
    for (const s of Object.values(ret)) if (typeof s === 'string') {
      const issues = plainTextProblems(s, 'return');
      if (issues.length) throw new Error(issues[0]);
    }
    const nonce = newNonce();
    const commit = this.sign({ quilt: 1, type: 'commit', problem, piece, key: id.address, ts: new Date().toISOString(), body: { h: commitHash(ret, nonce) } });
    const c = await this.resolver.post(commit, problem, trackers);
    if (c.error && !c.queued) throw new Error(`the tracker refused the commit: ${c.error}`);
    const reveal = this.sign({ quilt: 1, type: 'reveal', problem, piece, key: id.address, ts: new Date(Date.now() + 1).toISOString(), body: { return: ret, nonce, by: this.by() } });
    const r = await this.resolver.post(reveal, problem, trackers);
    if (r.error && !r.queued) throw new Error(`the tracker refused the reveal: ${r.error}`);
    const known = this.library.pieces[piece];
    this.library.pieces[piece] = { problem, name: known?.name ?? piece, when: reveal.ts, what: 'returned' };
    this.save();
    return { commit: c, reveal: r };
  }

  async decline(problem: Hash, piece: Hash, reason: 'cannot' | 'unclear' | 'refuse' | 'duplicate' | 'no_time') {
    const id = this.needKey();
    const e = this.sign({ quilt: 1, type: 'decline', problem, piece, key: id.address, ts: new Date().toISOString(), body: { reason } });
    return this.resolver.post(e, problem, this.trackersFor(problem));
  }

  /** A challenge of a piece's provisional acceptance (QX-1): a stake of this key's standing and one sentence of ground, signed and posted. */
  async challenge(problem: Hash, piece: Hash, stake: number, ground: string): Promise<{ id: Hash; at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    if (!Number.isInteger(stake) || stake < 1) throw new Error('the stake is a whole number of at least 1');
    const issues = plainTextProblems(ground, 'ground');
    if (issues.length) throw new Error(issues[0]);
    const e = this.sign({ quilt: 1, type: 'challenge', problem, piece, key: id.address, ts: new Date().toISOString(), body: { stake, ground } });
    const r = await this.resolver.post(e, problem, this.trackersFor(problem));
    if (r.error && !r.queued) throw new Error(`the tracker refused the challenge: ${r.error}`);
    return { id: eventId(e), ...r };
  }

  /** A verdict on a challenge this key was drawn to judge: for the challenger or for the author, with this judge's own return as evidence where it has one. */
  async verdict(problem: Hash, piece: Hash, challenge: Hash, side: Side, ret?: Record<string, unknown>): Promise<{ id: Hash; at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    if (!SIDES.includes(side)) throw new Error(`a verdict is for the ${SIDES.join(' or the ')}`);
    if (ret) for (const s of Object.values(ret)) if (typeof s === 'string') {
      const issues = plainTextProblems(s, 'return');
      if (issues.length) throw new Error(issues[0]);
    }
    const e = this.sign({ quilt: 1, type: 'verdict', problem, piece, key: id.address, ts: new Date().toISOString(), body: { challenge, for: side, ...(ret ? { return: ret } : {}) } });
    const r = await this.resolver.post(e, problem, this.trackersFor(problem));
    if (r.error && !r.queued) throw new Error(`the tracker refused the verdict: ${r.error}`);
    return { id: eventId(e), ...r };
  }

  /** The problem's challenges as the first tracker that answers computes them: the one that answered for the problem, then the known ones. */
  async challenges(problem: Hash, tracker: string | null = null): Promise<ChallengeListing[]> {
    for (const t of [...new Set([...(tracker ? [tracker] : []), ...this.trackersFor(problem)])]) {
      try {
        const r = await fetch(`${t}p/${problem}/challenges`, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) continue;
        return ((await r.json()) as { challenges: ChallengeListing[] }).challenges;
      } catch {
        /* a tracker that does not answer is skipped */
      }
    }
    return [];
  }

  /** The challenges said as text: the ground as the challenger's quoted words, the seats, each verdict with the judge named and its return quoted. */
  challengesText(list: ChallengeListing[], state: State): string {
    if (list.length === 0) return 'No challenge on this problem.';
    const who = (a: string) => state.names.get(a as `0x${string}`)?.name ?? a;
    const outcome: Record<ChallengeListing['outcome'], string> = {
      open: 'open: the piece is challenged while the panel sits',
      held: 'held: the acceptance was struck and the piece is open again',
      failed: 'failed: the acceptance stands and the stake was lost',
      void: 'void: no panel could decide it and the acceptance stands',
    };
    return list.map((c) => {
      const lines = [
        `Challenge ${c.id} on ${c.name ?? c.piece}, by ${who(c.root)} with a stake of ${c.stake}, ${outcome[c.outcome]}.`,
        `${who(c.root)} wrote as the ground: "${c.ground}"`,
      ];
      if (c.seats.length === 0) lines.push('No seats drawn yet.');
      for (const s of c.seats) {
        const judge = who(s.root);
        if (s.verdict) lines.push(`${judge}, drawn, answered for the ${s.verdict.for}${s.verdict.return ? ` and returned: ${canonical(s.verdict.return)}` : ''}.`);
        else if (s.lapsed_at) lines.push(`${judge}, drawn, let the seat lapse.`);
        else lines.push(`${judge}, drawn, has not answered.`);
      }
      return lines.join('\n');
    }).join('\n\n');
  }

  /** The accepted returns of a problem as quoted text with the signers named. */
  acceptedText(state: State): string {
    const lines: string[] = [];
    for (const v of state.pieces) {
      if (!v.accepting) continue;
      if (v.accepting.kind === 'agree') for (const r of v.accepting.reveals) lines.push(`${v.piece.name}, ${state.names.get(r.root)?.name ?? r.root} returned: ${canonical(r.return)}`);
      else lines.push(`${v.piece.name}, ${state.names.get(v.accepting.patch.root)?.name ?? v.accepting.patch.root} returned a patch of ${(v.accepting.patch.return.patch as string).length} characters, run by ${v.accepting.runs.map((r) => r.root).join(' and ')}`);
    }
    return lines.length ? lines.join('\n') : 'Nothing accepted yet.';
  }

  /** Builds, signs and publishes an envelope from a pattern, with its blobs; then announces it. */
  async publish(pattern: Pattern): Promise<{ hash: Hash; link: string; posted: string[]; refused: string[] }> {
    const id = this.needKey();
    const blobs = new Map<Hash, Uint8Array>();
    const data: Record<string, Hash> = {};
    for (const [name, rows] of Object.entries(pattern.data ?? {})) {
      const bytes = new TextEncoder().encode(JSON.stringify(rows));
      const h = hashBytes(bytes);
      blobs.set(h, bytes);
      data[name] = h;
    }
    const problem: Problem = {
      title: pattern.title,
      done_when: pattern.done_when,
      owner: id.address,
      slug: pattern.slug,
      prev: pattern.prev ?? null,
      from: pattern.from ?? null,
      settings: { challenge_window_h: 48, lease_h: 2, endgame_at: 10, budget: 1000, patch_max: 100000, ...pattern.settings },
      pieces: pattern.pieces,
      data,
    };
    const unsigned = { quilt: 1 as const, problem, hints: { trackers: this.config.trackers, mirrors: this.config.mirrors } };
    const envelope: Envelope = { ...unsigned, sig: signObject(unsigned, id.secret) };
    const problems = envelopeProblems(envelope);
    if (problems.length) throw new Error(problems[0]);
    const hash = problemHash(envelope);
    const body = JSON.stringify({ envelope, blobs: Object.fromEntries([...blobs].map(([h, b]) => [h, Buffer.from(b).toString('base64')])) });
    const posted: string[] = [];
    const refused: string[] = [];
    for (const t of this.config.trackers) {
      try {
        const r = await fetch(`${t}p`, { method: 'POST', body, headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (r.status === 201) posted.push(t);
        else refused.push(`${t}: ${((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.status}`);
      } catch (err) {
        refused.push(`${t}: ${(err as Error).message}`);
      }
    }
    if (posted.length) {
      const announce = this.sign({ quilt: 1, type: 'announce', problem: hash, key: id.address, ts: new Date().toISOString(), body: { title: problem.title, slug: problem.slug, done_when: problem.done_when, topics: pattern.topics ?? [], counts: {}, trackers: posted, mirrors: this.config.mirrors } });
      await this.resolver.post(announce, hash, posted);
      const version = this.sign({ quilt: 1, type: 'version', problem: hash, key: id.address, ts: new Date().toISOString(), body: { slug: problem.slug, hash } });
      await this.resolver.post(version, hash, posted);
    }
    const now = new Date().toISOString();
    this.library.problems[hash] = { title: problem.title, slug: problem.slug, trackers: posted, first: now, last: now };
    this.save();
    return { hash, link: makeLink(hash, posted, problem.slug), posted, refused };
  }

  /** A name event for this key. */
  async setName(name: string): Promise<{ at: string | null; queued: boolean; error?: string }> {
    const id = this.needKey();
    const issues = plainTextProblems(name, 'name');
    if (issues.length) throw new Error(issues[0]);
    const e = this.sign({ quilt: 1, type: 'name', key: id.address, ts: new Date().toISOString(), body: { name } });
    return this.resolver.post(e, null, this.config.trackers);
  }

  private sign(unsigned: Unsigned): Event {
    return signEvent(unsigned, this.needKey().secret);
  }
}
