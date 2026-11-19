// The person's quilt as a picture they can share: a square for each answer their Claude gave, in the colours a map
// draws, with how many answers there are and how many another AI matched. It says nothing of who the person is: no
// name, no identity and no link. The picture is drawn in the light appearance whatever the phone's is, so it looks
// the same wherever it is sent.
import SwiftUI
import UIKit

struct QuiltPicture: View {
    let work: Work
    let score: String
    /// The most squares the picture draws: seven rows of seven, the newest first.
    static let most = 49

    private var readings: [Work.Reading] { Array(work.readings.prefix(QuiltPicture.most)) }

    /// What the picture says under its squares.
    var line: String {
        let tally = work.tally
        let answers = "\(tally.answers)\(tally.more ? "+" : "") answer\(tally.answers == 1 ? "" : "s")"
        return tally.matched > 0 ? "\(answers) \u{00B7} \(tally.matched) matched by another AI" : answers
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("My Claude\u{2019}s quilt").font(.custom("YoungSerif-Regular", size: 30)).foregroundStyle(ink)
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(38), spacing: 6), count: 7), alignment: .leading, spacing: 6) {
                ForEach(Array(readings.enumerated()), id: \.offset) { _, reading in
                    Square(state: reading.state, matched: reading.standing == .agreed)
                }
            }
            Text(line).font(.custom("AtkinsonHyperlegible-Regular", size: 16)).foregroundStyle(ink2)
            Spacer(minLength: 0)
            HStack(alignment: .firstTextBaseline) {
                Text("Quilt").font(.custom("YoungSerif-Regular", size: 20)).foregroundStyle(ink)
                Spacer()
                Text("bitquilt.org").font(.custom("AtkinsonHyperlegible-Regular", size: 14)).foregroundStyle(ink2)
            }
        }
        .padding(28)
        .frame(width: 360, height: 450, alignment: .topLeading)
        .background(Palette.light(Palette.ground))
    }

    private var ink: Color { Palette.light(Palette.ink) }
    private var ink2: Color { Palette.light(Palette.ink2) }

    /// The picture, three pixels to the point. Nil where the phone could not draw it.
    @MainActor
    func image() -> UIImage? {
        let renderer = ImageRenderer(content: self)
        renderer.scale = 3
        return renderer.uiImage
    }

    /// A square of the picture: a patch that does not move, in the light appearance.
    private struct Square: View {
        let state: String
        let matched: Bool

        private var thread: Color {
            ["accepted", "recorded", "disputed", "challenged"].contains(state) ? .white.opacity(0.5) : Palette.light(Palette.ink).opacity(0.18)
        }

        var body: some View {
            RoundedRectangle(cornerRadius: 8)
                .fill(Palette.light(Palette.square(state)))
                .overlay {
                    RoundedRectangle(cornerRadius: 6)
                        .strokeBorder(style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
                        .foregroundStyle(thread)
                        .padding(4)
                }
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Palette.light(Palette.rule), lineWidth: 1))
                .overlay {
                    if matched {
                        Image(systemName: "checkmark").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                    }
                }
                .frame(width: 38, height: 38)
        }
    }
}
