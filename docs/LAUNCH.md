# Launching: what is built, and the steps only the maintainers can take

Written 26 October 2026. [APP.md](APP.md) names the smallest version: the app with search over the maintainers' index and two public relays, a publish form that makes a valid envelope, the library, the Claude connection over stdio, and one standing problem to find. The demonstration is a stranger typing a word into the box, finding the problem, clicking, their Claude being handed a piece and returning it, and their square turning green on a map other strangers are filling. This document says how much of that stands in the repository, and what remains that no commit can do.

## What stands

- **The protocol.** The core is frozen ([CORE.md](CORE.md)) with two implementations and twenty-four fixtures. Every extension in the registry but the open problem's reserved numbers is built: the challenge window, the three verifier kinds, seeding and the offer, the hide event, the stamp, chained lines, anchoring, announcements, discovery over relays, stake at the door, gold pieces and the coin as a layer ([EXTENSIONS.md](EXTENSIONS.md)).
- **The tracker.** `packages/tracker`: a hash answered, signed events admitted at a door with the gate, the limits and the stamp, chained receipts, the index and the offer, the layers over the fold, the coin log. `packages/hosted` mounts the on-ramp beside it: an address at `/join` for anyone who cannot run Quilt. The `Dockerfile` builds both into one image; [DEPLOY.md](DEPLOY.md) says how to run it.
- **The client.** `packages/client`: `quilt`, one program that is the MCP server a person's AI connects to (seventeen tools, each describing and never instructing), the page on localhost (search, a problem's map, a hand-in form, publishing, the library, what is wanted from you, the key's standing and coin), and the node that serves what it holds. `quilt install claude` writes the connector into Claude Desktop; `pnpm build:mcpb` makes the one-file bundle; `pnpm build:bin` makes single executables; `apps/mac` is the menu-bar shell.
- **The bridge.** `contracts/` (`Anchors` and `Quilt`, Solidity with Foundry, twenty-one tests) and `packages/coin` (the Merkle tree over the redeem lines, the one file that talks to a chain, the poster, the holder's claim, an integration test against a local chain): a redeem line on the coin log is minted as the Quilt token on Ethereum against a head a bonded poster put on the chain, after a veto window, and a deposit burned on the chain is credited back on the ledger by a reader under the same bond, with the mirror checking every credit.
- **The mirror.** `packages/mirror` and `.github/workflows/mirror.yml`: every fifteen minutes, every chain pulled, verified, refused if it did anything but grow, the coin's balances reproduced, and every head stamped into Bitcoin through OpenTimestamps.
- **The words.** [LAYERS.md](LAYERS.md), the whole protocol in plain words; [PROTOCOL.md](PROTOCOL.md), [APP.md](APP.md), [COIN.md](COIN.md), [OPEN-PROBLEM.md](OPEN-PROBLEM.md), the extension documents, [FIRST-RUN.md](FIRST-RUN.md), `examples/README.md`, and the site under `site/`.
- **The checks.** Every unit test, the conformance run (both implementations' is the maintainers' habit; the reference's runs in the checks) and the contract tests pass on every push (`.github/workflows/ci.yml`); a tagged release builds the executables for five platforms and the bundle (`release.yml`).

## What only the maintainers can do, in order

1. **A home for the code.** Make the GitHub organization and repository, add it as `origin`, push `main`. The checks run on the push. Decide whether the repository is public now or at the first problem; the words are CC0 and the code Apache-2.0 either way.
2. **The maintainers' key.** On a machine the maintainers trust, `quilt init`, and keep the phrase offline: it is the key that signs `hide` events and the first problems. Its address goes into `QUILT_MAINTAINERS`.
3. **A tracker in public.** A host with Docker and a domain, `tracker.bitquilt.com` say, with TLS in front (a reverse proxy such as Caddy terminates it in one line). Then, as [DEPLOY.md](DEPLOY.md) says:

   ```bash
   docker build -t bitquilt-hosted .
   docker run -d --name bitquilt --restart unless-stopped -p 127.0.0.1:3977:3977 -v bitquilt-data:/data \
     -e QUILT_KEY_SECRET=$(openssl rand -hex 32) -e QUILT_URL=https://tracker.bitquilt.com/ -e QUILT_IP_SALT=$(openssl rand -hex 16) \
     -e QUILT_MAINTAINERS=0x… bitquilt-hosted
   ```

   Keep `QUILT_KEY_SECRET` somewhere safe: every address the tracker hands out is lost without it. Set `QUILT_COIN` from the first day with the parameters below (decided 27 October 2026: the coin is on at launch and transfers with it, as Bitcoin's was); switched on later instead, nothing before it changes.
4. **The bridge, on day one.** Decided 27 October 2026: the Quilt token exists on Ethereum mainnet from the first day, so that an organic market can form. From a wallet the maintainers hold, with Foundry: deploy `contracts/src/Anchors.sol` with the veto multisig's address, the treasury root's address, the bond a poster must hold and the veto window (a week, as the coin vests), then `contracts/src/Quilt.sol` with the Anchors address; bond the poster's key; put both addresses in `QUILT_CONTRACTS`; set `redeem_from` in `QUILT_COIN` to genesis and `reader` to the poster's address, since the same bonded key reads the way back. Run `bitquilt-poster` and `bitquilt-reader` every fifteen minutes on the tracker's host with `QUILT_CHAIN_RPC`, `QUILT_CHAIN_ID`, `QUILT_CONTRACTS`, `QUILT_POSTER_KEY`, `QUILT_READER_KEY` and `QUILT_COIN_HOME` in their environment, and give the mirror the first three so it checks every credit against the chain ([DEPLOY.md](DEPLOY.md), the bridge); the keys live there and never in the repository. A holder's `quilt redeem <amount>` takes coin off the ledger, the next head carries the line, and once the window has passed `bitquilt-claim <line id>` mints it with the proof, the holder paying the gas once; `bitquilt-deposit <amount>` burns the token back and the reader credits the ledger. The contracts have twenty-one tests and no outside audit yet: until one is done, the bond, sized so a false head costs more than it could mint before it is struck, and the veto inside the window are what stand between a wrong head and a wrong mint.
5. **The defaults a release carries.** Two one-line changes once the domain exists: `DEFAULT_CONFIG.trackers` in `packages/client/src/config.ts` from `http://localhost:3977/` to the public tracker, and `DEFAULT_CONFIG.relays` to two public Nostr relays the maintainers choose, so that search reaches announcements on relays and a stranger's Quilt finds the problem with nothing set. The bundle's settings (`scripts/build-mcpb.mjs`) carry the same tracker.
6. **The mirror.** In the repository's settings, the variable `BITQUILT_TRACKERS` set to the public tracker; the workflow then writes the ledger to `main` every fifteen minutes and anchors every head. The repository is the public copy a client falls back to.
7. **The first standing problems.** From the maintainers' machine, with the public tracker in `~/.config/quilt/config.json`: `quilt publish examples/tell-someone.json`, then `quilt seed <hash> on`, and the same for the two waves of twelve patterns each under `examples/` (`docs/candidates/launch-50.json` names both). A gold is backed by the owner's standing, two points a piece where no stake rule applies (one for each root a miss would dock), and a new key has one point, so publish the patterns first without their gold (strip `gold` from the file, or let the tracker refuse it, which leaves the problem published) and bring the gold in with `quilt gold commit` as standing is earned: a second maintainers' key that works accepted pieces on the first key's problems, and the first on the second's, earns a point a square. The patterns' gold answers stay in the files until then.
8. **The release.** `git tag v0.1.0 && git push --tags`: the workflow builds `quilt` and `bitquilt-tracker` for five platforms and `quilt.mcpb`, and attaches them. The Mac app (`bash apps/mac/build.sh`) is signed ad hoc and opens on the machine that built it; a copy for others needs an Apple Developer ID and notarization, which can follow the first problem.
9. **The site.** Serve `site/` at `bitquilt.com` (GitHub Pages or any file server), with its links pointed at the tracker, the release and the first problem's `quilt:` link.
10. **Counsel, beside the launch rather than before it.** The founder decided on 27 October 2026 that transfers are on from genesis, so counsel reads the design as launched; the founder decided the same day that the bridge is live on mainnet on the first day as well (step 4), so counsel and a contract audit read the whole of it beside the launch. Nothing in the first problem needs the chain to be worked.

## The coin's parameters, when the time comes

A draft in the units [COIN.md](COIN.md) names, for `QUILT_COIN` on the tracker that will be the coin's home; every one of these is the founder's to decide:

```json
{ "genesis": "2026-11-01T00:00:00Z", "epoch_h": 24,
  "emission": { "per_epoch": 1000000, "decline_bp": 2500, "period_epochs": 365 },
  "vesting_h": 168, "infra_bp": 1000, "treasury": "0x…", "unit": 1000000,
  "weights": { "cross_vendor": 2, "same_vendor": 1, "attest": 0 }, "burn_rate": 1000,
  "transfers_from": "2026-11-01T00:00:00Z", "redeem_from": null }
```

A coin a day of a million units, falling by a quarter each year; a week's vesting, longer than any launch pattern's challenge window so a strike can still take back what a fake minted, and short enough that a transfer lags the earning by days (decided 27 October 2026; a year before); a tenth to the treasury; a point of standing for a thousand units at the door; transfers on from genesis; redemption off.

## The stranger's path, to walk before announcing

1. Open `bitquilt.com`, follow the link to the release, install the bundle in Claude Desktop (or run `quilt install claude`).
2. In a new chat: "search quilt for bitcoin". The first problem is listed. "Open it and take a piece." Claude asks before the claim, is handed the rarest piece, and asks again before the return.
3. Open `http://localhost:3978/`. The square is in flight, then sealed, then, once a second vendor agrees, green within the window. The Me tab shows the standing earned.
4. Take an address at `https://tracker.bitquilt.com/join` from a second device with no Quilt installed, paste it into claude.ai's connectors, and do the same. Both roads reach the same map.
5. `quilt open quilt:sha256:…` from a third machine with only the repository's mirror reachable resolves the same map from the files on `main`.
