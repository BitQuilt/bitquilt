// Account: everything about the connection that a person rarely needs and should be able to find. Whether Claude is
// connected, the way the Send button goes, running in the background, notifications, where the identity is, the
// private link, and at the bottom the two things that cannot be undone, each with what it does said beside it.
import SwiftUI
import UIKit

struct AccountView: View {
    @Environment(Store.self) private var store
    @State private var setting = false
    @State private var copied = false
    @State private var working = false
    @State private var revoking = false
    @State private var forgetting = false

    private var ways: [Route] { store.wake == nil ? [.new, .chat] : Route.allCases }

    var body: some View {
        @Bindable var store = store
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                if let trouble = store.problem {
                    Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madderInk)
                }

                Part("Claude") {
                    if let last = store.sheet?.connector.flatMap({ moment($0.last) }), store.connected {
                        Label("Connected \u{00B7} last seen \(last.formatted(.relative(presentation: .named)))", systemImage: "checkmark.circle.fill")
                            .font(Typeface.text(16)).foregroundStyle(Palette.doneInk)
                    } else {
                        Text(store.address == nil ? "Not set up on this phone." : "Not connected yet.")
                            .font(Typeface.text(16)).foregroundStyle(Palette.ink2)
                        Button("Connect Claude") { store.lookingAround = false }.buttonStyle(QuietButton())
                    }
                    if !store.claudeInstalled {
                        Text("Claude is not on this phone, so it opens in Safari.").font(note).foregroundStyle(Palette.ink2)
                        Link("Get Claude from the App Store", destination: Claude.appStore).font(note)
                    }
                }

                if store.connected {
                    Part("The Send button") {
                        Picker("The Send button uses", selection: $store.route) {
                            ForEach(ways) { Text($0.short).tag($0) }
                        }
                        .pickerStyle(.segmented)
                        Text((store.route == .background && store.wake == nil ? Route.new : store.route).hint)
                            .font(note).foregroundStyle(Palette.ink2)
                    }

                    Part(store.wake == nil ? "Run in the background" : "Running in the background is on") {
                        Text(store.wake == nil
                            ? "One tap, no switching apps. It needs a scheduled task of your own in Claude, so it takes a few minutes to set up."
                            : "A tap starts your Claude in the background, on your plan.")
                            .font(note).foregroundStyle(Palette.ink2)
                        Button(store.wake == nil ? "Set it up" : "Change it or turn it off") { setting = true }
                            .buttonStyle(QuietButton())
                    }
                }

                if store.connected {
                    Part("Notifications") {
                        Toggle("Tell me when an answer is matched", isOn: Binding(
                            get: { store.pings },
                            set: { on in
                                if on { Task { await store.turnOnPings() } } else { store.turnOffPings() }
                            }
                        ))
                        .font(Typeface.text(16)).foregroundStyle(Palette.ink).tint(Palette.act)
                        Text("Also when another AI disagrees, and when your Claude answers while you are away. Quilt checks now and then, when your phone lets it, so a notification can come some hours late.")
                            .font(note).foregroundStyle(Palette.ink2)
                        if store.pingsRefused {
                            Text("Notifications are off for Quilt in Settings.").font(note).foregroundStyle(Palette.madderInk)
                            if let settings = URL(string: UIApplication.openSettingsURLString) {
                                Link("Open Settings", destination: settings).font(note)
                            }
                        } else if store.pings, UIApplication.shared.backgroundRefreshStatus != .available {
                            Text("Background App Refresh is off for Quilt, so it can check only while it is open.")
                                .font(note).foregroundStyle(Palette.madderInk)
                        }
                    }
                }

                if store.address != nil {
                    Part(store.phoneHoldsRoot ? "Your identity is on this phone" : "Quilt holds your identity") {
                        if store.phoneHoldsRoot {
                            if let mine = store.root?.key?.address {
                                Text(mine.prefix(8) + "\u{2026}" + mine.suffix(6)).font(Typeface.mono()).foregroundStyle(Palette.ink2)
                            }
                            Text("Your answers and your score belong to it. It is backed up with iCloud Keychain where that is on.")
                                .font(note).foregroundStyle(Palette.ink2)
                            DisclosureGroup("How it works") {
                                Text("Your identity is a key that never leaves this phone. Quilt holds a second key that signs your Claude\u{2019}s answers for you, and your identity says that it may. Disconnecting ends that, and your answers stay yours.")
                                    .font(note).foregroundStyle(Palette.ink2)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.top, 6)
                            }
                            .font(note)
                            .tint(Palette.act)
                        } else if store.sheet != nil {
                            Text("Bring it to this phone, and your answers so far come with it.").font(note).foregroundStyle(Palette.ink2)
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
                    }

                    Part("Your private link") {
                        Text("Claude uses it to sign in as you. Keep it secret, like a password.").font(note).foregroundStyle(Palette.ink2)
                        Button(copied ? "Copied" : "Copy my private link") {
                            UIPasteboard.general.string = store.address
                            copied = true
                        }
                        .buttonStyle(QuietButton())
                    }

                    Part("Cannot be undone") {
                        if store.phoneHoldsRoot {
                            Text("Disconnecting stops your Claude from answering as you. Matched answers stay yours.")
                                .font(note).foregroundStyle(Palette.ink2)
                            Button("Disconnect Claude", role: .destructive) { revoking = true }.font(Typeface.text(16))
                        }
                        Text("Signing out removes your private link from this phone. Claude keeps working wherever the link still is.")
                            .font(note).foregroundStyle(Palette.ink2)
                            .padding(.top, store.phoneHoldsRoot ? 8 : 0)
                        Button("Sign out of this phone", role: .destructive) { forgetting = true }.font(Typeface.text(16))
                    }
                }

                Text("Quilt \(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "")")
                    .font(Typeface.text(13, relativeTo: .caption)).foregroundStyle(Palette.ink2)
            }
            .padding(20)
            .padding(.bottom, 60)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Palette.ground)
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $setting) { WakeSetup().environment(store) }
        .confirmationDialog("Disconnect Claude?", isPresented: $revoking, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { Task { await store.revoke() } }
        } message: {
            Text("Nothing your Claude sends through this link counts after this, and the link is removed from this phone. Answers already matched stay yours. To work again, make a new link here and add it to Claude.")
        }
        .confirmationDialog("Sign out of this phone?", isPresented: $forgetting, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { store.forget() }
        } message: {
            Text(store.phoneHoldsRoot
                ? "Your private link still works where Claude has it, and your identity stays on this phone. If this phone has the only copy of the link, copy it first."
                : "Your private link still works where Claude has it. If this phone has the only copy, copy it first: nothing else can bring it back.")
        }
    }

    private var note: Font { Typeface.text(15, relativeTo: .subheadline) }
}

/// A titled part of the account page.
private struct Part<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    init(_ title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            content
        }
    }
}

/// The one-time setup of the trigger: the task the person makes in Claude, with the prompt to give it, and the Fire
/// URL and token Claude gives back, which are pasted here and kept in the keychain.
struct WakeSetup: View {
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
