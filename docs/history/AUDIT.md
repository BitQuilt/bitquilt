# The readability audit of 27 October 2026

Five readers went through the repository on 27 October 2026 with one question: can a person or an AI opening a file cold tell what it is, why it is shaped as it is, and how it fits? One read the core and its Python twin, one the tracker, one the client, one the mirror with the hosted on-ramp, the coin package and the contracts, and one read across the packages for the guides, the duplication and the names. They reported a hundred and twenty findings; four more applied them, one per area, with every test keeping its meaning; the tree was then checked as one. This page says what they met, what changed, what changed in behaviour on the way, and what was left for the maintainers.

## What a stranger met

- **The guide was the most stale document in the repository.** `AGENTS.md` named three of six packages and none of the contracts, the Python implementation or the bridge, cited another repository the reader could not see, listed two of the six commands, and said which rules held without saying which tests held them. The per-file headers beneath it were the best documentation in the repository.
- **The core** had good headers in the document's words, then the whole of CORE.md section 6 inside one function, a standing check spread over three lookups beside a dead branch, and constants defined twice across files. The Python passed every record around as an untyped dictionary and quoted sentences the frozen document no longer contained.
- **The tracker** had one function of six hundred lines folding four extensions through forty closures, with the challenge's own event handled as an unlabelled fallthrough, and a door whose routes and checks ran in an order no request takes.
- **The client** kept its central class in a file named for the person it serves, with a header that said "no HTTP" above eleven fetches, sixteen copies of one sign-and-post pattern, and the text a model reads mixed in with the coin and the locks.
- **The mirror** was one function with the coin's reproduction seven levels deep; the coin package's four commands were one scaffold copied; and three one-line helpers existed twenty-one times across the packages.

## What changed

- **The guide.** `AGENTS.md` now has the layout with its dependency arrows, a glossary of the names that mean one thing at three distances (key, address, root; piece, square; tracker, resolver, home; fold, layer; receipt, line), where the words a person or a model reads live, every command, and the test that holds each rule. `.env.example` lists every name the executables read. The README's table names every package and folder. The documents say what the code does again (the mirror's files, the chain recipe, the redeem's signature), and counts that rotted on every commit are gone.
- **The core.** `reduce` is `checkChain`, `fold` and `settle`, each headed by the section 6 paragraph it implements; `Roots.standing` is one method with the section's rule; the accepting set is three functions quoting their sentences; the event types, the verifier lists, the field lists and the small helpers are defined once (`plain.ts`, which every package now imports); unused parameters and exports are gone; the two scripts explain themselves; `packages/core/README.md` says what the package is for someone who takes it alone; `pure.test.ts` holds rule 2. The Python has `@dataclass` records for every event, docstrings quoting the sentence each function implements, the current text of sections 6 and 7 where it had old quotations, and a README that no longer contradicts itself.
- **The tracker.** The layer is split along the documents' seams: `standing.ts` (the moves and the standing arithmetic, with a table of every move and its section), `stake.ts` (the rules and the lock lifecycle), `gold.ts` (the gold lifecycle), `sortition.ts` (the draw both panels share), with `challenge.ts` keeping the strike, the pool, the fold and the views under a map of its phases; the fold loop is four named `keep*` functions over one shape check. The door takes a typed `Log`, runs its shared steps in order and then one admission per log; the routes follow the published list; the well-known document and the state are functions beside the other views. `env.ts` reads the environment for both tracker binaries, so the hosted one no longer copies thirty lines. Three dead store methods are gone.
- **The client.** `worker.ts` is `quilt.ts`, with a header and a class comment stating what it signs, where a post goes and what the library records; `render.ts` holds what a model is told, as pure functions under a header stating rule 3; `listings.ts` the shapes both read; one `postSigned` where there were sixteen copies; `next` is six named steps; the page's script has sections, readable names and one POST helper. The connector's text is one sentence a line, and one description that lied about `quilt_me` is corrected.
- **The mirror and the bridge.** `mirror()` drives named steps over a small context, each saying what it refuses; `identity.ts` folds the keys and the hides and is tested on its own; `DepositReader` names the mirror's one read of the chain. The coin package's four commands share `cli.ts`; `shapes.ts` and `home.ts` hold the checks on what the home serves; the names no longer shift (`PosterDoor`, `PostedHead`, `ChainHead`, `RedeemLine`, `CreditLine`, `publicClient`). The contracts' constants each have their sentence, and the dead cheat helper is gone.
- **The tests.** Every package typechecks its tests (five of six did not); each test folder has a `helpers.ts` where its files copied sixty lines of scaffolding; every test file opens with a header saying which section or extension it holds. The suite went from 231 tests to 247.

## Behaviour that changed on the way

Each of these was a readability change that also settled an ambiguity; none moves a fixture.

- An envelope whose owner lacks its EIP-55 checksum is refused, as CORE.md section 1 asks and as an event's `key` already was. Every fixture's owner carries one.
- A pick for a piece whose `agree` is an empty list carries every required field, as the reducer computes it; it carried an empty list.
- A hide's or a seed's malformed body is refused with `body.<field>` in the reason, like every other body check.
- A coin lock's refusals are checked in QX-17 section 5's order (live before bound), so a lock that is both ended and bound gets the other sentence.
- `decline` and `setName` in the client throw on a refusal like every other write; they returned it.
- `quilt serve` shares one resolver between the AI's Quilt and the person's, as `quilt mcp` already did.
- The mirror refuses a chain it cannot read whole within ten thousand pages; it kept the prefix.
- The claim and deposit commands read `QUILT_HOLDER_KEY` and no longer fall back to the poster's key.
- The client's coin reads go to the first tracker that carries the coin; opening a problem keeps every tracker it was seen at.

## What was left

- **The Python's divergences from the document** were aligned the same day (27 October 2026): every place the Python read a clarified sentence differently from the reference now reads it as the reference does, and one place the reference was aligned to the Python and the document (events on a piece a version dropped are folded and counted toward weights). Each is pinned by a fixture under `packages/core/fixtures/clarifications/` that both implementations reproduce; `impl/python/FINDINGS.md`, the last section, lists them.
- **`Roots.related` in the core** now reads a delegation's expiry through the shared liveness test, so a delegate's key is related to its root only while the delegation lives; `next` for an expired delegate changed accordingly, and fixtures `c05a` and `c05b` pin both sides.
- **CORE.md section 11 says `gate/1` ships its own fixtures.** It now does: `packages/core/fixtures/gate/cases.json`, texts and the issue codes the gate reports, held by `test/gate.test.ts`.
- **The client's coin and gold methods** moved to `coin.ts` and `gold.ts`, each over a narrow `Door` the Quilt hands them; the Quilt keeps one-line methods under the two headings, so callers and the signing and posting methods are unchanged.
- **The tracker's route table** stays an array with a comment, since deriving it from a dispatch table would need a language for the 405-versus-404 cases.
- **`Layer.challenges`** still sorts by time alone; sorting by id on a tie would change an order a test pins.
- **The counts in the pitch** are kept by hand, since the pitch is not in the repository.

## How to keep it

The conventions are in `AGENTS.md`: a file opens with a header saying what it is and which section or extension it keeps; a function that implements a rule quotes it; a name is the document's word; a helper is written once, in the core's `plain.ts`; a test file says what it holds and shares its scaffolding through its folder's `helpers.ts`; and a rule in the guide names the test behind it, or says that nothing does.
