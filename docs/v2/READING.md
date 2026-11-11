# Reading 2

Status: Draft, written 11 November 2026, and in force at the reference tracker since the switch of the plan's phase 6, that day: the fold is the reference core's `read`, a tracker answers one state for each piece, and the client reads it. This is the second of the two documents of version 2 of the core; the first is [WIRE.md](WIRE.md), which is frozen. [The plan](../history/V2-PLAN.md) gives the order of the build. [CORE.md](../CORE.md) section 6 is reading 1, frozen, and a client that reads by it still conforms to it. Section 12 below lists every place this draft departed from what the code did, each with the day it was closed, and what is still open.

**Abstract.** A reading is what a client says of the wire's bytes. Reading 1 is CORE.md section 6 with a layer of extensions over it, and it gives each piece two states. Reading 2 is one fold. Its first product is the record: every reading of a piece, in order, with its signer and what it rests on. A square is a view over the record, drawn by the piece's verifier kind. A problem's versions are one line with one record, everything counted is named by an event's id, and each piece has one state.

A rule this draft does not change keeps the home it has, and the section that uses it names that home. Nothing is written twice.

## 1. The function

```
state = read(ledger, now)
```

A pure function. `ledger` is the identity log's lines and, for every problem a reader holds, its envelope, the blobs it names and its log's lines ([QX-11](../ext/QX-11.md) section 2). `now` is a time. Two things reach the fold from beside the lines and are part of `ledger`: the founding standing a tracker publishes ([QX-1](../ext/QX-1.md) section 2, as amended 29 October 2026), and which of the reads a trace names the reader holds, with the length of each ([QX-19](../ext/QX-19.md) section 2). The state says `"reading": 2` and names `heads`, the head of each log it was read over (QX-11 section 4). Two readers with the same heads and the same `now` say the same state.

The fold has eight steps, sections 2 to 9, in that order.

## 2. The check, and the line

Each envelope, blob, signature and chain is checked as CORE.md section 6 checks them, under "Envelopes", and as QX-11 section 5 reads a chain. An envelope that fails makes its problem's input invalid, and the rest of the ledger is read without it.

**A line** is the versions of one problem under one owner: two problems are of one line where their chains along `prev` share a version (CORE.md section 2 says what `prev` is). A fork, which names another owner's problem in `from`, begins a line of its own. A line is named by the hash of its first version, the one whose `prev` is null. A reader that holds a line part of the way names it by the oldest version its chain reaches. A tracker takes a version only where it holds the one before, so it holds every line whole.

A line has one expansion, every piece any of its versions holds, and one owner, the root its versions' `owner` counts for. A version is a list of the line's pieces: its map shows those pieces, each with the line's record of it.

## 3. The record

For each line and each piece of it, the record is every event that names the piece and a version of the line, in the order CORE.md section 6 gives under "Order", each with the root it counts for under "Roots and delegates". What that section drops under "Drop" is not on the record.

**A reading** is a valid reveal. The record says of each reading:

- its signer, the root; its vendor (CORE.md section 6, "A vendor"); and its seat, where the receipt says one ([verifiers.md](../ext/verifiers.md) section 2);
- what it rests on, by its trace ([QX-19](../ext/QX-19.md) sections 1 to 3);
- how it counts, one of: `counted`, in a set or toward one; `kept`, valid and counting for nothing, with the reason, such as a root related to the owner or a second reading from one vendor; `aside`, set aside under section 4; `struck`, with the decision that struck it.

Nothing valid is left off the record, and a reading that does not count says why. The claims, commits, runs, candidates and ranks on the piece are on its record in the same order. The proposed pieces beside a problem ([QX-22](../ext/QX-22.md) sections 1 to 3) are on the line's record and move no state.

Clarified 11 November 2026, since `impl/python/FINDINGS-2.md`, entries 16 to 19, found the order of the reasons in no document. A reading in a set is `counted`. So is a reading none of its kind's reasons is true of, which counts toward a set. Each other reading the fold holds is asked the reasons of its piece's kind in the order written here, and says the first that is true of it, in the words the fixtures' README lists under "The reasons". Earlier and later are by receipt order on the piece.

- `agree`: its root is related to the owner. Then, where the piece has a set: it came after the set's last member, "the set was made before it"; it differs from the set on an agree field, which is asked of the set's first member; the set holds a reading from its vendor; its root is related to the root of a reading in the set; and where none of these is true, "the set was made without it". Where the piece has no set: an earlier reading from its vendor, not the owner's, agrees with it, "an earlier reading from its vendor says the same". A second reading from one root is `counted` while no set is made, though it completes none: a set is completed only by a reading whose root is unrelated to the root of every reading before it (CORE.md section 6, "An accepting set").
- `human`: as `agree`, with "it is not from a person's seat" asked straight after the owner, and the vendor asked of no reading. The piece is `disputed` over the readings from a person's seat alone, and none of the owner's.
- `attest`: its root is related to the owner; then, where the set is made, "the set was made before it". The readings after the one that made the set stay on the record.
- `judge:n`: its root is related to the owner; "the candidates were in before it", where as many candidates as the piece asks for came before it; "an earlier candidate gave the same return"; its root is related to the root of an earlier candidate, in the words "its root is related to the root of an earlier reading". A reading none is true of is a candidate, and a candidate is `counted` while its panel sits. Once the panel has decided, each candidate but the one ranked first says "the panel ranked another first", and where the panel is void each says "its panel is void".
- `record:n`: a reading that stands is `counted`. Another says that its root is related to the owner; that its root is related to the root of a standing reading before it, in the words "its root is related to the root of an earlier reading"; or else "the readings the piece asks for stood before it".
- `check` and `score`: every reading is `counted` until a set is made, and from then each but the set's patch says "the set was made on another patch".
- Any other verifier: every reading says "its piece asks a verifier this reading does not implement".

A reading the fold no longer holds says `aside` with section 4's reason, "it rests on nothing where another reading rests on the record", or `struck` with the reason of the decision that struck it, "a challenge held against its set" or "the owner's gold missed its set". Where neither took it, it is `kept` with "the fold without the struck events does not hold it": a reveal is matched to its key's first unrevealed commit, so the record with nothing struck can hold a reveal that the fold without the struck events lacks.

The lease and the window an event is held to are those of the version it names. A claim and a commit run for the lease of the version each names, and a patch is held to that version's size. A set's window is that of the version the event that completed it names: the later reveal or run of the two, the reveal of an attested piece, the rank that decided a panel. A panel's seats are held to the lease of the version the reveal that completed its candidates names, and a lock to the lease of the version it names. So each ends at one time on every version of the line.

## 4. The grounds

A reading that rests on nothing, where another on the piece rests on a kept read and the two differ, is set aside as QX-19 section 4 says. The seams between readings that differ are computed as that section computes them.

The grounds are read before the sets, so the reading that takes a set-aside one's place counts toward a set and is credited where the set is made. They are read again after the sets, since a piece that waits on another opens only once that one's set is made, and a dispute on it shows only then.

## 5. The sets

Each kind's rule reads the record and says whether a set stands.

| Kind | What makes a set | Its home |
| --- | --- | --- |
| `agree`, `check`, `score` | As version 1 | CORE.md section 6, "An accepting set" |
| `human`, `judge:n`, `attest` | Two counted reveals from persons' seats; the candidate a panel's majority ranks first; the actor's one reveal | verifiers.md section 2 |
| `record:n` | None: the first `n` readings from unrelated roots stand as given | [QX-20](../ext/QX-20.md) section 2 |
| Any other | None: the piece is `unknown` | CORE.md section 6 |

**A set is named** by the hash of the canonical JSON of its events' ids, sorted. Its events are the reveals and runs the kind's rule took. Standing, a strike, a lock's forfeit and the coin name a set by this hash and a reading by its event's id, so a set is counted once however many versions show it.

## 6. Standing

Standing is [QX-1](../ext/QX-1.md) section 2 as amended 10 November 2026: one credit for each reveal in a set, by the reveal's id. The pool is QX-1 section 3, and a version of a line is no other problem for it. Locked and free standing are [QX-15](../ext/QX-15.md) section 3. A burn on the coin log is credited on the door's word in its receipt's wrapper ([QX-17](../ext/QX-17.md) section 4), so where a tracker carries the coin its log's lines are in the ledger, and the fold reads the word and no balance. Sections 5 and 6 are brought to a fixed point, since a panel is drawn by standing and a panel's ranking makes a set. Section 4 is read with them: wherever the grounds set a reading aside after the sets, the sets and standing are brought to their fixed point again over what remains, and the fold stops when nothing new is set aside, in four passes at most.

## 7. The decisions

One pass in receipt order over the locks (QX-15 sections 1 to 3), the owner's gold and its reveals ([QX-16](../ext/QX-16.md) sections 1 to 5), and the challenges and verdicts (QX-1 sections 1 and 4 to 6). A decision names the set it is about. A strike is one strike: each root docked once, the set's events struck on the line's record, and every lock behind the set forfeited. A coin lock reaches the fold as the door's word on the receipt, and the fold reads no balance.

Since a piece has one record on its line, a challenge open on a piece shows at every version that holds the piece, and a gold miss is challenged at any of them.

## 8. The reach

A fork reaches the line of each problem its line's envelopes name in `from`, and what those lines reach, by [QX-23](../ext/QX-23.md) section 1. A piece the fork keeps, with no set of the fork's own and its inputs done, shows the square it has on a line the fork reaches, as QX-23 sections 2 and 3 say. Nothing is credited, struck or earned for it, and a square is read where it was made.

## 9. The state

Each piece has one state, of the fifteen the tracker's layer says today: `locked`, `unknown`, `open`, `in_flight`, `sealed`, `needs_verify`, `disputed`, `accepted_provisional`, `accepted` and `unreachable` (CORE.md section 6, "Per piece"), `challenged` (QX-1 section 7), `judging` (verifiers.md section 3), `recording` and `recorded` (QX-20 section 3), and `inherited` (QX-23 section 2). No name changes.

`disputed` says two readings from unrelated roots differ. Both are on the record with what each rests on and the seam between them, and neither is a fault of the fold.

Beside its state a piece says its kind and strength, its set's name or null, its record, its gold and whether it is verified (QX-16 section 6), its stake (QX-15 section 4), its grade and seams (QX-19 section 3, QX-20 section 3), and, where inherited, the problem where the square stands.

`complete` is as QX-23 section 4 says of the layer, and the output is CORE.md section 6, "Output", with the record document of QX-20 section 4.

## 10. next

`next` is CORE.md section 7, read over this state. What a tracker hands a key beyond it, the assisted next and the offer, stays the tracker's.

## 11. Conformance

A client conforms to reading 2 when it reproduces the state of every fixture of reading 2. The fixtures were made on 11 November 2026 in the plan's phase 2, from what the reference tracker's layer said that day, and [their folder's README](../../packages/core/fixtures/reading-2/README.md) gives their form and what they do not yet cover. The reference's `read` is held to every one with no tracker beside it, and `pnpm conform:2` runs them. A second implementation, written on 11 November 2026 from this document, the documents it cites and the fixtures alone, reproduces every one too (`impl/python`, run by `python3 impl/python/conform2.py`). [Its findings](../../impl/python/FINDINGS-2.md) list each place the words were not enough: sixty-one, six of them places a document and the fixtures say different things. Each is a clarification owed to this document, to one it cites or to the fixtures' README, and the findings' last section says which are made.

No fixture of version 1 holds an extension's event, and the layer was run over the twenty-four and the clarifications. Every state stands unchanged but one. Fixture 20 holds a piece whose verifier is `judge:5`, a kind version 1 does not know: version 1 says `unknown`, and reading 2 says `open`, since the kind is the reading's now (section 5) and the piece waits for candidates. The piece that waits on it stays `locked` in both, and `complete` and the output are the same.

## 12. Where this departs from what the code does today

Each of these is argued in phase 2, with a fixture, before the fold is written.

1. **One record for a line.** Until 11 November 2026 a version read its own events and its ancestors'. Under section 2 an older version's map shows work posted to a later version on a piece it keeps, and two versions made from the same one share a record. The read folds each version over its line's record now (`packages/core/src/line.ts`): the sets, a rank, a trace, a seed and the proposed pieces are read at every version that keeps the piece, whichever version each event names. An older version is complete once its pieces are final across the line, and a gold commitment still pending on it then has lapsed ([QX-16](../ext/QX-16.md) section 3). A fork's inherited piece names the source where the source keeps the piece, since the square stands there. The `core` state beside a piece is still version 1's, over the version's own chain. The stake rule, the locks, the golds and the challenges are read at the version each names, until item 5, and the lease and the window were the version's read until item 3. Eight of the fixtures kept answer differently, each named in the fixtures' README, and the fixture `line-1` holds the rule. Decided and done 11 November 2026.
2. **A line's name.** Until 11 November 2026 the coin named a line itself, by the oldest version a tracker holds, and named a set by its piece and the time it was made. The read names each problem's line now (`lineName` in `packages/core/src/standing.ts`), by its first version as section 2 says, and the coin reads that name and each set's from the read (`packages/tracker/src/coin.ts`). A tracker holds every line whole, so no escrow moved. Decided and done 11 November 2026.
3. **The lease and the window.** Section 3 takes them from the version an event names. Version 1 holds every event to the settings of the version read, whichever version of the chain the event names (`packages/core/src/reduce.ts`): the lease of a claim and of a commit, the size of a patch, and the window of a set. So where two versions of a line differ in them, the same claim, commit and set ended at a different time on each version's map. The read holds each to the version it names now, as section 3 says, the size of a patch among them, so that the line's record is one at every version; a piece's own lease is in its hash and was the same at every version already. The locks, the golds and the challenges were read at the version each names before this. A version whose line holds nothing beside its own chain, with one lease, one window and one size of patch across it, is reduced as version 1 reduces it. The `core` state beside a piece is still version 1's. None of the fixtures kept answers differently, since no line among them differed in its settings, and the fixtures `lease-1`, `lease-running` and `lease-windows` hold the rule. Decided and done 11 November 2026.
4. **A whole line reached.** Until 11 November 2026 a fork reached its source and the source's later versions. Under section 8 it reaches the source's line: an earlier version of the source and a version made beside it too, so a piece the source dropped, or one only the version beside it holds, shows on the fork the square it has there, since a square is read where it was made. The sources are those the fork's line's envelopes name, so an older version of a fork reads the `from` a later version of its line names, and a fork reaches no version of its own line (`packages/core/src/inherit.ts`, and [QX-23](../ext/QX-23.md) section 1 as amended that day). The source is still named first where it shows the square. The fixture `reach-1` holds each. Decided and done 11 November 2026.
5. **A challenge across a line.** Until 11 November 2026 a piece at one version did not say `challenged` while a challenge sat at another, and a miss was challenged where the gold is. Under section 7 a piece names its last challenge on the line at every version that holds it, and says `challenged` at each while that challenge is open; a miss is challenged at any of those versions, inside the window of the version the gold's reveal names, and the gold's stake waits on that decision (`packages/core/src/read.ts` and `gold.ts`, with [QX-1](../ext/QX-1.md) section 2 and [QX-16](../ext/QX-16.md) section 4 as amended that day). A challenge is still one event at one version, where it is listed and judged, and a gold is shown where it was made. Seven of the fixtures kept answer differently, each named in the fixtures' README, and the fixture `across-1` holds each. Decided and done 11 November 2026.
6. **A reading that counts for nothing.** Until 11 November 2026 the tracker showed such a reading and gave no reason. Under section 3 the record says of each reading how it counts, and a piece's view lists its `readings` in receipt order now (`packages/core/src/readings.ts`): each is named by its reveal's id and says `counted`, `kept`, `aside` or `struck`, with why where it counts for nothing, and a struck one names the challenge or the gold reveal that struck it. The reasons are a closed list, one sentence for each way a rule passes a reading over, so a second implementation says the same words. Nothing is decided there: each kind's rule made its set as before, and no piece's state moved. A tracker answers the readings beside each piece's state, and the page of a square says the reason under the reading. Every fixture kept gained the field and answers as it did without it, and the fixture `readings-1` holds each reason a single door can reach. Decided and done 11 November 2026.
7. **One state.** Until 11 November 2026 a tracker answered, beside each piece's state, a `core` field: version 1's state of the piece on the version's own chain. Under section 9 a piece has one state, and the field is gone from the read, from what a fixture keeps and from the state route (`packages/core/src/read.ts` and `ledger.ts`, and `packages/tracker/src/views.ts`). Nothing else moved: each piece's `state` is what it was, and what the field said of a reading an extension passed over is said by the piece's `readings` and its trace. A client that read the field reads the state, and the owner's sharpening reads the seams the tracker shows. Every fixture kept lost the field and answers as it did without it. This is the first step of the switch, and the client's own fold where no tracker answers is the next. Done 11 November 2026.
8. **The gold and the lock in the reading.** Today they are extensions a core client may ignore. Decided 11 November 2026.
9. **The grounds with the sets.** Until 11 November 2026 the code read the grounds once, after the fixed point of sections 5 and 6, which was not run again: a set made by the reading that took a set-aside one's place was credited too late to seat a panel on another problem, and the panel was void. Sections 4 to 6 are read together now, as section 6 says. No answer over the ledgers kept changed, and the fixture `grounds-1` holds both halves: the panel seated from that set, and a reading set aside on a piece that waited on the judged one. Done 11 November 2026.
10. **A reader with no tracker.** A Quilt that no tracker answers folds the chain it holds by reading 1 (`packages/client/src/resolver.ts`): it says no state this reading adds, and a set a decision struck still stands there. The ledger is what a reader holds (section 1), so it can ask the read of its one problem. The verify script did the same until 11 November 2026 and now reads a clone as a ledger of one problem (`packages/core/src/verify.ts`); what rests on another problem's chain, the standing behind a challenge or a gold, a panel's seats and an inherited square, it does not read. The Quilt's fold is open.

## 13. What this draft leaves open

- The output document of a problem with a `human`, `judge:n` or `attest` piece, which verifiers.md section 3 leaves to a later draft.
- A reader that holds only some of a ledger: what it may conclude of a pool or a panel's draw, and what two readers say who hold different reads.
- How the state names the founding standing and the reads it was made over, beside the heads.
- Independence from the agreement graph and evidence a machine can check (QX-8, QX-9): each a view over the record, with no change to the wire.
- What QX-23 section 6 and QX-20 section 6 leave open stays open.
