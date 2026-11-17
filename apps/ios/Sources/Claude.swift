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

    /// Claude where the person left it: its app by its own scheme, which opens no new chat, and its site where the
    /// app is not on this phone.
    @MainActor static var app: URL {
        URL(string: installed ? "claude://" : "https://claude.ai/")!
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

/// The other ways to send a sentence, reached from the small link under a Send button. The Send button itself goes
/// by one tap, the way the person chose; here every way is offered once, with the choice of which one the button
/// uses, a copy and the share sheet. The sentence is shown with the problem's title where its link is, and whole
/// where it is asked for.
struct HandOffSheet: View {
    let handOff: HandOff
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    @State private var asking = false
    @State private var whole = false

    /// The ways this sentence can go: a new chat always; the chat the person has where the sentence is one an ask
    /// carries; the background where they also gave this app their task's trigger.
    private var ways: [Route] {
        guard handOff.asks else { return [.new] }
        return store.wake == nil ? [.new, .chat] : [.new, .chat, .background]
    }

    var body: some View {
        @Bindable var store = store
        ScrollView {
        VStack(alignment: .leading, spacing: 16) {
            Text(handOff.title).font(Typeface.display(24)).foregroundStyle(Palette.ink)
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

            ForEach(ways) { way in
                VStack(alignment: .leading, spacing: 4) {
                    Button(asking && way != .new ? "Sending\u{2026}" : title(of: way)) { go(way) }
                        .buttonStyle(Chosen(leads: way == store.way(for: handOff)))
                        .disabled(asking)
                    if way != .new {
                        Text(way.hint).font(Typeface.text(13, relativeTo: .caption)).foregroundStyle(Palette.ink2)
                    }
                }
            }
            if !Claude.installed {
                Link("Claude is not on this phone. Get it from the App Store.", destination: Claude.appStore)
                    .font(Typeface.text(14, relativeTo: .footnote))
                    .multilineTextAlignment(.leading)
            }
            if ways.count > 1 {
                VStack(alignment: .leading, spacing: 6) {
                    Text("The Send button uses").font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    Picker("The Send button uses", selection: $store.route) {
                        ForEach(ways) { Text($0.short).tag($0) }
                    }
                    .pickerStyle(.segmented)
                }
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

    private func title(of way: Route) -> String {
        way == .new && !Claude.installed ? "Open Claude in Safari" : way.title
    }

    /// Sends the sentence by one way, this once: a new chat at once, the others once the address has kept the ask.
    private func go(_ way: Route) {
        guard way != .new else {
            store.open(handOff)
            dismiss()
            return
        }
        asking = true
        Task {
            if await store.ask(handOff, waking: way == .background) { dismiss() }
            asking = false
        }
    }
}

/// A way's button: the one that acts where it is the way the Send button uses, a quiet one otherwise.
private struct Chosen: ButtonStyle {
    let leads: Bool

    func makeBody(configuration: Configuration) -> some View {
        if leads { ActButton().makeBody(configuration: configuration) } else { QuietButton().makeBody(configuration: configuration) }
    }
}
