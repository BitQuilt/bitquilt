/**
 * docs/v2/READING.md section 3: the record says of each reading "how it counts, one of: `counted`, in a set or toward
 * one; `kept`, valid and counting for nothing, with the reason, such as a root related to the owner or a second
 * reading from one vendor; `aside`, set aside under section 4; `struck`, with the decision that struck it. Nothing
 * valid is left off the record, and a reading that does not count says why." This file holds what the read says of
 * each reading to the fold it says it of, over every ledger of reading 2 kept: where a set stands its events are the
 * readings counted and no other, a record piece's standing readings are its counted, every reading the fold holds is
 * on the record, one set aside is one the piece names, and one struck names a challenge or a gold reveal of its
 * ledger. The words for each reason are a closed list, and each a ledger shows is counted here.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadReadings } from '../src/conformance.js';
import { eventId } from '../src/events.js';
import type { Hash } from '../src/hash.js';
import { readLedger } from '../src/ledger.js';
import { byAtThenId } from '../src/plain.js';
import { WHY } from '../src/readings.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const fixtures = loadReadings(join(dir, 'reading-2'));
const words = new Set<string>(Object.values(WHY));
const sorted = (ids: Iterable<Hash>) => [...ids].sort();

describe('how each reading counts (READING.md section 3)', () => {
  it('agrees with the fold over every ledger of reading 2', () => {
    const seen = new Map<string, number>();
    let readings = 0;
    for (const f of fixtures) {
      const types = new Map<Hash, string>();
      for (const p of f.ledger.problems) for (const l of p.lines) types.set(eventId(l.event), l.event.type);
      for (const r of f.readings)
        for (const pl of readLedger(f.ledger, r.now).problems.values())
          for (const p of pl.pieces) {
            const at = `${f.name}, ${p.name} at ${r.now}`;
            const v = pl.fold.byHash.get(p.hash)!;
            const ids = p.readings.map((x) => x.id);
            // Each reading once, in receipt order, and every reveal the fold holds among them.
            expect(new Set(ids).size, at).toBe(ids.length);
            expect(
              [...p.readings].sort(byAtThenId).map((x) => x.id),
              at,
            ).toEqual(ids);
            for (const reveal of v.reveals) expect(ids, at).toContain(reveal.id);
            const held = new Set(v.reveals.map((x) => x.id));
            for (const x of p.readings) {
              readings++;
              expect(types.get(x.id), at).toBe('reveal');
              // Counted says no reason, and anything else says one of the list.
              expect(x.why === null, at).toBe(x.counts === 'counted');
              if (x.why !== null) {
                expect(words.has(x.why), `${at}: ${x.why}`).toBe(true);
                seen.set(x.why, (seen.get(x.why) ?? 0) + 1);
              }
              // The fold holds what is counted or kept beside it, and not what is set aside or struck.
              if (x.counts === 'aside' || x.counts === 'struck') expect(held.has(x.id), at).toBe(false);
              if (x.counts === 'counted') expect(held.has(x.id), at).toBe(true);
              // A struck reading names the decision, a challenge or a gold reveal on its ledger, and no other does.
              expect(x.by !== null, at).toBe(x.counts === 'struck');
              if (x.by !== null) expect(['challenge', 'gold_reveal'], at).toContain(types.get(x.by));
            }
            // The keys the piece says were set aside are the keys of its readings set aside (QX-19 section 4).
            const aside = p.readings.filter((x) => x.counts === 'aside').map((x) => x.key);
            expect([...new Set<string>(aside)].sort(), at).toEqual([...new Set<string>(p.aside)].sort());
            const counted = sorted(p.readings.filter((x) => x.counts === 'counted').map((x) => x.id));
            // A record piece counts the readings that stand (QX-20 section 2).
            if (p.record) expect(counted, at).toEqual(sorted(p.record.standing.map((x) => x.id)));
            // Where a set stands, its reveals are the readings counted: the two that agree, the one a panel ranked
            // first, the one attested, the patch two runs passed.
            const set = v.accepting;
            if (set)
              expect(counted, at).toEqual(sorted(set.kind === 'agree' ? set.reveals.map((x) => x.id) : [set.patch.id]));
          }
    }
    expect(readings).toBeGreaterThan(1000);
    // The ledgers kept show these reasons, each at least once.
    for (const why of [
      WHY.owner,
      WHY.vendor,
      WHY.vendorInSet,
      WHY.member,
      WHY.earlier,
      WHY.differs,
      WHY.late,
      WHY.ranked,
      WHY.void,
      WHY.seat,
      WHY.aside,
      WHY.challenge,
      WHY.gold,
    ])
      expect(seen.get(why) ?? 0, why).toBeGreaterThan(0);
    // And none is a reading the read could say nothing more of than that the fold does not hold it.
    expect(seen.get(WHY.gone) ?? 0).toBe(0);
  });
});
