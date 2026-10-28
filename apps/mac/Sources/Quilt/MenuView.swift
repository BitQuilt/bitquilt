// MenuView.swift: the popover under the menu-bar icon. The person sits in a chat and their AI holds the connector, so
// what this window gives them is a sentence to say, not a button to press. It shows one of three screens, by the state
// the node reports (phrases.ts in the client): a home with no key gets one button that makes it; a key with no AI yet
// connected gets the install instructions and the first phrase to say; a connected home gets the sheet: the coin as it
// rises, what is wanted from the person, the phrases that fit what they keep, a search whose results are phrases too, and
// under More the page, the coin's prompts and Quit. A click on a phrase copies it. The popover signs nothing.

import AppKit
import SwiftUI

struct MenuView: View {
    @ObservedObject var node: Node
    @ObservedObject var page: PageWindow
    @State private var query = ""
    @State private var results: [SearchResult] = []
    /// What the search area says when it has no list to show: searching, nothing matched, or what went wrong.
    @State private var note: String?
    /// The sentence copied a moment ago, so its row can say so.
    @State private var copied: String?
    @State private var more = false
    @State private var busy = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            switch node.screen {
            case .down: down
            case .old: old
            case .noKey: noKey
            case .noConnector: noConnector
            case .connected: connected
            }
            Divider()
            moreSection
        }
        .padding(12)
        .frame(width: 380)
        .onAppear {
            node.watchBalance(open: true)
            Task { await node.refresh() }
        }
        .onDisappear { node.watchBalance(open: false) }
    }

    // MARK: The header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Quilt").font(.headline)
            if !node.who.isEmpty { Text(node.who).font(.caption).foregroundStyle(.secondary) }
            Spacer()
            Text(node.statusText).font(.caption2).foregroundStyle(.tertiary).lineLimit(1)
        }
    }

    // MARK: The node is not up

    private var down: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("The node is not answering yet.").font(.callout)
            Text(node.statusText).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            Button("Try again") { Task { await node.connect() } }
        }
    }

    /// A node answers on the port and has no sheet: one started by an older quilt, which this app did not start and does not stop.
    private var old: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("The node on port \(node.port) is an older one, without the phrases this app shows. Quit it (it was started by something else, so Quilt leaves it running) and open Quilt again: Quilt then starts a current one.")
                .font(.callout).fixedSize(horizontal: false, vertical: true)
            Button("Look again") { Task { await node.refresh() } }
        }
    }

    // MARK: No key

    private var noKey: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let phrase = node.newPhrase {
                Text("Your key is made. These twelve words are the key itself: write them down and keep them to yourself. They are shown this once.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                Text(phrase).font(.system(.body, design: .monospaced)).textSelection(.enabled).padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 6))
                HStack {
                    Button("Copy") { copy(phrase) }
                    Button("I wrote them down") { node.forgetPhrase() }.buttonStyle(.borderedProminent)
                }
            } else {
                Text("Quilt signs what your AI hands in with a key of its own on this Mac. There is none yet.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                Button(busy ? "Making the key…" : "Make my key") {
                    busy = true
                    Task { await node.makeKey(); busy = false }
                }
                .buttonStyle(.borderedProminent).disabled(busy)
                if let keyNote = node.keyNote { Text(keyNote).font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            }
        }
    }

    // MARK: A key, and no AI has connected

    private var noConnector: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let claude = node.sheet?.claude, claude.installed {
                Text("Quilt is in Claude Desktop's connectors. Open Claude, start a new chat, and say:").font(.callout).fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Your AI works Quilt through its connector. Add it to Claude Desktop, then quit Claude and open it again.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                HStack {
                    Button(busy ? "Adding…" : "Add Quilt to Claude Desktop") {
                        busy = true
                        Task { await node.installConnector(); busy = false }
                    }
                    .buttonStyle(.borderedProminent).disabled(busy)
                    if node.installed?.written == false, node.installed?.reason?.contains("running") == true {
                        Button("Write it anyway") { Task { await node.installConnector(anyway: true) } }
                    }
                }
                if let result = node.installed {
                    Text(result.written ? "Written to \(result.file). Quit Claude Desktop and open it again." : (result.reason ?? "Not written."))
                        .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                if let installNote = node.installNote { Text(installNote).font(.caption).foregroundStyle(.secondary) }
                Text("Then, in a new chat, say:").font(.callout)
            }
            if let first = node.sheet?.first { phraseRow(first) }
            Text("When your AI answers, this window changes to the phrases you can say. Another AI app connects to the same connector over stdio; the README beside the executable says how.")
                .font(.caption).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Connected: the sheet

    private var connected: some View {
        VStack(alignment: .leading, spacing: 10) {
            balance
            TextField("Find a problem", text: $query)
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                .onSubmit(submit)
            if let note {
                Text(note).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if !results.isEmpty, let sheet = node.sheet {
                heading("Found")
                ForEach(results) { found in
                    if let say = sheet.say("take_piece", link: found.link) {
                        phraseRow(Sheet.Phrase(name: "take_piece", title: found.title, say: say, about: detail(found), problem: Sheet.Problem(hash: found.problem, title: found.title)))
                    }
                }
            }
            ForEach(node.sheet?.groups ?? []) { group in
                Divider()
                heading(group.title)
                ForEach(group.phrases) { phrase in phraseRow(phrase) }
            }
        }
    }

    /// The coin, lit when it has just risen, and what was gained since the app opened; the standing beside it.
    private var balance: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if let coin = node.coin {
                Text("\(coin.balance)").font(.system(.title2, design: .rounded)).fontWeight(.semibold)
                    .foregroundStyle(node.risenLately ? Color.green : Color.primary)
                    .animation(.easeOut(duration: 0.6), value: node.risenLately)
                    .contentTransition(.numericText())
                Text("coin").font(.callout).foregroundStyle(.secondary)
                if node.gained > 0 {
                    Text("+\(node.gained) since you opened Quilt").font(.caption).foregroundStyle(.green)
                }
                Spacer()
                Text("\(coin.free_vested) transferable now · \(coin.free) free to stake or pay").font(.caption).foregroundStyle(.secondary)
                if let pending = coin.pending, pending.amount > 0 {
                    Text("\(pending.amount) owed from today, pays at \(Self.clock(pending.pays_at))").font(.caption).foregroundStyle(.secondary)
                }
            } else if let points = node.points {
                Text("standing \(points.standing), earned by work · \(points.free) free to stake").font(.callout)
                Spacer()
            } else {
                Text("No tracker has answered with your standing yet.").font(.caption).foregroundStyle(.secondary)
            }
            if node.coin != nil, let points = node.points {
                Text("· standing \(points.standing), earned by work").font(.caption).foregroundStyle(.secondary)
            }
        }
    }

    // MARK: More

    private var moreSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(more ? "Less" : "More") { more.toggle() }.buttonStyle(.plain).font(.caption).foregroundStyle(.secondary)
            if more {
                HStack {
                    Button("Open the page") { open(nil) }
                    Button("Something to do at the page") { open("any") }
                }
                .font(.caption)
                Text("The page is where your own hand does a thing: a piece whose verifier is a person's word, a finished problem read in full, the key taken off this Mac.")
                    .font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                if let sheet = node.sheet, node.screen == .connected {
                    Text("Your AI also has these as slash commands in the chat, with the amounts asked for there:").font(.caption2).foregroundStyle(.secondary)
                    ForEach(sheet.prompts.filter { ["pay_workers", "transfer_coin", "redeem_coin"].contains($0.name) }) { p in
                        Text("/\(p.name): \(p.about)").font(.caption2).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    }
                }
                Text("Home \(node.home.path) · node log \(node.logURL.path)").font(.caption2).foregroundStyle(.tertiary).lineLimit(2)
            }
            HStack {
                Spacer()
                Button("Quit Quilt") { NSApplication.shared.terminate(nil) }.font(.caption)
            }
        }
    }

    // MARK: Pieces of the view

    private func heading(_ words: String) -> some View {
        Text(words).font(.subheadline).fontWeight(.semibold)
    }

    /// One phrase: its title (the problem's, where it is about one), the sentence, and Copy. A click anywhere on it copies.
    private func phraseRow(_ phrase: Sheet.Phrase) -> some View {
        Button(action: { copy(phrase.say) }) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(phrase.problem?.title ?? phrase.title).font(.caption).fontWeight(.semibold).lineLimit(1)
                    Spacer()
                    Text(copied == phrase.say ? "Copied" : "Copy").font(.caption2).foregroundStyle(copied == phrase.say ? .green : .secondary)
                }
                Text(phrase.say).font(.callout).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                if phrase.problem != nil, !phrase.about.isEmpty, phrase.name == "take_piece", results.contains(where: { $0.problem == phrase.problem?.hash }) {
                    Text(phrase.about).font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                }
            }
            .padding(6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The quieter line under a found problem: slug, the owner's address shortened, topics, and the map's counts or where it was found.
    private func detail(_ found: SearchResult) -> String {
        var parts = [found.slug, String(found.owner.prefix(10))]
        if let topics = found.topics, !topics.isEmpty { parts.append(topics.joined(separator: ", ")) }
        if found.via == "relay" {
            parts.append("found on a relay")
        } else {
            let counts = (found.counts ?? [:]).sorted { $0.key < $1.key }
                .map { "\($0.value) \($0.key.replacingOccurrences(of: "_", with: " "))" }.joined(separator: ", ")
            parts.append(counts.isEmpty ? "\(found.pieces ?? 0) pieces" : "\(found.pieces ?? 0) pieces: \(counts)")
        }
        return parts.joined(separator: ", ")
    }

    /// The sentence onto the clipboard, and the row says so for a moment.
    /// An ISO time as the local clock reads it, for "pays at".
    static func clock(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) ?? ISO8601DateFormatter.withFractions.date(from: iso) else { return iso }
        return date.formatted(date: .omitted, time: .shortened)
    }

    private func copy(_ text: String) {
        let board = NSPasteboard.general
        board.clearContents()
        board.setString(text, forType: .string)
        copied = text
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { if copied == text { copied = nil } }
    }

    private func open(_ fragment: String?) {
        page.open(node.pageURL(fragment: fragment))
    }

    /// Return in the field: words go to the search route and the results are listed as phrases; a link is a result of its own.
    private func submit() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let lowered = text.lowercased()
        if ["quilt:", "sha256:"].contains(where: { lowered.hasPrefix($0) }) {
            results = [SearchResult(problem: text, title: text, slug: "", owner: "", pieces: nil, counts: nil, topics: nil, tracker: nil, via: "link", link: text)]
            note = nil
            return
        }
        results = []
        note = "Searching…"
        Task {
            do {
                let found = try await node.api.search(text)
                results = found
                note = found.isEmpty ? "Nothing matched on the trackers and relays this client knows." : nil
            } catch {
                note = error.localizedDescription
            }
        }
    }
}

extension ISO8601DateFormatter {
    /// The tracker's times carry fractional seconds; the plain formatter refuses them.
    static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
