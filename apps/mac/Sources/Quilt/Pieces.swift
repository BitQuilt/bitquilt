// Pieces.swift: the parts the popover's screens are built from. The phrase row is the whole interaction: a click anywhere
// on it copies its sentence, the copy mark is always there, and a copy turns it to a check. A row about a problem shows
// the problem's title (another person's words, shown as a title and in no sentence), the phrase's own title, and the link
// folded into a chip with the short name it carries; the sentence on the clipboard is whole. The coin and the standing
// are two cells that keep their places. The away row is the switch, the cap and the week in one line.

import AppKit
import SwiftUI

// MARK: Times and links

/// An ISO time as the local clock reads it, for "pays at".
enum Clock {
    static func reading(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter().date(from: iso) ?? ISO8601DateFormatter.withFractions.date(from: iso) else { return iso }
        return date.formatted(date: .omitted, time: .shortened)
    }
}

extension ISO8601DateFormatter {
    /// The tracker's times carry fractional seconds; the plain formatter refuses them.
    static let withFractions: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

/// What the popover reads out of a quilt link.
enum Links {
    /// The short name a quilt link carries (its dn=), from a sentence that holds one; nil when it carries none.
    static func slug(in sentence: String) -> String? {
        guard let start = sentence.range(of: "quilt:"),
              let dn = sentence.range(of: "dn=", range: start.upperBound..<sentence.endIndex) else { return nil }
        let rest = sentence[dn.upperBound...]
        let end = rest.firstIndex(where: { $0 == "&" || $0.isWhitespace }) ?? rest.endIndex
        let raw = String(rest[..<end])
        return raw.isEmpty ? nil : (raw.removingPercentEncoding ?? raw)
    }

    /// A hash without its algorithm, for the few characters that tell two versions of a problem apart.
    static func bare(_ hash: String) -> String {
        hash.hasPrefix("sha256:") ? String(hash.dropFirst(7)) : hash
    }
}

// MARK: The phrase row

/// The quieter line under a found problem: how far its map has got, drawn and said, or where it was found.
struct FoundLine {
    let words: String
    /// The share of the map accepted and the share being worked, each 0 to 1; nil for a problem found on a relay with no map.
    let done: Double?
    let work: Double?
}

/// One sentence the person can say: the whole row is one button and copies it.
struct PhraseRow: View {
    let phrase: Sheet.Phrase
    let title: String
    var chip: String?
    var found: FoundLine?
    let copied: Bool
    let copy: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: copy) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(Typeface.text(13, bold: true))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if phrase.problem != nil {
                        HStack(spacing: 8) {
                            Text(phrase.title).lineLimit(1)
                            if let chip { LinkChip(text: chip, ground: hovering ? Palette.card : Palette.lift) }
                        }
                        .font(Typeface.text(12.5))
                        .foregroundStyle(Palette.ink2)
                    } else {
                        Text(phrase.say)
                            .font(Typeface.text(12.5))
                            .foregroundStyle(Palette.ink2)
                            .lineLimit(3)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let found {
                        HStack(spacing: 8) {
                            if let done = found.done { MapBar(done: done, work: found.work ?? 0) }
                            Text(found.words).lineLimit(1).truncationMode(.tail)
                        }
                        .font(Typeface.text(12))
                        .foregroundStyle(Palette.ink3)
                        .padding(.top, 2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                CopyMark(copied: copied, hovering: hovering)
            }
            .padding(.leading, 12)
            .padding(.trailing, 8)
            .padding(.vertical, 9)
            .frame(minHeight: 50)
            .background(hovering ? Palette.lift : Palette.card, in: RoundedRectangle(cornerRadius: 9))
            .overlay {
                if copied { RoundedRectangle(cornerRadius: 9).strokeBorder(Palette.done) }
            }
            .contentShape(RoundedRectangle(cornerRadius: 9))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(Text(spoken))
        .accessibilityHint(Text(copied ? "Copied" : "Copies the sentence to say to your AI"))
    }

    /// What VoiceOver reads: the title and the sentence, or for a problem the phrase's title, not its long link.
    private var spoken: String {
        phrase.problem == nil ? "\(title): \(phrase.say)" : "\(title): \(phrase.title)"
    }
}

/// The copy mark at the end of a row, and the check once it has copied.
private struct CopyMark: View {
    let copied: Bool
    let hovering: Bool

    var body: some View {
        if copied {
            Label("Copied", systemImage: "checkmark")
                .labelStyle(.titleAndIcon)
                .font(Typeface.text(12, bold: true))
                .foregroundStyle(Palette.doneInk)
                .padding(.horizontal, 4)
                .frame(height: 30)
        } else {
            Image(systemName: "doc.on.doc")
                .font(.system(size: 13))
                .foregroundStyle(hovering ? Palette.ink : Palette.ink3)
                .frame(width: 30, height: 30)
                .background(hovering ? Palette.card : Color.clear, in: RoundedRectangle(cornerRadius: 7))
        }
    }
}

/// A problem's link, folded: the short name it carries, and a few characters of its hash where two share a title.
struct LinkChip: View {
    let text: String
    var ground: Color = Palette.lift

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "link").font(.system(size: 9, weight: .semibold))
            Text(text).font(Typeface.mono(11.5)).lineLimit(1)
        }
        .foregroundStyle(Palette.ink2)
        .padding(.horizontal, 6)
        .padding(.vertical, 1)
        .background(ground, in: RoundedRectangle(cornerRadius: 5))
    }
}

/// How far a found problem's map has got: accepted in green, being worked in indigo, the rest undyed.
struct MapBar: View {
    let done: Double
    let work: Double

    var body: some View {
        GeometryReader { space in
            HStack(spacing: 0) {
                Rectangle().fill(Palette.done).frame(width: space.size.width * min(1, max(0, done)))
                Rectangle().fill(Palette.work).frame(width: space.size.width * min(1, max(0, work)))
                Spacer(minLength: 0)
            }
        }
        .frame(width: 54, height: 6)
        .background(Palette.open)
        .clipShape(Capsule())
        .overlay(Capsule().strokeBorder(Palette.thread, lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}

// MARK: The sentence to say now

/// The one sentence to say now, lifted out of its group: what is wanted from the person, else something to do.
struct SayCard: View {
    let label: String
    /// "1 of 3" when the group it came from has more.
    let count: String?
    let phrase: Sheet.Phrase
    let problemTitle: String?
    let chip: String?
    let copied: Bool
    let copy: () -> Void
    /// Copies the sentence and brings Claude Desktop forward, so the next thing is to paste; nil where Claude is not on this Mac.
    let openClaude: (() -> Void)?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(label)
                Spacer(minLength: 8)
                if let count { Text(count) }
            }
            .font(Typeface.text(12))
            .foregroundStyle(Palette.ink2)
            if phrase.problem != nil {
                Text(phrase.title).font(Typeface.text(17, bold: true))
                VStack(alignment: .leading, spacing: 4) {
                    if let problemTitle {
                        Text(problemTitle).font(Typeface.text(12.5)).lineLimit(2).fixedSize(horizontal: false, vertical: true)
                    }
                    if let chip { LinkChip(text: chip) }
                }
            } else {
                Text(phrase.say).font(Typeface.text(17, bold: true)).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Button(action: copy) {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(PrimaryButton(tint: copied ? Palette.doneInk : Palette.act))
                .accessibilityHint(Text("Copies the sentence to say to your AI"))
                if let openClaude {
                    Button(action: openClaude) { Label("Open Claude", systemImage: "bubble.left") }
                        .buttonStyle(QuietButton(bordered: true, height: 36))
                        .accessibilityHint(Text("Copies the sentence and opens Claude, ready to paste"))
                }
            }
            .padding(.top, 4)
        }
        .padding(14)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Palette.actLine))
    }
}

// MARK: Coin and standing

/// The coin and the standing as two cells that keep their places; a line under them when the day has paid or owes.
struct BalanceCells: View {
    let coin: Standing.Coin?
    let points: Standing.Points?
    let gained: Int
    let lit: Bool

    var body: some View {
        if coin == nil && points == nil {
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    cell("Coin", number: "–", dim: true, lines: [])
                    Rectangle().fill(Palette.thread).frame(width: 1)
                    cell("Standing", number: "–", dim: true, lines: [])
                }
                .fixedSize(horizontal: false, vertical: true)
                Rectangle().fill(Palette.thread).frame(height: 1)
                footer("No tracker has answered with your standing yet.")
            }
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.thread, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
        } else {
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    coinCell
                    Rectangle().fill(Palette.rule).frame(width: 1)
                    standingCell
                }
                .fixedSize(horizontal: false, vertical: true)
                if let line = dayLine {
                    Rectangle().fill(Palette.rule).frame(height: 1)
                    footer(line)
                }
            }
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.rule))
        }
    }

    @ViewBuilder private var coinCell: some View {
        if let coin {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text("Coin")
                    if gained > 0 {
                        Text("+\(gained)")
                            .font(Typeface.text(12, bold: true))
                            .foregroundStyle(Palette.doneInk)
                            .padding(.horizontal, 6)
                            .background(Palette.doneTint, in: Capsule())
                    }
                }
                .font(Typeface.text(12))
                .foregroundStyle(Palette.ink2)
                Text("\(coin.balance)")
                    .font(Typeface.display(26))
                    .foregroundStyle(lit ? Palette.doneInk : Palette.ink)
                    .contentTransition(.numericText())
                    .animation(.easeOut(duration: 0.6), value: lit)
                small("\(coin.free_vested) transferable now")
                small("\(coin.free) free to stake or pay")
            }
            .modifier(Cell())
        } else {
            cell("Coin", number: "–", dim: true, lines: ["None on these trackers yet"])
        }
    }

    @ViewBuilder private var standingCell: some View {
        if let points {
            cell("Standing", number: "\(points.standing)", dim: false, lines: [points.earned, "\(points.free) free to stake"])
        } else {
            cell("Standing", number: "–", dim: true, lines: [])
        }
    }

    /// What was gained since the app opened, and what the day owes and when it pays.
    private var dayLine: String? {
        var parts: [String] = []
        if gained > 0 { parts.append("+\(gained) since you opened Quilt.") }
        if let pending = coin?.pending, pending.amount > 0 { parts.append("\(pending.amount) owed from today, pays at \(Clock.reading(pending.pays_at)).") }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    private func cell(_ label: String, number: String, dim: Bool, lines: [String]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(Typeface.text(12)).foregroundStyle(Palette.ink2)
            Text(number).font(Typeface.display(26)).foregroundStyle(dim ? Palette.ink3 : Palette.ink)
            ForEach(lines, id: \.self) { small($0) }
        }
        .modifier(Cell())
    }

    private func small(_ words: String) -> some View {
        Text(words).font(Typeface.text(12)).foregroundStyle(Palette.ink2).fixedSize(horizontal: false, vertical: true)
    }

    private func footer(_ words: String) -> some View {
        HStack(spacing: 7) {
            Image(systemName: "clock").font(.system(size: 11))
            Text(words).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .font(Typeface.text(12))
        .foregroundStyle(Palette.ink2)
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
    }

    private struct Cell: ViewModifier {
        func body(content: Content) -> some View {
            content
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
    }
}

// MARK: Work while I'm away

/// The pinned row: the switch, the cap beside it, and what today and the week did, in one line. The promise and the full
/// week are under More; no path is shown.
struct AwayRow: View {
    let away: Away
    let busy: Bool
    let note: String?
    let change: (_ on: Bool, _ cap: Int) -> Void

    var body: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Work while I'm away")
                    .font(Typeface.text(13, bold: true))
                    .foregroundStyle(away.agent == nil ? Palette.ink2 : Palette.ink)
                Text(line).font(Typeface.text(12.5)).foregroundStyle(Palette.ink2).fixedSize(horizontal: false, vertical: true)
                if let note {
                    Text(note).font(Typeface.text(12)).foregroundStyle(Palette.warnInk).fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            if away.installed {
                Menu {
                    ForEach(AwayRow.caps, id: \.self) { n in
                        Button("\(n) a day") { change(true, n) }
                    }
                } label: {
                    Text("\(away.cap) a day").font(Typeface.text(12.5, bold: true))
                }
                .menuStyle(.button)
                .buttonStyle(.borderless)
                .fixedSize()
                .disabled(busy)
                .accessibilityLabel("Pieces a day: \(away.cap)")
            }
            Toggle("Work while I'm away", isOn: Binding(get: { away.installed }, set: { change($0, away.cap) }))
                .toggleStyle(.switch)
                .labelsHidden()
                .tint(Palette.done)
                .disabled(busy || away.agent == nil)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
    }

    static let caps = [3, 5, 10, 20]

    private var line: String {
        if away.agent == nil { return "Needs Claude Code or Codex on this Mac." }
        if away.installed { return "One piece an hour. \(away.summary.today.returned) today, \(away.summary.week.returned) this week." }
        return "Off. Your AI works only when you ask."
    }
}

// MARK: Small parts

/// Says a copy happened and where it goes, for two and a half seconds.
struct CopiedToast: View {
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "checkmark").font(.system(size: 12, weight: .bold))
            Text("Copied.").font(Typeface.text(13, bold: true))
            Text("Paste it into a chat with your AI.").font(Typeface.text(13))
            Spacer(minLength: 0)
        }
        .foregroundStyle(Palette.ground)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Palette.ink, in: RoundedRectangle(cornerRadius: 10))
        .shadow(color: .black.opacity(0.25), radius: 14, y: 6)
        .accessibilityElement(children: .combine)
    }
}

/// The search field: Return searches, Escape or the clear mark empties it.
struct SearchField: View {
    @Binding var query: String
    var focused: FocusState<Bool>.Binding
    let submit: () -> Void
    let clear: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.system(size: 12, weight: .medium)).foregroundStyle(Palette.ink3)
            TextField("Find a problem", text: $query, prompt: Text("Find a problem, or paste a link"))
                .textFieldStyle(.plain)
                .font(Typeface.text(13))
                .focused(focused)
                .onSubmit(submit)
                .onExitCommand(perform: clear)
            if !query.isEmpty {
                Button(action: clear) { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.plain)
                    .foregroundStyle(Palette.ink3)
                    .accessibilityLabel("Clear the search")
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(Palette.card, in: RoundedRectangle(cornerRadius: 8))
        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(focused.wrappedValue ? Palette.act : Palette.rule, lineWidth: focused.wrappedValue ? 1.5 : 1))
    }
}

/// A group's title over its rows, with how many there are when that helps.
struct SectionHeading: View {
    let title: String
    var count: Int?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(title).font(Typeface.text(12, bold: true)).foregroundStyle(Palette.ink2)
            if let count { Text("\(count)").font(Typeface.text(12)).foregroundStyle(Palette.ink3) }
        }
        .padding(.top, 10)
        .padding(.bottom, 2)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Whether an AI has connected, at the header's right.
struct AIPill: View {
    let lit: Bool
    let words: String

    var body: some View {
        HStack(spacing: 7) {
            Circle()
                .fill(lit ? Palette.done : Color.clear)
                .overlay(Circle().strokeBorder(lit ? Color.clear : Palette.ink3, lineWidth: 1.5))
                .frame(width: 7, height: 7)
            Text(words).lineLimit(1)
        }
        .font(Typeface.text(12))
        .foregroundStyle(Palette.ink2)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .overlay(Capsule().strokeBorder(Palette.rule))
    }
}

/// The key's twelve words wait on the page: the one notice that outranks the sentence.
struct BackupNotice: View {
    let show: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Text("Your key's twelve words are not written down yet. The page shows them once.")
                .font(Typeface.text(12.5))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 4)
            Button("Show them", action: show)
                .buttonStyle(PrimaryButton(tint: Palette.warnInk, ink: Palette.ground, height: 30))
        }
        .foregroundStyle(Palette.warnInk)
        .padding(.leading, 12)
        .padding(.trailing, 10)
        .padding(.vertical, 10)
        .background(Palette.warnGround, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.warnLine))
    }
}

/// A warning in madder, with its triangle.
struct Warning: View {
    let words: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle").font(.system(size: 13)).padding(.top, 1)
            Text(words).font(Typeface.text(12.5)).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .foregroundStyle(Palette.warnInk)
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Palette.warnGround, in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.warnLine))
    }
}

/// Where the person is in setting up: the key, their AI, the first sentence.
struct SetupSteps: View {
    /// 1 or 2.
    let at: Int

    var body: some View {
        HStack(spacing: 6) {
            step(1, "Your key")
            step(2, "Your AI")
            step(3, "First sentence")
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Step \(at) of 3")
    }

    private func step(_ n: Int, _ words: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Capsule().fill(n < at ? Palette.done : n == at ? Palette.act : Palette.rule).frame(height: 4)
            Text("\(n) · \(words)")
                .font(Typeface.text(12, bold: n == at))
                .foregroundStyle(n == at ? Palette.ink : Palette.ink2)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A scroll that is as tall as what it holds, up to a cap, and fades at the foot when there is more below.
struct CappedScroll<Content: View>: View {
    let cap: CGFloat
    let content: Content
    @State private var height: CGFloat = 0

    init(cap: CGFloat, @ViewBuilder content: () -> Content) {
        self.cap = cap
        self.content = content()
    }

    var body: some View {
        ScrollView(.vertical) {
            content.background(GeometryReader { space in
                Color.clear.preference(key: HeightKey.self, value: space.size.height)
            })
        }
        .scrollIndicators(.automatic)
        .frame(height: min(max(height, 1), cap))
        .mask {
            if height > cap {
                LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.86), .init(color: .clear, location: 1)],
                               startPoint: .top, endPoint: .bottom)
            } else {
                Rectangle()
            }
        }
        .onPreferenceChange(HeightKey.self) { height = $0 }
    }
}

/// The height of what a capped scroll holds.
private struct HeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}
