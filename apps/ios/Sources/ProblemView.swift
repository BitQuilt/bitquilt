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
    /// The two sentences that send the person's Claude here: to take a piece, and to say what the problem asks.
    private var take: HandOff {
        HandOff(title: "Send my Claude", sentence: "Open \(link) on Quilt and take a piece.", phrase: "take_piece", problem: problem.problem, named: problem.title)
    }
    private var explain: HandOff {
        HandOff(title: "Ask Claude to explain this", sentence: "Open \(link) on Quilt and tell me what it asks.", phrase: "open_problem", problem: problem.problem, named: problem.title)
    }
    /// How many pieces stand in each state: the map's own count once it is read, the list's until then.
    private var counts: [String: Int] {
        pieces.isEmpty ? problem.counts : Dictionary(grouping: pieces, by: \.state).mapValues(\.count)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text(problem.title).font(Typeface.display(26)).foregroundStyle(Palette.ink)
                VStack(alignment: .leading, spacing: 6) {
                    Text(problem.ownerName.map { "\($0)\u{2019}s goal" } ?? "The goal")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                    Text(problem.doneWhen).font(Typeface.text()).foregroundStyle(Palette.ink)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))

                VStack(alignment: .leading, spacing: 10) {
                    Text(Plain.progress(pieces: problem.pieces, counts: counts))
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
                                .accessibilityLabel("\(Plain.piece(piece.name)), \(Plain.state(piece.state))\(store.mine.contains(piece.hash) ? ", your Claude's" : "")")
                        }
                    }
                    .animation(.easeInOut(duration: 0.6), value: pieces)
                    Legend(mine: pieces.contains { store.mine.contains($0.hash) })
                    if let chosen { ChosenPiece(problem: problem, piece: chosen) }
                }

                VStack(spacing: 12) {
                    if store.connected {
                        // One tap sends, by the way the person chose; the other ways are behind the link below.
                        Button("Send my Claude") { store.send(take) }
                            .buttonStyle(ActButton())
                        Text(store.way(for: take).hint)
                            .font(Typeface.text(13, relativeTo: .caption)).foregroundStyle(Palette.ink2)
                        Button("Ask Claude to explain this") { store.send(explain) }
                            .buttonStyle(QuietButton())
                        Button("Other ways to send") { store.handOff = take }
                            .font(Typeface.text(15, relativeTo: .subheadline))
                            .padding(.top, 2)
                    } else {
                        // Quilt is not in the person's Claude yet, so a sentence would reach a Claude that cannot act on it.
                        Button(store.address == nil ? "Set up Quilt to send your Claude" : "Connect Claude to send it") {
                            store.tab = "you"
                        }
                        .buttonStyle(ActButton())
                        Text("Your Claude does the work. Connect it first, under You.")
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

/// What the colours mean, every one the map can draw, and the dot where the map carries one.
private struct Legend: View {
    let mine: Bool
    private let states = ["open", "in_flight", "needs_verify", "accepted_provisional", "accepted", "disputed"]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10, alignment: .leading)], alignment: .leading, spacing: 6) {
                ForEach(states, id: \.self) { state in
                    HStack(spacing: 5) {
                        RoundedRectangle(cornerRadius: 3).fill(Palette.square(state))
                            .overlay(RoundedRectangle(cornerRadius: 3).stroke(Palette.rule))
                            .frame(width: 12, height: 12)
                        Text(Plain.state(state))
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

/// The square under the person's finger: its name, what happened on it, and its page, where the evidence can be
/// checked. What the tracker says of the piece's kind is the rule the piece is held to, not what happened on it, so
/// it is not said here.
private struct ChosenPiece: View {
    let problem: Problem
    let piece: Piece

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(Plain.piece(piece.name)).font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
            Text(Plain.explain(piece.state))
                .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
            Link("See it on the web", destination: Tracker.squarePage(problem: problem.problem, piece: piece.hash))
                .font(Typeface.text(15, relativeTo: .subheadline))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
    }
}
