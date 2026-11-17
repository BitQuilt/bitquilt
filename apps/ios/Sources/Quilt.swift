// The quilt, drawn one way everywhere: a square of a problem's map, of a row in the list of problems, of the person's
// own quilt and of a banner is the same patch, coloured by its piece's state and stitched round its edge. A patch
// swells for a moment when its state changes, so an answer landing or a match being made is seen where it happens,
// and breathes while the person's Claude holds its piece. Where the phone asks for less motion, nothing moves.
import SwiftUI

/// One square of a quilt.
struct Patch: View {
    let state: String
    /// The side in points; nil lets the patch fill the cell it is given.
    var size: CGFloat?
    /// The person's Claude answered or holds this piece.
    var mine = false
    /// The person's Claude holds this piece now.
    var held = false
    /// The square under the person's finger.
    var chosen = false
    /// Another AI matched the answer this square stands for.
    var matched = false
    @Environment(\.accessibilityReduceMotion) private var still

    private var side: CGFloat { size ?? 40 }
    private var corner: CGFloat { max(3, side / 4.5) }
    /// The thread: light on the dark squares, dark on the light ones.
    private var thread: Color {
        ["accepted", "recorded", "disputed", "challenged"].contains(state) ? .white.opacity(0.5) : Palette.ink.opacity(0.18)
    }

    var body: some View {
        RoundedRectangle(cornerRadius: corner)
            .fill(Palette.square(state))
            .overlay {
                // The stitching, on squares big enough to carry it.
                if side >= 20 {
                    RoundedRectangle(cornerRadius: max(2, corner - 2))
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .foregroundStyle(thread)
                        .padding(side >= 34 ? 4 : 3)
                }
            }
            .overlay(RoundedRectangle(cornerRadius: corner).stroke(chosen ? Palette.ink : Palette.rule, lineWidth: chosen ? 2.5 : 1))
            .overlay {
                if matched {
                    Image(systemName: "checkmark").font(.system(size: side * 0.42, weight: .bold)).foregroundStyle(.white)
                } else if mine {
                    Circle().fill(Palette.ink).frame(width: max(5, side * 0.16), height: max(5, side * 0.16))
                }
            }
            .frame(width: size, height: size)
            .aspectRatio(1, contentMode: .fit)
            .animation(still ? nil : .easeInOut(duration: 0.5), value: state)
            .modifier(Swell(state: state, still: still))
            .modifier(Breath(held: held && !still))
    }
}

/// A patch swells once when its state changes: an answer landed, a match was made.
private struct Swell: ViewModifier {
    let state: String
    let still: Bool

    func body(content: Content) -> some View {
        if still {
            content
        } else {
            content.phaseAnimator([false, true, false], trigger: state) { view, big in
                view.scaleEffect(big ? 1.22 : 1)
            } animation: { _ in .spring(duration: 0.3, bounce: 0.45) }
        }
    }
}

/// A patch the person's Claude holds now breathes.
private struct Breath: ViewModifier {
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

/// A problem as a strip of small patches, for its row in the list: every piece where the problem is small enough,
/// and the same proportions where it is not, the furthest along first. A state with any piece in it keeps a patch,
/// so one disagreement in a thousand pieces still shows.
struct QuiltStrip: View {
    let pieces: Int
    let counts: [String: Int]
    private let most = 36
    private static let order = [
        ["accepted"], ["accepted_provisional", "recorded"], ["disputed", "challenged"],
        ["needs_verify", "recording", "judging"], ["in_flight", "sealed"],
    ]

    /// The states to draw, in order. The first state of each group stands for the group.
    var patches: [String] {
        let total = max(pieces, 1)
        let shown = min(total, most)
        var out: [String] = []
        for group in Self.order {
            let n = group.reduce(0) { $0 + (counts[$1] ?? 0) }
            guard n > 0 else { continue }
            let share = max(1, Int((Double(n) / Double(total) * Double(shown)).rounded()))
            out.append(contentsOf: Array(repeating: group[0], count: share))
        }
        out = Array(out.prefix(shown))
        return out + Array(repeating: "open", count: shown - out.count)
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 13), spacing: 3)], alignment: .leading, spacing: 3) {
            ForEach(Array(patches.enumerated()), id: \.offset) { _, state in
                Patch(state: state, size: 13)
            }
        }
        .accessibilityHidden(true)
    }
}

/// Faint patches where a page has not been read yet, in place of a spinner, so the page keeps its shape.
struct Skeleton: View {
    var count = 6
    var size: CGFloat = 40
    @State private var dim = false
    @Environment(\.accessibilityReduceMotion) private var still

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: size), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: size / 4.5).fill(Palette.rule.opacity(0.5)).frame(width: size, height: size)
            }
        }
        .opacity(dim ? 0.45 : 1)
        .animation(still ? nil : .easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: dim)
        .onAppear { dim = !still }
        .accessibilityLabel("Loading")
    }
}
