// Quilt on an iPhone: the problems a tracker carries, each with its map, what the person's Claude did, and the
// person's own page, where their address goes into Claude and the sentences to say wait. The work is done by the
// person's Claude through the connector at their address; this app hands Claude the sentence, and shows what came of
// it as the record holds it, asked for every few seconds while the app is in front.
import SwiftUI

@main
struct QuiltApp: App {
    @State private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            TabView(selection: $store.tab) {
                ProblemsView()
                    .tabItem { Label("Problems", systemImage: "square.grid.3x3.fill") }
                    .tag("problems")
                ActivityView()
                    .tabItem { Label("Activity", systemImage: "sparkles") }
                    .badge(store.unseen)
                    .tag("activity")
                YouView()
                    .tabItem { Label("You", systemImage: "person.crop.circle") }
                    .tag("you")
            }
            .sheet(item: $store.handOff) { HandOffSheet(handOff: $0).environment(store) }
            // What changed since the phone last looked, over whatever page is in front.
            .overlay(alignment: .top) {
                if let news = store.news { NewsBanner(news: news) }
            }
            .animation(.spring(duration: 0.45), value: store.news)
            .environment(store)
            .tint(Palette.act)
            // Back from Claude or the App Store: whether Claude's app is here now, whether an AI has connected since,
            // and, for as long as the app is in front, what the person's Claude has done.
            .task(id: scenePhase) {
                guard scenePhase == .active else { return }
                await store.refresh()
                await store.watch()
            }
        }
    }
}
