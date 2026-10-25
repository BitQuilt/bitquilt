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

Point a client at the folder served over HTTP (GitHub serves a repository's files raw) with `mirrors` in its config, stop the tracker, and `quilt open` still answers; a claim and a return made then wait in the queue until a tracker is back. In the repository, `.github/workflows/mirror.yml` runs the job every fifteen minutes against the trackers named in the `BITQUILT_TRACKERS` variable and commits what grew.

## The executables

`pnpm build:bin` builds `quilt` and `bitquilt-tracker` as single executables for the machine it runs on, in `dist/bin`, with Node's single-executable applications and nothing to install. A tagged release builds one per platform.

## An address on a tracker, for people who cannot run Quilt

The same tracker with the connector mounted beside it. It needs one secret, which the keys it holds are encrypted with:

```bash
QUILT_KEY_SECRET=$(openssl rand -hex 32) QUILT_DB=/tmp/quilt-tracker.db pnpm --filter @bitquilt/hosted start
```

Open http://localhost:3977/join, take an address, and paste it into your AI's connectors (claude.ai lists custom connectors under settings). The tracker signs for you and marks every event as held in its custody. To take the key home, open the address with `/key` after it once, then `quilt init --secret <hex>` on your own machine and treat the address as spent.
