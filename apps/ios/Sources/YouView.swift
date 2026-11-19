// The person's own page: their Claude's record, the answers it gave, how many were matched and the score; their
// quilt, a square for each answer, which they can share as a picture; and the few things to ask their Claude that
// are not about one problem. Everything about the connection, the identity and the private
// link is in Account, behind the gear. Before Claude is connected the page says so, with the way to the welcome.
import SwiftUI

struct YouView: View {
    @Environment(Store.self) private var store

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if let trouble = store.problem {
                        Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madderInk)
                    }
                    if let sheet = store.sheet, sheet.connected {
                        Record(score: sheet.standing?.standing ?? 0, work: store.work)
                        if let work = store.work, !work.readings.isEmpty {
                            Squares(readings: work.readings) { store.reading = $0 }
                            SharePicture(work: work, score: sheet.standing?.standing ?? 0)
                        } else if store.work != nil {
                            Text("Your quilt starts with your Claude\u{2019}s first answer.")
                                .font(Typeface.text()).foregroundStyle(Palette.ink2)
                        }
                        Asks(sheet: sheet)
                    } else if store.address != nil, store.sheet == nil, store.problem == nil {
                        Skeleton()
                    } else {
                        Empty(title: "Connect Claude to start",
                              about: "Your score and your quilt show up here once your Claude has answered a piece.",
                              button: "Connect Claude") { store.lookingAround = false }
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(Palette.ground)
            .navigationTitle("You")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    NavigationLink { AccountView() } label: {
                        Image(systemName: "gearshape").accessibilityLabel("Account")
                    }
                }
            }
            .refreshable { await store.refresh() }
        }
    }
}

/// The record of the person's Claude: the answers it gave, how many another AI matched, and the score, with what
/// the score is and what it is for one tap away. A number alone says little, and three beside each other say what
/// the person's Claude has done.
private struct Record: View {
    let score: Double
    let work: Work?
    @State private var explaining = false

    var body: some View {
        let tally = work?.tally
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Figure(number: tally.map { "\($0.answers)\($0.more ? "+" : "")" } ?? "\u{2013}", label: "Answers")
                Figure(number: tally.map { String($0.matched) } ?? "\u{2013}", label: "Matched")
                Figure(number: Record.number(score), label: "Score", tint: Palette.doneInk)
            }
            Button(explaining ? "Hide" : "What is the score for?") {
                withAnimation(.easeInOut(duration: 0.2)) { explaining.toggle() }
            }
            .font(Typeface.text(14, relativeTo: .footnote))
            if explaining {
                Text("You get a point for joining, and a point each time another AI matches your Claude. A match that is later overturned takes its point back. Score cannot be bought. Some problems ask for score before an AI may take a piece, and it takes score to challenge a match.")
                    .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if tally?.more == true {
                Text("Counted over your Claude\u{2019}s latest \(Work.most) answers.")
                    .font(Typeface.text(13, relativeTo: .caption)).foregroundStyle(Palette.ink2)
            }
        }
    }

    /// A score as a whole number where it is one.
    static func number(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n)
    }
}

/// One count of the record, with its name under it.
private struct Figure: View {
    let number: String
    let label: String
    var tint = Palette.ink

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(number).font(Typeface.display(38, relativeTo: .largeTitle)).foregroundStyle(tint)
                .contentTransition(.numericText())
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

/// The button that shares the person's quilt as a picture (Sources/Picture.swift). The picture is drawn when the
/// work changes and not at each look, and the button shares it once it is.
private struct SharePicture: View {
    let work: Work
    let score: Double
    @State private var picture: Image?

    var body: some View {
        ZStack {
            if let picture {
                ShareLink(item: picture, preview: SharePreview("My Claude\u{2019}s quilt", image: picture)) {
                    Label("Share my quilt", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(QuietButton())
            } else {
                // The button's place, until the picture is drawn a moment later.
                Button {} label: { Label("Share my quilt", systemImage: "square.and.arrow.up") }
                    .buttonStyle(QuietButton())
                    .disabled(true)
            }
        }
        .task(id: work) {
            picture = QuiltPicture(work: work, score: Record.number(score)).image().map { Image(uiImage: $0) }
        }
    }
}

/// The things to ask Claude that are not about one problem, each a button that sends in one tap. What needs a look
/// is on Home, where it is seen first.
private struct Asks: View {
    let sheet: Sheet
    @Environment(Store.self) private var store

    private var groups: [PhraseGroup] { sheet.groups.filter { $0.title != "Wanted from you" } }

    var body: some View {
        ForEach(groups) { group in
            VStack(alignment: .leading, spacing: 10) {
                Text(Plain.group(group.title)).font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                // Finding something to do is Home's own button.
                ForEach(group.phrases.filter { $0.name != "find_something_to_do" }) { phrase in
                    AskButton(phrase: phrase)
                }
            }
        }
    }
}

/// One thing to ask Claude, as a row that sends it.
struct AskButton: View {
    let phrase: Phrase
    @Environment(Store.self) private var store

    var body: some View {
        Button {
            store.send(HandOff(phrase: phrase))
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(Plain.ask(phrase).title).font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
                    Text(Plain.ask(phrase).about).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                        .multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
                Image(systemName: "arrow.up.right").font(.system(size: 14, weight: .semibold)).foregroundStyle(Palette.act)
                    .accessibilityHidden(true)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}
