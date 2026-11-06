import AppKit
import SwiftUI

// `Orbit --screenshot-menus <Ordner>`: jedes Menü der App offen, je Dunkel und Hell, unsichtbar und ohne Dienst (Beispieldaten aus
// MenuFixtures und UXFixtureProtocol). Menüs öffnen sich über `screenAction` (WebMenuButton/webContextMenu mit screenName).
// Dateien menu-<name>-<dark|light>.png, zugeschnitten auf das offene Menü plus 24 pt Rand (2×). Native Menüs (NSMenu, NSPopover)
// lassen sich so nicht rendern.
@MainActor
enum ScreenshotMenus {
    enum Host {
        case main((AppModel) -> Void)
        case settings(SettingsSection)
        // Teil allein oben links im Fenster (liegt sonst unterhalb des Fensters oder in einem Dialog mit eigenem Koordinatenraum).
        case part(() async -> AnyView)
    }
    struct Shot {
        let name: String
        let action: String?
        let host: Host
    }

    static let margin: CGFloat = 24

    static var shots: [Shot] {
        let chat: (AppModel) -> Void = { _ in }
        return [
            Shot(name: "profil", action: "menu-account", host: .main(chat)),
            Shot(name: "plus", action: "menu-plus", host: .main(chat)),
            Shot(name: "chat-zeile", action: "kontext-chat", host: .main(chat)),
            Shot(name: "nachricht", action: "kontext-nachricht", host: .main(chat)),
            Shot(name: "reaktion", action: "menu-reaktion", host: .main(chat)),
            Shot(name: "nachricht-mehr", action: "menu-nachricht-mehr", host: .main(chat)),
            Shot(name: "composer-plus", action: "modell", host: .main(chat)),
            Shot(name: "routine-zeile", action: "menu-routine-zeile", host: .main(routinePanel)),
            Shot(name: "routine-wiederholung", action: "menu-routine-wiederholung", host: .part(routineForm)),
            Shot(name: "routine-orbi", action: "menu-routine-orbi", host: .part(routineForm)),
            // Alle Zeilentypen der Komponente (Hover, Wert + Chevron, Beschreibung, deaktiviert, destruktiv), ohne echtes Menü.
            Shot(name: "zeilentypen", action: nil, host: .part {
                let rows: [(WebMenuItem, Bool)] = [
                    (WebMenuItem(title: "Einstellungen", icon: "gearshape") {}, true),
                    (WebMenuItem(title: "Nutzung", icon: "gauge.with.needle", value: "67 % genutzt", chevron: true) {}, false),
                    (WebMenuItem(title: "Alles freigeben", icon: "checkmark.shield", subtitle: "Fragt bei nichts mehr nach", checked: true) {}, false),
                    (WebMenuItem(title: "Deaktiviert", icon: "nosign", disabled: true) {}, false),
                    (WebMenuItem(title: "Löschen", icon: "trash", destructive: true, separatorBefore: true) {}, true)]
                return AnyView(VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                    ForEach(MenuRows.rows(rows.map(\.0))) { entry in
                        if entry.separator { MenuSeparator() }
                        MenuRowLabel(item: entry.item, lit: rows.first { $0.0.id == entry.id }?.1 ?? false).opacity(entry.item.disabled ? Theme.Opacity.disabled : 1)
                    }
                }
                .frame(minWidth: Theme.Menu.minWidth).fixedSize().menuSurface().probe("overlay-menu").padding(Theme.Metrics.pt24))
            }),
            Shot(name: "konnektor", action: "menu-konnektor", host: .part {
                let store = settingsStore()
                await store.loadConnectors()
                return withOverlay(SettingsConnectorsView(store: store))
            }),
            Shot(name: "anbieter", action: "kontext-anbieter", host: .settings(.marketplace)),
            Shot(name: "marktplatz", action: "kontext-marktplatz", host: .settings(.marketplace)),
        ]
    }

    static func run(directory: String) async -> Int32 {
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            SettingsView.remembersSection = false
            var missing: [String] = []
            for shot in shots {
                for (suffix, appearance) in [("dark", NSAppearance.Name.darkAqua), ("light", .aqua)] {
                    if try await !capture(shot, appearance: appearance, file: URL(fileURLWithPath: directory).appending(path: "menu-\(shot.name)-\(suffix).png")) {
                        missing.append("\(shot.name)-\(suffix)")
                    }
                }
            }
            FileHandle.standardError.write(Data("Menü-Bilder fertig: \(directory)\(missing.isEmpty ? "" : "; nicht geöffnet: " + missing.joined(separator: ", "))\n".utf8))
            return missing.isEmpty ? 0 : 1
        } catch {
            FileHandle.standardError.write(Data("Menü-Bilder fehlgeschlagen: \(error.localizedDescription)\n".utf8))
            return 1
        }
    }

    // Seitenpanel mit einer Routine des offenen Orbis.
    private static func routinePanel(_ model: AppModel) {
        let automation = Automation(id: "ux-routine", botId: "ux-orbi-1", name: "Morgenüberblick", prompt: "Fasse den Tag zusammen",
                                    schedule: Schedule(kind: .daily, at: "08:00"), timezone: "Europe/Berlin", target: "same", chatId: nil, notify: "always",
                                    model: nil, effort: nil, context: false, enabled: true, pausedReason: nil, lastRunAt: nil, nextRunAt: nil, deletedAt: nil)
        model.automations.simulate(list: .loaded([AutomationItem(automation: automation, bot: AutomationBotRef(id: "ux-orbi-1", name: "Coding", avatar: "nova"))]))
        model.panelOpen = true
    }

    // Neue Routine (das Formular bringt seine eigene Menü-Ebene mit).
    private static func routineForm() async -> AnyView {
        AnyView(AutomationFormView(model: MenuFixtures.model(), form: AutomationFormModel(editing: nil, firstBotId: "ux-orbi-1"), onClose: {}))
    }

    private static func withOverlay(_ content: some View) -> AnyView {
        let overlay = OverlayCenter()
        return AnyView(content.coordinateSpace(name: "orbit-window").overlay { OverlayLayer(center: overlay) }.environment(\.overlay, overlay))
    }

    private static func settingsStore() -> SettingsStore {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [UXFixtureProtocol.self]
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, session: URLSession(configuration: config), tokenOverride: { "" })
        let store = SettingsStore(client: client)
        store.botNames = { ["o1": "Nova", "o2": "Trixi", "o3": "Citrus"] }
        return store
    }

    // Ein Fenster je Bild: Menü öffnet sich über screenAction, Rahmen kommt aus der Probe „overlay-menu“.
    private static func capture(_ shot: Shot, appearance: NSAppearance.Name, file: URL) async throws -> Bool {
        let frames = MenuFixtures.Frames()
        let view: AnyView
        let size: CGSize
        switch shot.host {
        case .main(let setup):
            let model = MenuFixtures.model()
            model.screenAction = shot.action   // MainWindow reicht den Namen aus dem Modell weiter
            setup(model)
            view = AnyView(MainWindow(model: model).environment(\.staticRendering, true))
            size = MenuFixtures.size
        case .settings(let section):
            let store = settingsStore()
            store.section = section
            view = AnyView(SettingsView(store: store))   // ohne staticRendering: die Seiten laden ihre Daten (Attrappen) selbst
            size = SettingsView.size
        case .part(let part):
            view = AnyView(await part().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).background(Theme.Palette.background))
            size = CGSize(width: 720, height: 560)
        }
        let root = view
            .environment(\.screenAction, shot.action)
            .environment(\.titleBarInset, 0)
            .environment(\.layoutProbing, true)
            .environment(\.figuresStatic, true)
            .frame(width: size.width, height: size.height)
            .onPreferenceChange(LayoutFrames.self) { frames.frames = $0 }
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: appearance)
        let host = NSHostingView(rootView: AnyView(root))
        window.contentView = host
        window.alphaValue = 0
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .seconds(1.8))
        guard let menu = frames.frames["overlay-menu"], menu.width > 0 else { return false }
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds), host.bounds.width > 0 else { throw ServiceError.invalidResponse }
        host.cacheDisplay(in: host.bounds, to: rep)
        let scale = CGFloat(rep.pixelsWide) / host.bounds.width
        let crop = menu.insetBy(dx: -margin, dy: -margin).intersection(host.bounds)
        let pixels = CGRect(x: crop.minX * scale, y: crop.minY * scale, width: crop.width * scale, height: crop.height * scale).integral
        guard let image = rep.cgImage?.cropping(to: pixels),
              let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else { throw ServiceError.invalidResponse }
        try png.write(to: file)
        return true
    }
}

final class ScreenshotMenusDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    init(directory: String) { self.directory = directory }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory
        Task { @MainActor in exit(await ScreenshotMenus.run(directory: directory)) }
    }
}
