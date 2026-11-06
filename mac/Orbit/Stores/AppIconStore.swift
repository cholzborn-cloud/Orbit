import AppKit
import Observation

// Gewähltes App-Symbol: gemerkt in den Einstellungen des Nutzers und beim Start als Dock-Symbol gesetzt. Das Standardsymbol (im Paket)
// bleibt, wenn nichts anderes gewählt ist; im Finder zeigt die App immer das Symbol aus dem Paket.
@MainActor @Observable
final class AppIconStore {
    static let shared = AppIconStore()
    private static let key = "app-icon-config"
    private(set) var config: AppIconConfig

    private init() {
        if let data = UserDefaults.standard.data(forKey: Self.key), let saved = try? JSONDecoder().decode(AppIconConfig.self, from: data) { config = saved }
        else { config = .standard }
    }

    var isCustom: Bool { config != .standard }

    func update(_ change: (inout AppIconConfig) -> Void) {
        var next = config
        change(&next)
        guard next != config else { return }
        config = next
        if let data = try? JSONEncoder().encode(next) { UserDefaults.standard.set(data, forKey: Self.key) }
        apply()
    }

    func reset() { update { $0 = .standard } }

    func apply() {
        let image = isCustom ? AppIconRenderer.nsImage(config) : nil
        NSApp?.applicationIconImage = image
        stampBundle(image)
        publishForDock(image)
        observeSystemResets()
    }

    // AppKit setzt das Dock-Symbol bei Erscheinungsbild-Wechsel und Reaktivierung teils auf das Paket-Symbol zurück: dann erneut setzen.
    private var observers: [NSObjectProtocol] = []
    private func observeSystemResets() {
        guard observers.isEmpty else { return }
        let reapply: @Sendable (Notification) -> Void = { _ in
            MainActor.assumeIsolated {
                let store = AppIconStore.shared
                NSApp?.applicationIconImage = store.isCustom ? AppIconRenderer.nsImage(store.config) : nil
            }
        }
        observers.append(NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main, using: reapply))
        observers.append(DistributedNotificationCenter.default().addObserver(forName: Notification.Name("AppleInterfaceThemeChangedNotification"), object: nil, queue: .main, using: reapply))
    }

    // Für das Dock-Plugin (OrbitDockTile), das das Symbol bei geschlossener App zeigt: PNG in den eigenen Einstellungen, nil = Paket-Symbol.
    static let dockPNGKey = "app-icon-dock-png"
    private func publishForDock(_ image: NSImage?) {
        let defaults = UserDefaults.standard
        if let image, let png = Self.png(image, side: 256) {
            guard defaults.data(forKey: Self.dockPNGKey) != png else { return }
            defaults.set(png, forKey: Self.dockPNGKey)
        } else {
            guard defaults.object(forKey: Self.dockPNGKey) != nil else { return }
            defaults.removeObject(forKey: Self.dockPNGKey)
        }
        defaults.synchronize()
        DistributedNotificationCenter.default().postNotificationName(Notification.Name("de.consti.orbit2.app-icon-changed"), object: nil, userInfo: nil, deliverImmediately: true)
    }

    static func png(_ image: NSImage, side: Int) -> Data? {
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: side, pixelsHigh: side, bitsPerSample: 8, samplesPerPixel: 4,
                                         hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        rep.size = NSSize(width: side, height: side)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        image.draw(in: NSRect(x: 0, y: 0, width: side, height: side))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }

    // Ist die App zu, zeigt das Dock das Symbol aus dem Paket, nicht das zur Laufzeit gesetzte. Deshalb trägt das Paket das gewählte Symbol
    // zusätzlich als benutzerdefiniertes Symbol (Finder-Information, nicht Teil der Signatur); nil entfernt es wieder.
    private func stampBundle(_ image: NSImage?) {
        let path = Bundle.main.bundlePath
        guard path.hasPrefix("/Applications/") || path.hasPrefix(NSHomeDirectory() + "/Applications/") else { return }
        let key = "app-icon-stamped"
        // Eine neu installierte App hat das Symbol wieder verloren: der Stand des Programms gehört in die Kennung.
        let built = (try? Bundle.main.executableURL?.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate)?.timeIntervalSince1970 ?? 0
        let signature = isCustom ? ((try? JSONEncoder().encode(config)).map { String(decoding: $0, as: UTF8.self) } ?? "custom") + "|\(built)" : ""
        guard UserDefaults.standard.string(forKey: key) != signature else { return }
        if NSWorkspace.shared.setIcon(image, forFile: path, options: []) {
            UserDefaults.standard.set(signature, forKey: key)
            NSWorkspace.shared.noteFileSystemChanged(path)
        }
    }
}
