import AppKit
import SwiftUI

// `Orbit --screenshot-ux <Ordner>`: Bilder der neuen Einstellungen (jede Seite mit Beispieldaten) und des Chats, je Dunkel und Hell,
// unsichtbar und ohne Dock-Symbol. Kein Dienst, keine Datenbank, kein Schlüsselbund: alle Antworten kommen aus festen Attrappen.
// Dateien: einstellungen-<bereich>-<dark|light>.png, chat-<dark|light>.png (1470 × 956 wie die Grok-Referenz),
// chat-lang-<dark|light>.png (Verlauf hinter der Eingabe), vergleich-grok-dark.png (oben Grok, unten Orbit).
@MainActor
enum ScreenshotUX {
    static let referenceSize = CGSize(width: 1470, height: 956)
    static let reference = FileManager.default.homeDirectoryForCurrentUser.appending(path: "Projekte-Coding/.toni-tmp/orbit-darkmode-reference-grokbot-2026-11-05.png")

    static func run(directory: String) async -> Int32 {
        do {
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            SettingsView.remembersSection = false
            try await settings(directory)
            try await chat(directory)
            FileHandle.standardError.write(Data("Screenshots fertig: \(directory)\n".utf8))
            return 0
        } catch {
            FileHandle.standardError.write(Data("Screenshots fehlgeschlagen: \(error.localizedDescription)\n".utf8))
            return 1
        }
    }

    // Jede Seite lädt wie in der App über ihre Aufgaben; die Antworten liefert `UXFixtureProtocol`.
    private static func settings(_ directory: String) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [UXFixtureProtocol.self]
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, session: URLSession(configuration: config), tokenOverride: { "" })
        let store = SettingsStore(client: client)
        store.botNames = { ["o1": "Nova", "o2": "Trixi", "o3": "Citrus"] }
        for section in SettingsView.pages {
            store.section = section
            try await ScreenshotOrbis.capture(SettingsView(store: store), size: SettingsView.size, directory, "einstellungen-\(section.rawValue)", settle: 2, borderless: true)
        }
    }

    private static func chat(_ directory: String) async throws {
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!,
                                   dataDirectory: URL(fileURLWithPath: NSTemporaryDirectory()).appending(path: "orbit-ux-no-service"))
        let model = AppModel(client: client)
        let now = Date(timeIntervalSince1970: 1_793_626_320)
        let specs = [("Toni", "trixi", "pink"), ("Coding", "nova", "violett"), ("Research", "strobi", "indigo"), ("Planer", "citrus", "gruen")]
        let bots = specs.enumerated().map { index, spec in
            Bot(chatId: "ux-chat-\(index)", id: "ux-orbi-\(index)", name: spec.0, avatar: spec.1,
                color: Theme.OrbiColor.all.first { $0.name == spec.2 }?.lightHex, job: "Hilft dir im Alltag", instructions: nil,
                isMain: index == 0, look: nil, lastMessageAt: now.addingTimeInterval(-Double(index)), onboardingDone: true)
        }
        model.botStore.simulate(BotsResponse(main: bots[0], bots: Array(bots.dropFirst()), groups: []))
        model.automations.simulate(list: .loaded([]))
        model.sidebarWidth = Theme.Layout.sidebar
        model.sidebarCollapsed = false
        model.panelOpen = false
        var metadata = ChatMetadata()
        metadata.createdAt = now.timeIntervalSince1970 * 1000
        // Inhalt wie im Grok-Referenzbild: Antworten über mehrere Zeilen, kurze eigene Nachricht, Antwort danach.
        let session = model.chatStore.session(for: bots[1].chatId)
        session.simulate(messages: [
            ChatMessage(id: "ux-1", role: .assistant, parts: [.text("Kein Push. Screenshots liegen bei Coding unter `/workspace/orbit/screenshots/ui-fixes-20261105/`.\n\nWenn du willst, hol ich die Screenshots auf den Mac oder Coding räumt die offenen Punkte nach.")]),
            ChatMessage(id: "ux-2", role: .user, parts: [.text("Hol die Screenshots und leg sie auf den Mac.")], metadata: metadata),
            ChatMessage(id: "ux-3", role: .assistant, parts: [.text("Liegt auf dem Mac unter `~/Projekte-Coding/.toni-tmp/ui-fixes-20261105/`, Ordner hab ich geöffnet. 12 Bilder (Sidebar, Setup, Appearance, Marktplatz, Kopf-Pille; Editor-Ordner leer).")]),
            ChatMessage(id: "ux-4", role: .user, parts: [.text("Was jetzt")], metadata: metadata),
            ChatMessage(id: "ux-5", role: .assistant, parts: [.text("App ist installiert mit den Fixes, als Nächstes am sinnvollsten in Orbit anschauen. Die offenen Punkte (Mondi-Screenshot, Marktplatz-Token, Glas-Pille) nur wenn dir was auffällt.")])
        ])
        model.selection = .bot(bots[1].id)
        try await capture(model, directory, "chat")
        let long = model.chatStore.session(for: bots[2].chatId)
        long.simulate(messages: (0..<24).map { index in
            ChatMessage(id: "ux-long-\(index)", role: index % 2 == 0 ? .user : .assistant,
                        parts: [.text(index % 2 == 0 ? "Frage \(index / 2 + 1): Wie geht es weiter?"
                                : "Antwort \(index / 2 + 1): Zwei Punkte sind erledigt, der Rest braucht noch einen kurzen Blick von dir, dann ist alles fertig.")],
                        metadata: index % 2 == 0 ? metadata : nil)
        }, running: true)
        model.selection = .bot(bots[2].id)
        try await capture(model, directory, "chat-lang")
        try compare(directory)
    }

    private static func capture(_ model: AppModel, _ directory: String, _ name: String) async throws {
        try await ScreenshotOrbis.capture(MainWindow(model: model).environment(\.staticRendering, true).environment(\.titleBarInset, 0)
            .frame(width: referenceSize.width, height: referenceSize.height).clipped(), size: referenceSize, directory, name, borderless: true)
    }

    // Vergleichsbild: oben die Grok-Referenz, unten Orbit, gleiche Breite (beide 2×).
    private static func compare(_ directory: String) throws {
        let ours = URL(fileURLWithPath: directory).appending(path: "chat-dark.png")
        guard let top = NSImage(contentsOf: reference), let bottom = NSImage(contentsOf: ours),
              let topRep = top.representations.first, let bottomRep = bottom.representations.first else { return }
        let width = max(topRep.pixelsWide, bottomRep.pixelsWide)
        let topHeight = topRep.pixelsHigh * width / max(1, topRep.pixelsWide), bottomHeight = bottomRep.pixelsHigh * width / max(1, bottomRep.pixelsWide)
        guard let canvas = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: topHeight + bottomHeight, bitsPerSample: 8, samplesPerPixel: 4,
                                            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: canvas)
        top.draw(in: NSRect(x: 0, y: bottomHeight, width: width, height: topHeight))
        bottom.draw(in: NSRect(x: 0, y: 0, width: width, height: bottomHeight))
        NSGraphicsContext.restoreGraphicsState()
        try canvas.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: directory).appending(path: "vergleich-grok-dark.png"))
    }
}

// Feste Antworten des Dienstes für die Einstellungs-Bilder (Pfad → JSON); auch `--screenshot-menus`.
final class UXFixtureProtocol: URLProtocol {
    private static let now = Date().timeIntervalSince1970 * 1000
    private static let fixtures: [String: String] = [
        "/v1/health": #"{"checks":[{"id":"cli","label":"Claude, Codex oder Gemini angemeldet","state":"ok"},{"id":"brain","label":"Brain (Obsidian-Vault)","state":"ok"},{"id":"daytona","label":"Daytona (Sandbox)","state":"fehlt","fix":"Schlüssel eintragen oder später nachholen.","key":"DAYTONA_API_KEY","optional":true}]}"#,
        "/v1/keys": #"{"keys":[{"name":"DAYTONA_API_KEY","label":"Daytona","isSet":false,"liveReload":true}],"needsRestart":[]}"#,
        "/v1/budget": #"{"budget":{"jevDailyUsd":0.5,"maxSandboxes":3},"jev":{"spentUsd":0.12,"state":"ok","percent":24},"sandboxes":{"active":1,"waiting":false},"tokens":[{"botId":"o1","turns":12,"totalTokens":48200},{"botId":"o2","turns":3,"totalTokens":5400}]}"#,
        "/v1/settings/rules": #"{"rules":[{"id":"r1","tool":"web_fetch","botId":null,"botName":null,"mode":"allow"},{"id":"r2","tool":"calendar_create","botId":"o3","botName":"Citrus","mode":"allow"}]}"#,
        "/v1/settings": #"{"settings":{"theme":"system","baseInstructions":null}}"#,
        "/v1/settings/instructions/default": #"{"text":"Antworte kurz und auf Deutsch. Frag nur, wenn ohne Antwort nichts geht.","limit":8000}"#,
        "/v1/skills": #"{"skills":[{"id":"s1","name":"zusammenfassen","description":"Fasst einen Text in drei Sätzen zusammen","body":"x"},{"id":"s2","name":"mail-entwurf","description":"Schreibt einen kurzen Mail-Entwurf","body":"x"}]}"#,
        "/v1/marketplace": #"{"entries":[]}"#,
        "/v1/connectors": #"{"connectors":[{"id":"c1","name":"Linear","url":"https://mcp.linear.app/sse","enabled":true,"authHeader":null,"hasAuth":true,"oauth":false}]}"#,
        "/v1/marketplace/providers": #"{"ok":true,"providers":[{"id":"google","label":"Google","route":"direct","services":["calendar"],"setup":[],"cost":"kostenlos","note":"","configured":true,"connected":true,"missing":[]}]}"#,
        "/v1/plugins": #"{"configured":true,"entries":[{"id":"gmail","slug":"gmail","name":"Gmail","description":"Mails lesen und Entwürfe schreiben","logoUrl":null,"categories":[],"authSchemes":[],"managedAuthSchemes":[],"authMode":"managed_oauth","connectionStatus":"connected","toolsEnabled":true,"source":"Composio"},{"id":"notion","slug":"notion","name":"Notion","description":"Seiten und Datenbanken","logoUrl":null,"categories":[],"authSchemes":[],"managedAuthSchemes":[],"authMode":"managed_oauth","connectionStatus":"not_connected","toolsEnabled":false,"source":"Composio"}],"nextCursor":null,"totalItems":2}"#,
    ]

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let path = request.url?.path ?? ""
        let body: String
        if path == "/v1/usage" {
            let reset = Self.now + 3_600_000, week = Self.now + 259_200_000
            body = #"{"providers":[{"provider":"claude","status":"ok","note":null,"accounts":[{"id":"a","label":"Konto","status":"ok","note":null,"windows":[{"name":"5h","used":0.3,"resetAt":\#(reset)},{"name":"7d","used":0.45,"resetAt":\#(week)}]}]},{"provider":"codex","status":"ok","note":null,"accounts":[{"id":"b","label":"Konto","status":"ok","note":null,"windows":[{"name":"5h","used":0.1,"resetAt":\#(reset)}]}]}],"fetchedAt":\#(Self.now)}"#
        } else {
            body = Self.fixtures[path] ?? #"{"ok":true}"#
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class ScreenshotUXDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    init(directory: String) { self.directory = directory }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory
        Task { @MainActor in exit(await ScreenshotUX.run(directory: directory)) }
    }
}
