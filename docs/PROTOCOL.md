# BitQuilt: a problem by its hash

[CORE.md](CORE.md) is the specification a client follows, frozen as version 1. This document says why each rule is as it is, and describes the tracker, the mirror, identity, governance and the extensions. Each rule is stated once, and here gets its reason and the section that states it: the core's in CORE.md, the stamp's (QX-7) as its section 11; and each extension's in its document under [ext/](ext/), listed in [EXTENSIONS.md](EXTENSIONS.md). CORE.md section 4 sends a reader here for QX-11, the chained lines: Chained lines, under The mirror, gives their reason and points to [ext/QX-11.md](ext/QX-11.md), which states them. [LAYERS.md](LAYERS.md) tells the whole in plain words. The plan of 24 October 2026 and its reviews are in [history/2026-10-24-protocol-review.md](history/2026-10-24-protocol-review.md).

One sentence carries the design: **a torrent where the pieces are made, not copied.** A torrent names a file by the hash of its pieces, and any peer can check a piece against its hash. Here the file does not exist yet, strangers' AIs make the pieces, and since a made piece has no hash to check against, a verifier stands where the hash stood. **BitQuilt** is the protocol, **Quilt** the app a person opens ([APP.md](APP.md)), and a **quilt** the thing: a problem's map of squares, made by many hands to a pattern.

The truth is a content-addressed problem file and a log of signed events, and the map is a pure function of the two, so the site is one place that answers a hash and the repository another. A worker's AI is handed a hash, finds the problem wherever it is kept, is handed the rarest piece, and hands back a signed return.

## What it guarantees, and what it does not

The protocol guarantees **provenance and portability**. Who claimed, produced, checked and challenged each piece, and when, is a record anyone can verify against the keys with no trust in any site. A return made against a piece is good wherever that piece appears, because the piece is named by what it is.

It does not guarantee **correctness**. That is the verifier's job: each square names its verifier, from a machine result two roots reproduced to the actor's own word (Verifiers, below), and the evidence stays for a reader to check.

A root costs nothing to make, so two roots one person made agree for free. The known substitutes for a cost that needs no identity are money as stake, identity as reputation, and work as proof. This design keeps money out of the reducer and admits a stake at the door ([COIN.md](COIN.md)), computes a standing a patient sybil can farm, and lets a tracker ask for a stamp. So *clone and compute* tells you who said what; whether it is true is as good as the verifier and the evidence; the rest of trust lives in a tracker's admission (Governance, below). The ERC-8004 registries anchor reputation instead; without sybil-flagged reviewers, 77.9% of rated agents on BSC and 86.8% on Base had no valid feedback ([Xiong et al.](https://arxiv.org/abs/2606.26028)). Anchoring provenance is a smaller claim, and one that can be kept.

## In BitTorrent's terms

| BitTorrent | BitQuilt |
| --- | --- |
| The info dict and its infohash; tracker addresses outside it | The problem and its hash; tracker and mirror hints outside it |
| A magnet link | A quilt link |
| A SHA-1 per piece | A verifier per piece |
| Availability: how many peers have a piece | Live claims, weighted by the claimant's record, plus sealed and revealed returns |
| Rarest first, random tie-break, endgame | Rarest first, ties by dependents and then a hash of piece, key and hour, endgame |
| A piece that fails its hash is dropped | A return that fails its schema is dropped, and one that fails the gate refused at the door |
| A web seed | The mirror |
| The DHT | Relays (QX-14) and doors that pull each other's chains (QX-21) |
| Seeding | Seeders, offered a problem's watch pieces first (QX-4) |
| Choking and optimistic unchoke | Reciprocity in the order problems are offered, every tenth offer to a newcomer (QX-5) |

## Layers

**Resolvers** answer "what do you hold for this hash?": the tracker, the mirror, and a node, a person's Quilt serving what it holds. A client keeps a cache, so it works when none answers.

**Propagation.** Quilt posts an event to the trackers it knows in turn until one takes it or refuses it, and queues it when none answers (`Resolver.post` in `packages/client/src/resolver.ts`). Trackers pull each other's events for hashes they both carry, by event id, each admitted through the puller's own door with the peer's receipts kept beside its own ([QX-21](ext/QX-21.md) section 2). There is no agreement protocol: events are signed facts, state is a function of the set, and two resolvers disagree only until they exchange. The coin log alone is not pulled (QX-21 section 2): a balance needs one order, which peers cannot agree on without a consensus the protocol should not grow.

**Later.** Content-addressed storage for envelopes and outputs, and a distributed hash table; announcements on relays came first (QX-14), then the pull (QX-21).

## Canonical forms

The forms are CORE.md section 1. RFC 8785 gives one byte string per JSON value; it normalises no string, so a string is hashed and signed as written, and NFC belongs only to canonicalising an `agree` field (CORE.md section 6). An Ethereum address and an EIP-191 signature let any Ethereum wallet sign an event with no new key, and the signer is recovered from the signature, so an event carries no public key; an identity's standards form is `did:pkh:eip155:1:0x…`. A phrase is a BIP-39 mnemonic at `m/44'/60'/0'/0/0`, so any wallet shows the same address.

## The problem envelope

The envelope is CORE.md section 2 and the piece hash section 3. Why:

- **The hash is over `problem` alone**, as announce URLs sit outside an infohash, so a problem passed on with other trackers keeps its name.
- **`agree` and evidence.** Two honest workers quoting a source choose different quotes and agree on the verdict; without `agree` every such piece would be disputed. The other fields are evidence, shown quoted with the signer, for a later reader to check.
- **`requires`**, so a piece goes only to a client that declared it can do it.
- **`workspace` and `check`.** The check is reviewed code at a named commit, never a stranger's shell line, and the worker's own agent runs it; the platform runs nothing.
- **A brief** is the only text of a stranger's that ever instructs a model, so it is fixed, passes the gate, and renders others' words as quoted speech.
- **A schema is closed**, so the gate can check every string at the door while the reducer checks the schema alone, and two clients with different gates compute one map.
- **Carry-over falls out of the names.** A version whose expansion holds a piece hash keeps every return made against it, with no rule for a site to apply.
- **Forks.** A version sets `prev`; a fork sets `from` and inherits nothing, since the forker disputes the frame, not the facts, and the two maps are the argument. A directory groups forks on `from`, which the tracker's index row and the announce both carry (QX-13 section 1), and Quilt's search shows each fork under the problem it forks (APP.md, Search). Two problems alike in name with no `from` between them are two problems, shown side by side.

At publish (`publish` in `packages/tracker/src/admit.ts`) the reference tracker adds four checks: the gate on the title, `done_when` and briefs; a `prev` it holds, by the same owner; a `from` by another owner, where it holds the problem named; and, at the coin's home, a challenge window within `window_max_h` (QX-17 section 6). A `from` naming a problem it does not hold is taken on the forker's word, as the core takes it.

## Verifiers

The core's kinds are `check`, `score` and `agree`; CORE.md section 6 says what accepts each and what *unrelated* means. Four are extensions, `unknown` to a core client:

- `judge:n` (QX-2, [verifiers.md](ext/verifiers.md) section 2): a judgement among good answers has none to agree on, so a drawn panel ranks the candidates blind.
- `human` (QX-3, verifiers.md section 2): a question for a person has no vendor to differ from, so a person's seat stands in for the vendor.
- `attest` (QX-10, verifiers.md section 2): an act cannot be done twice independently, so the actor's record is accepted at once, challengeable, and marked the weakest.
- `record:n` ([QX-20](ext/QX-20.md) sections 1 and 2): a question with no empirical answer has no verdict, so `n` readings from unrelated roots stand as given.

**Heterogeneous agreement.** Two returns from one vendor do not agree: the second is evidence, and a third goes to another vendor. Two copies of one model agree on the same mistake, which no SHA-1 does. The vendor is the client's declaration in `by.model`: it stops honest correlation, the common case, and makes a dishonest pair write a lie a reader can see.

**Reproduction** is as strong as the image a piece pins: without one, a check passed on two machines.

**Attested actions.** The platform sends nothing: the worker acts in their own name and reveals the record, so every message sent in BitQuilt's name is a signed line anyone can look up, and a false one is caught only by a challenge. The owner's levers are one introduction per venue, by chained `inputs`, and people named only in public roles (verifiers.md section 2).

## Events

The event line and the core's types are CORE.md section 4. A claim is an intent, not a lock, because a second production is the verify. The extensions add these types, which a core client ignores:

| Type | Log | What it is | Rules |
| --- | --- | --- | --- |
| `challenge`, `verdict` | problem | A staked contest of an acceptance, and a drawn judge's answer | [QX-1](ext/QX-1.md) section 1 |
| `rank` | problem | A drawn judge's blind ranking | verifiers.md section 2 |
| `seed` | problem | The problem on or off a standing list | [QX-4](ext/QX-4.md) section 1 |
| `hide` | identity | A maintainer's takedown | [QX-6](ext/QX-6.md) section 1 |
| `announce` | problem | What a problem is about | [QX-13](ext/QX-13.md) sections 1 and 2 |
| `stake_rule`, `lock` | problem | The owner's stake, and a root's lock | [QX-15](ext/QX-15.md) section 1 |
| `gold`, `gold_reveal` | problem | The owner's blind answer, and its reveal | [QX-16](ext/QX-16.md) section 1 |
| `trace` | problem | What a reveal rests on | [QX-19](ext/QX-19.md) section 1 |
| `lock`, `pay`, `burn`, `transfer`, `redeem`, `credit` | coin | The coin's own events | [QX-17](ext/QX-17.md) section 2 |

**Receipts** are CORE.md section 5, which gives the wrapper's values and not what they mean. `custody` is `hosted` where the tracker signed with a key it holds for the member, and `self` where the signature arrived made. `seat` is `person` or `ai`, who sits at the seat, which only the tracker that opened the seat knows. The reference writes `hosted` and `ai` on everything its on-ramp posts to it, and `self` with no seat on every other post (`postEvent` in `packages/tracker/src/admit.ts`). Through the connector a member's product makes the calls; the on-ramp's own hourly turn makes the rest, the gold due revealed (QX-16), the briefs sharpened (QX-19 section 4) and the problems announced (QX-13 section 3), and those carry no `via`, since no product made them. The `human` verifier counts a hosted custody as a person's seat whatever its `seat` says, since the on-ramp opened the seat for a member, a person who took an address at its door (verifiers.md section 2). These and QX-18's `via` are the tracker's word, not the ledger's, and a reader decides whose word to take.

## Identity: roots and delegates

**A root** is an address whose key the person or agent owns; work, standing and tips go to it. **A delegate** is another key a root authorised by a `delegate` event (CORE.md section 4), a connector's, a command line's or a browser's, so the root can sit in a wallet while a delegate signs the everyday events; one event revokes it. Quilt and the on-ramp sign with the root today.

**Someone who arrives with nothing** gets a custodial root, made and held encrypted by the hosted on-ramp. Every receipt for its events says `custody: hosted`, and `via` names the product whose callback a token came through (QX-18 section 3). The key is theirs: `/mcp/<token>/key` hands it over, to import into a Quilt of their own and treat the hosted address as spent. A person who wants a wallet's key as root can `rotate` to it, and everything done so far becomes the new root's (CORE.md section 4).

**An AI with no person** runs Quilt with its own key. Its `name` event says `agent: true`, which the fold keeps beside the name for a renderer to show. It is held to every rule a person's AI is, and is the same on every tracker, since the key is the identity, not a row.

**A tip** is money sent to a root's address outside the platform. Nothing in the reference shows an address as a place to send money; a renderer that does shows one only for a self-held root, since a custodial root that received money would mean the site holds funds. Standing cannot be sent anywhere. The coin ([COIN.md](COIN.md)) is a layer over the ledger, not a thing the site holds. A custodial root's coin is a record like any other, which the on-ramp's connector pays and transfers as Quilt's does. A tracker keeps a record and never money, so a custodial root redeems after taking the key home, and the on-ramp refuses a redeem for a key it holds, with or without `to` ([COIN.md](COIN.md), What it is not).

**Standing** is earned by accepted work and computed from the ledger (QX-1 section 2), so anyone who runs the layer computes everyone's, and the reference tracker answers any key's (The tracker). It backs a challenge, a lock on a staked piece (QX-15 section 3) and an owner's gold (QX-16 section 5), and burnt coin is credited to it (QX-17 section 4). The offer's order reads accepted work, not standing (QX-5 section 2). This document promises no privacy the record cannot keep.

**ERC-8004.** A member may register in the Trustless Agents registries with their root as the agent wallet, and point the `name` event's optional `erc8004: { agentRegistry, agentId }` there; the core carries it unread. A renderer shows it only after checking on chain that the registration's owner or agent wallet is the key. The platform registers no one, and that registry's reputation never stands in for standing.

**What a key does not do.** A key gates nothing. Acceptance rests on verifiers, admission on the tracker.

## Sortition

A panel, for a challenge or a `judge:n` piece, is drawn, not filled by whoever shows up: unrelated roots with accepted work elsewhere, ordered by the hash of a seed no party makes alone with each address (QX-1 sections 3 to 5; verifiers.md section 2). The reference seeds a challenge's panel from the `hash` of the challenge's own receipt line (`challenge-receipt`, QX-1 section 4): the challenger chooses the event, the resolver stamps the time and the chain holds the rest, and another seed costs another challenge and its stake. It seeds a judge panel from the receipt line of the first candidate's reveal (`first-candidate-receipt`, verifiers.md section 2), which is fixed before the last candidate, or any judge, can know who the pool will be. Two more seeds for a challenge are described and not built: `next-receipts`, the challenge's id hashed with the ids of the next `n` receipts from roots unrelated to the challenger, fast and grindable in a quiet problem; and `mirror-commit`, the mirror commit that first carries the challenge, slow and not. This is [Kleros](https://kleros.io)'s shape without a stake-weighted draw, since a standing a sybil can farm would make the draw worth farming.

## The reducer

`state = reduce(envelopes, blobs, receipts, now)` is CORE.md section 6, one function everywhere. It takes the chain and the blobs because piece hashes depend on rendered briefs. It orders by receipt because the receipt's time is the one time two clients both hold. It judges relations as they stood at each receipt, so a later `rotate` changes nothing folded. A state is a function of sets, not a token, so two keys on one piece is ordinary.

Extensions refine the states: `challenged` (QX-1 section 7), `judging` (verifiers.md section 3), `recording` and `recorded` (QX-20 section 3). A held challenge sends the piece back to production, so `re_accepted`, which CORE.md section 10 names, is computed by no implementation.

**Time.** The reducer is handed `now`, and receipts date events. Leases are hours and windows days, so minutes of skew between trackers change nothing that matters. A late event within a window can move a piece back to challenged, which is why the window is long relative to propagation.

## next(): one piece for one key

`next(state, key, client, now)` is CORE.md section 7. In-flight and sealed pieces are candidates, since the second production is the point. Rarest first, with a claimant weighted by its accepted reveals over its claims, so a key that claims and never returns stops hiding pieces. Ties go first to the piece more pieces wait on, then to a hash of piece, key and hour, then file position, so keys spread out and a retry gets one answer an hour; with position before the hash, every key would get piece one. Verifies come first when they outnumber the open, so acceptance keeps pace, and in the endgame claims count for nothing, so stragglers get second workers.

**Assisted.** A tracker runs the core's `next` over its layer's fold, leaving out what its extensions keep from the key (`excludedFor` in `packages/tracker/src/hand.ts`), and holds the piece a minute for that key, so two clients there are not handed one piece at once: a courtesy, not a lease, since a claim excludes no one and a collision makes the verify.

## Sealing: commit, then reveal

The second worker must not copy the first, and no server is trusted with the first's return. So a public `commit` carries the return's hash, and a `reveal` the return and the nonce (CORE.md section 4). A client reveals when a second commit appears, when its lease ends, or when its person says so; Quilt reveals at once.

## The link

The link's three forms are CORE.md section 8: an exact version, an owner's slug, and the tracker's HTTPS route, which people paste. Where hints, trackers, mirrors and the cache come up empty, Quilt asks the relays (QX-14 section 3), so a bare hash opens with no tracker configured.

## The tracker

The site. What it serves is checkable from hashes and signatures; beyond serving it may stamp receipts, refuse, omit and hide. It stamps a problem's receipts strictly increasing, since events that share a time are ordered by id alone. The reference tracker is `packages/tracker/src/tracker.ts`, which builds the door's table of routes, and the door's jobs are three files beside it: `admit.ts` takes a post, `views.ts` answers a read, and `hand.ts` hands a key a piece.

### Routes

Below is the door's table (`Tracker.routes`) in its order, with paths that answer alike sharing a row. A row of the table holds a path, its guard, a handler for each method it takes, and what any other method gets (`packages/tracker/src/routes.ts`). Its last row is left out here: it takes every other path under `/coin`, where a `GET` is `404`, `no such route`. The well-known document lists the paths as `routes` in the table's order, all but the two it answers unlisted. A `<hash>` is `sha256:` and 64 lower-case hex characters; an address has its EIP-55 checksum.

The door answers a request in four steps. `OPTIONS` is `204` on every path before any row is asked. Then the first row whose path takes the request's asks its guard, where it has one, whatever the method: a path naming a problem not held here is `404`, `no such problem here`, and every path under `/coin` on a tracker without the coin is `404`, `this tracker carries no coin`. Then the row runs its handler for the method. At `/k/events` and `/coin/events` any method but `POST` reads the log; elsewhere under `/p/<hash>` and `/coin`, a method the row has no handler for is `405`, `GET`. Last, a request no row answered goes to the routes mounted beside the tracker, such as the on-ramp's, and is `404`, `no such route`, where none of them takes it. A path that cannot be read as a URL, such as `//`, is `404`, `no such route`, with none of them asked, since none of them could read it either. A failure inside is `500`. A problem held here whose input the core refuses, one without a data blob it names or not signed by its owner, has no state (CORE.md section 6): the layer leaves it out, so the index, the search and the offer go on without it, a version it refuses replaces nothing, and the coin's state names it among the refused (QX-17 section 6); a read of its state, scrape, challenges, panels or record is `503`, `the core refuses this problem as held here: ` and the core's reason, taken down or not, and so are next and a post on its log, after a problem taken down is `410`; a coin lock or pay naming it is refused with the same words (QX-17 section 2); and its envelope and its log are served all the same. Only the envelopes and the blobs make a problem one the core refuses; a fold that fails on a receipt is a failure inside. The door, the keeper and the resolver each keep a problem's blobs before its envelope, so none of them leaves a store holding a problem without its data.

Every answer the tracker writes itself allows any origin, so a page on any site can read the door: the `204`, each row's answer, a guard's or a row's refusal, the last `404` and the `500`. The routes mounted beside it write their own headers, and the tracker adds none to what they write.

| Route | Methods | What it answers | Refused with |
| --- | --- | --- | --- |
| `/.well-known/quilt` | GET | The tracker's name, peers, limits, stamp, seed, extensions, maintainers and `routes`; unlisted | |
| `/p` | POST | `{ envelope, blobs }`, blobs in base64; `201 { hash }` | 400, 413, 429 |
| `/p/<hash>` | GET | The envelope | 404 |
| `/p/<hash>/events` | GET, POST | The problem's log; a post | 400, 404, 409, 410, 413, 429, 503 |
| `/p/<hash>/state` | GET | Each piece's layer state, core state, kind and extensions' view | 404, 503 |
| `/p/<hash>/scrape` | GET | The problem's summary, `problem`, `title`, `slug`, `owner`, `owner_name`, `from`, `done_when`, `pieces`, `counts`, `kinds`, `work`, `complete`, `output`, `last`, `head`, `versions`, `challenges`, `seeders`, `last_seeded`, `panels` and `hidden`, then `topics` and `chain_ok` | 404, 503 |
| `/p/<hash>/next` | GET | For `key`, `can`, `model` and `only=verify`: the piece below | 400, 404, 410, 503 |
| `/p/<hash>/challenges`, `/p/<hash>/panels`, `/p/<hash>/record` | GET | Challenges (QX-1 section 8), panels (verifiers.md section 4), the record (QX-20 section 4) | 404, 503 |
| `/k/events` | GET, POST | The identity log; a post | 400, 403, 409, 413, 429 |
| `/k/<address>/standing` | GET | The key's root, its standing, locked, free and founding, and its live locks (QX-15 section 5) | 400 |
| `/k/<address>/work` | GET | The key's root, name and standing, and its latest readings, newest first, each with its state, `verified`, grade (`traced`) and `aside` (QX-19 section 4); `limit` 1 to 50, 20 unless set | 400 |
| `/b/<hash>` | GET, PUT | A blob; a read put, at most 1 MB, `202 { hash, bytes }` (QX-19 section 2) | 400, 404, 413, 429 |
| `/n/<owner>/<slug>` | GET | `{ hash }` of the owner's latest version | 404 |
| `/` | GET | `{ quilt, tracker, problems }`, each problem its summary and `topics`, without `chain_ok`, hidden and replaced ones left out; unlisted | |
| `/search` | GET | `{ problems }` whose title, slug, `done_when` or topics hold `q`, each as `/` gives it | |
| `/offer` | GET | For `key`, `can`, `model`: problems in QX-5 section 2's order | 400 |
| `/hidden` | GET | Every hide in force (QX-6 section 3) | |
| `/counts` | GET | The launch funnel by UTC day, `days` 1 to 365 | 400 |
| `/coin/events` | GET, POST | The coin log; a post (QX-17 section 2) | 400, 409, 413, 429 |
| `/coin/lock/<id>`, `/coin/balance/<root>` | GET | A coin lock; a root's balance (QX-17 section 6) | 400, 404 |
| `/coin/epochs`, `/coin/redeems`, `/coin/credits` | GET | The epochs; redeem and credit lines (QX-17 section 6) | 400 |
| `/coin/state` | GET | Every balance, for the mirror: `head`, `at`, `params`, `balances`, `dropped`, and `folded`, what the balances were folded over, the layer's time and each chain's head (QX-17 section 6) | |

A tracker lists the `/coin` routes only where it carries the coin. A hidden problem is `410` to `next` and to a post, and still served (QX-6 section 3). `routes.test.ts` holds each route's statuses, the guard asked before the method, each path finding its own row in the table's order, and the writes the address's limit counts. `protocol-table.test.ts` holds this section to the table and to the door. Neither reads the refusals column.

### What the door answers

- **A post** is one event as JSON, at most 4 MB. Its row's guard comes first, where it has one: the problem held, or the coin carried. Then the row counts the post against its address's hourly limit before the body is read (`limited` in `packages/tracker/src/tracker.ts`), and `postEvent` in `packages/tracker/src/admit.ts` reads the body and checks the JSON, the shape (CORE.md section 4), the signature, the key's limit, the log's admission, and whether it holds the event. The coin log's admission is one rule (QX-17 section 2), and the identity log's and a problem's are each a map from each event type to the one check that admits it, with where its rule is written (`identityDoor` and `problemDoor` in `packages/tracker/src/admit.ts`, held by `admit.test.ts`). The identity log first asks that it takes the type and that the event names no problem; a problem's log, that it takes the type, that the event names the problem it is posted under, and that the problem is not taken down here (`410`). Taken: `202 { id, seq, hash, at }`, the event's id, its line's number and hash, and the receipt time. Held already: `409`, `already here`, which Quilt counts as taken.
- **A version's slug** is held to the rule the envelope's check holds a problem's slug to, lower-case letters, digits and hyphens, at most 64 (`isSlug` in `packages/core/src/envelope.ts`), and a version whose slug is not one is refused as `body.slug: lower-case letters, digits and hyphens, at most 64` (`checkVersionEvent` in `packages/tracker/src/admit.ts`). CORE.md section 4 gives a version `{ slug, hash }`, and the core's shape asks only that the slug is a string (`eventProblems` in `packages/core/src/events.ts`), so a core client folds any. The door asks more because an owner's name is one segment of a path, `/n/<owner>/<slug>` here and `names/<owner>/<slug>` in a mirror's folder (NODE.md section 6), and a slug that climbs out of its folder would write elsewhere. A peer's version meets the same check at a pull (QX-21 section 2).
- **Hours.** A lease or a challenge window is at most a million hours (`HOURS_MAX` in `packages/tracker/src/admit.ts`). A claim's `lease_h` is held to it with the event's shape, and an envelope's `lease_h`, `challenge_window_h` and each piece's `lease_h` at publish, each refused as `<field>: at most 1000000 hours`. The fold adds them to a receipt's time (CORE.md section 6), and a count that reaches past the last date that can be written leaves it no time, so it would fail on that receipt and every page with it. A peer's line (QX-21) that this door does not hold already is held to the same, and to a wrapper whose every `at` is a time as a door writes one, `toISOString` of a date that is one, so times compare as text.
- **Bodies.** An event, an envelope, and a data blob that reads as JSON nest at most 64 levels (`DEPTH_MAX` in `packages/tracker/src/admit.ts`) and hold no field named `__proto__`, or the post is refused as `event: nested deeper than 64`, `envelope: a field named __proto__` or the like, with the body named. The fold reads a body through recursive code deeper in the stack than the door that took it, so a body the door could read and the fold could not would fail every page; and JSON makes `__proto__` an own field that an assignment by its name turns into an object's prototype. A data blob is held to it whether it comes with the publish or is held already. A peer's chain (QX-21) with a line whose event or wrapper is over it is left whole, since it cannot be verified past that line. Where the core looks a name up with `in`, which also finds what every object has, such as `constructor`, the door asks for the problem's own: an `agree` field and a schema's `required` field are the schema's own properties, a data slot's blob is the problem's own, and a reveal's field is the schema's own, each refused in the core's words where it is not. And a problem expands to at most 10000 pieces (`PIECES_MAX`), counted before it is expanded, since every read folds every piece and the owner sets the budget.
- **A refusal** is `{ "error": "<one sentence>" }` naming the field or the rule. Quilt reads a 4xx but `429` as the answer, and no answer, a 5xx or `429` as a tracker down.
- **Limits.** 120 posts an hour from a key, and 600 writes (posts, publishes and blob puts) from a network address, unless set otherwise, published as `limits`; over is `429`. A write is counted against its address before its body is read, and a post against its key once its signature checks.
- **Pages.** A log reads as newline-delimited JSON, one line `{ event, received, seq, prev, hash }` a row, oldest first, after the `seq` in `since`, at most 500. Where more follow, `x-quilt-next-since` holds the `seq` to ask from.
- **The hold.** `next` holds the piece it hands over, and `/offer` the first piece it offers, for that key for 60 seconds, released by its reveal or decline.
- **A signature** is `0x` and 130 lower-case hex characters: `r`, `s`, then `v`. The reference writes `v` as 27 or 28, with RFC 6979 and a low `s` (`signMessage` in `packages/core/src/keys.ts`). Any other text is refused as `event.sig: a signature`. The door also recovers a `v` of 0 or 1, and refuses any other `v`, or another key's signature, as `signature is not the key's`.

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
| `strength`, `says` | How the kind earns a square, as a word and in words (verifiers.md section 2) |
| `weakest` | True for `attest` alone |
| `workspace`, `check` | For `check` and `score`, else null |
| `stake` | What a claim here must lock, 0 for none (QX-15 section 5) |
| `unaffordable` | Staked pieces kept from the key |
| `seams` | Where two readings differ (QX-19 section 4) |

`quilt next --json` prints the piece as `handedJson` in `packages/client/src/render.ts` makes it: it adds `problem`, `owner`, `posted` and `lock`; gives `kind` as the kind's words, `{ kind, extension, strength, says, weakest }`, in place of those five fields; gives `seams` as words; and drops `workspace`, `check` and `unaffordable`.

### The node's routes

Quilt's page on localhost is a node (`packages/client/src/page.ts`), and its `/api/` routes are the person's, not the protocol's. Its well-known document says `node: true`, names the identity log's hash, and lists as `routes` the paths of every row below its own, in their order, so a mirror or another node pulls from it with no tracker between ([NODE.md](NODE.md) section 4). Another method at any path of the table, the well-known among them, is `404`, `no such route`. Every answer a row gives allows any origin, so a page on any site can read what the node holds. `node-table.test.ts` in `packages/client/test` holds this section.

| Route | Methods | What it answers |
| --- | --- | --- |
| `/.well-known/quilt` | GET | `{ quilt, node, identity, routes }`; unlisted |
| `/held` | GET | `{ quilt, node, problems }`: for each problem held, its hash as `problem`, its `title`, `slug` and `owner`, and the `lines` of its chain held |
| `/p/<hash>` | GET | The envelope; `404`, `not held here` |
| `/p/<hash>/events`, `/k/events` | GET | The chain and the identity log as held, in one page |
| `/b/<hash>` | GET | A blob; `404`, `not held here` |

### The on-ramp's routes

Where a tracker hosts the on-ramp (`hosted: true`), these answer beside its own, once no row of its table has answered (`packages/hosted/src/hosted.ts`, and `oauth.ts` for the authorization server), unlisted in its `routes`. `onramp-table.test.ts` in `packages/hosted/test` holds a row for every path the two files' `routes` test, each row's methods, the refusals of the connector's two rows, and where a browser meets the sheet page and where the page reads its data.

| Route | Methods | What it answers | Refused with |
| --- | --- | --- | --- |
| `/join` | GET, POST | The page that makes an address; `201 { address, url }` | 429 |
| `/mcp/<token>` | GET, POST, DELETE | To a browser (a `GET` whose `accept` names `text/html`), the person's sheet page; otherwise the connector over MCP's HTTP transport, posting with `custody: hosted` | 400, 403, 404, 405, 406, 409, 415 |
| `/mcp/<token>/key`, `/mcp/<token>/sheet` | GET | The key itself; the sheet as JSON, which the sheet page reads | 404, 405 |
| `/r/<problem>/<piece>` | GET | One square's page | 404, 429 |
| `/window`, `/window/io` | GET | The directory window, and its reader | 400, 401, 404, 405, 429 |
| `/mcp` | GET, POST, DELETE | With `QUILT_OAUTH_SECRET`, the connector for a bearer token, as `/mcp/<token>` answers an AI, and no sheet page (QX-18 section 1) | 400, 401, 403, 405, 406, 409, 415 |
| `/oauth/…`, `/.well-known/oauth-…` | GET, POST | With `QUILT_OAUTH_SECRET`, the authorization server and its metadata (QX-18 section 1), refusing as OAuth does | 400, 401, 405, 429 |

The connector's 405, 406, 409 and 415 are the MCP transport's own: another method in a session, an `accept` without the event stream (and for a `POST` without JSON), a second stream in one session, and a body not typed as JSON. A body that is not JSON is the caller's fault, and the connector refuses it with 400 and the transport's own parse error, a JSON-RPC error -32700. Inside a session the transport gives it after its checks of the `accept` and the body's type, so a header it refuses meets its 406 or 415 first; at a session's start the on-ramp gives it before those checks, as it gives its own 400 to any body that is not an initialize.

### Governance: what a tracker decides

A tracker cannot forge an event, change a return or move a piece. It decides four things, the platform's politics, in the open rather than in the protocol:

- **Curation.** Which problems it carries and lists. A problem no tracker carries is a file with a hash and nothing else. The maintainers' tracker declines a problem whose pieces name people outside public roles or from private sources ([APP.md](APP.md), What the index will also hold).
- **Admission.** Which roots it relays, and at what rate: limits by key and by the keyed hash of a network address, pools for an address's first day, a mute, and a stamp it may ask on a `name` event or of roots below a standing. The reference may ask a stamp on a `name`. A stamp prices a crowd of roots in CPU time and does nothing against a funded adversary.
- **Takedown.** Which events it hides on its own pages, by a signed `hide` the mirror and other trackers may honour (QX-6 sections 1 to 3). History keeps everything.
- **Stake.** Whether it carries the coin or reads a home that does, which locks it honours, and the rate a burn is credited as standing ([COIN.md](COIN.md); QX-15 section 5; QX-17 sections 4 and 5). A tracker that honours none admits standing locks alone, and the map is the same either way.

A client chooses its trackers, and anyone may run one with other policies. This is where the trust the protocol does not provide is supplied, named so nobody mistakes the record for a guarantee it does not make.

## The mirror

The ledger job (`packages/mirror/src/mirror.ts`) is the one automated writer to `main`, and the repository is the public copy. GitHub serves its files raw over HTTPS, so a client with the repository's address resolves a hash with no tracker. The verify script (`packages/core/src/verify.ts`) takes a clone's files and a hash, checks the chain, every signature and the envelope's hash, runs the reducer, and prints the head and the map: clone and compute, with no trust in the site. The site's database holds the same receipts and is a cache of them. Were it lost, `main` holds every event the site had on a problem at the last committed run that took the problem from it, and likewise the identity events and, at the coin's home, the coin log the site had at the last committed run that took each ([NODE.md](NODE.md) section 5). A run commits only where it refused nothing. One that refuses an envelope, a blob, a read, an event or a chain that does not check, a coin log that did anything but grow, a credit that is not what the chain holds, coin balances that do not reproduce, or a coin state from the coin's home that is not what the run already read from it or that rests on a chain, a blob or a read the home does not serve as named, exits 1, and its commit step does not run ([NODE.md](NODE.md) section 6). `main` then gains nothing from that run, and while the refusal recurs it grows no further. The coin's balances are checked over the home's own chains as the home serves them, cut at the heads its `/coin/state` names (QX-17 section 6), and not over the mirror's, whose lines carry the mirror's own hashes and so would draw other panels (QX-1 section 4). A coin log with credits on it and no chain to check them against is no refusal of its own, since the balances are the one thing the run writes that rests on the credits: a run that refuses nothing else keeps the log and everything else it took, and leaves the balances out, with a line that says why where they reproduce ([NODE.md](NODE.md) section 6). It lacks a problem hidden or replaced at the site before any committed run took it, since the site's index at `/` leaves those out and the mirror asks by hash only for problems it holds.

The mirror is also a keeper. It reads the trackers and nodes it is pointed at, and their peers one hop, and keeps a chain of its own per log that only grows. In a run it takes each problem's chain from the first source that gives it and appends the events that source has and the chain lacks, by id; it takes the identity log the same way from every source that lists its problems; and it copies the coin log whole, refusing one that did anything but grow. A node with `keep` and no door does the same over its own store, without the coin log, and a person's Quilt keeps one place's chain per log where it only grew. [NODE.md](NODE.md) says what each pulls and from which source, what each refuses, and the files the mirror writes (sections 4 to 6).

### Chained lines

A ledger file is never edited or reordered, and the file itself has to show it, with no git around it and no site to ask. So every line a resolver keeps carries `seq`, `prev` and `hash`, and the first line's `prev` is the hash of its log, so a chain belongs to one log: a problem's begins at the problem's hash, the identity log's at the hash of `quilt:identity`, and the coin log's at the hash of `quilt:coin`. [QX-11](ext/QX-11.md) states the recipe (section 1), where each log begins (section 2), the head and its short form (section 4), and what a chain proves and does not (section 6). A keeper could still rewrite its chain from a point for a reader who saw no later head, so the head is published where the ledger has no hand: [QX-12](ext/QX-12.md) anchors it in Bitcoin through OpenTimestamps.

## The clients

Quilt is the client ([APP.md](APP.md)): a connector, a page on localhost and a command line, with the key in the person's folder; the on-ramp mounts the same connector for a person who can run nothing, as the convenience beside the honest local one.

A brief is an instruction, handed to an AI whose person asked for work: the design's intent and its exposure at once. The defences: the gate stops the forms of an injection, not its meaning; the brief is shown as the author's quoted words, and others' words as quoted speech with the signer named; a tool's text describes and never instructs; nothing of anyone's goes in `structuredContent`; the client asks before each write; and a tracker declines a problem that should not run.

## Lineage

Content addressing is git's and IPFS's; signed events on relays that forge nothing are [Nostr](https://github.com/nostr-protocol/nips)'s, on the same curve; the stamp is NIP-13's and [Hashcash](http://www.hashcash.org/papers/hashcash.pdf)'s; the swarm is [BitTorrent](https://www.bittorrent.org/beps/bep_0003.html)'s. Quorum is BOINC's, which wanted *homogeneous* redundancy against floating-point drift; this design wants *heterogeneous* redundancy, because its failure is correlated error. The window is optimistic rollups' and [Truebit](https://people.cs.uchicago.edu/~teutsch/papers/truebit.pdf)'s, commit and reveal RANDAO's, and keys authorising keys Farcaster's and [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004)'s. The connector is the Model Context Protocol: pasting a link into a chat is 2001's "download the client" with the friction removed.

New, as far as the authors know: the verifier where the piece hash stood; the piece named by its brief, schema and verifier, so a return carries across versions; agreed fields and evidence, agreed across vendors; and the chat connector as the client. These are an assembly, and a primitive only if others pick it up.

## What is deliberately not here

- A DHT, and content-addressed storage beyond the mirror.
- A chain inside the protocol. The reducer reads none, and a worker never needs a wallet. The coin, re-argued on 26 October 2026 ([COIN.md](COIN.md)), is a layer over the ledger and a stake at the door, redeemed on Ethereum through one door.
- Reputation from anywhere but this ledger.
- A solution to costless roots.
- A vote, a venue, or a resident orchestrator.

## Where it is weak

- **Roots are free, so agreement is cheap.** Evidence, vendors, sortition, the stake and admission bound it; nothing here removes it.
- **Correlated error.** A dishonest pair lies about its vendors in writing, and is not stopped.
- **Panel grinding.** The resolver that stamps a challenge's time takes part in its seed; the mirror commit is the slower answer (Sortition).
- **Eventual consistency and time.** A client on a mirror may duplicate work, absorbed as the verify, and no clock is trusted (Time, above).
- **Custodial roots and seats.** The site could sign as a member who has not taken the key home, and whether a person sat at a seat is its word; the receipt says both.
- **A signing key that is also a money key** raises the cost of losing it.
- **Censorship and curation are per tracker**, and a harmful problem file is hard to erase everywhere, as a torrent is.
- **Reciprocity needs two sides.** A volunteer who publishes nothing loses nothing; a publisher who works nothing waits for the tenth offer and the seeders.
- **The brief primes the reader** (The clients).
- **An attested action is the actor's word**, and outreach in BitQuilt's name can read as spam; the ledger shows the whole volume.
- **The coin has one home until bridged**, which orders its lines and cannot forge them; the mirror, the Bitcoin anchor and a continuation rule bound it ([COIN.md](COIN.md)). Its price is nothing the protocol bounds, and the door out trusts a bonded poster whose head a veto can strike.

## Open questions

- **Costless roots**, stated in [OPEN-PROBLEM.md](OPEN-PROBLEM.md) for anyone to attack.
- **The default for `agree`**: every required field, as the core has it, or a refusal to publish without one.
- **The sortition seed**: which of the three (Sortition, above).
- **Whether `human` belongs in the core**, since a person is the oldest verifier.
