# QX-5: reciprocity in the order problems are offered

Status: Draft, written 26 October 2026 ahead of its first implementation in the reference tracker and the Quilt client. [EXTENSIONS.md](../EXTENSIONS.md) says what an extension may do; [PROTOCOL.md](../PROTOCOL.md) (In BitTorrent's terms, Weaknesses) and the Workshop's SWARM.md name this one.

**Abstract.** BitTorrent has no ledger of who owes whom. A peer serves the peers that serve it, and every so often serves a stranger in case the stranger turns out to be worth serving: tit for tat, with an optimistic unchoke. BitQuilt refuses credits for the same reason it refuses a coin: the moment there is a balance the project is about the balance. What it can have is the same thing BitTorrent has, an order. When a worker asks for something to do and names no problem, the problems of people who have worked that worker's own problems are offered first, and every tenth offer goes to a newcomer. Nothing is counted that cannot be read off the ledger, and nothing is transferable.

## 1. What is read off the ledger

For a reader holding a set of problems, at time `t`, and for two roots `a` and `b`:

- `b` **has worked for** `a` when `b` has a reveal in an accepting set, completed at or before `t` and not struck, on a problem owned by `a`.
- A root is a **newcomer** when it owns at least one problem the reader holds and has no reveal in any accepting set on any problem the reader holds.

Relations are the core's (delegates count for their root). The reader is a resolver with its own chain, or a client with its library; two readers holding different sets order differently, which is as it should be: reciprocity is local, as in BitTorrent.

## 2. The order

When a root `w` asks for something to do and names no problem, the problems the reader holds that have a piece `next` would hand `w` are ordered:

1. **Reciprocal first.** Problems whose owner has worked for `w`, most recently first (by the completion of the owner's latest accepting set on `w`'s problems).
2. **Then the rest, rarest first.** Problems with the smallest share of pieces done (`accepted` and `accepted_provisional` over the budget), ties by the oldest last event, so a problem nobody is finishing is offered before one everybody is.
3. **Every tenth offer to a newcomer.** Counting the offers made to `w` by this reader, every tenth one is the newcomer's problem that stands highest in the order of step 2, if any; a reader that keeps no count treats the first offer in a session as the tenth.

A problem `w` owns is never offered to `w`; a problem with no piece for `w` is left out. Within a problem the piece is the core's `next`, unchanged.

## 3. Why an order and not a score

A score can be hoarded, traded or minted. An order of offers cannot: it exists only at the moment a worker asks, from the ledger as it stands, and favours the people who have done the asker's work with no number anyone holds. A publisher who works nothing is reached by rarest-first and by the tenth offers, so newcomers are not shut out; a volunteer who publishes nothing is served by rarest-first alone and loses nothing, since there is nobody to reciprocate with. A person who wants to be offered more does the one thing that moves the order: work on the problems of the people whose problems they want worked.

## 4. The reference implementation

- The tracker answers `GET /offer?key=<address>&can=<list>&model=<vendor/model>` with the problems it holds in the order of section 2 for that key, each with the piece assisted `next` would name, and takes the hold it would take for a plain `next`. The count for the tenth offer is kept per key in the store.
- Quilt's `quilt next` with no problem asks `/offer` on each tracker in turn and takes the first piece it gets; the connector's `quilt_next` makes the problem optional with the same behaviour; the page's search gains a "something to do" door that does the same. A seeder's standing list (QX-4) comes before the offer.
- Tests: an owner who worked for the asker is offered first; rarest first among the rest; the tenth offer is a newcomer's; a problem the asker owns is never offered; a core client without this extension is unaffected.

## 5. What this does not do

- It does not touch which pieces are accepted, by whom, or when.
- It does not make anyone's work count more. The order is who is asked first, not whose answer is believed.
- It does not survive the ledger: delete the events and the order is gone, because it was never anywhere else.
