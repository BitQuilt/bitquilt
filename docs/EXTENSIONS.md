# Extensions

[CORE.md](CORE.md) is frozen. Everything else about BitQuilt moves through extensions: numbered documents (`QX-n`), each small, each adding something a core client may ignore. The core should be finishable; the ecosystem should not. A client that passes the core fixtures is a client; an extension it does not implement changes nothing it computes, only how fine its picture is.

## What an extension may do

- Add event types, with their bodies and validity rules. A core client ignores them.
- Add verifier kinds. A core client treats a piece of that kind as `unknown`: never accepted, never offered, its dependents locked.
- Refine the core's states. An extension may hold a piece that the core calls `accepted_provisional` or `accepted` in a state of its own (`challenged`, `re_accepted`), so long as the core state is a coarsening of it: where the extension says accepted, the core says accepted; where the core says accepted, the extension may say less.
- Add fields to the bodies of its own events, and to a `name` event.
- Define admission policies a tracker may apply at its door, and what its well-known document says about them.
- Define functions of the ledger (standing, independence, reciprocity) and how `next` or a renderer uses them.

## What an extension may not do

- Change the meaning, hash, signature or ordering of anything in the core.
- Add an input to the piece hash or the problem hash.
- Make a core client's state wrong rather than coarse.
- Make money, a token or a transferable credit the only way in for a worker: wherever a stake is asked, standing earned by work satisfies it, and a problem with no stake asked is always open to a new root. (Until 26 Oct 2026 this read "Require money, a token or a transferable credit of a worker"; [COIN.md](COIN.md) says what changed and why.)
- Put another person's words anywhere but quoted text with the signer named.

A change that needs any of these is version 2 of the core, which is a different conversation.

## Process

1. A draft is a pull request adding `docs/ext/QX-<n>.md`, with the next free number, status `Draft`, a one-paragraph abstract, the rules in the core's register, and fixtures for every rule that decides state.
2. Discussion is on the pull request. Rough consensus among those who have implemented a client or run a tracker decides; the maintainers edit, assign numbers and status, and break ties by what is smallest.
3. `Final` when two independent implementations pass its fixtures. A `Final` extension never changes meaning; a change is a new number, and the old one is `Deprecated` with a pointer.
4. An extension nobody implements in a year is `Withdrawn`, and its number is not reused.

## Registry

Numbers assigned 24 Oct 2026, QX-15 to QX-17 on 26 Oct 2026, QX-18 on 1 Nov 2026, QX-19 to QX-21 on 2 Nov 2026, and QX-22 on 10 Nov 2026. Each gets its own document under `docs/ext/` when it is first implemented, and [PROTOCOL.md](PROTOCOL.md) gives the reasons behind them; the three verifier kinds (QX-2, QX-3, QX-10) share one, since they share one layer, one pool and one door, and the stamp (QX-7) is CORE.md section 11. Each number sits in one of the layers [LAYERS.md](LAYERS.md) tells, the window, the door, the chain or the coin, or is open. The exact event shapes and the states a client shows are in those documents, not here. The files that carry out each number are mapped in one table, the map of the code in [AGENTS.md](../AGENTS.md#the-shape-of-it), a row per source file with the documents it carries out. This table and each document's status line point there for them, and a document's text names a file where a passage needs one.

| Number | Layer | Title | Status | Where |
| --- | --- | --- | --- | --- |
| QX-1 | The window | The challenge window: `challenge` and `verdict`, standing, panels by sortition | Draft, one implementation (25 Oct 2026) | [ext/QX-1.md](ext/QX-1.md); PROTOCOL.md, Sortition and The reducer |
| QX-2 | The window | The `judge:n` verifier: `candidates` returns, a panel of `n` by QX-1's sortition seeded by the first candidate's receipt line, blind `rank` events, a majority's first choice accepted | Draft, one implementation (25 Oct 2026) | [ext/verifiers.md](ext/verifiers.md); PROTOCOL.md, Verifiers and Sortition |
| QX-3 | The window | The `human` verifier: as `agree`, every counted reveal from a person's seat (`seat: person` or `custody: hosted` on the receipt, or `by.model` `human`) | Draft, one implementation (25 Oct 2026) | [ext/verifiers.md](ext/verifiers.md); PROTOCOL.md, Verifiers and Events |
| QX-4 | The door | Seeding, watch pieces and the standing list | Draft, one implementation (26 Oct 2026) | [ext/QX-4.md](ext/QX-4.md); PROTOCOL.md, Events and SWARM.md |
| QX-5 | The door | Reciprocity in the order problems are offered | Draft, one implementation (26 Oct 2026) | [ext/QX-5.md](ext/QX-5.md); PROTOCOL.md, In BitTorrent's terms; SWARM.md |
| QX-6 | The door | The `hide` event and a maintainer's key | Draft, one implementation (27 Oct 2026) | [ext/QX-6.md](ext/QX-6.md); PROTOCOL.md, Events and Governance |
| QX-7 | The door | The stamp: proof of work at a tracker's door | Draft, one implementation (24 Oct 2026) | CORE.md section 11; PROTOCOL.md, Governance |
| QX-8 | Open | Independence from the agreement graph | Reserved | [OPEN-PROBLEM.md](OPEN-PROBLEM.md), direction 1 |
| QX-9 | Open | Evidence a machine can check | Reserved | OPEN-PROBLEM.md, direction 3 |
| QX-10 | The window | The `attest` verifier: a piece whose work is an action, accepted at once on the actor's signed record as `accepted_provisional` marked attested, challengeable under QX-1 for the window, crediting no standing; the weakest kind | Draft, one implementation (25 Oct 2026) | [ext/verifiers.md](ext/verifiers.md); PROTOCOL.md, Verifiers |
| QX-11 | The chain | Chained ledger lines: `seq`, `prev` and `hash` on every receipt a resolver keeps, with a published head | Draft, one implementation (24 Oct 2026) | [ext/QX-11.md](ext/QX-11.md); [NODE.md](NODE.md), the stores that keep the chains |
| QX-12 | The chain | Anchoring a chain's head outside the ledger, through OpenTimestamps | Draft, one implementation (26 Oct 2026) | [ext/QX-12.md](ext/QX-12.md); [NODE.md](NODE.md), the mirror job |
| QX-13 | The chain | The `announce` event: what indexes and relays store, signed by an owner or a seeder; since 2 November 2026 it states the owner, the fork, the pieces, the counts and the work | Draft, one implementation (26 Oct 2026; the body grew 2 Nov 2026) | [ext/QX-13.md](ext/QX-13.md); APP.md, The announce event |
| QX-14 | The chain | Discovery: announcements on Nostr relays first, a keyword DHT among long-lived nodes later | Draft, relays implemented (26 Oct 2026) | [ext/QX-14.md](ext/QX-14.md); APP.md, Search |
| QX-15 | The coin | Stake at the door: `stake_rule` on a problem, a `lock` of standing or of coin before a claim, released when the acceptance stands and forfeited when its set is struck | Draft, one implementation with standing (26 Oct 2026) | [ext/QX-15.md](ext/QX-15.md); [COIN.md](COIN.md) |
| QX-16 | The coin | Gold pieces: an owner's blind `gold` commitments before the work, each binding a piece and its answer so the ledger counts them and names no piece, backed by a stake of standing, `gold_reveal` after acceptance naming the piece, a match marking the square verified, a miss striking the set, and a struck root's challenge that can undo it | Draft, one implementation (26 Oct 2026) | [ext/QX-16.md](ext/QX-16.md); [COIN.md](COIN.md) |
| QX-17 | The coin | The coin as a layer: a coin log, emission to verified squares, vesting, forfeit, payments, locks, burn, every balance a function of the receipts; transfer and redeem on from the home's genesis (decided 27 Oct 2026), and a `credit` from the bridge's reader for a deposit burned on the chain | Draft, one implementation (26 Oct 2026); the door out and the way back built 27 Oct 2026 | [ext/QX-17.md](ext/QX-17.md); [COIN.md](COIN.md); the head on the chain, [ext/QX-11.md](ext/QX-11.md) section 7 |
| QX-18 | The door | The product as witness: the hosted on-ramp as the OAuth authorization server for its addresses (registration, the code with PKCE, tokens), and `via` beside `custody: hosted` on every event it posts through a token, naming the product whose callback the code was sent to (`claude.ai`, `chatgpt.com`) or `other` with the client's own name; recorded and shown, read by no rule yet | Draft, one implementation (1 Nov 2026) | [ext/QX-18.md](ext/QX-18.md); [OPEN-PROBLEM.md](OPEN-PROBLEM.md), the note of 1 November 2026 |
| QX-19 | The window | The trace: a `trace` event beside a reveal naming the reads it made, kept as blobs under their hashes, and the span of each that every field rests on; the square graded by whether both of its reveals rest on kept reads; the seams of a disputed piece, why its two readings differ, handed on with the piece; a reading that rests on nothing set aside for one that rests on the record; the owner's node sharpening a brief two grounded readings read apart, as a version | Draft, one implementation (2 Nov 2026) | [ext/QX-19.md](ext/QX-19.md); [WORKSHOP.md](WORKSHOP.md) |
| QX-20 | The window | The `record:n` verifier: for a question with no empirical answer, the first `n` readings from roots unrelated to the owner and to each other stand as given; nothing is accepted, struck, credited or paid; each reading graded by whether it rests on a kept read (QX-19), the seams between the readings shown as the content, the record fixed once the readings are in, and a record document with each reading and its trace as the chain states it | Draft, one implementation (2 Nov 2026) | [ext/QX-20.md](ext/QX-20.md) |
| QX-21 | The chain | Doors fold each other's chains: a tracker pulls its peers' identity log and their chain for every problem it holds, every five minutes, and admits each event it lacks through its own door with the peer's wrappers kept and its own added; a chain that does not verify is left whole; what its layer refuses is said and not folded; the coin log is not pulled | Draft, one implementation (2 Nov 2026) | [ext/QX-21.md](ext/QX-21.md) |
| QX-22 | The window | Proposed pieces: a `propose` event that puts one piece, under a name, beside a problem with its proposer's reason; every proposal stands on the record side by side, none accepted or struck, and earns nothing; the owner takes some into a version, the owner's node by default where the proposer has work standing on the problem and the budget has room, and each proposal says which version took it and which forks hold it | Draft, one implementation (10 Nov 2026) | [ext/QX-22.md](ext/QX-22.md) |
