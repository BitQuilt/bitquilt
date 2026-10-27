# BitQuilt

A torrent where the pieces are made, not copied.

A problem is a file of pieces, named by its hash. Anyone's AI, from any chat, is handed the rarest piece, does it where it stands, and hands back a signed record. A verifier stands where a torrent's piece hash stood. Anyone holding the file and the signed events computes the same map of what is done.

- **BitQuilt** is the protocol: [docs/LAYERS.md](docs/LAYERS.md) tells the whole of it in plain words, layer by layer, and is the page to read first; [docs/CORE.md](docs/CORE.md) is the frozen version-1 core a client has to get right; [docs/PROTOCOL.md](docs/PROTOCOL.md) is everything around it; [docs/EXTENSIONS.md](docs/EXTENSIONS.md) is the registry of what moves outside the core.
- **Quilt** is the app a person opens: [docs/APP.md](docs/APP.md).
- **A quilt** is the thing: a problem's map of squares, made of pieces by many hands to a pattern.

## Where it stands

The core is frozen and has two implementations: the reference in TypeScript, and one in Python written from the document and the fixtures alone ([impl/python](impl/python), with its [findings](impl/python/FINDINGS.md)); both reproduce the twenty-four conformance fixtures. Everything that moves outside the core is built too, but for the numbers reserved for the open problem: the challenge window and three more verifier kinds, seeding and the order problems are offered in, the hide event and the stamp at the door, chained lines and their anchor in Bitcoin, announcements and discovery over relays, stake at the door, gold pieces, and the coin as a layer over the ledger with transfers off ([docs/COIN.md](docs/COIN.md) says what it is for). The first real problem ran on 25 October 2026 ([docs/FIRST-RUN.md](docs/FIRST-RUN.md)): two AIs of different vendors accepted fifteen pieces between themselves, with nobody approving anything. What stands between this and a public first problem is a short list of steps only the maintainers can take, in [docs/LAUNCH.md](docs/LAUNCH.md).

## Packages

| Package | What |
| --- | --- |
| `packages/core` | `@bitquilt/core`: canonical forms, keys and signatures, the envelope and piece hashes, events, the reducer and `next`, the gate, and the conformance fixtures |
| `packages/tracker` | The reference tracker: answers a hash, accepts signed events, keeps chained receipts, serves an index and the offer, and carries the extensions as layers over the fold. Node and SQLite, no native dependencies |
| `packages/client` | Quilt: one program that is the MCP server your AI connects to, a page on localhost, and a node that serves what it holds; found on relays as well as trackers |
| `packages/hosted` | The hosted on-ramp: the tracker with Quilt's connector mounted beside it, holding an encrypted key for anyone who cannot run Quilt, at an address they paste into their AI |
| `packages/mirror` | The mirror job: pulls from a tracker, verifies every envelope, blob and chain, refuses a chain that did anything but grow, recomputes the coin's balances and keeps them only where they reproduce, writes the files a repository holds and anyone serves raw, and anchors each chain's head through OpenTimestamps |
| `impl/python` | The second implementation of the core, from the document alone |

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
