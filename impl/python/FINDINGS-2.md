# Findings: writing reading 2 from the documents and the fixtures alone

This is the record of what a stranger met when writing `read(ledger, now)` from the words. It was written from `docs/v2/WIRE.md`, `docs/v2/READING.md`, the documents READING.md cites (`docs/CORE.md`, QX-1, QX-15, QX-16, QX-17, QX-19, QX-20, QX-22, QX-23 and `docs/ext/verifiers.md`), the fixtures under `packages/core/fixtures/reading-2` as JSON with their `README.md`, and reading 1's Python beside this file. No TypeScript or JavaScript file was read or searched, in the packages, the tests, the scripts or the examples.

Where a document was not enough, the smallest reasonable assumption was made, and it is written here with the document and section concerned and the fixture that decided it. Where a fixture and a document disagree, the fixture was followed. Result: 91 of 91 fixtures pass, each at both of its times, and reading 1 still passes 39 of 39.

Each entry is one clarification READING.md, a cited document or the fixtures' README could carry. The entries a reader should look at first are under "Judged wrong, not thin". Entries 56 to 59 were checked against the fixtures again at the end of the work. The others say what the passing code does, and were not each checked again against a named fixture, so each is read against its fixture before it becomes a sentence of a document. The last section says which entries a document has answered since.

## What the documents were sufficient for

These were written from the words and the fixtures agreed with no guess.

- The line and its name, and one record for a line: READING.md sections 2 and 3.
- The checks of an event, the order of receipts, the roots and the relations: CORE.md section 6, as reading 1 has them.
- The body of a trace, the kept read, the passage and the seams' arithmetic: QX-19 sections 1 to 4.
- The seed, the draw's order and the seats' offers and lapses: QX-1 sections 4 and 5.
- The stake rule, the lock, what a piece asks and when a lock is live: QX-15 sections 1 to 3.
- The gold's commitment, its reveal, the match and the share: QX-16 sections 1 to 3.
- The record piece and the record document: QX-20 sections 2 and 4, with the small points in entry 44.
- The body of a proposal, its hash, what stands, and `worked` and `taken`: QX-22 sections 1 to 3.
- The inherited square, done elsewhere, and complete in the layer: QX-23 sections 2 to 4.

## The form of a fixture and of what is expected

The fixtures' README, `packages/core/fixtures/reading-2/README.md`.

1. **The form's home is a TypeScript file.** The README says the ledger's shape and the form of what is expected are in `packages/core/src/ledger.ts`. A second implementation cannot read it. The form here was taken from the README's field list and the JSON. The README should carry the whole form, key by key.
2. **The closed list of reasons is in a TypeScript file.** The README says "The reasons are a closed list, `WHY` in `packages/core/src/readings.ts`, and a second implementation says the same words." The thirteen here are the ones the fixtures hold: "a challenge held against its set", "the owner's gold missed its set", "the panel ranked another first", "it rests on nothing where another reading rests on the record", "an earlier reading from its vendor says the same", "its panel is void", "its root is related to the owner", "it is not from a person's seat", "it differs from the set on an agree field", "the set holds a reading from its vendor", "its root is related to the root of a reading in the set", "the set was made before it", "its root is related to the root of an earlier reading". A reason no fixture holds cannot be said from the words. READING.md section 3 should list them.
3. **The example is not the form.** The README's example shows `"unoffered": 0` and `"gold": 0`. Every fixture holds `unoffered` as a list of piece hashes and `gold` as an object of six counts: `committed`, `pending`, `verified`, `missed`, `overruled` and `lapsed`.
4. **The keys of the things listed are in no document.** A set, a challenge, a gold, a lock, a panel, a proposal, a view's `trace` and its `record` are described in prose or not at all. Their keys were taken from the JSON: `completedAt`, `decidedAt`, `recordedAt`, `coinId`, `forfeitedAt`, `restoredAt`, `parties`, `against`, `struck`, `order`, `seats` and the rest.
5. **A seed is bare hex.** A challenge's and a panel's `seed` is sixty-four hex characters with no `sha256:` before them, where every other hash in the file carries it. QX-1 section 4 does not say which.
6. **`kind`, `extension` and `strength`.** The words a view says for each verifier are the fixtures': `agree`, null, `agreed`; `check` and `score`, null, `reproduced`; `human`, `QX-3`, `agreed`; `judge`, `QX-2`, `judged`; `attest`, `QX-10`, `attested`; `record`, `QX-20`, `recorded`. A verifier no rule knows says null for all three, and its piece is `unknown`.
7. **Which view comes first.** "Pieces that say the same thing share one view." The views are in the order their first piece has in the file, and two views are the same where their canonical JSON is. The README says neither.
8. **`challenge` on a view.** The README says a view holds "the id of an open `challenge`". The fixtures keep the id of the last challenge on the piece after its decision too. QX-1 section 2 names `challenge_at`, which no fixture carries.
9. **`gold` and `verified` on a view.** They are said only at the version the gold names, and are null and false at another version of the line that keeps the piece (across-1, carried-12). No document says a gold is shown at one version where the set is shown at all.
10. **A set's `kind` is always `agree`.** verifiers.md says a layer's set carries `via`. No set in the fixtures carries `via`, and every set says `kind: "agree"`, a judge piece's and a human piece's among them.
11. **`standing` lists more than the README says.** "`standing` holds every root a line of the ledger counts for, and every owner." It holds the roots of the coin log's signers too (routes-2, coin-1).
12. **Which roots "a line counts for".** Read as: every root an event of the line's record was counted for, the events of extensions among them, each under the root it has at the end.
13. **The words of `refused`.** The reasons a problem is refused for are in no document. unfolded-1 holds the three forms seen: "envelope: not signed by its owner", "blob <name>: <hash> not present", and "envelope: " before the envelope's fault in CORE.md's words.
14. **No fixture holds a run.** The README says so. The `check` and `score` kinds are reading 1's code here and nothing in reading 2 holds them: a run's place in `readings`, in a set's `members` and in the pool is untested.

## READING.md section 3, the record and how a reading counts

15. **The documents READING.md names.** Section 5 cites QX-2, QX-3 and QX-10 as documents. The one file that says their rules is `docs/ext/verifiers.md`.
16. **Which reason a kept reading says.** A reading can fail several ways at once: its root related to the owner, its vendor in the set, its return apart from the set. The order the checks are asked in is in no document. Here: struck, then aside, then the owner, then, against the set, its root, its vendor and its agree fields, then "the set was made before it". The fixtures agree with that order and do not hold every pair.
17. **When a reading with no set counts "toward one".** Section 3 says `counted` is "in a set or toward one". Read as: on a piece with no set, the first reading of each unrelated root and vendor counts, and a later one from a root or vendor already heard is `kept` with "its root is related to the root of an earlier reading" or "an earlier reading from its vendor says the same".
18. **An attest piece's later readings.** The readings after the one that made the set say "the set was made before it" (verifiers-1). verifiers.md does not say an attest piece keeps them.
19. **A human piece.** A reading with no person's seat is `kept` with "it is not from a person's seat", and the piece is `disputed` only over the readings that have one. verifiers.md section 2 gives the seat and not what a reading without one says.

## READING.md section 4, the grounds

20. **Set aside on a record piece.** QX-19 section 4 sets aside a reading that rests on nothing. No reading of a record piece is set aside in the fixtures, whatever it rests on. QX-20 keeps every reading, and section 4 should say the grounds leave a record piece alone.
21. **Set aside on a piece still locked.** Whether the grounds set a reading aside on a piece whose inputs are not done is unsaid. Here they do, since the record is the line's and a lock is one version's.
22. **`aside` twice.** A view's `aside` is the keys of the readings set aside, sorted. Its `trace.aside` is their reveal ids, and it is empty unless the core's fold leaves the piece unlocked. The two lists differ in what they hold and in when they are said.
23. **Seams over "the core's fold".** QX-19 section 4 computes a seam "over the core's fold where the layer has set a reading aside". The fixtures show those seams only where reading 1 would leave the piece unlocked: each input of a kind the core knows, with the core's own set and its window closed. The sentence should say the lock is reading 1's.
24. **Where seams are shown.** They are shown on a record piece over its standing readings, on a `disputed` piece, on a judge piece whose panel is void, and under an `inherited` state over the fork's own readings. QX-19 names the first two.
25. **Which rest a seam shows.** Where a reading rests a field on several passages, the seam shows the first rest of the field in the trace's order. QX-19 section 4 does not say.
26. **`passage` is null in every fixture.** The ledgers hold the lengths of the reads and not their bytes, so a seam's passage cannot be said. The README should say the passage is not held to.
27. **`traced` for a set.** It is `both`, `one` or `none` by the members that rest on a kept read, and null where the piece has no set in a state that shows one. A set of one reveal says `none` or `one`.

## READING.md section 5, the sets

28. **`output` with a layer's kind.** `output` is null unless every piece of the problem is of a kind the core knows, `agree`, `check` or `score`, though the layer calls the problem complete. A problem with a record piece says `record_output`, and one with a judge, human or attest piece says neither. Section 9 should say so.
29. **A panel on every version.** A panel is listed at every version of the line that holds its piece. A challenge is listed only at the version it was posted to (lease-1, across-1). Section 3 says both are read over the line's record and not where each is shown.
30. **A panel's `order` is the whole pool.** `order` holds every root of the pool in the draw's order, not the seats alone, and a panel with an empty pool is `void` with an empty order. Its `outcome` says `open`, `decided` or `void`, and `winner` is the winning reading's digest. verifiers.md gives none of the words.
31. **`unoffered`.** It is the hashes of the judge pieces whose panel is not decided, in file order. No document names it.

## READING.md section 6, standing and the fixed point

32. **"Four passes at most."** Section 6 brings the sets and standing to a fixed point. Whether a panel is drawn over the credits of the pass before or of the pass it is in is unsaid. Here a panel is drawn over the pass before, the first pass draws none, and six passes are allowed. Every fixture settles within four.
33. **The fixed point comes before the pass.** Section 6's fixed point is reached before section 7's pass over the decisions. Whether a strike in that pass draws a panel again is unsaid. Here it does not.
34. **A credit's instant.** A credit counts from its set's completion. A judge piece credits the winner alone, and a record piece and an attest piece credit none. verifiers.md says the attest piece's and QX-20 the record piece's. The judge piece's is the fixtures'.
35. **A burn and a coin lock.** QX-17 section 4 credits a burn "on the door's word in its receipt's wrapper". The word's key and form are the fixtures' (coin-schedule-1): the wrapper's `standing` for a burn, and the coin's id for a lock in coin.
36. **A stake rule is its version's.** A `stake_rule` holds at the version it names and not across the line (carried-8). QX-15 section 1 was written before a line had one record, and should say it.
37. **The problem's `stake`.** It is the last rule received by `now`, as `{min, pieces}`, with `pieces: null` where the rule names none.
38. **A lock stays listed.** Every lock kept is listed for good, with no word of its release. `forfeitedAt` and `restoredAt` are the only signs of what became of it.

## READING.md section 7, the decisions

39. **`struck` on a challenge.** It lists, for each member of the set, the reveal's id and then its commit's id. A gold miss's strike says the gold reveal's id as `by`.
40. **`parties` and `against`.** A challenge's `parties` are the set's roots and then the owner, and the owner alone where it is against the gold. `against` says `acceptance` or `gold`.
41. **A void challenge's `decidedAt`.** It is the instant of the last lapse, even where a verdict came later (challenge-1).
42. **Seats that lapse together.** Where several seats lapse at one instant, as many next seats are offered at that instant (gold-1). QX-1 section 5 speaks of one seat.
43. **The gold's counts.** `committed` leaves out the commitments a held challenge dropped. A commitment whose reveal is overdue is counted under `lapsed` and not under `pending`, while its own `outcome` still says `pending`. QX-16 section 5 gives the lapse and not the counts.
44. **The record document.** QX-20 section 4 was enough. What it leaves unsaid and record-1 decided: `readings` are the standing readings, so a related root's is left out; `signer` is the root; `model` is the reveal's `by.model`; `at` is the receipt's time; `trace` is `{reads, rests}` or null. An inherited piece's entry is `{name, piece, state: "inherited", inherited}` with the problem's hash (inherit-1).
45. **The gold's stake after a failed challenge on a miss.** The owner's stake stays locked until the gold is settled, and a failed challenge against the gold releases nothing early.
46. **"Settled" for a lapse.** A gold's lapse is read with a challenge still open on the piece (gold-1, problem 78d102). QX-16 section 5 says a commitment lapses when its piece is settled and not whether an open challenge holds that back.
47. **`complete` and `own_complete` apart with no fork.** A problem whose one piece is `challenged` says `complete: false` and `own_complete: true` (gold-1, problem 78d102). So `own_complete` is read with open challenges left out. QX-23 section 4 gives the two words for a fork alone.

## READING.md section 8, the reach

48. **Where "what those lines reach" falls.** QX-23 section 1 orders a source's line and does not say where that line's own reach comes. Here it comes straight after the line, before the fork's next source. No fixture decides.
49. **A square read at a problem that itself inherits.** Whether a piece counts as a square at a reached problem where its inputs there were opened by an inherited square is unsaid. Here a reached problem is read with its own inheritance, and a problem met again on a ring is read without. No fixture decides.
50. **Which problem `inherited` names.** It names the first problem in section 1's order that holds the square as its own, furthest along first (inherit-1, line-1). Section 2 says so, and the fixtures agree.
51. **`record_output` over an inherited record piece.** It is said where a piece's kind is record though the piece is inherited (inherit-1, problem 20ad39).

## QX-22, the proposed pieces

52. **The gate.** Section 1 holds `piece.brief` and `why` to the plain-text gate as a rule of validity. Reading 1's Python has no gate, since CORE.md leaves the gate to the door. A proposal the gate alone would pass over stands here, and no fixture holds one. If the gate is validity for a proposal, a reader of reading 2 needs the gate, and READING.md should say so.
53. **`proposer` is null.** Section 5 gives it as "the name the root holds here, or null". Every fixture says null, and a ledger holds the `version` events and no other name.
54. **`taken` off the path.** Section 3 gives `taken` "up to the version read". Where the version read does not come after the version the proposal names, along `prev`, this says null. No fixture holds a line with two branches and a proposal.
55. **The order of `pursued`.** The fixture's two are in the order of their hashes, which is also the order of their chain. Section 3 says neither.

## Judged wrong, not thin

These are places a document says one thing and the fixtures another. Each is either a fault in the document or a fault in the reference the fixtures were written from.

56. **A struck attest set docks nothing.** QX-1 section 6 says each root of a struck set "loses one and its point for the set", and QX-16 section 1 gives an attest piece a share of one. In verifiers-judging-1 and verifiers-1 a struck attest set docks its root nothing, neither the one nor the point. Here a root is docked only for a reveal that was credited.
57. **`pursued` lists more than the head.** QX-22 section 3 says of a fork "its head is the one listed", and that a fork "its owner has replaced is not listed". propose-1 lists both `1f930c…` and `a279bc…`, the fork and the version that replaced it. Here every version of the fork's line that holds the piece is listed.
58. **`dropped` is not a count.** The README says "`dropped` is a count, as in version 1". Every fixture says 0. client-doc-5 holds a reveal with no commit of its hash and client-doc-8 a reveal after its commit was abandoned, both dropped by CORE.md section 6 and both left out of the piece's readings, and each file says `dropped: 0`. Here `dropped` is 0 always.
59. **A set once struck stays out of the pool.** QX-16 section 4 says that on a held challenge against the gold "the set's events return to the fold" and each root regains its points. In gold-1 a challenge two days after such a return (id `668aea…`, problem 78d102) draws its order from six roots, and the two roots whose one set was struck and returned are not among them. QX-1 section 3's "the set not struck at or before `t`" can be read to say so, and is followed here. The two sections should agree in words: either a returned set seats its roots again or it does not.
60. **"A piece is challenged once."** QX-1 section 7 says so, and QX-16 section 4 repeats it. QX-1 section 1 bars only a challenge where one "is open or has held", and the fixtures take a second challenge after a void one (challenge-1). Section 1 is followed.
61. **The README's example.** Entry 3: `unoffered` and `gold` are shown as numbers and are a list and an object.

## Not decided by any fixture

What is assumed here and held by nothing: entries 14, 16 in part, 21, 32's sixth pass, 33, 48, 49, 52 and 54. A fixture for each would turn an assumption into a rule.

## What a document has answered since

This section is the maintainers', written with sight of the reference, and the entries above are kept as the stranger wrote them.

On 11 November 2026, with this code, the fixtures' README was amended:

- **Entries 1 and 2.** The README still names the reference's files as the home of the types, and says now that a second implementation reads none of them. It lists every reason of the closed list in its own words, under "The reasons", with which of them a fixture holds. Twenty are listed and the fixtures hold the thirteen of entry 2. The seven no fixture holds are words this code never says, so a ledger that calls for one is read apart from the reference until a fixture holds it.
- **Entries 3 and 61.** The example shows `unoffered` as a list and `gold` as its six counts, and the field list says what each is.
- **Entry 58.** The fault was the README's sentence, not the count. `dropped` counts the events of the types reading 2 adds that the pass took for nothing: a lock no free standing covers, a gold or a rank the rules refuse. What reading 1's fold drops, a reveal with no commit among them, is left off the record and is not counted there. The door refuses what the pass would drop, so no ledger a tracker kept holds one and every file says 0. This code says 0 always, which is right for every fixture and wrong for a ledger written by hand that holds such an event, until a fixture holds one.

Entries 56, 57, 59 and 60 are open: each is a place two sentences of the extensions' documents, or a sentence and the reference, must be made to agree. The entries that are thin and not wrong are open too, each a sentence for READING.md, a cited document or the README.
