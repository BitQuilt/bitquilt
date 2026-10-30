# Quilt.app

A menu-bar window onto the node, for a person whose AI does the work. The person sits in a chat and their AI holds the connector, so what this window gives them is a sentence to say, not a button to press. The icon is the site's quilt mark, its squares outlined while the node is not up, with the count of what is wanted beside it. It opens a popover whose header says whether the person's AI is connected, and under it one screen by the state the node reports (`GET /api/phrases`, from `phrases.ts` in the client):

- **The node.** Looking for it, starting it, or reading it, with a quilt being sewn; when it fails, the node's own sentence, "Try again" and the log; when an older node without the sheet answers on the port, what to do about it.
- **No key.** One button, "Make my key", which runs `quilt init`; and under it "I have an address on a tracker", which takes the long address a hosted member's AI uses and runs `quilt init --from <address>`, so the key comes home with the standing and coin it earned and the address is spent.
- **The twelve words**, once, after a key is made, before any other screen: what they are, what losing them costs, and "I wrote them down", which waits for the person to tick that they wrote all twelve on paper.
- **A key, and no AI has connected.** Three steps: add Quilt to Claude Desktop (the app hands the connector bundle, `quilt.mcpb`, to Claude Desktop, which asks once and installs it with no restart and no config file), open Claude and start a new chat, and say the first phrase. Where Claude Desktop is not on the Mac it says so and names the address path instead. The node records the AI that connects, and the screen changes on its own. A key made at first use by the connector, before this app ran, has its twelve words waiting on the page: a notice says so, with a button to the page, until they have been shown.
- **Connected: the sheet.** Read top to bottom as a glance: the coin and the standing as two cells (the coin lit when it just rose, with what was gained since the app opened and what the day owes); the one sentence to say now, which is the sheet's first phrase lifted out of its group (what is wanted from the person, else "Find me something to do on Quilt."), with Copy and, where Claude Desktop is on the Mac, Open Claude; a search; then the groups in the node's order, scrolling: what is wanted, the phrases to start with, the name, the problems kept and opened lately, the gold still to reveal. A phrase about a problem shows the problem's title, the phrase's own title and the link folded into a chip with the short name it carries; the sentence on the clipboard is whole. A click anywhere on a row copies it, and a note at the foot says where to paste it. A search folds the coin and the sentence away until the field is cleared, and its results are phrases too ("Open quilt:… on Quilt and take a piece."), each with how far its map has got. The same phrases are the connector's prompts, so a chat that shows them as slash commands needs no copying. Pinned under the groups, the switch "Work while I'm away" (`GET` and `POST /api/away`, `away.ts` in the client) with the cap beside it and what today and the week did: on, Claude Code or Codex on this Mac does one piece an hour on the person's own plan, up to the cap, with the only tools that read, take and return. When neither CLI is on the Mac the switch is off and says so. [docs/APP.md](../../docs/APP.md), "While you're away", says what a run may and may not do.

The footer holds "Open the page", More and Quit. More holds the page in a window, for what stays a person's own hand (a piece whose verifier is a person's word, a finished problem read in full, the key taken off the Mac); the away run in full, with its promise, the cap and the week's counts; the coin's prompts by name; and what is where on this Mac: the address, the node's status and port, the home and the node's log. The app signs nothing and writes to no ledger: the three acts it does are the key, made or brought home by `quilt init`, the connector bundle, handed to Claude Desktop to install, and the hourly schedule, which the node writes as a launchd agent for its own executable. Open Claude only brings Claude Desktop forward.

The popover is set in the site's tokens (`site/index.html`), light and dark from the system: Young Serif for the name and the numbers, Atkinson Hyperlegible for every sentence, IBM Plex Mono for links, the twelve words and paths. The three faces are in `Resources/Fonts` under the SIL Open Font License, copied into the app by `build.sh` and loaded by `ATSApplicationFontsPath`; a bare `swift build` falls back to the system's faces.

On launch it reads the port from `$QUILT_HOME/config.json` (`QUILT_HOME` defaults to `~/.config/quilt`; the port to 3978) and asks `http://127.0.0.1:<port>/api/me`. When a node answers, the app attaches to it and starts nothing. When none does, it starts one, `quilt serve --port <port>`, with its output in `~/Library/Logs/Quilt/node.log`, and quitting the app stops that node and no other. Every thirty seconds it asks again, and starts a node when the one it had is gone.

The `quilt` executable is looked for in the app itself, then at `$QUILT_BIN`, then at `/usr/local/bin/quilt`, then, in development, at `dist/bin/quilt-darwin-arm64` above the app; the connector bundle in the app, else at `dist/quilt.mcpb` above it.

## Building

```bash
pnpm build:bin          # the quilt executable, in dist/bin
bash apps/mac/build.sh  # the app, at dist/Quilt.app
```

`build.sh` runs `swift build -c release`, assembles `dist/Quilt.app` with the quilt executable, the connector bundle (`pnpm build:mcpb`, at `dist/quilt.mcpb`) and the fonts inside it, and signs it ad hoc. It stops when either is missing, rather than building an app that cannot start a node or install its connector. Xcode 15 or its command-line tools, and macOS 14 or later.

## Running from the repository

```bash
open dist/Quilt.app
```

To run against another home, set `QUILT_HOME` where apps started by the Finder and `open` can see it: `launchctl setenv QUILT_HOME /path/to/home` before `open`, and `launchctl unsetenv QUILT_HOME` after. The node and the app read the same folder, so the page and your AI's connector see one library and one key.

`swift build` alone makes a bare executable with no bundle, no `Info.plist` and so no `LSUIElement` and no loopback exception; use `build.sh` and the app.

## Opening a downloaded copy

Ad hoc signing is for the machine that built it. A copy of `Quilt.app` downloaded from somewhere else is held by Gatekeeper until it is signed with an Apple Developer ID and notarized; until then it opens only through the right-click, Open dance, or `xattr -d com.apple.quarantine dist/Quilt.app`.

Signed and notarized, by hand (28 October 2026):

```bash
QUILT_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" bash apps/mac/build.sh   # the hardened runtime; the quilt executable first, with Resources/quilt.entitlements (Node's just-in-time compiler needs them)
QUILT_NOTARY_PROFILE=quilt bash scripts/notarize.sh                                      # submits dist/Quilt.app, waits, staples, checks with spctl; leaves dist/Quilt.dmg for the release
```

The identity is the Developer ID Application certificate in the keychain (`security find-identity -v -p codesigning` lists it). The notary profile is stored once, by the person whose Apple account it is, with an App Store Connect API key that has the Developer role: `xcrun notarytool store-credentials quilt --key AuthKey_KEYID.p8 --key-id KEYID --issuer ISSUER`; or with `--apple-id`, `--team-id` and an app-specific password. Nothing of either goes into the repository.

The release job (`.github/workflows/release.yml`, `mac-app`) does the same on a tag when the repository's variable `APPLE_SIGNING` is `on` and the secrets are set: `APPLE_CERTIFICATE_P12` (the certificate exported from Keychain Access with its private key, base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGN_IDENTITY`, `APPLE_API_KEY` (the `.p8`, base64), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`. It attaches `Quilt.dmg` to the release beside the executables and the bundle.

## Layout

```
Package.swift                   one executable target, macOS 14, no dependencies
Sources/Quilt/QuiltApp.swift    the App: the MenuBarExtra in its window style, and its icon
Sources/Quilt/Node.swift        the port, the executable, the child, polling; the sheet, the balance and what it gained, the key, the install, the switch for the run while away
Sources/Quilt/API.swift         the shapes the node answers with (the sheet among them), the GET calls, and the two POSTs
Sources/Quilt/MenuView.swift    the popover: the header, the screen by state, the sheet, the search, More, the footer
Sources/Quilt/Setup.swift       the screens before the sheet: the node, no key, the twelve words, connect your AI
Sources/Quilt/Pieces.swift      the phrase row, the sentence to say now, coin and standing, the away row, the search field
Sources/Quilt/Theme.swift       the site's colours and faces, the quilt mark, the menu-bar icon, the two button shapes
Sources/Quilt/PageWindow.swift  the web view and its window
Resources/Info.plist            the bundle's identity, LSUIElement, the loopback exception, and where the fonts are
Resources/Fonts                 Young Serif, Atkinson Hyperlegible and IBM Plex Mono, with their licences
build.sh                        the app at dist/Quilt.app
```
