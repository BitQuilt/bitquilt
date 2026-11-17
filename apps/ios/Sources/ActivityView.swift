// What came back from Claude. The person's Claude does its work in Claude's own app, and this page shows what it did
// as the record holds it: the piece it is on now, each answer it handed back with what the answer rests on, and where
// each stands: on the record alone, read the same by another AI, or read differently with both kept. Above them is
// what waits on the person: a problem their Claude drafted, which is published once this phone's key signs it
// (Draft.swift). The store asks the tracker every few seconds while the app is in front, so the page moves by itself;
// a banner says what changed wherever the person is in the app.
import SwiftUI

struct ActivityView: View {
    @Environment(Store.self) private var store
    @State private var opened: Work.Reading?
    @State private var reading: Waiting?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if !store.waiting.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Needs your OK").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                            ForEach(store.waiting) { draft in
                                Button { reading = draft } label: { WaitingRow(waiting: draft) }.buttonStyle(.plain)
                            }
                        }
                    }
                    if !store.asks.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Sent to Claude").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                            ForEach(store.asks) { ask in
                                AskRow(ask: ask, woke: store.woke) { Task { await store.takeBack(ask) } }
                            }
                            if let run = store.run, store.asks.contains(where: { $0.handed == nil }) {
                                Link("Watch it work in Claude", destination: run)
                                    .font(Typeface.text(14, relativeTo: .footnote))
                            }
                        }
                    }
                    if store.address == nil {
                        Empty(title: "Nothing here yet",
                              about: "Your Claude does the work. This page shows each answer as it lands.",
                              button: "Set up Quilt") { store.tab = "you" }
                    } else if !store.connected, store.work?.readings.isEmpty ?? true {
                        Empty(title: "Connect Claude to start",
                              about: "Once it is connected, everything your Claude does on Quilt shows up here.",
                              button: "Connect Claude") { store.tab = "you" }
                    } else if let work = store.work {
                        let held = work.working ?? []
                        if held.isEmpty, work.readings.isEmpty, store.waiting.isEmpty {
                            Empty(title: "No answers yet",
                                  about: "Pick a problem and send your Claude. Its answer shows up here.",
                                  button: "Find a problem") { store.tab = "problems" }
                        }
                        if !held.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Working now").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
                                ForEach(held) { HeldRow(held: $0) }
                            }
                        }
                        if !work.readings.isEmpty {
                            Squares(readings: work.readings) { opened = $0 }
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Answers").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
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
                .animation(.easeInOut(duration: 0.35), value: store.waiting)
                .animation(.easeInOut(duration: 0.35), value: store.asks)
            }
            .background(Palette.ground)
            .navigationTitle("Activity")
            .refreshable { await store.look() }
            .sheet(item: $opened) { ReadingSheet(reading: $0).environment(store) }
            .sheet(item: $reading) { DraftSheet(waiting: $0).environment(store) }
            .onDisappear { store.sawActivity() }
            // `-reading first` at launch opens the newest reading and `-reading draft` the newest draft, for a run in
            // the simulator, where nothing taps.
            .onChange(of: store.pulse) {
                if UserDefaults.standard.string(forKey: "reading") == "first", opened == nil { opened = store.work?.readings.first }
                if UserDefaults.standard.string(forKey: "reading") == "draft", reading == nil { reading = store.waiting.first }
            }
        }
    }
}

/// A problem the person's Claude drafted, which waits for this phone's key.
private struct WaitingRow: View {
    let waiting: Waiting
    @Environment(Store.self) private var store

    var body: some View {
        let draft = store.root?.key.flatMap { try? Draft(waiting, root: $0.address) }
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "signature").foregroundStyle(Palette.act)
                Text("Your Claude drafted a problem").font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
            }
            if let draft {
                Text(verbatim: draft.title).font(Typeface.display(20)).foregroundStyle(Palette.ink).multilineTextAlignment(.leading)
                Text("\(draft.pieces) piece\(draft.pieces == 1 ? "" : "s"). Nothing is published until you say so.")
                    .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2).multilineTextAlignment(.leading)
            } else {
                Text("This draft cannot be read as a problem, so it cannot be published.")
                    .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.madder)
            }
            Text("Read it").font(Typeface.text(17, bold: true)).frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(Palette.act, in: RoundedRectangle(cornerRadius: 12)).foregroundStyle(Palette.actInk)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.act.opacity(0.5), lineWidth: 1.5))
    }
}

/// A draft whole, read from the text the key signs: its title, when it is done, each kind of piece with its brief,
/// and the two answers, to publish it with the phone's key or to drop it. Once published it says so, with the link.
private struct DraftSheet: View {
    let waiting: Waiting
    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var working = false
    @State private var published = false
    @State private var dropping = false

    private var read: Result<Draft, Error> {
        Result { try Draft(waiting, root: store.root?.key?.address ?? "") }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                switch read {
                case .success(let draft):
                    if published { done(draft) } else { whole(draft) }
                case .failure(let why):
                    Text("This draft cannot be published").font(Typeface.display(22)).foregroundStyle(Palette.ink)
                    Text(why.localizedDescription).font(Typeface.text()).foregroundStyle(Palette.madder)
                    Button("Drop the draft") { drop() }.buttonStyle(QuietButton())
                }
            }
            .padding(20)
        }
        .background(Palette.ground)
        .presentationDetents([.large])
        .interactiveDismissDisabled(working)
    }

    @ViewBuilder private func whole(_ draft: Draft) -> some View {
        Text(draft.replaces ? "Your Claude drafted the next version of a problem of yours" : "Your Claude drafted this problem")
            .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
        Text(verbatim: draft.title).font(Typeface.display(26)).foregroundStyle(Palette.ink)
        VStack(alignment: .leading, spacing: 6) {
            Text("The goal").font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
            Text(verbatim: draft.doneWhen).font(Typeface.text()).foregroundStyle(Palette.ink)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 12))

        Part(title: "\(draft.pieces) piece\(draft.pieces == 1 ? "" : "s")") {
            ForEach(draft.families) { family in
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: family.count > 1 ? "\(Plain.piece(family.plain)), \(family.count) pieces" : Plain.piece(family.plain))
                        .font(Typeface.text(15, bold: true, relativeTo: .subheadline)).foregroundStyle(Palette.ink)
                    Text(verbatim: family.brief).font(Typeface.text(16)).foregroundStyle(Palette.ink)
                    Text(family.check + (family.brief.contains("{") ? " The words in braces are filled in for each piece." : ""))
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
            }
        }
        if !waiting.topics.isEmpty {
            Text(verbatim: "Topics: " + waiting.topics.joined(separator: ", "))
                .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
        }
        if !waiting.left.isEmpty {
            Text("Its \(waiting.left.joined(separator: " and ")) cannot be posted from a phone yet, and \(waiting.left.count == 1 ? "was" : "were") left off.")
                .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
        }
        if let mine = store.root?.key?.address {
            Text("Publishing makes this public under your identity, \(mine.prefix(8))…\(mine.suffix(6)), for good.")
                .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
        }
        if let trouble = store.problem {
            Text(trouble).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.madder)
        }
        Button(working ? "Publishing\u{2026}" : "Publish") {
            working = true
            Task {
                published = await store.publish(draft)
                working = false
            }
        }
        .buttonStyle(ActButton())
        .disabled(working)
        Button("Not this one", role: .destructive) { dropping = true }
            .font(Typeface.text(15, relativeTo: .subheadline))
            .frame(maxWidth: .infinity)
            .disabled(working)
            .confirmationDialog("Drop this draft?", isPresented: $dropping, titleVisibility: .visible) {
                Button("Drop it", role: .destructive) { drop() }
            } message: {
                Text("Nothing is published. Your Claude can draft it again.")
            }
    }

    @ViewBuilder private func done(_ draft: Draft) -> some View {
        let link = Tracker.link(to: draft.hash, slug: draft.slug)
        VStack(alignment: .leading, spacing: 14) {
            Image(systemName: "checkmark.seal.fill").font(.system(size: 54)).foregroundStyle(Palette.done)
            Text("Published").font(Typeface.display(30)).foregroundStyle(Palette.ink)
            Text(verbatim: draft.title).font(Typeface.text(19, bold: true)).foregroundStyle(Palette.ink)
            Text("It is live under Problems. Any AI can take its pieces, and every answer is kept.")
                .font(Typeface.text()).foregroundStyle(Palette.ink2)
            ShareLink(item: link) { Text("Share its link") }.buttonStyle(QuietButton())
            Button("Done") {
                dismiss()
                store.tab = "problems"
            }
            .buttonStyle(ActButton())
        }
        .padding(.top, 30)
    }

    private func drop() {
        Task {
            await store.decline(waiting)
            dismiss()
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
        let alone = readings.filter { $0.standing == .onRecord }.count
        let differ = readings.filter { $0.standing == .differs }.count
        var parts: [String] = []
        if agreed > 0 { parts.append("\(agreed) matched") }
        if alone > 0 { parts.append("\(alone) recorded") }
        if differ > 0 { parts.append("\(differ) disagreed") }
        return parts.joined(separator: ", ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Your quilt").font(Typeface.text(17, bold: true)).foregroundStyle(Palette.ink)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 30), spacing: 6)], alignment: .leading, spacing: 6) {
                ForEach(readings) { reading in
                    ReadingSquare(reading: reading, size: 30)
                        .onTapGesture { open(reading) }
                        .accessibilityLabel("\(Plain.piece(reading.name)), \(Plain.state(reading.state))")
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

/// What the person asked of their Claude from this app (Asks.swift): waiting at the address, where it can be taken
/// back, or in Claude's hands.
private struct AskRow: View {
    let ask: Ask
    let woke: Date?
    let takeBack: () -> Void

    private var state: String {
        if let handed = ask.handed.flatMap(moment) {
            return "Picked up \(handed.formatted(.relative(presentation: .named)))."
        }
        if let woke, Date().timeIntervalSince(woke) < 600 { return "Claude was started." }
        return "Ready in your Quilt chat. Tap its button there."
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: ask.handed == nil ? "tray.and.arrow.down" : "checkmark.circle")
                .font(.system(size: 18)).foregroundStyle(ask.handed == nil ? Palette.act : Palette.doneInk)
                .frame(width: 22).padding(.top, 2)
            VStack(alignment: .leading, spacing: 4) {
                Text(ask.title).font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
                Text(state).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
            }
            Spacer(minLength: 8)
            if ask.handed == nil {
                Button("Cancel", action: takeBack)
                    .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.act)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.ground2, in: RoundedRectangle(cornerRadius: 10))
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
                Text(held.title).font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink)
                if let since = moment(held.at) {
                    // The time counts up by itself while the page is open.
                    Text("\(Plain.piece(held.name)) \u{00B7} started \(Text(since, style: .relative)) ago")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                } else {
                    Text(Plain.piece(held.name)).font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
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
    case .differs, .struck: return Palette.madderInk
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
                    Text(reading.title).font(Typeface.text(16, bold: true)).foregroundStyle(Palette.ink).lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 8)
                    if fresh {
                        Circle().fill(Palette.act).frame(width: 8, height: 8).accessibilityLabel("New")
                    }
                    if let at = moment(reading.at) {
                        Text(at.formatted(.relative(presentation: .named)))
                            .font(Typeface.text(13, relativeTo: .caption)).foregroundStyle(Palette.ink2)
                    }
                }
                Text(verbatim: Plain.piece(reading.name) + (reading.said.map { ": \($0)" } ?? ""))
                    .font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink).lineLimit(2)
                    .multilineTextAlignment(.leading)
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
                    Text(Plain.piece(reading.name)).font(Typeface.text(15, relativeTo: .subheadline)).foregroundStyle(Palette.ink2)
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
                    Part(title: "Your Claude said") {
                        ForEach(reading.fields, id: \.name) { field in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Plain.field(field.name)).font(Typeface.text(13, relativeTo: .caption)).foregroundStyle(Palette.ink2)
                                Text(verbatim: Plain.value(field.value)).font(Typeface.text()).foregroundStyle(Palette.ink).textSelection(.enabled)
                            }
                        }
                    }
                }
                if let rests = reading.rests, !rests.isEmpty {
                    Part(title: "Evidence") {
                        ForEach(rests, id: \.self) { rest in
                            VStack(alignment: .leading, spacing: 4) {
                                if let passage = rest.passage, !passage.isEmpty {
                                    Text(verbatim: "\u{201C}\(passage.prefix(400))\u{201D}").font(Typeface.text(16)).foregroundStyle(Palette.ink)
                                }
                                if let url = URL(string: rest.url), let host = url.host() {
                                    Link("\(Plain.field(rest.field)), on \(host)", destination: url).font(Typeface.text(14, relativeTo: .footnote))
                                }
                            }
                        }
                    }
                } else if reading.return != nil {
                    Text("No source given.")
                        .font(Typeface.text(14, relativeTo: .footnote)).foregroundStyle(Palette.ink2)
                }
                if let beside = reading.beside, !beside.isEmpty {
                    Part(title: "Other answers") {
                        ForEach(Array(beside.enumerated()), id: \.offset) { _, other in
                            Text(verbatim: said(other)).font(Typeface.text(16)).foregroundStyle(Palette.ink)
                        }
                    }
                }
                Link(destination: Tracker.squarePage(problem: reading.problem, piece: reading.piece)) {
                    Text("See it on the web")
                }
                .buttonStyle(QuietButton())
                if store.connected {
                    if reading.standing == .differs {
                        Button("Ask Claude to show both answers") {
                            dismiss()
                            store.handOff = HandOff(title: "See both answers", sentence: "Open \(link) on Quilt and show me the return of mine that is disputed.", phrase: "my_disputed_return", problem: reading.problem, named: reading.title)
                        }
                        .buttonStyle(QuietButton())
                    }
                    Button("Send my Claude to another piece") {
                        dismiss()
                        store.handOff = HandOff(title: "Send my Claude", sentence: "Open \(link) on Quilt and take a piece.", phrase: "take_piece", problem: reading.problem, named: reading.title)
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
        case "counted": return "\(who) answered this piece too."
        case "aside": return "\(who): kept, and not counted, since \(Plain.reason(other.why ?? "it rests on nothing where another reading rests on the record"))."
        case "struck": return "\(who): struck, since \(Plain.reason(other.why))."
        default: return "\(who): kept, and not counted here, since \(Plain.reason(other.why ?? "the readings the piece asks for stood before it"))."
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
                } else if news.kind == .asked {
                    Image(systemName: "signature").foregroundStyle(Palette.act).frame(width: 22, height: 22).padding(.top, 2)
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
