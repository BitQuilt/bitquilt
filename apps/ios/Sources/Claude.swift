// The hand-offs to the person's own Claude. The app never speaks to Claude itself: it opens Claude's own pages with
// the person's address or one of the person's sentences filled in, and copies the sentence so it can be pasted.
import SwiftUI
import UIKit

enum Claude {
    /// Claude's page on the App Store.
    static let appStore = URL(string: "https://apps.apple.com/app/id6473753684")!

    /// Whether Claude's app is on this phone: it answers the scheme claude, which Info.plist names as one this app
    /// asks about. `-claude yes` or `-claude no` at launch says it for a run in the simulator.
    @MainActor static var installed: Bool {
        if let named = UserDefaults.standard.string(forKey: "claude") { return named == "yes" }
        return UIApplication.shared.canOpenURL(URL(string: "claude://")!)
    }

    /// Claude's Add custom connector window with the address and the name Quilt filled in, as the join page links it.
    static func addConnector(_ address: String) -> URL {
        URL(string: "https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=Quilt&connectorUrl="
            + component(address))!
    }

    /// A new chat with the sentence written in it.
    static func chat(saying sentence: String) -> URL {
        URL(string: "https://claude.ai/new?q=" + component(sentence))!
    }

    private static func component(_ s: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.!~*'()")
        return s.addingPercentEncoding(withAllowedCharacters: allowed) ?? s
    }
}

/// One sentence on its way to Claude.
struct HandOff: Identifiable {
    let title: String
    let sentence: String
    /// The phrase the sentence is, by its name, and the problem it names, by its hash: what an ask carries
    /// (Asks.swift). Nil where the sentence is not one an ask carries.
    var phrase: String?
    var problem: String?

    /// The problem's title, where the page that made this knew it.
    var named: String?

    var id: String { sentence }

    /// Whether the address keeps this as an ask: its phrase is one this app asks with.
    var asks: Bool { phrase.map { Ask.titles[$0] != nil } ?? false }

    /// The sentence as a person reads it: the same words, with the problem's title where its link is. A link is a
    /// hash and the places that hold it, which Claude needs and a person cannot read. The sentence that is sent is
    /// `sentence`, link and all, and the sheet shows it whole where it is asked to.
    var shown: String {
        sentence.replacingOccurrences(of: #"quilt:\S+"#, with: named.map { "\u{201C}\($0)\u{201D}" } ?? "this problem",
                                      options: .regularExpression)
    }

    /// A sentence of the sheet's, with the problem read out of it where it names one.
    init(phrase: Phrase) {
        title = Plain.ask(phrase).title
        sentence = phrase.say
        self.phrase = phrase.name
        problem = phrase.say.range(of: #"sha256:[0-9a-f]{64}"#, options: .regularExpression).map { String(phrase.say[$0]) }
    }

    init(title: String, sentence: String, phrase: String? = nil, problem: String? = nil, named: String? = nil) {
        self.title = title
        self.sentence = sentence
        self.phrase = phrase
        self.problem = problem
        self.named = named
    }
}

/// The sentence shown before it goes, with the ways to send it: Claude opened on it, a copy, or the share sheet.
/// Where Claude's app is not on this phone the button says where the sentence opens, and the App Store is one tap away.
struct HandOffSheet: View {
    let handOff: HandOff
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    @State private var asking = false
    @State private var whole = false

    /// Whether a tap here is enough: the person gave this app their task's trigger, and the sentence is one an ask
    /// carries.
    private var wakes: Bool { store.wake != nil && handOff.asks }

    private var about: String {
        if wakes { return "Your Claude does this in the background. Its answer shows up here." }
        if handOff.asks { return "Open Claude on a new chat, or use the chat you already have: this shows there as a button on Quilt\u{2019}s card." }
        return "Claude opens with this written for you to send."
    }

    var body: some View {
        ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            Text(handOff.title).font(Typeface.display(24)).foregroundStyle(Palette.ink)
            Text(about)
                .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                .fixedSize(horizontal: false, vertical: true)
            VStack(alignment: .leading, spacing: 10) {
                Text(verbatim: handOff.shown)
                    .font(Typeface.text(17))
                    .foregroundStyle(Palette.ink)
                    .fixedSize(horizontal: false, vertical: true)
                if handOff.shown != handOff.sentence {
                    if whole {
                        Text(verbatim: handOff.sentence)
                            .font(Typeface.mono(12)).foregroundStyle(Palette.ink2)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    } else {
                        Button("Show exactly what is sent") { whole = true }
                            .font(Typeface.text(14, relativeTo: .footnote))
                    }
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.rule))
            if wakes {
                Button(asking ? "Starting\u{2026}" : "Run in the background") { leave(waking: true) }
                    .buttonStyle(ActButton())
                    .disabled(asking)
                // Left and not started: the ask waits for the chat the person keeps, where Quilt's card shows it as a
                // button, so a trigger kept on this phone does not take that way from them.
                Button(asking ? "Sending\u{2026}" : "Use my existing chat") { leave(waking: false) }
                    .buttonStyle(QuietButton())
                    .disabled(asking)
                Button("Open Claude in a new chat") { open() }
                    .buttonStyle(QuietButton())
            } else {
                Button(Claude.installed ? "Open Claude" : "Open Claude in Safari") { open() }
                    .buttonStyle(ActButton())
                if handOff.asks {
                    Button(asking ? "Sending\u{2026}" : "Use my existing chat") { leave(waking: false) }
                        .buttonStyle(QuietButton())
                        .disabled(asking)
                }
            }
            if !Claude.installed {
                Link("Claude is not on this phone. Get it from the App Store.", destination: Claude.appStore)
                    .font(Typeface.text(14, relativeTo: .footnote))
                    .multilineTextAlignment(.leading)
            }
            HStack(spacing: 12) {
                Button(copied ? "Copied" : "Copy") {
                    UIPasteboard.general.string = handOff.sentence
                    copied = true
                }
                .buttonStyle(QuietButton())
                ShareLink(item: handOff.sentence) { Text("Share") }
                    .buttonStyle(QuietButton())
            }
        }
        .padding(20)
        }
        .background(Palette.ground)
        .presentationDetents([.fraction(0.72), .large])
    }

    /// Claude opened on the sentence, with the sentence copied in case Claude opens without it.
    private func open() {
        UIPasteboard.general.string = handOff.sentence
        store.expect()
        openURL(Claude.chat(saying: handOff.sentence))
        dismiss()
    }

    /// The sentence left at the address as an ask, and the person's Claude started where that was asked for.
    private func leave(waking: Bool) {
        asking = true
        Task {
            if await store.ask(handOff, waking: waking) { dismiss() }
            asking = false
        }
    }
}
