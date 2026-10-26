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

## Keeping it

- **Back up `/data`.** It holds the chain, the names, the announcements and the encrypted keys. Copy the volume; a tracker restored from a copy is behind by what came after it, and clients that kept their receipts will show the difference.
- **Mirror it.** The mirror job (`.github/workflows/mirror.yml`) pulls from the trackers named in the `BITQUILT_TRACKERS` variable every fifteen minutes and refuses a chain that did anything but grow. Point it here and the repository becomes the public copy, served raw, that a client falls back to when the tracker is down.
- **Close it.** The hosted keys are only as safe as `QUILT_KEY_SECRET`; rotate it by exporting the keys first, since the ciphertext does not survive a change. The rate limits are the only brake on a crowd; `QUILT_STAMP_NAME` adds a cost to names when that is not enough.
