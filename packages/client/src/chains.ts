/**
 * The node's store of chained logs and what they name (NODE.md section 2): the envelopes it holds, the blobs, and the
 * lines of each log, a problem's under its hash and the identity log under IDENTITY_LOG. A home's cache folder is one
 * (`FileChains`, what a person's node keeps and serves); the tracker's store answers the same methods, so a door and a
 * node can be over one store, and what the door admits is what the node serves and keeps. Nothing here reads the
 * network: the resolver does, and keeps what it reads here.
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { type Envelope, type Hash, type Receipt, IDENTITY_LOG, isHash } from '@bitquilt/core';

/** What a node holds and serves to anyone by hash: problems, ledgers, blobs, and the bytes of all three. */
export interface Held {
  problems: number;
  ledgers: number;
  blobs: number;
  bytes: number;
}

export interface Chains {
  envelopeOf(hash: Hash): Envelope | null;
  putEnvelope(hash: Hash, envelope: Envelope, at: string): void;
  listEnvelopes(): { hash: Hash; envelope: Envelope }[];
  getBlob(hash: Hash): Uint8Array | null;
  putBlob(hash: Hash, bytes: Uint8Array): void;
  /** The lines of a log, oldest first: a problem's by its hash, the identity log by IDENTITY_LOG. */
  lines(log: Hash): Receipt[];
  /** Appends lines to a log as given, after the ones held; the caller has checked they grow it. */
  appendLines(log: Hash, lines: Receipt[]): void;
  held(): Held;
}

/**
 * A hash as a file name: `sha256-<hex>`, the colon of `sha256:<hex>` a hyphen. A colon in a name on Windows writes an
 * alternate stream of a file called `sha256`, which a read by name finds and no listing shows, so a node there held
 * everything and listed nothing. Names from before 3 November 2026 carried the colon; a store renames them when it
 * opens.
 */
const fileName = (hash: Hash): string => hash.replace(':', '-');
const hashOfName = (name: string): Hash | null => {
  const hash = name.replace(/^sha256-/, 'sha256:');
  return isHash(hash) ? (hash as Hash) : null;
};

/**
 * The cache under a home: `sha256-<hex>.json` an envelope, `ledger/sha256-<hex>.jsonl` a problem's chain,
 * `identity.jsonl` the identity log, `blobs/sha256-<hex>` a blob.
 */
export class FileChains implements Chains {
  private readonly cache: string;

  constructor(home: string) {
    this.cache = join(home, 'cache');
    for (const d of [this.cache, join(this.cache, 'blobs'), join(this.cache, 'ledger')]) {
      mkdirSync(d, { recursive: true });
      // The old names, with the colon, renamed once; a name another process renamed first, or one that is not a file of
      // ours, is left.
      for (const name of readdirSync(d)) {
        if (!name.startsWith('sha256:')) continue;
        try {
          renameSync(join(d, name), join(d, `sha256-${name.slice('sha256:'.length)}`));
        } catch {
          /* renamed between the listing and now, or not ours */
        }
      }
    }
  }

  private logFile(log: Hash): string {
    return log === IDENTITY_LOG
      ? join(this.cache, 'identity.jsonl')
      : join(this.cache, 'ledger', `${fileName(log)}.jsonl`);
  }

  envelopeOf(hash: Hash): Envelope | null {
    const f = join(this.cache, `${fileName(hash)}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Envelope) : null;
  }

  putEnvelope(hash: Hash, envelope: Envelope): void {
    writeFileSync(join(this.cache, `${fileName(hash)}.json`), JSON.stringify(envelope));
  }

  listEnvelopes(): { hash: Hash; envelope: Envelope }[] {
    const out: { hash: Hash; envelope: Envelope }[] = [];
    let names: string[] = [];
    try {
      names = readdirSync(this.cache).sort();
    } catch {
      return out;
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const hash = hashOfName(name.slice(0, -5));
      if (!hash) continue;
      try {
        out.push({ hash, envelope: JSON.parse(readFileSync(join(this.cache, name), 'utf8')) as Envelope });
      } catch {
        /* a file that is not an envelope is not listed */
      }
    }
    return out;
  }

  getBlob(hash: Hash): Uint8Array | null {
    const f = join(this.cache, 'blobs', fileName(hash));
    return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
  }

  putBlob(hash: Hash, bytes: Uint8Array): void {
    writeFileSync(join(this.cache, 'blobs', fileName(hash)), bytes);
  }

  lines(log: Hash): Receipt[] {
    const f = this.logFile(log);
    return existsSync(f)
      ? readFileSync(f, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Receipt)
      : [];
  }

  /** The file is made at the first append, lines or none, so a log read once is a ledger held. */
  appendLines(log: Hash, lines: Receipt[]): void {
    const f = this.logFile(log);
    const text = lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : '');
    if (existsSync(f)) appendFileSync(f, text);
    else writeFileSync(f, text);
  }

  held(): Held {
    const count = (dir: string, keep: (name: string) => boolean): { n: number; bytes: number } => {
      let n = 0;
      let bytes = 0;
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        return { n, bytes };
      }
      for (const name of names) {
        if (!keep(name)) continue;
        try {
          const st = statSync(join(dir, name));
          if (!st.isFile()) continue;
          n += 1;
          bytes += st.size;
        } catch {
          /* gone between the listing and the stat */
        }
      }
      return { n, bytes };
    };
    const problems = count(this.cache, (name) => name.endsWith('.json') && hashOfName(name.slice(0, -5)) !== null);
    const ledgers = count(join(this.cache, 'ledger'), (name) => name.endsWith('.jsonl'));
    const blobs = count(join(this.cache, 'blobs'), () => true);
    return {
      problems: problems.n,
      ledgers: ledgers.n,
      blobs: blobs.n,
      bytes: problems.bytes + ledgers.bytes + blobs.bytes,
    };
  }
}
