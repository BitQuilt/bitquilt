/**
 * The mirror (PROTOCOL.md, The mirror): the one automated writer to a repository's main. It pulls from the trackers it
 * is given, checks every envelope against its hash, every blob against its hash and every chain from its problem's hash,
 * refuses a chain that did anything but grow since the file it holds, and writes the layout a client reads raw. A chain is a
 * resolver's own, so a mirror follows one tracker's chains; a second tracker's chain for the same problem is refused unless it
 * is a growth of the first's:
 *
 *   problems/<hash>.json   blobs/<hash>   ledger/<hash>.jsonl   ledger/identity.jsonl
 *   names/<owner>/<slug>   outputs/<hash>/output.json   keys.json   index.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  type Envelope, type Hash, type Receipt, IDENTITY_LOG, blobProblems, envelopeProblems, hashBytes, onlyAppends, problemHash, reduce, signedBy, verifyChain,
} from '@bitquilt/core';

export interface MirrorOptions {
  trackers: string[];
  out: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

export interface MirrorReport {
  problems: { hash: Hash; lines: number; added: number; complete: boolean }[];
  identity: { lines: number; added: number };
  refused: string[];
  errors: string[];
}

const withSlash = (u: string) => (u.endsWith('/') ? u : `${u}/`);

export async function mirror(options: MirrorOptions): Promise<MirrorReport> {
  const f = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date().toISOString());
  const out = options.out;
  for (const d of ['problems', 'blobs', 'ledger', 'names', 'outputs']) mkdirSync(join(out, d), { recursive: true });
  const report: MirrorReport = { problems: [], identity: { lines: 0, added: 0 }, refused: [], errors: [] };
  const index = new Map<Hash, { title: string; slug: string; owner: string; tracker: string }>();

  const getJson = async (url: string): Promise<unknown | null> => {
    try {
      const r = await f(url, { signal: AbortSignal.timeout(15000) });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const getLines = async (url: string): Promise<Receipt[] | null> => {
    const lines: Receipt[] = [];
    let since = 0;
    for (let page = 0; page < 10_000; page++) {
      let r: Response;
      try {
        r = await f(`${url}?since=${since}`, { signal: AbortSignal.timeout(30000) });
      } catch {
        return null;
      }
      if (!r.ok) return null;
      lines.push(...(await r.text()).split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt));
      const next = r.headers.get('x-quilt-next-since');
      if (!next) break;
      since = Number(next);
    }
    return lines;
  };
  const readLines = (file: string): Receipt[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt) : []);
  const writeLines = (file: string, lines: Receipt[]) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  };

  /** A chain from a tracker, taken only if it verifies and only adds to what the mirror holds. */
  const takeChain = async (url: string, genesis: Hash, file: string, label: string): Promise<{ lines: Receipt[]; added: number } | null> => {
    const lines = await getLines(url);
    if (!lines) return null;
    const check = verifyChain(lines, genesis);
    if (!check.ok) {
      report.refused.push(`${label}: chain from ${url} does not verify: ${check.problems[0]}`);
      return null;
    }
    const held = readLines(file);
    const growth = onlyAppends(held, lines);
    if (!growth.ok) {
      report.refused.push(`${label}: chain from ${url} did not only grow: ${growth.problem}`);
      return null;
    }
    if (growth.added > 0 || !existsSync(file)) writeLines(file, lines);
    return { lines, added: growth.added };
  };

  const seen = new Set<Hash>();
  for (const t of options.trackers.map(withSlash)) {
    const home = (await getJson(t)) as { problems?: { problem: Hash }[] } | null;
    if (!home?.problems) {
      report.errors.push(`${t}: no index`);
      continue;
    }
    for (const entry of home.problems) {
      const hash = entry.problem;
      if (seen.has(hash)) continue;
      const envelope = await getJson(`${t}p/${hash}`);
      if (!envelope || envelopeProblems(envelope).length || problemHash(envelope as Envelope) !== hash) {
        report.refused.push(`${hash}: envelope from ${t} does not check`);
        continue;
      }
      const e = envelope as Envelope;
      if (!signedBy(e as unknown as Record<string, unknown>, e.problem.owner)) {
        report.refused.push(`${hash}: envelope from ${t} is not signed by its owner`);
        continue;
      }
      const blobs = new Map<Hash, Uint8Array>();
      let blobsOk = true;
      for (const h of Object.values(e.problem.data)) {
        const file = join(out, 'blobs', h);
        let bytes: Uint8Array | null = existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
        if (!bytes || hashBytes(bytes) !== h) {
          try {
            const r = await f(`${t}b/${h}`, { signal: AbortSignal.timeout(30000) });
            bytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
          } catch {
            bytes = null;
          }
        }
        if (!bytes || hashBytes(bytes) !== h) {
          blobsOk = false;
          break;
        }
        blobs.set(h, bytes);
      }
      if (!blobsOk || blobProblems(e.problem, blobs).length) {
        report.refused.push(`${hash}: a blob from ${t} does not check`);
        continue;
      }
      const chain = await takeChain(`${t}p/${hash}/events`, hash, join(out, 'ledger', `${hash}.jsonl`), hash);
      if (!chain) continue;
      seen.add(hash);
      writeFileSync(join(out, 'problems', `${hash}.json`), JSON.stringify(e, null, 2) + '\n');
      for (const [h, bytes] of blobs) writeFileSync(join(out, 'blobs', h), bytes);
      index.set(hash, { title: e.problem.title, slug: e.problem.slug, owner: e.problem.owner, tracker: t });
      // Names and the output come from the events, not the tracker's word.
      for (const l of chain.lines) if (l.event.type === 'version' && l.event.key === e.problem.owner) {
        const { slug, hash: target } = l.event.body as { slug: string; hash: Hash };
        const file = join(out, 'names', e.problem.owner, slug);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${target}\n`);
      }
      let complete = false;
      try {
        const chainEnvelopes: Envelope[] = [e];
        let cur = e.problem.prev;
        const guard = new Set<Hash>();
        while (cur && !guard.has(cur)) {
          guard.add(cur);
          const pf = join(out, 'problems', `${cur}.json`);
          if (!existsSync(pf)) break;
          const pe = JSON.parse(readFileSync(pf, 'utf8')) as Envelope;
          chainEnvelopes.push(pe);
          for (const h of Object.values(pe.problem.data)) if (!blobs.has(h) && existsSync(join(out, 'blobs', h))) blobs.set(h, new Uint8Array(readFileSync(join(out, 'blobs', h))));
          cur = pe.problem.prev;
        }
        const receipts = [...chain.lines];
        for (const pe of chainEnvelopes.slice(1)) receipts.push(...readLines(join(out, 'ledger', `${problemHash(pe)}.jsonl`)));
        receipts.push(...readLines(join(out, 'ledger', 'identity.jsonl')));
        const state = reduce({ envelopes: chainEnvelopes, blobs, receipts, now: now() });
        complete = state.complete;
        if (state.output) {
          mkdirSync(join(out, 'outputs', hash), { recursive: true });
          writeFileSync(join(out, 'outputs', hash, 'output.json'), JSON.stringify(state.output.document, null, 2) + '\n');
          writeFileSync(join(out, 'outputs', hash, 'hash'), `${state.output.hash}\n`);
        }
      } catch (err) {
        report.errors.push(`${hash}: ${(err as Error).message}`);
      }
      report.problems.push({ hash, lines: chain.lines.length, added: chain.added, complete });
    }
    const identity = await takeChain(`${t}k/events`, IDENTITY_LOG, join(out, 'ledger', 'identity.jsonl'), 'identity');
    if (identity) report.identity = { lines: identity.lines.length, added: Math.max(report.identity.added, identity.added) };
  }

  // keys.json: each address's latest name and the delegations in force, folded from the identity log alone.
  const identityLines = readLines(join(out, 'ledger', 'identity.jsonl'));
  const keys: Record<string, { name?: string; agent?: boolean; delegates: { to: string; scope: string[]; expires: string }[] }> = {};
  const nowIso = now();
  for (const l of identityLines) {
    const e = l.event;
    const k = (keys[e.key] ??= { delegates: [] });
    if (e.type === 'name') {
      k.name = (e.body as { name: string }).name;
      if ((e.body as { agent?: boolean }).agent) k.agent = true;
    }
    if (e.type === 'delegate') {
      const b = e.body as { to: string; scope: string[]; expires: string };
      if (b.expires > nowIso) k.delegates.push({ to: b.to, scope: b.scope, expires: b.expires });
    }
    if (e.type === 'revoke') k.delegates = k.delegates.filter((d) => d.to !== (e.body as { of: string }).of);
  }
  writeFileSync(join(out, 'keys.json'), JSON.stringify(keys, null, 2) + '\n');
  writeFileSync(join(out, 'index.json'), JSON.stringify({ quilt: 1, mirrored: nowIso, problems: [...index].map(([hash, v]) => ({ hash, ...v })) }, null, 2) + '\n');
  return report;
}
