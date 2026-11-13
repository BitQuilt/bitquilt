// Quilt on an iPhone: the problems a tracker carries, each with its map, and the person's own page, where their
// address goes into Claude and the sentences to say wait. The work is done by the person's Claude through the
// connector at their address; this app hands Claude the sentence and shows what came of it.
import SwiftUI

@main
struct QuiltApp: App {
    @State private var store = Store()
    /// The person's own page first while they hold no address here, since it is where one is made.
    @State private var tab = Keychain.read() == nil ? "you" : "problems"
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            TabView(selection: $tab) {
                ProblemsView()
                    .tabItem { Label("Problems", systemImage: "square.grid.3x3.fill") }
                    .tag("problems")
                YouView()
                    .tabItem { Label("You", systemImage: "person.crop.circle") }
                    .tag("you")
            }
            .environment(store)
            .tint(Palette.act)
            .sheet(item: $store.handOff) { HandOffSheet(handOff: $0) }
            .task { await store.refresh() }
            // Back from Claude: the sheet says whether an AI has connected since.
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { Task { await store.refresh() } }
            }
        }
    }
}
