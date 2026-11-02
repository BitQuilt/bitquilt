# Running a public tracker

A tracker is the first place a `quilt:` link resolves. The hosted one, `bitquilt-hosted`, is the reference tracker with the connector mounted beside it: a person who cannot run Quilt opens `/join`, takes an address, and pastes it into their AI's connectors. The tracker signs for them and marks every such event as held in its custody.

One container runs it. This file was written on a machine without Docker, so the first build somewhere is its first test; what it runs, `pnpm --filter @bitquilt/hosted start`, is what the tests run.

## What it needs

| Variable | Required | What it is |
|---|---|---|
| `QUILT_KEY_SECRET` | yes | The secret the hosted keys are encrypted with at rest. Make it once (`openssl rand -hex 32`) and keep it: without it every address the tracker handed out is lost. |
| `QUILT_URL` | yes, in public | The origin the tracker says it is, with a trailing slash, and the one `/join` hands out in addresses: `https://tracker.example.org/`. |
| `QUILT_NAME` | | A name the tracker gives itself at `/.well-known/quilt`. |
| `QUILT_PEERS` | | Other trackers, comma separated, told to clients that ask. |
| `QUILT_IP_SALT` | | A salt for the hashed addresses the rate limits count by. Set one; the hash is all that is ever kept. |
| `QUILT_LIMIT_KEY_HOUR`, `QUILT_LIMIT_IP_HOUR` | | Events an hour per key (120) and per address (600). |
| `QUILT_STAMP_NAME` | | Bits of work a `name` event has to carry; 0 asks for none. |
| `QUILT_MAINTAINERS` | | The addresses whose `hide` events this tracker honours (QX-6), comma separated: a maintainer runs `quilt hide <hash> <why>` to take a problem down from this tracker's pages. Published at the well-known document. |
| `QUILT_FOUNDING_STANDING` | | A founding standing declared per root (QX-1 section 2, amended 29 October 2026), `<address>=<amount>` comma separated: published at the well-known document and counted into those roots' standing from the beginning. The public tracker declares 400 for the maintainers' root, so the launch patterns' gold could be committed. Empty, none. |
| `QUILT_OAUTH_SECRET` | for the witness | The key the authorization server signs its tokens with (QX-18, [ext/QX-18.md](ext/QX-18.md)). Make it once (`openssl rand -hex 32`) and keep it: a new one ends every token handed out, and each product then asks its person to connect again. Unset, there is no OAuth: an address is its own credential, `/mcp` answers 404, and the join page says nothing of the witness. |
| `QUILT_OAUTH_ISSUER` | | The issuer the OAuth metadata names. The tracker's address without its trailing slash unless set (`https://tracker.example.org`); set it only when the tracker answers at a name other than `QUILT_URL`'s. |
| `QUILT_WITNESS_RANGES` | | The address ranges each product publishes for its servers, as one JSON object of product to ranges, such as `{"claude.ai":["160.79.104.0/21"]}`. Unset, the ranges in `packages/hosted/src/products.ts` as read on 1 November 2026. A product with an empty list is witnessed by its key alone, which is how ChatGPT is witnessed. A code sent to a product's callback is refused unless the product redeems it (QX-18 section 3), so when Anthropic moves its range, claude.ai connections here stop with a plain reason until this is updated; the long address goes on working. |
| `QUILT_TRUSTED_PROXIES` | | The proxies whose `X-Forwarded-For` the tracker believes, as ranges, comma separated. Unset, the machine itself and the private networks, which is the compose network Caddy is on. `none` believes no header. The rate limits and the witness's address binding both read the client's address through this (QX-18 section 7). |
| `QUILT_COIN` | | The coin's parameters as one JSON object (QX-17, `docs/ext/QX-17.md` section 1): `genesis`, `epoch_h`, `emission` (with its `floor_per_epoch` and `max_per_weight`), `vesting_h`, `infra_bp`, `treasury`, `unit`, `weights`, `burn_rate`, `burn_indexed`, `window_max_h`, `transfers_from`, `redeem_from`, and `home` where this tracker reads another's coin. Absent, the tracker has no coin log and honours no coin lock. Published at the well-known document; the mirror reads it from there. |

`QUILT_DB` and `QUILT_HOSTED_HOME` are set by the image to paths under `/data`; the volume there is everything the tracker keeps.

## Build and run

```bash
docker build -t bitquilt-hosted .
```

```bash
docker run -d --name bitquilt --restart unless-stopped -p 127.0.0.1:3977:3977 -v bitquilt-data:/data -e QUILT_KEY_SECRET=… -e QUILT_URL=https://tracker.example.org/ -e QUILT_IP_SALT=… bitquilt-hosted
```

Then, from the host:

```bash
curl -s http://127.0.0.1:3977/.well-known/quilt
```

answers with the tracker's name, its routes, and `"hosted": true`.

## The public door

Claude's custom connectors reach a server over HTTPS, so the tracker sits behind a reverse proxy that holds the certificate. With Caddy that is the whole configuration:

```
tracker.example.org {
    reverse_proxy 127.0.0.1:3977
}
```

The MCP transport streams; a proxy that buffers responses or cuts idle connections short breaks it, so leave both off for `/mcp/`.

Every hour the tracker runs the owners' turn for the members whose homes hold a problem or a gold, the first a minute after it starts: the part of `quilt away` that needs no agent (APP.md, "While you're away"). It reveals each member's gold that has come due (QX-16) and sharpens each member's briefs two readings read apart (QX-19 section 4), signed with the key it holds for them and marked `custody: hosted` like everything else it signs for them, and writes a line to the member's `away.log` under `QUILT_HOSTED_HOME`. The sentence a brief lacks comes from the vendor the environment names, Anthropic's where `ANTHROPIC_API_KEY` is set, else OpenAI's where `OPENAI_API_KEY` is, the model `QUILT_SENTENCE_MODEL` or the house's default; the compose file hands the tracker the whole env file, so the house's keys serve. With neither key the turn reveals the gold and sharpens nothing, and the log at start says so. Added 2 November 2026, when a person who runs nothing had no node to do either.

Once the name resolves: open `https://tracker.example.org/join`, take an address, and add it in claude.ai under Settings, Connectors, as a custom connector with no authentication; the address is the credential, and the free plan's one custom connector is enough. With `QUILT_OAUTH_SECRET` set, the tracker is also the authorization server for its addresses (QX-18): add `https://tracker.example.org/mcp` instead, and claude.ai or ChatGPT identifies itself by its own client metadata document, opens the authorization page, where the person pastes their address once, and holds a token for it. The tracker hands the token over only to the product: claude.ai's token request comes from the range Anthropic publishes, and ChatGPT's is signed with the key its document publishes. Every event posted through the token says `via: claude.ai` or `via: chatgpt.com` beside `custody: hosted`, with `via_by` saying which. `curl -s https://tracker.example.org/.well-known/oauth-authorization-server` shows the endpoints, `curl -s https://tracker.example.org/.well-known/quilt` shows under `witness` what the tracker binds, and `curl -si -X POST https://tracker.example.org/mcp` answers 401 with the challenge that names the metadata. The long address goes on working as before, without the mark.

The witness's address binding is only as good as the address the tracker reads. Caddy ignores a client's own `X-Forwarded-*` headers unless its `trusted_proxies` option names the client, and writes the client's address into `X-Forwarded-For` itself; the tracker believes that header only when the connection comes from the compose network, and reads it from the right past every trusted hop (`QUILT_TRUSTED_PROXIES`). Leave Caddy's `trusted_proxies` unset. If another proxy ever sits in front of Caddy, name its ranges in Caddy's `trusted_proxies` and add them to `QUILT_TRUSTED_PROXIES`, so the address read is still the client's and not that proxy's. The join page says where the address goes and the first sentences to say. In a chat, "Open Quilt and tell me who I am" proves the connection and "Find me something to do on Quilt" does the rest, the client asking the person before each write. The same address, opened in a browser, is the person's sheet: standing, coin and what is owed today, what is wanted from them, the sentences to say (`GET <address>` with `text/html` accepted; the data at `<address>/sheet`).

To take a key home, paste the address into the Mac app's "I have an address on a tracker", or run `quilt init --from <address>` on your own machine (it fetches `<address>/key` once), and treat the address as spent.

## The house second opinion

A piece is done when two AIs of different vendors agree ([CORE.md](CORE.md), section 6). Early on, a person's piece can wait weeks for a second vendor to come by, and the loop that makes the place worth coming back to dies in that wait. So the project runs one worker of its own, on the tracker's host, that only ever supplies the second answer: the `house` service in `deploy/docker-compose.yml`, which runs `examples/worker-claude.mjs --second-only --all` (or the OpenAI worker, with `HOUSE_VENDOR=openai`) from the same image as the tracker, every fifteen minutes, as the key named "House second opinion".

What it does: takes a piece in `needs_verify` or `disputed` that has a reading on it, the core's `next` preferring one no reading of which is its own vendor's (CORE.md section 7, step 3), asks its model for its own reading of the brief (with the search and fetch tools, on Claude, so the source the brief names is read), and returns it signed by the house's key and declared `<HOUSE_VENDOR>/<HOUSE_MODEL>`. Where it agrees with the person's AI, the piece is accepted provisionally and the challenge window opens; where it differs, the piece is disputed, and the seam settles itself (QX-19 section 4): a reading that rests on nothing is set aside for one that rests on the record, and two that both rest on it send the owner's node to sharpen the brief. The core counts its reveal like anyone's.

What it does not do: it never takes an open piece, so no first work on the quilt is the house's. It is one reader, and its vendor is a setting: the core keeps a same-vendor pair from making a set and a root from reading a piece twice, and prefers a piece its vendor has not read, so the house refuses nothing on its own account (until 2 November 2026 it refused any piece its own vendor had read, which left every dispute between the two houses' vendors closed to both). Two houses run: `house` on Claude, and `house-openai` on OpenAI with its own key, home and name ("House second opinion on OpenAI"), so a piece first read by either vendor's AI gets its second from the other. Each runs nothing until its key is set. It is not a judge, holds no gold, and has no say beyond its one reveal. The switch is `QUILT_NEXT_ONLY=verify`, read by the client's `next` (`packages/client/src/quilt.ts`): with it set, the pool is those pieces and nothing else, the tracker is asked within it (so a reading it set aside comes back to the house that made it, QX-19 section 4), and when the pool is empty the CLI says there is nothing to verify and claims nothing. The schema the house gives its model says a list's most in words and cuts a longer one, since the vendors' structured shapes refuse `maxItems` (found on 2 November 2026, when the Claude house was refused on every bill with a list field). The worker's `--second-only` sets it for every CLI call it makes, and the worker carries the seams the tracker hands it into its model's question.

| Variable | Required | What it is |
|---|---|---|
| `HOUSE_VENDOR` | | `anthropic` unless set, which runs `examples/worker-claude.mjs` on `ANTHROPIC_API_KEY`; `openai` runs `examples/worker-openai.mjs` on `OPENAI_API_KEY`. |
| `ANTHROPIC_API_KEY` | for the house to run on Claude | The house's key at Anthropic. Empty, the service starts, says so once in its log, and runs nothing. Nothing the service prints carries it, and the CLI it drives is not given it. |
| `OPENAI_API_KEY` | for the second house | The same, at OpenAI, read by the `house-openai` service (and by `house` with `HOUSE_VENDOR=openai`). |
| `HOUSE_OPENAI_MODEL` | | The second house's model (`gpt-6-luna` unless set). |
| `HOUSE_MODEL` | | The model the house answers with (`claude-opus-5-5` unless set; `gpt-6-luna` for OpenAI). The compose file sets `QUILT_MODEL` to `<HOUSE_VENDOR>/<HOUSE_MODEL>`, so the claim declares what the reveal is made with. |
| `HOUSE` | | `on` unless set. `off` switches the house off: the service starts, says so, and runs nothing. |

The compose file sets the rest: `QUILT_TRACKERS` to the tracker on the compose network, `QUILT_HOME` to the volume `house`, where the key is made on the first run and stays, and `QUILT_BIN` to the CLI in the image. The loop is `deploy/house.sh`: `HOUSE_EVERY` (300 seconds, so a stranger's square turns inside the five minutes the stranger's path allows; it was 900 until the walk of 1 November 2026) and `HOUSE_MAX` (20 pieces a run) can be set in the service's environment. A pass with nothing to verify costs one search of the tracker and no call to a model. A stop reaches the loop as SIGTERM, as a deploy that rebuilds the service sends one: the worker finishes the piece in its hands, returns it, and takes no other, and the compose file gives the service ten minutes for that (`stop_grace_period`). Until 2 November 2026 the container was killed ten seconds into a stop, and a claim made just before a deploy stood for its lease with no reading behind it.

To watch it: `docker compose -f deploy/docker-compose.yml logs -f house`. Each run lists the problems with pieces waiting on a second reading, then one line a piece with the answer returned and where the commit and the reveal went, then how many pieces were returned. A run stops at the cap or when the CLI says there is nothing to verify. The cap is 20 pieces a run, three events each, so a full run is 60 events against the tracker's 120 an hour for one key (`QUILT_LIMIT_KEY_HOUR`); two full runs in an hour reach the limit, and the third run's returns are refused and tried again next round. A quiet tracker's runs are small, which is the point.

To switch it off: `HOUSE=off` in `deploy/.env`, then `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d house`. The house is for the first months, while the crowd is thin; once pieces find their second vendor on their own, it goes off and its key stays in the record as what it was.

## The bridge

The coin leaves the ledger by a `redeem` line and is minted on Ethereum as the Quilt token, and comes back by a `deposit` on the contract that a reader credits on the ledger ([COIN.md](COIN.md), the door out). Two contracts, under `contracts/`, and two jobs beside the tracker carry it.

1. **Deploy**, once, from a wallet the maintainers hold, with Foundry: `Anchors` with the veto multisig's address, the treasury root's address, the bond a poster must hold in wei and the veto window in seconds, then `Quilt` with the Anchors address. `forge create` from `contracts/` does each; the addresses go into `QUILT_CONTRACTS`.
2. **Bond** the poster's key by sending the bond to `Anchors.bond()`, and set `redeem_from` in the tracker's `QUILT_COIN` so the ledger takes redeems, and `reader` to the same key's address so it takes that key's credits.
3. **Post**, every anchoring period: `pnpm --filter @bitquilt/coin start` (the `bitquilt-poster` command; no single-file executable is built for it) reads `GET /coin/redeems` from the home, builds the Merkle tree over the redeem lines, and puts the head and the root into `Anchors` when the head is newer than the last posted. It is idempotent, so a cron entry every fifteen minutes is the whole job. The mirror's OpenTimestamps stamp of the same head stands beside it, and anyone can check the one against the other.
4. **Claim**, by a holder: `bitquilt-claim <line id>` with the holder's key in `QUILT_HOLDER_KEY` finds the line under the last posted head, waits for the head to be final, and calls `Quilt.redeem` with the proof. The gas is the holder's, once.
5. **Deposit**, by a holder: `bitquilt-deposit <amount> [root]` burns that much of the holder's token on the chain for the ledger root named, the holder's own address when none is.
6. **Read**, every anchoring period beside the poster: `bitquilt-reader` reads the deposits as of the chain's finalized block and posts a signed `credit` on the coin log for each not credited yet. The mirror, given the chain's address and the contracts, checks every credit against the deposit the chain holds and keeps no balances where one differs; without them it refuses a ledger with credits on it.

| Variable | Required | What it is |
|---|---|---|
| `QUILT_CHAIN_RPC` | for the poster and a claim | The chain's RPC address. |
| `QUILT_CHAIN_ID` | for the poster and a claim | The chain id (1 for Ethereum mainnet). |
| `QUILT_CONTRACTS` | for the poster and a claim | `{"anchors":"0x…","quilt":"0x…"}`, the two contracts' addresses. |
| `QUILT_POSTER_KEY` | for the poster | The bonded poster's private key, hex. On the tracker's host and nowhere else; nothing the job prints carries it. |
| `QUILT_READER_KEY` | for the reader | The reader's ledger key, hex, the same key as the poster's: what the `credit` lines are signed with. |
| `QUILT_HOLDER_KEY` | for a claim | The holder's private key, hex, on the holder's own machine. |
| `QUILT_COIN_HOME` | for the poster, the reader and a claim | The home tracker's address, with a trailing slash. |

The mirror reads `QUILT_CHAIN_RPC`, `QUILT_CHAIN_ID` and `QUILT_CONTRACTS` too, and needs no key.

A false head is bonded, not proven: the veto address can strike it within the window and the poster's whole bond goes to the treasury, and a vetoed sequence is posted again. The bond is sized so that a false head costs more than it could mint before it is struck.

## Keeping it

- **Back up `/data`.** It holds the chain, the names, the announcements and the encrypted keys. Copy the volume; a tracker restored from a copy is behind by what came after it, and clients that kept their receipts will show the difference.
- **Mirror it.** The mirror job (`.github/workflows/mirror.yml`) pulls from the trackers named in the `BITQUILT_TRACKERS` variable every fifteen minutes and refuses a chain that did anything but grow. Run by hand, `bitquilt-mirror` reads `BITQUILT_TRACKERS`, `BITQUILT_MIRROR` (the folder), `BITQUILT_CALENDARS` and `BITQUILT_ANCHOR`, or the flags of the same names, and the three chain variables above when the coin log carries credits. Point it here and the repository becomes the public copy, served raw, that a client falls back to when the tracker is down.
- **Close it.** The hosted keys are only as safe as `QUILT_KEY_SECRET`; rotate it by exporting the keys first, since the ciphertext does not survive a change. The rate limits are the only brake on a crowd; `QUILT_STAMP_NAME` adds a cost to names when that is not enough.
- **Count it.** `GET /counts?days=<n>` (30 when none is given, at most 365) is the launch funnel by the UTC day, naming nobody: addresses made, first used and taken home; keys whose first event was here, hosted apart from own; claims, reveals, sets accepted and squares verified; every day of the window and the totals over it. It holds nothing but counts, so it is public. The first-used and taken-home columns are filled by the two marks in `packages/tracker/src/store.ts` (`markMemberUsed` at a member's first tool call, `markMemberKeyTaken` when `/key` is read); the rest is read from the receipts and the layer on request.
