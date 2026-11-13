// One problem: the owner's statement of when it is done, quoted as theirs, the map of its pieces, and the two
// sentences that send the person's Claude to it.
import SwiftUI

struct ProblemView: View {
    let problem: Problem
    @Environment(Store.self) private var store
    @State private var pieces: [Piece] = []
    @State private var chosen: Piece?
    @State private var trouble: String?

    private var link: String { Tracker.link(to: problem) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(problem.title).font(Typeface.display(26)).foregroundStyle(Palette.ink)
                VStack(alignment: .leading, spacing: 6) {
                    Text(problem.ownerName.map { "Done, in the words of \($0), when:" } ?? "Done, in its owner's words, when:")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    Text(problem.doneWhen).font(Typeface.text()).foregroundStyle(Palette.ink)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 10) {
                    Text("\(problem.accepted) of \(problem.pieces) pieces settled")
                        .font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                    if let trouble {
                        Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madder)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 26), spacing: 6)], spacing: 6) {
                        ForEach(pieces) { piece in
                            RoundedRectangle(cornerRadius: 5)
                                .fill(Palette.square(piece.state))
                                .overlay(RoundedRectangle(cornerRadius: 5).stroke(chosen == piece ? Palette.ink : Palette.rule, lineWidth: chosen == piece ? 2 : 1))
                                .aspectRatio(1, contentMode: .fit)
                                .onTapGesture { chosen = chosen == piece ? nil : piece }
                                .accessibilityLabel("\(piece.name), \(words(piece.state))")
                        }
                    }
                    Legend()
                    if let chosen { ChosenPiece(problem: problem, piece: chosen) }
                }

                VStack(spacing: 12) {
                    Button("Take a piece with Claude") {
                        store.handOff = HandOff(title: "Take a piece", sentence: "Open \(link) on Quilt and take a piece.")
                    }
                    .buttonStyle(ActButton())
                    Button("Ask Claude what it asks") {
                        store.handOff = HandOff(title: "Open a problem", sentence: "Open \(link) on Quilt and tell me what it asks.")
                    }
                    .buttonStyle(QuietButton())
                    if !store.connected {
                        Text("Your Claude needs Quilt added before it can take a piece. The You tab has the one step.")
                            .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    }
                }
            }
            .padding(20)
            .padding(.bottom, 60)
        }
        .background(Palette.ground)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            pieces = try await Tracker.state(of: problem.problem).pieces
            trouble = nil
        } catch {
            trouble = error.localizedDescription
        }
    }
}

/// A state in plain words.
func words(_ state: String) -> String {
    switch state {
    case "accepted": return "accepted"
    case "accepted_provisional": return "accepted, and open to challenge"
    case "open": return "open"
    case "in_flight": return "being worked"
    case "needs_verify": return "waiting on a second reading"
    case "recording": return "taking readings"
    case "recorded": return "recorded, every reading kept"
    default: return state.replacingOccurrences(of: "_", with: " ")
    }
}

/// What the colours mean.
private struct Legend: View {
    private let entries: [(String, String)] = [("open", "Open"), ("needs_verify", "Being read"), ("accepted_provisional", "Agreed"), ("accepted", "Settled")]

    var body: some View {
        HStack(spacing: 14) {
            ForEach(entries, id: \.0) { state, label in
                HStack(spacing: 5) {
                    RoundedRectangle(cornerRadius: 3).fill(Palette.square(state))
                        .overlay(RoundedRectangle(cornerRadius: 3).stroke(Palette.rule))
                        .frame(width: 12, height: 12)
                    Text(label)
                }
            }
        }
        .font(Typeface.text(13, relativeTo: .caption))
        .foregroundStyle(Palette.ink2)
    }
}

/// The square under the person's finger: its name, its state, and its page, where the evidence can be checked.
private struct ChosenPiece: View {
    let problem: Problem
    let piece: Piece

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(piece.name).font(Typeface.mono()).foregroundStyle(Palette.ink)
            Text(words(piece.state).prefix(1).uppercased() + words(piece.state).dropFirst() + (piece.says.map { ": \($0)." } ?? "."))
                .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
            Link("Open this square's page", destination: Tracker.squarePage(problem: problem.problem, piece: piece.hash))
                .font(Typeface.text(15, relativeTo: .subheadline))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
    }
}
