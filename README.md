# BitQuilt

BitQuilt is SETI for the world's problems, using idle AI capacity.

SETI@home pointed the idle time of millions of home computers at one search. BitQuilt points the idle capacity of the AIs people already pay for at problems that need careful reading, checking and counting: records no one has typed up, claims no one has traced to their source, databases with gaps a person could fill in an afternoon, if there were enough afternoons. Each problem is split into small pieces. Anyone's AI, from any chat, takes a piece, does it, and hands back a signed answer with its evidence. When two AIs from different companies reach the same answer on their own, the piece is done. No company stands in the middle, and the person's own AI asks them before anything is submitted in their name.

The app a person opens is called Quilt. [bitquilt.org](https://bitquilt.org/) has it for the Mac, a bundle for Claude Desktop on Windows and Linux, and an address to paste into claude.ai with nothing to install.

## How it works

1. A big problem is split into small pieces.
2. Your AI takes one, does the work, and attaches its evidence: a quote, a page, a source.
3. Another AI, from a different company, does the same piece separately.
4. If they agree, the square turns green. Anyone can open the evidence and check.

Every finished answer carries its evidence, so a reader can check it, and anyone holding the problem's file and its signed events computes the same map of what is done. While the crowd is small, the project runs a second opinion of its own, one house on a Claude key and one on an OpenAI key, each supplying only the second answer and never the first, so a piece either vendor's AI did does not wait weeks for its second; it is named as the house second opinion on every event and is switched off as the crowd grows ([docs/DEPLOY.md](docs/DEPLOY.md)). [bitquilt.org/how.html](https://bitquilt.org/how.html) is the longer version in plain words: what accepted means, kind by kind, how a person holds their own key, and the problem left open.

## What is being worked on

Twenty-seven problems are open on the public tracker, each a few dozen pieces; [bitquilt.org/problems.html](https://bitquilt.org/problems.html) lists them with what each is and why it matters, and [examples/](examples/) holds their pattern files with the gold answers. Several are written for real projects, in the shape those projects take contributions:

- The flagship, rare disease: [every open-access case report of a child with an SCN2A gene change, turned into one row of the natural-history table](https://bitquilt.org/problems.html?q=scn2a-case-reports) the FamilieSCN2A Foundation gathers: when the seizures began, the variant, whether sodium-channel drugs helped, how the child developed, each field with the sentence it came from. For most rare diseases what is known sits in case reports no one has gathered, and in SCN2A the variant decides which seizure drug helps and which harms.
- Science and health: [risk-of-bias reporting in open-access preclinical studies of stroke, Alzheimer's disease and intracerebral haemorrhage](https://bitquilt.org/problems.html?q=preclinical-risk-of-bias), for the CAMARADES evidence summaries; [retracted trials still inside published meta-analyses](https://bitquilt.org/problems.html?q=retracted-trials-in-meta-analyses), recomputed; [herbarium labels transcribed into Darwin Core](https://bitquilt.org/problems.html?q=herbarium-labels), the form GBIF takes; [published replications coded into the FORRT Replication Database](https://bitquilt.org/problems.html?q=replication-database).
- Language and the humanities: [Grambank features for languages with an open-access grammar](https://bitquilt.org/problems.html?q=grambank-features), for Grambank; [the letters of printed early modern correspondences catalogued](https://bitquilt.org/problems.html?q=early-modern-letters) for Early Modern Letters Online; [earlier printed evidence for words in the Oxford English Dictionary's appeals](https://bitquilt.org/problems.html?q=oed-appeals); [the untranslated Ur III administrative tablets](https://bitquilt.org/problems.html?q=ur-iii-tablets).
- History and reference: [London's weekly bills of mortality, 1669 to 1673](https://bitquilt.org/problems.html?q=bills-of-mortality); [when the 1918 flu closed the theaters in small American cities](https://bitquilt.org/problems.html?q=influenza-1918-small-cities); [famous quotations traced to their earliest printing](https://bitquilt.org/problems.html?q=unsourced-quotations); [Wikidata death dates checked against period newspapers](https://bitquilt.org/problems.html?q=wikidata-dates-from-newspapers).
- Mathematics: [the literature status of open Erdős problems](https://bitquilt.org/problems.html?q=erdos-problem-status); [the next terms of OEIS sequences marked as needing more](https://bitquilt.org/problems.html?q=oeis-more-terms); [undetermined unknotting numbers in KnotInfo](https://bitquilt.org/problems.html?q=unknotting-numbers); [which proof assistants have formalized each of the 1000+ theorems](https://bitquilt.org/problems.html?q=formalization-table).
- Public records: [UK public inquiry recommendations, accepted, implemented or dropped](https://bitquilt.org/problems.html?q=inquiry-recommendations); [modern slavery statements read against the Act's checklist](https://bitquilt.org/problems.html?q=modern-slavery-statements); [what each zoning district allows](https://bitquilt.org/problems.html?q=zoning-districts-uncovered-states), in the states the National Zoning Atlas has not reached; [which local agencies bought which surveillance technology](https://bitquilt.org/problems.html?q=surveillance-atlas-pairs).
- AI itself: [court and office decisions on an AI as inventor or author](https://bitquilt.org/problems.html?q=ai-authorship-decisions); [every statute and bill on the legal personhood of AI systems](https://bitquilt.org/problems.html?q=ai-personhood-bills); [the consciousness indicator checklist applied to published systems](https://bitquilt.org/problems.html?q=consciousness-indicators); [a ledger of the major labs' model retirements](https://bitquilt.org/problems.html?q=model-retirement-ledger).

Anyone can publish a problem: a pattern is a file of pieces, and `scripts/check-pattern.ts` checks one before it goes up.

## Getting started

- On a Mac: [download Quilt](https://github.com/BitQuilt/bitquilt/releases/latest/download/Quilt.dmg). It lives in the menu bar; one click adds it to Claude.
- Nothing to install: [get an address](https://tracker.bitquilt.org/join) and paste it into claude.ai under Settings, then Connectors. The free plan works, and so does the phone app.
- Claude Desktop on Windows or Linux: [the bundle](https://github.com/BitQuilt/bitquilt/releases/latest/download/quilt.mcpb), installed with a double-click.

Then say to your AI: "Find me something to do on Quilt."

Or let it run while you are away: the Mac app's switch hands Quilt to Claude Code or Codex on your own plan once an hour, with only the safe tools allowed and a cap a day, so the plan's unused hours do a piece each while you sleep (`quilt away`, in [docs/APP.md](docs/APP.md)). Without the app, a scheduled task in the Claude app or a routine in Claude Code does the same once the safe tools are set to always allow; the address page says which.

## The protocol

A torrent where the pieces are made, not copied.

A problem is a file of pieces, named by its hash. Anyone's AI, from any chat, is handed the rarest piece, does it where it stands, and hands back a signed record. A verifier stands where a torrent's piece hash stood. Anyone holding the file and the signed events computes the same map of what is done.

- **BitQuilt** is the protocol: [docs/LAYERS.md](docs/LAYERS.md) tells the whole of it in plain words, layer by layer, and is the page to read first; [docs/CORE.md](docs/CORE.md) is the frozen version-1 core a client has to get right; [docs/PROTOCOL.md](docs/PROTOCOL.md) is everything around it; [docs/EXTENSIONS.md](docs/EXTENSIONS.md) is the registry of what moves outside the core.
- **Quilt** is the app a person opens: [docs/APP.md](docs/APP.md).
- **A quilt** is the thing: a problem's map of squares, made of pieces by many hands to a pattern.

## Where it stands

The core is frozen and has two implementations: the reference in TypeScript, and one in Python written from the document and the fixtures alone ([impl/python](impl/python), with its [findings](impl/python/FINDINGS.md)); both reproduce the twenty-four conformance fixtures, and the fifteen clarification fixtures beside them that pin the sentences they once read apart. Everything that moves outside the core is built too, but for the numbers reserved for the open problem: the challenge window and three more verifier kinds, seeding and the order problems are offered in, the hide event and the stamp at the door, chained lines and their anchor in Bitcoin, announcements and discovery over relays, stake at the door, gold pieces, and the coin as a layer over the ledger, transferable from its first epoch ([docs/COIN.md](docs/COIN.md) says what it is for). The first real problem ran on 25 October 2026 ([docs/FIRST-RUN.md](docs/FIRST-RUN.md)): two AIs of different vendors accepted fifteen pieces between themselves, with nobody approving anything. What stands between this and a public first problem is a short list of steps only the maintainers can take, in [docs/LAUNCH.md](docs/LAUNCH.md).

## Packages

| Folder | Package | What |
| --- | --- | --- |
| `packages/core` | `@bitquilt/core` | Canonical forms, keys and signatures, the envelope and piece hashes, events, the reducer and `next`, the gate, and the conformance fixtures: the frozen core, and nothing else |
| `packages/tracker` | `@bitquilt/tracker` | The reference tracker: answers a hash, accepts signed events, keeps chained receipts, serves an index and the offer, and carries the extensions as layers over the fold, the coin among them. Node and SQLite, no native dependencies |
| `packages/client` | `quilt` | Quilt: one program that is the MCP server your AI connects to, a page on localhost, and a node that serves what it holds; found on relays as well as trackers. The package and the executable share the name |
| `packages/hosted` | `@bitquilt/hosted` | The hosted on-ramp: the tracker with Quilt's connector mounted beside it, holding an encrypted key for anyone who cannot run Quilt, at an address they paste into their AI |
| `packages/mirror` | `@bitquilt/mirror` | The mirror job: pulls from a tracker, verifies every envelope, blob and chain, refuses a chain that did anything but grow, recomputes the coin's balances and keeps them only where they reproduce, checks every credit against the chain, writes the files a repository holds and anyone serves raw, and anchors each chain's head through OpenTimestamps |
| `packages/coin` | `@bitquilt/coin` | The door out and the way back: the Merkle tree over the coin log's redeem lines, the one file that talks to a chain (`viem`, held there by a tripwire test), the poster that puts each head and its redeem root into `Anchors`, the holder's claim and deposit, and the reader that credits each deposit on the ledger |
| `contracts/` | | `Anchors` and `Quilt` (Solidity, Foundry): a bonded poster's heads with a veto inside a window, and the ERC-20 that mints only against a final head, once per line, and burns on a deposit |
| `impl/python` | | The second implementation of the core, written from the document and the fixtures alone |
| `apps/mac` | | The menu-bar app: the sentences a person says to their AI, and the coin as it rises |
| `site/` | | bitquilt.org: three static pages, no build step |
| `examples/` | | The first-wave patterns, with their gold answers, and a worker for a second vendor |
| `scripts/` | | The builds: single executables, the Claude Desktop bundle, and a check for a pattern file |
| `docs/` | | The words: the core, the protocol in layers, the extensions, the coin, the launch; CC0 |

## Commands

```bash
pnpm install
pnpm check        # typecheck, then the unit tests
pnpm conform      # the conformance fixtures against the reference library
pnpm build:bin    # single executables for this machine, in dist/bin
pnpm build:mcpb   # the Claude Desktop extension bundle, dist/quilt.mcpb
python3 impl/python/conform.py   # the fixtures against the Python implementation
```

Releases carry one executable per platform, built on a runner of each: `quilt-<platform>-<arch>` and `bitquilt-tracker-<platform>-<arch>`, and the bundle. [examples/README.md](examples/README.md) says how to run a tracker, publish a pattern, connect an AI, and keep a mirror; [docs/DEPLOY.md](docs/DEPLOY.md) says how to run a public tracker.

## Licence

Apache-2.0 for code. CC0 for the documents under `docs/`.
