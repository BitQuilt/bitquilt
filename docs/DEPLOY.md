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
| `QUILT_COIN` | | The coin's parameters as one JSON object (QX-17, `docs/ext/QX-17.md` section 1): `genesis`, `epoch_h`, `emission`, `vesting_h`, `infra_bp`, `treasury`, `unit`, `weights`, `burn_rate`, `transfers_from`, `redeem_from`, and `home` where this tracker reads another's coin. Absent, the tracker has no coin log and honours no coin lock. Published at the well-known document; the mirror reads it from there. |

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

Once the name resolves: open `https://tracker.example.org/join`, take an address, and add it in claude.ai under Settings, Connectors, as a custom connector with no authentication; the address is the credential. In a chat, "open quilt:… and take a piece" does the rest, the client asking the person before each write.

To take a key home, open the address with `/key` after it once, run `quilt init --secret <hex>` on your own machine, and treat the address as spent.

## The bridge

The coin leaves the ledger by a `redeem` line and is minted on Ethereum as the Quilt token ([COIN.md](COIN.md), the door out). Two contracts, under `contracts/`, and one job beside the tracker carry it.

1. **Deploy**, once, from a wallet the maintainers hold, with Foundry: `Anchors` with the veto multisig's address, the treasury root's address, the bond a poster must hold in wei and the veto window in seconds, then `Quilt` with the Anchors address. `forge create` from `contracts/` does each; the addresses go into `QUILT_CONTRACTS`.
2. **Bond** the poster's key by sending the bond to `Anchors.bond()`, and set `redeem_from` in the tracker's `QUILT_COIN` so the ledger takes redeems.
3. **Post**, every anchoring period: `pnpm --filter @bitquilt/coin start`, or the `bitquilt-poster` executable, reads `GET /coin/redeems` from the home, builds the Merkle tree over the redeem lines, and puts the head and the root into `Anchors` when the head is newer than the last posted. It is idempotent, so a cron entry every fifteen minutes is the whole job. The mirror's OpenTimestamps stamp of the same head stands beside it, and anyone can check the one against the other.
4. **Claim**, by a holder: `bitquilt-claim <line id>` with the holder's key in `QUILT_HOLDER_KEY` finds the line under the last posted head, waits for the head to be final, and calls `Quilt.redeem` with the proof. The gas is the holder's, once.

| Variable | Required | What it is |
|---|---|---|
| `QUILT_CHAIN_RPC` | for the poster and a claim | The chain's RPC address. |
| `QUILT_CHAIN_ID` | for the poster and a claim | The chain id (1 for Ethereum mainnet). |
| `QUILT_CONTRACTS` | for the poster and a claim | `{"anchors":"0x…","quilt":"0x…"}`, the two contracts' addresses. |
| `QUILT_POSTER_KEY` | for the poster | The bonded poster's private key, hex. On the tracker's host and nowhere else; nothing the job prints carries it. |
| `QUILT_HOLDER_KEY` | for a claim | The holder's private key, hex, on the holder's own machine. |
| `QUILT_COIN_HOME` | for the poster and a claim | The home tracker's address, with a trailing slash. |

A false head is bonded, not proven: the veto address can strike it within the window and the poster's whole bond goes to the treasury, and a vetoed sequence is posted again. The bond is sized so that a false head costs more than it could mint before it is struck.

## Keeping it

- **Back up `/data`.** It holds the chain, the names, the announcements and the encrypted keys. Copy the volume; a tracker restored from a copy is behind by what came after it, and clients that kept their receipts will show the difference.
- **Mirror it.** The mirror job (`.github/workflows/mirror.yml`) pulls from the trackers named in the `BITQUILT_TRACKERS` variable every fifteen minutes and refuses a chain that did anything but grow. Point it here and the repository becomes the public copy, served raw, that a client falls back to when the tracker is down.
- **Close it.** The hosted keys are only as safe as `QUILT_KEY_SECRET`; rotate it by exporting the keys first, since the ciphertext does not survive a change. The rate limits are the only brake on a crowd; `QUILT_STAMP_NAME` adds a cost to names when that is not enough.
