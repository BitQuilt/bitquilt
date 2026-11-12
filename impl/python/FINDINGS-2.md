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

That day too, the extensions' documents were clarified, each by a dated paragraph that leaves the sentence before it as it was. No answer of a fixture changed.

- **Entry 56.** QX-1 section 6, QX-16 section 4 and verifiers.md section 2 say now who is docked: the roots the set credited. An `attest` set credits none, so its root loses its lock and no point. The reference reads a run's root the same way, which no fixture holds.
- **Entry 57, with 53 and 55.** The fault was in neither the document nor the reference. A tracker lists a fork's head alone and knows names; a ledger holds neither a listing nor a name, so a fixture lists every version of a fork that holds the piece, in the order of their hashes, and says `proposer` as null. QX-22 section 3 and the fixtures' README say so.
- **Entry 59.** QX-1 section 6 and QX-16 section 4 say it in one voice: a set struck and returned has its roots' points again and seats them in no later pool.
- **Entry 60, with 41.** QX-1 section 7 and QX-16 section 4 say once of a challenge that held, as section 1 has it. QX-1 section 6 says a void challenge's time is the last lapse.

Then the fixtures' README was given a part of its own, "The keys", for what the stranger took from the JSON:

- **Entries 4 to 13.** The README lists the keys of a view, a set, a record, a trace, a stake rule, a lock, a gold, a challenge, a panel and a proposal, and no others. It says a seed is bare hex, gives each verifier its three words, and says which view comes first, that `challenge` is the last challenge on the piece and is kept once decided, that a gold is shown at the version it names, and that a set's `kind` is the set's own and not the verifier's. Entry 12 read `standing` wider than it is: it holds the root of each line's signer, the coin log's among them, and each owner's. Entry 13's forms are listed in the order they are asked, with a fourth, a blob that does not match its hash, and the fixtures hold two of the four.

Then READING.md section 3 was given the order of the reasons, by a dated paragraph that leaves the sentences before it as they were. No answer of a fixture changed.

- **Entry 15.** Nothing was amended. Section 5's table names verifiers.md section 2 as the home of `human`, `judge:n` and `attest`, and the registry in `docs/EXTENSIONS.md` gives QX-2, QX-3 and QX-10 that one document.
- **Entry 16.** Section 3 writes, for each kind, the reasons in the order they are asked, and a reading says the first that is true of it. The order this code had was not the reference's: on a piece with a set it asked the root before the vendor, and it counted a reading the set was made without. No fixture holds either pair. The code asks them now as the section writes them.
- **Entry 17.** The entry's reading was wider than the code beside it. With no set, an `agree` piece's reading is `kept` only where an earlier reading from its vendor, not the owner's, agrees with it. A second reading from one root is `counted` while no set is made, on an `agree` piece as on a `human` one, and section 3 says so. The reason "its root is related to the root of an earlier reading" is a `judge:n` piece's and a `record:n` piece's alone.
- **Entries 18 and 19.** Section 3 says an `attest` piece keeps the readings after the one that made its set, each with "the set was made before it", and that a `human` piece asks the seat straight after the owner and is `disputed` over the readings from a person's seat alone, none of them the owner's.

With that order written, this code says five of the seven reasons no fixture holds: "the set was made without it", "the readings the piece asks for stood before it", "an earlier candidate gave the same return", "the candidates were in before it" and "its piece asks a verifier this reading does not implement". It said "the set was made before it" for the second, the third and the fourth. It still never says "the set was made on another patch", since no fixture of reading 2 holds a run (entry 14), nor "the fold without the struck events does not hold it". Each of the seven is open until a fixture holds it.

Then READING.md section 4 was given what entries 20 to 27 asked, by two dated paragraphs, with a sentence in QX-19 section 4 and three in the fixtures' README. One answer was the reference's to change, and a fixture was added for it.

- **A fault in the reference, found on the way.** The grounds are read before the sets, when no panel is drawn, so a `judge:n` piece with its candidates in said `disputed` there, and one candidate's trace set the other aside and took the seated panel with it. Section 4 says now that the grounds set aside no candidate of a `judge:n` piece, and the reference reads so (READING.md section 12, item 11). This code never set one aside. The fixture `grounds-judge-1` holds both halves, and no answer of an earlier fixture changed.
- **Two places that fixture read the two apart.** The reference says `unoffered` sorted, and this code said it in the order of the pieces. The reference leaves `order` empty on a panel or a challenge void for want of a pool, and this code drew it. The README says both now, and this code follows.
- **Entry 20.** Section 4 says a `record:n` piece has no reading set aside.
- **Entry 21.** The two read apart, and no fixture decides. The reference reads the grounds at each version, on a piece that version's fold calls `disputed`, so a piece locked at a version has nothing set aside there. Section 4 says so. This code reads the grounds over the line's record once, and sets a reading aside at every version. It is open until a fixture holds a piece locked at one version and disputed at another, and this code follows it.
- **Entries 22 and 23.** Section 4 says what each `aside` holds and when the trace's is said, and that "the core's fold" is section 3's fold as reading 1's reducer leaves it, whose lock is reading 1's.
- **Entry 24.** Section 4 lists the four places a seam is shown.
- **Entry 25.** Section 4 and QX-19 section 4 say a seam shows the first rest of a field in the trace's order.
- **Entry 26.** The README says no fixture holds an implementation to a passage.
- **Entry 27.** Section 4 says `traced` by the set's reveals, and null where the piece shows no set of reveals. A set of runs says null in the reference, which no fixture holds (entry 14).
- **The sides, which no entry asked.** In the reference the owner's reading is a side of a seam like any other, and on a `human` piece that is `disputed` over its seated readings every two readings that differ are sides, seated or not. This code left the owner's out and read the seated alone. Section 4 says both as the reference reads them, this code follows, and no fixture holds either.
- **Entry 28.** Section 9 says when each document is said: the output where reading 1's reducer calls the version complete, the record document where the problem has a record piece and is complete in the layer.
- **Entries 29 to 31.** Section 5 says where a panel and a challenge are listed. The README gives a panel's keys and words, and `unoffered`, sorted.
- **Entry 32.** Section 6 says a panel is drawn over the credits of the pass before, the first fold draws none, and the kinds are decided again three times at most. This code allowed six passes, and allows the first fold and three now, as the reference does.
- **Entry 33.** Section 6 says the fixed point comes before section 7's pass, and a strike there does not run it again.
- **Entry 34.** Section 6 says what each kind's set credits, and that a credit counts from the earliest completion of a set that holds the reveal.
- **Entry 35.** Section 6 and QX-17 section 4 give the burn's word, and section 6 says what the fold reads of it and of a coin lock's.
- **Entry 36.** QX-15 section 1 and section 7 say a stake rule is its version's.
- **Entries 37 and 38.** Section 7 says the problem's `stake` and that a lock kept stays listed, with `forfeitedAt` and `restoredAt` the signs of what became of it.
- **Entries 39 and 40.** Section 7 and the README say the order of a challenge's `struck`, each reveal's id and then its commit's, and what a struck reading names as `by`. The README had `parties` and `against` already.
- **Entry 42.** QX-1 section 5 and section 7 say each lapse offers one seat, so seats that lapse together offer as many.
- **Entries 43, 45 and 46.** QX-16 section 5 and section 7 say the stake is one lock released at the last of its commitments to be final, that a problem has settled where it is complete on its own record with every window closed, and that a lapse is read at the time asked and written on nothing, so the count says `lapsed` while the commitment says `pending`. An open challenge does not hold a lapse back, as gold-1 holds.
- **Entry 44.** QX-20 section 4 says each key of a reading in the record document.
- **Entry 47.** Section 9 says `own_complete` is the problem's own, read with no open challenge and no inherited square, and `complete` the layer's.
- **Entries 48 to 50.** QX-23 sections 1 and 3 and section 8 say the order of the reach, the walk's, and that the pieces done elsewhere are counted over every problem that reaches something until nothing moves, on a ring as off it. This code worked a reached problem out once and read a problem met again on a ring with no inherited square, which is not the reference's fixed point, and no fixture held a ring. The fixture `ring-1` holds one now: a problem and its fork that each name the other, with four pieces in a chain answered in turn across the ring. This code read it apart in 46 places, since it stopped at the second piece. It counts the pieces done elsewhere over every version that reaches something until nothing moves now, as section 8 says, and reads `ring-1` as the reference does. No answer of a fixture kept before changed, and the reference was not changed. So entry 49 is a rule a fixture holds and no longer an assumption. Entry 50 was said by QX-23 section 2.
- **Entry 51.** Section 9 says the record document is said for a fork whose record piece is inherited.
- **Entry 52.** QX-22 section 2 says the gate is part of what stands for a proposal, so a reader of reading 2 holds the gate. This code has none yet, and no fixture of reading 2 holds a proposal the gate alone refuses; the gate's own fixture is `packages/core/fixtures/gate/cases.json`.
- **Entry 54.** QX-22 section 3 says a take is read along `prev` from the version read, and null from a version beside.

No entry that is thin and not wrong is open: each has its sentence in READING.md or a cited document. One thing this code does not yet do as the documents now say is open, the gate on a proposal. The assumptions no fixture holds are open until a fixture holds each: with those listed above but entry 49, which `ring-1` holds, the grounds at a version where the piece is locked, the owner's reading as a side, and a reading from no person's seat as a side on a `human` piece.

Then a fixture was added for entry 14, `run-1`, which `packages/tracker/test/run.test.ts` leaves: a check piece and a score piece, each with a patch and its runs. It found this code reading apart. Under reading 2 it kept every run and made no set of them, so a piece two runs reproduce stayed open. The documents were enough: CORE.md section 6 gives the fold's drops and the pair, READING.md section 3 how each reading counts, and section 6 that the set "credits its patch and not its runs". The code was wrong and is fixed, and the fixtures' README says now what the fixture alone showed: a set of runs holds its patch and then its two runs, each run with the patch's digest, its kind is `check` or `score`, and its `traced` is null.

- **Entry 14.** `run-1` holds a run's place in a set's `members`, in the set's name and in standing, with a run by the patch's author, a run that failed and a score outside the tolerance. It holds no run from a root in a pool, no held challenge on a set of runs and no gold beside one. This code reads them as the reference does: a run's root is a party to a challenge and is struck with the set, losing its lock and no point (entry 56), and a gold matches no set of runs, since a `check` or a `score` piece has no agree fields.
