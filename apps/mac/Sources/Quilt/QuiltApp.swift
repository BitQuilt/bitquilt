// QuiltApp.swift: Quilt, a menu-bar window onto the node. The icon in the menu bar opens a popover (MenuView), the page
// opens in one window (PageWindow), and the node is owned or attached to by Node. The app has no Dock icon and signs
// nothing: every write stays in the page, which is the person's hand, or in the AI's connector.

import SwiftUI

@main
struct QuiltApp: App {
    @StateObject private var node = Node()
    @StateObject private var page = PageWindow()

    var body: some Scene {
        MenuBarExtra {
            MenuView(node: node, page: page)
        } label: {
            HStack(spacing: 3) {
                Image(systemName: "square.grid.3x3")
                if !node.attention.isEmpty { Text(String(node.attention.count)) }
            }
        }
        .menuBarExtraStyle(.window)
    }
}
