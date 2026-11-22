import AppKit
import SwiftUI

// `Orbit --vorfuehrung-seitenleiste`: sichtbares Hauptfenster mit Beispieldaten (ohne Dienst), klappt die Seitenleiste
// zwölfmal wie der Knopf ein und aus und beendet sich. Für Videoaufnahmen der Bewegung (Kopf-Pille gleitet wie die Nachrichten mit).
// Gibt den Fensterrahmen (Bildschirmpunkte, oben links) auf stdout aus, damit eine Aufnahme genau diesen Bereich nimmt.
@MainActor
enum VorfuehrungSeitenleiste {
    static let frame = NSRect(x: 80, y: 80, width: 1100, height: 720)

    static func run() async {
        let (model, _, _) = ScreenshotUX.demoModel()
        // Wie in der App bewegen (kein unsichtbares Rendern), aber den Beispielchat behalten.
        model.holdSelection = true
        let window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: MainWindow(model: model).environment(\.titleBarInset, 0))
        window.level = .floating
        window.setFrame(frame, display: true)
        window.orderFrontRegardless()
        let screenHeight = window.screen?.frame.height ?? frame.maxY
        print("rahmen \(Int(frame.minX)),\(Int(screenHeight - frame.maxY)),\(Int(frame.width)),\(Int(frame.height)) fenster \(window.windowNumber)")
        fflush(stdout)
        try? await Task.sleep(for: .seconds(2))
        // Ohne Argument die Seitenleiste, mit `panel` das rechte Panel. Wie AppModel.toggleSidebar/togglePanel,
        // aber ohne den gemerkten Zustand der echten App zu schreiben.
        let panel = CommandLine.arguments.contains("panel")
        for _ in 0..<12 {
            if panel { model.panelOpen.toggle() } else { model.sidebarCollapsed.toggle() }
            try? await Task.sleep(for: .seconds(0.9))
        }
        exit(0)
    }
}

final class VorfuehrungSeitenleisteDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in await VorfuehrungSeitenleiste.run() }
    }
}
