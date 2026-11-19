// The problems the tracker carries, searched by every word, each a row with how far it has got. The list is read again
// as the person's Claude's work changes and when this phone publishes a problem, so a square their Claude settled or a
// problem their key signed is there when they look.
import SwiftUI

struct ProblemsView: View {
    @Environment(Store.self) private var store
    @State private var problems: [Problem] = []
    @State private var words = ""
    @State private var trouble: String?
    @State private var loaded = false
    /// The problem's page in front, which a tap pushes and a link puts there (Links.swift).
    @State private var path: [Problem] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if let trouble {
                    Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madder)
                }
                if loaded && problems.isEmpty && trouble == nil {
                    Text(words.isEmpty ? "No problems yet." : "Nothing matches. Try fewer words.")
                        .font(Typeface.text()).foregroundStyle(Palette.ink2)
                }
                if !loaded, trouble == nil {
                    Skeleton(count: 12, size: 13).listRowBackground(Palette.ground2)
                }
                ForEach(problems) { problem in
                    NavigationLink(value: problem) { ProblemRow(problem: problem, mine: store.answered[problem.problem] ?? 0) }
                        .listRowBackground(Palette.ground2)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.ground)
            .navigationTitle("Problems")
            .navigationDestination(for: Problem.self) { ProblemView(problem: $0) }
            .searchable(text: $words, prompt: "Search problems")
            .task(id: words) {
                // A pause while the person is still typing.
                if loaded { try? await Task.sleep(for: .milliseconds(350)) }
                guard !Task.isCancelled else { return }
                await load()
            }
            .refreshable { await load() }
            .onChange(of: store.pulse) { Task { await load() } }
            // A link named a problem: its page comes to the front, read by its hash where the list does not hold it.
            .task(id: store.visit) { await visit() }
        }
    }

    private func visit() async {
        guard let visit = store.visit, path.first?.problem != visit.problem else { return }
        if let known = problems.first(where: { $0.problem == visit.problem }) {
            path = [known]
        } else if let found = try? await Tracker.problem(visit.problem) {
            store.learn([found])
            path = [found]
        } else {
            trouble = "Quilt does not hold the problem that link names."
            store.visit = nil
        }
    }

    private func load() async {
        do {
            problems = ProblemsView.busyFirst(try await Tracker.problems(matching: words))
            store.learn(problems)
            trouble = nil
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            trouble = error.localizedDescription
        }
        loaded = true
    }
}

/// One problem: its title, its own strip of squares, how far it has got in a line, who published it, its topics, and
/// how many of its pieces the person's Claude has answered.
struct ProblemRow: View {
    let problem: Problem
    var mine = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(problem.title).font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            QuiltStrip(pieces: problem.pieces, counts: problem.counts)
            HStack {
                Text(Plain.progress(pieces: problem.pieces, counts: problem.counts))
                Spacer()
                if let owner = problem.ownerName { Text(owner).lineLimit(1) }
            }
            .font(Typeface.text(14, relativeTo: .footnote))
            .foregroundStyle(Palette.ink2)
            if mine > 0 || !(problem.topics ?? []).isEmpty {
                HStack(spacing: 6) {
                    if mine > 0 {
                        Text("Your Claude: \(mine)").font(Typeface.text(12, bold: true, relativeTo: .caption))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(Palette.provisional.opacity(0.5), in: Capsule())
                            .foregroundStyle(Palette.doneInk)
                    }
                    ForEach((problem.topics ?? []).prefix(3), id: \.self) { topic in
                        Text(topic).font(Typeface.text(12, relativeTo: .caption))
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .overlay(Capsule().stroke(Palette.rule))
                            .foregroundStyle(Palette.ink2)
                    }
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

extension ProblemsView {
    /// The problems with work under way first, then the untouched, then the finished, each group in the order the
    /// tracker gave.
    static func busyFirst(_ problems: [Problem]) -> [Problem] {
        func rank(_ p: Problem) -> Int {
            if p.complete { return 2 }
            return (p.counts["open"] ?? 0) < p.pieces ? 0 : 1
        }
        return problems.enumerated().sorted { (rank($0.element), $0.offset) < (rank($1.element), $1.offset) }.map(\.element)
    }
}
