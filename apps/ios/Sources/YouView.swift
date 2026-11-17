// The person's own page. Until Quilt is in their Claude it shows the steps left, each marked done as the phone finds
// it so: Claude's app on this phone, a key and an address made, and an AI connected at the address, which the tracker
// records. After that it shows their standing and the sentences to say, as the sheet at their address gives them.
// Under either it says where the person's key is: on this phone, with the tracker's key signing for it, or at the
// tracker, with the way to bring it here.
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
                    if let address = store.address { YourKey(address: address) }
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
                Text("Big questions get cut into small pieces. Your Claude answers one. You see who agrees.")
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
                 about: "Quilt works through your own Claude. Without its app, Claude opens in Safari.") {
                Button("Get Claude from the App Store") { openURL(Claude.appStore) }
                    .buttonStyle(ActButton())
            }
        }
    }

    @ViewBuilder private var address: some View {
        if store.address != nil {
            Step(done: true, title: "Your identity is made", about: nil) { EmptyView() }
        } else {
            // After a revoke, or an address taken off, the root is still here and only the address is new.
            Step(done: false, title: store.root == nil ? "Create your identity" : "Make a new private link",
                 about: store.root == nil
                     ? "One tap. It stays on this phone."
                     : "Your identity is on this phone. This makes a new link for your Claude.") {
                Button(working ? "Making it\u{2026}" : store.root == nil ? "Create my identity" : "Make a new link") {
                    working = true
                    Task {
                        await store.join()
                        working = false
                    }
                }
                .buttonStyle(Lead(leads: store.claudeInstalled))
                .disabled(working)
                if pasting {
                    Text("Paste the link Quilt was added to Claude with.")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    TextField("https://tracker.bitquilt.org/mcp/…", text: $pasted, axis: .vertical)
                        .font(Typeface.mono())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(12)
                        .background(Palette.ground, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.rule))
                    Button("Use this link") { Task { await store.use(pasted) } }
                        .buttonStyle(QuietButton())
                } else {
                    Button("I already have a private link") { pasting = true }
                        .buttonStyle(QuietButton())
                }
            }
        }
    }

    @ViewBuilder private var connector: some View {
        if let held = store.address {
            Step(done: false, title: "Connect Claude",
                 about: "Claude opens with everything filled in. Tap Add, then come back.") {
                Button(sent ? "Open Claude again" : "Connect Claude") {
                    sent = true
                    openURL(Claude.addConnector(held))
                }
                .buttonStyle(Lead(leads: store.claudeInstalled && !sent))
                if sent {
                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Waiting for Claude to connect.")
                            .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                    }
                    Text("Added it and still waiting? One message to Claude finishes it.")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    if let first = store.sheet?.first {
                        Button("Ask Claude who I am") {
                            store.handOff = HandOff(title: first.title, sentence: first.say)
                        }
                        .buttonStyle(QuietButton())
                    }
                }
            }
        } else {
            Step(done: false, title: "Connect Claude", about: "Then one tap adds Quilt to your Claude.") { EmptyView() }
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

/// Where the person's key is, and the address their Claude signs through: a copy of it, the end of the tracker's key
/// where this phone holds the root, the way to bring the root here where the tracker holds it, and the way to take
/// the address off this phone.
private struct YourKey: View {
    let address: String
    @Environment(Store.self) private var store
    @State private var copied = false
    @State private var forgetting = false
    @State private var revoking = false
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if store.phoneHoldsRoot {
                Text("Your identity is on this phone").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                if let mine = store.root?.key?.address {
                    Text(mine.prefix(8) + "…" + mine.suffix(6)).font(Typeface.mono()).foregroundStyle(Palette.ink2)
                }
                Text("Your work and your score belong to it. It is backed up with iCloud Keychain where that is on. Quilt holds a second key that signs your Claude\u{2019}s work for you until you disconnect.")
                    .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
            } else if store.sheet != nil {
                Text("Quilt holds your identity").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                Text("Bring it to this phone, and your work so far comes with it.")
                    .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                Button(working ? "Bringing it here\u{2026}" : "Bring my identity to this phone") {
                    working = true
                    Task {
                        await store.bringHome()
                        working = false
                    }
                }
                .buttonStyle(QuietButton())
                .disabled(working)
            }
            Text("Your private link").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink).padding(.top, 8)
            Text("Claude uses it to sign in as you. Keep it secret, like a password.")
                .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
            Button(copied ? "Copied" : "Copy my private link") {
                UIPasteboard.general.string = address
                copied = true
            }
            .buttonStyle(QuietButton())
            if store.phoneHoldsRoot {
                Button("Disconnect Claude", role: .destructive) { revoking = true }
                    .font(Typeface.text(15, relativeTo: .subheadline))
                    .padding(.top, 4)
            }
            Button("Sign out of this phone", role: .destructive) { forgetting = true }
                .font(Typeface.text(15, relativeTo: .subheadline))
                .padding(.top, 4)
        }
        .confirmationDialog("Disconnect Claude?", isPresented: $revoking, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { Task { await store.revoke() } }
        } message: {
            Text("Nothing your Claude sends through this link counts after this, and the link is removed from this phone. Work already matched stays yours. To work again, make a new link here and add it to Claude.")
        }
        .confirmationDialog("Sign out of this phone?", isPresented: $forgetting, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { store.forget() }
        } message: {
            Text(store.phoneHoldsRoot
                ? "Your private link still works where Claude has it, and your identity stays on this phone. If this phone has the only copy of the link, copy it first."
                : "Your private link still works where Claude has it. If this phone has the only copy, copy it first: nothing else can bring it back.")
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
                Text("Your score. It grows when another AI matches your Claude.")
                    .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                if let last = sheet.connector.flatMap({ moment($0.last) }) {
                    Label("Claude connected \u{00B7} last seen \(last.formatted(.relative(presentation: .named)))", systemImage: "checkmark.circle.fill")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.doneInk)
                        .padding(.top, 6)
                }
            }
            WakeCard()
            if !store.claudeInstalled {
                VStack(alignment: .leading, spacing: 10) {
                    Text("Claude is not on this phone, so it opens in Safari.")
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
                    Text(Plain.group(group.title)).font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                    ForEach(group.phrases) { phrase in
                        Button {
                            store.handOff = HandOff(phrase: phrase)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(Plain.ask(phrase).title).font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
                                Text(Plain.ask(phrase).about).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
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

    private func number(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n)
    }
}

/// Whether this app starts the person's Claude by itself, and the way to set that up or end it (Asks.swift).
private struct WakeCard: View {
    @Environment(Store.self) private var store
    @State private var setting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(store.wake == nil ? "Run in the background" : "Running in the background is on")
                .font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            Text(store.wake == nil
                ? "One tap, no switching apps. It needs a scheduled task of your own in Claude."
                : "A tap starts your Claude in the background, on your plan.")
                .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
            Button(store.wake == nil ? "Set it up" : "Change it or turn it off") { setting = true }
                .buttonStyle(QuietButton())
                .padding(.top, 4)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
        .sheet(isPresented: $setting) { WakeSetup().environment(store) }
    }
}

/// The one-time setup of the trigger: the task the person makes in Claude, with the prompt to give it, and the Fire
/// URL and token Claude gives back, which are pasted here and kept in the keychain.
private struct WakeSetup: View {
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var url = ""
    @State private var token = ""
    @State private var copied = false
    @State private var said: String?
    @State private var trying = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("One tap here, and your Claude does the piece in the background, on your plan. Set it up once.")
                        .font(Typeface.text(16)).foregroundStyle(Palette.ink2)

                    part("1", "Make a task in Claude",
                         "Open Claude\u{2019}s scheduled tasks, make one named Quilt, and paste this prompt.")
                    Text(Wake.prompt)
                        .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink)
                        .textSelection(.enabled)
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Palette.rule))
                    HStack(spacing: 12) {
                        Button(copied ? "Copied" : "Copy the prompt") {
                            UIPasteboard.general.string = Wake.prompt
                            copied = true
                        }
                        .buttonStyle(QuietButton())
                        Button("Open Claude's tasks") { openURL(Wake.tasks) }
                            .buttonStyle(QuietButton())
                    }

                    part("2", "Add an API trigger",
                         "Claude shows a URL and a secret, once. Keep Quilt among the task\u{2019}s connectors, and allow its tools without asking.")

                    part("3", "Paste both here", "They stay on this phone and go only to Claude.")
                    HStack {
                        TextField("Trigger URL", text: $url)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .font(Typeface.mono(13))
                        PasteButton(payloadType: String.self) { url = $0.first ?? "" }.labelStyle(.iconOnly)
                    }
                    .padding(10)
                    .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
                    HStack {
                        SecureField("Secret", text: $token)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                            .font(Typeface.mono(13))
                        PasteButton(payloadType: String.self) { token = $0.first ?? "" }.labelStyle(.iconOnly)
                    }
                    .padding(10)
                    .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
                    Button("Save") {
                        if store.keepWake(url: url, token: token) {
                            said = "Saved. A tap now starts your Claude."
                            url = ""
                            token = ""
                        } else {
                            said = "That does not look right. The URL starts https://api.anthropic.com/v1/claude_code/routines/ and ends /fire."
                        }
                    }
                    .buttonStyle(ActButton())
                    .disabled(url.isEmpty || token.isEmpty)

                    if store.wake != nil {
                        Button(trying ? "Starting\u{2026}" : "Test it") {
                            trying = true
                            Task {
                                said = await store.tryWake()
                                trying = false
                            }
                        }
                        .buttonStyle(QuietButton())
                        .disabled(trying)
                        Button("Turn it off") {
                            store.forgetWake()
                            dismiss()
                        }
                        .buttonStyle(QuietButton())
                    }
                    if let said {
                        Text(said).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink)
                    }
                }
                .padding(20)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Palette.ground)
            .navigationTitle("Run in the background")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
    }

    private func part(_ n: String, _ title: String, _ about: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("\(n). \(title)").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            Text(about).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
        }
    }
}
