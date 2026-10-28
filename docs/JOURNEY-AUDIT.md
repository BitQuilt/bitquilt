# An audit of the journey, from the website to a solved square

Written 28 October 2026 at the founder's request, before announcing. It walks the path a stranger takes today from `site/index.html` to their first accepted square, as the repository and the documents stand ([LAUNCH.md](LAUNCH.md), [APP.md](APP.md), [DEPLOY.md](DEPLOY.md), [FIRST-RUN.md](FIRST-RUN.md), `apps/mac`, `packages/hosted`, `scripts/build-mcpb.mjs`, `site/`), names where it breaks, and says what the path should be. It then says what to deploy and in what order. Nothing here changes the core or the coin; everything is the on-ramp.

The short answer. Today nobody but the founder can take the path at all: the tracker is on one laptop, the site's only action is to build from source, and the repository has no public remote. A public tracker is not one option among several; it is the first thing on the path, since the hosted address, the connector's default, the mirror, the coin's home and the live problems page all stand on it. Once it stands, the shortest path is the one the project built last and lists fourth: an address from the tracker, pasted into the AI's connectors, with nothing installed. Lead with that, make the Mac app and the bundle the way to hold your own key, and script the first ten minutes so a stranger sees a square turn green and their standing rise before they have decided whether to stay.

## 1. The path today, step by step

What a stranger meets, in order, if the site were served and the tracker reachable; the last column is how many strangers in ten a careful guess says reach the next step.

| Step | What they meet today | What goes wrong | Of ten |
| --- | --- | --- | --- |
| 1. Land on the site | "Define a problem. Solve it with humans and AIs around the world." Two buttons: Get Quilt, How it works. | Nothing on the page shows a problem being worked or a square turning green. The pitch is read, not seen. The problems page that reads a tracker live is a link away. | 10 |
| 2. Get Quilt | `how.html#quilt`: "Releases will carry one executable per platform. Until then it builds from source": `pnpm install`, `pnpm build:bin`, `claude mcp add quilt -- ./dist/bin/quilt-darwin-arm64 mcp`. | A developer's path. Everyone else leaves here. The hosted address, the one path that needs nothing installed, is a paragraph above it with no button. | 1 |
| 3a. The bundle | `quilt.mcpb`, a double-click in Claude Desktop, no restart. | The connector has no key. `quilt_me` answers "none yet (quilt init makes one)"; the AI tells the person to run a terminal command. The page at `localhost:3978` has no button to make one. A dead end for a non-developer. | |
| 3b. The Mac app | A download. Make my key (twelve words once), Add Quilt to Claude Desktop, quit and reopen Claude, say the first phrase. | The download is signed ad hoc, so Gatekeeper holds it until the right-click dance. The config is written only while Claude is closed, so there is a quit and a restart. Walked this week on the founder's own Mac, the app attached to the wrong home and the connector to a tracker two days old; both were fixed, both were the kind of thing a stranger cannot fix. | |
| 3c. The hosted address | `tracker/join`: one button, an address shown once, a warning that whoever has it can act as you, and "paste into your AI's connectors". | The best path and the barest page: no word on where to paste it in claude.ai or Claude Desktop, no first sentence to say, no view of standing or coin afterwards, no way home but a URL with `/key` and a CLI flag. | |
| 4. The first sentence | "Open Quilt and tell me who I am." The AI answers with the address, standing 1, coin 0. | Works, and it is the right proof of connection. The answer's words were fixed this week; before it, a stale tracker read as "the tracker didn't respond". | 8 of those who connect |
| 5. Something to do | "Find me something to do on Quilt." The connector lists problems from the tracker; `next` hands the rarest piece; the AI asks before the claim and before the return. | Only if problems are published and seeded there. Today the public tracker has none, and a new key cannot publish gold until it has standing, so the first problems need the maintainers' two keys to cross-work first (LAUNCH step 7). | 7 |
| 6. The square turns green | The piece is `needs_verify` until a root declaring another vendor returns the same verdict. | With few users the stranger's square waits for hours or days. Nothing in the first session turns green. Standing does rise by one at acceptance, which is the one instant reward, and nothing shows it rising. | 3 |
| 7. Coin | Only a verified square (a gold match) earns it, and it arrives at the epoch's end, once a day at midnight UTC. | A person who verified a square at noon sees a balance of 0 until midnight, with no sign that anything is owed. The menu bar's live balance, built for the incentive, has nothing to show on the first day. | 2 |
| 8. A problem of their own | `quilt_publish` takes a pattern; the phrase "Publish a pattern" exists. | A pattern is a JSON file with families, schemas and verifiers. A stranger will not write one. Their AI could, from a conversation, if the tool told it plainly what was wrong with a draft. | 1 |
| 9. Holding the key | Open the address with `/key`, run `quilt init --secret <hex>`. | A developer's path again, and the Mac app's first screen has no "I already have an address" door. | |

Three findings stand out of the table. The path has no front door that a non-developer can open. The first session has no moment of reward, because verification waits on other people and the coin waits on the clock. And the hosted address, which solves the first problem outright, is treated as a fallback.

## 2. The path it should be

The feeling to build for is the one APP.md names: Napster's search box and the bar filling from strangers. Here it is one sentence said to your own AI, a square of a real problem turning green because a stranger's AI of another make agreed with yours, and a number beside your name going up. Everything on the path either gets a person to that moment faster or is in the way.

### Three doors, in this order

1. **An address, nothing installed.** The site's first button. One click makes an address on the public tracker; the page then shows the URL with a copy button, the three places it goes (claude.ai, Settings, Connectors, Add custom connector; Claude Desktop, the same; the phone, which takes what the web account has), and the first sentence to say. The tracker signs in custody, every receipt says so, and the key is theirs to take home. This is the door for anyone with a Claude account, on any device, in about ninety seconds: the free plan allows one custom connector, and this is it. It is also the door for ChatGPT and every other chat that takes an MCP address.
2. **The bundle, for Claude Desktop.** `quilt.mcpb`, one double-click, no restart, no config file, on every platform Claude Desktop runs on. This is the door for a person who wants the key on their own disk and has Claude Desktop. It needs one change (section 3) before it can be a door at all.
3. **The Mac app**, for a person who wants the sheet in their menu bar and the coin rising. It should install the bundle rather than edit Claude's config, and import an address from the tracker as well as make a new key. It needs notarization before a stranger can open it, which is an Apple developer account and a release job.

The order is the reverse of LAUNCH.md's stranger's path, which installs first and takes an address fourth. The reason to reverse it is in the table: the install is where nine of ten leave, and the address is where none need to. The tension with APP.md, which holds the key on the person's disk and says the project is glad to lose share to the local Quilt, is real and is answered by keeping the way home short: the sheet nudges a hosted member to take the key home once they have standing, and the Mac app takes it in one paste. The hosted tracker is the door, not the house.

### The first ten minutes, scripted

| Minute | What happens | What makes it so |
| --- | --- | --- |
| 0 | The site shows a problem being worked, its squares changing, above the one button. | The problems page's live strips on the front page, read from the public tracker. |
| 1 | An address is made and pasted. | The join page, rewritten as section 3 says. |
| 2 | "Open Quilt and tell me who I am." The AI names the address and says standing 1, earned by work. | As built. |
| 3 | "Find me something to do on Quilt." The AI is handed the rarest piece of a launch problem, asks once, does it, asks again, hands it back. | The twenty-four launch patterns published and seeded, with their gold. |
| 5 | The square turns green. Standing is 2. | A standing worker of another vendor, run by the maintainers, that takes every open piece on the launch problems within minutes (section 4). The sheet shows the point. |
| 6 | The sheet says what the square earned: coin owed, paid at midnight UTC. | A pending line on the balance (section 3). |
| 8 | "Search Quilt for climate." Another problem, another piece. | Discovery over the tracker's index, and later the relays. |
| 10 | The AI suggests a name for the address; the person picks one. | `quilt_name`, offered by the sheet after the first accepted square. |
| Day 2 | The balance is above zero and the menu bar lit it green. | The epoch's minting, as built. |
| Week 1 | "Turn this into a problem for the world's AIs." The AI drafts a pattern from the conversation, the tool says what is wrong until nothing is, and the person watches strangers fill it. | `quilt_publish` answering a draft with every fault at once, in the pattern checker's words. |

### What is cut from the path

Nothing a person has to type into a terminal. No quit-and-reopen of Claude. No twelve words before the first square: the key is made when it is first needed and backed up when there is something to lose. No JSON. No wallet, as COIN.md already promises.

## 3. The fixes, by size

Each is a day or less with an agent at hand unless it says otherwise, and each has a test.

1. **The join page becomes the sheet.** `packages/hosted/src/join-page.ts` shows, after the address is made: the URL with a copy button; where it goes, per client; the first two sentences to say; and, reading the tracker, the address's standing, coin and what is wanted from it, as the menu bar does from `sheetOf` in `packages/client/src/phrases.ts`. The page lives at the address itself, so it is a bookmark, and the address stays the only credential. A "take my key home" section names the Mac app and the one paste.
2. **A key on first use.** When the connector or the page is asked to sign and the home has no key, it makes one and keeps it, and `quilt_me` says a key was made here and that its twelve words wait on the page to be written down. The bundle then works on a double-click with nothing else. The phrase is never put into a chat, where it would pass through the model and sit in a transcript; the page shows it once, on a click, and the sheet nudges until it has been seen. This is how wallets onboard now: make first, back up when there is something to lose.
3. **The Mac app installs the bundle.** The second screen's button opens `quilt.mcpb` with Claude Desktop (`open -a Claude`), which installs it with no restart, instead of writing `claude_desktop_config.json` while Claude must be closed. The "write it anyway" button goes. The app bundles the `.mcpb` beside the executable.
4. **Pending coin on the sheet.** `GET /coin/balance/<root>` gains `pending`: the root's share of the open epoch so far, at the cap, and when it pays. The menu bar shows "N owed, pays at midnight UTC" under the balance, and the join sheet the same. The first day then has something to watch.
5. **The site's first screen.** The live strips above one button, "Get an address", and a second, quieter, "Hold your own key" leading to the bundle and the app. The build-from-source block moves under Build a client. The site is served from the tracker's own host, so one domain does everything and the address a person pastes reads as the project's name.
6. **An address imported in the app.** The no-key screen gains "I have an address on a tracker": paste the URL, the app fetches `/key` once, imports the secret, and the tracker marks the address spent. The hosted member's standing and coin come with the key, since the root is the same.
7. **The name, offered.** After the first accepted square the sheet offers "Call me <name> on Quilt", and the join sheet does the same.
8. **A pattern from a conversation.** `quilt_publish` returns every fault of a draft at once in the checker's words (`scripts/check-pattern.ts` has them), so an AI can draft a pattern from what the person said and fix it in one or two turns. A phrase, "Turn this into a problem", and a short example in the tool's description.
9. **The funnel, counted.** The tracker counts by the day, naming nobody, as the rally's `counts.ts` does: addresses made, first tool call, first claim, first accepted, first verified, keys taken home. A maintainers' route reads it. Without this, the launch cannot be steered.
10. **Notarization.** An Apple developer account and a job in `release.yml` that signs with the Developer ID and notarizes `Quilt.app`. Two or three days, most of it Apple's. Until it is done, the Mac app is for people who build it, and the site does not offer it.

## 4. What to deploy, and in what order

**Yes, deploy the public tracker, first and now.** Everything on the path stands on it. The container is built (`Dockerfile`, `packages/hosted`), DEPLOY.md has the commands, and the first build somewhere is its first test, which is one more reason to do it before anything else.

| Order | What | Notes |
| --- | --- | --- |
| 1 | A home for the code | The GitHub organization and repository, `origin`, `main` pushed; the checks run. The mirror needs it, and so does the release. |
| 2 | The host | One small VM with Docker and Caddy (a few dollars a month), a domain, TLS in one Caddy line. `QUILT_KEY_SECRET` made once and kept in two places by two people: it is every hosted key. `/data` backed up nightly, the backup encrypted apart from the secret. |
| 3 | The tracker's constitution | `QUILT_MAINTAINERS` from a key made offline, `QUILT_COIN` with the parameters LAUNCH.md names and a genesis a day or two ahead, `QUILT_IP_SALT`, `QUILT_URL`. |
| 4 | The defaults | `DEFAULT_CONFIG.trackers` and the bundle's settings to the public tracker; two relays. Then the release tag, so the bundle and the executables exist to link to. |
| 5 | The mirror | `BITQUILT_TRACKERS` in the repository's variables; the workflow writes the ledger and anchors every head from the first hour. |
| 6 | The first problems | The maintainers' two keys cross-work a few squares to earn the standing their gold needs, then publish and seed the twenty-four patterns with their gold. |
| 7 | The standing workers | `examples/worker-openai.mjs`, and a second of another vendor if a key is to hand, on a loop against the launch problems from a machine the maintainers run, declaring their vendors. This is what makes a stranger's square turn green in minutes rather than days, and what makes the gold verify so that coin is minted at all in week one. It is honest work by a declared vendor, and the independence rule counts it at full weight against a Claude. |
| 8 | The site | Served from the same host, with the first screen of section 3. |
| 9 | The walk | The stranger's path below, timed, from a machine that has never seen Quilt, before a word is said in public. |

The bridge (LAUNCH.md step 4) is not on this path: nothing between the site and a solved square touches a chain, and it runs beside the launch as the founder decided. The second tracker, the relays and the DHT are after the first week; one tracker with a mirror is what Bitcoin had too.

**What the public tracker concentrates.** The hosted on-ramp holds strangers' keys, encrypted with one secret. A copy of the database and the secret is every hosted identity, with its standing and its coin. The protocol was shaped so that no index concentrates liability; this one concentrates custody, by the person's choice and marked on every receipt. The answers are the ones DEPLOY.md gives and two more: the secret lives in the container's environment and a password manager and nowhere else; `/join` is rate-limited by hashed address; the sheet nudges a member with standing to take the key home; and the join page says in one sentence what custody means, as it does now.

## 5. The stranger's path, to walk before announcing

Replacing the five steps at the end of LAUNCH.md, with the time each may take.

1. On a phone with the Claude app, open the site. A problem is visibly being worked. Press Get an address. Copy it. In claude.ai, Settings, Connectors, add it. Under two minutes.
2. In a new chat: "Open Quilt and tell me who I am." The address, standing 1, coin 0. Under one minute.
3. "Find me something to do on Quilt." A piece of a launch problem, two questions from the client, a return. Under three minutes.
4. Open the address in a browser. The square is green, standing is 2, the sheet says what is owed and when. Under five minutes from the return, with the standing workers running.
5. On a Mac with Claude Desktop, download the bundle, double-click, say the first sentence. A key is made with no ceremony. Under two minutes.
6. Open the Mac app, choose "I have an address on a tracker", paste the phone's address. The same standing and coin, now held at home. Under one minute.
7. The next day, the menu bar's balance is above zero and was lit green when it rose.

If any step takes twice its time, or needs a terminal, the launch is not ready.

## 6. Decisions for the founder

1. Lead with the hosted address, with the way home kept short, over installing first. (Recommended: yes.)
2. The domain, and one host for the site, the join page and the tracker.
3. An Apple developer account for notarization, now or after the first week.
4. Which second vendor's key the standing workers run with, and on what machine.
5. Whether a key is made on first use with the backup deferred, or shown first. (Recommended: first use.)
6. Whether to count the funnel on the tracker, naming nobody. (Recommended: yes.)

## 7. Status

Built on 28 October 2026, the day it was written, at the founder's direction, in the order given: the join page as the sheet with the data at the address (fix 1); a key at first use with the words shown once on the page and the menu bar's row until then (fix 2); the Mac app handing the connector bundle to Claude Desktop in place of writing its config (fix 3); what is owed today on the balance route, in `quilt_me`, on the menu bar and on the hosted sheet (fix 4); the site's first screen as the live strips above Get an address (fix 5); an address imported in the Mac app and `quilt init --from` (fix 6); the name offered on the sheet once there is work behind the address (fix 7); `publish` refusing a draft with every fault at once from one checker the maintainers' script shares, and the phrase "Turn this into a problem" (fix 8); `GET /counts` on the tracker, by day and naming nobody, with the hosted on-ramp marking first use and a key taken home (fix 9). Fix 10, notarization, is built as far as code goes the same day: the app build signs with a Developer ID and the hardened runtime when `QUILT_SIGN_IDENTITY` is set (the Node executable with the entitlements its compiler needs), `scripts/notarize.sh` submits and staples, and the release job's `mac-app` does both on a tag from the repository's secrets; the Developer ID certificate is in the founder's keychain, the notary credential was made and stored the same day, and `dist/Quilt.app` was notarized and stapled on this Mac: Gatekeeper's assessor reads it as a notarized Developer ID app, and the same copy is in the founder's Applications. Nothing in section 4, the maintainers' hands, is done here. The stranger's path in [LAUNCH.md](LAUNCH.md) is the one in section 5.
