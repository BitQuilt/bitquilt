// The welcome: what a person sees until their Claude is connected. One screen says what Quilt is and makes their
// identity with one button; the next connects Claude, and moves on by itself once the tracker says an AI has
// connected at their private link; the last says so and sends them to pick a problem. A person can look around
// first, and the welcome comes back from the buttons that need Claude. How the identity works, and everything else
// about keys and links, is in Account, for whoever wants it.
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
            line("1", "Claude opens with everything filled in.")
            line("2", "Tap Add.")
            line("3", "Come back here.")
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

    private func line(_ n: String, _ words: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(n).font(Typeface.display(22)).foregroundStyle(Palette.act).frame(width: 22, alignment: .leading)
            Text(words).font(Typeface.text(19)).foregroundStyle(Palette.ink)
        }
    }
}

/// Claude has connected: said once, with the way to a first problem.
private struct Connected: View {
    @Environment(Store.self) private var store

    var body: some View {
        Image(systemName: "checkmark.seal.fill").font(.system(size: 56)).foregroundStyle(Palette.done)
            .padding(.top, 40)
            .accessibilityHidden(true)
        Text("You\u{2019}re connected").font(Typeface.display(34)).foregroundStyle(Palette.ink)
        Text("Your Claude can answer pieces on Quilt now. Pick a problem and send it.")
            .font(Typeface.text(19)).foregroundStyle(Palette.ink2)
        Button("Pick a problem") { store.finishWelcome(on: "problems") }
            .buttonStyle(ActButton())
            .padding(.top, 8)
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
