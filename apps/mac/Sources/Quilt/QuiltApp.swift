// QuiltApp.swift: Quilt, a menu-bar window onto the node. The icon in the menu bar is the site's quilt mark, its squares
// outlined while the node is not up, with the count of what is wanted beside it; it opens a popover (MenuView), the page
// opens in one window (PageWindow), and the node is owned or attached to by Node. The app has no Dock icon and signs
// nothing: every write stays in the page, which is the person's hand, or in the AI's connector.

import AppKit
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
                Image(nsImage: node.isUp ? MenuBarIcon.sewn : MenuBarIcon.unsewn)
                if !node.attention.isEmpty { Text(String(node.attention.count)) }
            }
        }
        .menuBarExtraStyle(.window)
    }
}
