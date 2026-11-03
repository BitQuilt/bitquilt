/**
 * The node's store of chained logs and what they name (WORKSHOP.md section 2, one peer): the envelopes it holds, the
 * blobs, and the lines of each log, a problem's under its hash and the identity log under IDENTITY_LOG. A home's cache
 * folder is one (`FileChains`, what a person's node keeps and serves); the tracker's store answers the same methods, so
 * a door and a node can be over one store, and what the door admits is what the node serves and keeps. Nothing here
 * reads the network: the resolver does, and keeps what it reads here.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Envelope, type Hash, type Receipt, IDENTITY_LOG, isHash } from '@bitquilt/core';

/** What a node holds and serves to anyone by hash: problems, ledgers, blobs, and the bytes of all three. */
export interface Held { problems: number; ledgers: number; blobs: number; bytes: number }

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

/** The cache under a home: `<hash>.json` an envelope, `ledger/<hash>.jsonl` a problem's chain, `identity.jsonl` the identity log, `blobs/<hash>` a blob. */
export class FileChains implements Chains {
  private readonly cache: string;

  constructor(home: string) {
    this.cache = join(home, 'cache');
    for (const d of [this.cache, join(this.cache, 'blobs'), join(this.cache, 'ledger')]) mkdirSync(d, { recursive: true });
  }

  private logFile(log: Hash): string {
    return log === IDENTITY_LOG ? join(this.cache, 'identity.jsonl') : join(this.cache, 'ledger', `${log}.jsonl`);
  }

  envelopeOf(hash: Hash): Envelope | null {
    const f = join(this.cache, `${hash}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Envelope) : null;
  }

  putEnvelope(hash: Hash, envelope: Envelope): void {
    writeFileSync(join(this.cache, `${hash}.json`), JSON.stringify(envelope));
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
      if (!name.endsWith('.json') || !isHash(name.slice(0, -5))) continue;
      try {
        out.push({ hash: name.slice(0, -5) as Hash, envelope: JSON.parse(readFileSync(join(this.cache, name), 'utf8')) as Envelope });
      } catch {
        /* a file that is not an envelope is not listed */
      }
    }
    return out;
  }

  getBlob(hash: Hash): Uint8Array | null {
    const f = join(this.cache, 'blobs', hash);
    return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
  }

  putBlob(hash: Hash, bytes: Uint8Array): void {
    writeFileSync(join(this.cache, 'blobs', hash), bytes);
  }

  lines(log: Hash): Receipt[] {
    const f = this.logFile(log);
    return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Receipt) : [];
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
    const problems = count(this.cache, (name) => name.endsWith('.json') && name !== 'identity.jsonl');
    const ledgers = count(join(this.cache, 'ledger'), (name) => name.endsWith('.jsonl'));
    const blobs = count(join(this.cache, 'blobs'), () => true);
    return { problems: problems.n, ledgers: ledgers.n, blobs: blobs.n, bytes: problems.bytes + ledgers.bytes + blobs.bytes };
  }
}
