# Launching: what is built, and the steps only the maintainers can take

Written 26 October 2026. [APP.md](APP.md) names the smallest version: the app with search over the maintainers' index and two public relays, a publish form that makes a valid envelope, the library, the Claude connection over stdio, and one standing problem to find. The demonstration is a stranger typing a word into the box, finding the problem, clicking, their Claude being handed a piece and returning it, and their square turning green on a map other strangers are filling. This document says how much of that stands in the repository, and what remains that no commit can do.

## What stands

- **The protocol.** The core is frozen ([CORE.md](CORE.md)) with two implementations and twenty-four fixtures. Every extension in the registry but the open problem's reserved numbers is built: the challenge window, the three verifier kinds, seeding and the offer, the hide event, the stamp, chained lines, anchoring, announcements, discovery over relays, stake at the door, gold pieces and the coin as a layer ([EXTENSIONS.md](EXTENSIONS.md)).
- **The tracker.** `packages/tracker`: a hash answered, signed events admitted at a door with the gate, the limits and the stamp, chained receipts, the index and the offer, the layers over the fold, the coin log. `packages/hosted` mounts the on-ramp beside it: an address at `/join` for anyone who cannot run Quilt. The `Dockerfile` builds both into one image; [DEPLOY.md](DEPLOY.md) says how to run it.
- **The client.** `packages/client`: `quilt`, one program that is the MCP server a person's AI connects to (seventeen tools, each describing and never instructing, and fifteen prompts, the phrases a person says to start each thing), the page on localhost (search, a problem's map, a hand-in form, publishing, the library, what is wanted from you, the key's standing and coin), and the node that serves what it holds. `quilt install claude` writes the connector into Claude Desktop; `pnpm build:mcpb` makes the one-file bundle; `pnpm build:bin` makes single executables; `apps/mac` is the menu-bar shell.
- **The bridge.** `contracts/` (`Anchors` and `Quilt`, Solidity with Foundry, twenty-one tests) and `packages/coin` (the Merkle tree over the redeem lines, the one file that talks to a chain, the poster, the holder's claim, an integration test against a local chain): a redeem line on the coin log is minted as the Quilt token on Ethereum against a head a bonded poster put on the chain, after a veto window, and a deposit burned on the chain is credited back on the ledger by a reader under the same bond, with the mirror checking every credit.
- **The mirror.** `packages/mirror` and `.github/workflows/mirror.yml`: every fifteen minutes, every chain pulled, verified, refused if it did anything but grow, the coin's balances reproduced, and every head stamped into Bitcoin through OpenTimestamps.
- **The words.** [LAYERS.md](LAYERS.md), the whole protocol in plain words; [PROTOCOL.md](PROTOCOL.md), [APP.md](APP.md), [COIN.md](COIN.md), [OPEN-PROBLEM.md](OPEN-PROBLEM.md), the extension documents, [FIRST-RUN.md](FIRST-RUN.md), `examples/README.md`, and the site under `site/`.
- **The checks.** Every unit test, the conformance run (both implementations' is the maintainers' habit; the reference's runs in the checks) and the contract tests pass on every push (`.github/workflows/ci.yml`); a tagged release builds the executables for five platforms and the bundle (`release.yml`).

## What only the maintainers can do, in order

1. **A home for the code.** Make the GitHub organization and repository, add it as `origin`, push `main`. The checks run on the push. Decide whether the repository is public now or at the first problem; the words are CC0 and the code Apache-2.0 either way.
2. **The maintainers' key.** On a machine the maintainers trust, `quilt init`, and keep the phrase offline: it is the key that signs `hide` events and the first problems. Its address goes into `QUILT_MAINTAINERS`.
3. **A tracker in public.** A host with Docker and the domain's tracker name, `tracker.bitquilt.org` (bitquilt.org was registered on 28 October 2026; its DNS is in Vercel, where the site is served), with TLS in front (a reverse proxy such as Caddy terminates it in one line; `deploy/` holds the compose file and the Caddyfile). Then, as [DEPLOY.md](DEPLOY.md) says:

   ```bash
   docker build -t bitquilt-hosted .
   docker run -d --name bitquilt --restart unless-stopped -p 127.0.0.1:3977:3977 -v bitquilt-data:/data \
     -e QUILT_KEY_SECRET=$(openssl rand -hex 32) -e QUILT_URL=https://tracker.bitquilt.org/ -e QUILT_IP_SALT=$(openssl rand -hex 16) \
     -e QUILT_MAINTAINERS=0x… bitquilt-hosted
   ```

   Keep `QUILT_KEY_SECRET` somewhere safe: every address the tracker hands out is lost without it. Set `QUILT_COIN` from the first day with the parameters below (decided 27 October 2026: the coin is on at launch and transfers with it, as Bitcoin's was); switched on later instead, nothing before it changes.
4. **The bridge, on day one.** Decided 27 October 2026: the Quilt token exists on Ethereum mainnet from the first day, so that an organic market can form. From a wallet the maintainers hold, with Foundry: deploy `contracts/src/Anchors.sol` with the veto multisig's address, the treasury root's address, the bond a poster must hold and the veto window (a week, as the coin vests), then `contracts/src/Quilt.sol` with the Anchors address; bond the poster's key; put both addresses in `QUILT_CONTRACTS`; set `redeem_from` in `QUILT_COIN` to genesis and `reader` to the poster's address, since the same bonded key reads the way back. Run `bitquilt-poster` and `bitquilt-reader` every fifteen minutes on the tracker's host with `QUILT_CHAIN_RPC`, `QUILT_CHAIN_ID`, `QUILT_CONTRACTS`, `QUILT_POSTER_KEY`, `QUILT_READER_KEY` and `QUILT_COIN_HOME` in their environment, and give the mirror the first three so it checks every credit against the chain ([DEPLOY.md](DEPLOY.md), the bridge); the keys live there and never in the repository. A holder's `quilt redeem <amount>` takes coin off the ledger, the next head carries the line, and once the window has passed `bitquilt-claim <line id>` mints it with the proof, the holder paying the gas once; `bitquilt-deposit <amount>` burns the token back and the reader credits the ledger. The contracts have twenty-one tests and no outside audit yet: until one is done, the bond, sized so a false head costs more than it could mint before it is struck, and the veto inside the window are what stand between a wrong head and a wrong mint.
5. **The defaults a release carries.** Two one-line changes once the domain exists: `DEFAULT_CONFIG.trackers` in `packages/client/src/config.ts` from `http://localhost:3977/` to the public tracker, and `DEFAULT_CONFIG.relays` to two public Nostr relays the maintainers choose, so that search reaches announcements on relays and a stranger's Quilt finds the problem with nothing set. The bundle's settings (`scripts/build-mcpb.mjs`) carry the same tracker.
6. **The mirror.** In the repository's settings, the variable `BITQUILT_TRACKERS` set to the public tracker; the workflow then writes the ledger to `main` every fifteen minutes and anchors every head. The repository is the public copy a client falls back to.
7. **The first standing problems.** From the maintainers' machine, with the public tracker in `~/.config/quilt/config.json`: `quilt publish examples/tell-someone.json`, then `quilt seed <hash> on`, and the same for the two waves of twelve patterns each under `examples/` (`docs/candidates/launch-50.json` names both). A gold is backed by the owner's standing, two points a piece where no stake rule applies (one for each root a miss would dock), and a new key has one point, so publish the patterns first without their gold (strip `gold` from the file, or let the tracker refuse it, which leaves the problem published) and bring the gold in with `quilt gold commit` as standing is earned: a second maintainers' key that works accepted pieces on the first key's problems, and the first on the second's, earns a point a square. The patterns' gold answers stay in the files until then.
8. **The release.** `git tag v0.1.0 && git push --tags`: the workflow builds `quilt` and `bitquilt-tracker` for five platforms and `quilt.mcpb`, and attaches them. The Mac app is signed with the Developer ID and notarized by the same workflow's `mac-app` job once the repository's variable `APPLE_SIGNING` is `on` and the six secrets `apps/mac/README.md` names are set; by hand, `QUILT_SIGN_IDENTITY=… bash apps/mac/build.sh` then `scripts/notarize.sh` (28 October 2026). Without them it is signed ad hoc and opens only on the machine that built it.
9. **The site.** Serve `site/` at `bitquilt.org` from Vercel, where the domain's DNS already is (a static deployment of the folder, no build), with its links pointed at the tracker, the release and the first problem's `quilt:` link.
10. **Counsel, beside the launch rather than before it.** The founder decided on 27 October 2026 that transfers are on from genesis, so counsel reads the design as launched; the founder decided the same day that the bridge is live on mainnet on the first day as well (step 4), so counsel and a contract audit read the whole of it beside the launch. Nothing in the first problem needs the chain to be worked.

## The coin's parameters, when the time comes

The parameters, in the units [COIN.md](COIN.md) names, for `QUILT_COIN` on the tracker that will be the coin's home, decided by the founder on 28 October 2026 after [COIN-AUDIT.md](COIN-AUDIT.md):

```json
{ "genesis": "2026-11-01T00:00:00Z", "epoch_h": 24,
  "emission": { "per_epoch": 1000000, "decline_bp": 1250, "period_epochs": 365, "floor_per_epoch": 100000, "max_per_weight": 5000 },
  "vesting_h": 168, "infra_bp": 1000, "treasury": "0x…", "unit": 1000000,
  "weights": { "cross_vendor": 2, "same_vendor": 1, "attest": 0 },
  "burn_rate": 100000, "burn_indexed": true, "window_max_h": 120,
  "transfers_from": "2026-11-01T00:00:00Z", "redeem_from": null }
```

A coin a day of a million units, falling by an eighth each year to a tail of a tenth of a coin a day; a unit of verified weight earning at most 5,000 units an epoch, so a square alone in a quiet day earns a wage and not the day; a week's vesting, longer than any launch pattern's challenge window so a strike can still take back what a fake minted, and short enough that a transfer lags the earning by days (decided 27 October 2026; a year before); no problem admitted whose challenge window is longer than 120 hours, two days inside that week; a tenth to the treasury; a point of standing at the door for what a reveal in a verified cross-vendor square earned the epoch before, never less than a tenth of a coin; transfers on from genesis; redemption off. The draft of 27 October fell by a quarter a year, had no tail and no cap, and priced a point at a thousand units; [COIN-AUDIT.md](COIN-AUDIT.md) says why each changed.

## The stranger's path, to walk before announcing

Rewritten 28 October 2026 from [JOURNEY-AUDIT.md](JOURNEY-AUDIT.md) section 5, with the time each step may take. If any step takes twice its time, or needs a terminal, the launch is not ready.

1. On a phone with the Claude app, open the site. A problem is visibly being worked. Press Get an address. Copy it. In claude.ai, Settings, Connectors, add it. Under two minutes.
2. In a new chat: "Open Quilt and tell me who I am." The address, standing 1, coin 0. Under one minute.
3. "Find me something to do on Quilt." A piece of a launch problem, two questions from the client, a return. Under three minutes.
4. Open the address in a browser. The square is green, standing is 2, the sheet says what is owed and when. Under five minutes from the return, with the standing workers running.
5. On a Mac with Claude Desktop, download the bundle, double-click, say the first sentence. A key is made with no ceremony; its twelve words wait on the page. Under two minutes.
6. Open the Mac app, choose "I have an address on a tracker", paste the phone's address. The same standing and coin, now held at home. Under one minute.
7. The next day, the menu bar's balance is above zero and was lit green when it rose.
8. `quilt open quilt:sha256:…` from a machine with only the repository's mirror reachable resolves the same map from the files on `main`.
