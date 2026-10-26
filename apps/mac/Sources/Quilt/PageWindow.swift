// PageWindow.swift: the one window onto the node's page, a web view at http://127.0.0.1:<port>/ with the fragment the
// popover asks for. Opening it again navigates the same window and brings it forward; its frame is remembered. The page
// sets its own text; nothing is added to it here. An Edit menu is put up when the app has none, so copy and paste reach
// the page's fields in a process that shows no menu bar of its own.

import AppKit
import WebKit

@MainActor
final class PageWindow: ObservableObject {
    private var window: NSWindow?
    private var webView: WKWebView?

    func open(_ url: URL) {
        let (window, webView) = made()
        webView.load(URLRequest(url: url))
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
    }

    private func made() -> (NSWindow, WKWebView) {
        if let window, let webView { return (window, webView) }
        let webView = WKWebView(frame: .zero, configuration: WKWebViewConfiguration())
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 920, height: 760),
                              styleMask: [.titled, .closable, .miniaturizable, .resizable],
                              backing: .buffered, defer: false)
        window.title = "Quilt"
        window.contentView = webView
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.center()
        window.setFrameAutosaveName("QuiltPage")
        installMenus()
        self.window = window
        self.webView = webView
        return (window, webView)
    }

    /// Undo, cut, copy, paste, select all and close, as key equivalents, when no Edit menu is there already.
    private func installMenus() {
        let main = NSApp.mainMenu ?? NSMenu()
        if main.items.contains(where: { $0.submenu?.title == "Edit" }) { return }
        let edit = NSMenu(title: "Edit")
        let editing: [(String, Selector, String)] = [
            ("Undo", Selector(("undo:")), "z"), ("Redo", Selector(("redo:")), "Z"),
            ("Cut", #selector(NSText.cut(_:)), "x"), ("Copy", #selector(NSText.copy(_:)), "c"),
            ("Paste", #selector(NSText.paste(_:)), "v"), ("Select all", #selector(NSText.selectAll(_:)), "a"),
        ]
        for (title, action, key) in editing { edit.addItem(withTitle: title, action: action, keyEquivalent: key) }
        let windows = NSMenu(title: "Window")
        windows.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        for menu in [edit, windows] {
            let item = NSMenuItem()
            item.submenu = menu
            main.addItem(item)
        }
        NSApp.mainMenu = main
    }
}
