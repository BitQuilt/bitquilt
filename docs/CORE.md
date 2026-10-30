# BitQuilt core, version 1

The part of BitQuilt a client has to get right, and nothing else. A client that reproduces the state and the pick of every fixture in the reference library from the fixture's envelopes, blobs and receipts conforms to this document. [PROTOCOL.md](PROTOCOL.md) says why each rule is as it is and describes the tracker, the mirror, identity, governance and the extensions. This text is frozen as version 1; a change to it is version 2, and the `quilt` field, named for the link scheme, says which a document follows.

In one sentence: a torrent where the pieces are made, not copied, so a verifier stands where the piece hash stood.

## 1. Forms

- Canonical JSON is RFC 8785. Where this document hashes or signs JSON, it means the UTF-8 bytes of the canonical form.
- A hash is `sha256:` and the lower-case hex of SHA-256 over those bytes, or over the bytes of a blob.
- A key is secp256k1. An identity is the key's Ethereum address with the EIP-55 checksum.
- A signature is a recoverable ECDSA signature in the EIP-191 personal-message form over the canonical JSON of the object without its `sig` field (and without `sig_to`, where there is one). The address recovered from it is the signer and is compared with the object's `key` or `owner` field.
- A nonce is 32 lower-case hex characters.
- An hour is `YYYY-MM-DDTHH` in UTC.
- Every object carries `"quilt": 1`.

## 2. The envelope

```json
{ "quilt": 1, "problem": { … }, "hints": { "trackers": [], "mirrors": [] }, "sig": "0x…" }
```

The problem's hash, which is its name, is the hash of `problem` alone. `hints` and `sig` are outside it. `sig` is the owner's signature over the envelope without `sig`.

`problem` has: `title`; `done_when`; `owner`, an address; `slug`, a short name stable across versions; `prev`, the hash of the version before by the same owner, or null; `from`, the hash of another owner's problem this forks, or null; `settings` with `challenge_window_h`, `lease_h`, `endgame_at`, `budget` and `patch_max`; `pieces`; `data`, a map from a blob's name to its hash.

A piece, keyed by its name, has: `verifier`, one of `check`, `score`, `agree`, or a kind this document does not define; `brief`, fixed text; `schema`; `agree`, the fields agreement is computed on, or absent for every required field; `requires`, a subset of `web`, `files`, `shell`, `person`; `inputs`, pieces or families that must be accepted first; `lease_h`; and for `check` and `score`, `workspace` with `repo` and `base`, and `check` with `file`, optionally `image`, and for `score` optionally `tolerance` (how far apart two scores may be and still agree; 0 when absent) and `better` (`higher` when absent). A family is a piece with `count`, whose `brief` has a `{n}` slot and may have data slots `{name.field}` filled from a blob in `data`. A family may carry `data` of its own: a map from a slot name to the name of a blob in the problem's `data`. Such a blob is a JSON list with one entry per piece; piece `n` draws on entry `n`, counting from 1, and `{name.field}` is that entry's `field`, a dot-separated path. A string renders as itself, a missing value as nothing, any other value as its canonical JSON; a slot naming no blob of the family stays as written. `count`, a family's `data` and `candidates` describe the family and are part of no piece.

**A schema** is a closed object: `"type": "object"`, `"additionalProperties": false`, a `required` list, and `properties` each of which is one of: `{ "type": "string", "maxLength", "minLength"?, "format"?: "date" }`, with lengths counted in Unicode scalar values; `{ "type": "number" | "integer", "tolerance"?: number }`, the tolerance absolute, in the field's own units; `{ "type": "boolean" }`; `{ "enum": [strings] }`; or `{ "type": "array", "maxItems", "items": one of the above }`. Nothing else: no nested objects, no `pattern`, no other keywords. A `check` or `score` piece has no `schema` of its own; its return is `{ "patch": string }` of at most `patch_max` characters, a unified diff against the workspace at `base`, or the empty string where the piece asks only that the check be run as it stands.

An envelope is valid when the signature is the owner's, every schema is as above, `agree` names fields the schema has, `requires` is from the list, the pieces after expansion number at most `budget`, every blob named in `data` is present and matches its hash, every `check` and `score` piece has a `workspace` and a `check`, and `prev`, if set, is by the same owner. Whether a brief may be published is the tracker's decision (section 11), not part of validity.

## 3. The piece hash

A family expands to `count` pieces, `n` from 1. Each piece's id is

```
sha256(canonical({ family, n, brief, schema, verifier, agree, requires, inputs, lease_h, workspace, check }))
```

with `family` the piece's key without its trailing `/*`, or the whole key for a single piece; `n` a JSON number; `brief` the template after `{n}` and the data slots are filled from the problem's data; and a field the piece does not have left out of the object, never written as null, so that a family without `requires` or `inputs` hashes without them while the piece reads them as empty lists. Slots that render other pieces' accepted returns stay as written. A single piece is a family of one with `n` 1. A piece is named `family/n`, or by its key when it is a single piece; fixtures, maps and the output name pieces so. Two problems that contain a piece with the same hash contain the same piece.

## 4. The event line

```json
{ "quilt": 1, "type": "…", "problem": "sha256:…", "piece": "sha256:…", "key": "0x…", "ts": "…", "body": { … }, "sig": "0x…" }
```

The id of an event is the hash of the event without `sig` and `sig_to`. `piece` is absent on events that are not about one piece. An event may carry `nonce` at the top level as a stamp (section 11); it is part of the id. Two events that differ only in `sig_to` share an id: to a reducer they are two events, folded in order (section 6), and a resolver that holds one refuses the other.

| Type | Body | Valid when |
| --- | --- | --- |
| `claim` | `{ by, lease_h? }` | `by` has `model` as `vendor/model` or `human`, `client`, and `can`, a subset of the `requires` list. Live from its receipt for `lease_h`, else the piece's, else the problem's. |
| `commit` | `{ h }` | `h` is the hash of the UTF-8 bytes of the return's canonical JSON followed by the UTF-8 bytes of the nonce. Its lease is the piece's `lease_h`, else the problem's; a claim's own `lease_h` is the claim's alone. |
| `reveal` | `{ return, nonce, by }` | An unrevealed `commit` by the same key (the key, not its root: a root does not reveal its delegate's commit) for the same piece precedes it; the hash of the return and the nonce as above is that commit's `h`; the return validates against the piece's schema, or is `{ patch }` within `patch_max` for a `check` or `score` piece. |
| `decline` | `{ reason }` | `reason` is one of `cannot`, `unclear`, `refuse`, `duplicate`, `no_time`. The key's root, and every key related to it, is not offered the piece again in this chain. |
| `run` | `{ digest, exit, score?, image?, host, by }` | For a `check` or `score` piece. `digest` is the hash of a revealed return for the piece (the patch the run applied at `base`); `image`, if the piece declares one, is that image; `exit` is an integer; `score`, for `score`, a number. A run with `exit` other than 0, or without `score` on a `score` piece, is kept and completes nothing. |
| `name` | `{ name, agent? }` | The key's name. |
| `delegate` | `{ to, scope, expires }` | Signed by a root. `to` has no prior event as `key` and is no other root's delegate. `to` may sign events of the types in `scope` for the root until `expires`. |
| `revoke` | `{ of }` | Signed by a root. From this event's receipt, `of` signs for it no longer. |
| `rotate` | `{ to, sig_to }` | Signed by the old root in `sig`; `sig_to` is the new root's signature over the event without `sig` and `sig_to`, so it covers the old root's address, the time and the body. `to` has no prior event. Everything the old root did is the new root's; the old root is a delegate of the new until revoked. |
| `version` | `{ slug, hash }` | Signed by a root: the latest version under `slug` by that root is `hash`. The owner form of a link (section 8) resolves through the owner's. |
| `output` | `{ hash }` | The assembled output's hash. |

The challenge, verdict, seed and hide events are extensions, described in PROTOCOL.md; a core client ignores them: they are not folded, not dropped, and give no key a prior event.

**A prior event.** A key has a prior event once a core event signed by it has passed the checks of shape, signature and standing as a root or live delegate, whether or not it was then dropped for what it names; and once a kept `rotate` names it as `to`.

**Where events live.** An event about a piece, and a `version` or `output`, names its problem and is kept in that problem's log. `name`, `delegate`, `revoke` and `rotate` name no problem and are kept in a log of their own, the identity log, whose chain (section 11 of PROTOCOL.md, QX-11) begins at the hash of the text `quilt:identity`. A resolver serves it beside the problems it carries, and a reducer takes its receipts along with the problem's.

## 5. Receipts

A resolver serves an event wrapped:

```json
{ "event": { … }, "received": [ { "by": "https://…/", "at": "…", "custody": "self|hosted", "seat": "person|ai" } ] }
```

The wrapper is the resolver's word and is not signed by the author. A client merges wrappers for one event by the union of `received` only when the events are identical, signatures included; otherwise each wrapper is an event of its own. A wrapper may carry further fields a resolver adds, such as the chain fields `seq`, `prev` and `hash` of an extension; the core ignores them.

## 6. The reducer

```
state = reduce(envelopes, blobs, receipts, now)
```

A pure function. `envelopes` is this problem's envelope first and every ancestor's along `prev`, the ancestors in any order; `blobs` is every blob they name; `receipts` is every receipt a client holds for them, and every one folds whatever its time, `now` deciding only what is live, abandoned or within a window; `now` is a time. An envelope that fails its checks makes the input invalid: `reduce` refuses it and produces no state. Two clients with the same inputs produce the same state. Fixtures ship all four.

**Envelopes.** Each is checked against its hash and its owner's signature; each blob against its hash; each envelope's pieces are expanded. A piece hash counts if any envelope in the chain contains it. A return names a piece by hash and a problem by hash; it counts when the piece is in the chain and the problem is this one or an ancestor.

**Order.** Receipted events sort by the earliest `received.at` across the wrapper, then by event id. Events with no wrapper sort after every receipted event, by `ts`, then by id. Two events on one problem that share a receipt time are ordered by id alone, so a resolver stamps receipts on a problem strictly increasing, and a client posts a reveal only once its commit has a receipt. The identity log's receipts and the problem's sort as one sequence by the same rule.

**Roots and delegates.** A `key` is a root unless it has been delegated to or rotated from. An event from a key counts for a root when the key is that root, or a delegate of it whose `delegate` precedes the event, whose `scope` holds the type, whose `expires` is after the event's receipt, and with no `revoke` between. Two roots are *unrelated* when neither is the other and neither is a delegate of the other. A root related to the owner is counted in no accepting set and handed no piece by `next`; it is not otherwise related to anyone. Relations are judged as they stood at the receipt of the event being judged, with delegations as live then and rotations as they stand at the end of the fold; each folded event keeps the root it counted for when it was folded, and a later `rotate` or `revoke` changes nothing already folded.

**Drop**, silently: any event with a bad signature; from a key that is neither a root nor a live delegate for that type; naming a problem not in the chain or a piece not in its expansion; a `reveal` without its `commit` or failing its hash or schema; a `run` whose `digest` is no revealed return of the piece, or not in the declared image where there is one; a `run` by the root that revealed that return or a delegate of it; a `delegate` or `rotate` whose `to` has a prior event; a `delegate` to another root's delegate; a `rotate` whose `sig_to` does not recover to `to`.

**A vendor** is the part of `by.model` before the first slash; `human` is a vendor.

**Per piece.** A piece's state is a function of the sets of its live claims, its unabandoned commits, its valid reveals and its runs at `now`, not a token moved by transitions. A claim received at `r` is live while `now < r + lease`. A commit received at `r` is unabandoned while `now < r + 2 × lease`, with the piece's lease, else the problem's, and a reveal of it received at or after that moment is dropped. A window runs from the receipt `c` of the event that completed the set while `now < c + challenge_window_h`. A claim is an intent, not a lock: a second key may claim, commit and reveal the same piece, and that is how a second production happens.

- `locked`: a piece named in `inputs` is not `accepted` or `unreachable`.
- `unknown`: the verifier is a kind this document does not define. Never accepted, never offered, and the pieces that name it in `inputs` stay `locked`.
- `open`: no live claim, no unabandoned commit, no reveal.
- `in_flight`: a live claim, no unabandoned commit, no reveal.
- `sealed`: an unabandoned commit, no reveal.
- `needs_verify`: at least one reveal, no accepting set, and no two reveals from unrelated roots that differ.
- `disputed`: two reveals from unrelated roots that differ on an `agree` field, and no accepting set.
- `accepted_provisional`: an accepting set exists and `now` is within `challenge_window_h` of the receipt of the event that completed it.
- `accepted`: an accepting set exists and the window has closed.
- `unreachable`: as `accepted`, once the window has closed, where the accepting set's first reveal has the value `unreachable` in an `agree` field whose schema is an enum that lists it; while the window is open the piece is `accepted_provisional`.

**An accepting set** is:

- for `agree`: two valid reveals from unrelated roots of different vendors that agree on the `agree` fields after canonicalisation. Reveals are taken in receipt order, and a reveal counts only when its root is unrelated to the owner and to the root of every earlier reveal on the piece; among counting reveals, the first pair in receipt order whose vendors differ and whose `agree` fields agree is the accepting set, completed at the receipt of its later reveal. Two that agree but share a vendor are not one; the second is kept as evidence. A piece is `disputed` when any two reveals from unrelated roots differ on an `agree` field and no set exists.
- for `check`: a revealed `{ patch }`, and two `run` events with `exit` 0 at that patch's digest, in the declared image, from roots unrelated to each other and to the root that revealed the patch.
- for `score`: as `check`, with two `run` events whose `score` values are within the check's `tolerance` of each other. The accepting set is the pair completed first; the frontier is the best score, by the check's `better`, among every pair of qualifying runs within tolerance, whether or not that pair is the set. For `check` and `score` alike, a run counts only from a root unrelated to the owner and to the patch's author.

**Canonicalisation** of an `agree` field: strings lower-cased, whitespace folded, NFC; enums as themselves; numbers equal within `tolerance`, else exactly; strings with `format: date` compared as dates; arrays element by element.

**Availability** of a piece is the sum over its live claims of the claimant root's weight, plus its unabandoned commits and its reveals. A root's weight is (its reveals in accepting sets in this chain + 1) / (its claims in this chain + 1), bounded to [0.1, 1].

**Output.** When every piece is `accepted` or `unreachable`, the output is the canonical JSON of `{ "quilt": 1, "problem": <the problem's hash>, "pieces": [ … ] }`, one entry per piece in file order. An entry is `{ "name", "piece", "state" }`, with `piece` the hash; for an `agree` piece it adds `agreed`, an object of the `agree` fields taken from the accepting set's first reveal, and `evidence`, a list over the set's two reveals in order of `{ "signer": <root>, …every other field of that return }`; for a `check` or `score` piece it adds `patch`, the revealed patch, `author`, the root that revealed it, and `runs`, a list over the set's two runs of `{ "signer": <root>, "exit", "score", "image", "host" }` with absent values left out. Its hash is what an `output` event names. A chain with an `unknown` piece has no output.

## 7. next

`next(state, key, client, now)` returns one piece or nothing. `client` has `can` and `model`.

1. Candidates: every piece that is `open`, `in_flight`, `sealed`, `needs_verify` or `disputed`; whose `requires` is within `client.can`; on which no root related to the key's has a reveal, a run, a live claim or a decline, counting events on this piece in this chain; and the key's root is unrelated to the owner. A root with an unrevealed commit but no live claim is a candidate again.
2. Order by availability ascending; then by the number of pieces that name it in `inputs`, descending; then by `sha256(canonical([piece, key, hour]))` ascending, with `piece` the piece's hash as a string and `key` the address as written on the claim, in its EIP-55 form; then by position in the file. The hash comes before the position so that two keys at one instant spread out; with the position first, every key would be handed the first piece.
3. When the pieces in `needs_verify` or `disputed` outnumber those `open`, counting over all the problem's pieces, and some candidate is in those states, take candidates from those alone; among them, prefer pieces no reveal of which is from `client.model`'s vendor, and when every one has such a reveal, take them all.
4. When the pieces not yet `accepted` or `unreachable`, `locked` and `unknown` ones included, number at most `endgame_at`, live claims count zero in availability.
5. Return the first candidate with its brief rendered (the `{n}` and data slots filled; a slot `{entry}` naming an input replaced by one line per accepted input piece, `<name>, by <root>: <canonical return>`, the two reveals of an `agree` set a line each and the patch of a `check` or `score` set one line, joined by newlines), its schema, its `agree` fields, its `requires`, and its lease. Conformance checks the piece chosen; the rendered text is the client's.

## 8. The link

```
quilt:sha256:<hex>?dn=<name>&tr=<tracker url>&mr=<mirror url>
quilt:<owner address>/<slug>?tr=…&mr=…
https://<tracker>/p/sha256:<hex>
```

A client resolves a link through its `tr` and `mr` hints, then its own trackers, then its own mirrors, then its cache; checks the envelope's hash against the name; and checks every event's signature. The second form resolves through the owner's latest `version` event.

## 9. Conformance

The reference library ships fixtures: envelopes with their ancestors, blobs, receipts, a `now`, and the state and the pick each must produce. They cover: agreement; a same-vendor pair; a dispute and a third; a lapsed lease; an abandoned commit; a late event within the window; a delegate signing within and outside scope; a rotate, and a rotate whose `sig_to` does not cover the old root; a delegate to a key with a prior event; a check accepted, a check with a run by the patch's own author, and a score within and outside tolerance; an `unknown` verifier and a piece locked behind it; a version carrying a return over by piece hash; `next` for two keys at one instant, `next` with `in_flight` and `sealed` candidates, `next` when the pieces needing a second production outnumber the open, and `next` in endgame. A client conforms when it reproduces every fixture's states, its count of dropped events, its `complete`, its output hash and its picks; the reasons the fixtures give for dropped events are the reference's wording and not part of conformance. The fixtures' file format is described in the README beside them.

## 10. Extensions

Named in PROTOCOL.md and not part of the core: the challenge window's events (`challenge`, `verdict`), standing, and sortition; `judge:n` and `human` verifiers; seeding and watch pieces; reciprocity in the order problems are offered; the `hide` event. A core client treats their events as unknown and ignores them. A core client cannot see a challenge, so its `accepted` means *accepted absent a challenge*; a client with the extension may hold the same piece as `challenged` or `re_accepted`, and the two disagree on purpose.

## 11. Admission, not validity

Two things decide what enters a ledger and are not part of the reducer, so that two clients with different policies still compute one map from one ledger:

- **The plain-text gate** on briefs, templates and every string in a return: nothing invisible, no links or markup outside typed fields, no contact details, nothing addressed to a machine, no shouting. A tracker applies it at its door and refuses what fails; a renderer may apply it again before showing text to a person or a model. Its reference implementation is `gate/1` in the reference library, identified by the hash of its source and shipped with its own fixtures of inputs and issue codes; a tracker that claims `gate/1` reproduces them.
- **The stamp**: a `nonce` whose presence makes the event's id have at least the number of leading zero bits a tracker asks for in its well-known document, on a `name` event or on events from roots below a standing. Cost without identity, at the door.

## 12. Clarifications, 26 October 2026

A second implementation of this document, written in Python from the text and the fixtures alone with no sight of the reference code (`impl/python`), reproduced 22 of 23 fixtures and reported where the text had been silent or ambiguous. The sentences added that day say what the reference already computed; none changes a fixture: the family's own `data` map and the blob's form, and what is part of no piece (section 2); `family`, `n`, absent fields and a piece's name (section 3); one id for two `rotate` events, a commit's lease, a reveal's commit by key, a decline by root, a run that completes nothing, a `version` by any root, and what a prior event is (section 4); when wrappers merge (section 5); the order of the envelopes, receipts after `now`, an invalid envelope, the two logs as one sequence, the owner's place among relations, rotations at the end of the fold, the boundaries of a lease, an abandonment and a window, `unreachable` after the window, which pair is the accepting set and when a piece is disputed, the frontier, and the output's shape (section 6); the candidate rule in full, the tie-break's `key`, the counts for verifies-first and endgame, and the rendering of inputs (section 7); what conformance compares (section 9). With the output's shape written down and one fixture added for verifies-first, the same implementation reproduces every fixture.

**30 October 2026, the gate.** Section 11's reference implementation is now `gate/2`, identified like `gate/1` by the hash of its source and shipped with the same fixtures grown by ten cases. The one change is the rule for a telephone number, which in `gate/1` refused any nine digits in a loose run and so refused honest returns on the launch patterns: a bill of mortality's totals, a specimen's barcode, an item number beside a bracketed year. In `gate/2` a phone number needs the shape of one: a leading plus, a bracketed area code, dashes or dots between its groups, a single unbroken run, or two to four spaced groups making nine digits or more; a run of years, a run of figures in more groups than a number has, and a run named as an item, page or catalogue number pass. Nothing in sections 1 to 10, the reducer or its fixtures changes; a tracker that claims `gate/2` reproduces the grown fixtures.
