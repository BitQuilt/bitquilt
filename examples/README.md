# Trying it

A tracker, a problem, and your AI as a worker, all on one machine.

```bash
pnpm install
QUILT_DB=/tmp/quilt-tracker.db pnpm --filter @bitquilt/tracker start   # a tracker at http://localhost:3977/
```

In another shell, with `QUILT_HOME` pointing somewhere you like (the default is `~/.config/quilt`):

```bash
pnpm --filter quilt start init                       # a key; the phrase is shown once
pnpm --filter quilt start publish examples/first-pattern.json
pnpm --filter quilt start open quilt:sha256:…        # the link the publish printed
pnpm --filter quilt start serve                      # the page at http://localhost:3978/
```

`examples/first-pattern.json` is three statements about the core, for a first run. `examples/bitcoin-paper.json` is sixteen statements about the Bitcoin white paper, a real public document that anyone can find by its title: a pattern for an AI and a person at the page to agree on, statement by statement, with the paper the only evidence.

`examples/tell-someone.json` is the app's own standing problem, its promotion, as twenty `attest` pieces ([docs/ext/verifiers.md](../docs/ext/verifiers.md), QX-10). A person's AI is handed one, the person tells someone about BitQuilt in their own name, and the AI hands back the record: whom they told, named by a public role only, how, on what day, what was said, and what came back. Quilt sends nothing. The record is signed with the member's key and accepted at once as their own word, the square marked attested, the weakest kind, and anyone with a ground to show can challenge it for three days. The brief and every field pass the plain-text gate: no contact details, no links, no handles, so the ledger names roles and never people. The core reads these pieces as `unknown`; the reference tracker's layer decides them, and `quilt next` says the kind and its weakness before the brief.

To let Claude Code or Claude Desktop be the worker, add the connector as an MCP server that starts over stdio:

```bash
claude mcp add quilt -- pnpm --filter quilt --dir /path/to/bitquilt start mcp
```

or in Claude Desktop's configuration:

```json
{ "mcpServers": { "quilt": { "command": "pnpm", "args": ["--filter", "quilt", "--dir", "/path/to/bitquilt", "start", "mcp"] } } }
```

With the executable, one command writes the same entry, pointing at itself and at the key in `QUILT_HOME`. Claude Desktop keeps that file in memory while it runs and writes it back whole when it quits, so quit Claude first (Cmd+Q on a Mac), then:

```bash
quilt install claude
```

and open Claude again.

Or install the bundle. `pnpm build:mcpb` builds `dist/quilt.mcpb`, an MCP Bundle (Anthropic's extension format, a zip of the connector and a manifest), and a tagged release attaches one. Double-click it and Claude Desktop shows its install dialog: no config file, no restart, and the app runs it on the Node it ships with, so the one file serves every platform. The bundle declares `anthropic/claude` as the model and asks for the trackers as a setting; the key it signs with stays where `quilt init` put it, under `QUILT_HOME` (`~/.config/quilt` unless set), so make one there first if there is none. `quilt install claude` remains for the config file.

Then, in the chat: "open quilt:sha256:… and take a piece". Your client asks you before the claim is written and before the return is handed back. A second production from a different vendor, or from you as a person at the page, accepts the piece.

## One node per home

Claude Desktop starts a copy of quilt for its connector, the menu-bar app starts one for the page, and `quilt serve` is a third. A copy that starts asks the page's port (`port` in the config, 3978 unless set) whether a node signing with this home's key is already there; if so it works through that node, so one process signs and one writes the library, and it holds no page of its own. If not, or when that node goes away, it works alone. The log on stderr says which: "works through the node at …" or "quilt page at …". A node on the port with another key is another home's, and the copy works alone without the page, which is what the demo's several homes do on their several ports.

## Keeping a problem, and something to do

`quilt seed <problem> on` posts a seed event: the key is then a seeder, offered the problem's watch pieces first, and the problem sits in the client's standing list. `quilt next` with no problem named asks the standing list first and then each tracker's offer, which orders the tracker's problems reciprocal first (the problems of people who have worked yours), rarest next, every tenth a newcomer's. The page has the same two doors.

## Found on relays

With `relays` in the config, or `QUILT_RELAYS`, a publish also posts its announcement to those Nostr relays as a signed event of its own, and `quilt search` asks the relays beside the trackers, so a problem is found by its name with no tracker in the way. A result from a relay carries the trackers the announce named as the place to open it.

## A worker with no person

Any model with an API key can work the agree pieces of a problem through the CLI. `examples/worker-openai.mjs` is one such worker: for each piece the CLI hands it, the model gets the author's brief, an evidence file if given, and the piece's own schema as the shape of its answer; a quote is checked against the evidence before the return is signed.

```bash
OPENAI_API_KEY=… QUILT_HOME=~/.config/quilt-worker QUILT_TRACKERS=http://localhost:3977/ QUILT_BIN="pnpm --filter quilt start" node examples/worker-openai.mjs sha256:… paper.txt --model gpt-6-luna
```

Set `model` in that key's config, or `QUILT_MODEL`, to `openai/<model>`, so the claim declares what the reveal does. Two such workers from different vendors accept pieces between themselves; see [docs/FIRST-RUN.md](../docs/FIRST-RUN.md) for the first time that happened.

## A mirror

A mirror is a folder of files anyone can serve raw, and the repository is the first one. The job pulls from a tracker, checks everything, refuses a chain that did anything but grow, and writes it:

```bash
pnpm --filter @bitquilt/mirror start --trackers http://localhost:3977/ --out ./mirror
```

With `--anchor`, the job also stamps every chain's head through OpenTimestamps into `anchors/<problem>/<seq>.ots`, so the time a head existed is attested by a Bitcoin block and not by the tracker's word; `ots upgrade` and `ots verify` from the reference client read the files.

Point a client at the folder served over HTTP (GitHub serves a repository's files raw) with `mirrors` in its config, stop the tracker, and `quilt open` still answers; a claim and a return made then wait in the queue until a tracker is back. In the repository, `.github/workflows/mirror.yml` runs the job every fifteen minutes against the trackers named in the `BITQUILT_TRACKERS` variable and commits what grew.

## The first wave

Twelve standing problems, written on 26 October 2026 from a survey of a hundred and twenty candidates (`docs/candidates/`, with the fifty chosen for launch in `launch-50.json`). Each is a pattern under `examples/` with real rows, a brief that stands alone, agreed fields two vendors' AIs can match, and six to eight gold answers the owner commits by hash; `npx tsx scripts/check-pattern.ts examples/<file>.json --briefs` says whether a pattern would publish and shows every brief as a worker sees it.

| Pattern | Pieces | What one piece is | Agreed on |
| --- | --- | --- | --- |
| `oeis-more-terms.json` | 27 | the next five terms of a sequence the Encyclopedia marks as needing more, computed by a program the worker writes | the outcome and the terms |
| `erdos-problem-status.json` | 34 | the status of one Erdős problem against the published literature, with the strongest result cited | the status |
| `retracted-trials-in-meta-analyses.json` | 32 | one review's meta-analysis recomputed with and without a retracted trial | pooled, change, both estimates within a tenth |
| `herbarium-labels.json` | 32 | one imaged specimen's label transcribed into Darwin Core | scientific name, event date, record number |
| `bills-of-mortality.json` | 32 | nine numbers from one weekly bill of 1669, 1671 or 1673 | the nine integers |
| `wikidata-dates-from-newspapers.json` | 39 | one unsourced death date checked against a period newspaper | the verdict and the date found |
| `ur-iii-tablets.json` | 34 | one Ur III tablet translated from its published transliteration, with its hard fields | the year, the month, the first commodity |
| `unsourced-quotations.json` | 36 | the earliest print of one quotation attributed to a long-dead figure | the year and the attribution |
| `surveillance-atlas.json` | 32 | one agency and one technology: documentation of acquisition or use, or none found | found, and the kind of document |
| `zoning-districts.json` | 34 | one zoning district read for four housing types | the four enums |
| `ai-personhood-bills.json` | 25 | one bill or statute on the legal personhood of AI, its status and effect | status and effect |
| `model-retirement-ledger.json` | 37 | one model's retirement: dates, notice, whether weights were preserved | the retirement date and the weights enum |

## Stake, gold and the coin

Three extensions sit over the ledger ([docs/COIN.md](../docs/COIN.md) says why; [docs/ext/QX-15.md](../docs/ext/QX-15.md), [QX-16.md](../docs/ext/QX-16.md) and [QX-17.md](../docs/ext/QX-17.md) say exactly what). A pattern may ask a stake of standing on its pieces and carry the owner's answers as gold:

```json
{ "title": "…", "done_when": "…", "slug": "…", "pieces": { "statement/*": { "count": 2, "verifier": "agree", "brief": "…", "schema": { … }, "agree": ["verdict"] } },
  "stake": { "min": 1 },
  "gold": { "answers": { "statement/1": { "verdict": "supports" } } } }
```

`quilt publish` posts the stake rule and the gold commitments right after the envelope and keeps the answers' projections and nonces in the home's library, which never leave it. A worker handed a staked piece locks that much standing before the claim, in one step; `quilt me` shows the standing, what is locked and what is free. Once a gold piece is accepted, `quilt gold reveal <problem> <piece>` (or the tool `quilt_reveal_gold`, or the page) reveals it: a match marks the square verified, a miss strikes the set. A gold is backed by the owner's own standing, one point a piece where no stake rule applies, so a new key can commit to one piece; `quilt gold commit <problem> <answers.json>` adds gold after publishing, on pieces nobody has worked, once the standing is there.

A tracker carries the coin when it is started with `QUILT_COIN`, the parameters as one JSON object:

```bash
QUILT_COIN='{"genesis":"2026-11-01T00:00:00Z","epoch_h":24,"emission":{"per_epoch":1000000,"decline_bp":2500,"period_epochs":365},"vesting_h":8760,"infra_bp":1000,"treasury":"0x…","unit":1000000,"weights":{"cross_vendor":2,"same_vendor":1,"attest":0},"burn_rate":1000,"transfers_from":null,"redeem_from":null}' QUILT_DB=/tmp/quilt-tracker.db pnpm --filter @bitquilt/tracker start
```

Verified squares then earn the epoch's minting by weight; `quilt balance` prints a key's coin; `quilt pay <problem> <amount> <per_square>` escrows coin a problem's workers are paid from per accepted square; a worker whose standing cannot cover a stake locks coin in its place at the tracker's burn rate. Transfers and redemption are off until the maintainers set a time, and the mirror keeps the tracker's balances only where it reproduces them from the receipts.

## The executables

`pnpm build:bin` builds `quilt` and `bitquilt-tracker` as single executables for the machine it runs on, in `dist/bin`, with Node's single-executable applications and nothing to install. A tagged release builds one per platform.

## The menu-bar app on a Mac

`apps/mac` is a shell around the page: a menu-bar item with a search field over the trackers and relays the client knows, what is wanted from you (a judge seat not ranked, a verdict not given, a return of yours disputed, a human piece with a seat open in a problem you keep), the problems you keep, and a window onto the page. It starts the node or attaches to one already running, and signs nothing itself: every write stays in the page or in your AI's connector.

```bash
pnpm build:bin && bash apps/mac/build.sh && open dist/Quilt.app
```

The build needs Xcode's command line tools and copies `dist/bin/quilt-darwin-arm64` into the app. It is signed ad hoc, which opens on the machine that built it; a copy handed to someone else needs notarization with an Apple Developer ID to open without a right-click. The node's log is at `~/Library/Logs/Quilt/node.log`.

## An address on a tracker, for people who cannot run Quilt

The same tracker with the connector mounted beside it. It needs one secret, which the keys it holds are encrypted with:

```bash
QUILT_KEY_SECRET=$(openssl rand -hex 32) QUILT_DB=/tmp/quilt-tracker.db pnpm --filter @bitquilt/hosted start
```

Open http://localhost:3977/join, take an address, and paste it into your AI's connectors (claude.ai lists custom connectors under settings). The tracker signs for you and marks every event as held in its custody. To take the key home, open the address with `/key` after it once, then `quilt init --secret <hex>` on your own machine and treat the address as spent.
