// MenuView.swift: the popover under the menu-bar icon. The person sits in a chat and their AI holds the connector, so
// what this window gives them is a sentence to say, not a button to press. Its header says whether their AI is connected;
// under it, one screen by the state the node reports (phrases.ts in the client): the node not up yet, a home with no key,
// the twelve words once, a key with no AI connected yet, or the sheet. The sheet reads top to bottom as a glance: the coin
// and the standing, the one sentence to say now (the sheet's first phrase, lifted out of its group), a search, then the
// groups in the node's order, scrolling; the switch for the hourly run while away and the footer stay pinned. A search
// folds the top away until the field is cleared. More holds the page, the full away settings, the coin's slash commands
// and what is where on this Mac. A click on a phrase copies it. The popover signs nothing.

import AppKit
import SwiftUI

struct MenuView: View {
    @ObservedObject var node: Node
    @ObservedObject var page: PageWindow
    @State private var query = ""
    @State private var results: [SearchResult] = []
    @State private var searching = false
    /// What the search says when it has no list to show: nothing matched, or what went wrong.
    @State private var note: String?
    /// The sentence copied a moment ago, so its row and the toast can say so.
    @State private var copied: String?
    @State private var more = false
    @State private var busy = false
    @State private var addressCopied = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if more { moreHeader } else { header }
            if more {
                morePanel
            } else if let words = node.newPhrase {
                WordsScreen(phrase: words) { node.forgetPhrase() }
            } else {
                switch node.screen {
                case .down: NodeScreen(node: node, old: false)
                case .old: NodeScreen(node: node, old: true)
                case .noKey: NoKeyScreen(node: node)
                case .noConnector: ConnectScreen(node: node, copied: copied, copy: copy, openPage: showPage)
                case .connected: connected
                }
            }
            if node.newPhrase == nil || more { footer }
        }
        .frame(width: 380)
        .background(Palette.ground)
        .foregroundStyle(Palette.ink)
        .font(Typeface.text(13))
        .overlay(alignment: .bottom) {
            if copied != nil {
                CopiedToast()
                    .padding(.horizontal, 16)
                    .padding(.bottom, 60)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .onAppear {
            node.watchBalance(open: true)
            Task { await node.refresh() }
        }
        .onDisappear {
            node.watchBalance(open: false)
            more = false
        }
    }

    // MARK: The header

    private var header: some View {
        HStack(spacing: 10) {
            Squares(squares: Squares.mark, side: 5)
            Text("Quilt").font(Typeface.display(19))
            if let name = node.me?.name ?? node.sheet?.name, !name.isEmpty {
                Text(name).foregroundStyle(Palette.ink2).lineLimit(1)
            }
            Spacer(minLength: 8)
            switch node.screen {
            case .connected: AIPill(lit: true, words: "Your AI is connected")
            case .noConnector: AIPill(lit: false, words: "No AI connected yet")
            default: EmptyView()
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 12)
    }

    private var moreHeader: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                Button { more = false } label: { Label("Back", systemImage: "chevron.left") }
                    .buttonStyle(QuietButton(height: 30))
                    .foregroundStyle(Palette.ink2)
                Text("More").font(Typeface.display(19))
                Spacer()
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 10)
            Rectangle().fill(Palette.rule).frame(height: 1)
        }
    }

    // MARK: Connected: the sheet

    @ViewBuilder private var connected: some View {
        if let sheet = node.sheet {
            let lifted = sheet.groups.first?.phrases.first
            let twins = MenuView.twins(sheet.groups.flatMap(\.phrases))
            VStack(alignment: .leading, spacing: 12) {
                if !searchActive {
                    if sheet.backup == "due" { BackupNotice { showPage("me") } }
                    BalanceCells(coin: node.coin, points: node.points, gained: node.gained, lit: node.risenLately)
                    if let lifted, let group = sheet.groups.first {
                        SayCard(label: group.title == "To start" ? "Say this to your AI" : group.title,
                                count: group.phrases.count > 1 && group.title != "To start" ? "1 of \(group.phrases.count)" : nil,
                                phrase: lifted,
                                problemTitle: lifted.problem.map { _ in title(of: lifted) },
                                chip: chip(of: lifted, twins: twins),
                                copied: copied == lifted.say,
                                copy: { copy(lifted.say) },
                                openClaude: node.hasClaude ? { copy(lifted.say); node.openClaude() } : nil)
                    }
                }
                SearchField(query: $query, focused: $searchFocused, submit: submit, clear: clearSearch)
            }
            .padding(.horizontal, 16)
            CappedScroll(cap: scrollCap) {
                VStack(alignment: .leading, spacing: 6) {
                    if searchActive {
                        found(sheet)
                    } else {
                        ForEach(sheet.groups) { group in
                            let phrases = group.phrases.filter { $0.say != lifted?.say }
                            if !phrases.isEmpty {
                                SectionHeading(title: group.title, count: phrases.count > 2 ? phrases.count : nil)
                                ForEach(phrases) { phrase in
                                    PhraseRow(phrase: phrase, title: title(of: phrase), chip: chip(of: phrase, twins: twins),
                                              copied: copied == phrase.say) { copy(phrase.say) }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 4)
                .padding(.bottom, 14)
            }
            .padding(.top, 4)
            if let away = node.away, !searchActive {
                Rectangle().fill(Palette.rule).frame(height: 1)
                AwayRow(away: away, busy: busy, note: node.awayNote) { on, cap in
                    busy = true
                    Task { await node.setAway(on: on, cap: cap); busy = false }
                }
            }
        }
    }

    /// The search's own list: asking, nothing, what went wrong, or what was found, each a phrase to take a piece.
    @ViewBuilder private func found(_ sheet: Sheet) -> some View {
        if searching {
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Asking the trackers and relays this client knows.").font(Typeface.text(12.5)).foregroundStyle(Palette.ink2)
            }
            .padding(.top, 14)
        } else if let note {
            VStack(spacing: 10) {
                Squares(squares: Array(repeating: .unsewn, count: 9), side: 14)
                Text(results.isEmpty && note == MenuView.nothing ? "Nothing matched" : "The search did not finish")
                    .font(Typeface.display(17))
                Text(note)
                    .font(Typeface.text(12.5))
                    .foregroundStyle(Palette.ink2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 28)
            .padding(.horizontal, 12)
        } else {
            SectionHeading(title: "Found", count: results.count)
            let take = sheet.prompts.first { $0.name == "take_piece" }?.title ?? "Take a piece"
            ForEach(results) { result in
                if let say = sheet.say("take_piece", link: result.link) {
                    let phrase = Sheet.Phrase(name: "take_piece", title: take, say: say, about: "", problem: Sheet.Problem(hash: result.problem, title: result.title))
                    PhraseRow(phrase: phrase,
                              title: result.via == "link" ? "The problem at this link" : title(of: phrase),
                              chip: chip(of: phrase, twins: []),
                              found: result.via == "link" ? nil : MenuView.line(result),
                              copied: copied == say) { copy(say) }
                }
            }
        }
    }

    // MARK: More

    private var morePanel: some View {
        CappedScroll(cap: scrollCap + 200) {
            VStack(alignment: .leading, spacing: 6) {
                SectionHeading(title: "The page")
                VStack(alignment: .leading, spacing: 10) {
                    Text("The page is where your own hand does a thing: a piece whose verifier is a person's word, a finished problem read in full, the key taken off this Mac.")
                        .font(Typeface.text(12.5))
                        .foregroundStyle(Palette.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { pageButtons }
                        VStack(alignment: .leading, spacing: 8) { pageButtons }
                    }
                    .disabled(!node.isUp)
                }
                .modifier(Panel())

                if node.screen == .connected, let away = node.away {
                    SectionHeading(title: "Work while I'm away")
                    awayDetail(away).modifier(Panel())
                }

                if node.screen == .connected, let sheet = node.sheet {
                    let coin = sheet.prompts.filter { ["pay_workers", "transfer_coin", "redeem_coin"].contains($0.name) }
                    if !coin.isEmpty {
                        SectionHeading(title: "In the chat, with the amounts asked for there")
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(coin) { prompt in
                                HStack(alignment: .firstTextBaseline, spacing: 10) {
                                    Text("/\(prompt.name)").font(Typeface.mono(12))
                                    Text(prompt.title).font(Typeface.text(12.5)).foregroundStyle(Palette.ink2)
                                    Spacer(minLength: 0)
                                }
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                if prompt.id != coin.last?.id { Rectangle().fill(Palette.rule).frame(height: 1) }
                            }
                        }
                        .background(Palette.card, in: RoundedRectangle(cornerRadius: 10))
                    }
                }

                SectionHeading(title: "This Mac")
                VStack(alignment: .leading, spacing: 0) {
                    if let address = node.me?.address ?? node.sheet?.address {
                        fact("Address") {
                            Text(address).font(Typeface.mono(12)).lineLimit(1).truncationMode(.middle).textSelection(.enabled)
                        } action: {
                            Button(addressCopied ? "Copied" : "Copy") {
                                let board = NSPasteboard.general
                                board.clearContents()
                                board.setString(address, forType: .string)
                                addressCopied = true
                                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { addressCopied = false }
                            }
                            .buttonStyle(QuietButton(height: 26))
                            .foregroundStyle(Palette.ink2)
                        }
                        Rectangle().fill(Palette.rule).frame(height: 1)
                    }
                    fact("Node") {
                        HStack(alignment: .firstTextBaseline, spacing: 7) {
                            Circle().fill(node.isUp ? Palette.done : Palette.madder).frame(width: 7, height: 7)
                            Text(nodeWords).font(Typeface.text(12.5)).fixedSize(horizontal: false, vertical: true)
                        }
                    } action: { EmptyView() }
                    Rectangle().fill(Palette.rule).frame(height: 1)
                    fact("Home") {
                        Text(MenuView.tilde(node.home)).font(Typeface.mono(12)).lineLimit(1).truncationMode(.middle)
                    } action: {
                        Button("Show") { NSWorkspace.shared.activateFileViewerSelecting([node.home]) }
                            .buttonStyle(QuietButton(height: 26))
                            .foregroundStyle(Palette.ink2)
                    }
                    Rectangle().fill(Palette.rule).frame(height: 1)
                    fact("Node log") {
                        Text(MenuView.tilde(node.logURL)).font(Typeface.mono(12)).lineLimit(1).truncationMode(.middle)
                    } action: {
                        Button("Show") { NSWorkspace.shared.activateFileViewerSelecting([node.logURL]) }
                            .buttonStyle(QuietButton(height: 26))
                            .foregroundStyle(Palette.ink2)
                            .disabled(!FileManager.default.fileExists(atPath: node.logURL.path))
                    }
                }
                .background(Palette.card, in: RoundedRectangle(cornerRadius: 10))
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 16)
        }
    }

    @ViewBuilder private var pageButtons: some View {
        Button { showPage(nil) } label: { Label("Open the page", systemImage: "arrow.up.forward.square") }
            .buttonStyle(PrimaryButton(height: 32))
        Button("Something to do at the page") { showPage("any") }
            .buttonStyle(QuietButton(bordered: true))
    }

    /// The away run in full: whether it is on and with which agent, the promise, the cap, and today's and the week's counts.
    private func awayDetail(_ away: Away) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(awayState(away)).font(Typeface.text(13, bold: true))
                Spacer()
                Toggle("Work while I'm away", isOn: Binding(get: { away.installed }, set: { on in
                    busy = true
                    Task { await node.setAway(on: on, cap: away.cap); busy = false }
                }))
                .toggleStyle(.switch)
                .labelsHidden()
                .tint(Palette.done)
                .disabled(busy || away.agent == nil)
            }
            Text("Every hour, your AI does one piece without asking. It never pays, publishes, challenges or stakes while you're away.")
                .font(Typeface.text(12.5))
                .foregroundStyle(Palette.ink2)
                .fixedSize(horizontal: false, vertical: true)
            if away.agent != nil {
                HStack(spacing: 10) {
                    Text("A day").font(Typeface.text(12.5)).foregroundStyle(Palette.ink2)
                    Picker("A day", selection: Binding(get: { away.cap }, set: { n in
                        busy = true
                        Task { await node.setAway(on: away.installed, cap: n); busy = false }
                    })) {
                        ForEach(AwayRow.caps, id: \.self) { n in Text("\(n)").tag(n) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .disabled(busy)
                }
                Rectangle().fill(Palette.rule).frame(height: 1)
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    count(away.summary.today.returned, "of \(away.cap) today", lit: false)
                    count(away.summary.week.returned, "in 7 days", lit: false)
                    count(away.summary.week.accepted, "accepted", lit: away.summary.week.accepted > 0)
                }
            }
            if let note = node.awayNote {
                Text(note).font(Typeface.text(12)).foregroundStyle(Palette.warnInk).fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func count(_ n: Int, _ words: String, lit: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("\(n)").font(Typeface.display(20)).foregroundStyle(lit ? Palette.doneInk : Palette.ink)
            Text(words).font(Typeface.text(12.5)).foregroundStyle(Palette.ink2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func awayState(_ away: Away) -> String {
        guard let agent = away.agent else { return "Needs Claude Code or Codex on this Mac" }
        let name = agent.name == "codex" ? "Codex" : "Claude Code"
        return away.installed ? "On, with \(name)" : "Off"
    }

    /// One line of what is where: a name, the thing, and what can be done with it.
    private func fact<Value: View, Action: View>(_ name: String, @ViewBuilder value: () -> Value, @ViewBuilder action: () -> Action) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Text(name).font(Typeface.text(12.5)).foregroundStyle(Palette.ink2).frame(width: 70, alignment: .leading)
            value().frame(maxWidth: .infinity, alignment: .leading)
            action()
        }
        .padding(.leading, 14)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
    }

    /// The node's status, in a sentence, with the port it answers on.
    private var nodeWords: String {
        let words = node.statusText
        let said = words.prefix(1).uppercased() + words.dropFirst()
        return node.isUp ? "\(said), on port \(node.port)" : said
    }

    // MARK: The footer

    private var footer: some View {
        VStack(spacing: 0) {
            Rectangle().fill(Palette.rule).frame(height: 1)
            HStack(spacing: 4) {
                if more {
                    if let version = MenuView.version {
                        Text("Quilt \(version)").font(Typeface.text(12)).foregroundStyle(Palette.ink3).padding(.leading, 4)
                    }
                    Spacer()
                    Button("Quit Quilt") { NSApplication.shared.terminate(nil) }
                        .buttonStyle(QuietButton(bordered: true))
                } else {
                    if node.isUp {
                        Button { showPage(nil) } label: { Label("Open the page", systemImage: "arrow.up.forward.square") }
                            .buttonStyle(QuietButton(bold: true))
                    }
                    Spacer()
                    Button("More") { more = true }
                        .buttonStyle(QuietButton())
                        .foregroundStyle(Palette.ink2)
                    Button("Quit") { NSApplication.shared.terminate(nil) }
                        .buttonStyle(QuietButton())
                        .foregroundStyle(Palette.ink2)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
        }
    }

    // MARK: Reading a phrase

    /// The row's title: the problem's own, where the phrase is about one and the library remembers it; else the phrase's.
    private func title(of phrase: Sheet.Phrase) -> String {
        guard let problem = phrase.problem else { return phrase.title }
        if problem.title.isEmpty || problem.title == problem.hash { return Links.slug(in: phrase.say) ?? "A problem" }
        return problem.title
    }

    /// The link's chip: its short name, and four characters of the hash where another problem shown has the same title.
    private func chip(of phrase: Sheet.Phrase, twins: Set<String>) -> String? {
        guard let problem = phrase.problem else { return nil }
        let hash = Links.bare(problem.hash)
        let name = Links.slug(in: phrase.say) ?? String(hash.prefix(8))
        return twins.contains(problem.title) ? "\(name) · \(hash.prefix(4))" : name
    }

    /// The titles two different problems share among the phrases shown, so their chips can tell them apart.
    static func twins(_ phrases: [Sheet.Phrase]) -> Set<String> {
        var hashes: [String: Set<String>] = [:]
        for phrase in phrases {
            if let problem = phrase.problem { hashes[problem.title, default: []].insert(problem.hash) }
        }
        return Set(hashes.filter { $0.value.count > 1 }.keys)
    }

    /// The quieter line under a found problem: the map's counts drawn and said, its topics and its owner, or where it was found.
    static func line(_ found: SearchResult) -> FoundLine {
        var parts: [String] = []
        var done: Double?
        var work: Double?
        if found.via == "relay" {
            parts.append("Found on a relay")
        } else {
            let counts = found.counts ?? [:]
            let pieces = found.pieces ?? counts.values.reduce(0, +)
            let accepted = (counts["accepted"] ?? 0) + (counts["accepted_provisional"] ?? 0)
            let worked = ["in_flight", "sealed", "needs_verify", "disputed"].reduce(0) { $0 + (counts[$1] ?? 0) }
            if pieces > 0 {
                done = Double(accepted) / Double(pieces)
                work = Double(worked) / Double(pieces)
            }
            parts.append(worked > 0 ? "\(pieces) pieces, \(accepted) accepted, \(worked) being worked" : "\(pieces) pieces, \(accepted) accepted")
        }
        if let topics = found.topics, !topics.isEmpty { parts.append(topics.prefix(2).joined(separator: ", ")) }
        if !found.owner.isEmpty { parts.append("by \(found.owner.prefix(6))…\(found.owner.suffix(4))") }
        return FoundLine(words: parts.joined(separator: " · "), done: done, work: work)
    }

    // MARK: Acts

    private var searchActive: Bool { searching || note != nil || !results.isEmpty }

    /// As tall as the screen allows under the rest of the popover, and no taller than reads at a glance.
    private var scrollCap: CGFloat {
        let screen = NSScreen.main?.visibleFrame.height ?? 900
        return min(440, max(200, screen - 480))
    }

    private static let nothing = "No problem on the trackers and relays this client knows has these words in its title, topics or statement of done."

    private static var version: String? {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
    }

    private static func tilde(_ url: URL) -> String {
        (url.path as NSString).abbreviatingWithTildeInPath
    }

    /// The sentence onto the clipboard, and the row and the toast say so for a moment.
    private func copy(_ text: String) {
        let board = NSPasteboard.general
        board.clearContents()
        board.setString(text, forType: .string)
        withAnimation(.easeOut(duration: 0.15)) { copied = text }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            if copied == text { withAnimation(.easeOut(duration: 0.2)) { copied = nil } }
        }
    }

    private func showPage(_ fragment: String?) {
        page.open(node.pageURL(fragment: fragment))
    }

    private func clearSearch() {
        query = ""
        results = []
        note = nil
        searching = false
    }

    /// Return in the field: words go to the search route and the results are listed as phrases; a link is a result of its own.
    private func submit() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return clearSearch() }
        let lowered = text.lowercased()
        if ["quilt:", "sha256:"].contains(where: { lowered.hasPrefix($0) }) {
            results = [SearchResult(problem: text, title: text, slug: "", owner: "", pieces: nil, counts: nil, topics: nil, tracker: nil, via: "link", link: text)]
            note = nil
            searching = false
            return
        }
        results = []
        note = nil
        searching = true
        Task {
            do {
                let found = try await node.api.search(text)
                guard query.trimmingCharacters(in: .whitespacesAndNewlines) == text else { return }
                results = found
                note = found.isEmpty ? MenuView.nothing : nil
            } catch {
                guard query.trimmingCharacters(in: .whitespacesAndNewlines) == text else { return }
                note = error.localizedDescription
            }
            searching = false
        }
    }
}

/// A rounded card round a group of More's controls.
private struct Panel: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 10))
    }
}
