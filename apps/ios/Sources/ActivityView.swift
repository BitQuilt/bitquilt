// What came back from Claude. The person's Claude does its work in Claude's own app, and this page shows what it did
// as the record holds it: the piece it is on now, each answer it handed back with what the answer rests on, and where
// each stands, whether a second AI has agreed, read it differently, or has yet to come. The store asks the tracker
// every few seconds while the app is in front, so the page moves by itself; a banner says what changed wherever the
// person is in the app.
import SwiftUI

struct ActivityView: View {
    @Environment(Store.self) private var store
    @State private var opened: Work.Reading?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if store.address == nil {
                        Empty(title: "Nothing here yet",
                              about: "Your Claude does the work, and this page shows what it did as it happens: each answer, what it rests on, and whether a second AI agreed.",
                              button: "Set up Quilt") { store.tab = "you" }
                    } else if !store.connected, store.work?.readings.isEmpty ?? true {
                        Empty(title: "Quilt is not in your Claude yet",
                              about: "Once it is, everything your Claude does on Quilt shows up here as it happens.",
                              button: "See what is left") { store.tab = "you" }
                    } else if let work = store.work {
                        let held = work.working ?? []
                        if held.isEmpty, work.readings.isEmpty {
                            Empty(title: "Your Claude has not taken a piece yet",
                                  about: "Pick a problem and send your Claude to it. When you come back, its answer is here, with what it rests on.",
                                  button: "Find a problem") { store.tab = "problems" }
                        }
                        if !held.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Now").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                                ForEach(held) { HeldRow(held: $0) }
                            }
                        }
                        if !work.readings.isEmpty {
                            Squares(readings: work.readings) { opened = $0 }
                            VStack(alignment: .leading, spacing: 10) {
                                Text("What your Claude handed back").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                                ForEach(work.readings) { reading in
                                    Button { opened = reading } label: {
                                        ReadingRow(reading: reading, fresh: store.fresh.contains(reading.key))
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                        }
                    } else {
                        ProgressView()
                    }
                }
                .padding(20)
                .padding(.bottom, 60)
                .frame(maxWidth: .infinity, alignment: .leading)
                .animation(.easeInOut(duration: 0.35), value: store.work)
            }
            .background(Palette.ground)
            .navigationTitle("Activity")
            .refreshable { await store.look() }
            .sheet(item: $opened) { ReadingSheet(reading: $0).environment(store) }
            .onDisappear { store.sawActivity() }
            // `-reading first` at launch opens the newest reading, for a run in the simulator, where nothing taps.
            .onChange(of: store.pulse) {
                if UserDefaults.standard.string(forKey: "reading") == "first", opened == nil { opened = store.work?.readings.first }
            }
        }
    }
}

/// The person's own quilt: a square for each answer their Claude handed back, the newest first, each in its piece's
/// colour, with a count of how they stand. A tap opens the reading.
private struct Squares: View {
    let readings: [Work.Reading]
    let open: (Work.Reading) -> Void

    private var counted: String {
        let agreed = readings.filter { $0.standing == .agreed || $0.standing == .recorded }.count
        let waiting = readings.filter { $0.standing == .waiting }.count
        let differ = readings.filter { $0.standing == .differs }.count
        var parts: [String] = []
        if agreed > 0 { parts.append("\(agreed) agreed") }
        if waiting > 0 { parts.append("\(waiting) waiting on a second AI") }
        if differ > 0 { parts.append("\(differ) read differently") }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Your squares").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 30), spacing: 6)], alignment: .leading, spacing: 6) {
                ForEach(readings) { reading in
                    ReadingSquare(reading: reading, size: 30)
                        .onTapGesture { open(reading) }
                        .accessibilityLabel("\(reading.name), \(words(reading.state))")
                        .accessibilityAddTraits(.isButton)
                }
            }
            if !counted.isEmpty {
                Text(counted.prefix(1).uppercased() + counted.dropFirst() + ".")
                    .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
            }
        }
    }
}

/// The page with nothing on it yet: what will be here, and the one step toward it.
private struct Empty: View {
    let title: String
    let about: String
    let button: String
    let act: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(title).font(Typeface.display(26)).foregroundStyle(Palette.ink)
            Text(about).font(Typeface.text()).foregroundStyle(Palette.ink2)
            Button(button, action: act).buttonStyle(ActButton())
        }
    }
}

/// A square that breathes: a piece being worked now.
struct Breathing: View {
    let state: String
    var size: CGFloat = 22
    @State private var dim = false

    var body: some View {
        RoundedRectangle(cornerRadius: size / 4.5)
            .fill(Palette.square(state))
            .overlay(RoundedRectangle(cornerRadius: size / 4.5).stroke(Palette.act, lineWidth: 1.5))
            .frame(width: size, height: size)
            .opacity(dim ? 0.35 : 1)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
            .onAppear { dim = true }
            .accessibilityHidden(true)
    }
}

/// A piece in Claude's hands.
private struct HeldRow: View {
    let held: Work.Held

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Breathing(state: "in_flight").padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text("Your Claude is working on a piece").font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
                Text(held.name).font(Typeface.mono()).foregroundStyle(Palette.ink)
                Text(held.title).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                if let since = moment(held.at) {
                    // The time counts up by itself while the page is open.
                    Text("Taken \(Text(since, style: .relative)) ago. Its answer shows up here when it is handed back.")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
    }
}

/// The square of a reading: its piece's colour, with a tick once another AI agreed.
struct ReadingSquare: View {
    let reading: Work.Reading
    var size: CGFloat = 22

    var body: some View {
        RoundedRectangle(cornerRadius: size / 4.5)
            .fill(Palette.square(reading.state))
            .overlay(RoundedRectangle(cornerRadius: size / 4.5).stroke(Palette.rule))
            .overlay {
                if reading.standing == .agreed {
                    Image(systemName: "checkmark").font(.system(size: size * 0.5, weight: .bold)).foregroundStyle(.white)
                }
            }
            .frame(width: size, height: size)
    }
}

/// The colour a reading's sentence is said in.
func tone(_ standing: Work.Standing) -> Color {
    switch standing {
    case .agreed, .recorded: return Palette.doneInk
    case .differs, .struck: return Palette.madder
    default: return Palette.ink2
    }
}

/// One reading in the list: its piece, the answer in a line, and where it stands.
private struct ReadingRow: View {
    let reading: Work.Reading
    let fresh: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ReadingSquare(reading: reading).padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(reading.name).font(Typeface.mono()).foregroundStyle(Palette.ink).lineLimit(1)
                    Spacer(minLength: 8)
                    if fresh {
                        Circle().fill(Palette.act).frame(width: 8, height: 8).accessibilityLabel("New")
                    }
                    if let at = moment(reading.at) {
                        Text(at.formatted(.relative(presentation: .named)))
                            .font(Typeface.text(13, relativeTo: .caption)).foregroundStyle(Palette.ink2)
                    }
                }
                Text(reading.title).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2).lineLimit(1)
                if let answer = reading.answer {
                    Text(verbatim: "It said: \(answer)").font(Typeface.text(16)).foregroundStyle(Palette.ink).lineLimit(2)
                }
                Text(verbatim: reading.story).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(tone(reading.standing))
                    .multilineTextAlignment(.leading)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

/// One reading whole: where it stands, each field as Claude gave it, the passages it rests on, the readings beside
/// it, the square's page, and the sentence that sends Claude back.
private struct ReadingSheet: View {
    let reading: Work.Reading
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    private var link: String { Tracker.link(to: reading.problem) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(reading.name).font(Typeface.mono(16)).foregroundStyle(Palette.ink)
                    Text(reading.title).font(Typeface.display(22)).foregroundStyle(Palette.ink)
                }
                HStack(alignment: .top, spacing: 12) {
                    ReadingSquare(reading: reading, size: 26)
                    Text(verbatim: reading.story).font(Typeface.text(16)).foregroundStyle(tone(reading.standing))
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))

                if !reading.fields.isEmpty {
                    Part(title: "Your Claude answered") {
                        ForEach(reading.fields, id: \.name) { field in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(field.name).font(Typeface.text(13, relativeTo: .caption)).foregroundStyle(Palette.ink2)
                                Text(verbatim: field.value).font(Typeface.text()).foregroundStyle(Palette.ink).textSelection(.enabled)
                            }
                        }
                    }
                }
                if let rests = reading.rests, !rests.isEmpty {
                    Part(title: "What it rests on") {
                        ForEach(rests, id: \.self) { rest in
                            VStack(alignment: .leading, spacing: 4) {
                                if let passage = rest.passage, !passage.isEmpty {
                                    Text(verbatim: "\u{201C}\(passage.prefix(400))\u{201D}").font(Typeface.text(16)).foregroundStyle(Palette.ink)
                                }
                                if let url = URL(string: rest.url), let host = url.host() {
                                    Link("\(rest.field), on \(host)", destination: url).font(Typeface.text(14, relativeTo: .footnote))
                                }
                            }
                        }
                    }
                } else if reading.return != nil {
                    Text("This answer names no page it rests on.")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                }
                if let beside = reading.beside, !beside.isEmpty {
                    Part(title: "Beside it") {
                        ForEach(Array(beside.enumerated()), id: \.offset) { _, other in
                            Text(verbatim: said(other)).font(Typeface.text(16)).foregroundStyle(Palette.ink)
                        }
                    }
                }
                Link(destination: Tracker.squarePage(problem: reading.problem, piece: reading.piece)) {
                    Text("Open this square's page")
                }
                .buttonStyle(QuietButton())
                if store.connected {
                    if reading.standing == .differs {
                        Button("Ask Claude to show me the readings") {
                            dismiss()
                            store.handOff = HandOff(title: "My disputed return", sentence: "Open \(link) on Quilt and show me the return of mine that is disputed.")
                        }
                        .buttonStyle(QuietButton())
                    }
                    Button("Take another piece with Claude") {
                        dismiss()
                        store.handOff = HandOff(title: "Take a piece", sentence: "Open \(link) on Quilt and take a piece.")
                    }
                    .buttonStyle(ActButton())
                }
            }
            .padding(20)
        }
        .background(Palette.ground)
        .presentationDetents([.medium, .large])
    }

    /// A reading beside this one, in a sentence.
    private func said(_ other: Work.Beside) -> String {
        let who = other.vendor == "human" ? "A person" : "An AI from \(Vendor.name(other.vendor))"
        switch other.counts {
        case "counted": return "\(who): its reading counts on this piece."
        case "aside": return "\(who): set aside, since \(other.why ?? "it rests on nothing")."
        case "struck": return "\(who): struck, since \(other.why ?? "a decision went against it")."
        default: return "\(who): kept, and counts for nothing here, since \(other.why ?? "the piece had its readings")."
        }
    }
}

/// A titled part of the sheet.
private struct Part<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title).font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            content
        }
    }
}

/// What changed, said over whatever page is in front: a tap opens the Activity page, and it leaves by itself.
struct NewsBanner: View {
    let news: News
    @Environment(Store.self) private var store

    var body: some View {
        Button {
            store.news = nil
            store.tab = "activity"
        } label: {
            HStack(alignment: .top, spacing: 12) {
                if news.kind == .took {
                    Breathing(state: news.state).padding(.top, 2)
                } else {
                    RoundedRectangle(cornerRadius: 5).fill(Palette.square(news.state))
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(Palette.rule))
                        .frame(width: 22, height: 22).padding(.top, 2)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(verbatim: news.title).font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
                    Text(verbatim: news.body).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                        .lineLimit(3).multilineTextAlignment(.leading)
                }
                Spacer(minLength: 0)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Palette.rule))
            .shadow(color: .black.opacity(0.18), radius: 14, y: 6)
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 12)
        .padding(.top, 4)
        .transition(.move(edge: .top).combined(with: .opacity))
        // The banner leaves by itself; a newer one starts the wait again.
        .task(id: news.id) {
            try? await Task.sleep(for: .seconds(7))
            if !Task.isCancelled, store.news?.id == news.id { store.news = nil }
        }
    }
}
