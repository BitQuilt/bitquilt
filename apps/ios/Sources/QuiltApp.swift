// Quilt on an iPhone, in three places: Home, with what to do next and what the person's Claude did; Problems, each
// with its map; and You, with the person's score and quilt. Until Claude is connected the welcome is in front of
// them. The work is done by the person's Claude through the connector at their private link; this app hands Claude
// the sentence, and shows what came of it as the record holds it, asked for every few seconds while the app is in
// front.
import SwiftUI

@main
struct QuiltApp: App {
    @State private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Group {
                if store.welcoming {
                    WelcomeView().transition(.opacity)
                } else {
                    TabView(selection: $store.tab) {
                        HomeView()
                            .tabItem { Label("Home", systemImage: "house.fill") }
                            .badge(store.unseen)
                            .tag("home")
                        ProblemsView()
                            .tabItem { Label("Problems", systemImage: "square.grid.3x3.fill") }
                            .tag("problems")
                        YouView()
                            .tabItem { Label("You", systemImage: "person.crop.circle") }
                            .tag("you")
                    }
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.3), value: store.welcoming)
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
