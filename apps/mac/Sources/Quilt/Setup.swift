// Setup.swift: the screens before the sheet. The node not up yet, or an older one answering; a home with no key, which
// gets one button that makes it and a second door for a key on a tracker; the twelve words, shown once, which the person
// confirms they wrote down before anything else is shown; and a key with no AI connected yet, as three steps: add the
// connector to Claude Desktop, open a new chat, say the first phrase. Each screen draws a quilt, sewn as far as it has got.

import AppKit
import SwiftUI

// MARK: The node

/// The node is looking, starting, being read, failed, or an older one without the sheet.
struct NodeScreen: View {
    @ObservedObject var node: Node
    let old: Bool

    var body: some View {
        VStack(spacing: 12) {
            if moving {
                TimelineView(.periodic(from: .now, by: 0.18)) { context in
                    Squares(squares: Squares.stitching(at: context.date), side: 22)
                }
                .padding(.bottom, 6)
            } else {
                Squares(squares: still, side: 22).padding(.bottom, 6)
            }
            Text(heading).font(Typeface.display(21)).multilineTextAlignment(.center)
            Text(words)
                .font(Typeface.text(13))
                .foregroundStyle(Palette.ink2)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if old {
                Button("Look again") { Task { await node.refresh() } }
                    .buttonStyle(PrimaryButton())
                    .padding(.top, 6)
            } else if failed {
                HStack(spacing: 8) {
                    Button("Try again") { Task { await node.connect() } }
                        .buttonStyle(PrimaryButton())
                    if FileManager.default.fileExists(atPath: node.logURL.path) {
                        Button("Show the log") { NSWorkspace.shared.activateFileViewerSelecting([node.logURL]) }
                            .buttonStyle(QuietButton(bordered: true, height: 36))
                    }
                }
                .padding(.top, 6)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 28)
        .padding(.top, 20)
        .padding(.bottom, 28)
    }

    private var failed: Bool {
        if case .failed = node.status { return true }
        return false
    }

    private var moving: Bool { !old && !failed }

    private var heading: String {
        if old { return "An older node is running" }
        switch node.status {
        case .probing: return "Looking for the node"
        case .starting: return "Starting the node"
        case .failed: return "The node is not answering yet"
        case .attached, .started: return "Reading the node"
        }
    }

    private var words: String {
        if old {
            return "The node on port \(node.port) is an older one, without the phrases this app shows. Quit it (it was started by something else, so Quilt leaves it running) and open Quilt again: Quilt then starts a current one."
        }
        switch node.status {
        case .probing: return "Quilt reads everything from a node on this Mac, on port \(node.port)."
        case .starting: return "None was running, so Quilt is starting one. This window fills in when it answers."
        case .failed(let why): return why
        case .attached, .started: return "The node is answering, and Quilt is reading what it knows."
        }
    }

    /// The failed node's quilt is unsewn but for one madder square; the older node's is half dyed.
    private var still: [Square] {
        if old { return (0..<9).map { $0 % 2 == 1 ? .dyed(Palette.work) : .undyed } }
        return (0..<9).map { $0 == 4 ? .dyed(Palette.madder) : .unsewn }
    }
}

extension Squares {
    /// One square dyed at a time, round the edge and into the middle, while the node is looked for.
    static func stitching(at date: Date) -> [Square] {
        let order = [0, 1, 2, 5, 8, 7, 6, 3, 4]
        let step = Int(date.timeIntervalSinceReferenceDate / 0.18) % order.count
        return (0..<9).map { i in
            let behind = (step - (order.firstIndex(of: i) ?? 0) + order.count) % order.count
            switch behind {
            case 0: return .dyed(Palette.act)
            case 1, 2: return .dyed(Palette.work)
            default: return .undyed
            }
        }
    }
}

// MARK: No key

/// A home with no key: one button that makes it, and the door for a key on a tracker brought home.
struct NoKeyScreen: View {
    @ObservedObject var node: Node
    @State private var busy = false
    @State private var importing = false
    @State private var address = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SetupSteps(at: 1)
            VStack(spacing: 12) {
                Squares(squares: (0..<9).map { $0 == 4 ? .dyed(Palette.act) : .unsewn }, side: 22)
                    .padding(.top, 10)
                Text("Make your key").font(Typeface.display(24))
                Text("Quilt signs what your AI hands in with a key of its own on this Mac. There is none yet.")
                    .font(Typeface.text(13.5))
                    .foregroundStyle(Palette.ink2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity)
            Button {
                busy = true
                Task { await node.makeKey(); busy = false }
            } label: {
                Text(busy ? "Making the key…" : "Make my key").frame(maxWidth: .infinity)
            }
            .buttonStyle(PrimaryButton(height: 40))
            .disabled(busy)
            HStack(spacing: 10) {
                Rectangle().fill(Palette.rule).frame(height: 1)
                Text("or").font(Typeface.text(12)).foregroundStyle(Palette.ink3)
                Rectangle().fill(Palette.rule).frame(height: 1)
            }
            Button {
                withAnimation(.easeOut(duration: 0.15)) { importing.toggle() }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .rotationEffect(.degrees(importing ? 90 : 0))
                    Text("I have an address on a tracker")
                    Spacer(minLength: 0)
                }
            }
            .buttonStyle(QuietButton(bordered: true, height: 36))
            .accessibilityValue(Text(importing ? "Open" : "Closed"))
            if importing {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Paste the long address your AI's connector uses, from the tracker's join page. The key moves to this Mac with the standing and coin it earned, and the address is spent.")
                        .font(Typeface.text(12.5))
                        .foregroundStyle(Palette.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    TextField("Address on a tracker", text: $address, prompt: Text("https://…/mcp/…"))
                        .textFieldStyle(.plain)
                        .font(Typeface.mono(12))
                        .padding(.horizontal, 10)
                        .frame(height: 32)
                        .background(Palette.ground, in: RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Palette.rule))
                    Button(busy ? "Bringing it home…" : "Bring my key home") {
                        busy = true
                        Task { await node.importAddress(address); busy = false }
                    }
                    .buttonStyle(QuietButton(bordered: true, bold: true))
                    .disabled(busy || address.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(12)
                .background(Palette.card, in: RoundedRectangle(cornerRadius: 10))
            }
            if let keyNote = node.keyNote {
                Text(keyNote)
                    .font(Typeface.text(12.5))
                    .foregroundStyle(Palette.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 18)
    }
}

// MARK: The twelve words

/// The twelve words, shown once: what they are, what losing them costs, and a done that waits for the person to say
/// they wrote them on paper.
struct WordsScreen: View {
    let phrase: String
    let done: () -> Void
    @State private var wrote = false
    @State private var copied = false

    private var words: [String] { phrase.split(whereSeparator: \.isWhitespace).map(String.init) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            SetupSteps(at: 1)
            VStack(alignment: .leading, spacing: 4) {
                Text("Your key is made.").font(Typeface.text(12.5, bold: true)).foregroundStyle(Palette.doneInk)
                Text("Write down these twelve words").font(Typeface.display(22)).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 6)
            Text("These twelve words are the key itself. Whoever has them can sign as you, so keep them to yourself.")
                .font(Typeface.text(13.5))
                .fixedSize(horizontal: false, vertical: true)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6, alignment: .leading), count: 3), alignment: .leading, spacing: 4) {
                ForEach(Array(words.enumerated()), id: \.offset) { index, word in
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text("\(index + 1)")
                            .font(Typeface.text(11.5))
                            .foregroundStyle(Palette.ink3)
                            .monospacedDigit()
                            .frame(width: 16, alignment: .trailing)
                        Text(word).font(Typeface.mono(14, medium: true))
                    }
                    .padding(.vertical, 5)
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 10)
            .background(Palette.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Palette.rule))
            .textSelection(.enabled)
            Warning(words: "They are shown this once. If this Mac is lost and the words are too, the key is gone, and the standing and coin it earned go with it.")
            Toggle(isOn: $wrote) {
                Text("I wrote all twelve on paper, in order.").font(Typeface.text(13, bold: true))
            }
            .toggleStyle(.checkbox)
            .tint(Palette.act)
            HStack(spacing: 8) {
                Button(copied ? "Copied" : "Copy") {
                    let board = NSPasteboard.general
                    board.clearContents()
                    board.setString(phrase, forType: .string)
                    copied = true
                }
                .buttonStyle(QuietButton())
                .foregroundStyle(Palette.ink2)
                Spacer()
                Button("I wrote them down", action: done)
                    .buttonStyle(PrimaryButton(height: 40))
                    .disabled(!wrote)
            }
            .padding(.top, 4)
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 18)
    }
}

// MARK: Connect your AI

/// A key and no AI yet: add the connector to Claude Desktop, open a new chat, say the first phrase. The node records the AI
/// that connects, and the popover changes to the sheet on its own.
struct ConnectScreen: View {
    @ObservedObject var node: Node
    let copied: String?
    let copy: (String) -> Void
    let openPage: (String?) -> Void
    @State private var busy = false

    private var installed: Bool { node.sheet?.claude.installed == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SetupSteps(at: 2)
            if node.sheet?.backup == "due" { BackupNotice { openPage("me") } }
            VStack(alignment: .leading, spacing: 4) {
                Text("Connect your AI").font(Typeface.display(22))
                Text("Your AI works Quilt through its connector.").font(Typeface.text(13.5)).foregroundStyle(Palette.ink2)
            }
            step(1, state: installed ? .done : .now, title: "Add Quilt to Claude Desktop") {
                if installed {
                    Text("Quilt is in Claude Desktop's connectors.").foregroundStyle(Palette.ink2)
                } else if node.bundleOpened {
                    HStack(alignment: .top, spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Claude Desktop is asking to install Quilt. Say yes there; nothing restarts.").fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(10)
                    .background(Palette.card, in: RoundedRectangle(cornerRadius: 8))
                } else {
                    Text("Claude opens and asks once, and nothing restarts.").foregroundStyle(Palette.ink2)
                    Button(busy ? "Opening Claude…" : "Add Quilt to Claude Desktop") {
                        busy = true
                        Task { await node.installConnector(); busy = false }
                    }
                    .buttonStyle(PrimaryButton())
                    .disabled(busy)
                }
                if node.claudeMissing {
                    Text("Claude Desktop is not on this Mac. It is at claude.ai/download. An address on a tracker, pasted into claude.ai's connectors, needs no install at all.")
                        .foregroundStyle(Palette.warnInk)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let installNote = node.installNote {
                    Text(installNote).foregroundStyle(Palette.ink2).fixedSize(horizontal: false, vertical: true)
                }
            }
            step(2, state: installed ? .now : .later, title: "Open Claude and start a new chat") {
                if installed && node.hasClaude {
                    Button { node.openClaude() } label: { Label("Open Claude", systemImage: "bubble.left") }
                        .buttonStyle(QuietButton(bordered: true))
                }
            }
            if let first = node.sheet?.first {
                step(3, state: .later, title: "Say this") {
                    PhraseRow(phrase: first, title: first.title, copied: copied == first.say) { copy(first.say) }
                }
            }
            Text("When your AI answers, this window changes to the phrases you can say. Another AI app connects to the same connector over stdio; the README beside the executable says how.")
                .font(Typeface.text(12))
                .foregroundStyle(Palette.ink2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 20)
        .padding(.top, 4)
        .padding(.bottom, 18)
    }

    private enum StepState { case done, now, later }

    private func step<Content: View>(_ n: Int, state: StepState, title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                switch state {
                case .done:
                    Circle().fill(Palette.done)
                    Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(Color.white)
                case .now:
                    Circle().fill(Palette.act)
                    Text("\(n)").font(Typeface.text(12, bold: true)).foregroundStyle(Palette.actInk)
                case .later:
                    Circle().strokeBorder(Palette.rule, lineWidth: 1.5)
                    Text("\(n)").font(Typeface.text(12, bold: true)).foregroundStyle(Palette.ink2)
                }
            }
            .frame(width: 24, height: 24)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 8) {
                Text(title).font(Typeface.text(13, bold: true))
                content()
            }
            .font(Typeface.text(12.5))
            .padding(.top, 3)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
