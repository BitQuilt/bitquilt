// The welcome: what a person sees until their Claude is connected, and through its first piece. One screen says what
// Quilt is and makes their identity with one button; the next connects Claude, and moves on by itself once the
// tracker says an AI has connected at their private link; the last sends Claude to a first piece, says what the
// person will meet in Claude, and waits with them. The first answer is said over the whole screen, once, wherever
// the person is in the app. A person can look around first, and the welcome comes back from the buttons that need
// Claude. How the identity works, and everything else about keys and links, is in Account, for whoever wants it.
import SwiftUI

struct WelcomeView: View {
    @Environment(Store.self) private var store

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                if store.justConnected {
                    Connected()
                } else if store.address == nil {
                    Start()
                } else {
                    Connect()
                }
            }
            .padding(24)
            .padding(.top, 28)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Palette.ground)
        // With a link and no AI connected yet, the tracker is asked until one has.
        .task(id: store.address) { await store.awaitConnection() }
    }
}

/// A line of trouble, where the last step did not go through.
private struct Trouble: View {
    @Environment(Store.self) private var store

    var body: some View {
        if let trouble = store.problem {
            Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madderInk)
        }
    }
}

/// The way past the welcome for someone who wants to see the problems first.
private struct LookAround: View {
    @Environment(Store.self) private var store

    var body: some View {
        Button("Look around first") {
            store.lookingAround = true
            store.tab = "problems"
        }
        .font(Typeface.text(16))
        .frame(maxWidth: .infinity)
        .padding(.top, 4)
    }
}

/// What Quilt is, in one sentence and a picture, and the one button that makes the person's identity.
private struct Start: View {
    @Environment(Store.self) private var store
    @State private var working = false
    @State private var pasting = false
    @State private var pasted = ""

    var body: some View {
        QuiltMark()
        Text("Your Claude, on questions bigger than one chat.")
            .font(Typeface.display(34)).foregroundStyle(Palette.ink)
        Text("Big questions get cut into small pieces. Your Claude answers one. You see who agrees.")
            .font(Typeface.text(19)).foregroundStyle(Palette.ink2)
        Trouble()
        VStack(spacing: 12) {
            // After a sign-out the identity is still on this phone, and only the link is new.
            Button(working ? "One moment\u{2026}" : store.root == nil ? "Get started" : "Make a new private link") {
                working = true
                Task {
                    await store.join()
                    working = false
                }
            }
            .buttonStyle(ActButton())
            .disabled(working)
            if pasting {
                Text("Paste the link Quilt was added to Claude with.")
                    .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                TextField("https://tracker.bitquilt.org/mcp/\u{2026}", text: $pasted, axis: .vertical)
                    .font(Typeface.mono())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.rule))
                Button("Use this link") { Task { await store.use(pasted) } }
                    .buttonStyle(QuietButton())
            } else {
                Button("I already have a private link") { pasting = true }
                    .buttonStyle(QuietButton())
            }
            LookAround()
        }
        .padding(.top, 8)
        Text("Getting started makes your identity. It stays on this phone.")
            .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
    }
}

/// Claude's own window, opened with everything filled in, and the wait for Claude to connect.
private struct Connect: View {
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var sent = false

    var body: some View {
        Text("Connect Claude").font(Typeface.display(34)).foregroundStyle(Palette.ink)
        VStack(alignment: .leading, spacing: 12) {
            Step(n: "1", words: "Claude opens with everything filled in.")
            Step(n: "2", words: "Tap Add.")
            Step(n: "3", words: "Come back here.")
        }
        if !store.claudeInstalled {
            VStack(alignment: .leading, spacing: 8) {
                Text("Claude is not on this phone, so it opens in Safari.")
                    .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                Link("Get Claude from the App Store", destination: Claude.appStore)
                    .font(Typeface.text(15, relativeTo: .subheadline))
            }
        }
        Trouble()
        VStack(spacing: 12) {
            Button(sent ? "Open Claude again" : "Connect Claude") {
                sent = true
                if let held = store.address { openURL(Claude.addConnector(held)) }
            }
            .buttonStyle(ActButton())
            if sent {
                HStack(spacing: 10) {
                    Patch(state: "in_flight", size: 22, held: true)
                    Text("Waiting for Claude to connect.")
                        .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 4)
                Text("Added it and still waiting? One message to Claude finishes it.")
                    .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let first = store.sheet?.first {
                    Button("Ask Claude who I am") { store.send(HandOff(title: first.title, sentence: first.say)) }
                        .buttonStyle(QuietButton())
                }
            }
            LookAround()
        }
        .padding(.top, 8)
    }
}

/// Claude has connected, and the welcome ends on a first piece: one button sends Claude to find one, with what the
/// person will meet in Claude said first, since nothing else prepares them for it. Once sent, the page waits with
/// them, and says so when Claude has taken a piece. The answer itself is said over the whole screen (`FirstSquare`).
private struct Connected: View {
    @Environment(Store.self) private var store

    var body: some View {
        if store.sentFirst { waiting } else { ready }
    }

    @ViewBuilder private var ready: some View {
        Image(systemName: "checkmark.seal.fill").font(.system(size: 48)).foregroundStyle(Palette.done)
            .padding(.top, 12)
            .accessibilityHidden(true)
        Text("You\u{2019}re connected").font(Typeface.display(34)).foregroundStyle(Palette.ink)
        Text("Now give your Claude its first piece. It takes a few minutes.")
            .font(Typeface.text(19)).foregroundStyle(Palette.ink2)
        VStack(alignment: .leading, spacing: 12) {
            Text("In Claude").font(Typeface.text(15, bold: true, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
            Step(n: "1", words: "A message is written for you. Send it.")
            Step(n: "2", words: "Claude asks before it uses Quilt. Choose Always allow.")
            Step(n: "3", words: "Claude shows its answer and asks before it signs. Say yes.")
        }
        VStack(spacing: 12) {
            Button("Send Claude to its first piece") { store.sendFirst() }
                .buttonStyle(ActButton())
            Button("Pick a problem myself") { store.finishWelcome(on: "problems") }
                .buttonStyle(QuietButton())
        }
        .padding(.top, 8)
    }

    @ViewBuilder private var waiting: some View {
        let held = store.work?.working?.first
        Patch(state: "in_flight", size: 72, held: true)
            .padding(.top, 28)
            .accessibilityHidden(true)
        Text(held == nil ? "Over to Claude" : "Your Claude took a piece").font(Typeface.display(34)).foregroundStyle(Palette.ink)
        if let held {
            Text(verbatim: "\(Plain.piece(held.name)), in \u{201C}\(held.title)\u{201D}")
                .font(Typeface.text(19)).foregroundStyle(Palette.ink)
            Text("Its answer shows up here when it is signed.")
                .font(Typeface.text(19)).foregroundStyle(Palette.ink2)
        } else {
            Text("Send the message in Claude and allow Quilt. This page moves on when your Claude has answered.")
                .font(Typeface.text(19)).foregroundStyle(Palette.ink2)
        }
        VStack(spacing: 12) {
            Button("Open Claude") { store.openClaude() }
                .buttonStyle(ActButton())
            Button("Send the message again") { store.sendFirst() }
                .buttonStyle(QuietButton())
            Button("Look around while it works") { store.finishWelcome(on: "home") }
                .font(Typeface.text(16))
                .frame(maxWidth: .infinity)
                .padding(.top, 4)
        }
        .padding(.top, 8)
    }
}

/// One numbered line of what comes next.
private struct Step: View {
    let n: String
    let words: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(n).font(Typeface.display(22)).foregroundStyle(Palette.act).frame(width: 22, alignment: .leading)
            Text(words).font(Typeface.text(19)).foregroundStyle(Palette.ink)
        }
    }
}

/// The first answer of the person's Claude, over the whole screen, once: its square sewn in, what Claude said, and
/// where the answer stands. An answer is whole once it is signed, so the page says what a match would add and
/// never that the answer waits.
struct FirstSquare: View {
    let reading: Work.Reading
    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var still
    @State private var sewn = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ReadingSquare(reading: reading, size: 132)
                    .scaleEffect(sewn || still ? 1 : 0.2)
                    .rotationEffect(.degrees(sewn || still ? 0 : -18))
                    .opacity(sewn || still ? 1 : 0)
                    .animation(.spring(duration: 0.7, bounce: 0.45).delay(0.25), value: sewn)
                    .padding(.top, 44)
                    .accessibilityHidden(true)
                Text("Your first square").font(Typeface.display(38)).foregroundStyle(Palette.ink)
                VStack(alignment: .leading, spacing: 6) {
                    Text(verbatim: reading.title).font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                    Text(verbatim: Plain.piece(reading.name))
                        .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                    if let said = reading.said {
                        Text(verbatim: "Your Claude said: \(said)").font(Typeface.text(19)).foregroundStyle(Palette.ink)
                    }
                    Text(verbatim: reading.story).font(Typeface.text(16)).foregroundStyle(tone(reading.standing))
                }
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 14))
                if reading.standing == .onRecord {
                    Text("It is signed and on the record. If an AI from another company gives the same answer, the square turns green and your score goes up.")
                        .font(Typeface.text(17)).foregroundStyle(Palette.ink2)
                }
                VStack(spacing: 12) {
                    Button("See my quilt") { store.sawFirstSquare(then: "you") }
                        .buttonStyle(ActButton())
                    Button("Send Claude to another piece") {
                        store.sawFirstSquare(then: "home")
                        store.send(Store.find)
                    }
                    .buttonStyle(QuietButton())
                }
                .padding(.top, 8)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Palette.ground)
        .onAppear { sewn = true }
        .interactiveDismissDisabled()
    }
}

/// A small quilt, as a picture: a few squares in the colours a map draws. On the welcome it is put together square by
/// square, once; on an empty page it is faint, and says what will be there.
struct QuiltMark: View {
    var faint = false
    @State private var sewn = false
    @Environment(\.accessibilityReduceMotion) private var still
    private let states = [
        "accepted", "accepted_provisional", "needs_verify", "open", "in_flight",
        "accepted_provisional", "needs_verify", "open", "open", "accepted",
        "needs_verify", "open", "disputed", "open", "open",
    ]

    var body: some View {
        let side: CGFloat = faint ? 26 : 34
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(side), spacing: 6), count: 5), alignment: .leading, spacing: 6) {
            ForEach(Array(states.enumerated()), id: \.offset) { i, state in
                Patch(state: faint ? "open" : state, size: side)
                    .opacity(sewn || faint || still ? 1 : 0)
                    .scaleEffect(sewn || faint || still ? 1 : 0.5)
                    .animation(.spring(duration: 0.45, bounce: 0.3).delay(Double(i) * 0.05), value: sewn)
            }
        }
        .opacity(faint ? 0.6 : 1)
        .onAppear { sewn = true }
        .accessibilityHidden(true)
    }
}
