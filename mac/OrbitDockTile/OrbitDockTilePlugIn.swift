import AppKit

// Dock-Symbol, solange Orbit nicht läuft: Die App legt das gewählte Symbol als PNG in ihre Einstellungen (Schlüssel `app-icon-dock-png`);
// dieses Plugin läuft im Dock-Prozess und zeigt es. Ohne Wahl bleibt das Symbol aus dem Paket. Änderungen kommen per verteilter Mitteilung.
@objc(OrbitDockTilePlugIn) @MainActor
final class OrbitDockTilePlugIn: NSObject, @preconcurrency NSDockTilePlugIn {
    static let appID = "de.consti.orbit2"
    static let pngKey = "app-icon-dock-png"
    static let changed = Notification.Name("de.consti.orbit2.app-icon-changed")

    private static weak var current: OrbitDockTilePlugIn?
    private var tile: NSDockTile?
    private var observer: NSObjectProtocol?

    func setDockTile(_ dockTile: NSDockTile?) {
        tile = dockTile
        if let observer { DistributedNotificationCenter.default().removeObserver(observer) }
        observer = nil
        guard dockTile != nil else { return }
        observer = DistributedNotificationCenter.default().addObserver(forName: Self.changed, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated { OrbitDockTilePlugIn.current?.refresh() }
        }
        Self.current = self
        refresh()
    }

    private func refresh() {
        guard let tile else { return }
        CFPreferencesAppSynchronize(Self.appID as CFString)
        if let data = CFPreferencesCopyAppValue(Self.pngKey as CFString, Self.appID as CFString) as? Data, let image = NSImage(data: data) {
            let view = NSImageView(frame: NSRect(origin: .zero, size: tile.size))
            view.image = image
            view.imageScaling = .scaleProportionallyUpOrDown
            tile.contentView = view
        } else {
            tile.contentView = nil
        }
        tile.display()
    }
}
