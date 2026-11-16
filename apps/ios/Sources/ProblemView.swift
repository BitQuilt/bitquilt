// One problem: the owner's statement of when it is done, quoted as theirs, the map of its pieces, with the ones the
// person's Claude read or holds marked and the map read again as their Claude's work changes, and the two sentences
// that send the person's Claude to it, or, until Quilt is in their Claude, the way to the steps left.
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
                                // A piece the person's Claude read or holds carries a dot, and breathes while it is held.
                                .overlay {
                                    if store.mine.contains(piece.hash) {
                                        Circle().fill(Palette.ink).frame(width: 6, height: 6)
                                    }
                                }
                                .modifier(Held(held: store.holding.contains(piece.hash)))
                                .aspectRatio(1, contentMode: .fit)
                                .onTapGesture { chosen = chosen == piece ? nil : piece }
                                .accessibilityLabel("\(piece.name), \(words(piece.state))\(store.mine.contains(piece.hash) ? ", your Claude's" : "")")
                        }
                    }
                    .animation(.easeInOut(duration: 0.6), value: pieces)
                    Legend(mine: pieces.contains { store.mine.contains($0.hash) })
                    if let chosen { ChosenPiece(problem: problem, piece: chosen) }
                }

                VStack(spacing: 12) {
                    if store.connected {
                        Button("Take a piece with Claude") {
                            store.handOff = HandOff(title: "Take a piece", sentence: "Open \(link) on Quilt and take a piece.")
                        }
                        .buttonStyle(ActButton())
                        Button("Ask Claude what it asks") {
                            store.handOff = HandOff(title: "Open a problem", sentence: "Open \(link) on Quilt and tell me what it asks.")
                        }
                        .buttonStyle(QuietButton())
                    } else {
                        // Quilt is not in the person's Claude yet, so a sentence would reach a Claude that cannot act on it.
                        Button(store.address == nil ? "Set up Quilt to take a piece" : "Add Quilt to Claude to take a piece") {
                            store.tab = "you"
                        }
                        .buttonStyle(ActButton())
                        Text("Your Claude does the work, and it needs Quilt added first. The You tab shows what is left.")
                            .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    }
                }
            }
            .padding(20)
            .padding(.bottom, 60)
        }
        .background(Palette.ground)
        .navigationBarTitleDisplayMode(.inline)
        // The map is read when the page opens and again whenever the person's Claude's work changes, so a square
        // their Claude took or returned changes colour while they look.
        .task(id: store.pulse) { await load() }
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
    case "needs_verify": return "read and kept, with no square yet"
    case "recording": return "taking readings"
    case "recorded": return "recorded, every reading kept"
    default: return state.replacingOccurrences(of: "_", with: " ")
    }
}

/// A square the person's Claude holds now breathes.
private struct Held: ViewModifier {
    let held: Bool
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .opacity(held && dim ? 0.4 : 1)
            .animation(held ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: dim)
            .onAppear { dim = held }
            .onChange(of: held) { _, now in dim = now }
    }
}

/// What the colours mean, and the dot where the map carries one.
private struct Legend: View {
    let mine: Bool
    private let entries: [(String, String)] = [("open", "Open"), ("needs_verify", "Read"), ("accepted_provisional", "Agreed"), ("accepted", "Settled")]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
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
            if mine {
                HStack(spacing: 5) {
                    Circle().fill(Palette.ink).frame(width: 6, height: 6).frame(width: 12, height: 12)
                    Text("Your Claude's")
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
