# The fixtures of reading 2

Written 11 November 2026, in phase 2 of [the plan for version 2](../../../../docs/history/V2-PLAN.md): "The tracker's layer, as it is, is run over every fixture and over the ledgers its own tests build, and what it says is kept as fixtures. These are the law for the port." Each file here is one ledger, with what the reference tracker's layer said of it at two times. The fold [reading 2](../../../../docs/v2/READING.md) describes is written in phase 3, and it reproduces every one of these at every step: the pass is the core's `read` now, and the core alone is held to them. Until the switch the fixtures one folder up are the law of the core in force, and nothing here changes them.

`packages/core/test/reading-fixtures.test.ts` holds the core's `read` to every file, with no tracker and no store, and runs it over version 1's fixtures too, where one piece's state differs (READING.md section 11). `pnpm conform:2` runs the same check as a script and prints, for a fixture that fails, each place the read and the file are apart. The ledger's shape, the read of it and the form of what is expected are in `packages/core/src/ledger.ts`.

## The file

```json
{
  "name": "challenge-1",
  "description": "…",
  "reading": 2,
  "ledger": {
    "identity": [ <the identity log's lines> ],
    "problems": [ { "envelope": <an envelope>, "lines": [ <its log's lines> ] } ],
    "blobs": { "<sha256:…>": "<the blob's bytes, base64>" },
    "coin": [ <the coin log's lines> ],
    "founding": { "0x…": 3 },
    "reads": { "<sha256:…>": 1204 }
  },
  "readings": [ { "now": "<a time>", "expect": <what the layer says at that time> } ]
}
```

The ledger is what READING.md section 1 names. `problems` holds every envelope the tracker held, in the order it lists them, so a version and the one before it are two entries. `coin` is null where the tracker carries no coin. `founding` is the standing the tracker publishes for an address (QX-1 section 2). `reads` gives, for each read a trace names that the layer asked about, its length, or null where the tracker does not hold it (QX-19 section 2).

Each ledger is read twice: at the clock of the tracker that held it, and a thousand hours on, when every window has closed and every lease and seat has run out.

## What is expected

```json
{
  "problems": {
    "<a problem's hash>": {
      "complete": false, "own_complete": false, "output": null, "record_output": null,
      "dropped": 0, "unoffered": 0, "stake": null, "gold": 0,
      "locks": [], "golds": [], "challenges": [], "panels": [], "proposals": [],
      "views": [ <what the layer says of a piece> ],
      "pieces": { "<a piece's name>": 0 }
    }
  },
  "refused": {},
  "standing": { "0x…": { "standing": 2, "locked": 0, "free": 2 } }
}
```

- `pieces` gives each piece the place in `views` of what the layer says of it. Pieces that say the same thing share one view, so a problem of a thousand open pieces holds one.
- A view holds the piece's `state`, and the `core` state beside it, which goes at the switch; its `kind`, `extension` and `strength`; `attested`, `stake`, `gold`, `verified`, `aside` and `inherited`; its `readings`; the id of an open `challenge`; its `set`; its `record`, for a record piece; and its `trace`, with the grade and the seams.
- A `set` is its `name`, its kind, the time it was completed, and each member's id, key, time and digest. The name is the one READING.md section 5 gives, the hash of the canonical JSON of its events' ids, sorted, and a member's `id` is its event's: the reveal's, or the run's. A set a version carries has one name on every version that shows it. A record piece's standing readings each carry their `id` the same way.
- `readings` holds every reading of the piece in receipt order (READING.md section 3): the reveal's `id`, the `problem` it names, its `key`, `root`, `vendor` and time, how it `counts`, one of `counted`, `kept`, `aside` and `struck`, `why` where it counts for nothing, and `by`, the id of the challenge or the gold reveal that struck it. The reasons are a closed list, `WHY` in `packages/core/src/readings.ts`, and a second implementation says the same words. Since a reading is named by its id, two pieces that hold a reading share no view.
- `complete` is the layer's, over the inherited squares, and `own_complete` the problem's own (QX-23 section 4). `output` is the hash of the output document and `record_output` the hash of the record document (QX-20 section 4). `dropped` is a count, as in version 1.
- `refused` names each problem the layer could not read, with the reason.
- `standing` holds every root a line of the ledger counts for, and every owner.

## How they are written

```bash
QUILT_WRITE_READING=1 pnpm exec vitest run packages/tracker
```

The writing stays with the tracker's tests, since a ledger is what a booted tracker's store was left holding (`packages/tracker/test/reading.ts`). With the variable set, the helper every tracker test boots a tracker through keeps each one, and once a test file has run, writes the ledger each tracker was left holding as `<the test file's name>-<n>.json`. No such fixture is picked by hand. A test also keeps a tracker as it stands at a point it passes through (`keepReading`), for a state it does not end in, and a ledger it builds by hand with no tracker (`keepLedger`), each under a name the test gives. A run without the variable writes nothing.

```bash
QUILT_WRITE_READING=new pnpm exec vitest run packages/tracker
```

With `new` only a fixture not yet kept is written, and every file that stands is left as it is. This is how a fixture is added.

Four kinds of ledger are left out: one with no problem, one of more than a thousand lines, one whose file would pass 256 KB, and one the layer throws on, which a test builds to show the throw.

The tests sign with fresh nonces and their clocks are their own, so a second writing gives new ids throughout. A rewrite with `1` therefore replaces every file, ledgers and all, and it is done only where the ledgers themselves are meant to change, in a pull request that says why. Between rewrites the files stand as they are and the code is held to them.

## How they are said again

```bash
pnpm --filter @bitquilt/core exec tsx fixtures/say-again.ts
```

Where the read's answer over the ledgers kept is meant to change, the ledgers stand and the answers alone are written again: `packages/core/fixtures/say-again.ts` reads each file's ledger at each of its times with the core's `read` and writes what it says where the answer was kept. No id, time or signature changes, and a file whose answers stand is not written. It is run only in a pull request that says which answers changed and why, and that shows nothing else did.

They were said again once, on 11 November 2026, when the fold began to keep each reveal's and each run's id: a set gained its `name` and each member its `id`. Forty-seven files hold a set and were written; with those two fields taken out, every answer was what it had been.

They were said again a second time that day, when a line came to have one record (READING.md sections 2 and 3, and the first departure of its section 12). Eight files were written, and every ledger is as it was:

- `carried-2`, `carried-6`, `carried-7`, `carried-10` and `carried-11`: a set made at a later version, or at a version made from the same earlier one, stands on each version that keeps the piece, so the earlier version's piece, and in `carried-11` the other version's two, are accepted where they were open or waited on a second reading.
- `carried-12`: the earlier version's last piece is accepted through the later version's work, so that version is complete and has its output. Its one gold commitment still pending has lapsed with that, and the owner's stake behind it is released, as [QX-16](../../../../docs/ext/QX-16.md) sections 3 and 5 say of a problem that has settled.
- `inherit-1`: the source shows the square made at its later version and is complete, and the fork's piece names the source as where the square stands.
- `propose-1`: a root proposed one piece under two versions of a line. One proposal stands for a root and a piece, the first received, and at the earlier version that is now the one made under the later version a second before its own.

They were said again a third time that day, when the lease and the window came to be those of the version an event names (READING.md section 3, and the third departure of its section 12). No file was written: no line among the ledgers kept differed in its lease, its window or its size of patch.

They were said again a fourth time that day, when a fork came to reach the whole line of its source (READING.md section 8, and the fourth departure of its section 12). No file was written: no fork among the ledgers kept holds a piece that only an earlier version of its source, or a version made beside it, has a square on.

They were said again a fifth time that day, when a challenge came to show across its line (READING.md section 7, and the fifth departure of its section 12). Seven files were written, and every ledger is as it was:

- `carried-3`, `carried-4`, `carried-5`, `carried-8` and `carried-10`: a piece names the challenge held on it at another version of its line, where it named none. No state changed.
- `carried-7` and `carried-9`: a piece says `challenged` at the other version of its line while the challenge is open, where it said `accepted_provisional`, and names that challenge at the later time too, once it is void.

They were said again a sixth time that day, when the record came to say of each reading how it counts (READING.md section 3, and the sixth departure of its section 12). Every file was written, since every view gained its `readings`, and every ledger is as it was. With that one field taken out, each piece says what it said before: pieces that shared a view and hold a reading each have a view of their own now, and nothing else differs.

## What they cover, and what they do not

Ninety-one ledgers, of 212 problems and 1126 lines, with every event type the door takes among them but `run`: the claims, commits and reveals, the challenges and verdicts, the locks and stake rules, the gold and its reveals, the traces, the proposed pieces, the versions and forks, the seeds and ranks, the hides and names, and the coin's lines. Eighty are what the tests leave in their trackers. `grounds-1` was added on 11 November 2026, when the grounds came to be read before the sets and with them (READING.md section 12, item 9), which no ledger kept before it told apart from the order the pass had. `line-1` was added that day too, for one record for a line (item 1 there): a line of three versions, two of them made from the first, and a fork of it, with a set made across two versions, a set made across the two beside each other, a rank and a seed read at each version, and two readings that agree and make no set, one on the line and one on the fork. The last of them, `lease-1`, was added that day for the lease and the window of the version an event names (item 3 there): a line of two versions that differ in both, with a claim and a commit that name each, a set completed at each, an attested piece and a judged one. `packages/tracker/test/lease.test.ts` keeps the same ledger at two points it passes through, `lease-running`, where the claim that names the older version has lapsed and the one that names the later runs, and `lease-windows`, where the sets completed at the later version are final and those completed at the older are within their window. `reach-1` was added that day for a whole line reached (item 4 there): a line of three versions, two of them made from the first, and a fork of the second, which inherits a square made on the first on a piece the second dropped and one made on the version beside it, with a later version of the fork that names another problem in `from`, read at the fork's first version too. `across-1` was added that day for a challenge across a line (item 5 there): a line of three versions, two of them made from the first, with a challenge posted to one version on a set made at another, held and failed, and two gold misses each challenged at a version other than the gold's, one overruled and one upheld. `readings-1` was added that day for a reading that counts for nothing (item 6 there): one problem whose pieces show the owner's own reading, a second from one vendor before a set and beside one, a reading that differs from the set, one from a root of the set, one after it, one set aside, a set a held challenge struck, a set the owner's gold missed, and a record piece with a second reading from one root. Nine were added in phase 3, before the verifier kinds moved into the core: a judge piece while its panel sits, at two points, and the seven ledgers `packages/tracker/test/verifiers.test.ts` builds by hand for the `human` and `attest` kinds. Fourteen of the fifteen states of READING.md section 9 are seen.

Two things are read through version 1's fixtures, which the same test runs the read over: the state `unreachable`, in fixture 22, and the `run` event, in fixtures 14 to 17 and clarification 7. No tracker test posts a run through a booted tracker.

Not yet covered, each to be closed by a fixture before the rule it bears on is moved:

- a ledger of more than a thousand lines;
- the departures READING.md section 12 lists, each of which gets a fixture written for it when it is argued.
