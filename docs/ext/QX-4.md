# QX-4: seeding, watch pieces and the standing list

Status: Draft. Written 26 October 2026 and first implemented the same day in the reference tracker (`packages/tracker/src/seeding.ts`) and the Quilt client. [EXTENSIONS.md](../EXTENSIONS.md) says what an extension may do; [PROTOCOL.md](../PROTOCOL.md) (Events, In BitTorrent's terms) and the Workshop's SWARM.md name this one.

**Abstract.** A torrent stays alive because someone keeps seeding it after the download is done. A problem on BitQuilt is finished when its pieces are accepted, and then it goes stale: a source is withdrawn, a fact changes, nobody is watching. This extension gives a problem seeders, roots that have said they are keeping it, and gives the pattern a way to say what keeping it means: watch pieces, which are offered to the seeders first. It adds one event and one piece of arithmetic, and changes nothing the core computes.

## 1. The event

| Type | Body | Valid when |
| --- | --- | --- |
| `seed` | `{ on }` | `on` is `true` or `false`. The event names a problem and no piece, and goes to the problem's log. |

A key's root **seeds** a problem from the receipt of its latest `seed` with `on: true` until the receipt of a later `seed` with `on: false`. A delegate signs it only with `seed` in `scope`. The core ignores the event, as it ignores every extension event; the reference tracker carries it under `POST /p/<hash>/events` and refuses nothing but a malformed body.

Seeding is a statement, not a stake. It costs nothing to make and nothing to withdraw, and it is public: a reader of the log sees who said they are keeping a problem and since when.

## 2. Seeders and the last seed

For a reader at time `t`:

- the **seeders** of a problem are the roots that seed it at `t`;
- the **last seed** is the latest receipt at or before `t` of any `seed` with `on: true` on the problem, or none.

The reference tracker reports both on `GET /p/<hash>/scrape` as `seeders` (a count) and `last_seeded` (a time or `null`), and the same two fields in `GET /search`. A finished problem with no seeders is shown by a client as *last seeded on* that date, and that is the whole of how a problem goes stale: there is no expiry, no archive, no closing; only a date getting older.

## 3. Watch pieces

A **watch piece** is any piece of a family named `watch`. The core sees nothing special in the name: a watch piece has a brief, a schema, a verifier and a lease like any other, is accepted like any other, and counts toward the budget. What this extension adds is who is offered it first.

A pattern uses watch pieces for the work of keeping a problem true after it is done: "Is the paper this statement rests on still available, and does it still say this?", one per statement, or one per month. Because the core's piece fields are closed, a watch that recurs is published as a new version of the problem (CORE.md, versions and `prev`) with a fresh `watch` family, by the owner, when it is due; the pieces of the earlier version keep their names and their acceptances carry over. A client with a standing list (section 5) does this on the owner's behalf on a schedule the owner set, with the owner's key, and nothing in the protocol fires on its own.

## 4. Offered to seeders first

On a resolver with this extension, assisted `next` (PROTOCOL.md, The tracker) offers a watch piece to the problem's seeders before anyone else:

- while a watch piece is `open` and the problem has at least one seeder, the resolver names it to a seeder who asks and holds it from everyone else, as it holds a piece it has just handed out;
- the hold lasts the piece's lease from the moment the piece became open, after which the piece is offered to anyone, as the core's `next` would;
- a seeder who declines a watch piece releases it to the next seeder, and then to anyone.

This is the only effect seeding has on the map, and it is an effect on the order of offers, not on what is accepted. A client computing `next` from the events alone, without the resolver's help, sees the watch piece as open and may take it; the resolver's hold then merely makes a duplicate production, which is what verification is.

## 5. The standing list

A client keeps a **standing list**: the problems its key seeds, kept in the library with the schedule, if any, on which the client publishes the next watch version as the owner. `quilt seed <problem> on` posts a `seed` and adds the problem; `quilt seed <problem> off` posts the withdrawal and removes it. The connector exposes the same as `quilt_seed`; the page shows a problem's seeders and a switch. A seeder's client, asked for the next piece with no problem named, asks its seeded problems first, in the order of their last seed, then the rest (QX-5 says how the rest are ordered).

## 6. What this does not do

- It does not pay seeders, rank them, or give a seeder's returns any weight. A seeder is a root that said so.
- It does not run anything on a schedule inside the protocol. A watch fires because an owner's client, with the owner's key, publishes a version when the owner's schedule says to.
- It does not keep a problem from going stale. It records when someone last said they were keeping it, so a reader knows.

## 7. The reference implementation

- The tracker carries `seed` events and computes seeders and the last seed from its chain; `scrape`, `search` and the state route report them; assisted `next` applies section 4 through the store's holds.
- Quilt keeps the standing list in `library.json` and has the verb, the tool and the page switch of section 5.
- Tests: a seed on and off, the counts and the last seed on `scrape`; a watch piece offered to a seeder before a non-seeder on assisted `next` and to anyone after the lease; a core client that still sees the watch piece as open.
