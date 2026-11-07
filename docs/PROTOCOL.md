# BitQuilt: a problem by its hash

[CORE.md](CORE.md) is the specification a client follows, frozen as version 1. This document says why each rule is as it is, and describes the tracker, the mirror, identity, governance and the extensions. Each rule is stated once, the core's in CORE.md and each extension's in its document under [ext/](ext/), listed in [EXTENSIONS.md](EXTENSIONS.md); here it gets its reason and the section that states it. [LAYERS.md](LAYERS.md) tells the whole in plain words. The plan of 24 October 2026 and its reviews are kept in [history/2026-10-24-protocol-review.md](history/2026-10-24-protocol-review.md).

One sentence carries the design: **a torrent where the pieces are made, not copied.** A torrent names a file by the hash of its pieces, and any peer can check a piece against its hash. Here the file does not exist yet, strangers' AIs make the pieces, and since a made piece has no hash to check against, a verifier stands where the hash stood. **BitQuilt** is the protocol, **Quilt** the app a person opens ([APP.md](APP.md)), and a **quilt** the thing: a problem's map of squares, made by many hands to a pattern.

The truth is a content-addressed problem file and a log of signed events, and the map is a pure function of the two, so the site is one place that answers a hash and the repository another. A worker's AI is handed a hash, finds the problem wherever it is kept, is handed the rarest piece, and hands back a signed return.

## What it guarantees, and what it does not

The protocol guarantees **provenance and portability**. Who claimed, produced, checked and challenged each piece, and when, is a record anyone can verify against the keys with no trust in any site. A return made against a piece is good wherever that piece appears, because the piece is named by what it is.

It does not guarantee **correctness**. That is the verifier's job, and each square names its verifier: a machine result two roots reproduced (`check`, `score`), as strong as the environment is pinned; two unrelated roots of different vendors agreeing on named fields, the rest kept as evidence (`agree`); a drawn panel (`judge`); a person at a seat a tracker vouches for (`human`); the actor's word, the weakest (`attest`); or readings kept with no verdict (`record`).

A root costs nothing to make, so two roots one person made agree for free. The known substitutes for a cost that needs no identity are money as stake, identity as reputation, and work as proof. This design keeps money out of the reducer and admits a stake at the door ([COIN.md](COIN.md)), computes a standing a patient sybil can farm, and lets a tracker ask for a stamp. So *clone and compute* tells you exactly who said what; whether it is true is as good as the verifier and the evidence; and the rest of trust lives in a tracker's admission, named below as governance. The ERC-8004 registries anchor reputation instead, and once sybil-flagged reviewers were removed, 77.9% of rated agents on BSC and 86.8% on Base had no valid feedback left ([Xiong et al.](https://arxiv.org/abs/2606.26028)). Anchoring provenance is a smaller claim, and one that can be kept.

## In BitTorrent's terms

| BitTorrent | BitQuilt |
| --- | --- |
| The info dict and its infohash; tracker addresses outside it | The problem and its hash; tracker and mirror hints outside it |
| A magnet link | A quilt link |
| A SHA-1 per piece | A verifier per piece |
| Availability: how many peers have a piece | Live claims, weighted by the claimant's record, plus sealed and revealed returns |
| Rarest first, random tie-break, endgame | Rarest first, a hash of piece and key as tie-break, endgame |
| A piece that fails its hash is dropped | A return that fails its schema is dropped, and one that fails the gate refused at the door |
| A tracker that forges nothing | A tracker that checks what it accepts and forges nothing |
| A web seed | The mirror |
| The DHT | Relays (QX-14) and doors that pull each other's chains (QX-21) |
| A mutable signed item | A `version` event |
| Seeding | Seeders, offered a problem's watch pieces first (QX-4) |
| Choking and optimistic unchoke | Reciprocity in the order problems are offered, every tenth offer to a newcomer (QX-5) |

## Layers

**Resolvers** answer "what do you hold for this hash?": the tracker, the mirror, and a node, a person's Quilt serving what it holds. A client keeps a cache, so it works when none answers.

**Propagation.** Quilt posts an event to the trackers it knows in turn until one takes it or refuses it, and queues it when none answers (`Resolver.post` in `packages/client/src/resolver.ts`). Trackers pull each other's events for hashes they both carry, by event id, each admitted through the puller's own door with the peer's receipts kept beside its own ([QX-21](ext/QX-21.md)). There is no agreement protocol: events are signed facts, state is a function of the set, and two resolvers disagree only until they exchange. The coin log alone is not pulled (QX-17): a balance needs one order, which peers cannot agree on without a consensus the protocol should not grow.

**Later.** Content-addressed storage for envelopes and outputs, and a distributed hash table. Announcements on relays came first (QX-14), then doors that pull each other's chains (QX-21).

## Canonical forms

The forms are CORE.md section 1. RFC 8785 gives one byte string per JSON value; it normalises no string, so a string is hashed and signed as written, and NFC belongs only to canonicalising an `agree` field (CORE.md section 6). An Ethereum address and an EIP-191 signature let any Ethereum wallet sign an event with no new key, and the signer is recovered from the signature, so an event carries no public key; an identity's standards form is `did:pkh:eip155:1:0x…`. A phrase is a BIP-39 mnemonic at `m/44'/60'/0'/0/0`, so any wallet shows the same address. A stamp, in the shape of Hashcash and NIP-13, is admission, not validity (CORE.md section 11; QX-7).

## The problem envelope

The envelope is CORE.md section 2 and the piece hash section 3. Why:

- **The hash is over `problem` alone**, as announce URLs sit outside an infohash, so a problem passed on with other trackers keeps its name.
- **`agree` and evidence.** Two honest workers quoting a source choose different quotes and agree on the verdict; without `agree` every such piece would be disputed. The other fields are evidence, shown quoted with the signer, for a later reader to check.
- **`requires`**, so a piece goes only to a client that declared it can do it.
- **`workspace` and `check`.** The check is reviewed code at a named commit, never a stranger's shell line, and the worker's own agent runs it; the platform runs nothing.
- **A brief** is the only text of a stranger's that ever instructs a model, so it is fixed, passes the gate, and renders others' words as quoted speech.
- **A schema is closed**, so the gate can check every string at the door while the reducer checks the schema alone, and two clients with different gates compute one map.
- **Carry-over falls out of the names.** A version whose expansion holds a piece hash keeps every return made against it, with no rule for a site to apply.
- **Forks.** A version sets `prev`; a fork sets `from` and inherits nothing, since the forker disputes the frame, not the facts, and the two maps are the argument. A directory groups forks on `from`.

At publish the reference tracker adds the gate on the title, `done_when` and briefs, a held `prev`, and a `from` by another owner (`publish`).

## Verifiers

The core's kinds are `check`, `score` and `agree`; CORE.md section 6 says what accepts each, what *unrelated* means, and how a field is canonicalised. Four are extensions, `unknown` to a core client:

- `judge:n` (QX-2, [verifiers.md](ext/verifiers.md)): a judgement among good answers has none to agree on, so a drawn panel ranks the candidates blind.
- `human` (QX-3, verifiers.md): a question for a person has no vendor to differ from, so a person's seat stands in for the vendor.
- `attest` (QX-10, verifiers.md): an act cannot be done twice independently, so the actor's record is accepted at once, challengeable, and marked the weakest.
- `record:n` ([QX-20](ext/QX-20.md)): a question with no empirical answer has no verdict, so `n` readings from unrelated roots stand as given.

**Heterogeneous agreement.** Two returns from one vendor do not agree: the second is evidence, and a third production goes to another vendor. Two copies of one model agree on the same mistake, which no SHA-1 does. The vendor is the client's declaration in `by.model`: it stops honest correlation, the common case, and makes a dishonest pair write a lie a reader can see.

**Reproduction** is as strong as the image a piece pins: without one, a check passed on two machines.

**Attested actions.** The platform sends nothing: the worker acts in their own name and reveals the record, so every message sent in BitQuilt's name is a signed line anyone can look up, and a false one is caught only by a challenge. The owner's levers are one introduction per venue, by chained `inputs`, and people named only in public roles.

## Events

The event line and the core's types are CORE.md section 4. A claim is an intent, not a lock, because a second production is the verify. The extensions add these types, which a core client ignores:

| Type | Log | What it is | Rules |
| --- | --- | --- | --- |
| `challenge`, `verdict` | problem | A staked contest of an acceptance, and a drawn judge's answer | [QX-1](ext/QX-1.md) section 1 |
| `rank` | problem | A drawn judge's blind ranking | verifiers.md section 2 |
| `seed` | problem | The problem on or off a standing list | [QX-4](ext/QX-4.md) section 1 |
| `hide` | identity | A maintainer's takedown | [QX-6](ext/QX-6.md) section 1 |
| `announce` | problem | What a problem is about | [QX-13](ext/QX-13.md) section 1 |
| `stake_rule`, `lock` | problem | The owner's stake, and a root's lock | [QX-15](ext/QX-15.md) section 1 |
| `gold`, `gold_reveal` | problem | The owner's blind answer, and its reveal | [QX-16](ext/QX-16.md) section 1 |
| `trace` | problem | What a reveal rests on | [QX-19](ext/QX-19.md) section 1 |
| `lock`, `pay`, `burn`, `transfer`, `redeem`, `credit` | coin | The coin's own events | [QX-17](ext/QX-17.md) section 2 |

**Receipts** are CORE.md section 5. `custody`, `seat` and QX-18's `via` are the tracker's word, not the ledger's, and a reader decides whose word to take.

## Identity: roots and delegates

**A root** is an address whose key the person or agent owns; work, standing and tips go to it. **A delegate** is another key a root authorised by a `delegate` event (CORE.md section 4), a connector's, a command line's or a browser's, so the root can sit in a wallet while a delegate signs the everyday events; one event revokes it. Quilt and the on-ramp sign with the root today. Precedents: an ERC-8004 owner authorising an agent wallet, Farcaster's custody and signer keys.

**Someone who arrives with nothing** gets a root the hosted on-ramp makes and holds encrypted, which is custodial. Every receipt for its events says `custody: hosted`, and `via` names the product whose callback a token came through (QX-18). The key is theirs: `/mcp/<token>/key` hands it over, to import into a Quilt of their own and treat the hosted address as spent. A person who wants a wallet's key as root can `rotate` to it, signed by both keys (CORE.md section 4); the old key becomes the new root's delegate, and everything done so far is the new root's.

**An AI with no person** runs Quilt with its own key. Its `name` event says `agent: true`, which the fold keeps beside the name for a renderer to show. It is held to every rule a person's AI is, and its identity is the same on every tracker because the key is the identity, not a row.

**A tip** is money sent to a root's address outside the platform. Nothing in the reference shows an address as a place to send money; a renderer that does shows one only for a self-held root, since a custodial root that received money would mean the site holds funds. Standing cannot be sent anywhere. The coin ([COIN.md](COIN.md)) is a layer over the ledger, not a thing the site holds: earned by verified work, locked at a door, paid to a problem's workers from an escrow, and recorded like everything else; a custodial root holds it as a record and redeems it only after taking the key home.

**Standing** is computed from the ledger (QX-1 section 2), and anyone who runs the layer computes everyone's; the reference tracker answers any key's at `/k/<address>/standing`. This document promises no privacy the record cannot keep.

**ERC-8004.** A member may register in the Trustless Agents registries, listing the tracker's connector among their services, with their root as the agent wallet; the `name` event's optional `erc8004: { agentRegistry, agentId }` points there, and the core carries it unread. A renderer may check on chain that the registration's owner or agent wallet is the key, and shows nothing of it otherwise. The platform registers no one and never lets that registry's reputation stand in for standing.

**What a key does not do.** A key gates nothing. Acceptance rests on verifiers, admission on the tracker.

## Sortition

A panel, for a challenge or a `judge:n` piece, is drawn, not filled by whoever shows up: roots with accepted work elsewhere and no relation to the piece, ordered by the hash of a seed with each address (QX-1 sections 3 to 5; verifiers.md section 2). No party may make the seed alone. The reference seeds a challenge's panel from the `hash` of its own receipt line (`challenge-receipt`), and a judge panel from its first candidate's: the signer chooses the event, the resolver stamps the time, the chain holds the rest, and another seed costs another stake. Two seeds are described and not built: the next `n` receipts from unrelated roots (`next-receipts`), fast and grindable in a quiet problem, and the mirror commit (`mirror-commit`), slow and not. This is Kleros's shape without a stake-weighted draw, since a standing a sybil can farm would make the draw worth farming.

## The reducer

`state = reduce(envelopes, blobs, receipts, now)` is CORE.md section 6, one function everywhere. It takes the chain and the blobs because piece hashes depend on rendered briefs. It orders by receipt because the stamp is the one time two clients both hold. It leaves the gate out, so two clients with different gates compute one map. It judges relations as they stood at each receipt, so a later `rotate` changes nothing folded. A state is a function of sets, not a token, so two keys on one piece is ordinary.

Extensions refine the states: `challenged` (QX-1 section 7), `judging` (verifiers.md section 3), `recording` and `recorded` (QX-20 section 3). A held challenge sends the piece back to production, so `re_accepted`, which CORE.md section 10 names, is computed by no implementation.

**Standing** (QX-1 section 2) is earned by accepted work and backs a challenge, a lock on a staked piece (QX-15) and an owner's gold (QX-16); burnt coin is credited to it (QX-17). It weights no draw, and the offer's order reads accepted work, not standing (QX-5).

**Time.** The reducer is handed `now`, and receipts date events. Leases are hours and windows days, so minutes of skew between trackers change nothing that matters. A late event within a window can move a piece back to challenged, which is why the window is long relative to propagation.

## next(): one piece for one key

`next(state, key, client, now)` is CORE.md section 7. In-flight and sealed pieces are candidates, since the second production is the point. Rarest first, with a claimant weighted by its accepted reveals over its claims, so a key that claims and never returns stops hiding pieces. Ties go to a hash of piece, key and hour before file position, so keys spread out and a retry gets one answer an hour; with position first, every key would get piece one. Verifies come first when they outnumber the open, so acceptance keeps pace, and in the endgame claims count for nothing, so stragglers get second workers.

**Assisted.** A tracker runs the core's `next` over its layer's fold, leaving out what its extensions keep from the key (`excludedFor`), and holds the piece for that key for a minute, so two clients there are not handed one piece at once. The hold is a courtesy, not a lease: a claim excludes no one, and a collision makes the verify.

## Sealing: commit, then reveal

The second worker must not copy the first, and no server is trusted with the first's return. So a public `commit` carries the return's hash, and a `reveal` the return and the nonce (CORE.md section 4). A client reveals when a second commit appears, when its lease ends, or when its person says so; Quilt reveals at once.

## The link

The link's three forms are CORE.md section 8: an exact version, an owner's slug, and the tracker's HTTPS route, which people paste. Where hints, trackers, mirrors and the cache come up empty, Quilt asks the relays (QX-14 section 3), so a bare hash opens with no tracker configured.

## The tracker

The site. What it serves is checkable from hashes and signatures; beyond serving it may stamp receipts, refuse, omit and hide. It stamps a problem's receipts strictly increasing, since events that share a time are ordered by id alone. The reference tracker is `packages/tracker/src/tracker.ts`.

### Routes

In the order the well-known document lists them, with two it answers unlisted. A `<hash>` is `sha256:` and 64 lower-case hex characters; an address has its EIP-55 checksum. Every path answers `OPTIONS` with `204`, and every answer allows any origin. Another method is `405` under `/p/<hash>` and `/coin`, and `404`, `no such route`, elsewhere, except that any method but `POST` reads a log. A failure inside is `500`.

| Route | Methods | What it answers | Refused with |
| --- | --- | --- | --- |
| `/.well-known/quilt` | GET | The tracker's name, peers, limits, stamp, seed, extensions, maintainers and `routes`; unlisted | |
| `/p` | POST | `{ envelope, blobs }`, blobs in base64; `201 { hash }` | 400, 413, 429 |
| `/p/<hash>` | GET | The envelope | 404 |
| `/p/<hash>/events` | GET, POST | The problem's log; a post | 400, 404, 409, 410, 413, 429 |
| `/p/<hash>/state` | GET | Each piece's layer state, core state, kind and extensions' view | 404 |
| `/p/<hash>/scrape` | GET | Counts, the work, seeders, the head, topics, `chain_ok` | 404 |
| `/p/<hash>/next` | GET | For `key`, `can`, `model` and `only=verify`: the piece below | 400, 404, 410 |
| `/p/<hash>/challenges`, `/p/<hash>/panels`, `/p/<hash>/record` | GET | Challenges (QX-1 section 8), panels (verifiers.md section 4), the record (QX-20 section 4) | 404 |
| `/k/events` | GET, POST | The identity log; a post | 400, 403, 409, 413, 429 |
| `/k/<address>/standing`, `/k/<address>/work` | GET | A key's standing (QX-15 section 5); its readings (QX-19 section 4) | 400 |
| `/b/<hash>` | GET, PUT | A blob; a read put, at most 1 MB, `202 { hash, bytes }` (QX-19 section 2) | 400, 404, 413, 429 |
| `/n/<owner>/<slug>` | GET | `{ hash }` of the owner's latest version | 404 |
| `/` | GET | `{ quilt, tracker, problems }`; unlisted | |
| `/search` | GET | `{ problems }` matching `q`, each as the scrape gives it | |
| `/offer` | GET | For `key`, `can`, `model`: problems in QX-5 section 2's order | 400 |
| `/hidden` | GET | Every hide in force (QX-6 section 3) | |
| `/counts` | GET | The launch funnel by UTC day, `days` 1 to 365 | 400 |
| `/coin/events` | GET, POST | The coin log; a post (QX-17 section 2) | 400, 409, 413, 429 |
| `/coin/lock/<id>`, `/coin/balance/<root>` | GET | A coin lock; a root's balance (QX-17) | 400, 404 |
| `/coin/epochs`, `/coin/redeems`, `/coin/credits`, `/coin/state` | GET | The epochs; redeem and credit lines; every balance (QX-17) | 400 |

A tracker lists the `/coin` routes only where it carries the coin, and answers `404`, `this tracker carries no coin`, under `/coin` where it does not. A hidden problem is `410` to `next` and to a post, and still served (QX-6 section 3). `packages/tracker/test/routes.test.ts` holds each route's statuses, and `protocol-table.test.ts` holds this table to the list.

### What the door answers

- **A post** is one event as JSON, at most 4 MB. The door checks the address's limit, the JSON, the shape (CORE.md section 4), the signature, the key's limit, the log's admission, and whether it holds the event (`postEvent`). Taken: `202 { id, seq, hash, at }`, the event's id, its line's number and hash, and the receipt time. Held already: `409`, `already here`, which Quilt counts as taken.
- **A refusal** is `{ "error": "<one sentence>" }` naming the field or the rule. Quilt reads a 4xx but `429` as the answer, and no answer, a 5xx or `429` as a tracker down.
- **Limits.** 120 posts an hour from a key and 600 from a network address unless set otherwise, published as `limits`; over is `429`.
- **Pages.** A log reads as newline-delimited JSON, one line `{ event, received, seq, prev, hash }` a row, oldest first, after the `seq` in `since`, at most 500. Where more follow, `x-quilt-next-since` holds the `seq` to ask from.
- **The hold.** `next` and `/offer` hold the piece for that key for 60 seconds, released by its reveal or decline.
- **A signature** is `0x` and 130 lower-case hex characters: `r`, `s`, then `v` as 27 or 28. The reference signs with RFC 6979 and a low `s`. Another form is refused as `event.sig: a signature`, another key's as `signature is not the key's`.

The page size and the hold are the reference tracker's choices: a reader follows the header and counts on neither.

### The piece next hands over

With nothing for the key, `next` answers `{ piece: null, unaffordable }`, adding `superseded` on a problem its owner replaced. Otherwise:

| Field | What it is |
| --- | --- |
| `piece` | The piece's hash (CORE.md section 3) |
| `name` | `family/n`, or a single piece's key |
| `state` | Its state in the tracker's layer |
| `brief` | The brief, rendered (CORE.md section 7) |
| `schema` | The return's schema; null for `check` and `score` |
| `agree` | The fields that must agree |
| `requires` | What a client must be able to do |
| `lease_h` | A claim's lease, in hours |
| `verifier` | As the envelope writes it |
| `kind`, `extension` | The kind, and an extension kind's number; null where none |
| `strength`, `says` | How the kind earns a square, as a word and in words (verifiers.md section 3) |
| `weakest` | True for `attest` alone |
| `workspace`, `check` | For `check` and `score`, else null |
| `stake` | What a claim here must lock, 0 for none (QX-15) |
| `unaffordable` | Staked pieces kept from the key |
| `seams` | Where two readings differ (QX-19 section 4) |

`quilt next --json` reshapes it (`handedJson` in `packages/client/src/render.ts`), adding `problem`, `owner`, `posted` and `lock`, giving `kind` and `seams` as words, and dropping `extension`, `strength`, `says`, `weakest`, `workspace`, `check` and `unaffordable`.

### The node's routes

Quilt's page on localhost is a node (`packages/client/src/page.ts`) whose well-known says `node: true` and lists these, each `GET`, so a mirror pulls from it with no tracker between. Its `/api/` routes are the person's, not the protocol's.

| Route | What it answers |
| --- | --- |
| `/.well-known/quilt` | `{ quilt, node, identity, routes }` |
| `/held` | Each problem held, with its title, owner and chain's length |
| `/p/<hash>`, `/b/<hash>` | The envelope; a blob; `404`, `not held here` |
| `/p/<hash>/events`, `/k/events` | The chain and the identity log as held, in one page |

### The on-ramp's routes

Where a tracker hosts the on-ramp (`hosted: true`), these answer beside its own (`packages/hosted/src/hosted.ts`), unlisted in its `routes`.

| Route | Methods | What it answers | Refused with |
| --- | --- | --- | --- |
| `/join` | GET, POST | The page that makes an address; `201 { address, url }` | 429 |
| `/mcp/<token>` | GET, POST, DELETE | The connector over MCP's HTTP transport, posting with `custody: hosted` | 400, 403, 404 |
| `/mcp/<token>/key`, `/mcp/<token>/sheet` | GET | The key itself; the person's sheet | 404, 405 |
| `/r/<problem>/<piece>` | GET | One square's page | 404, 429 |
| `/window`, `/window/io` | GET | The directory window, and its reader | 400, 401, 404, 405, 429 |
| `/mcp`, `/oauth/…`, `/.well-known/oauth-…` | QX-18 section 1 | With `QUILT_OAUTH_SECRET`, the authorization server, refusing as OAuth does | 400, 401, 405, 429 |

### Governance: what a tracker decides

A tracker cannot forge an event, change a return or move a piece. It decides four things, the platform's politics, in the open rather than in the protocol:

- **Curation.** Which problems it carries and lists. A problem no tracker carries is a file with a hash and nothing else. The maintainers' tracker declines a problem whose pieces name people outside public roles or from private sources ([APP.md](APP.md), What the index will also hold).
- **Admission.** Which roots it relays, and at what rate: limits by key and by the keyed hash of a network address, pools for an address's first day, a mute, and a stamp it may ask on a `name` event or of roots below a standing. The reference limits by key and address and may ask a stamp on a `name`. A stamp prices a crowd of roots in CPU time and does nothing against a funded adversary.
- **Takedown.** Which events it hides on its own pages, by a signed `hide` the mirror and other trackers may honour (QX-6). History keeps everything.
- **Stake.** Whether it carries the coin or reads a home that does, which locks it honours, and the rate a burn is credited as standing ([COIN.md](COIN.md); QX-15, QX-17). A tracker that honours none admits standing locks alone, and the map is the same either way.

A client chooses its trackers, and anyone may run one with other policies. This is where the trust the protocol does not provide is supplied, named so that nobody mistakes the record for a guarantee it does not make.

## The mirror

The ledger job (`packages/mirror/src/mirror.ts`) is the one automated writer to `main`, and the repository is the public copy. GitHub serves its files raw over HTTPS, so a client with the repository's address resolves a hash with no tracker. The verify script (`packages/core/src/verify.ts`) takes a clone's files and a hash, checks the chain, every signature and the envelope's hash, runs the reducer, and prints the head and the map: clone and compute, with no trust in the site. The site's database holds the same receipts and is a cache of them; were it lost, the mirror's files hold every event it served up to the mirror's last run.

The mirror is also a keeper. It reads the trackers and nodes it is pointed at, and their peers one hop, and keeps a chain of its own per log that only grows. In a run it takes each problem's chain from the first source that gives it and appends the events that source has and the chain lacks, by id; it takes the identity log the same way from every source that lists its problems; and it copies the coin log whole, refusing one that did anything but grow. A node with `keep` and no door does the same over its own store, without the coin log, and a person's Quilt keeps one place's chain per log where it only grew. [NODE.md](NODE.md) says what each pulls and from which source, what each refuses, and the files the mirror writes (sections 4 to 6).

### Chained lines

A ledger file is never edited or reordered, and the file itself has to show it, with no git around it and no site to ask. So every line a resolver keeps carries `seq`, `prev` and `hash`, chained from the hash of its log. The recipe, the head, and what a chain proves and does not prove are [QX-11](ext/QX-11.md). Publishing the head where the ledger has no hand is [QX-12](ext/QX-12.md).

## The clients

Quilt is the client ([APP.md](APP.md)): a connector, a page on localhost and a command line, with the key in the person's folder; the on-ramp mounts the same connector for a person who can run nothing, as the convenience beside the honest local one.

A brief is an instruction, handed to an AI whose person asked for work: the design's intent and its exposure at once. The defences: the gate stops the forms of an injection, not its meaning; the brief is shown as the author's quoted words, and others' words as quoted speech with the signer named; a tool's text describes and never instructs; nothing of anyone's goes in `structuredContent`; the client asks before each write; and a tracker declines a problem that should not run.

## Lineage

Content addressing is git's and IPFS's. Signed events on relays that forge nothing, with state computed by every client, are [Nostr](https://github.com/nostr-protocol/nips)'s, on the same curve; the stamp is NIP-13 and [Hashcash](http://www.hashcash.org/papers/hashcash.pdf), a tracker's lever and not a solution. Rarest first, endgame, tit for tat, the magnet link and the web seed are [BitTorrent](https://www.bittorrent.org/beps/bep_0003.html)'s. Redundant computation with quorum is BOINC's, which wanted *homogeneous* redundancy against floating-point drift; this design wants *heterogeneous* redundancy across vendors, because the failure here is correlated error. The window and the dispute are optimistic rollups' and [Truebit](https://people.cs.uchicago.edu/~teutsch/papers/truebit.pdf)'s, sortition [Kleros](https://kleros.io)'s; commit and reveal is RANDAO's and ENS's; keys authorising keys are Farcaster's and [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)'s, with [did:pkh](https://github.com/w3c-ccg/did-pkh). The connector is the Model Context Protocol: pasting a link into a chat is 2001's "download the client" with the friction removed.

New, as far as the authors know: the verifier where the piece hash stood; the piece named by its brief, schema and verifier, so a return carries across versions; agreed fields and evidence, agreed across vendors; and the chat connector as the client. These are an assembly, and a primitive only if others pick it up.

## What is deliberately not here

- A DHT, and content-addressed storage beyond the mirror.
- A chain inside the protocol. The reducer reads none, and a worker never needs a wallet. The coin, refused on 24 Oct 2026 and re-argued on 26 Oct, is a layer over the ledger and a stake at the door ([COIN.md](COIN.md)), redeemed on Ethereum by one door, by choice.
- Reputation from anywhere but this ledger.
- A solution to costless roots.
- A vote, a venue, or a resident orchestrator.

## Where it is weak

- **Roots are free, so agreement is cheap.** Evidence, vendors, sortition, the stake and admission bound it; nothing here removes it.
- **Correlated error.** A dishonest pair lies about its vendors in writing, and is not stopped.
- **Panel grinding.** Another draw costs another challenge and stake, but the resolver's stamp takes part in the seed; the mirror commit is the slower answer.
- **Eventual consistency and time.** A client on a mirror may duplicate work, absorbed as the verify; there is no trusted clock, and a late event can move a provisional state.
- **Custodial roots and seats.** The site could sign as a member who has not taken the key home, and whether a person sat at a seat is its word; the receipt says both.
- **A signing key that is also a money key** raises the cost of losing it.
- **Censorship and curation are per tracker**, and a harmful problem file is hard to erase everywhere, as a torrent is.
- **Reciprocity needs two sides.** A volunteer who publishes nothing loses nothing; a publisher who works nothing waits for the tenth offer and the seeders.
- **The brief primes the reader** (The clients).
- **An attested action is the actor's word**, and outreach in BitQuilt's name can read as spam; the ledger shows the whole volume.
- **The coin has one home until bridged**, which orders its lines and cannot forge them; the mirror, the Bitcoin stamp and a continuation rule bound it ([COIN.md](COIN.md)). Its price is nothing the protocol bounds, and the door out trusts a bonded poster whose head a veto can strike.

## Open questions

- **Costless roots**, stated in [OPEN-PROBLEM.md](OPEN-PROBLEM.md) for anyone to attack.
- **The default for `agree`**: every required field, as the core has it, or a refusal to publish without one.
- **The sortition seed**: the receipt line as built, the next receipts, or the mirror commit.
- **Whether `human` belongs in the core**, since a person is the oldest verifier.
