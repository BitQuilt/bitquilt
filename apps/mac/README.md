# Quilt.app

A menu-bar window onto the node. The icon in the menu bar opens a popover: a search field over the world's problems, what is wanted from you, the problems you keep and opened lately, whose node this is, and three buttons. Everything that is an act opens the page in a window, where your own hand does it. The app signs nothing and writes nothing of its own: every write stays in the page or in your AI's connector.

On launch it reads the port from `$QUILT_HOME/config.json` (`QUILT_HOME` defaults to `~/.config/quilt`; the port to 3978) and asks `http://127.0.0.1:<port>/api/me`. When a node answers, the app attaches to it and starts nothing. When none does, it starts one, `quilt serve --port <port>`, with its output in `~/Library/Logs/Quilt/node.log`, and quitting the app stops that node and no other. Every thirty seconds it asks again, and starts a node when the one it had is gone.

The `quilt` executable is looked for in the app itself, then at `$QUILT_BIN`, then at `/usr/local/bin/quilt`, then, in development, at `dist/bin/quilt-darwin-arm64` above the app.

## Building

```bash
pnpm build:bin          # the quilt executable, in dist/bin
bash apps/mac/build.sh  # the app, at dist/Quilt.app
```

`build.sh` runs `swift build -c release`, assembles `dist/Quilt.app` with the quilt executable inside it, and signs it ad hoc. It stops when `dist/bin/quilt-darwin-arm64` is missing, rather than building an app that cannot start a node. Xcode 15 or its command-line tools, and macOS 14 or later.

## Running from the repository

```bash
open dist/Quilt.app
```

To run against another home, set `QUILT_HOME` where apps started by the Finder and `open` can see it: `launchctl setenv QUILT_HOME /path/to/home` before `open`, and `launchctl unsetenv QUILT_HOME` after. The node and the app read the same folder, so the page and your AI's connector see one library and one key.

`swift build` alone makes a bare executable with no bundle, no `Info.plist` and so no `LSUIElement` and no loopback exception; use `build.sh` and the app.

## Opening a downloaded copy

Ad hoc signing is for the machine that built it. A copy of `Quilt.app` downloaded from somewhere else is held by Gatekeeper until it is signed with an Apple Developer ID and notarized; until then it opens only through the right-click, Open dance, or `xattr -d com.apple.quarantine dist/Quilt.app`. The release job that signs and notarizes is not written yet.

## Layout

```
Package.swift                   one executable target, macOS 14, no dependencies
Sources/Quilt/QuiltApp.swift    the App: the MenuBarExtra in its window style
Sources/Quilt/Node.swift        the port, the executable, probing, starting and stopping the child, polling
Sources/Quilt/API.swift         the shapes the node answers with, and the four GET calls
Sources/Quilt/MenuView.swift    the popover
Sources/Quilt/PageWindow.swift  the web view and its window
Resources/Info.plist            the bundle's identity, LSUIElement, and the loopback exception
build.sh                        the app at dist/Quilt.app
```
