/**
 * The mirror (PROTOCOL.md, The mirror): the one automated writer to a repository's main. It pulls from the trackers it
 * is given, checks every envelope against its hash, every blob against its hash and every chain from its problem's hash,
 * refuses a chain that did anything but grow since the file it holds, and writes the layout a client reads raw. A chain is a
 * resolver's own, so a mirror follows one tracker's chains; a second tracker's chain for the same problem is refused unless it
 * is a growth of the first's:
 *
 *   problems/<hash>.json   blobs/<hash>   ledger/<hash>.jsonl   ledger/identity.jsonl   ledger/coin.jsonl (QX-17)
 *   names/<owner>/<slug>   outputs/<hash>/output.json   keys.json   index.json   coin/balances.json   anchors/<problem>/<seq>.ots (QX-12, when asked)
 *
 * The coin (QX-17) is held to the same rule as a chain: the mirror recomputes every balance from the receipts it holds
 * and the parameters the tracker publishes, and keeps the tracker's balances only where its own agree.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type AnchorReport, type Head, anchorHeads } from './anchor.js';
import { dirname, join } from 'node:path';
import {
  type Envelope, type Hash, type Receipt, type ReduceInput, IDENTITY_LOG, blobProblems, envelopeProblems, hashBytes, onlyAppends, problemHash, reduce, signedBy, verifyChain,
} from '@bitquilt/core';
import { type BalanceView, type CoinParams, COIN_LOG, challengeLayer, coinLayer } from '@bitquilt/tracker';

export interface MirrorOptions {
  trackers: string[];
  out: string;
  fetchImpl?: typeof fetch;
  now?: () => string;
  /** QX-12: stamp every chain's head through OpenTimestamps; true for the default calendars, or the calendars to ask. */
  anchor?: boolean | { calendars?: string[] };
  /** QX-17: pull the coin log of a tracker that is the coin's home and reproduce its balances; on unless false. */
  coin?: boolean;
  /**
   * The way back: what the chain holds at a deposit number, for checking every credit line the ledger kept. Absent,
   * a ledger with credits on it is refused, since nothing here can check them.
   */
  chain?: { depositAt(n: number): Promise<{ root: string; amount: bigint | number; made: boolean }> } | null;
}

export interface MirrorReport {
  problems: { hash: Hash; lines: number; added: number; complete: boolean }[];
  identity: { lines: number; added: number };
  /** QX-17: the coin log held, whether the tracker's balances at its head reproduced here (null where the head moved between reads), and how many credits were checked against the chain. */
  coin?: { lines: number; added: number; head: number | null; reproduced: boolean | null; credits?: number };
  refused: string[];
  errors: string[];
  anchors?: AnchorReport;
}

const withSlash = (u: string) => (u.endsWith('/') ? u : `${u}/`);

/** QX-6: every hide in an identity log, by the problem or event it names and the key that signed it; a lift by the same key removes its entry. The reader decides whom to trust. */
export function hiddenFromIdentity(lines: Receipt[]): Map<string, { by: string; why: string; at: string }[]> {
  const out = new Map<string, { by: string; why: string; at: string }[]>();
  for (const l of lines) {
    const e = l.event;
    if (e.type !== 'hide') continue;
    const b = e.body as { id?: unknown; why?: unknown; on?: unknown };
    if (typeof b.id !== 'string' || typeof b.why !== 'string') continue;
    const list = (out.get(b.id) ?? []).filter((h) => h.by !== e.key);
    if (b.on !== false) list.push({ by: e.key, why: b.why, at: l.received[0]?.at ?? e.ts });
    if (list.length) out.set(b.id, list);
    else out.delete(b.id);
  }
  return out;
}

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
  /** What the reducer takes for a problem held here: its envelope chain along prev, the blobs, every receipt along the chain and the identity log; null when the envelope is not here. */
  const inputFor = (hash: Hash, at: string): ReduceInput | null => {
    const file = join(out, 'problems', `${hash}.json`);
    if (!existsSync(file)) return null;
    const chainEnvelopes: Envelope[] = [JSON.parse(readFileSync(file, 'utf8')) as Envelope];
    const guard = new Set<Hash>([hash]);
    for (let cur = chainEnvelopes[0]!.problem.prev; cur && !guard.has(cur); ) {
      guard.add(cur);
      const pf = join(out, 'problems', `${cur}.json`);
      if (!existsSync(pf)) break;
      const pe = JSON.parse(readFileSync(pf, 'utf8')) as Envelope;
      chainEnvelopes.push(pe);
      cur = pe.problem.prev;
    }
    const blobs = new Map<Hash, Uint8Array>();
    for (const e of chainEnvelopes) for (const h of Object.values(e.problem.data)) if (!blobs.has(h) && existsSync(join(out, 'blobs', h))) blobs.set(h, new Uint8Array(readFileSync(join(out, 'blobs', h))));
    const receipts: Receipt[] = [];
    for (const e of chainEnvelopes) receipts.push(...readLines(join(out, 'ledger', `${problemHash(e)}.jsonl`)));
    receipts.push(...readLines(join(out, 'ledger', 'identity.jsonl')));
    return { envelopes: chainEnvelopes, blobs, receipts, now: at };
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
        const state = reduce(inputFor(hash, now())!);
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
    // QX-17: the coin log of the tracker that is the coin's home, and the balances it says it computed, held only where they reproduce here.
    if (options.coin !== false) {
      const wk = (await getJson(`${t}.well-known/quilt`)) as { coin?: (CoinParams & { home?: string | null; extension?: string }) | null } | null;
      const published = wk?.coin ?? null;
      if (published && (published.home === 'here' || published.home === undefined || published.home === null)) {
        const chain = await takeChain(`${t}coin/events`, COIN_LOG, join(out, 'ledger', 'coin.jsonl'), 'coin');
        if (chain) {
          const held = chain.lines[chain.lines.length - 1];
          report.coin = { lines: chain.lines.length, added: chain.added, head: held?.seq ?? null, reproduced: null };
          const state = (await getJson(`${t}coin/state`)) as { head: { seq: number; hash: string } | null; at: string; balances: Record<string, BalanceView> } | null;
          const same = state && ((state.head === null && !held) || (state.head !== null && held !== undefined && state.head.seq === held.seq && state.head.hash === held.hash));
          if (state && same) {
            const { home: _home, extension: _ext, ...params } = published;
            const inputs: ReduceInput[] = [];
            for (const hash of index.keys()) {
              const input = inputFor(hash, state.at);
              if (input) inputs.push(input);
            }
            try {
              const layer = challengeLayer({ problems: inputs, now: state.at, coin: chain.lines });
              const folded = coinLayer({ layer, params: params as CoinParams, receipts: chain.lines, now: state.at });
              const mine = Object.fromEntries(folded.balances());
              const roots = [...new Set([...Object.keys(mine), ...Object.keys(state.balances)])].sort();
              const differs = roots.find((r) => JSON.stringify(mine[r] ?? null) !== JSON.stringify(state.balances[r] ?? null));
              // The way back: every credit the ledger kept is what the chain holds at that deposit, or the balances are not kept.
              const credits = folded.credits();
              let wrongCredit: string | null = null;
              if (credits.length && !options.chain) wrongCredit = `${credits.length} credit${credits.length === 1 ? '' : 's'} on the ledger and no chain to check them against`;
              for (const c of credits) {
                if (wrongCredit) break;
                const d = await options.chain!.depositAt(c.deposit);
                if (!d.made || d.root.toLowerCase() !== c.root.toLowerCase() || BigInt(d.amount) !== BigInt(c.amount)) wrongCredit = `the credit for deposit ${c.deposit} (${c.amount} to ${c.root}) is not what the chain holds`;
              }
              report.coin.credits = credits.length;
              if (wrongCredit !== null) {
                report.refused.push(`coin: ${wrongCredit}, at head ${state.head?.seq ?? 0} from ${t}`);
                report.coin.reproduced = false;
              } else if (differs === undefined) {
                mkdirSync(join(out, 'coin'), { recursive: true });
                writeFileSync(join(out, 'coin', 'balances.json'), JSON.stringify({ head: state.head, at: state.at, params: published, balances: state.balances }, null, 2) + '\n');
                report.coin.reproduced = true;
              } else {
                report.refused.push(`coin: the balances at head ${state.head?.seq ?? 0} from ${t} do not reproduce here (${differs})`);
                report.coin.reproduced = false;
              }
            } catch (err) {
              report.errors.push(`coin: ${(err as Error).message}`);
            }
          }
        }
      }
    }
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
  const hiddenBy = hiddenFromIdentity(identityLines);
  writeFileSync(join(out, 'index.json'), JSON.stringify({ quilt: 1, mirrored: nowIso, problems: [...index].map(([hash, v]) => ({ hash, ...v, hidden: hiddenBy.get(hash) ?? [] })) }, null, 2) + '\n');
  // QX-12: the head of every chain held here, stamped outside the ledger when asked.
  if (options.anchor) {
    const heads: Head[] = [];
    const headOf = (file: string, problem: string) => {
      const lines = readLines(file);
      const last = lines[lines.length - 1];
      if (last && typeof last.hash === 'string' && typeof last.seq === 'number') heads.push({ problem, seq: last.seq, hash: last.hash });
    };
    for (const p of report.problems) headOf(join(out, 'ledger', `${p.hash}.jsonl`), p.hash);
    headOf(join(out, 'ledger', 'identity.jsonl'), 'identity');
    headOf(join(out, 'ledger', 'coin.jsonl'), 'coin');
    report.anchors = await anchorHeads({ out, heads, ...(typeof options.anchor === 'object' && options.anchor.calendars ? { calendars: options.anchor.calendars } : {}), fetchImpl: f, now });
  }
  return report;
}
