/**
 * docs/v2/READING.md section 5: "A set is named by the hash of the canonical JSON of its events' ids, sorted. Its
 * events are the reveals and runs the kind's rule took." The fold keeps each reveal's and each run's id beside it,
 * with the commit a reveal opened and the problem it was posted to, and this file holds those to the events of the
 * ledgers kept: every set of every fixture of reading 2, and the check sets of version 1's fixtures, which hold the
 * runs. The section goes on, "so a set is counted once however many versions show it": a set a version carries has
 * the name it had on the version before.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blobsOf, loadFixtures, loadReadings } from '../src/conformance.js';
import { type Event, eventId } from '../src/events.js';
import { type Hash, hashCanonical } from '../src/hash.js';
import { readLedger } from '../src/ledger.js';
import { type AcceptingSet, type Reveal, reduce } from '../src/reduce.js';
import { setEvents, setName } from '../src/standing.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const readings = loadReadings(join(dir, 'reading-2'));

/** The reveals of a set, the patch of a check or a score among them. */
function revealsOf(set: AcceptingSet): Reveal[] {
  return set.kind === 'agree' ? set.reveals : [set.patch];
}

describe('the ids the fold keeps', () => {
  it('are the ids of the events, in every set of every fixture of reading 2', () => {
    let sets = 0;
    for (const f of readings) {
      // Every event of the ledger by its id, with the log it is a line of.
      const events = new Map<Hash, { event: Event; log: Hash }>();
      for (const p of f.ledger.problems)
        for (const l of p.lines) events.set(eventId(l.event), { event: l.event, log: l.event.problem as Hash });
      for (const r of f.readings)
        for (const pl of readLedger(f.ledger, r.now).problems.values())
          for (const v of pl.fold.pieces) {
            if (!v.accepting) continue;
            sets++;
            for (const reveal of revealsOf(v.accepting)) {
              const posted = events.get(reveal.id);
              expect(posted?.event.type, f.name).toBe('reveal');
              expect(posted!.event.key, f.name).toBe(reveal.key);
              expect(reveal.problem, f.name).toBe(posted!.log);
              const commit = events.get(reveal.commit)?.event;
              expect(commit?.type, f.name).toBe('commit');
              expect(commit!.key, f.name).toBe(reveal.key);
              expect(commit!.piece, f.name).toBe(posted!.event.piece);
            }
          }
    }
    expect(sets).toBeGreaterThan(100);
  });

  it("are the runs' too, in the check sets of version 1's fixtures", () => {
    const fixtures = loadFixtures(dir).filter((f) => f.receipts.some((r) => r.event.type === 'run'));
    let checks = 0;
    for (const f of fixtures) {
      const ids = new Map(f.receipts.map((r) => [eventId(r.event), r.event] as const));
      const state = reduce({ envelopes: f.envelopes, blobs: blobsOf(f), receipts: f.receipts, now: f.now });
      for (const v of state.pieces) {
        for (const run of v.runs) expect(ids.get(run.id)?.type, f.name).toBe('run');
        if (!v.accepting || v.accepting.kind === 'agree') continue;
        checks++;
        const [patch, ...runs] = setEvents(v.accepting);
        expect(ids.get(patch!)?.type, f.name).toBe('reveal');
        expect(runs.map((id) => ids.get(id)?.type)).toEqual(['run', 'run']);
      }
    }
    expect(checks).toBeGreaterThan(0);
  });
});

describe("a set's name", () => {
  it("is the hash of its events' ids, sorted, whatever order the fold holds them in", () => {
    for (const f of readings)
      for (const pl of readLedger(f.ledger, f.readings[1]!.now).problems.values())
        for (const v of pl.fold.pieces) {
          const set = v.accepting;
          if (!set) continue;
          expect(setName(set), f.name).toBe(hashCanonical(setEvents(set).sort()));
          if (set.kind !== 'agree' || set.reveals.length < 2) continue;
          const turned = { ...set, reveals: [set.reveals[1], set.reveals[0]] as [Reveal, Reveal] };
          expect(setName(turned), f.name).toBe(setName(set));
        }
  });

  it('is one name for one set, on every version that shows it', () => {
    let carried = 0;
    for (const f of readings) {
      // Each name seen in the ledger, with its events and the problems that show a set of that name.
      const seen = new Map<Hash, { events: string; problems: Set<Hash> }>();
      const named = new Map<string, Hash>();
      for (const [hash, pl] of readLedger(f.ledger, f.readings[1]!.now).problems)
        for (const v of pl.fold.pieces) {
          if (!v.accepting) continue;
          const name = setName(v.accepting);
          const events = setEvents(v.accepting).sort().join(' ');
          const known = seen.get(name) ?? { events, problems: new Set<Hash>() };
          expect(known.events, f.name).toBe(events);
          expect(named.get(events) ?? name, f.name).toBe(name);
          known.problems.add(hash);
          seen.set(name, known);
          named.set(events, name);
        }
      for (const s of seen.values()) if (s.problems.size > 1) carried++;
    }
    // The versions and the forks among the fixtures carry sets, so the same name is read on more than one problem.
    expect(carried).toBeGreaterThan(0);
  });
});
