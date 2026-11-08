/**
 * The store a keeper keeps in (NODE.md section 2): envelopes, blobs, and the lines of each log, a problem's under its
 * hash, the identity log under IDENTITY_LOG and the coin log under COIN_LOG. The mirror's layout under its folder is
 * one (`MirrorFiles`); a tracker's store answers the same methods, as the client's cache does (`Chains` in
 * packages/client), so a node with `keep` and no door keeps with the same steps over its own store, the tracker's. The
 * shape is shared, not imported: the mirror imports the core and the tracker alone.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Envelope, type Hash, type Receipt, IDENTITY_LOG, isHash } from '@bitquilt/core';
import { COIN_LOG } from '@bitquilt/tracker';

export interface KeptStore {
  envelopeOf(hash: Hash): Envelope | null;
  putEnvelope(hash: Hash, envelope: Envelope, at: string): void;
  listEnvelopes(): { hash: Hash; envelope: Envelope }[];
  getBlob(hash: Hash): Uint8Array | null;
  putBlob(hash: Hash, bytes: Uint8Array): void;
  /** The lines of a log, oldest first. */
  lines(log: Hash): Receipt[];
  /** Appends lines to a log as given, after the ones held; the keeper has checked they grow it. */
  appendLines(log: Hash, lines: Receipt[]): void;
}

/**
 * The mirror's files: `problems/<hash>.json`, `blobs/<hash>`, `ledger/<hash>.jsonl`, `ledger/identity.jsonl`,
 * `ledger/coin.jsonl`, as the header of mirror.ts lays them out and a client reads them raw.
 */
export class MirrorFiles implements KeptStore {
  constructor(readonly out: string) {
    for (const d of ['problems', 'blobs', 'ledger']) mkdirSync(join(out, d), { recursive: true });
  }

  private logFile(log: Hash): string {
    return join(
      this.out,
      'ledger',
      log === IDENTITY_LOG ? 'identity.jsonl' : log === COIN_LOG ? 'coin.jsonl' : `${log}.jsonl`,
    );
  }

  envelopeOf(hash: Hash): Envelope | null {
    const f = join(this.out, 'problems', `${hash}.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Envelope) : null;
  }

  putEnvelope(hash: Hash, envelope: Envelope): void {
    writeFileSync(join(this.out, 'problems', `${hash}.json`), JSON.stringify(envelope, null, 2) + '\n');
  }

  listEnvelopes(): { hash: Hash; envelope: Envelope }[] {
    const dir = join(this.out, 'problems');
    if (!existsSync(dir)) return [];
    const out: { hash: Hash; envelope: Envelope }[] = [];
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith('.json') || !isHash(name.slice(0, -5))) continue;
      try {
        out.push({
          hash: name.slice(0, -5) as Hash,
          envelope: JSON.parse(readFileSync(join(dir, name), 'utf8')) as Envelope,
        });
      } catch {
        /* a file that is not an envelope is not listed */
      }
    }
    return out;
  }

  getBlob(hash: Hash): Uint8Array | null {
    const f = join(this.out, 'blobs', hash);
    return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
  }

  putBlob(hash: Hash, bytes: Uint8Array): void {
    writeFileSync(join(this.out, 'blobs', hash), bytes);
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
}
