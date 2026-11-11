# Reading 2

Status: Draft, written 11 November 2026. Its fold is being moved into the reference core a rule at a time, as the plan's phase 3 says, and no client reads by it yet. This is the second of the two documents of version 2 of the core; the first is [WIRE.md](WIRE.md), which is frozen. [The plan](../history/V2-PLAN.md) gives the order of the build. Until the switch the plan's phase 6 names, [CORE.md](../CORE.md) section 6 and the extension documents are what the code does, and section 12 below lists every place this draft departs from them.

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

**A line** is the versions of one problem under one owner: two problems are of one line where their chains along `prev` share a version (CORE.md section 2 says what `prev` is). A fork, which names another owner's problem in `from`, begins a line of its own. A line is named by the hash of its first version, the one whose `prev` is null.

A line has one expansion, every piece any of its versions holds, and one owner, the root its versions' `owner` counts for. A version is a list of the line's pieces: its map shows those pieces, each with the line's record of it.

## 3. The record

For each line and each piece of it, the record is every event that names the piece and a version of the line, in the order CORE.md section 6 gives under "Order", each with the root it counts for under "Roots and delegates". What that section drops under "Drop" is not on the record.

**A reading** is a valid reveal. The record says of each reading:

- its signer, the root; its vendor (CORE.md section 6, "A vendor"); and its seat, where the receipt says one ([verifiers.md](../ext/verifiers.md) section 2);
- what it rests on, by its trace ([QX-19](../ext/QX-19.md) sections 1 to 3);
- how it counts, one of: `counted`, in a set or toward one; `kept`, valid and counting for nothing, with the reason, such as a root related to the owner or a second reading from one vendor; `aside`, set aside under section 4; `struck`, with the decision that struck it.

Nothing valid is left off the record, and a reading that does not count says why. The claims, commits, runs, candidates and ranks on the piece are on its record in the same order. The proposed pieces beside a problem ([QX-22](../ext/QX-22.md) sections 1 to 3) are on the line's record and move no state.

The lease and the window an event is held to are those of the version it names.

## 4. The grounds

A reading that rests on nothing, where another on the piece rests on a kept read and the two differ, is set aside as QX-19 section 4 says. The seams between readings that differ are computed as that section computes them.

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

Standing is [QX-1](../ext/QX-1.md) section 2 as amended 10 November 2026: one credit for each reveal in a set, by the reveal's id. The pool is QX-1 section 3, and a version of a line is no other problem for it. Locked and free standing are [QX-15](../ext/QX-15.md) section 3. A burn on the coin log is credited on the door's word in its receipt's wrapper ([QX-17](../ext/QX-17.md) section 4), so where a tracker carries the coin its log's lines are in the ledger, and the fold reads the word and no balance. Sections 5 and 6 are brought to a fixed point, since a panel is drawn by standing and a panel's ranking makes a set.

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

A client conforms to reading 2 when it reproduces the state of every fixture of reading 2. The fixtures were made on 11 November 2026 in the plan's phase 2, from what the reference tracker's layer said that day, and [their folder's README](../../packages/core/fixtures/reading-2/README.md) gives their form and what they do not yet cover. The reference's `read` is held to every one with no tracker beside it, and `pnpm conform:2` runs them.

No fixture of version 1 holds an extension's event, and the layer was run over the twenty-four and the clarifications. Every state stands unchanged but one. Fixture 20 holds a piece whose verifier is `judge:5`, a kind version 1 does not know: version 1 says `unknown`, and reading 2 says `open`, since the kind is the reading's now (section 5) and the piece waits for candidates. The piece that waits on it stays `locked` in both, and `complete` and the output are the same.

## 12. Where this departs from what the code does today

Each of these is argued in phase 2, with a fixture, before the fold is written.

1. **One record for a line.** Today a version reads its own events and its ancestors'. Under section 2 an older version's map shows work posted to a later version on a piece it keeps, and two versions made from the same one share a record. Decided 11 November 2026.
2. **A line's name.** Today the coin names a line by the oldest version a tracker holds. Section 2 names it by its first version.
3. **The lease and the window.** Section 3 takes them from the version an event names. What version 1 does where two versions' settings differ is to be read from the code and compared.
4. **A whole line reached.** Today a fork reaches its source and the source's later versions. Under section 8 it reaches the source's line.
5. **A challenge across a line.** Today a piece at one version does not say `challenged` while a challenge sits at another, and a miss is challenged where the gold is. Section 7 closes both.
6. **A reading that counts for nothing.** The record says why. Today the tracker shows such a reading and gives no reason.
7. **One state.** The `core` field a tracker answers beside each piece's state goes at the switch.
8. **The gold and the lock in the reading.** Today they are extensions a core client may ignore. Decided 11 November 2026.

## 13. What this draft leaves open

- The output document of a problem with a `human`, `judge:n` or `attest` piece, which verifiers.md section 3 leaves to a later draft.
- A reader that holds only some of a ledger: what it may conclude of a pool or a panel's draw, and what two readers say who hold different reads.
- How the state names the founding standing and the reads it was made over, beside the heads.
- Independence from the agreement graph and evidence a machine can check (QX-8, QX-9): each a view over the record, with no change to the wire.
- What QX-23 section 6 and QX-20 section 6 leave open stays open.
