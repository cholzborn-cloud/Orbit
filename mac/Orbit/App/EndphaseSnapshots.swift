import AppKit
import SwiftUI

// Reine Attrappen: weder AppModel.start() noch Dienst, Datenbank, Schlüsselbund oder Zugangsdaten.
@MainActor
enum EndphaseSnapshots {
    private static var windowless = false

    static func run(directory: String, windowless: Bool = false) async -> Int32 {
        self.windowless = windowless
        FileHandle.standardError.write(Data("Design-Abnahme: Attrappen vorbereiten.\n".utf8))
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!,
                                   dataDirectory: URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: "orbit-design-no-service"))
        let model = AppModel(client: client)
        FileHandle.standardError.write(Data("Design-Abnahme: Modelle bereit.\n".utf8))
        let specs = [("Nova", "nova", "tuerkis"), ("Trixi", "trixi", "violett"), ("Lumi", "trixi", "fuchsia"),
                     ("Strobi", "strobi", "blau"), ("Citrus", "citrus", "gelborange"), ("Kiro", "strobi", "himmel"),
                     ("Pico", "nova", "gruen"), ("Momo", "trixi", "rot")]
        let now = Date(timeIntervalSince1970: 1_793_626_320)
        let bots = specs.enumerated().map { index, spec in
            Bot(chatId: "design-chat-\(index)", id: "design-orbi-\(index)", name: spec.0, avatar: spec.1,
                color: Theme.OrbiColor.all.first { $0.name == spec.2 }?.lightHex, job: "Hilft dir im Alltag", instructions: nil,
                isMain: index == 0, look: nil, lastMessageAt: now.addingTimeInterval(-Double(index)), onboardingDone: true)
        }
        let group = OrbiGroup(id: "design-family", name: "Familie", members: [bots[1], bots[2], bots[3]].map {
            GroupMember(id: $0.id, name: $0.name, avatar: $0.avatar, color: $0.color, look: nil)
        })
        model.botStore.simulate(BotsResponse(main: bots[0], bots: Array(bots.dropFirst()), groups: [group]))
        model.automations.simulate(list: .loaded([]))
        model.sidebarWidth = Theme.Layout.sidebar
        model.sidebarCollapsed = false
        let session = model.chatStore.session(for: bots[1].chatId)
        var metadata = ChatMetadata()
        metadata.createdAt = now.timeIntervalSince1970 * 1000
        session.simulate(messages: [
            ChatMessage(id: "design-message-1", role: .user, parts: [.text("Hey Trixi\nKannst du mein Export-Skript reparieren?\nIn der CSV sind alle Umlaute kaputt")], metadata: metadata),
            ChatMessage(id: "design-message-2", role: .assistant, parts: [.text("Klar! Das liegt an der Kodierung beim Speichern.\n\nÄndere die letzte Zeile so:\n```python\ndf.to_csv(datei, encoding=\"utf-8-sig\")\n```\nSoll ich das gleich für alle 12 Dateien machen?")]),
            ChatMessage(id: "design-message-3", role: .user, parts: [.text("Ja, bitte alle")])
        ], running: true)
        let size = CGSize(width: 1440, height: 1140)
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            // Der fensterlose Renderer unterstützt nur die reinen SwiftUI-Onboarding-Ansichten.
            // Hauptfenster enthalten native Texteditoren und brauchen den NSWindow-Modus.
            if windowless {
                model.settings.simulate(connectors: [
                    ConnectorItem(id: "deepwiki", name: "DeepWiki", url: "https://mcp.deepwiki.com/mcp", enabled: false, authHeader: nil, hasAuth: false, oauth: false),
                    ConnectorItem(id: "context7", name: "Context7", url: "https://mcp.context7.com/mcp", enabled: false, authHeader: nil, hasAuth: false, oauth: false)
                ], skills: ["Kurze Zusammenfassung", "Mail-Entwurf", "To-dos aus Text", "Recherchepläne", "Lernkarten"].enumerated().map { SkillItem(id: "s\($0.offset)", name: "s\($0.offset)", description: $0.element, body: "x") })
                // Karten-Galerie: jede Karte in jedem Zustand (Vergleich mit Figma „Schritt 4 – Karten“).
                for (index, entry) in CardGallery.entries().enumerated() {
                    let slug = entry.name.lowercased().map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined().prefix(40)
                    try await render(entry.view.padding(Theme.Spacing.lg).frame(width: 640, alignment: .leading).background(Theme.Palette.background).environment(\.staticRendering, true),
                                     size: CGSize(width: 640, height: 360), directory: directory, name: "10-karte-\(String(format: "%02d", index))-\(slug)")
                }
                for step in 0...4 {
                    try await render(OnboardingView(model: model, initialStep: step).environment(\.staticRendering, true),
                                     size: CGSize(width: 1280, height: 1010), directory: directory, name: "09-onboarding-\(step)")
                }
                return 0
            }
            try await checkSettingsClicks(model.settings)
            try await checkMarketplaceFilters(directory: directory)
            model.selection = .bot(bots[1].id)
            model.panelOpen = true
            try await capture(model, size: size, directory: directory, name: "01-einzelchat")
            // Langer Verlauf: steht unten am Ende, ältere Zeilen laufen sichtbar hinter der durchsichtigen Eingabe durch.
            let long = model.chatStore.session(for: bots[4].chatId)
            long.simulate(messages: (0..<24).map { index in
                ChatMessage(id: "design-long-\(index)", role: index % 2 == 0 ? .user : .assistant,
                            parts: [.text(index % 2 == 0 ? "Frage \(index / 2 + 1): Wie geht es mit dem Projekt weiter?"
                                    : "Antwort \(index / 2 + 1): Ich habe die offenen Punkte geprüft und zwei davon schon erledigt. Der Rest braucht noch einen kurzen Blick von dir, dann ist alles fertig.")],
                            metadata: index % 2 == 0 ? metadata : nil)
            }, running: true)
            model.selection = .bot(bots[4].id)
            model.panelOpen = false
            try await capture(model, size: size, directory: directory, name: "01b-einzelchat-lang")
            model.panelOpen = true
            model.chatStore.session(for: group.id).simulate(messages: [
                ChatMessage(id: "group-user", role: .user, parts: [.text("Plant bitte die Einkaufsliste für das Wochenende.")], metadata: metadata),
                ChatMessage(id: "group-answer", role: .assistant, parts: [.text("Ich schreibe die Einkaufsliste und stimme mich mit Lumi ab.")], metadata: ChatMetadata(botId: bots[1].id))
            ])
            model.selection = .group(group.id)
            try await capture(model, size: size, directory: directory, name: "02-gruppenchat")
            model.selection = nil
            model.panelOpen = false
            try await capture(model, size: size, directory: directory, name: "03-start")
            model.selection = .bot(bots[1].id)
            model.sidebarCollapsed = true
            try await capture(model, size: size, directory: directory, name: "04-eingeklappt")
            model.sidebarCollapsed = false
            model.selection = nil
            model.botStore.simulate(BotsResponse(main: nil, bots: [], groups: []))
            // Erststart in Reihenfolge: Einrichtung, dann Willkommen; nach dem Löschen aller Orbis die Mitte mit „Ersten Orbi erstellen“.
            model.settings.setup.simulate(checks: [
                HealthCheck(id: "cli", label: "Claude, Codex oder Gemini angemeldet", state: .ok),
                HealthCheck(id: "daytona", label: "Daytona (Sandbox)", state: .fehlt, fix: "Schlüssel eintragen oder später nachholen.", key: "DAYTONA_API_KEY", optional: true)
            ])
            model.onboardingDone = false; model.setupIntroDone = false
            guard model.showsOnboarding && !model.setupIntroDone else { throw SpikeError("Einrichtung beim Erststart fehlt.") }
            try await capture(model, size: size, directory: directory, name: "05a-einrichtung")
            model.setupIntroDone = true
            guard model.showsOnboarding && model.setupIntroDone else { throw SpikeError("Onboarding folgt nicht auf die Einrichtung.") }
            try await capture(model, size: size, directory: directory, name: "05-erststart")
            model.onboardingDone = true
            guard !model.showsOnboarding && model.botStore.canCreateFirstOrbi else { throw SpikeError("Leerzustand nach dem Erststart fehlt.") }
            try await capture(model, size: size, directory: directory, name: "05b-alle-geloescht")
            model.botStore.simulate(BotsResponse(main: bots[0], bots: Array(bots.dropFirst()), groups: [group]))
            model.sheet = .newBot
            try await capture(model, size: size, directory: directory, name: "06-neuer-orbi")
            model.sheet = nil
            model.newSkillName = ""
            try await capture(model, size: size, directory: directory, name: "06a-neuer-skill")
            model.newSkillName = nil
            model.selection = .bot(bots[1].id)
            model.panelOpen = true
            model.screenTab = "library"
            try await capture(model, size: size, directory: directory, name: "07-bibliothek")
            for section in SettingsView.pages {
                model.settings.section = section
                if section != .setup { model.settings.simulate(section, variant: "lang") }
                try await render(SettingsView(store: model.settings).environment(\.staticRendering, true),
                                 size: SettingsView.size, directory: directory, name: "08-einstellungen-\(section)")
            }
            model.settings.section = .usage
            for state in ["normal", "hoch", "voll", "laedt", "offline", "fehler"] {
                if ["normal", "hoch", "voll"].contains(state) {
                    let now = Date().timeIntervalSince1970 * 1000
                    let windows = [UsageWindow(name: "5h", used: 0.3, resetAt: now + 3_600_000),
                                   UsageWindow(name: "7d", used: state == "voll" ? 1 : state == "hoch" ? 0.85 : 0.4, resetAt: now + 259_200_000)]
                    let status = state == "voll" ? "limit" : "ok"
                    let account = UsageAccount(id: "beispiel", label: "Konto", status: status, note: nil, windows: windows)
                    model.settings.simulate(usage: UsageResponse(providers: [UsageProvider(provider: "claude", status: status, note: nil, accounts: [account])], fetchedAt: now))
                } else { model.settings.simulate(.usage, variant: state) }
                try await render(SettingsView(store: model.settings).environment(\.staticRendering, true),
                                 size: SettingsView.size, directory: directory, name: "08-nutzung-\(state)")
            }
            for step in 0...4 {
                try await render(OnboardingView(model: model, initialStep: step)
                    .environment(\.staticRendering, true),
                                 size: CGSize(width: 1280, height: 1010), directory: directory, name: "09-onboarding-\(step)")
            }
            try await checkOnboardingScroll(model)
            return 0
        } catch {
            FileHandle.standardError.write(Data("Design-Abnahme fehlgeschlagen: \(error.localizedDescription)\n".utf8))
            return 1
        }
    }

    private static func checkSettingsClicks(_ store: SettingsStore) async throws {
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: SettingsView.size), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        let host = NSHostingView(rootView: SettingsView(store: store).environment(\.staticRendering, true))
        window.contentView = host
        window.alphaValue = 0
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(300))
        guard window.contentRect(forFrameRect: window.frame).size == SettingsView.size else { throw SpikeError("Einstellungsfenster hat \(window.frame.size) statt \(SettingsView.size).") }
        store.section = .usage
        for (index, section) in SettingsView.pages.enumerated() {
            let point = NSPoint(x: 60, y: SettingsView.size.height - 28 - CGFloat(index) * 34)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) else {
                    throw SpikeError("Mausereignis konnte nicht erzeugt werden.")
                }
                window.sendEvent(event)
            }
            try await Task.sleep(for: .milliseconds(100))
            guard store.section == section else { throw SpikeError("Einstellungsbereich \(section.title) öffnet sich nicht beim Klick.") }
        }
        FileHandle.standardError.write(Data("Design-Abnahme: Einstellungen, alle fünf Bereiche angeklickt.\n".utf8))
    }

    private static func checkMarketplaceFilters(directory: String) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [MarketplaceFilterProtocol.self]
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, session: URLSession(configuration: config), tokenOverride: { "" })
        let store = SettingsStore(client: client)
        let size = CGSize(width: 576, height: 500)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: .aqua)
        let host = NSHostingView(rootView: ScrollView {
            SettingsMarketplaceView(store: store, loadCatalogDuringStaticRendering: true)
                .padding(Theme.Metrics.pt24).frame(maxWidth: .infinity, alignment: .topLeading)
        }.background(Theme.Palette.popover).foregroundStyle(Theme.Palette.popoverForeground).font(Theme.Fonts.body)
            .environment(\.staticRendering, true))
        window.contentView = host
        window.alphaValue = 0
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(700))
        for (name, x) in [("productivity", 138.0), ("communication", 246.0), ("development", 351.0), ("connected", 445.0), ("all", 55.0)] {
            let point = NSPoint(x: x, y: size.height - 177)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) else { throw SpikeError("Mausereignis konnte nicht erzeugt werden.") }
                window.sendEvent(event)
            }
            try await Task.sleep(for: .milliseconds(600))
            guard store.plugins.value?.first?.name == name else { throw SpikeError("Marktplatz-Filter \(name) reagiert nicht auf den Klick.") }
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw SpikeError("Filterbild konnte nicht gerendert werden.") }
            host.cacheDisplay(in: host.bounds, to: rep)
            guard let png = rep.representation(using: .png, properties: [:]) else { throw SpikeError("Filterbild konnte nicht gespeichert werden.") }
            try png.write(to: URL(fileURLWithPath: directory).appending(path: "08-filter-\(name).png"))
        }
        FileHandle.standardError.write(Data("Design-Abnahme: Marktplatzfilter angeklickt und Katalogantwort geprüft.\n".utf8))
    }

    private static func checkOnboardingScroll(_ model: AppModel) async throws {
        model.settings.simulate(.connectors, variant: "lang")
        let size = CGSize(width: 1280, height: 1010)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
        let host = NSHostingView(rootView: OnboardingView(model: model, initialStep: 3)
            .environment(\.staticRendering, true).environment(\.figuresStatic, true)
            .frame(width: size.width, height: size.height).clipped())
        window.contentView = host
        window.alphaValue = 0
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(300))
        func scrollViews(_ view: NSView) -> [NSScrollView] {
            (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
        }
        guard let scroll = scrollViews(host).first(where: { ($0.documentView?.bounds.height ?? 0) > $0.contentView.bounds.height + 1 }),
              let document = scroll.documentView else { throw SpikeError("Dienste-Liste hat keinen scrollbaren Inhalt.") }
        let end = document.bounds.height - scroll.contentView.bounds.height
        scroll.contentView.scroll(to: NSPoint(x: 0, y: end))
        scroll.reflectScrolledClipView(scroll.contentView)
        guard abs(scroll.contentView.bounds.origin.y - end) < 1 else { throw SpikeError("Ende der Dienste-Liste nicht erreichbar.") }
    }

    private static func capture(_ model: AppModel, size: CGSize, directory: String, name: String) async throws {
        try await render(MainWindow(model: model).environment(\.staticRendering, true)
            .environment(\.titleBarInset, 0),
                         size: size, directory: directory, name: name)
    }

    private static func render(_ view: some View, size: CGSize, directory: String, name: String) async throws {
        // ORBIT_BILDER=01,08 rendert nur Bilder mit diesen Anfängen (schneller Vergleich einzelner Ansichten).
        if let only = ProcessInfo.processInfo.environment["ORBIT_BILDER"]?.split(separator: ","), !only.contains(where: { name.hasPrefix($0) }) { return }
        FileHandle.standardError.write(Data("Design-Abnahme: \(name).\n".utf8))
        if !windowless {
            try await ScreenshotOrbis.capture(view.frame(width: size.width, height: size.height).clipped(), size: size, directory, name, borderless: true)
            return
        }
        for (appearance, scheme) in [("light", ColorScheme.light), ("dark", .dark)] {
            let renderer = ImageRenderer(content: view.environment(\.colorScheme, scheme).environment(\.figuresStatic, true)
                .frame(width: size.width, height: size.height))
            renderer.scale = 1
            guard let cgImage = renderer.cgImage,
                  let png = NSBitmapImageRep(cgImage: cgImage).representation(using: .png, properties: [:]) else {
                throw SpikeError("Fensterloses Rendering lieferte kein Bild für \(name).")
            }
            try png.write(to: URL(fileURLWithPath: directory).appending(path: "\(name)-\(appearance).png"))
        }
    }
}

private final class MarketplaceFilterProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let category = query.first { $0.name == "category" }?.value ?? ""
        let connected = query.first { $0.name == "connected" }?.value == "true"
        let name = connected ? "connected" : category.isEmpty ? "all" : category
        let body = #"{"configured":true,"entries":[{"id":"fixture","slug":"fixture","name":"\#(name)","description":"","logoUrl":null,"categories":[],"authSchemes":[],"managedAuthSchemes":[],"authMode":"managed_oauth","connectionStatus":"connected","toolsEnabled":false,"source":"Test"}],"nextCursor":null,"totalItems":1}"#
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class EndphaseSnapshotsDelegate: NSObject, NSApplicationDelegate {
    let directory: String
    init(directory: String) { self.directory = directory }
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await EndphaseSnapshots.run(directory: directory)) }
    }
}
