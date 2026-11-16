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

    var id: String { sentence }
}

/// The sentence shown before it goes, with the ways to send it: Claude opened on it, a copy, or the share sheet.
/// Where Claude's app is not on this phone the button says where the sentence opens, and the App Store is one tap away.
struct HandOffSheet: View {
    let handOff: HandOff
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(handOff.title).font(Typeface.display(24)).foregroundStyle(Palette.ink)
            Text("This is the sentence your Claude gets. It is copied too, so you can paste it if Claude opens without it. What your Claude does with it shows up here, under Activity.")
                .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
            Text(handOff.sentence)
                .font(Typeface.text(17))
                .foregroundStyle(Palette.ink)
                .textSelection(.enabled)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.rule))
            Button(Claude.installed ? "Open Claude" : "Open Claude in Safari") {
                UIPasteboard.general.string = handOff.sentence
                store.expect()
                openURL(Claude.chat(saying: handOff.sentence))
                dismiss()
            }
            .buttonStyle(ActButton())
            if !Claude.installed {
                Link("Claude's app is not on this phone. Get it from the App Store.", destination: Claude.appStore)
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
            Spacer(minLength: 0)
        }
        .padding(20)
        .background(Palette.ground)
        .presentationDetents([.medium, .large])
    }
}
