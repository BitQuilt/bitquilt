// The palette and the three faces, as the site and the Mac app have them (apps/mac/Sources/Quilt/Theme.swift).
import SwiftUI
import UIKit

/// The colours of the site, each a pair for the light and the dark appearance.
enum Palette {
    static let ground = pair(0xEEF0F3, 0x141A2C)
    static let ground2 = pair(0xF7F8FA, 0x1B2238)
    static let ink = pair(0x17213A, 0xE9E7E0)
    static let ink2 = pair(0x4A546B, 0xAAB0C0)
    static let rule = pair(0xCFD4DD, 0x2D3650)
    static let act = pair(0x2B3F7A, 0xC9D2EC)
    static let actInk = pair(0xFFFFFF, 0x141A2C)
    static let done = pair(0x2F6B48, 0x3F8F5E)
    static let doneInk = pair(0x2F6B48, 0x8FD3A9)
    static let provisional = pair(0x9CC7AC, 0x2C5C40)
    static let work = pair(0xC9D2EC, 0x3B4A7A)
    static let open = pair(0xF6F2EA, 0x2A3147)
    static let madder = pair(0xB5603A, 0xB5603A)

    private static func pair(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(uiColor: UIColor { traits in rgb(traits.userInterfaceStyle == .dark ? dark : light) })
    }

    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
                blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }

    /// A square's colour by its piece's state, as the card's map draws it.
    static func square(_ state: String) -> Color {
        switch state {
        case "accepted", "recorded": return done
        case "accepted_provisional": return provisional
        case "in_flight", "sealed", "needs_verify", "judging", "recording": return work
        case "disputed", "challenged": return madder
        case "open": return open
        default: return rule
        }
    }
}

/// The three faces, each scaled with the person's text size.
enum Typeface {
    /// Young Serif: the name and the numbers.
    static func display(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        .custom("YoungSerif-Regular", size: size, relativeTo: style)
    }

    /// Atkinson Hyperlegible: every sentence.
    static func text(_ size: CGFloat = 17, bold: Bool = false, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(bold ? "AtkinsonHyperlegible-Bold" : "AtkinsonHyperlegible-Regular", size: size, relativeTo: style)
    }

    /// IBM Plex Mono: an address and a piece's name.
    static func mono(_ size: CGFloat = 14) -> Font {
        .custom("IBMPlexMono-Regular", size: size, relativeTo: .footnote)
    }
}

/// The one button that acts, in the site's indigo.
struct ActButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typeface.text(17, bold: true))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(Palette.act.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: 12))
            .foregroundStyle(Palette.actInk)
    }
}

/// A second choice beside the one that acts.
struct QuietButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(Typeface.text(17))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(Palette.ground2.opacity(configuration.isPressed ? 0.6 : 1), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).stroke(Palette.rule))
            .foregroundStyle(Palette.ink)
    }
}
