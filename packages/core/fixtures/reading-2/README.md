# The fixtures of reading 2

Written 11 November 2026, in phase 2 of [the plan for version 2](../../../../docs/history/V2-PLAN.md): "The tracker's layer, as it is, is run over every fixture and over the ledgers its own tests build, and what it says is kept as fixtures. These are the law for the port." Each file here is one ledger, with what the reference tracker's layer says of it at two times. The fold [reading 2](../../../../docs/v2/READING.md) describes is written in phase 3, and it reproduces every one of these at every step. Until the switch the fixtures one folder up are the law of the core in force, and nothing here changes them.

`packages/tracker/test/reading-fixtures.test.ts` holds the layer to every file, and runs the layer over version 1's fixtures too, where one piece's state differs (READING.md section 11).

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
- A view holds the piece's `state`, and the `core` state beside it, which goes at the switch; its `kind`, `extension` and `strength`; `attested`, `stake`, `gold`, `verified`, `aside` and `inherited`; the id of an open `challenge`; its `set`; its `record`, for a record piece; and its `trace`, with the grade and the seams.
- A `set` is its kind, the time it was completed, and each member's key, time and digest. Reading 2 names a set by its events' ids (section 5); the layer keeps no id on a reveal today, so the name joins these fixtures in phase 3, in the pull request that gives the fold the ids.
- `complete` is the layer's, over the inherited squares, and `own_complete` the problem's own (QX-23 section 4). `output` is the hash of the output document and `record_output` the hash of the record document (QX-20 section 4). `dropped` is a count, as in version 1.
- `refused` names each problem the layer could not read, with the reason.
- `standing` holds every root a line of the ledger counts for, and every owner.

## How they are written

```bash
QUILT_WRITE_READING=1 pnpm exec vitest run packages/tracker
```

With the variable set, the helper every tracker test boots a tracker through keeps each one, and once a test file has run, writes the ledger each tracker was left holding as `<the test file's name>-<n>.json`. No such fixture is picked by hand. A test also keeps a tracker as it stands at a point it passes through (`keepReading`), for a state it does not end in, and a ledger it builds by hand with no tracker (`keepLedger`), each under a name the test gives. A run without the variable writes nothing.

```bash
QUILT_WRITE_READING=new pnpm exec vitest run packages/tracker
```

With `new` only a fixture not yet kept is written, and every file that stands is left as it is. This is how a fixture is added.

Four kinds of ledger are left out: one with no problem, one of more than a thousand lines, one whose file would pass 256 KB, and one the layer throws on, which a test builds to show the throw.

The tests sign with fresh nonces and their clocks are their own, so a second writing gives new ids throughout. A rewrite with `1` therefore replaces every file, and it is done only where the layer's answer is meant to change, in a pull request that says which answers and why. Between rewrites the files stand as they are and the code is held to them.

## What they cover, and what they do not

Eighty-three ledgers, of 184 problems and 955 lines, with every event type the door takes among them but `run`: the claims, commits and reveals, the challenges and verdicts, the locks and stake rules, the gold and its reveals, the traces, the proposed pieces, the versions and forks, the seeds and ranks, the hides and names, and the coin's lines. Seventy-four are what the tests leave in their trackers. Nine were added in phase 3, before the verifier kinds moved into the core: a judge piece while its panel sits, at two points, and the seven ledgers `packages/tracker/test/verifiers.test.ts` builds by hand for the `human` and `attest` kinds. Fourteen of the fifteen states of READING.md section 9 are seen.

Two things are read through version 1's fixtures, which the same test runs the layer over: the state `unreachable`, in fixture 22, and the `run` event, in fixtures 14 to 17 and clarification 7. No tracker test posts a run through a booted tracker.

Not yet covered, each to be closed by a fixture before the rule it bears on is moved:

- a ledger of more than a thousand lines;
- the departures READING.md section 12 lists, each of which gets a fixture written for it when it is argued.
