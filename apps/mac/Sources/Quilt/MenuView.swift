// MenuView.swift: the popover under the menu-bar icon. A search field, what is wanted from the person, the problems
// they keep and opened lately, the node's standing, and three buttons. Everything that is an act opens the page, where
// the person's own hand does it; the popover itself writes nothing.

import SwiftUI

struct MenuView: View {
    @ObservedObject var node: Node
    @ObservedObject var page: PageWindow
    @State private var query = ""
    @State private var results: [SearchResult] = []
    /// What the search area says when it has no list to show: searching, nothing matched, or what went wrong.
    @State private var note: String?
    @FocusState private var searchFocused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Search for a problem", text: $query)
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                .onSubmit(submit)
            if let note {
                Text(note).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }
            if !results.isEmpty {
                ScrollView {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(results) { found in
                            row(found.title, detail(found)) { open("open=\(found.problem)") }
                        }
                    }
                }
                .frame(maxHeight: 280)
            }
            if !node.attention.isEmpty {
                Divider()
                heading("Wanted from you")
                ForEach(Array(node.attention.enumerated()), id: \.offset) { pair in
                    row(wanted(pair.element), nil) { open("open=\(pair.element.problem)") }
                }
            }
            let keeping = node.keeping
            if !keeping.isEmpty {
                Divider()
                heading("Keeping")
                ForEach(keeping) { kept in row(kept.title, nil) { open("open=\(kept.hash)") } }
            }
            let lately = node.openedLately
            if !lately.isEmpty {
                Divider()
                heading("Opened lately")
                ForEach(lately) { opened in row(opened.title, nil) { open("open=\(opened.hash)") } }
            }
            Divider()
            VStack(alignment: .leading, spacing: 2) {
                if !node.who.isEmpty { Text(node.who) }
                Text(node.statusText)
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            HStack {
                Button("Something to do") { open("any") }
                Button("Open the page") { open(nil) }
                Spacer()
                Button("Quit Quilt") { NSApplication.shared.terminate(nil) }
            }
        }
        .padding(12)
        .frame(width: 360)
        .onAppear {
            Task { await node.refresh() }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { searchFocused = true }
        }
    }

    private func heading(_ words: String) -> some View {
        Text(words).font(.subheadline).fontWeight(.semibold)
    }

    /// One clickable line: a title, and under it a quieter line when there is one.
    private func row(_ title: String, _ detail: String?, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).lineLimit(2)
                if let detail { Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// The quieter line under a result: slug, the owner's address shortened, topics, and the map's counts or where it was found.
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
        return parts.joined(separator: " · ")
    }

    /// One line for something wanted: the piece in its problem, and the reason in words.
    private func wanted(_ item: AttentionItem) -> String {
        let reason: String
        switch item.why {
        case "rank": reason = "you are drawn to judge"
        case "verdict": reason = "a verdict is wanted from you"
        case "disputed": reason = "a return of yours is disputed"
        case "person": reason = "a piece wants a person"
        default: reason = item.why
        }
        let what = item.name.map { "\($0) in \(item.title)" } ?? item.title
        return "\(what): \(reason)"
    }

    private func open(_ fragment: String?) {
        page.open(node.pageURL(fragment: fragment))
    }

    /// Return in the field: a link opens the page on it; words go to the search route and the results are listed here.
    private func submit() {
        let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let lowered = text.lowercased()
        if ["quilt:", "sha256:", "http://", "https://"].contains(where: { lowered.hasPrefix($0) }) {
            open("open=\(text)")
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
