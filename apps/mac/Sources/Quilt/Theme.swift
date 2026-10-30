// Theme.swift: how the popover looks, in the site's own tokens (site/index.html): chambray and indigo ink by day, a night
// ground by night, bottle green for work done, cotton for an undyed square, and indigo as the one action colour; madder,
// which the site has not, is for what is wrong or waiting on the person's hand. Young Serif sets the name and the numbers,
// Atkinson Hyperlegible every sentence, IBM Plex Mono what is code (a link, the twelve words, a path). The three are under
// Resources/Fonts and loaded by Info.plist's ATSApplicationFontsPath; a bare `swift build` has no bundle, so each falls
// back to the system's own serif, text or monospaced face. The quilt mark, the menu-bar icon and the two button shapes
// live here too.

import AppKit
import SwiftUI

/// The colours, each a pair for a light and a dark system. Every text colour holds at least 5:1 on the ground and the card.
enum Palette {
    static let ground = pair(0xEEF0F3, 0x141A2C)
    static let card = pair(0xFFFFFF, 0x1B2238)
    static let lift = pair(0xE3E7EE, 0x262F4B)
    static let ink = pair(0x17213A, 0xE9E7E0)
    static let ink2 = pair(0x4A546B, 0xAAB0C0)
    static let ink3 = pair(0x5B6478, 0x8D94A6)
    static let rule = pair(0xCFD4DD, 0x2D3650)
    static let thread = pair(0xA9B0BD, 0x4A5470)
    static let act = pair(0x2B3F7A, 0xC9D2EC)
    static let actInk = pair(0xFFFFFF, 0x141A2C)
    static let actLine = pair(0x9AA8D0, 0x4D5F99)
    static let done = pair(0x2F6B48, 0x3F8F5E)
    static let doneInk = pair(0x2F6B48, 0x8FD3A9)
    static let doneTint = pair(0xE3EFE7, 0x1D3529)
    static let work = pair(0xC9D2EC, 0x3B4A7A)
    static let open = pair(0xF6F2EA, 0x2A3147)
    static let warnGround = pair(0xF8ECE3, 0x35251E)
    static let warnLine = pair(0xE2B899, 0x7A4A30)
    static let warnInk = pair(0x7A3A12, 0xF2C7A8)
    static let madder = pair(0xB5603A, 0xB5603A)

    private static func pair(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            Palette.rgb(appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? dark : light)
        })
    }

    private static func rgb(_ hex: UInt32) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

/// The three faces by size, each the system's own where the bundled one is not there.
enum Typeface {
    /// Young Serif: the name and the numbers.
    static func display(_ size: CGFloat) -> Font {
        face("YoungSerif-Regular", size) ?? .system(size: size, design: .serif)
    }

    /// Atkinson Hyperlegible: every sentence.
    static func text(_ size: CGFloat = 13, bold: Bool = false) -> Font {
        face(bold ? "AtkinsonHyperlegible-Bold" : "AtkinsonHyperlegible-Regular", size) ?? .system(size: size, weight: bold ? .bold : .regular)
    }

    /// IBM Plex Mono: a link's short name, the twelve words, a path.
    static func mono(_ size: CGFloat = 12, medium: Bool = false) -> Font {
        face(medium ? "IBMPlexMono-Medium" : "IBMPlexMono-Regular", size) ?? .system(size: size, weight: medium ? .medium : .regular, design: .monospaced)
    }

    private static func face(_ name: String, _ size: CGFloat) -> Font? {
        NSFont(name: name, size: size) == nil ? nil : .custom(name, size: size)
    }
}

/// One square of a drawn quilt: dyed a colour, undyed with its stitch showing, or not sewn yet.
enum Square {
    case dyed(Color)
    case undyed
    case unsewn
}

/// Nine squares, three by three, row by row: the mark, and the larger quilts the setup and waiting screens draw.
struct Squares: View {
    let squares: [Square]
    var side: CGFloat = 5

    /// The mark as the site's header draws it.
    static let mark: [Square] = [.dyed(Palette.done), .dyed(Palette.work), .undyed, .dyed(Palette.work), .dyed(Palette.done),
                                 .dyed(Palette.done), .undyed, .dyed(Palette.done), .dyed(Palette.work)]

    var body: some View {
        let gap = max(1.5, side * 0.24)
        VStack(spacing: gap) {
            ForEach(0..<3, id: \.self) { row in
                HStack(spacing: gap) {
                    ForEach(0..<3, id: \.self) { column in
                        square(row * 3 + column < squares.count ? squares[row * 3 + column] : .unsewn)
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder private func square(_ square: Square) -> some View {
        let shape = RoundedRectangle(cornerRadius: max(1, side * 0.18))
        switch square {
        case .dyed(let colour):
            shape.fill(colour).frame(width: side, height: side)
        case .undyed:
            shape.fill(Palette.open).overlay(shape.strokeBorder(Palette.thread, lineWidth: 1)).frame(width: side, height: side)
        case .unsewn:
            shape.strokeBorder(Palette.thread, style: StrokeStyle(lineWidth: 1.5, dash: [3, 2])).frame(width: side, height: side)
        }
    }
}

/// The menu-bar icon: the mark as a template image, filled where the mark is dyed and outlined where it is undyed; every
/// square outlined while the node is not up.
enum MenuBarIcon {
    static let sewn = drawn(up: true)
    static let unsewn = drawn(up: false)

    private static let hollow: Set<Int> = [2, 6]

    private static func drawn(up: Bool) -> NSImage {
        let image = NSImage(size: NSSize(width: 16, height: 16), flipped: true) { _ in
            let side: CGFloat = 4, gap: CGFloat = 1.5, origin: CGFloat = 0.5
            NSColor.black.setFill()
            NSColor.black.setStroke()
            for i in 0..<9 {
                let rect = NSRect(x: origin + CGFloat(i % 3) * (side + gap), y: origin + CGFloat(i / 3) * (side + gap), width: side, height: side)
                if up && !MenuBarIcon.hollow.contains(i) {
                    NSBezierPath(roundedRect: rect, xRadius: 0.8, yRadius: 0.8).fill()
                } else {
                    let path = NSBezierPath(roundedRect: rect.insetBy(dx: 0.5, dy: 0.5), xRadius: 0.6, yRadius: 0.6)
                    path.lineWidth = 1
                    path.stroke()
                }
            }
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = "Quilt"
        return image
    }
}

/// The one filled button a screen has: indigo, or another tint for a moment once it has done its thing.
struct PrimaryButton: ButtonStyle {
    var tint: Color = Palette.act
    var ink: Color = Palette.actInk
    var height: CGFloat = 36

    func makeBody(configuration: Configuration) -> some View {
        PrimaryLabel(configuration: configuration, tint: tint, ink: ink, height: height)
    }
}

private struct PrimaryLabel: View {
    let configuration: ButtonStyleConfiguration
    let tint: Color
    let ink: Color
    let height: CGFloat
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(Typeface.text(13, bold: true))
            .foregroundStyle(isEnabled ? ink : Palette.ink3)
            .padding(.horizontal, 14)
            .frame(height: height)
            .background(isEnabled ? tint : Palette.lift, in: RoundedRectangle(cornerRadius: 8))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .contentShape(RoundedRectangle(cornerRadius: 8))
    }
}

/// Every other button: plain text that lifts on hover, with a hairline round it where it stands alone.
struct QuietButton: ButtonStyle {
    var bordered = false
    var bold = false
    var height: CGFloat = 32

    func makeBody(configuration: Configuration) -> some View {
        QuietLabel(configuration: configuration, bordered: bordered, bold: bold, height: height)
    }
}

private struct QuietLabel: View {
    let configuration: ButtonStyleConfiguration
    let bordered: Bool
    let bold: Bool
    let height: CGFloat
    @State private var hovering = false
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        configuration.label
            .font(Typeface.text(13, bold: bold))
            .padding(.horizontal, 10)
            .frame(height: height)
            .background(hovering || configuration.isPressed ? Palette.lift : Color.clear, in: RoundedRectangle(cornerRadius: 7))
            .overlay {
                if bordered { RoundedRectangle(cornerRadius: 7).strokeBorder(Palette.rule) }
            }
            .opacity(isEnabled ? 1 : 0.5)
            .contentShape(RoundedRectangle(cornerRadius: 7))
            .onHover { hovering = $0 && isEnabled }
    }
}
