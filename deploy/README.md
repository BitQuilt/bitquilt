# The public tracker's host

One small virtual machine with Docker (two cores and two gigabytes are plenty to start), reached at `tracker.bitquilt.org`, running the hosted tracker behind Caddy. The site is not here: it is a static deployment of `site/` on Vercel at `bitquilt.org`, where the domain's DNS lives. What this folder holds: the compose file (the tracker built from this repository, and Caddy), the Caddyfile (TLS for the name, every request to the tracker, streaming left alone), and the names of the environment the tracker reads.

In order, on a fresh host:

1. In Vercel's DNS for bitquilt.org, an `A` record `tracker` pointing at the host's address. Caddy fetches the certificate once the name resolves.
2. Docker installed (`curl -fsSL https://get.docker.com | sh`), and the repository cloned with a read-only deploy key or a fine-grained token, since it is private: `git clone https://github.com/BitQuilt/bitquilt.git /srv/bitquilt`.
3. `cp deploy/env.example deploy/.env` and fill it in: the key secret made once with `openssl rand -hex 32` and kept in two places, the salt, the maintainers' address, the coin's parameters from `docs/LAUNCH.md` with a genesis a day or two ahead. The file stays on the host.
4. `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`, then `curl -s https://tracker.bitquilt.org/.well-known/quilt` answers with `"hosted": true` and the coin's parameters.
5. Back up the volume `data` nightly, encrypted, apart from the key secret (`docs/DEPLOY.md`, Keeping it).
6. The repository's variable `BITQUILT_TRACKERS` set to `https://tracker.bitquilt.org/`, which starts the mirror; the defaults in `packages/client/src/config.ts` and `scripts/build-mcpb.mjs` set to the same, then the release tag.

A new version: `git pull` and the same `up -d --build`; the volume stays. The tracker refuses a problem whose challenge window is longer than `window_max_h` in the coin's parameters, and admits everything else the gate and the limits allow.
