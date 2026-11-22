import AppKit
import SwiftUI

final class AppDelegate: NSObject, NSApplicationDelegate {
    var model: AppModel?

    // Gewähltes App-Symbol setzen, bevor ein Fenster erscheint.
    func applicationDidFinishLaunching(_ notification: Notification) {
        MainActor.assumeIsolated { AppIconStore.shared.apply() }
        NSScroller.hideAll()
    }

    // Fenster zu heißt nicht beenden: die App bleibt in der Menüleiste, hört auf den Dienst und zeigt Mitteilungen.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationWillTerminate(_ notification: Notification) {
        MainActor.assumeIsolated {
            model?.chatStore.detachAll()
            model?.shutdown()
        }
    }
}

struct OrbitApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var model = AppModel()
    @State private var notifier = Notifier()

    var body: some Scene {
        // Ein einziges Fenster; die Menüleiste und Mitteilungen öffnen es bei Bedarf wieder (openWindow(id: "main")).
        Window("Orbit", id: "main") {
            MainWindow(model: model)
                .background(WindowChrome())
                .scrollIndicators(.never)
                .environment(\.titleBarInset, 0)
                .task { await boot() }
        }
        // Wie die Web-App ohne Browserleiste: keine Titelzeile, die Seitenleiste reicht bis nach oben.
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1180, height: 780)
        MenuBarExtra {
            MenuBarContent(model: model)
        } label: {
            MenuBarLabel(model: model)
                .task { await boot() }
        }
        // Cmd+, öffnet die Einstellungen als eigenes Fenster (4d).
        Settings {
            SettingsView(store: model.settings)
                .scrollIndicators(.never)
                .navigationTitle("Einstellungen")
                .onAppear { model.settingsOpen = true }
                .onDisappear { model.settingsOpen = false }
        }
        .windowResizability(.contentSize)
    }

    // Einmal beim Start (Fenster oder Menüleiste, je nachdem was zuerst da ist): Dienst einrichten, Ereignisse hören, Mitteilungen.
    @MainActor private func boot() async {
        delegate.model = model
        guard !model.booted else { return }
        model.booted = true
        await model.start()
        // Schlug der Start fehl (Dienst nicht bereit), darf der nächste Versuch (Fenster öffnen) es erneut probieren.
        if model.startupError != nil { model.booted = false; return }
        notifier.start(model: model)
    }
}

extension NSScroller {
    // Scrollbalken nirgends zeichnen (auch nicht im Eingabefeld); gescrollt wird wie vorher mit Trackpad, Maus und Tastatur.
    static func hideAll() {
        let knob: @convention(block) (AnyObject) -> Void = { _ in }
        let slot: @convention(block) (AnyObject, NSRect, Bool) -> Void = { _, _, _ in }
        class_replaceMethod(NSScroller.self, #selector(NSScroller.drawKnob), imp_implementationWithBlock(knob), "v@:")
        class_replaceMethod(NSScroller.self, #selector(NSScroller.drawKnobSlot(in:highlight:)), imp_implementationWithBlock(slot), "v@:{CGRect={CGPoint=dd}{CGSize=dd}}B")
    }
}

// Titelleiste in die App integrieren: durchsichtig, ohne Titel und Trennlinie, Fensterfarbe wie die Oberfläche;
// die Ampelknöpfe (schließen, minimieren, Vollbild) sitzen direkt über der Seitenleiste. Fenster lässt sich überall am Hintergrund ziehen.
struct WindowChrome: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let v = NSView()
        DispatchQueue.main.async { Self.configure(v.window) }
        return v
    }
    func updateNSView(_ view: NSView, context: Context) { DispatchQueue.main.async { Self.configure(view.window) } }

    private static func configure(_ w: NSWindow?) {
        guard let w else { return }
        w.titlebarAppearsTransparent = true
        w.titleVisibility = .hidden
        w.titlebarSeparatorStyle = .none
        w.styleMask.insert(.fullSizeContentView)
        w.isMovableByWindowBackground = true
        w.backgroundColor = NSColor(Theme.Palette.sidebar)
        place(w)
        if observed.insert(ObjectIdentifier(w)).inserted {
            for name in [NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification, NSWindow.didExitFullScreenNotification, NSWindow.didBecomeKeyNotification, NSWindow.didMoveNotification, NSWindow.didUpdateNotification] {
                NotificationCenter.default.addObserver(forName: name, object: w, queue: .main) { [weak w] _ in MainActor.assumeIsolated { if let w { place(w) } } }
            }
        }
    }

    private static var observed: Set<ObjectIdentifier> = []

    // Ampelknöpfe senkrecht in die 52 hohe Leiste mitten setzen (Titelleistenbereich auf diese Höhe bringen).
    @MainActor private static func place(_ w: NSWindow) {
        guard let close = w.standardWindowButton(.closeButton), let bar = close.superview else { return }
        let h = TopBarMetrics.height
        if let container = bar.superview, !w.styleMask.contains(.fullScreen) {
            let want = NSRect(x: 0, y: container.frame.height - h, width: container.frame.width, height: h)
            if bar.frame != want { bar.frame = want }
        }
        var x: CGFloat = TopBarMetrics.lightsX
        for type in [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton] {
            guard let b = w.standardWindowButton(type) else { continue }
            let target = NSPoint(x: x, y: ((h - b.frame.height) / 2).rounded())
            if b.frame.origin != target { b.setFrameOrigin(target) }
            x += b.frame.width + 8
        }
    }
}
