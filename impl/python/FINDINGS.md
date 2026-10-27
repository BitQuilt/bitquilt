# Findings: writing the core from CORE.md and the fixtures alone

> **Postscript, the same day.** Every finding below was read against the reference and CORE.md now says what it did (section 12, Clarifications); the output document's shape is written down, a fixture for verifies-first was added, and dropped events are compared by count. With the shape in the document, this implementation reproduces 24 of 24 fixtures. The text below stands as written before that, as the record of what a stranger met.

This implementation was written from `docs/CORE.md` (version 1) and the
fixtures in `packages/core/fixtures/*.json`, with `docs/PROTOCOL.md` and
`docs/EXTENSIONS.md` read for context. No reference source, test or script
was read. Where the document was not enough, the smallest reasonable
assumption was made and is recorded here with the fixture that exposed it
and the sentence of CORE.md concerned. Result: 22 of 23 fixtures pass; the
one that does not (`22-complete-with-output`) fails on its output hash alone,
for the reason in finding 1.

What the document was sufficient for, and the fixtures confirmed without a
guess: canonical JSON; the problem hash; EIP-191 signatures recovering to
`owner` and `key`; the event id; the commit's `h` (canonical return then the
nonce, as UTF-8); the run's `digest` as the hash of the revealed return's
canonical JSON; receipt ordering by earliest `at` then id; the delegate,
revoke and rotate rules; the `sig_to` check; agreement across unrelated roots
and vendors; the disputed piece and the third reveal; the check and score
sets; the lapse of a claim, the abandonment of a commit, the window; the
version chain and the dropping of events outside it; availability, the
tie-break `sha256(canonical([piece, key, hour]))` and the endgame. Every pick
in the fixtures follows from those rules as written.

## Insufficient or ambiguous, with what was assumed

1. **The shape of the output document.** Fixture `22-complete-with-output`
   expects `output: sha256:efd5ecd8…`. Section 6, Output: "the output is one
   canonical JSON document: for each piece in file order, its agree fields
   once and every other field from each return in the accepting set with the
   signer's address, or for check and score the patch and the two runs." That
   names the contents and not the structure: array or object, how a piece is
   named (name, hash, both), under which keys the agreed fields, the other
   fields and the signer go, whether a return's other fields are flat or
   nested. About 84,000 literal readings of the sentence were hashed (arrays
   and objects keyed by name or hash; `piece`/`name`/`id`/`hash`; agreed
   fields inline or under `agree`/`agreed`/`fields`; returns under
   `returns`/`evidence`/`by`/`reveals`/…; the signer under
   `key`/`signer`/`address`/`by`/`root`/`from`; flat, nested and per-field
   evidence lists; wrappers carrying `quilt` and the problem hash); none
   matches. The shape must come from the reference code, which is outside
   the document. **Assumed:** an array in file order of
   `{piece, hash, <agree fields>, returns: [{key, <other fields>}]}` (and for
   check/score `{piece, hash, patch, key, runs: [{key, exit, score?}]}`),
   documented in `reducer.output_document`. The fixture's states, `complete`
   and pick all pass; its output does not, and is left failing on purpose.
   Version 1 cannot have two conforming outputs; the document needs the
   shape written down, or the fixture needs to ship the document and not
   only its hash.

2. **The `family` field of the piece hash.** Every fixture (the hash is in
   every event's `piece`). Section 3: "Each piece's id is
   `sha256(canonical({ family, n, brief, schema, verifier, agree, requires,
   inputs, lease_h, workspace, check }))`"; section 2: "A piece, keyed by its
   name"; "A family is a piece with `count`". Nothing says what `family` is
   when the key is written `cite/*`. Found by trying the readings against the
   fixtures' piece ids: **`family` is the key with `/*` removed (`cite`); `n`
   is a JSON integer; a single piece has `family` equal to its key and `n`
   1; absent fields are omitted, not written as null.** Also only implied by
   the list: `count`, `data` and `candidates` are not in the hash.

3. **The name of an expanded piece.** Every fixture's `expect.states` is
   keyed `cite/1`, `cite/2`, `cite/3`, `lint`, …. CORE.md never names an
   expanded piece. **Assumed:** family, `/`, `n` for a family; the key for a
   single piece.

4. **How a data slot indexes a blob.** `01-open` and every fixture whose
   brief is `Citation {n}: {cite.s}`. Section 2: a family's brief "may have
   data slots `{name.field}` filled from a blob in `data`." Not said: the
   blob's form or how `n` selects from it. **Assumed:** the blob is a JSON
   array and piece `n` takes element `n - 1`, then `field` by key; a value
   that is not a string is rendered as canonical JSON. The fixtures' blob
   `[{"s":"one"},{"s":"two"},{"s":"three"}]` and the piece ids confirm the
   array reading; the non-string case is untested.

5. **The piece-level `data` map.** `01-open`: each family carries
   `"data": { "cite": "cites.json" }`, from slot name to blob name, beside
   the problem's `data` from blob name to hash. Section 2 describes only the
   problem's map. **Assumed** as the fixtures have it.

6. **The fixture format.** Section 9 says fixtures ship "envelopes with
   their ancestors, blobs, receipts, a `now`, and the state and the pick each
   must produce" and gives no format; nothing else I was allowed to read
   describes it (`generate.ts` is TypeScript). Read off the files: `blobs` is
   hash to base64; `expect.states` is piece name to state; `expect.dropped`
   is a list of reason strings; `expect.complete`; `expect.output` is a hash
   or null; `expect.picks` is a list of `{key, client, now, piece}` with
   `piece` a name or null. A format note beside the fixtures would make the
   suite usable without reading a program.

7. **Drop reasons.** `09`, `10`, `11`, `12`, `13`, `14`, `15`, `19`. Section
   6: "Drop, silently". The fixtures carry a reason string per dropped event
   and CORE.md defines none, so `conform.py` compares the count of dropped
   events, not the strings. (This implementation's strings were written after
   reading the fixtures and happen to match them all; that is not
   conformance.)

8. **Two events with one id.** `11-rotate-forgery`. Section 4: "The id of an
   event is the hash of the event without `sig` and `sig_to`." Section 5: "A
   client merges wrappers for one event id by the union of `received`." The
   fixture's two rotates share body, `key`, `ts` and `sig` and differ only in
   `sig_to`, so they have one id (`sha256:4a0eca42…`). Merged by id as
   written, the forged and the genuine rotate become one event, and which
   `sig_to` survives is undefined; had the forgery been received first, the
   genuine rotate would be lost. **Assumed:** wrappers merge only when the
   whole event, signatures included, is identical. The fixture's expected
   state (all open, one dropped) is the same under either reading, so it
   does not decide this. The id should probably cover `sig_to`, or the
   merge rule should say what happens.

9. **Ties in receipt time across the two logs.** `10-delegate-to-a-key-with-
   history`. Section 6, Order: "Two events on one problem that share a
   receipt time are ordered by id alone." The claim (in the problem's log)
   and the delegate (in the identity log) are received at the same instant;
   the expected result needs the claim folded first, and sorting everything
   by (`at`, id) happens to give that (`7a7abd…` before `8b7629…`). The rule
   is stated for one problem's log only; a reducer takes the identity log's
   receipts "along with the problem's" (section 4) and the document should
   say the two sort as one sequence. **Assumed** so.

10. **"Prior event".** `10`, `11`. Section 4: `delegate`'s and `rotate`'s
    "`to` has no prior event". Not said whether a dropped event, an ignored
    extension event, or an appearance as `to` counts. **Assumed:** kept core
    events in which the key is `key`, and being the `to` of a kept rotate.

11. **The owner is related to everyone.** No fixture. Section 6: "Two roots
    are *unrelated* when neither is the other, neither is a delegate of the
    other, and neither is the problem's owner." Section 7, step 1: candidates
    are pieces "to which the key's root is unrelated". Read literally, the
    owner's reveals and runs never complete a set and the owner is never
    handed a piece, even an open one with no reveals. **Assumed** literally
    (PROTOCOL.md's candidate list names the owner as a relation). No fixture
    has the owner working, so a reader cannot check this.

12. **Rotation and what was already folded.** `11-rotate-forgery`. Section
    4: "Everything the old root did is the new root's"; section 6: "a later
    `rotate` or `revoke` changes nothing already folded." **Assumed:** each
    folded event keeps the root recorded at its fold; when two events are
    compared, both recorded roots are resolved through the rotations in
    force at the later event's receipt, so the old root's reveal and the new
    root's reveal are related, and weights are summed per resolved root. The
    fixture has no piece events after its rotate, so this is untested.

13. **A commit's lease.** `12-abandoned-commit`. Section 6: "A commit is
    abandoned when its lease and one more lease have passed from its
    receipt". A commit carries no `lease_h`. **Assumed:** the piece's
    `lease_h`, else the problem's; a claim's own `lease_h` is not consulted.
    The fixture passes with the problem's two hours.

14. **Boundaries.** No fixture sits on one. "Live from its receipt for
    `lease_h`" (section 4), "within `challenge_window_h`" (section 6).
    **Assumed:** a claim is live while `receipt <= now < receipt + lease`; a
    commit is abandoned once `receipt + 2 × lease <= time`; a piece is
    provisional while `now <= completion + window`.

15. **A reveal's commit, by key or by root.** `09-delegate`. Section 4: "A
    `commit` by the same key for the same piece precedes it". **Assumed**
    literally: the same key, so a root cannot reveal its delegate's commit;
    the commit must still be unrevealed and carry the matching `h`.

16. **The third reveal on a disputed piece.** `08-third-settles`. The general
    rule, "two valid reveals from unrelated roots of different vendors that
    agree", and the disputed rule, "a reveal from a root unrelated to both
    prior roots completes a set with the one it agrees with", differ: the
    second requires unrelatedness to the disagreeing root too, and says
    "both" where there may be more than two. **Assumed:** when the piece is
    disputed before a reveal, that reveal's root must be unrelated to every
    earlier revealer; otherwise sets are judged pairwise.

17. **Which accepting set.** No fixture has two. **Assumed:** the first
    completed in receipt order; its completing receipt starts the window; a
    root's "reveals in accepting sets" (weight) counts membership in that
    set. For `score`, the frontier is computed over that set only; "the best
    such score among accepting sets" suggests more than one set can stand,
    which this reading does not model.

18. **`unreachable`.** `22-complete-with-output`. Section 6: "`unreachable`:
    as `accepted`, where the agreed return has the value `unreachable` in a
    field whose schema allows it." **Assumed:** only once the window has
    closed (as `accepted`, so `accepted_provisional` meanwhile); checked on
    the `agree` fields; "allows" means an enum containing `unreachable` or a
    string whose length bounds admit it. The fixture's window is closed, so
    the provisional case is untested.

19. **Verifies first.** Section 7, step 3: "When the pieces in `needs_verify`
    or `disputed` outnumber those `open`". Not said whether the count is over
    the problem's pieces or the candidates, nor whether the vendor preference
    applies when no candidate is in those states. **Assumed:** over the
    problem's pieces; the restriction and the preference apply only when
    some candidate is in those states. Despite its name, fixture
    `20-verifies-first-and-inputs-rendered` does not exercise this: its
    pieces are accepted, open, unknown or locked, and both picks follow from
    `requires` and the tie-break. No fixture exercises step 3.

20. **Rendered inputs are unchecked.** `20-verifies-first-and-inputs-
    rendered`. Section 7, step 5: slots for other pieces' returns are filled
    "with the accepting set's returns as quoted text with the signers'
    addresses", with no fixed form. The fixture compares only the pick's
    piece name, so the rendering is unverified; this implementation's form
    is its own.

21. **Endgame's count.** `21-endgame`. Step 4: "the pieces not yet `accepted`
    or `unreachable`". **Assumed** to include `locked` and `unknown` pieces.
    The fixture has none.

22. **The tie-break's `key`.** `01`, `02`, `02b`, `03`, `07`, `20`, `21`.
    `sha256(canonical([piece, key, hour]))` reproduces every pick with
    `piece` the `sha256:` string and `key` the address exactly as passed
    (EIP-55 form). Not said whether a key is normalised first; a lower-cased
    address would hash to another order.

23. **"Not declined by the key".** Step 1. **Assumed:** declines by the key's
    root (a delegate's decline counts for its root), and "in this version"
    means declines whose `problem` is this problem's hash.

24. **Candidates with a commit.** Step 1 excludes a piece on which the root
    "has no reveal, run or live claim", not one on which it holds an
    unabandoned commit. **Assumed** literally: a sealed piece may be offered
    again to the key that sealed it. Untested.

25. **The `version` event.** "Signed by an owner". **Assumed:** dropped
    unless the key's root is this problem's owner. No fixture.

26. **A run without a score on a score piece, or with a non-zero exit.**
    **Assumed** kept as a valid event that completes nothing. No fixture.

27. **Extension events.** Section 10: "A core client treats their events as
    unknown and ignores them." **Assumed:** not folded, not dropped, not
    counted as a key's prior event. No fixture carries one.

28. **An invalid envelope.** Section 2 says what valid is and section 6 says
    envelopes are "checked", not what follows. **Assumed:** `reduce` raises.
    `conform.py` reports that as a difference.

29. **Receipts after `now`.** None in the fixtures. **Assumed:** every receipt
    is folded; `now` decides only liveness, abandonment and the window.

30. **Which envelope is "this problem".** Fixture `18-version-carries-over`
    lists the new version first and its ancestor second; section 6 says only
    "this problem's envelope and every ancestor's". **Assumed:** the envelope
    no other envelope names as `prev`, so the order of the list does not
    matter (checked: reversing it gives the same state).

## What the fixtures exercise that CORE.md does not mention

- A `judge:5` verifier with a `candidates` field (`01-open`, `20`): handled
  as `unknown`, as section 6 says for "a kind this document does not
  define"; `candidates` itself appears nowhere in the document.
- The piece-level `data` map (finding 5) and the `cite/1` naming (finding 3).
- Reason strings for dropped events (finding 7) and the fixture file format
  as a whole (finding 6).
- Receipt wrappers with `custody` and without `seat` (every fixture), and
  with neither (`11-rotate-forgery`): a reducer must not require either.
- A `by.client` of the form `fixture/1` and `host` values `darwin`/`linux`:
  free strings, as expected, but unconstrained by the document.

## Dependencies

None beyond the Python standard library. Keccak-256 (which `hashlib` lacks;
its `sha3_256` pads differently) and secp256k1 recovery are implemented in
`bitquilt/hashes.py` and `bitquilt/secp256k1.py`, checked against the Keccak
test vectors and the known addresses of the private keys 1 and 2
(`0x7E5F…Bdf`, `0x2B5A…6cF`), which the fixtures use.

## Where this code and the sentences of 26 October differ, 27 October 2026

Read against section 12's sentences after the fact, by an audit of the
code. None changes a fixture; each is marked in the code with the sentence
and left as it is for the maintainers to decide.

- **The frontier** (section 6): "the best score ... among every pair of
  qualifying runs within tolerance, whether or not that pair is the set."
  `reducer._settle` reads the accepting set's two runs alone.
- **A reveal and every earlier reveal** (section 6): "a reveal counts only
  when its root is unrelated to the owner and to the root of every earlier
  reveal on the piece." `reducer._try_complete_agree` applies that only once
  the piece is disputed; before that a reveal related to one earlier reveal
  may still pair with another.
- **Declines in the chain** (section 7, step 1): "counting events on this
  piece in this chain." `picker._declined` counts a decline only when its
  `problem` is this problem's hash, not an ancestor's.
- **The owner's reveals and runs** (section 6): a root related to the owner
  "is not otherwise related to anyone." `Identity.cannot_pair` folds the
  owner rule in, so an owner's reveal disputes nothing
  (`reducer._two_unrelated_differ`) and an owner's reveal or run bars the
  piece to every key (`picker._related_to_piece`); the reference does
  neither.
- **Unabandoned commits in availability** (section 6): "plus its unabandoned
  commits." `reducer.commits_in_force` keeps a revealed commit whatever the
  time, so a reveal counts twice in availability; the reference counts
  unrevealed commits alone.
- **A run's image and host in the output** (section 6, Output): "score",
  "image", "host" "with absent values left out." The fold keeps neither
  image nor host on a run, so `reducer.output_document` writes neither; the
  reference writes both when the run carried them.
