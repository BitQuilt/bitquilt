// Quilt on an iPhone, in three places: Home, with what to do next and what the person's Claude did; Problems, each
// with its map; and You, with the person's score and quilt. Until Claude is connected the welcome is in front of
// them. The work is done by the person's Claude through the connector at their private link; this app hands Claude
// the sentence, and shows what came of it as the record holds it, asked for every few seconds while the app is in
// front.
import SwiftUI
import UIKit

@main
struct QuiltApp: App {
    @State private var store = Store()
    @Environment(\.scenePhase) private var scenePhase

    /// The page titles in the faces the pages are set in, so the app has one voice: the serif for a large title, the
    /// text face for a small one.
    init() {
        let bar = UINavigationBar.appearance()
        if let serif = UIFont(name: "YoungSerif-Regular", size: 34) {
            bar.largeTitleTextAttributes = [.font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: serif)]
        }
        if let bold = UIFont(name: "AtkinsonHyperlegible-Bold", size: 17) {
            bar.titleTextAttributes = [.font: UIFontMetrics(forTextStyle: .headline).scaledFont(for: bold)]
        }
    }

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
            .sheet(item: $store.reading) { ReadingSheet(reading: $0).environment(store) }
            .fullScreenCover(item: $store.firstSquare) { FirstSquare(reading: $0).environment(store) }
            // A square's page or a problem's link, tapped in Claude or anywhere else on the phone (Links.swift).
            .onOpenURL { url in Task { await store.follow(url) } }
            // `-open <link>` at launch follows a link, for a run in the simulator, where a square's page on a tracker
            // on this machine would open in Safari.
            .task {
                if let link = UserDefaults.standard.string(forKey: "open"), let url = URL(string: link) { await store.follow(url) }
            }
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
