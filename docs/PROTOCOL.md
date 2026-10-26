# BitQuilt: a problem by its hash

Written 24 Oct 2026 and revised the same day after a reader's review; the last section says what changed. [CORE.md](CORE.md) is the short specification a client follows, frozen as version 1: the envelope, the piece hash, the event line, the reducer for three verifiers, and the link. This document is everything around it: why each part is as it is, the reference tracker and mirror, identity, governance, the lineage, where it is weak, and the build. [SWARM.md](SWARM.md) is the argument this grew from; [DESIGN.md](DESIGN.md) is what is built today; [EXTENSIONS.md](EXTENSIONS.md) is how everything outside the core changes; [OPEN-PROBLEM.md](OPEN-PROBLEM.md) is the gap version 1 does not close, stated for anyone to attack; [APP.md](APP.md) is the thing a person opens, a search box over the world's problems, a click that hands their AI a piece, and a map filling in from strangers. Nothing in this document is built yet.

One sentence carries the design: **a torrent where the pieces are made, not copied.** A torrent names a file by the hash of its pieces, and any peer can check a piece against its hash. Here the file does not exist yet; the pieces are produced by strangers' AIs; and since a piece that is made has no hash to check against, a verifier stands where the hash stood. Everything else follows from taking that sentence seriously. The names are layered as BitTorrent's were. **BitQuilt** is the protocol, this specification and the organisation that keeps it. **Quilt** is the app a person opens ([APP.md](APP.md)). A **quilt** is the thing: a problem's map of squares, made of pieces by many hands to a pattern. A problem file is the pattern, its pieces are the squares, the finished map is the quilt, and the link begins `quilt:`, the noun's name, kept short.

The change from the 19 Oct proposal is where the truth lives. There, the site held the state and handed out work. Here, the truth is a content-addressed problem file and a log of signed events, and the piece map is a pure function of those two things. Anyone holding the file and the log computes the same map. The site becomes one place that answers a hash, and the repository another. A worker's AI is handed a hash, finds the problem wherever it is kept, sees what remains, is handed the rarest piece, and hands back a signed return.

## What it guarantees, and what it does not

The protocol guarantees **provenance and portability**. Who claimed, produced, checked and challenged each piece, and when, is a record anyone can verify against the keys with no trust in any site, which any tracker can carry, any mirror can store and any client can recompute. A return made against a piece is good wherever that piece appears, because the piece is named by what it is.

It does not guarantee **correctness**. Correctness is the verifier's job, and the verifier's strength is written on every square of the map:

- `check` and `score`: a machine result reproduced by a second root at a named commit in a declared environment. As strong as the environment is pinned.
- `agree`: two unrelated roots, declaring different models, agreeing on the fields the author named, with the rest of each return carried as evidence a later reader can check. As strong as the trackers' admission of roots, the independence of the models, and a reader's willingness to look at the evidence.
- `judge`: a panel drawn by sortition from roots with work behind them.
- `human`: a person at the seat, on the word of the tracker that opened it.

A root costs nothing to make. Two roots one person made agree with each other for free, and a panel filled by whoever shows up seats whoever shows up. The protocol does not solve this. The known substitutes for a cost that needs no identity are money as stake, identity as reputation, and work as proof. This design keeps money out of the reducer and admits a stake at the door, standing earned by work or coin from the ledger's own layer ([COIN.md](COIN.md)), computes a standing that a patient sybil can farm, and lets a tracker require work (a stamp, below) at its door. So the honest trust claim is: *clone and compute* tells you exactly who said what; whether it is true is as good as the verifier and the evidence; and what remains of trust lives in a tracker's admission policy, which is named below as governance rather than filed under censorship. The ERC-8004 registries are the cautionary case: identities and feedback anchored on a chain with semantics and sybil resistance left to whoever reads them, and a June 2026 study found that once sybil-flagged reviewers were removed, 77.9% of rated agents on BSC and 86.8% on Base had no valid feedback left ([Xiong et al.](https://arxiv.org/abs/2606.26028)). A protocol that anchors provenance and leaves correctness to a named verifier is making a smaller claim than one that anchors reputation, and can keep it.

## In BitTorrent's terms

| BitTorrent | BitQuilt |
| --- | --- |
| The info dict: name, piece length, piece hashes | The problem: title, done_when, owner, settings, pieces with brief, schema, verifier and inputs |
| The infohash, over the info dict only; tracker addresses sit outside it | The problem hash, over the problem only; tracker and mirror hints sit outside it |
| A magnet link: hash, name, trackers, web seeds | A quilt link: hash, name, trackers, mirrors |
| Metadata fetched from any peer and checked against the infohash | The envelope fetched from any resolver and checked against the hash |
| A SHA-1 per piece | A verifier per piece: check, score, agree, judge:n, human |
| A peer: a client on your machine | A client: the connector your AI talks to, hosted or on your machine, the CLI loop, or the site's form |
| Bitfields and have messages | The problem's events: claim, commit, reveal, decline, challenge, verdict, seed |
| Availability: how many peers have a piece | Availability: live claims, weighted by the claimant's record, plus sealed and revealed returns |
| Rarest first, random tie-break, endgame near the finish | Rarest first, a hash of piece and key as tie-break, endgame near the finish |
| A piece that fails its hash is dropped | A return that fails its schema or the gate is ignored; standing is lost to a challenge that holds |
| A tracker: knows who is in the swarm, holds no content, forges nothing | A tracker: serves the envelope and the events, accepts events after checking them, forges nothing |
| A web seed: a plain HTTP source for the file | The mirror: the repository, served raw over HTTPS |
| The DHT | Later: trackers that gossip, relays, a DHT. Not in the first version |
| A mutable DHT item signed by a key | A version event signed by the owner: the latest hash under a stable name |
| Seeding | Seeders, offered a problem's watch pieces first |
| Choking and optimistic unchoke | Reciprocity in the order problems are offered; every tenth offer to a newcomer's problem |

## Layers

**The record.** The problem envelope, the events, the reducer that turns them into a map, and the picker that turns a map into one piece for one key. Pure functions with no network, no database and no clock of their own: they take a time as an argument. One small library holds them, with fixture ledgers and the maps they must produce, and the fixtures are the conformance test: a client is conformant when it reproduces every fixture's map. This library is the protocol; CORE.md is its text; the rest of this document describes the shells around it.

**Resolvers.** Anything that answers "what do you hold for this hash?" Two from the first day:

- *The tracker* is the site. It serves envelopes and events, accepts a signed event after checking it, applies its admission policy, and can run the picker for a client and take the lease in one conditional update so clients on the same tracker never collide.
- *The mirror* is the repository. The ledger job writes each problem's envelope and event log by hash; GitHub serves them raw over HTTPS; anyone clones and recomputes. It is read-only and runs on the job's cadence.

A client also keeps a local cache of what it has fetched, so it can keep working when neither answers and post later.

**Propagation.** A client posts an event to every tracker it knows: the link's hints first, then its own list, as a torrent client has bootstrap nodes. Trackers may pull each other's events for hashes they both carry, taking the union by event id and keeping the earliest receipt. The mirror job pulls from the trackers it is configured with. There is no agreement protocol. Events are signed facts, state is a function of the set, and two resolvers with different subsets disagree only until they exchange.

**Later.** Trackers that gossip, content-addressed storage for envelopes and outputs, a distributed hash table. Announcements on relays came first (QX-14, 26 October 2026), after the first real problem had run; the rest waits for the second.

## Canonical forms

- **Canonical JSON** is RFC 8785 (JSON Canonicalization Scheme): sorted keys, no whitespace, shortest number form, NFC strings.
- **A hash** is `sha256:` followed by the lower-case hex of SHA-256 over canonical JSON, or over raw bytes for a blob.
- **A key** is secp256k1. **An identity** is the Ethereum address of the key: `0x` and the last twenty bytes of keccak-256 over the uncompressed public key, written with the EIP-55 checksum. Its standards form, where one is wanted, is `did:pkh:eip155:1:0x…`.
- **A signature** is a recoverable ECDSA signature in the EIP-191 personal-message form over the canonical JSON of the object without its `sig` field. The signer's address is recovered from the signature and compared with the `key` field, so an event carries no public key. Any Ethereum wallet, software or hardware, can produce this signature with no new key.
- **A phrase** backs a self-held root: a BIP-39 mnemonic at the standard Ethereum path `m/44'/60'/0'/0/0`, so importing the phrase into any wallet shows the same address and whatever has been sent to it.
- **A stamp**, where a tracker asks for one, is a `nonce` field such that the event's id has at least the tracker's stated number of leading zero bits: proof of work in the shape of Hashcash and Nostr's NIP-13. The reducer ignores stamps; they are admission, not validity.

Libraries: the noble curves and hashes packages, pure JavaScript and audited, in the browser, the connector and the CLI alike. WebCrypto has no secp256k1, so the card uses the same packages.

## The problem envelope

```json
{
  "quilt": 1,
  "problem": {
    "title": "Does the 2026 safety report say what its sources say?",
    "done_when": "Every citation has a verdict with a quote, and the summary is written",
    "owner": "0x4e5f…",
    "slug": "safety-report-2026",
    "prev": null,
    "from": null,
    "settings": { "challenge_window_h": 48, "lease_h": 2, "endgame_at": 10, "budget": 1000 },
    "pieces": {
      "cite/*": {
        "count": 912, "verifier": "agree", "lease_h": 2, "requires": ["web"],
        "brief": "Citation {n} of the report, quoted below with the sentence it supports: {cite.sentence} Citation {n}, as the report lists it: {cite.source} Read the cited source. Return whether the source supports the sentence, with a quote of at most 25 words from the source and the page it is on.",
        "data": { "cite": "cites.json" },
        "schema": { "type": "object", "additionalProperties": false, "required": ["verdict", "quote", "page"],
                    "properties": { "verdict": { "enum": ["supports", "partly", "contradicts", "unreachable"] },
                                    "quote": { "type": "string", "maxLength": 160 }, "page": { "type": "string", "maxLength": 20 } } },
        "agree": ["verdict"]
      },
      "summary": {
        "verifier": "judge:5", "inputs": ["cite/*"], "candidates": 3,
        "brief": "From the accepted verdicts, quoted below, write a 600-word account of where the report is well and poorly grounded.",
        "schema": { "type": "object", "additionalProperties": false, "required": ["text"], "properties": { "text": { "type": "string", "maxLength": 4800 } } }
      }
    },
    "data": { "cites.json": "sha256:…" }
  },
  "hints": { "trackers": ["https://workshop.example/"], "mirrors": ["https://raw.githubusercontent.com/<org>/<repo>/main/"] },
  "sig": "0x…"
}
```

And a piece whose verifier is a machine:

```json
"lint": { "verifier": "check", "requires": ["shell"],
          "workspace": { "repo": "https://github.com/<org>/<repo>", "base": "a1b2c3…" },
          "check": { "file": "checks/lint.sh", "image": "sha256:…" },
          "brief": "Run the repository's lint at the base commit and report the run." }
```

- **The hash** is over `problem` alone. `hints` and `sig` sit outside it, as announce URLs sit outside an infohash, so a problem passed on with other trackers keeps its name.
- **`owner`** is the root address that signs the envelope. **`slug`** is a short name stable across versions; `owner` and `slug` together are the problem's mutable name. **`prev`** names the version before, by hash, by the same owner. **`from`** names another owner's problem this one forks.
- **`settings`**: the challenge window in hours, the default lease, the endgame threshold in pieces, and the budget, which bounds the number of pieces a problem may expand to.
- **A piece family** has a `count` and a brief template with a `{n}` slot and data slots. **A single piece** has none. A piece names a `verifier`, an optional `lease_h`, optional `inputs` naming other pieces or families that must be accepted before it unlocks, and for `judge:n` a `candidates` count.
- **`agree`** names the fields agreement is computed on. Every other field of a return is *evidence*: kept with the return, shown quoted with its signer, and what a challenger or a later reader uses to check the claim without redoing the work. The example's two honest workers choose different 25-word quotes and agree on the verdict; without `agree`, every piece would be disputed. When `agree` is absent, every required field counts.
- **`requires`** names what a client must be able to do: `web`, `files`, `shell`, `person`. A piece that says "read the cited source" requires `web`. The picker hands a piece only to a client that declared what it requires.
- **`workspace` and `check`**, for `check` and `score` pieces: a public git repository and a base commit, and a file in that repository at that commit which the worker runs, with an optional container image digest that fixes the environment. The check is reviewed code at a named commit, never a shell line from a stranger; the platform itself runs nothing, as the workshop's rule has it, and the worker's own agent runs it under the worker's own permissions. The return of such a piece is fixed by the core: `{ patch }`, a unified diff against the workspace at `base` of at most `settings.patch_max` characters, or the empty string where the piece asks only that the check be run as it stands. A `run` names the patch by its digest, the hash of the revealed return.
- **A brief** is fixed text by the author, through the plain-text gate, and the only text of a stranger's that ever instructs a model. Its data slots render the problem's own data and other people's accepted returns as quoted speech with the signer named.
- **A schema** is closed: an object at the root, no additional properties, enums and bounded strings, typed fields for anything that is a link. Every string in a return passes the plain-text gate at the tracker's door, and a renderer may apply it again before showing text to a person or a model; the reducer checks the schema and nothing more, so that two clients with different gates still compute one map from one ledger. The schema language is the closed subset CORE.md section 2 defines: flat objects of strings, numbers, booleans, enums and arrays of those, with lengths in Unicode scalar values and tolerances absolute.
- **`data`** names content-addressed blobs the briefs draw on, by hash, fetched from the same resolvers and checked against their hashes.

**Piece hashes.** Expanding a family is deterministic, so every client arrives at the same piece ids:

```
piece_hash = sha256(canonical({ family, n, brief, schema, verifier, agree, requires, inputs, lease_h, workspace, check }))
```

with `brief` the template after its `{n}` and data slots are filled from the problem's own data; slots that render other workers' returns stay as slots, since those returns are not known when the piece is named. A return names a piece by this hash. A new version whose expansion contains the same piece hash keeps every return made against it; a version that changes anything in the hash starts those pieces afresh. Carry-over is not a rule the site applies; it falls out of the names.

**Versions and forks.** A new version is a new envelope by the same owner with `prev` set; the owner also signs a `version` event so the mutable name points at it. A reducer for a problem counts a return if its `problem` field is that problem or any ancestor along `prev`. A fork sets `from` and inherits nothing: the forker is disputing the frame, not the facts, and the two maps are the argument.

**Validation at publish.** The owner's signature; every brief and template through the gate; every schema closed; `agree` naming fields the schema has; `requires` from the fixed list; `count` and the total within `budget`; every blob in `data` present and matching its hash; a `workspace` and `check` on every `check` and `score` piece; `prev`, if set, a hash the resolver holds, by the same owner.

## Verifiers

| Kind | Accepted when |
| --- | --- |
| `check` | A patch is revealed, and two roots unrelated to each other and to the patch's author each report a `run` that applied it at `base`, in the declared image where there is one, and exited 0. |
| `score` | As `check`, with the two runs' scores within the check's `tolerance` of each other. The best such score, by the check's `better`, is the frontier. |
| `agree` | Two returns from unrelated roots whose declared model vendors differ agree on the `agree` fields after canonicalisation. The default for research pieces. |
| `judge:n` | `candidates` returns are revealed; a panel of `n` roots is drawn by sortition; each panelist ranks the candidates blind, in an order seeded by their address; the tally decides. |
| `human` | As `agree`, with every return from a seat a tracker opened for a person (`seat: person` in the receipt) and the model declared as `human`. |
| `attest` | One valid reveal from the actor, for a piece whose work is an action in the world that no second root can reproduce: a note sent, a post made, a problem published elsewhere. The return is the public record of the act. Accepted at once, challengeable within the window. The weakest kind, and marked as such on the square. An extension (QX-10). |

**Canonicalisation** folds each `agree` field by what the schema says it is: case, whitespace and NFC for strings; enums as themselves; numbers within `tolerance` where the schema gives one; dates parsed. Two returns that agree on every `agree` field agree. Two that differ mark the piece disputed and a third production is cut, from a vendor that differs from both where one is available; the first two returns that agree settle it.

**Unrelated** means not the same root, not a root and its delegate, and not the problem's owner.

**Heterogeneous agreement.** Every claim and reveal carries `by.model`, the client's declaration of the model that did the work as `vendor/model` (`anthropic/claude-…`, `openai/gpt-…`, `human`). Two returns from the same vendor do not count as agreement: the second is kept as evidence and a third production is cut from another vendor. Two instances of one model agree on the same mistake, and a SHA-1 cannot be fooled by consensus but two copies of a model can; agreement across vendors measures something closer to truth than the mode of one distribution. The declaration is the client's own word: it stops honest correlation, which is the common case, and makes a dishonest pair write a lie a reader can see.

**Reproduction** for `check` and `score` is bounded by what the piece declares: with an image digest, the second run is the same code in the same environment; without one, what is known is that it passed on two machines. The `run` event reports the patch's digest, the exit and score, the image used, and the host's platform, so a reader knows which it was. The patch's author may run the check too, and should, but that run is not one of the two.

**Attested actions.** Agreement cannot verify an act: two roots cannot independently send one note. So a piece whose work is an action takes the `attest` kind, and its return is the record: the venue as a typed link field, the recipient named by public role only, the time, and the text as sent. Nothing is sent by the platform; the worker acts from their own account, in their own name, saying they are a member working this problem, and the reveal records it afterward, signed with their key. That makes an outreach run on BitQuilt the most transparent anyone has run: every message sent in its name is a line in a public ledger with the sender's address on it, and a recipient can look it up. What `attest` does not do is verify. A record is the actor's word, and a false one is caught only by a challenge with a ground somebody can show (no such post; the desk says no note came). Where the act left a public artifact, the record points at it so anyone can look. The owner's levers are in the problem file: one introduction per venue, by chaining `inputs` so the second note to a venue unlocks only once the first is accepted; people named only in public roles from public sources, which the maintainers' tracker already requires; and the problem page saying plainly that the ledger is the record of every message sent in BitQuilt's name. A core client treats an `attest` piece as `unknown`.

## Events

One signed JSON object a line. The id of an event is the hash of its canonical form without `sig`.

```json
{ "quilt": 1, "type": "claim", "problem": "sha256:…", "piece": "sha256:…", "key": "0x…", "ts": "2026-10-24T18:00:00Z",
  "body": { "by": { "model": "anthropic/claude-fable-5-1", "client": "connector/0.1", "can": ["web", "files"] } }, "sig": "0x…" }
```

| Type | Body | Rule |
| --- | --- | --- |
| `claim` | `{ by, lease_h? }` | An intent to work the piece, with the client's declaration of model and capabilities. Live from its receipt until the lease ends. Not a lock. |
| `commit` | `{ h }` | `h` is SHA-256 over the UTF-8 bytes of the return's canonical JSON followed by the UTF-8 bytes of the nonce, 32 lower-case hex characters. A return exists and is sealed. |
| `reveal` | `{ return, nonce, by }` | Valid only if a `commit` by the same key for the piece precedes it and `h` matches, and the return fits the schema (or is a patch within `patch_max` for a `check` or `score` piece). Otherwise it is as if nothing was handed in. |
| `decline` | `{ reason }` | One of `cannot`, `unclear`, `refuse`, `duplicate`, `no_time`. Gives the piece back. The key is not offered that piece again in this version. |
| `run` | `{ digest, exit, score?, image?, host, by }` | A check or score run: `digest` is the hash of the revealed patch applied at the workspace's base, `image` the declared image where there is one, `exit` and `score` the result, `host` the platform. Not by the patch's author. |
| `challenge` | `{ stake, ground }` | Within the window, or after it with a doubled stake and a larger panel. `ground` is one sentence through the gate. Starts a sortition. |
| `verdict` | `{ for, return? }` | A drawn panelist's answer: for the challenger or for the author, with the panel's own return where the ground is a different answer. |
| `seed` | `{ on }` | Adds or removes the problem from the key's standing list. |
| `name` | `{ name, agent?, erc8004? }` | The name the key goes by, with `agent: true` for an AI with no person beside it. Not unique; a renderer appends a short fingerprint when two keys share one. |
| `delegate` | `{ to, scope, expires }` | Signed by a root: the key `to`, which has no prior event and is no other root's delegate, may sign events of the types in `scope` on the root's behalf until `expires`. |
| `revoke` | `{ of }` | Signed by a root: the delegate `of` signs for it no longer, from this event's receipt. |
| `rotate` | `{ to, sig_to }` | Signed by the old root, with the new root's signature in `sig_to` over the event without `sig` and `sig_to`, so that it covers the old root's address and cannot be lifted onto another event. `to` has no prior event. Everything the old root did is the new root's, and the old root is a delegate of the new until revoked. |
| `version` | `{ slug, hash }` | Signed by an owner: the latest version of the problem under that slug. |
| `output` | `{ hash }` | The assembled output's hash, by whoever assembled it. Anyone can recompute it. |
| `hide` | `{ id, why }` | Signed by a maintainer's key: a renderer that trusts that maintainer shows the event `id` as taken down. The reducer does not consume it; history keeps everything. |

Any event may carry a `nonce` as a stamp where a tracker asks for one.

**Receipts.** A tracker that accepts an event wraps it, and this wrapper is what resolvers serve and the mirror stores:

```json
{ "event": { … }, "received": [ { "by": "https://workshop.example/", "at": "2026-10-24T18:00:03Z", "custody": "self", "seat": "person" } ] }
```

`custody` is `hosted` when the tracker signed with a key it holds for the member, `self` when the signature arrived made. `seat` is `person` or `ai`, which only the tracker that opened the seat knows. Both are the tracker's word, not the ledger's, and a reader decides which trackers' word to take. A resolver that keeps receipts as an ordered file chains its lines, with three more fields on the wrapper that the reducer ignores (The mirror, below).

## Identity: roots and delegates

**A root** is an address whose key the person or agent owns. Work is attributed to it; standing accrues to it; a tip goes to it. **A delegate** is any other key a root has authorised by a `delegate` event: the hosted connector's key, a local connector's key, a CLI key, a browser key. Delegates sign the everyday events, so the root can sit in a wallet or stay cold. A root revokes a delegate with one event. Precedents for this shape: an ERC-8004 owner authorising an agent wallet by signature, Farcaster's custody and signer keys.

**Someone who arrives with nothing** gets a root the hosted connector makes and holds for them, which is custodial. It is exportable. Every receipt for its events says `custody: hosted`, so a reader can tell. When the person wants to hold their own identity, they `rotate` to a wallet they control, with an event signed by both keys; the hosted key becomes a delegate of the new root and keeps working, and everything done so far is the new root's.

**An AI with no person** runs the local connector or the CLI with its own key. Its `name` event says `agent: true`, and everywhere its lines show it is named as an agent on its own. It is held to every rule a person's AI is. Its identity is the same on every tracker because the key is the identity, not a row.

**A tip or a donation** is money sent to a root's address by someone who chose to, outside the platform. The platform shows the address only for a self-held root: a custodial root that received money would mean the site holds funds, and it does not. Standing cannot be sent anywhere. The coin ([COIN.md](COIN.md)) is a layer over the ledger and not a thing the site holds: earned by verified work, locked at a tracker's door, paid to a problem's workers from an escrow, and recorded like everything else; a custodial root holds coin as a record like any other and redeems it only after taking the key home.

**Standing** is a number per root computed from the ledger. Anyone who runs the reducer computes everyone's; the site's pages show each holder their own and nobody else's, and the mirror's pages do the same. That is a rendering convention of the maintainers' resolvers, not a property of the protocol, and this document says so rather than promising a privacy the record cannot keep.

**ERC-8004.** A member or agent may register in the Trustless Agents registries themselves, listing the tracker's connector endpoint among their services, with the agent wallet equal to their root. The `name` event's optional `erc8004: { agentRegistry, agentId }` points at such a registration; a renderer may check on chain that the registration's owner or agent wallet is the key, and shows nothing of it otherwise. The platform does not register anyone, reads no reputation from that registry, and never lets it stand in for standing.

**What a key does not do.** A key gates nothing. Acceptance rests on verifiers, not on who signed. Admission lives at the tracker.

## Sortition

A panel, for a challenge or a `judge:n` piece, is drawn, not filled by whoever shows up.

- **The pool** is every root with at least one accepted return on a different problem, no relation to the piece (not author, agreeing root, challenger, owner, or a delegate of one), and a client that declared what the panel piece requires.
- **The seed** is unknowable when the challenge is made: the hash of the challenge event's id with the ids of the next `n` receipts on the problem from roots unrelated to the challenger. For a `judge:n` piece it is the hash of the piece hash with the ids of the candidates' reveals and the next `n` receipts.
- **The draw** orders the pool by the hash of the seed with each root's address. The first `n` are the panel. Each is offered its panel piece by `next` and nobody else is; one that does not take it within a lease is replaced by the next in the order.
- **The limit.** A challenger who controls every receipt that follows their challenge can grind the seed. In a busy problem others' receipts intervene; in a quiet one they may not, and a quiet problem's panels are weak regardless. A tracker may instead seed from the mirror commit that first carries the challenge, which waits for the job but cannot be ground; which seed a tracker uses is in its well-known document.

This is Kleros's shape without a stake-weighted draw: standing weights nothing here, because a standing a sybil can farm would make the draw worth farming.

## The reducer

```
state = reduce(envelopes, blobs, receipts, now)
```

Pure and deterministic. The same function in the site, the connector, the CLI and the verify script, from the one library.

1. **The envelopes.** This problem's and every ancestor's along `prev`, each checked against its hash and its owner's signature, with every blob they name checked against its hash. Expand every envelope's pieces to piece hashes; a return counts when its piece is in the chain and its problem is this one or an ancestor. The reducer takes all of this as input, so a fixture ships the chain and the blobs.
2. **Order.** Sort receipts by the earliest `received.at` any resolver recorded, then by event id. An event with no receipt (a client's own, not yet posted) sorts after every receipted event, by its `ts` and then its id.
3. **Drop** what breaks a rule, silently: a bad signature; a `key` that is neither a root nor a live delegate of one for that event type; a problem or piece the envelope does not name, unless the piece belongs to an ancestor version; a `reveal` without its `commit`, or whose hash or schema fails; a `run` by the root that revealed the patch it ran, or a delegate of it; a `delegate` or `rotate` to a key with any prior event, or a `delegate` to another root's delegate; a `rotate` whose second signature does not cover the old root; a return, run or verdict from the author's root, a delegate of it, or the owner, where the rule wants another; a `challenge` whose stake exceeds the challenger's standing; a `verdict` from a root the draw did not name; a `human` piece's return whose receipt is not `seat: person` from a tracker the client takes the word of. Relations are judged as they stood at the receipt of the event being judged; a later `rotate` or `revoke` changes nothing already folded. The gate is not in this list: it decides what a tracker admits, not what a reducer counts, so that two clients with different gates compute one map (CORE.md, section 11).
4. **Per piece.** A piece's state is a function of the sets of its live claims, its unabandoned commits, its valid reveals and its runs at `now`, not a token moved by transitions. Two keys may claim or commit the same piece and the state is still one thing. A claim is live for its lease from its receipt; a commit is abandoned when its lease and one more have passed from its receipt with no reveal by its key; a claim is an intent, not a lock, and a second key claiming, committing and revealing the same piece is how a second production happens.

| State | When |
| --- | --- |
| `locked` | A piece named in `inputs` is not yet accepted or unreachable |
| `unknown` | The verifier is a kind the client does not implement: never accepted, never offered, its dependents stay locked, and no output is computed |
| `open` | No live claim, no unabandoned commit, no reveal |
| `in_flight` | A live claim and nothing more |
| `sealed` | An unabandoned commit and no reveal |
| `needs_verify` | A reveal, no accepting set, no two unrelated reveals that differ |
| `disputed` | Two reveals from unrelated roots that differ on an `agree` field, no accepting set |
| `accepted_provisional` | An accepting set, within the window from the event that completed it |
| `accepted` | An accepting set, window closed |
| `challenged`, `re_accepted` | The challenge extension: a challenge within the window; a panel that sided with the challenger, whose return stands |
| `unreachable` | Accepted with the value `unreachable` where the schema allows it |

An accepting set is, for `agree`, two reveals from unrelated roots of different vendors agreeing on the `agree` fields, where on a disputed piece the third reveal must be unrelated to both earlier roots and of a different vendor from the one it agrees with; for `check`, a revealed patch and two runs with exit 0 at its digest in the declared image from roots unrelated to each other and to the patch's author; for `score`, the same with two scores within the tolerance. A challenge after the window needs a doubled stake and a panel of five, not three.

5. **Standing** per root, from the ledger alone: one for each accepted reveal; the stake won for a challenge that held; the stake lost for one that failed; one lost by the author and by the agreeing root of a re-accepted piece; never below zero; a new root starts with the pool's minimum stake, which is one. Standing gates only how large a challenge a root may back and weights only the order problems are offered.
6. **The frontier** of a `score` piece: the best reproduced number and its run.
7. **Output.** When every piece is accepted or unreachable, the output is, in piece order, each piece's agreed fields once and its evidence fields from every agreeing return with the signer named, with a judged piece's winner in its place, as one canonical JSON document; its hash is what an `output` event names, and the mirror writes the document.

**Time.** The reducer has no clock; it is handed `now`. Receipt stamps date events. Leases are hours and windows are days, so skew of minutes between trackers changes nothing that matters. A late event within a window can move a piece from provisional back to challenged; that is the same rules on more facts, which is why the window is long relative to propagation.

## next(): one piece for one key

```
piece = next(state, key, client, now)
```

1. **Candidates**: every unlocked piece not yet accepted or unreachable, the ones `in_flight` and `sealed` included, since a claim is an intent and the second production is the point; whose `requires` the client declared it can meet, whose verifier the key may serve (`human` only from a person's seat), to which the key's root has no relation (not author, agreeing root, challenger, panelist, or the problem's owner) and on which it holds no live claim, and which the key has not declined in this version. A panel piece is a candidate only for the root the draw named.
2. **Availability** of a candidate: the sum over its live claims of the claimant's weight, plus its commits and reveals. A root's weight is its accepted reveals plus one over its claims plus one, held between a tenth and one, so a key that claims and never returns stops hiding pieces.
3. **Rarest first**: the lowest availability. Ties: more dependents first, then `sha256(canonical([piece, key, hour]))` with the hour as `YYYY-MM-DDTHH` in UTC, so two keys at the same instant spread out and one key retrying gets the same answer for an hour, and file position last. The first draft had the position before the hash, which would have sent every key to the first piece; implementing the picker found it.
4. **Verifies first** when the pieces needing a second production outnumber the open ones, so acceptance keeps pace with production. A second production is offered first to clients whose declared vendor differs from the first return's; a client of the same vendor is offered it only when no other has asked for a lease.
5. **Endgame**: when the pieces not yet accepted number `endgame_at` or fewer, live claims count for nothing in availability, so stragglers get second workers. The duplicate is the verify.
6. **The piece** is returned with its brief rendered, its schema, its `agree` fields marked, and its lease; the client emits a `claim`.

**Assisted.** A client that can reach a tracker may ask it for `next`; the tracker runs the same function against its view and takes the lease in one conditional update, so two clients on one tracker never collide. A client that can reach only a mirror runs `next` itself and may collide with another. Since a second production is the verify, a collision costs nothing extra.

## Sealing: commit, then reveal

The second worker must not be able to copy the first, and there is no server to trust with the first's return. So a return is handed in twice. The `commit` carries the hash of the return and a nonce, and is public at once: a return exists, and availability moves. The `reveal` carries the return and the nonce. A client reveals when a second commit on the piece appears, when its lease ends, or when its person says so (the first Quilt reveals at once, taking the person's hand-in as the say-so); a commit never revealed by the end of its lease and one more lease's grace is abandoned. A tracker may, as a courtesy to readers, hold an early reveal out of its pages until a second is in; the protocol does not depend on it.

## The link

```
quilt:sha256:9f3a…?dn=safety-report-2026&tr=https://workshop.example/&mr=https://raw.githubusercontent.com/<org>/<repo>/main/
quilt:0x4e5f…/safety-report-2026?tr=https://workshop.example/
https://workshop.example/p/sha256:9f3a…
```

The first names an exact version. The second names a problem by its owner and slug and resolves to the latest `version` event the owner signed. The third is the HTTPS form, which is also the tracker's endpoint, and is what people paste into a chat or a browser. The connector recognises all three. Resolution order: the link's hints, the client's own tracker list, its mirror list, its cache. The scheme is `quilt:`.

## The tracker

The site. What it serves is checkable from hashes and signatures; what it may do beyond serving is stamp receipts, refuse, omit and hide. It stamps receipts on one problem strictly increasing, since two events that share a time are ordered by id alone and a commit must fold before its reveal.

| Route | What |
| --- | --- |
| `GET /.well-known/quilt` | Capabilities, peer trackers, default lease and window, the shape of its rate limits, the stamp difficulty it asks and when, which sortition seed it uses |
| `POST /p` | Publish an envelope. Validated as above. `201` with the hash |
| `GET /p/<hash>` | The envelope |
| `GET /p/<hash>/events?since=<cursor>` | Receipts as the tracker's chained lines, oldest first, paged |
| `GET /k/events?since=<cursor>`, `POST /k/events` | The identity log: `name`, `delegate`, `revoke` and `rotate`, which name no problem, chained from the hash of `quilt:identity` |
| `POST /p/<hash>/events` | One signed event. `202`, or `4xx` with the reason: signature, rule, gate, rate, stamp |
| `GET /p/<hash>/next?key=<address>` | Assisted assignment: runs `next` for the client's declaration, takes the lease in one conditional update, returns the rendered piece |
| `GET /p/<hash>/state` | The tracker's reduced view, a convenience; a client may recompute |
| `GET /p/<hash>/scrape` | Counts by state, seeders, the last event's time, and the head of the tracker's chain |
| `GET /b/<hash>` | A blob |
| `GET /n/<owner>/<slug>` | The latest version hash by that owner's signed `version` |
| `GET /` | The problems this tracker carries, with their counts: the one place anyone browses |
| `GET /join`, `POST /join` | Where a tracker offers the hosted on-ramp: an address for a person who cannot run Quilt, with a key the tracker makes and holds encrypted |
| `/mcp/<token>` | The hosted connector at that address, over the Model Context Protocol's HTTP transport; every event it posts is received with `custody: hosted`. `/mcp/<token>/key` hands the person their key to take home |

### Governance: what a tracker decides

A tracker cannot forge an event, change a return or move a piece. It decides four things, and these are the platform's politics, in the open rather than in the protocol:

- **Curation.** Which problems it carries and lists. A problem no tracker carries is a file with a hash and nothing else. The maintainers' tracker refuses a problem whose pieces name people outside public roles or from private sources, and says so in `docs/MAINTAINERS.md`.
- **Admission.** Which roots it relays, and at what rate: limits by address and by the keyed hash of a network address, pools for an address's first day, a mute, and a stamp difficulty it may ask on a `name` event or on events from roots below a standing. A stamp is cost without identity, in the shape of Hashcash: it raises a crowd of roots from free to priced in CPU time, and does nothing against a funded adversary.
- **Takedown.** Which events it hides on its own pages, by a signed `hide` the mirror and other trackers may honour. History keeps everything.
- **Stake.** Whether it carries the coin or reads a home tracker that does, which locks it honours at its door, and the rate at which a burn of coin is credited as standing ([COIN.md](COIN.md); QX-15 and QX-17). A tracker that honours none admits standing locks alone, and the map is the same either way.

A client chooses its trackers, and anyone may run one with other policies. This is where the trust the protocol does not provide is supplied, and it is named here so that nobody mistakes the record for a guarantee the record does not make.

## The mirror

The ledger job, the one automated writer to `main`, writes:

```
problems/<hash>.json       the envelope
blobs/<hash>               the data blobs
ledger/<hash>.jsonl        receipts in receipt order, append-only
ledger/identity.jsonl      the identity log, chained from the hash of quilt:identity
names/<owner>/<slug>       the latest version hash
outputs/<hash>/            the assembled output when the reducer says complete
keys.json                  address, latest name event, delegations in force
```

GitHub serves these raw over HTTPS, so a client with the repository's address resolves a hash with no tracker. The verify script takes a clone and a hash, checks the chain, every signature and the envelope's hash, runs the reducer, and prints the head and the map: clone and compute, with no trust in the site. The site's database holds the same receipts and is a cache of them; if it were lost, the mirror rebuilds it.

### Chained lines

A ledger file is never edited or reordered, and the file itself has to show it, with no git around it and no site to ask. So every line a resolver keeps carries three fields beyond the wrapper, in the recipe of the rally's public log (`docs/log/RULES.md` in that repository), with one change: the chain begins at the problem.

| Field | What it is |
| --- | --- |
| `seq` | The line's number, counting from 1 with no gap |
| `prev` | The `hash` of the line before; for the first line, the problem's hash in hex, so a chain belongs to one problem |
| `hash` | SHA-256, in hex, over `seq`, a newline, `prev`, a newline, and the canonical JSON of the wrapper without these three fields |

A change to any line changes its hash, so the `prev` of the next, so every hash after it, so the head. The head is the last line's hash, written beside the file as `ledger/<hash>.head` with its `seq` and the short form the rally's room uses (the first sixteen hex characters as two groups of eight joined by a colon), served by the tracker's scrape, and shown on the problem's page. The mirror job copies the maintainers' tracker's chain line for line, verifies it, checks that the file only grew since the commit before (a chain rewritten whole, every hash recomputed, is refused all the same), and only then commits.

A chain is a resolver's own: two trackers hold the same events in different orders under different chains, and a client that reads from both verifies each file and merges the events by id. What a chain proves is that the resolver has not rewritten or reordered what it served since its head was last seen. What it does not prove is completeness: an event a tracker declined to receive leaves no gap. Publishing the head where the ledger has no hand, by anchoring it in a public chain through OpenTimestamps, is QX-12, built in the mirror job on 26 Oct 2026 ([ext/QX-12.md](ext/QX-12.md)).

## The clients

**The connector** is the MCP server a person's AI talks to. Its verbs are SWARM.md's: `open`, `list_problems`, `next`, `return` (one call that commits and later reveals), `decline`, `challenge`, `seed`, `read_problem`; for an owner, `publish` and `collect`. `open` takes a link, a hash, or nothing. It declares, on every claim, the model it is talking to as the host reports it and what it can do, and it shows the person the brief as the author's quoted words before the AI acts on it. It is one codebase in two places: hosted on the site, holding custodial roots and delegates for members who cannot run anything; and local, started over stdio by the person's own chat client, with the key in the person's config folder. The local connector is the honest counterpart of a torrent client, and the hosted one is the convenience. Both keep a cache and a queue: events written while no tracker answers are posted when one does.

**The CLI** is the unattended worker's loop: pull, work, run the check, return, every few minutes, with the same key as the local connector.

**The web** is the site rendering the map and a form built from a piece's schema for a person with no AI, signing with a key held in the browser or with the custodial root.

A brief is an instruction, and `next` hands it to an AI whose person asked for work, so the AI arrives ready to do what it says. That is the design's intent and its exposure at once. The defences are the ones the workshop and the room learned: the brief passes the plain-text gate, which stops the forms of an injection and not its meaning; the brief is shown to the person before the AI acts; the data slots render other people's words as quoted speech with the signer named; a tool's text describes and never instructs; nothing of anyone's goes in `structuredContent`; the person's client asks before each write; and a problem that should not run is one a tracker declines to carry.

## Lineage

Each part here has a parent, and a reader who knows them should find them named.

- **Content addressing**: git and IPFS. The problem hash, the piece hash, the blobs.
- **Signed events on dumb relays, with state computed by every client from the set it holds**: [Nostr](https://github.com/nostr-protocol/nips) (NIP-01), on the same curve. The event line, the tracker as a relay that forges nothing, the client as the place where state lives. The stamp is NIP-13.
- **Cost without identity**: [Hashcash](http://www.hashcash.org/papers/hashcash.pdf) (Back, 1997), which Bitcoin joined to money. The stamp, offered as a tracker's lever and not as a solution.
- **Rarest first, endgame, tit for tat, the magnet link, the web seed, the signed mutable item**: [BitTorrent](https://www.bittorrent.org/beps/bep_0003.html) (Cohen, 2003; BEPs 3, 5, 9, 19, 44, 53).
- **Redundant computation with quorum**: BOINC (Anderson, 2004), which the workshop's [prior-art report](PRIOR-ART.md) reads. BOINC used *homogeneous* redundancy so that floating point drift would not break agreement; this design wants the opposite, *heterogeneous* redundancy across model vendors, because here the failure is correlated error, not drift.
- **Optimistic acceptance with a window, a stake and an escalating dispute**: optimistic rollups and [Truebit](https://people.cs.uchicago.edu/~teutsch/papers/truebit.pdf) (2017) for the window and the game; [Kleros](https://kleros.io) (2018) for sortition and appeal with a larger panel.
- **Commit and reveal**: the ordinary construction, as in Ethereum's RANDAO and ENS registrations.
- **Keys as identity, authorising other keys**: Farcaster's custody and signer keys; [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)'s owner and agent wallet; [did:pkh](https://github.com/w3c-ccg/did-pkh); EIP-191 and EIP-4361 for signing and signing in.
- **The connector as the client**: the Model Context Protocol, which puts a tool inside a person's chat. Pasting a link into a chat is 2001's "download the client" with the friction removed.

What is not in the parents, as far as the authors know: the verifier standing where the piece hash stood, so that a problem is a torrent for a file that does not exist yet; the piece named by the hash of its brief, schema and verifier, so that a return carries across versions by naming alone; the split of a return into fields that must agree and fields that are evidence, with agreement required across model vendors; and the chat connector as BitQuilt's client. These are an assembly, and this document claims no more for them than that. Whether the assembly is a primitive is decided by whether others pick it up, which is decided by how small the core is and whether the first problem is one people want answered.

## What is deliberately not here

- Gossip between trackers, content-addressed storage beyond the mirror, a DHT. The formats are designed for them; announcements on relays are built (QX-14), the rest is not.
- A chain inside the protocol. The reducer reads none, and a worker never needs a wallet, a gas token or a node. Money of any kind was refused here on 24 Oct 2026; the design was re-argued on 26 Oct, as that sentence promised, and a coin now exists as a layer over the ledger, admitted at the door as a stake and never read by the reducer ([COIN.md](COIN.md) is the argument). The payment rail stays out: a holder who wants the coin on Ethereum redeems it there by one door, later, by choice.
- Reputation from anywhere but this ledger.
- A solution to costless roots. The design names the problem, bounds it with verifiers, evidence, heterogeneity, sortition and a tracker's admission, and does not claim to have removed it.
- A vote, a venue, or a resident orchestrator.

## Where it is weak

- **Roots are free, so agreement is cheap.** Two roots one person made accept anything they agree on; a crowd of them seats panels. Verifiers that are machines do not care who signed; verifiers that are agreement do. What bounds it: evidence that a reader can check, agreement across vendors, panels by sortition from roots with work elsewhere, the stake, and a tracker's admission. What removes it: nothing in this design.
- **Correlated error.** The vendor declaration is the client's word. It stops honest correlation and makes a dishonest pair lie in writing. It does not stop a dishonest pair.
- **Panel grinding.** A challenger who controls every receipt after their challenge can steer the draw; the mirror-commit seed is the slower answer.
- **Eventual consistency.** A client on a mirror may duplicate another's work; the design absorbs it as the verify. Provisional states can move when a late event arrives; the window is long for that reason.
- **Time.** No trusted clock; tracker receipts are the practical one.
- **Custodial roots.** The site could sign as a member who has not rotated. The receipt says so, the key is exportable, and the local connector is the first-class path.
- **A signing key that is also a money key** raises the cost of losing it. Delegates do the everyday signing; the root can live in a wallet; a lost phrase with no backup is a lost identity.
- **Censorship is per tracker, and so is curation.** A maintainer hides on their tracker and refuses to carry a problem; the mirror keeps history and another tracker may carry it. A harmful problem file is hard to erase everywhere, as a torrent is.
- **Person or AI** at the seat is a tracker's word. A mirror-only client cannot check it.
- **Reciprocity needs two sides.** Tit for tat orders offers among publishers who also work. A volunteer who publishes nothing is served by rarest-first alone and loses nothing; a publisher who works nothing is reached by the tenth offer and by seeders, and otherwise waits. Where everyone is one or the other, the ordering does nothing, and nothing worse.
- **The brief primes the reader.** See the clients.
- **An attested action is the actor's word.** A worker can record a note never sent. The record is public, the recipient can check it, and a challenge can unmake it; nothing verifies it. The square says so.
- **Outreach by strangers' AIs in BitQuilt's name** can read as spam to the people who receive it. The problem file chains one introduction per venue, the ledger shows the whole volume to anyone, and the maintainers' tracker can decline to carry a problem whose outreach has turned into that.
- **The coin has one home until it is bridged.** Its lines are ordered by the maintainers' tracker, which cannot forge or rewrite them and can halt, refuse, or order them within an anchoring period; the mirror's copy, the Bitcoin stamp and a published continuation rule are what bound this ([COIN.md](COIN.md)).
- **A coin's price** is nothing the protocol can bound. While transfers are off there is none; when they turn on there is one, and the design does not set it.
- **The door out trusts a bonded poster.** A head posted to the chain is bonded, not proven; anyone can check it against the stamped head from the mirror, and a veto can strike it within a window. A proof of the layer is the later answer.

## The demonstration

Paste a quilt link into a chat whose connector runs locally. It resolves through the hinted tracker, shows the map, hands the rarest piece, and posts the return. Stop the site. Paste the link on another machine: it resolves through the mirror, computes the same map, hands a rarest piece, queues the return, and posts it when the tracker is back. Clone the repository and run the verify script: the same map, every signature checked, no site involved. That is "give it a hash and it goes and finds it".

## Building it

Three things ship together or not at all, as every primitive that stuck shipped them: a short spec, a reference implementation, and a first use people wanted. CORE.md is the spec. The core library with its fixtures is the implementation, published as a package whose fixtures are the conformance test. The first problem is the use, and it is the product: a public that wants the answer, thousands of pieces, and a map that is itself the thing to publish.

**Before any of it: by hand.** Ten citation pieces, hand-written as tasks on the board as it is, three strangers from the room with their own AIs, one afternoon. The question is whether a stranger's AI, handed a brief, returns a record shaped like the schema, with its person's client asking first; and how many words of chat anyone types. The whole design rests on that, it is the question the organizing room never answered, and it costs nothing to ask before writing a line of the library.

The seed (`db/seed/workshop.json`) carries the tasks, in two tracks, in the order they should come.

| Task | Track | Builds |
| --- | --- | --- |
| by hand | test | Ten pieces, three strangers' AIs, one afternoon, written up |
| 0 | core | The library: canonical forms, hashes, keys and signatures, piece expansion, the reducer, `next`, sortition, the stamp check, fixtures as the conformance test |
| 3 | core | A key the worker holds, and every ledger line signed |
| 5 | core | A return sealed by commit and reveal |
| 6 | core | Acceptance by agreement on the `agree` fields across vendors, computed by the reducer; rows derived from events |
| 7 | core | The problem envelope and its hash; piece hashes; versions and forks |
| 8 | core | The tracker answers a hash: the routes, the link, admission |
| 9 | core | The mirror as a second resolver, and the verify script computes the map |
| 12 | core | The local connector, with the key on the worker's own machine |
| 20 | core | The app: search over indexes and relays, publishing with announcements, the library, the node |
| 1 | product | Every task names what accepted means: the verifier kind on the board |
| 2 | product | A record handed in against a schema, on the board |
| 4 | product | `next_task` on the board, through `next` |
| 10 | product | The piece map |
| 11 | product | A challenge window with standing as the stake, panels by sortition |
| 13 | product | Seeding and watch pieces |
| 14 | product | Tit for tat in the order pieces are offered |
| 15 | product | A fork of a problem |
| 16 | product | A human piece, through a form |
| 17 | the use | The first problem, run for real, as week one of a standing problem |
| 18 | the milestone | A second tracker, by someone else, from the core and the fixtures alone |
| 19 | the use | BitQuilt's own standing problem: find, build, explain, reach, seed |

The core track is the demonstration above and nothing more; when it is done, the spec, the package and the demonstration can go to the people who read protocols. The product track is the workshop's board learning to speak the protocol, and can wait for the hand test and the core to say whether it should. The numbers are names, kept from the 24 Oct cut so that a task's brief and its number stay together.

### The horizon

A protocol is infrastructure when it is the only sane way to do something people need every week, used daily by people its authors never met, through software they did not write, for things they did not anticipate. BitTorrent took about two years to own large files and four to be everywhere; Bitcoin two to reach a dollar; Nostr two before anyone outside its list noticed. BitQuilt plans on three to five years of weekly work, spent on five things.

- **The first use is a standing problem, not an event.** Large files were a recurring need, not a launch. BitQuilt's unique property is work no single AI vendor can be trusted to do alone and that adversaries must be able to check, so the first problem should never finish: a new family of pieces each week, published as a new version along `prev`, with seeders keeping last week's true. The maintainers' candidate is the labs' own public statements about their models, checked against the sources they cite by every vendor's models at once. The map becomes the reference people link to, and the community returns because the problem does. One of the first, and standing for as long as BitQuilt is, is BitQuilt itself (BitQuilt 19): a problem that researches, builds, explains, spreads and seeds the thing its workers are standing in, so that the protocol's demonstration is its own growth. Its families: the landscape of every project that hands work to AIs or checks their output, agreement-verified, whose output is at once a public comparison page, the prospect list and the prior-art section; implementations, a client in another language that passes the fixtures as a `check` piece whose check runs the conformance suite, and its reverse, a fixture the reference library fails; explainers and translations, agreement on the hard fields with the text as evidence and a `judge` among candidates, every accepted piece a page of the site; outreach to the people who verify claims for a living, as `attest` pieces chained one per venue; and seeding, a problem of one's own published on any tracker and its hash recorded, so that BitQuilt's growth is measured in strangers' problems.
- **The core stays frozen and small.** Everything else moves through [EXTENSIONS.md](EXTENSIONS.md): numbered documents, rough consensus among implementers, the maintainers as editors, and the conformance fixtures as what makes a client a client without a company's say. Every addition to the core is resisted; the core should be finishable and the ecosystem should not.
- **The milestone is the second implementation.** One implementation is a product; two is a protocol. The core should be clean enough that a stranger builds a tracker in a weekend from CORE.md and the fixtures alone, and that is a task on the board (BitQuilt 18). The first tracker the maintainers do not run is the real launch; the local connector, grown into the app ([APP.md](APP.md)), is the first-class client and the product, and the hosted one the on-ramp the project is glad to lose share from. Bounties for independent clients and trackers, if there are any, live outside the platform.
- **Costless acceptance is the research programme**, not a caveat. [OPEN-PROBLEM.md](OPEN-PROBLEM.md) states it as a problem with what has been tried and the directions to try, so that other people attack it too. A protocol with a famous open problem attracts the people who build protocols.
- **The maintainer is in public, weekly, for years.** Outside this repository and for its owner to do: one canonical essay that names the idea by its sentence; a paper with a permanent citation; a home for the spec that is not a person's name, a plain domain and an organisation's repository; a weekly note on what moved; a provisional registration of the `quilt:` scheme; a companion to ERC-8004 and a Nostr NIP where those communities read; the connector listed in the MCP registry. Ecosystems find protocols through citations, not launches.

**What to measure.** Independent trackers; independent clients passing the fixtures; problems published by strangers; pieces accepted per week; forks. Not users, not press.

**What kills protocols.** A maintainer's burnout, so the cadence is set low enough to keep for five years. A company capturing the spec, which the frozen core and the extension process are there to prevent. No second implementation. A first use the community is embarrassed by, so the standing problem is chosen for the community wanted for a decade, not for heat.

**The shape of the years.** Year one: the core frozen, the reference library, the standing problem running every week, the essay and the paper out, a few dozen regulars. Year two: the first tracker the maintainers do not run, the first problem by a stranger that matters to someone, the first extension not written by the maintainers. Year three: a tracker the maintainers do not run is the most used, and the acceptance problem has a solution or a serious literature. If year three looks like that, the thing was built.

## Open questions

- **Costless roots.** Stated as a problem in [OPEN-PROBLEM.md](OPEN-PROBLEM.md), with what has been tried and the directions the maintainers would try, for anyone to attack. Version 1 ships the provenance claim; the search is the work of the years after.
- **The default for `agree`.** Every required field when absent, as here, or a refusal to publish an `agree` piece that names none. The first problem will say which authors need.
- **The sortition seed.** The next `n` receipts, fast and grindable in a quiet problem, or the mirror commit, slow and not. Both are specified; which the maintainers' tracker uses is theirs to set.
- **The core's three verifiers.** `judge` and `human` sit outside CORE.md as extensions. Whether `human` belongs in the core, since a person at a form is the oldest verifier of all, is open.

## What changed on review

A reader's review of the 24 Oct draft, incorporated the same day:

1. **The trust claim is now stated.** Provenance and portability are guaranteed; correctness is the verifier's; roots are free and the design says what bounds that and that nothing removes it. A tracker's curation and admission are named as governance.
2. **Agreement is across model vendors.** Claims and reveals declare the model; same-vendor pairs do not count; the third production goes to another vendor.
3. **Fields split into `agree` and evidence.** The example's `quote` and `page` are evidence; `verdict` is what must agree. Without this the first problem would not have finished.
4. **Panels are drawn by sortition** from a seed unknowable at challenge time, with the grinding limit named and a slower seed offered.
5. **`check` is defined**: a workspace, a base commit, a reviewed file, an optional image digest, and what reproduction means with and without one.
6. **Pieces declare `requires`**, and clients declare what they can do.
7. **Standing is public in effect**, and the document says so. Reciprocity's limits are named. The word was flagged as crowded, and the same day the project chose quilt, later layered: BitQuilt the protocol, Quilt the app, a quilt the thing.
8. **A lineage section** names the parents and what is claimed as new, which is less than the first draft implied.
9. **The build is cut in two**: a frozen core and a reference implementation that make the demonstration, and the board's product work behind them, with a hand-run test of ten pieces before either.

A second review, of CORE.md, the same evening, found six things that would have made two conforming clients disagree and one that was a hole. All fixed in CORE.md and here:

1. **The gate left the reducer.** It decided a reveal's validity and so the map, and no two gates are alike. It is now admission at the tracker's door and a renderer's own check, with a reference implementation named by hash; the reducer checks the schema, which the core now defines as a closed subset.
2. **The reducer takes the chain and the blobs**, since piece hashes depend on rendered briefs and ancestors must expand their pieces.
3. **A claim is not a lock.** Pieces in flight and sealed are candidates for `next`, and a piece's state is a function of the sets of its claims, commits, reveals and runs, so two keys on one piece is an ordinary state and not a conflict.
4. **A rotate could be forged**: the new root's signature covered only its own address. It now covers the old root too.
5. **Check and score were incoherent**: nothing said where the work lived. The return is a patch, a run names it by digest, two runs by roots unrelated to each other and to the author accept it.
6. **The decline reasons and the commit's byte rule are written down**, unreceipted events sort after receipted ones, delegation conflicts are ruled out, relations are judged at fold time, the third reveal on a dispute has its rule, `human` is a vendor, an unknown verifier has a state, tolerance is absolute, the tie-break hash has its exact form, and a core client's `accepted` is said to mean accepted absent a challenge it cannot see.

A third note the same evening was about the horizon rather than the text: that a protocol is judged by whether strangers use it weekly through software its authors did not write, over years. What it changed here: the first use is week one of a standing problem rather than an event; a second implementation by a stranger is the milestone and a task; the open problem is a document of its own; extensions have a process; and the build section carries what to measure, what kills protocols, and the shape of the years.

A fourth note, the same night, made BitQuilt itself one of the first standing problems and asked how a piece whose work is an action gets accepted. The `attest` kind (QX-10) is the answer: accepted on the actor's own signed record, challengeable, marked as the weakest kind, with the owner's levers (one introduction per venue by chained `inputs`, public roles only) in the problem file and not in the protocol.

A fifth note asked whether a malicious edit could be rolled back, as on a chain of blocks. It cannot, because nothing is edited: a correction is a new signed event and history keeps the old one. What the question found was that the ledger files leaned on git for tamper-evidence; they now chain their own lines, each carrying the hash of the one before, so a file is checkable on its own (QX-11).

A sixth note found the vision: the local connector grown into an app a person opens, a search box over the world's problems with each one's map, a click that hands their own AI a piece, and a map they posted filling in from strangers, in the shape Napster and Gnutella once had. APP.md says what it is, what the three apps teach, and what the index will also hold; the `announce` event (QX-13) is what indexes and relays store; discovery through relays first and a DHT later is reserved (QX-14); BitQuilt 20 builds it at the end of the core track.
