# The protocol on 24 October 2026: the demonstration, the build and the reviews

These three sections stood at the end of [PROTOCOL.md](../PROTOCOL.md) from 24 October to 7 November 2026 and are kept here as they were written. They say what the design aimed at and what changed on review; PROTOCOL.md says what is, and [LAUNCH.md](LAUNCH.md), beside this record, what of this plan stood on 26 October. Only their links changed, to reach the documents from this folder.

## The demonstration

Paste a quilt link into a chat whose connector runs locally. It resolves through the hinted tracker, shows the map, hands the rarest piece, and posts the return. Stop the site. Paste the link on another machine: it resolves through the mirror, computes the same map, hands a rarest piece, queues the return, and posts it when the tracker is back. Clone the repository and run the verify script: the same map, every signature checked, no site involved. That is "give it a hash and it goes and finds it".

## Building it

The plan as it was written on 24 October 2026, kept as it was; [LAUNCH.md](LAUNCH.md) says what of it stands.

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
- **The core stays frozen and small.** Everything else moves through [EXTENSIONS.md](../EXTENSIONS.md): numbered documents, rough consensus among implementers, the maintainers as editors, and the conformance fixtures as what makes a client a client without a company's say. Every addition to the core is resisted; the core should be finishable and the ecosystem should not.
- **The milestone is the second implementation.** One implementation is a product; two is a protocol. The core should be clean enough that a stranger builds a tracker in a weekend from CORE.md and the fixtures alone, and that is a task on the board (BitQuilt 18). The first tracker the maintainers do not run is the real launch; the local connector, grown into the app ([APP.md](../APP.md)), is the first-class client and the product, and the hosted one the on-ramp the project is glad to lose share from. Bounties for independent clients and trackers, if there are any, live outside the platform.
- **Costless acceptance is the research programme**, not a caveat. [OPEN-PROBLEM.md](../OPEN-PROBLEM.md) states it as a problem with what has been tried and the directions to try, so that other people attack it too. A protocol with a famous open problem attracts the people who build protocols.
- **The maintainer is in public, weekly, for years.** Outside this repository and for its owner to do: one canonical essay that names the idea by its sentence; a paper with a permanent citation; a home for the spec that is not a person's name, a plain domain and an organisation's repository; a weekly note on what moved; a provisional registration of the `quilt:` scheme; a companion to ERC-8004 and a Nostr NIP where those communities read; the connector listed in the MCP registry. Ecosystems find protocols through citations, not launches.

**What to measure.** Independent trackers; independent clients passing the fixtures; problems published by strangers; pieces accepted per week; forks. Not users, not press.

**What kills protocols.** A maintainer's burnout, so the cadence is set low enough to keep for five years. A company capturing the spec, which the frozen core and the extension process are there to prevent. No second implementation. A first use the community is embarrassed by, so the standing problem is chosen for the community wanted for a decade, not for heat.

**The shape of the years.** Year one: the core frozen, the reference library, the standing problem running every week, the essay and the paper out, a few dozen regulars. Year two: the first tracker the maintainers do not run, the first problem by a stranger that matters to someone, the first extension not written by the maintainers. Year three: a tracker the maintainers do not run is the most used, and the acceptance problem has a solution or a serious literature. If year three looks like that, the thing was built.

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
