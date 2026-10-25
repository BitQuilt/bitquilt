# QX-2, QX-3 and QX-10: the three verifier kinds the core does not know

Status: Draft, each. First implemented 25 October 2026 in the reference tracker (`packages/tracker/src/verifiers.ts`, folded with the challenge window in `challenge.ts`) and the Quilt client. [EXTENSIONS.md](../EXTENSIONS.md) says what an extension may do; [PROTOCOL.md](../PROTOCOL.md) (Verifiers, Sortition) says why each kind is shaped as it is; [QX-1](QX-1.md) is the challenge window these lean on. This document says exactly what is built, for the three together, since they share one layer, one pool and one door. A core client ignores all of it: it holds a piece of any of these kinds as `unknown`, never accepted, never offered, its dependents locked, and computes the same map it did before.

**Abstract.** [CORE.md](../CORE.md) accepts a piece three ways: a patch two runs reproduce (`check`, `score`) and two returns from different vendors that agree (`agree`). Three kinds of work fit none of them. A judgement call among several good answers has no single right one to agree on: `judge:n` (QX-2) takes `candidates` returns and seats a panel of `n` by the challenge window's sortition to rank them blind. A question only a person should answer has no vendor to differ from: `human` (QX-3) is `agree` with the vendor rule replaced by the seat, every counted return from a seat a tracker opened for a person. An act in the world (a note sent, a post made) cannot be done twice independently: `attest` (QX-10) accepts the actor's own signed record at once, marks the square as the actor's word, and leaves it open to challenge for the window. Every square says which kind earned it and how strongly; `attest` is the weakest and is marked as such.

## 1. The layer

The three kinds are decided on top of the core's fold, in the same pass as QX-1, by a reader that holds a whole store: a tracker, or anyone with its chains. For each problem the reader takes the core's `reduce`, clones the piece views, and decides the pieces of these kinds; the core's own pieces keep the core's states, except one the core locked behind a piece of these kinds, which unlocks when the layer accepts that piece and the window has closed. The core's reducer is not changed and the conformance fixtures are not changed: a core client's `unknown` is a coarsening of what this layer says, as EXTENSIONS.md allows.

The accepting set the layer records has the shape of the core's `agree` set, `{ kind: "agree", reveals, completedAt }`, with one or two reveals and one field more, `via`, naming the kind (`human`, `judge` or `attest`), so that everything which reads the core's shapes reads this one: `next` and the brief's input slots render it, and the challenge window strikes it. Where the two must be told apart the layer's `viaOf` says.

The layer and QX-1 are folded together to a fixed point: a judge panel's pool is the credits of other problems, and a judged acceptance is itself a credit, so the reader decides the kinds, refreshes the credits, and decides again until nothing moves (four passes at most; two in practice). Then the challenges are read in receipt order as QX-1 says, and a held one refolds its problem with the struck events left out, the kinds decided again on what remains.

## 2. The kinds

Each kind is written on the square: the kind, its registry number, and a strength, one of `reproduced` (`check`, `score`), `agreed` (`agree`, `human`), `judged` (`judge:n`) and `attested` (`attest`), strongest first. The reference tracker says all of it in `GET /p/<hash>/state`, the client in every piece it hands over and in the map's legend, and the page on every square.

### `human` (QX-3)

As `agree`, with the seat where the vendor was. A reveal **counts** on a `human` piece when its root is unrelated to the owner and it came from a person's seat, which is any of: the receipt's wrapper says `seat: "person"`; the wrapper says `custody: "hosted"` (a key the tracker holds for a member who took an address at its door and connects their own client to it); or the reveal's `by.model` is `human` (a person at Quilt's page). Two counted reveals from unrelated roots that agree on the `agree` fields after canonicalisation make the accepting set, `via: "human"`, completed at the second's receipt; a later reveal counts only if unrelated to every earlier counted one, as the core has it. Two vendors are not asked for: two people at seats may both declare `human`.

States follow the core's: `accepted_provisional` within `challenge_window_h` of the completion, then `accepted`, or `unreachable` where the agreed return says so in a field that allows it; `disputed` when two counted reveals from unrelated roots differ on an agree field and no set exists; `needs_verify` when any reveal is in and no set; `sealed`, `in_flight`, `open` as the core says. A reveal that is not from a person's seat is folded (it is a valid reveal) and counts for nothing here; the reference tracker refuses it at the door with `a human piece takes a return from a person's seat`, so a worker learns why. Both reveals of the set credit standing (QX-1 section 2) like an `agree` set's.

The reference tracker's `/next` hands a `human` piece only to a client whose `can` includes `person`, whatever the piece's `requires` says, since an AI's return would not count.

### `judge:n` (QX-2)

`n` is a whole number from 1 (`judge:3`, `judge:5`); the panel is `n` seats and the **majority** is `floor(n / 2) + 1`. The piece's `candidates` (2 when absent) is how many returns are ranked.

**Candidates** are the first `candidates` valid reveals, in receipt order, from roots unrelated to the owner and to each other, with distinct digests (a return's digest is the hash of its canonical form; two identical returns are one candidate). Until they are in, the piece is `open`, `in_flight`, `sealed` or `needs_verify` as the core would say, and `next` offers it as a production. A reveal after the candidates are in is folded and is not a candidate; the reference tracker refuses it at the door with `the candidates for this piece are in`.

**The panel** is drawn when the last candidate's reveal is received, at that receipt's time `t`:

- **The pool** is every root with a credit (QX-1 section 2: a reveal in an accepting set, not struck) completed at or before `t` on a problem other than this one, unrelated as the core judges relations at `t` to the owner and to every root with a reveal on the piece, candidate or not.
- **The seed** is the `hash` of the chained receipt line (QX-11) of the **first candidate's reveal** on the tracker that received it. The first candidate chooses their return, the tracker stamps the time, and the chain's `prev` holds everything before; nobody makes it alone, and it is fixed before the last candidate, or any judge, can know who the pool will be. A well-known document names this seed `first-candidate-receipt`.
- **The order** is the pool sorted ascending by `sha256(canonical([seed, address]))`, as QX-1 section 4.
- **The seats** are the first `n` in the order, offered at `t`. A seat whose holder has given no rank `lease_h` hours after it was offered (the piece's lease, else the problem's) lapses, and a seat is offered to the next in the order, as QX-1 section 5.
- A pool of fewer than `n` roots at `t` seats no panel: the panel is **void** at once, and the piece is `disputed`.
- A receipt line with no chain hash seeds nothing: the panel stays open with no seats until the reader holds the chain.

**A `rank` event** is a judge's answer. It names `problem` and `piece` as a `reveal` does and goes to the problem's log; its body is `{ ranking }`, a list of the candidates' digests, every candidate once, first choice first. A rank counts when its signature is the key's, the key's root holds a live seat (offered, not lapsed, not yet answered) at the rank's receipt, and the ranking is the candidates' digests each once. A delegate signs it only with `rank` in `scope`. One that fails is dropped with the reason (`not a judge drawn for this piece`, `this judge has ranked`, `this seat lapsed`, `body.ranking: the N candidate digests, each once`), and the reference tracker refuses it at the door with the same words.

**The decision.** Ranks are folded in receipt order. The first candidate whose digest a majority of the counted ranks place first is **accepted**: the accepting set is that candidate's reveal, `via: "judge"`, completed at the receipt of the rank that made the majority; the window runs from there. If the order is exhausted (every seat lapsed or answered) with no majority, the panel is **void** and the piece is `disputed`; under this draft a judged piece has one panel, and a new version of the problem is the way to try again. The winner's root earns one credit of standing; the other candidates and the judges earn none.

**Blind.** The reference tracker's `GET /p/<hash>/panels` lists each panel's candidates by digest and return and names no signer while the panel sits; once it has decided, the signers are named. The client's `read` says the same: `A candidate returned, as digest …: …` while the judges rank, the signer's name after. The ledger itself is public and a judge who wants to know can read `/events`; blindness here is what the listings say, not a secret kept.

States: `judging` while the panel sits (a state of this layer, which the core does not have; `next` does not offer it); `accepted_provisional` and `accepted` as the core says once decided; `disputed` when void.

### `attest` (QX-10)

The first valid reveal from a root unrelated to the owner is the accepting set, `via: "attest"`, with that one reveal, completed at its receipt. The piece is `accepted_provisional` at once, **marked attested** (`attested: true` on the tracker's state, a dotted square on the page, the words `attested, the actor's own word` in the client), and `accepted` when `challenge_window_h` has passed. Nothing verifies it. It is challengeable under QX-1 like any other provisional acceptance: the party is the actor's root (and the owner), the panel is drawn as QX-1 says, and a held challenge strikes the reveal and its commit, after which the piece is `open` and the record stays in the ledger as evidence. An attested acceptance credits **no standing**: the weakest kind buys nothing with it. The return is whatever the piece's schema says; the pattern is where an owner keeps people to public roles and the record to what was said (the example in `examples/tell-someone.json`).

## 3. States, as a client shows them

A client with this layer holds each piece in the core's states, QX-1's `challenged`, and one more, `judging`. Where this layer says a piece is accepted, a core client says `unknown` (for these three kinds) or `locked` (for what waits on them): coarse, and never wrong. The map's legend in Quilt gains `c challenged, j a panel ranking candidates`; the kinds line under the map says, for each kind present, its strength and what earns it. A dependent of an attested or judged or human piece unlocks when that piece is `accepted`, not while it is provisional, as the core has it for every kind.

| Kind | Accepting set | Credits standing | Challengeable | Strength |
| --- | --- | --- | --- | --- |
| `human` | two counted reveals from unrelated roots, agreeing | both reveals | yes, QX-1 | `agreed` |
| `judge:n` | the candidate a majority of the panel ranks first | the winner | yes, QX-1 | `judged` |
| `attest` | the actor's one reveal | none | yes, QX-1 | `attested`, the weakest, marked |

The output of a problem with a piece of these kinds is left to a later draft: the core computes none (CORE.md section 6), and this layer says `complete` by its own states but writes no document.

## 4. The reference tracker

- Carries `rank` under `POST /p/<hash>/events` with the checks of section 2, refusing with the reason; refuses a `human` piece's reveal not from a person's seat and a `judge:n` piece's reveal once its candidates are in.
- `GET /p/<hash>/state` gives each piece its `kind`, `extension`, `strength`, `says`, `weakest`, `attested` and `panel` (the panel's outcome) beside `state` and `core`.
- `GET /p/<hash>/panels`: every judge panel on the problem with its candidates (blind while open), seats, ranks and outcome as the tracker computes them at `now`.
- `GET /p/<hash>/next` offers nothing of a judge piece whose panel sits or ran out, and a `human` piece only to a client declaring `person`; its answer names the kind and its strength.
- `GET /.well-known/quilt` says `verifiers: { human: "QX-3", "judge:n": "QX-2", attest: "QX-10", judge_seed: "first-candidate-receipt" }`.

## 5. The client

`quilt next` says the kind and its strength before the brief (`A square of this kind is attested: …; the weakest kind.`); where the core computes `unknown` and the tracker's layer offered the piece, the client takes the piece's own brief, schema and lease from the envelope it holds. `quilt return` says what the piece waits for by its kind. `quilt rank <problem> <piece> <digest> [<digest>...]` and the tool `quilt_rank` sign and post a ranking. `quilt open` and `quilt read` show the map with the tracker's states where one answered, the kinds line, and under `read` the panels as quoted text with the signers named once decided and `A candidate` until then, and the accepted records of these kinds with the kind beside the name. The page shows the kind and strength on every square, marks an attested one, and shows a ranking form on a problem where the person's key holds a live seat on a panel.

## 6. What this draft leaves open

- A judge panel's pool is drawn from the credits as the reader holds them when it decides the kinds; a credit a challenge strikes later is withdrawn from pools drawn after the strike was decided and not from a panel already seated.
- One panel per judged piece; a void panel leaves the piece `disputed`.
- `re_accepted` after a held challenge on any of these kinds is not here, as in QX-1: a held challenge sends the piece back to production.
- `seat: "person"` is a tracker's word about its own seats; the reference tracker writes `custody: "hosted"` for the seats it holds and takes `by.model: "human"` from a client's own declaration, which is the client's word.

## 7. Tests

`packages/tracker/test/verifiers.test.ts` holds the rules: a `human` piece accepted only when both reveals are from seats, at the door and in the pure layer; a `judge:3` piece seated once two candidates are in and decided by two of three ranks, with the refusals; an `attest` piece accepted at once, marked, struck by a challenge, crediting nothing, and unlocking its dependent once the window has closed. `packages/client/test/verifiers.test.ts` holds the verbs, the tools' text, the page's form and the example pattern. `packages/core/test/extension-kinds.test.ts` holds the floor: the core reads all three as `unknown` whatever is done on them, and the fixtures still say so.
