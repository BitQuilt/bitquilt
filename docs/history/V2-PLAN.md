# Version 2 of the core: the plan

Written 10 November 2026, before any of it is built, from the code as it stands at `4feb1a2`. This is a plan to read and decide on, not a specification; the specification is the document phase 1 writes. Nothing here changes a fixture, a hash or a receipt, and nothing is cut: every extension that stands today stands after it, inside the core or beside it.

**Where it stands.** On 11 November 2026 the maintainer decided the four questions of section 7. The gold and the lock are the reading's. Two versions made from the same one share one record. The reading is numbered and frozen late. The build begins at once, so phase 0's wait is dropped; the freeze still waits as phase 7 says. Phase 1 was written that day: [the wire](../v2/WIRE.md), frozen, and [reading 2](../v2/READING.md), a draft. Both name each rule's present home and copy none, where this plan said word for word, so a rule keeps one text until the switch. Phase 2 was done that day too: the fixtures are under `packages/core/fixtures/reading-2`, and of version 1's fixtures one piece's state differs, which reading 2's section 11 names. Phase 3 began that day: the draw and the verifier kinds are the core's, in `packages/core/src/sortition.ts` and `kinds.ts`, then the stake, the gold and standing, in `stake.ts`, `gold.ts` and `standing.ts` there, then the trace, the proposed pieces and the inherited squares, in `trace.ts`, `propose.ts` and `inherit.ts`, with the shapes of what a reader is handed in `layer.ts`, then the pass over them all, the challenge window with it, as `read` in `read.ts`, and the tracker's layer calls it there and keeps what the door asks. The fixtures of reading 2 are held to the core alone since: `packages/core/src/ledger.ts` reads a fixture's ledger with no store, and `pnpm conform:2` runs every one. The fold keeps each commit's, reveal's and run's id since, so a set has the name reading 2's section 5 gives it, the fixtures carry it, and they were said again over their own ledgers by `packages/core/fixtures/say-again.ts` with no other answer changed. The read is laid out in the reading's eight steps since, sections 2 to 9, and the grounds are read before the sets and with them: the one place the order changed what the read says, held by the fixture `grounds-1`, with no answer over the ledgers kept before it changed. The departures of reading 2's section 12 follow, one a pull request. The first is done: a line has one record, and the read folds each version over it, in `packages/core/src/line.ts`, held by the fixture `line-1`, with eight of the fixtures kept answering differently, each named in their README. This one changes what the public tracker's layer says before phase 6, which section 4 did not foresee: an older version shows the work posted to a later one, and may be complete through it. It writes no receipt, so the read before it is the same function of the same ledger. The coin's code is as it was: an escrow already followed its line ([QX-17](../ext/QX-17.md) section 8), and what it reads of a version, whether it is complete, is what widened; the coin is read again in phase 5. The third departure was done that day too, the lease and the window of the version an event names, in `packages/core/src/reduce.ts`, `line.ts` and `kinds.ts` there, held by the fixture `lease-1` and the two kept beside it, with no fixture kept answering differently: it changes what the layer says only of a line whose versions differ in their lease, their window or their size of patch. The fourth was done that day too, a whole line reached, in `packages/core/src/inherit.ts`, held by the fixture `reach-1`, with no fixture kept answering differently: a fork reaches the earlier versions of its source and those made beside it, and reads the `from` every version of its own line names, and [QX-23](../ext/QX-23.md) section 1 was amended with it. The fifth was done that day too, a challenge across a line, in `packages/core/src/read.ts` and `gold.ts`, held by the fixture `across-1`, with seven of the fixtures kept answering differently, each named in their README: a piece says `challenged` at every version that holds it while a challenge on it is open at any, and a gold miss is challenged at any of them, and [QX-1](../ext/QX-1.md) section 2 and [QX-16](../ext/QX-16.md) section 4 were amended with it. The rest of this document is as it was written.

## 0. Why

Version 1 was frozen around agreement: a square is two reveals that agree. Twenty-three numbers have been registered in [EXTENSIONS.md](../EXTENSIONS.md) since, and most of what a map shows is now decided by them. That has three costs.

- **Two maps.** A core client and the tracker say different things of the same piece. [CORE.md](../CORE.md) section 10 calls the core's answer coarse on purpose, and a problem's state carries both.
- **Two folds.** The tracker's layer rebuilds, in seven phases over the core's fold, what one fold would know. The fault of 10 November 2026 came from that seam: a set carried along `prev` was counted once for each version held, in standing, in the strikes and in the coin ([QX-1](../ext/QX-1.md) section 2 and [QX-17](../ext/QX-17.md) section 8, both amended that day).
- **The wrong centre.** BitQuilt keeps every reading with what it rests on. The core says agreement, and the record, the trace and the proposed piece each came in as an extension.

A freeze protects the people who wrote a client from the document. While the project is quiet there are none outside this repository, so the freeze costs least to break now and most after an announcement.

## 1. Eight commitments

Each of these, given up, is a reason to stop and argue again.

1. **The record first.** The fold's first product is each piece's record: every valid reading in receipt order, with its signer, its vendor, its seat and what it rests on. A square is a view over the record, drawn by the piece's verifier kind. Two readings that differ are both kept, and neither is a fault of the fold.
2. **The wire is frozen and the reading is numbered.** The forms, the envelope, the piece hash, the event line, the receipt, the chained line and the link are frozen at once, as they are. The reading, which is what the fold says of those bytes, carries a number as the gate does (`gate/2`), and a state names the reading it was made by. A change to the reading changes no hash and no signature.
3. **One fold, one state for each piece.** There is no layer over a fold. A piece has one state, and no client holds a coarser one.
4. **Everything counted is named by an event's id.** A set is named by the ids of the events that made it. Standing, a strike, a lock's forfeit and the coin read a set by that name, so nothing is counted for each place it is seen.
5. **A problem is a line, and a square is read across lines.** The versions of a problem under one owner are one line with one record for each piece. Across a fork, which has another owner, the record is not folded: a final square is read where it was made.
6. **The coin stays outside.** The fold reads no balance and no chain. What it needs from outside reaches it as a word on a receipt's wrapper, as a coin lock does today.
7. **A finished problem before a frozen reading.** The reading is not frozen until people outside the house have finished problems under it. One surface moves first, the hosted connector, and the others follow it.
8. **Version 2 reads version 1's ledger.** No receipt is rewritten, no envelope is published again, and every square that stands on the public tracker stands after the switch.

## 2. What the core holds

The test for each number: does a client that ignores it say a different record or a different map of some problem? Where it does, the number is not an extension.

| Number | What it is | In version 2 |
| --- | --- | --- |
| QX-1 | The challenge window, standing, sortition | The reading |
| QX-2, QX-3, QX-10, QX-20 | The `judge:n`, `human`, `attest` and `record:n` kinds | The reading, each a view over the record |
| QX-11 sections 1 to 5 | Chained lines | The wire |
| QX-15 | The lock, and what it does to free standing | The reading; the stake rule at the door stays admission |
| QX-16 | The owner's gold | The reading, since a miss strikes a set |
| QX-19 | The trace, and a reading that rests on nothing | The reading |
| QX-22 | Proposed pieces | The reading, as part of the record |
| QX-23 | Inherited squares | The reading, as the reach |
| QX-4, QX-5, QX-6, QX-7, QX-18 | Seeding, the offer's order, the hide, the stamp, the witness | Beside, as admission and a tracker's own view; the words QX-18 puts on a receipt are read as they are now |
| QX-12, QX-13, QX-14, QX-21 | Anchoring, the announce, the relays, the peers' pull | Beside |
| QX-17, QX-11 section 7 | The coin, and the door out | Beside, reading the fold's sets by their ids |
| QX-8, QX-9 | Reserved | Open, as they are |

Two rows are judgement and are in section 7: the gold and the lock.

## 3. The reading, step by step

`state = read(ledger, now)`, a pure function. The ledger is the identity log and, for every problem a reader holds, its envelopes, blobs and receipts. The state names the heads it was read over, as the coin's state does today, so two readers with the same heads say the same state.

1. **Check.** Every chain, envelope, blob and signature, as version 1 checks them. Problems are gathered into lines.
2. **The record.** For each line and each piece, every event that counts, in receipt order, with the root it counts for as relations stood at its receipt. What version 1 drops is dropped.
3. **The grounds.** Each reading with its trace, and the readings that rest on nothing set aside.
4. **The sets.** Each kind's rule reads the record and names its sets by their events' ids.
5. **Standing.** One credit for each reveal in a set, the locks and every move. Steps 4 and 5 are brought to a fixed point, as the layer brings them now, since a panel is drawn by standing.
6. **The decisions.** One pass in receipt order over the locks, the golds, the challenges and the verdicts. A strike is one strike wherever the set is seen.
7. **The reach.** For each piece a fork keeps, the final square it has on a problem the fork reaches.
8. **The state.** One state for each piece, the record beside it, and the output.

`next` reads this state and is otherwise as it is.

## 4. The order of the build

Each phase leaves the repository passing every check, and nothing live changes before phase 6.

- **Phase 0, the wait.** No phase after the first begins until one problem has been finished on the public tracker by people outside the house. What that problem shows goes into the reading before it is written down.
- **Phase 1, the documents.** Two documents from the ones that stand: the wire, frozen, which is CORE.md sections 1 to 5, 8 and 11 with QX-11 sections 1 to 5, word for word where it can be; and reading 2, a dated draft, written from the extension documents this plan moves. No code.
- **Phase 2, the layer written down.** The tracker's layer, as it is, is run over every fixture and over the ledgers its own tests build, and what it says is kept as fixtures. These are the law for the port. A version-1 fixture holds no extension's event, so its states should stand unchanged; where one would not, the difference is listed and argued before any code is written.
- **Phase 3, the fold.** The new fold is written in the core beside version 1's, pure, by moving one extension's rules at a time out of the tracker, a pull request each, with phase 2's fixtures passing at every step. The tracker calls the core for each rule as it moves, so the layer thins until it is gone.
- **Phase 4, the second implementation.** The Python implementation is written again from reading 2 alone. Each sentence the two read apart is a clarification to the document, as before.
- **Phase 5, the coin and the keepers.** The coin's layer, the mirror and the bridge's jobs read the fold's sets by their ids. No parameter of the coin moves.
- **Phase 6, the switch.** The tracker answers one state for each piece. The hosted connector reads it first, then the command line, the page, the card and the Mac app, which share one client package. Rule 1 of [AGENTS.md](../../AGENTS.md) is written again to say the wire is frozen and the reading is numbered.
- **Phase 7, the freeze.** Reading 2 is frozen when problems have been finished under it by people outside the house, both implementations agree on every fixture, and a month has passed with no clarification.

## 5. What does not change

- Canonical JSON, the hashes, the keys and signatures, the envelope, the piece hash, an event's id, the receipt and the chained line.
- Every receipt on every chain, and every square that stands.
- The gate, and the rule that other people's words reach a model only as quoted text with the signer named.
- The coin's rules and parameters, and the two contracts.
- Every extension's behaviour, apart from the differences section 7 names.

## 6. What it costs

Phase 3 is the weight: the layer's rules are about a dozen files of the tracker, each with its tests, and each moves under rule 2, with no clock, file or network. Phase 4 is a rewrite of the second implementation. Phases 1 and 2 are small and are the ones that make the rest safe. None of it shows on a map, so it is weighed against the work that does.

## 7. Decisions for the maintainer

1. **The gold and the lock.** By the test in section 2 both are the reading's: a gold miss strikes a set, and a lock moves the free standing a challenge is staked from. The other course keeps them beside and lets a core client's map be coarse where they act. The plan takes the first.
2. **Two versions from one.** Where an owner signs two versions from the same one, version 1 gives each its own events. Under commitment 5 they share one record for each piece they both keep. This is the one place a map may differ.
3. **A numbered reading or a second freeze.** The plan numbers the reading and freezes it late. The other course freezes all of version 2 at once, as version 1 was.
4. **When.** The plan waits on a finished problem and ends before any announcement. Phase 1 alone could be written sooner.

## 8. What it leaves open

- Independence from the agreement graph (QX-8) and evidence a machine can check (QX-9). With the record first, each becomes a view over the record and needs no change to the wire.
- A reader that holds only some of a ledger. The state names its heads, and a reader with fewer chains says so; what such a reader may conclude of a panel's draw is not decided here.
- What a version-1 client is told after the switch. None is known outside this repository.
