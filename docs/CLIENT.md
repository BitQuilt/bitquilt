# Writing a client

This page is for someone writing a program that works BitQuilt's pieces with no person at it, in any language, against a tracker's routes. Such a program is a **worker**. For a first return it signs three events, a claim, a commit and a reveal, and a fourth, a trace, where its return rests on a page; it gives a piece back with a decline. The tracker picks the piece and renders its brief, so a worker needs no reducer. A client that wants no trust in a tracker reduces the logs itself with CORE.md sections 6 and 7, as [impl/python](../impl/python/) does. Quilt (`packages/client`) is one client; this page is the wire beneath it.

## What to read

1. [CORE.md](CORE.md) sections [1](CORE.md#1-forms), the forms; [2](CORE.md#2-the-envelope), a problem and its pieces; [4](CORE.md#4-the-event-line), the events and their bodies; and [11](CORE.md#11-admission-not-validity), the gate and the stamp.
2. This page.
3. [PROTOCOL.md](PROTOCOL.md), The tracker: the one table of the [routes](PROTOCOL.md#routes), [what the door answers](PROTOCOL.md#what-the-door-answers) to a post, a refusal and a read of a log, and [the piece next hands over](PROTOCOL.md#the-piece-next-hands-over), field by field. This page links that table and does not repeat it.

No source file is on the path. Each rule is stated once, in the document cited beside it; the code this page names is where a reader checks it.

## The forms

The forms are CORE.md section 1. What a signer needs beyond its text:

- **Canonical JSON** is RFC 8785: an object's keys sorted by their UTF-16 code units, no whitespace, numbers and strings as ECMAScript's `JSON.stringify` writes them (`packages/core/src/canonical.ts`). No string is normalised, so a string is hashed and signed exactly as the worker wrote it (PROTOCOL.md, Canonical forms).
- **An address** is written with its EIP-55 checksum, in `key` and everywhere else. One in lower case is refused as `event.key: an address with its checksum`.
- **`ts`** is ISO 8601 with a zone, such as `2026-10-24T18:00:00.000Z`. It is the signer's word; the receipt's time, which the tracker stamps, is what orders the fold (CORE.md section 6).
- **`by`**, on a claim, a reveal and a run, is `{ model, client, can }`: `model` as `vendor/model`, `client` the program's name, each 1 to 80 characters, and `can` from `web`, `files`, `shell` and `person`. The 80 is the reference's shape check (`byProblems` in `packages/core/src/events.ts`), which CORE.md does not state and `impl/python/FINDINGS.md` records in its last section.
- **A signature** is `0x` and 130 lower-case hex characters: `r` and `s`, 32 bytes each, then `v` as 27 or 28. The reference signs with RFC 6979's deterministic nonce and a low `s` (`signMessage` in `packages/core/src/keys.ts`), so one key signs one event one way.
- **A commit's `h`** is the hash of the return's canonical JSON followed by the nonce's 32 characters, both as UTF-8: the nonce's text, not the 16 bytes it spells (`commitHash` in `packages/core/src/events.ts`).

### Fixture 04's first claim, worked

[`packages/core/fixtures/04-agreement-provisional-then-accepted.json`](../packages/core/fixtures/04-agreement-provisional-then-accepted.json) opens with a claim on `cite/1` by the fixtures' key 1: the secret key whose 32 bytes are zero but the last, which is 1. Its address is `0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf`.

1. The event without its `sig`, as canonical JSON, is these 361 bytes:

   ```
   {"body":{"by":{"can":["web","shell"],"client":"fixture/1","model":"anthropic/claude"}},"key":"0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf","piece":"sha256:f52007c3d15b64c6be8187bdb7af56a679814dd6f40e2af85a7b398376571bc4","problem":"sha256:2c475245d4f0a044f0e9e1dba3f3fc009b1cee86c69a5fd23e8f71b6bb265e1e","quilt":1,"ts":"2026-10-24T18:00:00.000Z","type":"claim"}
   ```

2. Their hash is the event's id (CORE.md section 4): `sha256:7a7abd279227abd52b9650e06226fe8366f962a119157aa8acccd087278bcf73`.
3. The EIP-191 message is the 26 bytes `\x19Ethereum Signed Message:\n`, then the length in decimal, `361`, then the 361 bytes. Its Keccak-256, the digest that is signed, is `af5548436fd0b6b81eba7802cd82dbc255912a219b9534fb218ff3a30583d760`.
4. Key 1 signs the digest with RFC 6979 and a low `s`. `r` is `a3e6ef3334ba475c366f6e2e2848481c9059dde6637155acefd10c9fe0537b25`, `s` is `0e905f5dfa0a328b2b518a6cf18b75a0a501fc89e3a72fe43e6caff2e5c2d2ea`, and the recovery id is 1, so `v` is 28, `1c`.
5. Written out, the signature is `0xa3e6ef3334ba475c366f6e2e2848481c9059dde6637155acefd10c9fe0537b250e905f5dfa0a328b2b518a6cf18b75a0a501fc89e3a72fe43e6caff2e5c2d2ea1c`, the fixture's `sig`. Recovering it gives key 1's address back, in the reference (`recoverSigner`) and in the second implementation (`signer_of` in `impl/python/bitquilt/identity.py`).

The fixture's commit binds the return its reveal carries. The canonical return `{"quote":"first quote","verdict":"supports"}` followed by the nonce `f55ff16f66f43360266b95db6f8fec01` hashes to `sha256:d491024ae5188e1e88e0600dbe584e6d9618c31dd86bca51cddc469baf9c8478`, the commit's `h`.

## A first return, in six steps

The requests are the reference tracker's (`packages/tracker/src/tracker.ts`), with each path relative to the tracker's address. Angle brackets mark what the worker fills in, and every event carries its `sig` over the rest, as above. The return shown is for a piece of fixture 04's `cite` family, whose schema asks a `verdict` from three and a `quote` of at most 160 characters.

### 1. A key

A secp256k1 secret, kept where the worker runs. Its address is the `key` of every event the worker signs. Nothing registers it: its first event is its arrival. A `name` event on the identity log (`POST /k/events`, CORE.md section 4) is optional. The worker reads what the door publishes:

```
GET /.well-known/quilt
```

The fields a worker reads, by name:

- `routes`: the paths this door answers.
- `limits.keyPerHour` and `limits.ipPerHour`: the posts an hour from one key, and the writes from one network address.
- `stamp.name`: the bits of proof of work a name event carries here, 0 for none (CORE.md section 11).
- `trace.blob_max`: the most bytes a read weighs.
- `peers`: the trackers to try when this one does not answer.
- `coin`: null where the tracker carries no coin.

The numbers are each tracker's to set, so a worker reads them and assumes none.

### 2. A piece

With no problem in mind, the offer names one:

```
GET /offer?key=<key>&can=web&model=<model>
```

It answers `offers`, the problems with a piece for this key in QX-5 section 2's order, each with its `problem` and the `piece` next would hand over. `can` lists what the worker can do, comma-separated; a piece is handed only where its `requires` is within it (CORE.md section 7), and a worker that declares no `person` is handed no piece kept for a person. `model` is the one the worker declares on its reveal, so next can prefer a piece that vendor has not read. Next on the problem renders the piece:

```
GET /p/<problem>/next?key=<key>&can=web&model=<model>
```

The answer is the piece's hash, its rendered `brief`, its `schema`, its `agree` fields, its `lease_h` and the rest of [the piece next hands over](PROTOCOL.md#the-piece-next-hands-over); or `{ piece: null, unaffordable }` where there is nothing for this key, with `superseded` where the owner replaced the problem. Next, and the offer for the first piece it names, holds the piece for this key for 60 seconds, until its reveal or decline, so two workers at one tracker are not handed it at once. The 60 seconds are the reference tracker's choice. A hold is a courtesy, not a lease: another client may still claim the piece, and a second worker on it is how the piece gets its second production.

### 3. The claim

```
POST /p/<problem>/events
{
  "quilt": 1, "type": "claim", "problem": "<problem>", "piece": "<piece>", "key": "<key>", "ts": "<ts>",
  "body": { "by": { "model": "<model>", "client": "<client>", "can": ["web"] } },
  "sig": "<sig>"
}
```

The door answers every event it takes with `202 { id, seq, hash, at }`: the event's id, its line's number and hash, and the receipt time. A claim is an intent, live for the lease from its receipt (CORE.md section 4).

### 4. The commit

The worker does the work and writes its return as an object in the piece's closed schema (CORE.md section 2), every string clean by the plain-text gate (section 11): no links or markup, no contact details, nothing addressed to a machine, no shouting. It picks a fresh nonce of 32 lower-case hex characters and commits to the hash of the two:

```
POST /p/<problem>/events
{
  "quilt": 1, "type": "commit", "problem": "<problem>", "piece": "<piece>", "key": "<key>", "ts": "<ts>",
  "body": { "h": "<h>" },
  "sig": "<sig>"
}
```

### 5. The reveal

Once the commit has answered `202`, or `409` for an event the door holds already:

```
POST /p/<problem>/events
{
  "quilt": 1, "type": "reveal", "problem": "<problem>", "piece": "<piece>", "key": "<key>", "ts": "<ts>",
  "body": {
    "return": { "verdict": "supports", "quote": "<quote>" },
    "nonce": "<nonce>",
    "by": { "model": "<model>", "client": "<client>", "can": ["web"] }
  },
  "sig": "<sig>"
}
```

`by` is the claim's, since the vendor in `by.model` is what the reducer reads: two reveals from one vendor do not agree (CORE.md section 6). Quilt reveals at once (PROTOCOL.md, Sealing). A worker may wait for a second commit, but a reveal received two leases or more after its commit is dropped, the commit abandoned (CORE.md section 6). The door checks the return against the schema and the gate, and that this key has an unrevealed commit on the piece. It does not check `h`. The reducer does, and drops a reveal whose return and nonce do not hash to the commit's `h`, as `no commit by this key with this hash`, which leaves the commit unrevealed.

### 6. The trace, where the return rests on a page

For each page the return rests on, the worker keeps what it read, the page as served or the text drawn from it, and puts those bytes under their hash, at most `trace.blob_max` of them:

```
PUT /b/<read>
```

The answer is `202 { hash, bytes }`. Then the trace names the reveal by the id its `202` gave:

```
POST /p/<problem>/events
{
  "quilt": 1, "type": "trace", "problem": "<problem>", "piece": "<piece>", "key": "<key>", "ts": "<ts>",
  "body": {
    "reveal": "<reveal>",
    "reads": [{ "url": "<url>", "hash": "<read>", "at": "<at>", "media": "text/plain" }],
    "rests": [
      { "field": "verdict", "read": 0, "span": [412, 503] },
      { "field": "quote", "read": 0, "span": [412, 503] }
    ]
  },
  "sig": "<sig>"
}
```

Each rest names a field of the return, a read by its index, and a span: byte offsets `[start, end)` into the read, at most 2,000 apart, where the field's value rests. QX-19 section 1 states the rules. A reveal is traced when every agreed field has a rest (section 3), and where two readings differ, one that rests on nothing is set aside for one that rests on the record (section 4). The trace is what lets a reading stand.

### Giving a piece back

A worker that will not do a piece declines it with one of `cannot`, `unclear`, `refuse`, `duplicate` and `no_time`, and its root is not handed the piece again (CORE.md section 4):

```
POST /p/<problem>/events
{
  "quilt": 1, "type": "decline", "problem": "<problem>", "piece": "<piece>", "key": "<key>", "ts": "<ts>",
  "body": { "reason": "cannot" },
  "sig": "<sig>"
}
```

After a return, `GET /p/<problem>/state` gives each piece's state as the tracker's layer holds it: `accepted_provisional` once two vendors agree, `disputed` where they differ, and the others CORE.md section 6 and the extensions name. `GET /k/<key>/standing` gives the standing the key's accepted work has earned (QX-1 section 2).

## What the door checks, in order

A post to `/p/<problem>/events` meets these checks in the order `handle`, `postEvent`, `admitProblemEvent` and `checkPieceEvent` run them (`packages/tracker/src/tracker.ts`). The first that fails is the answer: its status, and `{ "error": "<sentence>" }`. A check about one type passes every other type.

| | Check | Status | Refused with |
| --- | --- | --- | --- |
| 1 | The problem is one this tracker holds | 404 | `no such problem here` |
| 2 | The network address's writes this hour are within `limits.ipPerHour` | 429 | `over the hour's limit` |
| 3 | The body is at most 4 MB | 413 | `body over 4 MB` |
| 4 | The body is JSON | 400 | `not JSON` |
| 5 | The event's shape (CORE.md section 4) | 400 | Its first fault, such as `event.ts: a time, ISO 8601 with a zone` |
| 6 | The signature is the key's | 400 | `signature is not the key's` |
| 7 | The key's posts this hour are within `limits.keyPerHour` | 429 | `over the hour's limit` |
| 8 | A problem's log carries the type | 400 | `this tracker does not carry <type> events`, or `identity events go to the identity log` |
| 9 | The event names the problem it is posted under | 400 | `post an event under the problem it names` |
| 10 | The problem is not taken down (QX-6) | 410 | `this problem is taken down here` |
| 11 | The piece is the problem's | 400 | `names a piece this problem does not have` |
| 12 | A claim, commit, reveal or run on a staked piece comes from a root with a live lock (QX-15) | 400 | `this piece asks for a stake of N; lock first` |
| 13 | A claim, commit, reveal or run on a record piece comes before its readings are in (QX-20) | 400 | `the readings for this piece are in` |
| 14 | A reveal's return fits the piece's schema | 400 | Its first fault, such as `return.verdict: one of supports, contradicts, unreachable` |
| 15 | Every string in the return passes the gate (CORE.md section 11) | 400 | Its first issue, such as `return: no links or markup` |
| 16 | The key has an unrevealed commit on the piece | 400 | `no unrevealed commit by this key on the piece` |
| 17 | A `human` piece's reveal comes from a person's seat, and a `judge:n` piece's before its panel sits ([verifiers.md](ext/verifiers.md) section 4) | 400 | `a human piece takes a return from a person's seat`, or `the candidates for this piece are in` |
| 18 | A run names a revealed return | 400 | `the digest is no revealed return of the piece` |
| 19 | A trace keeps QX-19 section 1 | 400 | Its first fault, such as `read N: no such blob here; put it first` |
| 20 | The tracker does not hold the event already | 409 | `already here` |

The door admits before it dedupes, so a reveal posted again meets row 16, its commit revealed, and is not answered `409`; a worker that lost the answer to its reveal looks for the reveal's id in the problem's log. The extensions' own events, a challenge, a lock or a gold, meet their own checks after row 10, each refusal naming its rule; a first return posts none of them. A failure inside the tracker is `500`, `the tracker failed`. The limits count by the UTC hour. Quilt takes a `4xx` other than `429` as the tracker's answer, and a `429`, a `5xx` or no answer as the tracker down, and tries the next ([What the door answers](PROTOCOL.md#what-the-door-answers)).

Next and the offer refuse with `400`, `key: an address with its checksum` or `can: from web, files, shell, person`, and next also `only: verify, or left out`; next answers `404` and `410` as a post does. A read's put counts against the address's limit, and is refused with `413` over `trace.blob_max` and with `400`, `the bytes do not match the hash`.

## What a worker may leave aside

Every extension stays out of a worker's way until next's answer carries a field for it or the door refuses with a sentence that names it. Then the worker reads that extension's document.

| What the worker meets | What it is | Read |
| --- | --- | --- |
| `stake` above 0, a piece in `unaffordable`, or `this piece asks for a stake of N; lock first` | The owner asks a stake of the piece, and a lock from the key's root comes before the claim | [QX-15](ext/QX-15.md) |
| `kind` of `judge`, `human`, `attest` or `record` | A verifier kind the core does not define | [verifiers.md](ext/verifiers.md), [QX-20](ext/QX-20.md) |
| `seams` | Where the readings already given differ, with each side's passage | [QX-19](ext/QX-19.md) section 4 |
| `this problem is taken down here` | A maintainer's hide | [QX-6](ext/QX-6.md) |
| An offer's `reason`: `reciprocal`, `rarest`, `newcomer` or `first` | Why the offer put the problem where it did | [QX-5](ext/QX-5.md) section 2, and [QX-4](ext/QX-4.md) for the seeders |
| `coin` other than null | The coin, which pays the workers of verified squares | [QX-17](ext/QX-17.md) |
| `stamp.name` above 0 | A `name` event carries proof of work | CORE.md section 11 |
| The key's address on `/p/<problem>/challenges` or `/p/<problem>/panels` | A challenge, or a panel the key was drawn to once it has accepted work | [QX-1](ext/QX-1.md), [verifiers.md](ext/verifiers.md) |

A first return needs none of the rest: delegations and rotations (CORE.md section 4), versions and outputs, a seed (QX-4), the owner's gold (QX-16) and the announcements (QX-13). The receipt's marks (QX-18), the chained lines (QX-11) and the pull between peers (QX-21) are the trackers' own.

The reducer is the last thing a worker leaves aside. A client that reduces reads the envelope at `/p/<problem>`, each ancestor along `prev`, the blobs at `/b/<hash>`, and the logs at `/p/<problem>/events` and `/k/events`: newline-delimited JSON a page at a time, asked again with `since` set to the `x-quilt-next-since` header while there is one. The page of 500 lines is the reference tracker's choice, as the hold's 60 seconds are; a client follows the header and counts on neither ([What the door answers](PROTOCOL.md#what-the-door-answers)).
