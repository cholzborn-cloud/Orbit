import AppKit
import SwiftUI

// `Orbit --bildfolgen <Ordner>`: Bilder zu festen Zeitpunkten (simulierte Uhr), weil unsichtbare Fenster nicht animieren.
// Kopf (fester Streifen), Wippen beim Arbeiten (orbi-bob) und Tipp-Punkte zu festen Zeiten, je Dunkel und Hell, 2x.
// Gegenstück im Web: plan/tools/frames-web.mjs. Ohne Fenster und Dock-Symbol, ohne Dienst.
@MainActor
enum Bildfolgen {
    static let dotTimes: [Double] = [0, 0.2, 0.36, 0.52, 0.68, 0.9]

    static func run(arguments: [String]) async -> Int32 {
        guard let index = arguments.firstIndex(of: "--bildfolgen"), arguments.indices.contains(index + 1) else { return 1 }
        let dir = URL(fileURLWithPath: arguments[index + 1])
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // Gleicher Orbi wie im Web-Gegenstück (Seitenleisten-Zeile „Karti“, Farbe aus der Testkopie).
        for scheme in [ColorScheme.dark, .light] {
            let name = scheme == .dark ? "dark" : "light"
            do {
                let view = ChatHeaderView(title: "Karti", avatar: { size in
                    OrbiFigure(look: OrbiLook(avatar: "marsi", colorHex: "#e8590c", look: nil)).frame(width: size, height: size)
                }, onPill: {})
                    .frame(width: 976, height: Theme.Layout.header, alignment: .top)
                save(view, scheme, dir.appending(path: "kopf-\(name).png"))
            }
            for (i, t) in dotTimes.enumerated() {
                let view = TypingDots().foregroundStyle(Theme.Palette.foreground)
                    .padding(.horizontal, Theme.Metrics.pt16).padding(.vertical, Theme.Metrics.pt10)
                    .background(Theme.Palette.secondary, in: AssistantBubbleShape())
                    .padding(Theme.Metrics.pt8).background(Theme.Palette.background)
                    .environment(\.motionClock, t)
                save(view, scheme, dir.appending(path: "punkte-\(i)-\(name).png"))
            }
        }
        print(blurProof())
        print("Bildfolgen: \(dir.path)")
        return 0
    }

    // Belegt, dass `.blur` (Hintergrund hinter Dialogen, MainWindow) im Bild von `ImageRenderer` wirkt, im Abbild eines `NSHostingView`
    // (`cacheDisplay`, so entstehen die Screenshots der unsichtbaren Fenster) aber nicht: Capture-Grenze, kein fehlender Effekt.
    private static func blurProof() -> String {
        func view(_ radius: CGFloat) -> some View {
            HStack(spacing: 0) { Color.white; Color.black }.frame(width: 40, height: 40).blur(radius: radius)
        }
        func pixels(_ rep: NSBitmapImageRep?) -> [UInt8] { rep?.representation(using: .png, properties: [:]).map { [UInt8]($0) } ?? [] }
        func renderer(_ radius: CGFloat) -> [UInt8] {
            let r = ImageRenderer(content: view(radius)); r.scale = 1
            guard let tiff = r.nsImage?.tiffRepresentation else { return [] }
            return pixels(NSBitmapImageRep(data: tiff))
        }
        @MainActor func hosting(_ radius: CGFloat) -> [UInt8] {
            let host = NSHostingView(rootView: view(radius)); host.frame = NSRect(x: 0, y: 0, width: 40, height: 40)
            let window = NSWindow(contentRect: host.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            window.contentView = host; window.alphaValue = 0; window.orderFrontRegardless()
            host.layoutSubtreeIfNeeded()
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { return [] }
            host.cacheDisplay(in: host.bounds, to: rep)
            window.orderOut(nil)
            return pixels(rep)
        }
        func differs(_ a: [UInt8], _ b: [UInt8]) -> Bool { !a.isEmpty && a != b }
        return "Unschärfe-Beleg: ImageRenderer unscharf≠scharf \(differs(renderer(4), renderer(0))), NSHostingView.cacheDisplay unscharf≠scharf \(differs(hosting(4), hosting(0)))"
    }

    private static func save(_ view: some View, _ scheme: ColorScheme, _ url: URL) {
        let renderer = ImageRenderer(content: view.environment(\.figuresStatic, true).environment(\.colorScheme, scheme))
        renderer.scale = 2
        guard let image = renderer.nsImage, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
              let png = rep.representation(using: .png, properties: [:]) else { return }
        try? png.write(to: url)
    }
}

final class BildfolgenDelegate: NSObject, NSApplicationDelegate {
    private let arguments: [String]
    init(arguments: [String]) { self.arguments = arguments }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = arguments
        Task { @MainActor in exit(await Bildfolgen.run(arguments: arguments)) }
    }
}
