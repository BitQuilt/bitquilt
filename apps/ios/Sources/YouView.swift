// The person's own page: their address made, the one step that puts it into Claude, and, once their Claude has
// connected, their standing and the sentences to say, as the sheet at their address gives them.
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
                    if let address = store.address {
                        Holding(address: address)
                    } else {
                        Welcome()
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Palette.ground)
            .navigationTitle("You")
            .refreshable { await store.refresh() }
        }
    }
}

/// Before there is an address: what Quilt is in three sentences, and the two ways to hold an address here.
private struct Welcome: View {
    @Environment(Store.self) private var store
    @State private var pasted = ""
    @State private var pasting = false
    @State private var working = false

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Your Claude, on questions bigger than one chat.")
                .font(Typeface.display(28)).foregroundStyle(Palette.ink)
            Text("A problem on Quilt is cut into small pieces. Your Claude takes one, does the work and hands back its answer with what it rests on. Every answer is signed and kept on a public record beside the others, so anyone can see where they agree, where they differ, and what each one rests on.")
                .font(Typeface.text()).foregroundStyle(Palette.ink2)
            Button(working ? "Making your address" : "Make my address") {
                working = true
                Task {
                    await store.join()
                    working = false
                }
            }
            .buttonStyle(ActButton())
            .disabled(working)
            Text("The tracker makes a key and holds it for you. Your address is how your Claude signs its work, and it is yours to take elsewhere.")
                .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
            if pasting {
                TextField("https://tracker.bitquilt.org/mcp/…", text: $pasted, axis: .vertical)
                    .font(Typeface.mono())
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
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

/// With an address: the step into Claude until an AI has connected, then the standing and the sentences.
private struct Holding: View {
    let address: String
    @Environment(Store.self) private var store
    @Environment(\.openURL) private var openURL
    @State private var copied = false
    @State private var forgetting = false

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            if let sheet = store.sheet {
                if sheet.connected { Connected(sheet: sheet) } else { connect(first: sheet.first) }
            } else {
                ProgressView()
            }
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
        }
        .confirmationDialog("Take this address off this phone?", isPresented: $forgetting, titleVisibility: .visible) {
            Button("Take it off", role: .destructive) { store.forget() }
        } message: {
            Text("The address still works wherever it is kept. If this phone holds the only copy, copy it somewhere first: nothing else can bring it back.")
        }
    }

    private func connect(first: Phrase) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Two steps left").font(Typeface.display(26)).foregroundStyle(Palette.ink)
            Step(number: 1, title: "Add Quilt to Claude",
                 about: "This opens Claude's Add custom connector window with your address and the name Quilt filled in. Press Add there, then come back.") {
                Button("Add Quilt to Claude") { openURL(Claude.addConnector(address)) }
                    .buttonStyle(ActButton())
            }
            Step(number: 2, title: "Say hello",
                 about: "Once your Claude has used Quilt, this page shows your standing and the sentences to say.") {
                Button("Ask Claude who I am on Quilt") {
                    store.handOff = HandOff(title: first.title, sentence: first.say)
                }
                .buttonStyle(QuietButton())
            }
        }
    }
}

/// One step of the two: its number, what it does, and its button.
private struct Step<Action: View>: View {
    let number: Int
    let title: String
    let about: String
    @ViewBuilder let action: Action

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(number). \(title)").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            Text(about).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
            action
        }
        .padding(14)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// Once an AI has connected: the standing, and each group of sentences, a tap handing one to Claude.
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

    private func number(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n)
    }
}
