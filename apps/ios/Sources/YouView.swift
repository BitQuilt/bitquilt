// The person's own page. Until Quilt is in their Claude it shows the steps left, each marked done as the phone finds
// it so: Claude's app on this phone, an address made, and an AI connected at the address, which the tracker records.
// After that it shows their standing and the sentences to say, as the sheet at their address gives them.
import SwiftUI
import UIKit

struct YouView: View {
    @Environment(Store.self) private var store

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if let trouble = store.problem {
                        Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madder)
                    }
                    if store.address != nil, store.sheet == nil, store.problem == nil {
                        ProgressView()
                    } else if let sheet = store.sheet, sheet.connected {
                        Connected(sheet: sheet)
                    } else {
                        Setup()
                    }
                    if let address = store.address { YourAddress(address: address) }
                }
                .padding(20)
                .padding(.bottom, 60)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Palette.ground)
            .navigationTitle("You")
            .refreshable { await store.refresh() }
            // With an address and no AI connected yet, the tracker is asked until one has.
            .task(id: store.address) { await store.awaitConnection() }
        }
    }
}

/// The steps between a new phone and a Claude that can take a piece. Each is done or not by what the phone and the
/// tracker say, never by what was tapped, and the first one left carries the button that acts.
private struct Setup: View {
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var pasted = ""
    @State private var pasting = false
    @State private var working = false
    @State private var sent = false

    private var left: Int { (store.claudeInstalled ? 0 : 1) + (store.address == nil ? 1 : 0) + 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            if store.address == nil {
                Text("Your Claude, on questions bigger than one chat.")
                    .font(Typeface.display(28)).foregroundStyle(Palette.ink)
                Text("A problem on Quilt is cut into small pieces. Your Claude takes one, does the work and hands back its answer with what it rests on. Every answer is signed and kept on a public record beside the others, so anyone can see where they agree, where they differ, and what each one rests on.")
                    .font(Typeface.text()).foregroundStyle(Palette.ink2)
            }
            Text(left == 1 ? "One step left" : left == 2 ? "Two steps left" : "Three steps")
                .font(Typeface.display(26)).foregroundStyle(Palette.ink)
            claude
            address
            connector
        }
    }

    @ViewBuilder private var claude: some View {
        if store.claudeInstalled {
            Step(done: true, title: "Claude is on this phone", about: nil) { EmptyView() }
        } else {
            Step(done: false, title: "Get Claude",
                 about: "Quilt works through your own Claude, and its app is not on this phone. This page knows once it is. Without the app, the steps below open Claude in Safari.") {
                Button("Get Claude from the App Store") { openURL(Claude.appStore) }
                    .buttonStyle(ActButton())
            }
        }
    }

    @ViewBuilder private var address: some View {
        if store.address != nil {
            Step(done: true, title: "Your address is made", about: nil) { EmptyView() }
        } else {
            Step(done: false, title: "Make your address",
                 about: "The tracker makes a key and holds it for you. Your address is how your Claude signs its work, and it is yours to take elsewhere.") {
                Button(working ? "Making your address" : "Make my address") {
                    working = true
                    Task {
                        await store.join()
                        working = false
                    }
                }
                .buttonStyle(Lead(leads: store.claudeInstalled))
                .disabled(working)
                if pasting {
                    Text("If Quilt is already in your Claude, paste the address it was added with, and this page will know.")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    TextField("https://tracker.bitquilt.org/mcp/…", text: $pasted, axis: .vertical)
                        .font(Typeface.mono())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(Palette.ground, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.rule))
                    Button("Use this address") { Task { await store.use(pasted) } }
                        .buttonStyle(QuietButton())
                } else {
                    Button("I already have an address") { pasting = true }
                        .buttonStyle(QuietButton())
                }
            }
        }
    }

    @ViewBuilder private var connector: some View {
        if let held = store.address {
            Step(done: false, title: "Add Quilt to Claude",
                 about: "This opens Claude's Add custom connector window with your address and the name Quilt filled in. Press Add there. This page moves on by itself once your Claude has connected.") {
                Button(sent ? "Open Claude's window again" : "Add Quilt to Claude") {
                    sent = true
                    openURL(Claude.addConnector(held))
                }
                .buttonStyle(Lead(leads: store.claudeInstalled && !sent))
                if sent {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Waiting for your Claude to connect.")
                            .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                    }
                    Text("If Claude has added Quilt and this still waits, one sentence makes it connect.")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    if let first = store.sheet?.first {
                        Button("Ask Claude who I am on Quilt") {
                            store.handOff = HandOff(title: first.title, sentence: first.say)
                        }
                        .buttonStyle(QuietButton())
                    }
                }
            }
        } else {
            Step(done: false, title: "Add Quilt to Claude", about: "Once you have an address, one tap puts it into your Claude.") { EmptyView() }
        }
    }
}

/// The button of a step: the one that acts where the step is the first left, a quiet one where an earlier step waits.
private struct Lead: ButtonStyle {
    let leads: Bool

    func makeBody(configuration: Configuration) -> some View {
        if leads { ActButton().makeBody(configuration: configuration) } else { QuietButton().makeBody(configuration: configuration) }
    }
}

/// One step: a tick once it is done, what it does while it is not, and its buttons.
private struct Step<Action: View>: View {
    let done: Bool
    let title: String
    let about: String?
    @ViewBuilder let action: Action

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: done ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(done ? Palette.done : Palette.ink2)
                    .accessibilityLabel(done ? "Done" : "Left to do")
                Text(title).font(Typeface.text(17, bold: !done)).foregroundStyle(done ? Palette.ink2 : Palette.ink)
            }
            if let about {
                Text(about).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
            }
            action
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(done ? Color.clear : Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(done ? Palette.rule : Color.clear))
    }
}

/// The address held on this phone: a copy of it, and the way to take it off.
private struct YourAddress: View {
    let address: String
    @Environment(Store.self) private var store
    @State private var copied = false
    @State private var forgetting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Your address").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            Text("Whoever holds this address signs as you, so treat it as a password. The tracker holds the key behind it.")
                .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
            Button(copied ? "Copied" : "Copy my address") {
                UIPasteboard.general.string = address
                copied = true
            }
            .buttonStyle(QuietButton())
            Button("Take this address off this phone", role: .destructive) { forgetting = true }
                .font(Typeface.text(15, relativeTo: .subheadline))
                .padding(.top, 4)
        }
        .confirmationDialog("Take this address off this phone?", isPresented: $forgetting, titleVisibility: .visible) {
            Button("Take it off", role: .destructive) { store.forget() }
        } message: {
            Text("The address still works wherever it is kept. If this phone holds the only copy, copy it somewhere first: nothing else can bring it back.")
        }
    }
}

/// Once an AI has connected: the standing, when it last connected, and each group of sentences, a tap handing one to
/// Claude.
private struct Connected: View {
    let sheet: Sheet
    @Environment(Store.self) private var store

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 2) {
                Text(number(sheet.standing?.standing ?? 0)).font(Typeface.text(44, bold: true, relativeTo: .largeTitle)).foregroundStyle(Palette.doneInk)
                Text("Your standing, earned by work that stood and not for sale.")
                    .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                if let address = sheet.address {
                    Text(address.prefix(8) + "…" + address.suffix(6)).font(Typeface.mono()).foregroundStyle(Palette.ink2)
                }
                if let last = sheet.connector.flatMap({ moment($0.last) }) {
                    Label("Quilt is in your Claude, which last connected \(last.formatted(.relative(presentation: .named))).", systemImage: "checkmark.circle.fill")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.doneInk)
                        .padding(.top, 6)
                }
            }
            if !store.claudeInstalled {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Claude's app is not on this phone, so a sentence opens Claude in Safari.")
                        .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                    Link("Get Claude from the App Store", destination: Claude.appStore)
                        .font(Typeface.text(15, relativeTo: .subheadline))
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
            }
            ForEach(sheet.groups) { group in
                VStack(alignment: .leading, spacing: 10) {
                    Text(group.title).font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                    ForEach(group.phrases) { phrase in
                        Button {
                            store.handOff = HandOff(title: phrase.title, sentence: phrase.say)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(phrase.title).font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
                                Text(phrase.about).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                                    .multilineTextAlignment(.leading)
                            }
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    /// A time as the tracker writes one, with or without the fraction of a second.
    private func moment(_ written: String) -> Date? {
        let whole = ISO8601DateFormatter()
        let fine = ISO8601DateFormatter()
        fine.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fine.date(from: written) ?? whole.date(from: written)
    }

    private func number(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n)
    }
}
