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

To let Claude Code or Claude Desktop be the worker, add the connector as an MCP server that starts over stdio:

```bash
claude mcp add quilt -- pnpm --filter quilt --dir /path/to/bitquilt start mcp
```

or in Claude Desktop's configuration:

```json
{ "mcpServers": { "quilt": { "command": "pnpm", "args": ["--filter", "quilt", "--dir", "/path/to/bitquilt", "start", "mcp"] } } }
```

Then, in the chat: "open quilt:sha256:… and take a piece". Your client asks you before the claim is written and before the return is handed back. A second production from a different vendor, or from you as a person at the page, accepts the piece.

## A mirror

A mirror is a folder of files anyone can serve raw, and the repository is the first one. The job pulls from a tracker, checks everything, refuses a chain that did anything but grow, and writes it:

```bash
pnpm --filter @bitquilt/mirror start --trackers http://localhost:3977/ --out ./mirror
```

Point a client at the folder served over HTTP (GitHub serves a repository's files raw) with `mirrors` in its config, stop the tracker, and `quilt open` still answers; a claim and a return made then wait in the queue until a tracker is back. In the repository, `.github/workflows/mirror.yml` runs the job every fifteen minutes against the trackers named in the `BITQUILT_TRACKERS` variable and commits what grew.

## The executables

`pnpm build:bin` builds `quilt` and `bitquilt-tracker` as single executables for the machine it runs on, in `dist/bin`, with Node's single-executable applications and nothing to install. A tagged release builds one per platform.
