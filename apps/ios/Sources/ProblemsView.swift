// The problems the tracker carries, searched by every word, each a row with how far it has got.
import SwiftUI

struct ProblemsView: View {
    @State private var problems: [Problem] = []
    @State private var words = ""
    @State private var trouble: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            List {
                if let trouble {
                    Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madder)
                }
                if loaded && problems.isEmpty && trouble == nil {
                    Text(words.isEmpty ? "The tracker carries no problem yet." : "No problem holds every one of those words.")
                        .font(Typeface.text()).foregroundStyle(Palette.ink2)
                }
                ForEach(problems) { problem in
                    NavigationLink(value: problem) { ProblemRow(problem: problem) }
                        .listRowBackground(Palette.ground2)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.ground)
            .navigationTitle("Problems")
            .navigationDestination(for: Problem.self) { ProblemView(problem: $0) }
            .searchable(text: $words, prompt: "Words from a title or a topic")
            .task(id: words) {
                // A pause while the person is still typing.
                if loaded { try? await Task.sleep(for: .milliseconds(350)) }
                guard !Task.isCancelled else { return }
                await load()
            }
            .refreshable { await load() }
        }
    }

    private func load() async {
        do {
            problems = try await Tracker.problems(matching: words)
            trouble = nil
        } catch is CancellationError {
        } catch let error as URLError where error.code == .cancelled {
        } catch {
            trouble = error.localizedDescription
        }
        loaded = true
    }
}

/// One problem: its title, who published it, and its squares so far against its pieces.
struct ProblemRow: View {
    let problem: Problem

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(problem.title).font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            ProgressView(value: Double(problem.accepted), total: Double(max(problem.pieces, 1)))
                .tint(Palette.done)
            HStack {
                Text("\(problem.accepted) of \(problem.pieces) pieces settled")
                Spacer()
                if let owner = problem.ownerName { Text(owner).lineLimit(1) }
            }
            .font(Typeface.text(14, relativeTo: .footnote))
            .foregroundStyle(Palette.ink2)
        }
        .padding(.vertical, 6)
    }
}
