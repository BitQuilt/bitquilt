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

Numbers assigned 24 Oct 2026, and QX-15 to QX-17 on 26 Oct 2026. Each is described in [PROTOCOL.md](PROTOCOL.md) for now and gets its own document under `docs/ext/` when it is first implemented; the three verifier kinds (QX-2, QX-3, QX-10) share one, since they share one layer, one pool and one door. The exact event shapes and the states a client shows are in those documents, not here.

| Number | Title | Status | Where |
| --- | --- | --- | --- |
| QX-1 | The challenge window: `challenge` and `verdict`, standing, panels by sortition | Draft, one implementation (25 Oct 2026) | [ext/QX-1.md](ext/QX-1.md); PROTOCOL.md, Sortition and The reducer |
| QX-2 | The `judge:n` verifier: `candidates` returns, a panel of `n` by QX-1's sortition seeded by the first candidate's receipt line, blind `rank` events, a majority's first choice accepted | Draft, one implementation (25 Oct 2026) | [ext/verifiers.md](ext/verifiers.md); PROTOCOL.md, Verifiers and Sortition |
| QX-3 | The `human` verifier: as `agree`, every counted reveal from a person's seat (`seat: person` or `custody: hosted` on the receipt, or `by.model` `human`) | Draft, one implementation (25 Oct 2026) | [ext/verifiers.md](ext/verifiers.md); PROTOCOL.md, Verifiers and Events |
| QX-4 | Seeding, watch pieces and the standing list | Draft, one implementation (26 Oct 2026) | [ext/QX-4.md](ext/QX-4.md); PROTOCOL.md, Events and SWARM.md |
| QX-5 | Reciprocity in the order problems are offered | Draft, one implementation (26 Oct 2026) | [ext/QX-5.md](ext/QX-5.md); PROTOCOL.md, In BitTorrent's terms; SWARM.md |
| QX-6 | The `hide` event and a maintainer's key | Draft, one implementation (27 Oct 2026) | [ext/QX-6.md](ext/QX-6.md); PROTOCOL.md, Events and Governance |
| QX-7 | The stamp: proof of work at a tracker's door | Draft | CORE.md section 11; PROTOCOL.md, Governance |
| QX-8 | Independence from the agreement graph | Reserved | [OPEN-PROBLEM.md](OPEN-PROBLEM.md), direction 1 |
| QX-9 | Evidence a machine can check | Reserved | OPEN-PROBLEM.md, direction 3 |
| QX-10 | The `attest` verifier: a piece whose work is an action, accepted at once on the actor's signed record as `accepted_provisional` marked attested, challengeable under QX-1 for the window, crediting no standing; the weakest kind | Draft, one implementation (25 Oct 2026) | [ext/verifiers.md](ext/verifiers.md); PROTOCOL.md, Verifiers |
| QX-11 | Chained ledger lines: `seq`, `prev` and `hash` on every receipt a resolver keeps, with a published head | Draft | PROTOCOL.md, The mirror |
| QX-12 | Anchoring a chain's head outside the ledger, through OpenTimestamps | Draft, one implementation (26 Oct 2026) | [ext/QX-12.md](ext/QX-12.md); PROTOCOL.md, The mirror |
| QX-13 | The `announce` event: what indexes and relays store, signed by an owner or a seeder | Draft | [APP.md](APP.md), The announce event |
| QX-14 | Discovery: announcements on Nostr relays first, a keyword DHT among long-lived nodes later | Draft, relays implemented (26 Oct 2026) | [ext/QX-14.md](ext/QX-14.md); APP.md, Search |
| QX-15 | Stake at the door: `stake_rule` on a problem, a `lock` of standing or of coin before a claim, released when the acceptance stands and forfeited when its set is struck | Draft, one implementation with standing (26 Oct 2026) | [ext/QX-15.md](ext/QX-15.md); [COIN.md](COIN.md) |
| QX-16 | Gold pieces: an owner's `gold` commitments before the work, `gold_reveal` after acceptance, a miss striking the set and a match marking the square verified | Reserved, planned (26 Oct 2026) | COIN.md; COIN-PLAN.md, section 4 |
| QX-17 | The coin as a layer: a coin log, emission to verified squares, vesting, forfeit, payments, locks, burn, transfer and redeem, every balance a function of the receipts | Reserved, planned (26 Oct 2026) | COIN.md; COIN-PLAN.md, section 5 |
