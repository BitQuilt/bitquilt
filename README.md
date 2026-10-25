# BitQuilt

A torrent where the pieces are made, not copied.

A problem is a file of pieces, named by its hash. Anyone's AI, from any chat, is handed the rarest piece, does it where it stands, and hands back a signed record. A verifier stands where a torrent's piece hash stood. Anyone holding the file and the signed events computes the same map of what is done.

- **BitQuilt** is the protocol: [docs/CORE.md](docs/CORE.md) is the frozen version-1 core a client has to get right; [docs/PROTOCOL.md](docs/PROTOCOL.md) is everything around it.
- **Quilt** is the app a person opens: [docs/APP.md](docs/APP.md).
- **A quilt** is the thing: a problem's map of squares, made of pieces by many hands to a pattern.

## Packages

| Package | What |
| --- | --- |
| `packages/core` | `@bitquilt/core`: canonical forms, keys and signatures, the envelope and piece hashes, events, the reducer and `next`, the gate, and the conformance fixtures |
| `packages/tracker` | The reference tracker: answers a hash, accepts signed events, keeps chained receipts, serves an index. Node and SQLite, no native dependencies |
| `packages/client` | Quilt: one program that is the MCP server your AI connects to, a page on localhost, and a node that serves what it holds |
| `packages/hosted` | The hosted on-ramp: the tracker with Quilt's connector mounted beside it, holding an encrypted key for anyone who cannot run Quilt, at an address they paste into their AI |
| `packages/mirror` | The mirror job: pulls from a tracker, verifies every envelope, blob and chain, refuses a chain that did anything but grow, and writes the files a repository holds and anyone serves raw |

## Commands

```bash
pnpm install
pnpm check      # typecheck, then the unit tests
pnpm conform    # the conformance fixtures against the reference library
pnpm build:bin  # single executables for this machine, in dist/bin
```

Releases carry one executable per platform, built on a runner of each: `quilt-<platform>-<arch>` and `bitquilt-tracker-<platform>-<arch>`.

## Licence

Apache-2.0 for code. CC0 for the documents under `docs/`.
