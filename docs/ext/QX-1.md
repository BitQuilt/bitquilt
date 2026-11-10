# QX-1: the challenge window

Status: Draft. First implemented 25 October 2026 in the reference tracker and the Quilt client; [AGENTS.md](../../AGENTS.md#the-shape-of-it) names the files that carry it out. [EXTENSIONS.md](../EXTENSIONS.md) says what an extension may do; [PROTOCOL.md](../PROTOCOL.md) (Events, Sortition, The reducer) says why this one is shaped as it is. This document says exactly what is built. A core client ignores all of it and computes the same map it did before.

**Abstract.** The core accepts a piece provisionally the moment two productions agree and finally when the window closes, and nothing in the core can contest it in between. This extension lets a root with standing challenge a provisional acceptance inside its window, on a one-sentence ground and for a stake of standing it can lose. A panel of three is drawn by sortition from roots with an accepted return on another problem, seeded by the challenge's own receipt line, which no party makes alone. Two verdicts decide. A challenge that holds strikes the accepting set from the fold and sends the piece back for production; one that fails costs the challenger the stake and leaves the acceptance as it was.

## 1. Events

Two event types, both about one piece: they name `problem` and `piece` as a `reveal` does, and go to the problem's log.

| Type | Body | Valid when |
| --- | --- | --- |
| `challenge` | `{ stake, ground }` | `stake` is a whole number of at least 1 and at most the signer's root's standing at the event's receipt; amended 27 October 2026 for [QX-16](QX-16.md) section 4, it is 0 or more where the challenge is against a gold miss, and at least 1 against an acceptance. `ground` is text of at most 200 characters through the plain-text gate. At the receipt, the piece has an accepting set, completed at or before the receipt, whose window has not closed; no earlier challenge on the piece is open or has held; and the signer's root is unrelated to every party: the roots of the accepting set and the problem's owner. |
| `verdict` | `{ challenge, for, return? }` | `challenge` is the id of a challenge on the same piece that is still open. `for` is `challenger` or `author`. The signer's root holds a live seat on that challenge's panel at the receipt and has not answered. `return`, if present, fits the piece's schema; a verdict on a `check` or `score` piece carries none. |

A delegate signs either type only with it in `scope`. An event that fails a rule is dropped silently, as the core drops, and the reference tracker refuses it at the door with the reason.

A `challenge` is the challenger's claim that the acceptance is wrong; `ground` is their one sentence saying why, kept and shown as their quoted words. A `verdict`'s optional `return` is the judge's own answer, kept as evidence and shown quoted with the judge named; it does not become the piece's return (section 7).

## 2. Standing

A function of the ledger a reader holds, per root, judged at a time:

- a new root starts at 1;
- plus 1 for every reveal of the root in an accepting set, from the set's completion, on any problem the reader holds: both reveals of an `agree` set, the patch of a `check` or `score` set;
- plus the stake, from the decision, for every challenge by the root that held;
- minus the stake, from the decision, for every challenge by the root that failed;
- minus 1, from the decision, for every accepting set the root was in that a challenge struck, and the set's own point is withdrawn from the same time;
- run in time order, each move counting from its instant, and never below zero.

Standing is what a root may stake, and nothing else: it weights no draw and gates no piece. A root's first challenge costs it the one point every root has; a root that lost it earns another only by work that is accepted.

Amended 26 October 2026 for [QX-15](QX-15.md): where a problem asks a stake of a piece, standing is also what a root locks to claim it, and the standing a challenge may stake is the root's free standing, its standing less what its live locks hold. A lock forfeited with a struck set is a move of minus its amount on the root's standing from the strike, beside the minus one above. Where no lock is live, nothing here changes.

Amended 29 October 2026, at the founder's direction, for the launch. A tracker may declare a **founding standing** for named roots, published at its well-known document as `founding: { <address>: <amount> }`: every reader of that tracker's ledger counts the amount into the root's standing from the ledger's beginning, beside the 1 every root starts with and before every move above. It is the one standing not earned by work, and it exists for one reason: gold ([QX-16](QX-16.md)) is backed by the owner's standing, the coin ([QX-17](QX-17.md)) is minted only against squares that gold verifies, and at a launch no owner has earned anything yet, so without a declaration no gold could be committed and no coin ever minted. The declaration is bounded and public: the public tracker declares 400 for the maintainers' root, `0xd27c21A4a79cfF5bdFD22C31EEDa13560651c0EA`, which is what the gold stakes of the twenty-seven launch patterns come to (316) with room for the next few. A gold's stake is locked until its problem settles, so this standing is spent on nothing but the gold and comes back as the problems close. A tracker that declares none behaves as before, and a root with a founding standing is docked and credited like any other.

Amended 10 November 2026, for a set carried across a version. The core's fold of a version takes the events of the versions before it along `prev` ([CORE.md](../CORE.md) section 6), so an accepting set made on a piece a later version keeps stands in the fold of each, and a reader that holds several versions of a problem finds it once in each. It is one set, and it is counted once:

- **Standing.** A reveal earns its root one point, by the reveal's event: from the earliest completion of a set that holds it, on the problem the reveal was posted to, however many versions the reader holds.
- **The line, and the pool** (section 3). Two problems are of one line where their chains along `prev` share a version: an earlier version of `p`, a later one, and another version made from the same earlier one are each of `p`'s line. A fork is not: it names its source by `from`, and its sets are its own. A problem of `p`'s line is not a problem other than `p`, so a tracker that holds one problem in several versions has no pool.
- **The decision** (section 6). A held challenge at any version strikes the set's events from the fold of every version that holds them. Each root of the set loses one and its point for the set, once, and a lock behind the set ([QX-15](QX-15.md) section 3) is forfeited whichever version it was made at.
- **Once** (sections 1 and 7). The challenges on a piece are those on it at any problem of the line: one is open at a time across the line, and a piece that had its held challenge at one version is not challenged at another. A piece carries one revealed gold across the line too ([QX-16](QX-16.md) section 1), so the owner cannot strike a set again at another version once a challenge has overruled the gold.

Before this amendment the reference tracker read each version as a problem of its own, and counted a carried set once for each version it held. Left open: a piece at one version does not say `challenged` while a challenge on it is open at another, though the door there refuses a second; a miss is challenged at the version that holds the gold; and where the set a version holds shares one reveal with a different set an earlier version holds, a strike of the one takes that reveal out of both folds, so the other root of the earlier set loses its point as though it never had it, not from the strike.

## 3. The pool

For a challenge received at `t` on piece `x` of problem `p`, the pool is every root that:

- has a reveal in an accepting set completed at or before `t` on a problem other than `p` that the reader holds, the set not struck at or before `t`;
- is unrelated, as the core judges relations at `t`, to the challenger's root, to each root of the accepting set, and to the owner of `p`;
- has no reveal and no run on `x` from a related root.

The reference tracker's reader is its own store: every problem it carries. With a single problem on a tracker the pool is empty, and no challenge can be seated there.

## 4. The seed and the draw

- **The seed** is the `hash` of the challenge's chained receipt line (QX-11) on the resolver that first received it. The challenger chooses the event, the resolver stamps the time, and the chain's `prev` holds everything before: no one of them makes the hash alone. A challenger who wants another seed has to post another challenge, which is another stake. A well-known document names this seed `challenge-receipt`; `next-receipts` (the ids of the next receipts from unrelated roots) and `mirror-commit` are the two PROTOCOL.md describes, named here so a tracker can say which it uses, and not built.
- **The order** is the pool sorted ascending by `sha256(canonical([seed, address]))`.
- **The panel** is the first three in the order. A challenge whose receipt carries no chain hash has no panel yet and stays open.

The draw is recomputable by anyone holding the chains of the tracker the challenge was posted to, as that tracker serves them: the seed from the challenge's line on its problem's log (`GET /p/<hash>/events`), and the pool from that log, the log of every other problem it carries and its identity log (`GET /k/events`), as section 3 says. A chain is a resolver's own (QX-11 section 2), and the mirror keeps one of its own: each event it lacks is a new line with the source's wrappers kept and its own added, under its own hashes ([NODE.md](../NODE.md) section 5), so a draw computed over the mirror's chains is not the tracker's. Two trackers that carry the same challenge hold different chains, so a challenge is judged on the chain of the tracker it was posted to, and its verdicts go there.

## 5. Seats

A seat is offered to each of the first three at the challenge's receipt. A seat whose holder has given no verdict `lease_h` hours after it was offered (the problem's default lease) lapses, and at that moment a seat is offered to the next root in the order not yet offered one. A verdict counts only from a root whose seat is live at the verdict's receipt: offered, not lapsed, not yet answered. A verdict from any other root, a second verdict from the same root, and a verdict after the decision are dropped.

## 6. The decision

- **Held**: two verdicts `for: challenger`. The challenger's standing rises by the stake. Each root of the accepting set loses one and its point for the set. The set's events, the two reveals with their commits, or the patch's reveal and commit with the two runs, are **struck**: left out of the fold from then on.
- **Failed**: two verdicts `for: author`. The challenger's standing falls by the stake. The acceptance stands as the core had it; the window is not extended.
- **Void**: fewer than three roots in the pool at the receipt, or every seat in the order lapsed or answered with no majority. Nothing is won or lost; the acceptance stands. The reference tracker refuses at the door a challenge it cannot seat, so a void challenge is one whose panel ran out.
- **Open** otherwise.

The decision's time is the receipt of the verdict that made the majority, or the last lapse.

## 7. States

A client with this extension holds each piece in the core's states and one more:

- `challenged`: a challenge on the piece is open. The core says `accepted_provisional`, or `accepted` once the window closes while the panel sits; this layer says less, as EXTENSIONS.md allows.
- After a **held** challenge, the piece's state is what the core's own reducer computes with the struck events left out: `open`, `sealed`, `needs_verify` or `disputed` as the remaining events say. The piece is offered again by `next` run on that fold. The judges' returns stay in the ledger as evidence. `re_accepted`, where the panel's return stands in the struck set's place, is named in PROTOCOL.md and not in this draft: a held challenge sends the piece back to production.
- After a **failed** or **void** challenge, the state is the core's.
- A piece is challenged once. After a held challenge an acceptance it reaches again is not challenged under this draft.

Where this layer says a piece is accepted, the core says accepted; the core's `accepted` means accepted absent a challenge, as CORE.md section 10 says.

## 8. The reference tracker

- Carries `challenge` and `verdict` under `POST /p/<hash>/events` with the checks of section 1, refusing with the reason: `nothing accepted on this piece yet`, `outside the window`, `a challenge is open on this piece`, `this piece has had its challenge`, `a party to the acceptance cannot challenge it`, `a challenge on an acceptance stakes at least 1`, `standing N is below the stake of M`, `no panel can be seated: N roots with an accepted return on another problem, 3 needed`, `names no open challenge on this piece`, `not a judge drawn for this challenge`, `this seat lapsed`, `this judge has answered`.
- `GET /p/<hash>/challenges`: every challenge on the problem with its seats, verdicts and outcome as the tracker computes them at `now`.
- `GET /p/<hash>/state` and `/next` use this layer's states, so a struck piece is offered again and a challenged one is not.
- `GET /.well-known/quilt` says `sortition: "challenge-receipt"` and `challenge: { extension: "QX-1", panel: 3, majority: 2, ground_max: 200 }`.
- Reads `QUILT_FOUNDING_STANDING` (`<address>=<amount>`, comma separated) into the declaration of section 2 as amended, publishes it at `GET /.well-known/quilt` as `founding`, and answers `founding` beside `standing` at `GET /k/<address>/standing`; `packages/tracker/test/founding.test.ts` holds it.

## 9. The client

`quilt challenge <problem> <piece> <stake> <ground>` and `quilt verdict <problem> <piece> <challenge id> <challenger|author> [<return json>]` sign and post the events; the tools `quilt_challenge` and `quilt_verdict` do the same for a person's AI, which the person's own client asks first. `quilt read` and `quilt_read` list the problem's challenges from the tracker that answered: the ground as the challenger's quoted words, the seats, each verdict with the judge named and its return quoted.

## 10. Tests

`packages/tracker/test/challenge.test.ts` holds the rules: a challenge that holds and strikes the set, one that fails and costs the stake, one refused for standing, a verdict refused from a root not drawn, a challenge refused after the window, and the pure fold's lapse, replacement and void. `packages/tracker/test/carried.test.ts` holds section 2's amendment of 10 November 2026: a set carried to two and three versions, and to two versions made from the same one, credited once; a held challenge at a later version docking once and forfeiting a lock made at an earlier one; a miss overruled giving back the one point, and the owner's gold at a second version refused; no pool from the versions of one problem; one challenge open at a time, and once, across the line; and the coin verifying a carried square once, and paying a set from the line's escrow once and refunding it when any version completes ([QX-17](QX-17.md) section 8). `packages/client/test/challenge.test.ts` holds the verbs and the tools' text. `packages/mirror/test/seed.test.ts` holds section 4 at the mirror: the tracker's chains as it serves them give the tracker's seed and seats, the challenge's problem's log alone seats no panel, and the mirror's own chain seeds another draw, so a challenge the tracker decided can stay open in the mirror's fold ([NODE.md](../NODE.md) section 6).
