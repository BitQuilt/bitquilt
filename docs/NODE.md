# The node

This document says how the reference code runs: one program with roles over one store, the keeper's pull, and the mirror job. It describes the reference implementation's layout, not the protocol. A second implementation may be shaped any way it likes, so long as what it admits, serves and keeps is what [CORE.md](CORE.md) and the extensions say. The rules it rests on are cited, not restated: [QX-11](ext/QX-11.md) is the chain every store keeps, [QX-21](ext/QX-21.md) the door's pull of its peers, and [QX-12](ext/QX-12.md) the anchor. [LAYERS.md](LAYERS.md) tells the same in one paragraph, and [WORKSHOP.md](WORKSHOP.md) section 2 is the plan it was built from.

## 1. Roles

A node is one program, `start({ home, roles })` in `packages/node/src/node.ts`, and its roles say what it does.

| Role | What it is | What it starts |
| --- | --- | --- |
| `admit` | Being a door | The reference tracker over the store (`createTracker`), listening at the door's port, with its pull of the peers' chains (QX-21) |
| `work` | Signing with the home's key | A Quilt over the home's key (`loadKey`) and its page on localhost (`createPage`), which the connector works through ([APP.md](APP.md), "One node per home") |
| `keep` | Keeping copies of other places' chains | Without a door, the mirror's pull over the store (section 5). Beside `admit` it adds nothing, since the door's pull of its peers is how a door keeps, and the door's layer says what it admits. |
| `host` | Custody for people who cannot run one | The hosted on-ramp mounted beside the door (`createHosted`), with the owners' turn |

`start` refuses a word that is not a role, `host` without `admit` (custody is custody at a door), `admit` without a door's port and address, and `host` without the secret its keys are encrypted with.

A tracker is a node with `admit`. A mirror is a node with `keep`, with the files it publishes written beside (section 6). A person's Quilt is a node with `work`. The public tracker is a node with `admit` and `host`. These name roles and not programs: `bitquilt-node` starts a node with any of them, and section 7 names the programs that do the same over their own stores.

## 2. The one store

A node has one store: the tracker's (`Store`, `packages/tracker/src/store.ts`), a SQLite file at `<home>/node.db`, or at the path `store` names where a door kept a database before. Every role works over it. The door appends what it admits (`appendReceipt`) and what it pulls from a peer (`appendPulled`). The resolver keeps in it and serves from it, since the node hands it the store as its `Chains`. The keeper appends what it pulls (`appendLines`). So what the door admits is what the node serves and keeps, and a line on the node's chain is a line whether a door or a keep wrote it.

What keeping needs of a store is seven methods. The shape is written in two places and shared as a shape, not an import, since the client imports the core alone and the mirror does not import the client: `Chains` in `packages/client/src/chains.ts`, which adds `held`, and `KeptStore` in `packages/mirror/src/files.ts`.

| Method | What it does |
| --- | --- |
| `envelopeOf(hash)`, `putEnvelope`, `listEnvelopes` | The envelopes held, by hash |
| `getBlob(hash)`, `putBlob` | The blobs held, by hash: a problem's data, and the reads a trace names (QX-19) |
| `lines(log)` | Every line of a log, the whole of it, oldest first |
| `appendLines(log, lines)` | Lines after the ones held, as given; the caller has checked that they grow the log |

Three stores answer them:

- **`Store`**, the tracker's SQLite, which a node keeps in.
- **`FileChains`**, the files under a home's `cache/`: `sha256-<hex>.json` an envelope, `ledger/sha256-<hex>.jsonl` a problem's chain, `identity.jsonl` the identity log, `blobs/sha256-<hex>` a blob. A Quilt not started by `bitquilt-node` (`quilt serve`, `quilt mcp`) keeps in these. A name carries no colon, so a Windows file system lists what it holds.
- **`MirrorFiles`**, the mirror's layout under its folder (section 6).

A log is named by a hash, and each is a chain as QX-11 says: a problem's by the problem's hash, the identity log by `IDENTITY_LOG`, the coin log by `COIN_LOG`.

## 3. The loops

`start` runs three loops, unless `loops` is false, as the tests ask. Each runs one at a time: a turn still running when the next comes round is left to finish.

| Loop | For | Every | First |
| --- | --- | --- | --- |
| The keep | `work`: a Quilt's keep (section 4). `keep` without a door: the mirror's pull over the store, from the sources (section 5) | Half an hour (`KEEP_EVERY_MS`, `packages/client/src/resolver.ts`) | Two minutes after start |
| The peers' pull | `admit` with peers (QX-21 section 2, `schedulePeerPulls`) | Five minutes | A minute after start |
| The owners' turn | `host`: for each member whose home holds a problem or a gold, the gold that is due revealed (QX-16), the briefs two readings read apart sharpened (QX-19 section 4), the member's problems announced again where the work on them moved (QX-13 section 3), and the member's keep (`ownerTurn`, `packages/client/src/away.ts`) | An hour | A minute after start |

`node.keep()` runs one keep now: a Quilt's keep, the mirror's pull where the node has `keep` and no door, and the peers' pull where it has a door.

## 4. The keeper in a Quilt

`Resolver.keep()` (`packages/client/src/resolver.ts`) keeps what a home has touched whole and current:

1. It sends the queue first: the events written while no tracker answered ([APP.md](APP.md), "The node").
2. For every problem the home holds, it reads the chain again from the places known for it, in order (`places`): the trackers the library names for it, the config's trackers, the ones the relays named this session, then the mirrors the config and the relays name. It keeps the first place's chain that verifies and only grows the one kept (QX-11 section 5). A Quilt follows one place's chain per log. Each chain it reads that did not only grow the one kept is noted among the chains refused. Where none grows it, the first that verifies is read and not kept.
3. It fetches the reads the chain's traces name, under their hashes (QX-19).
4. It keeps the identity log the same way, from one place: the first whose log verifies and only grows the one kept. The places are the trackers named for the problems it holds, then the config's trackers, the relays', and the mirrors, in the order of step 2. Another place's identity events are kept only where its log grows the one kept, so a Quilt's identity log is one place's log and not the union of the trackers'.

It reports the problems held, the lines added, the reads fetched, the events sent, and the chains refused for not only growing (`KeepReport`). The page runs it every half hour while it is up, unless the node runs its own loop and says `keep: false`. Every owner's turn runs it once an hour: `quilt away`'s turn on a person's machine and the on-ramp's for each member. `quilt keep` runs it once.

What a Quilt holds, its page serves on localhost: `GET /held` lists each problem held with how many lines of its chain are held, beside `/p/<hash>`, `/p/<hash>/events`, `/k/events` and `/b/<hash>`, and the page's well-known document says `node: true`. A mirror or another node learns from these what to pull, with no tracker between.

## 5. The keeper over a store

`keep({ store, sources })` in `packages/mirror/src/mirror.ts` is the pull a node with `keep` and no door runs over its store, and the mirror job runs over its files. In order:

1. **The sources, in order.** Each source's well-known document is read. A node (`node: true`) is read by its `/held`, and a tracker by its index at `/`. Each configured source's peers, as its well-known names them, are followed one hop as sources of their own, unless `peers` is false. They are read after the configured sources, in the order they were found (`pull`). A keeper pointed at one tracker holds every problem that tracker and the peers it names list. A source whose list cannot be read, with no index at `/` or, for a node, no `/held`, is passed over whole: nothing is taken from it that run, not its problems, its identity log or its coin log, and the report's errors say `no index`. A configured source's peers are followed all the same.
2. **Each problem from one source a run.** A source's problems are taken in the order it lists them, and a problem already taken this run from an earlier source is passed over (`takeProblem`). The envelope is checked against its hash and its owner's signature, and each blob against its hash. The chain is read whole along `x-quilt-next-since`, at most ten thousand pages, and verified from the problem's hash (QX-11 section 5). A problem that fails a check is refused with the reason, one whose chain cannot be read whole is passed over, and nothing of either is kept; a later source that lists it is tried in turn. So in a run each problem is taken from the first source, in order, that gives it and whose envelope, blobs and chain check.
3. **The events the store lacks.** From the chain of the source the problem is taken from, every event the store lacks, by id, whose shape and signature hold, is appended in that source's order, with the source's wrappers kept and the keeper's own added (`by` and `at`); one that does not check is refused with its id (`takeChain`). The store's chain only grows. It gains another source's events on a problem only in a run where no source read before that one gave the problem, so a keeper whose first source gives a problem every run takes that source's events on it and no other's. A door's pull refuses what its layer refuses; the keeper refuses only what does not check, since it keeps facts and judges none of them (QX-21 section 7).
4. **What a source stopped listing.** After a source's listed problems, each problem held here that no source so far this run has listed or served is asked of it by hash, and taken where it serves it (`takeHeld`), since a problem hidden or replaced at its source leaves the index and not the door. One not taken this run stays as it is held (`kept` in the report).
5. **The reads.** The reads a chain's traces name are fetched under their hashes where they are not held. One that does not hash right is refused and not written.
6. **The identity log**, from every source that lists its problems, in turn, the same way (`takeIdentity`). No source is passed over for an earlier one, as a problem is. Its chain gains each event such a source holds and the store lacks, so it is the union of those sources' identity logs, less a log that cannot be read whole or does not verify and an event that does not check.
7. **The coin log**, from a source that lists its problems, where `coin` is not false and the source's well-known says it is the coin's home. It is copied whole and refused where it did anything but grow, since a coin log is one sequence and a union of two is neither (QX-17). A node's keep leaves the coin out (`coin: false`); the mirror job takes it and checks its balances (section 6).

The wrapper the keeper adds says `by`: the mirror's says `mirror` unless `BITQUILT_MIRROR_BY` names it, and a node's says its door's address, else the `by` it was started with, else `node`. `bitquilt-node` always reads a door's address, `QUILT_URL`, or `http://localhost:<port>/` where it is unset, so a node that keeps without a door names itself with `QUILT_URL`.

## 6. The mirror job

`mirror()` is the same pull over `MirrorFiles` in its folder, with the publication written after it. The folder is what a client reads raw with `mirrors` in its config, and what `bitquilt-verify` (`packages/core/src/verify.ts`) takes with a hash to check the chain, every signature and the envelope, run the reducer and print the map: clone and compute, with no trust in any site.

```
problems/<hash>.json             the envelope
blobs/<hash>                     the data blobs, and the reads a trace names (QX-19)
ledger/<hash>.jsonl              a problem's chain: the events of each source it was taken from, in the order they came (section 5)
ledger/identity.jsonl            the identity log, chained from the hash of quilt:identity
ledger/coin.jsonl                the coin log, chained from the hash of quilt:coin, copied whole (QX-17)
names/<owner>/<slug>             the latest version hash, from the owner's own version events
outputs/<hash>/output.json       the assembled output, with its hash beside, where the reducer says complete
outputs/<hash>/record.json       the record document, with record_hash beside, where the layer calls a record problem complete (QX-20 section 4)
keys.json                        each address's latest name and the delegations in force, folded from the identity log
index.json                       every problem held: its title, slug, owner, the source it came from, and the hides on it (QX-6)
coin/balances.json               the balances the coin's home published, kept only where they reproduce here
anchors/<problem>/<seq>.ots      the OpenTimestamps stamp of each chain's head, with a .json beside it (QX-12)
```

There is no head file: a chain's head is its ledger file's last line (QX-11 section 4).

**The coin's balances.** The mirror recomputes every balance from the receipts it holds and the parameters the home publishes, with the tracker's own layer code (`challengeLayer`, `coinLayer`), so what it checks is the receipts and the head and not the arithmetic. It keeps the home's balances only where its own agree, and only where every `credit` line is what the chain holds at that deposit (`DepositReader`, QX-11 section 7). A credit that is not what the chain holds is refused, and the run exits 1. With no chain to ask, credits on the ledger are no refusal of their own. Where the balances reproduce, the run writes none of them, its report says why (`notKept`), and a run that refuses nothing else still commits the coin log, the problems and everything else it took. Balances that do not reproduce are refused with a chain or without one, as below, since saying so needs no chain. A head that moved between the reads of the coin log and of `/coin/state`, or a `/coin/state` that cannot be read, is left for the next run: no balances are written, and no reason is given. The check runs when the coin's home is read, over the problems taken so far that run, with their chains and the identity log as the store holds them then. What the mirror folds can differ from what the home folded in three ways. It can hold more: a problem the home does not hold, taken from a source read before the home; events on a problem the home holds, taken from another source in a run where that source gave the problem first (section 5, step 3); and identity events another source holds and the home does not, which every run takes (section 5, step 6). It can hold less. A problem both hold, taken this run from a source read before the home, can lack the home's events that source does not have: ones it has not pulled yet, or, at a door, ones its layer refused. A problem the home holds is left out of the fold where the mirror had not taken it by the time it read the home: where the home's chain for it could not be read whole or was refused, or where the home does not list it and the store never held it, so section 5, step 4 does not ask for it. And where it holds the same events, it folds them over its own chain and not the home's. QX-1 section 4 seeds a challenge's panel from the hash of its line on the tracker that first received it. The layer (`challengeLayer`) reads that hash from the challenge's line in the chain it folds, and a judge piece's panel the same way from its first candidate's line (verifiers.md section 2). At the mirror that line is the mirror's own, with the mirror's own hash (section 5, step 3), so the mirror's fold draws from another seed and can seat another panel: a verdict from a seat the home drew can count on no seat there, and a challenge the home decided can stay open there or be decided otherwise. The coin layer reads the accepted sets and the coin locks' forfeits and restores that follow from an outcome, so the balances can differ. A difference from any of these is the rule working and not a fault: the mirror keeps none of the home's balances that run, names the first root that differs among what it refused, and exits 1 (`takeCoin`, `reproduceBalances`). The mirror's line for a challenge does not change once kept, so a difference from the draw can recur on every later run, and while it does `main` grows no further.

**The binary.** `bitquilt-mirror` (`packages/mirror/src/bin.ts`) reads its flags or the variables of the same names: `BITQUILT_TRACKERS`, `BITQUILT_MIRROR`, `BITQUILT_MIRROR_BY`, `BITQUILT_PEERS`, `BITQUILT_CALENDARS` and `BITQUILT_ANCHOR`. With `QUILT_CHAIN_RPC`, `QUILT_CHAIN_ID` and `QUILT_CONTRACTS` set, it opens the chain to check the credits. Without them it checks none. Where the coin log holds a credit, the balances reproduce and the head did not move, it prints a `coin:` line that says why they are not kept. It exits 1 when anything is refused, so a job notices.

**The repository's job.** `.github/workflows/mirror.yml` runs every fifteen minutes, and by hand, against the sources in the repository's `BITQUILT_TRACKERS` variable, and is skipped while the variable is empty. It runs the binary with `--anchor` into `mirror/` at the root and commits what changed to `main`. A run that exits 1 fails the job, and its commit step does not run. The job sets none of the chain's variables. Once the coin log holds a credit, the credits refuse nothing, so a run that refuses nothing else commits the coin log and everything else, and `coin/balances.json` stays as the last run that kept balances wrote it, at the head it names.

## 7. The programs

`bitquilt-node` is the node from the environment. The other programs are their own programs and do not call `start`, since the node imports their packages and none of them imports the node; each does over its own store what the roles beside it do.

| Program | Package | What it starts | Its store | Roles it matches |
| --- | --- | --- | --- | --- |
| `bitquilt-node` | `packages/node` | `start` with the roles in `QUILT_ROLES`, `admit,keep` unless set | `QUILT_HOME/node.db`, or `QUILT_DB` | Any |
| `bitquilt-tracker` | `packages/tracker` | The tracker, and the peers' pull | `QUILT_DB`, `./quilt-tracker.db` unless set | `admit` |
| `bitquilt-hosted` | `packages/hosted` | The tracker with the on-ramp mounted, the peers' pull, and the owners' turn every hour | `QUILT_DB` | `admit`, `host` |
| `quilt serve` | `packages/client` | The page, with its keep every half hour | The home's files (`FileChains`) | `work` |
| `quilt mcp` | `packages/client` | The connector over stdio, working through the node of the same home where one holds the page's port, and starting the page itself where none does | The home's files | `work` |
| `bitquilt-mirror` | `packages/mirror` | One run of the mirror job (section 6) | Its folder (`MirrorFiles`) | `keep`, with the coin log and the publication |

The compose file runs `bitquilt-node` for both doors on the host: `admit,host` for the public tracker and `admit` for the second, each with `QUILT_HOME=/data` over the store at `QUILT_DB`, which the image sets to `/data/tracker.db` (`deploy/docker-compose.yml`). The image's own command, where nothing names another, is `bitquilt-hosted` (`Dockerfile`). The repository's mirror job runs `bitquilt-mirror`. `quilt serve` and `quilt mcp` stay programs of their own because the client imports the core alone.

## 8. What each role reads from the environment

`bitquilt-node` (`packages/node/src/bin.ts`) reads these; `.env.example` lists every name with the program that reads it.

- **The node.** `QUILT_HOME`, its folder (`./quilt-node`); `QUILT_ROLES`, comma separated (`admit,keep`); `QUILT_DB`, the store where a door kept a database before; `QUILT_SOURCES`.
- **`admit`.** The tracker's names, read by `packages/tracker/src/env.ts`: `QUILT_PORT`, `QUILT_HOST`, `QUILT_URL`, `QUILT_NAME`, `QUILT_PEERS`, `QUILT_IP_SALT`, `QUILT_LIMIT_KEY_HOUR`, `QUILT_LIMIT_IP_HOUR`, `QUILT_STAMP_NAME`, `QUILT_MAINTAINERS`, `QUILT_FIRST_SEEDER`, `QUILT_FOUNDING_STANDING`, `QUILT_COIN` and `QUILT_TRUSTED_PROXIES`. [DEPLOY.md](DEPLOY.md) says what each is.
- **`work`.** The key and `config.json` in `QUILT_HOME`, with `QUILT_TRACKERS`, `QUILT_RELAYS`, `QUILT_PORT_PAGE`, `QUILT_MODEL` and `QUILT_AWAY` over the config (`loadConfig`, `packages/client/src/config.ts`). The Quilt it starts reads two more as it works. `QUILT_READS`, `public` for a Quilt many people share, puts what it fetches on a stranger's word behind the guard, so no hop reaches a private or loopback address (`shared`, `packages/client/src/public-fetch.ts`). `QUILT_NEXT_ONLY`, `verify` for a second reader, has `next` take only a piece in `needs_verify` or `disputed` with a reading on it (`pool` in `packages/client/src/quilt.ts`).
- **`keep`.** `QUILT_SOURCES`, else the door's peers (`QUILT_PEERS`) and the config's trackers; and `QUILT_URL` for the wrapper it adds (section 5).
- **`host`.** `QUILT_KEY_SECRET`, required; `QUILT_HOSTED_HOME`, the members' homes, under `QUILT_HOME/hosted` unless set; `QUILT_OAUTH_SECRET`, `QUILT_OAUTH_ISSUER` and `QUILT_WITNESS_RANGES` for the witness (QX-18); `QUILT_RELAYS` for the members' Quilts; and, for the owners' turn, `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` with `QUILT_SENTENCE_MODEL` (`packages/hosted/src/sentence.ts`). Where `QUILT_READS` is unset, a node with `host` sets it to `public`, since it fetches a trace's pages on a stranger's word.

## 9. Tests

- `packages/node/test/node.test.ts`: a node with `admit`, `work` and `keep` publishes through its own door and serves the same lines from its page, over the one store; a second with `admit` and `keep`, naming the first as its peer, folds the first's readings through its own door; `keep` alone pulls over its own store with the source's wrapper and its own, and a second keep adds nothing; `work` alone keeps what it opens in its own store; `host` is a role beside `admit` with its key secret; and a word that is not a role is refused.
- `packages/node/test/bin.test.ts`: `bitquilt-node` starts a door with nothing on stderr.
- `packages/node/test/doc.test.ts` holds this document to the code: its roles are the node's, each program it names is a package's, the doors the compose file runs are the node with the roles section 7 names, and each name it reads from the environment is in `.env.example`.
- `packages/coin/test/arrows.test.ts`: outside the tests, no package's code but the node's imports the node, so no program but `bitquilt-node` can call `start` (section 7).
- `packages/client/test/keep.test.ts`: a Quilt's keep, from the queue sent first to the identity log, which it keeps from one place as it keeps a problem's chain; `chains.test.ts`: the home's file names; `node-table.test.ts`: the routes a Quilt's page serves as a node (section 4), held to PROTOCOL.md's table of them.
- `packages/mirror/test/mirror.test.ts`: the layout, a chain that only grows, a second tracker's events taken in a run of its own onto the chain the first gave, the pages with no end, the anchors, the record document, a node read by its held list, and the peers followed one hop. `sources.test.ts`: a problem taken from the first source that gives it in a run, run after run, and from the next where the first cannot be read whole; the identity log from every source that lists its problems; a source whose list cannot be read passed over whole; and a problem its source hid or replaced before any run took it, whether no run listed it or one listed it and passed it over, not taken until the store holds it and asks for it by hash (section 5, step 4). `coin.test.ts`: the balances kept only where they reproduce, none of them where a problem the home holds was not taken by the time the home was read, every credit checked against the chain, and with no chain to ask the balances left out while the credits refuse nothing. `seed.test.ts`: the mirror's own chain seeds another draw, so a challenge the home decided can stay open in the mirror's fold (section 6). `bin.test.ts`: `bitquilt-mirror` exits 0 where it refused nothing, as where the coin log holds a credit and no chain is named, and 1 where it refused anything, and the repository's job commits only after the mirror's step succeeded (section 6).
- `packages/tracker/test/peers.test.ts`: the door's pull (QX-21 section 6).
