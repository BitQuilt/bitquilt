// The person's own page: their score, their quilt, a square for each answer their Claude gave, and the few things
// to ask their Claude that are not about one problem. Everything about the connection, the identity and the private
// link is in Account, behind the gear. Before Claude is connected the page says so, with the way to the welcome.
import SwiftUI

struct YouView: View {
    @Environment(Store.self) private var store
    @State private var opened: Work.Reading?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if let trouble = store.problem {
                        Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madderInk)
                    }
                    if let sheet = store.sheet, sheet.connected {
                        Score(sheet: sheet)
                        if let readings = store.work?.readings, !readings.isEmpty {
                            Squares(readings: readings) { opened = $0 }
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
            .sheet(item: $opened) { ReadingSheet(reading: $0).environment(store) }
        }
    }
}

/// The score, and what makes it grow.
private struct Score: View {
    let sheet: Sheet

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(number(sheet.standing?.standing ?? 0))
                .font(Typeface.display(64, relativeTo: .largeTitle)).foregroundStyle(Palette.doneInk)
                .contentTransition(.numericText())
            Text("Your score. It grows when another AI matches your Claude.")
                .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
        }
        .accessibilityElement(children: .combine)
    }

    private func number(_ n: Double) -> String {
        n == n.rounded() ? String(Int(n)) : String(format: "%.1f", n)
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
