// swift-tools-version: 5.9
// The package for Quilt.app, the menu-bar shell: one executable target, SwiftUI and Foundation (WebKit and AppKit where
// SwiftUI needs them), no dependencies. build.sh turns the executable into dist/Quilt.app at the repository root.
import PackageDescription

let package = Package(
    name: "Quilt",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "Quilt", path: "Sources/Quilt"),
    ]
)
