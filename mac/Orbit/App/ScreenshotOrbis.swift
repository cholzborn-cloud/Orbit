import AppKit
import SwiftUI

// `Orbit --screenshot-orbis <Ordner> <dialoge|gruppe|leer|offline>`: Bilder zu Block 4a-2, Dunkel und Hell, unsichtbar ohne Dock-Symbol.
// Nur gegen eine Datenbankkopie (ORBIT_DATA_DIR) mit ORBIT_FAKE_SANDBOX=1: legt dort Orbis, Gruppen und Nachrichten an.
@MainActor
enum ScreenshotOrbis {
    static func run(directory: String, scenario: String) async -> Int32 {
        if scenario == "phase15" {
            do { try await phase15(directory: directory); return 0 }
            catch { FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8)); return 1 }
        }
        if scenario == "phase11" {
            do { try await phase11(directory: directory); return 0 }
            catch { FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8)); return 1 }
        }
        if scenario == "phase14" {
            do { try await phase14(directory: directory); return 0 }
            catch { FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8)); return 1 }
        }
        let model = AppModel()
        defer { model.shutdown() }
        do {
            if scenario == "simple" {
                try await simpleEditorRegression(model: model, directory: directory)
                return 0
            }
            if scenario == "menus" {
                try await menuRegression(directory: directory)
                return 0
            }
            if scenario == "figma" {
                try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
                let bot = Bot(chatId: "figma-chat", id: "figma-orbi", name: "Marsi", avatar: "marsi", color: nil, job: "Begleiter", instructions: "Hilft beim Planen und Recherchieren.", isMain: false, look: nil, lastMessageAt: .now)
                model.automations.simulate(list: .loaded([]))
                AccentStore.shared.set(hex: Theme.orbiBaseColors[bot.avatar])
                for scene in ["details", "library", "hover", "edit", "look"] {
                    model.screenTab = scene
                    try await capture(BotSidePanel(model: model, bot: bot).environment(\.staticRendering, true), size: CGSize(width: 360, height: 790), directory, "figma-\(scene)", borderless: true)
                }
                return 0
            }
            guard TestDatabase.isTestCopy, ProcessInfo.processInfo.environment["ORBIT_FAKE_SANDBOX"] == "1" else {
                throw SpikeError("Nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ORBIT_FAKE_SANDBOX=1.")
            }
            try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
            await model.start()
            try await Task.sleep(for: .seconds(1))
            switch scenario {
            case "dialoge": try await dialogs(model, directory)
            case "gruppe": try await group(model, directory)
            case "leer": try await capture(MainWindow(model: model), size: CGSize(width: 1100, height: 720), directory, "mac4a2-leere-liste")
            case "offline":
                model.service.shutdown()
                await model.botStore.load()
                try await capture(MainWindow(model: model), size: CGSize(width: 1100, height: 720), directory, "mac4a2-offline")
            default: throw SpikeError("Unbekanntes Szenario: \(scenario)")
            }
            return 0
        } catch {
            FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
            return 1
        }
    }

    private static func phase15(directory: String) async throws {
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, dataDirectory: URL(fileURLWithPath: directory))
        let store = SettingsStore(client: client)
        let now = Date().timeIntervalSince1970 * 1000
        let windows = [UsageWindow(name: "5h", used: 0.4, resetAt: now + 3600_000), UsageWindow(name: "7d", used: 0.7, resetAt: now + 3 * 86400_000)]
        let account = UsageAccount(id: "beispiel", label: "Beispiel", status: "ok", note: nil, windows: windows)
        store.simulate(usage: UsageResponse(providers: [
            UsageProvider(provider: "claude", status: "ok", note: nil, accounts: [account]),
            UsageProvider(provider: "codex", status: "ok", note: nil, accounts: [account]),
            UsageProvider(provider: "antigravity", status: "error", note: "Keine Daten verfügbar.", accounts: []),
        ], fetchedAt: now))
        try await capture(ScrollView { SettingsUsageView(store: store).padding(Theme.Spacing.lg) }.background(Theme.Palette.background).environment(\.staticRendering, true), size: CGSize(width: 576, height: 900), directory, "phase15-nutzung", settle: 0.4, borderless: true)
    }

    private static func phase11(directory: String) async throws {
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let main = Bot(chatId: "haupt-chat", id: "haupt", name: "Hauptorbi", avatar: "strobi", color: nil, job: "Fertig", instructions: nil, isMain: true, look: nil, lastMessageAt: .distantPast)
        let waiting = Bot(chatId: "wartet-chat", id: "wartet", name: "Wartet", avatar: "freddy", color: nil, job: "Braucht dich", instructions: nil, isMain: false, look: nil, lastMessageAt: .distantPast)
        let working = Bot(chatId: "arbeitet-chat", id: "arbeitet", name: "Arbeitet", avatar: "marsi", color: nil, job: "Arbeitet", instructions: nil, isMain: false, look: nil, lastMessageAt: .distantPast)
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, dataDirectory: URL(fileURLWithPath: directory))
        let model = AppModel(client: client)
        model.botStore.simulate(BotsResponse(main: main, bots: [waiting, working], groups: []))
        model.selection = .bot(main.id)
        model.sidebarCollapsed = false
        let events = Data(#"{"type":"snapshot","working":[{"chatId":"haupt-chat","botId":"haupt","status":"fertig"},{"chatId":"wartet-chat","botId":"wartet","status":"wartet"},{"chatId":"arbeitet-chat","botId":"arbeitet","status":"arbeitet"}]}"#.utf8)
        model.events.simulate(status: ChatStatusResponse(chats: [ChatStatusItem(chatId: waiting.chatId, needsYou: true)], needsYou: 1), events: events)
        guard model.events.needsYouCount == 1, model.showsStatusDot(bot: main) == .done,
              model.showsStatusDot(bot: waiting) == .needsYou, model.showsStatusDot(bot: working) == nil else {
            throw SpikeError("Seitenleisten-Status oder Menüleistenzahl stimmt nicht.")
        }
        try await capture(SidebarView(model: model).environment(\.staticRendering, true).environment(\.figuresStatic, true), size: CGSize(width: Theme.Layout.sidebar, height: 640), directory, "phase11-seitenleiste", settle: 0.4, borderless: true)
    }

    // Nur künstliche Daten: kein Dienststart, keine Schlüsselbundabfrage und kein AppModel.
    private static func phase14(directory: String) async throws {
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let bot = Bot(chatId: "beispiel-chat", id: "beispiel", name: "Lernhilfe", avatar: "strobi", color: nil, job: "Lernen", instructions: nil, isMain: false, look: nil, lastMessageAt: .distantPast)
        let other = Bot(chatId: "zweiter-chat", id: "zweiter", name: "Planer", avatar: "freddy", color: nil, job: "Planen", instructions: nil, isMain: false, look: nil, lastMessageAt: .distantPast)
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, dataDirectory: URL(fileURLWithPath: directory))
        let editor = BotEditorModel(editing: bot, others: [])
        let session = ChatSession(chatId: "beispiel-gruppe", client: client)
        let store = SettingsStore(client: client)
        store.setup.simulate(checks: [HealthCheck(id: "jev", label: "Jev", state: .fehlt, key: "OPENROUTER_JEV_API_KEY", optional: true)])
        try await capture(ProfileTab(editor: editor, profileOnly: true).padding(Theme.Spacing.lg).background(Theme.Palette.background).environment(\.staticRendering, true), size: CGSize(width: 560, height: 300), directory, "phase14-personalisieren", settle: 0.4, borderless: true)
        try await capture(ComposerView(session: session, members: [bot, other]).background(Theme.Palette.background).environment(\.staticRendering, true), size: CGSize(width: 560, height: 120), directory, "phase14-gruppe", settle: 0.4, borderless: true)
        try await capture(SettingsView(store: store).environment(\.staticRendering, true), size: SettingsView.size, directory, "phase14-einstellungen", settle: 0.4, borderless: true)
    }

    private static func simpleEditorRegression(model: AppModel, directory: String) async throws {
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        let bot = Bot(chatId: "preview-chat", id: "preview-orbi", name: "Marsi", avatar: "marsi", color: nil, job: "Begleiter", instructions: "Hilft beim Planen und Recherchieren.", isMain: false, look: nil, lastMessageAt: .now)
        AccentStore.shared.set(hex: Theme.orbiBaseColors[bot.avatar])
        for width in [CGFloat(240), 380] {
            for scene in ["edit", "look"] {
                model.screenTab = scene
                let frames = SelfTestLayout.FrameBox()
                let view = BotSidePanel(model: model, bot: bot)
                    .frame(width: width, height: 790)
                    .coordinateSpace(name: "orbit-window")
                    .environment(\.staticRendering, true)
                    .environment(\.figuresStatic, true)
                    .environment(\.layoutProbing, true)
                    .onPreferenceChange(LayoutFrames.self) { frames.frames = $0 }
                let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: width, height: 790), styleMask: .borderless, backing: .buffered, defer: false)
                window.appearance = NSAppearance(named: .darkAqua)
                let host = NSHostingView(rootView: view)
                window.contentView = host
                window.alphaValue = 0
                window.orderFrontRegardless()
                defer { window.orderOut(nil) }
                try await Task.sleep(for: .seconds(0.6))
                guard let cancel = frames.frames["orbi-edit-cancel"], let save = frames.frames["orbi-edit-save"],
                      cancel.minX >= 0, save.maxX <= width, cancel.maxX + 4 <= save.minX,
                      cancel.minY >= 0, save.maxY <= 790,
                      abs(cancel.width - save.width) < 2, abs(cancel.minY - save.minY) < 2 else {
                    throw SpikeError("Bearbeiten \(width): Schaltflächen überlappen oder sind ungleich ausgerichtet.")
                }
                let shapes = frames.frames.filter { $0.key.hasPrefix("orbi-shape-") }.map(\.value)
                if scene == "look" {
                    guard shapes.count == OrbiShape.allCases.count,
                          shapes.allSatisfy({ $0.width <= 66 && $0.height <= 52 && $0.minX >= 0 && $0.maxX <= width }) else {
                        throw SpikeError("Bearbeiten \(width): Formen fehlen oder verlassen die Seitenleiste: \(shapes)")
                    }
                }
                guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw ServiceError.invalidResponse }
                host.cacheDisplay(in: host.bounds, to: rep)
                guard let png = rep.representation(using: .png, properties: [:]) else { throw ServiceError.invalidResponse }
                try png.write(to: URL(fileURLWithPath: directory).appending(path: "orbi-\(scene)-\(Int(width)).png"))
            }
        }
        print("Bearbeiten: 240/380 pt, gleiche Schaltflächen, alle 15 kompakten Formen innerhalb der Seitenleiste geprüft.")
    }

    // Gleicher Fehlerfall wie ein Sheet: Dialog erbt absichtlich das Overlay eines anderen Fensterraums.
    private static func menuRegression(directory: String) async throws {
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        for (field, width) in [("Wiederholung", CGFloat(280)), ("Wochentag", 512), ("Ergebnis erscheint", 280), ("Modell", 512)] {
            let inherited = OverlayCenter()
            let frames = SelfTestLayout.FrameBox()
            let dialog = DialogShell(title: "Routine bearbeiten", description: "Menüposition prüfen", width: width, height: 480, onClose: {}) {
                VStack(spacing: 24) {
                    Text("Routine").frame(height: 80)
                    DialogField(field) {
                        WebMenuButton(matchWidth: true, screenName: "regression", items: {
                            [WebMenuItem(title: "Täglich", checked: true) {}, WebMenuItem(title: "Wöchentlich") {}]
                        }) { open in SelectTriggerLabel(title: "Täglich", open: open, fill: true) }
                    }
                    Spacer(minLength: 100)
                }
            } footer: { Button("Schließen") {} }
            let root = dialog.frame(width: 1000, height: 700)
                .coordinateSpace(name: "orbit-window")
                .overlay { OverlayLayer(center: inherited) }
                .environment(\.overlay, inherited)
                .environment(\.layoutProbing, true)
                .environment(\.screenAction, "regression")
                .onPreferenceChange(LayoutFrames.self) { frames.frames = $0 }
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 700), styleMask: .borderless, backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: .darkAqua)
            let host = NSHostingView(rootView: root)
            window.contentView = host
            window.alphaValue = 0
            window.orderFrontRegardless()
            defer { window.orderOut(nil) }
            try await Task.sleep(for: .seconds(0.5))
            guard inherited.menu == nil,
                  let anchor = frames.frames["menu-anchor-regression"], let menu = frames.frames["overlay-menu"],
                  anchor.width > 0, menu.width >= anchor.width,
                  abs(menu.minX - anchor.minX) < 2, abs(menu.minY - anchor.maxY - 4) < 2,
                  menu.minX >= 0, menu.maxX <= width, menu.maxY <= 480 else {
                throw SpikeError("\(field): Menü liegt nicht am Auslöser im Dialog: \(frames.frames)")
            }
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw ServiceError.invalidResponse }
            host.cacheDisplay(in: host.bounds, to: rep)
            guard let png = rep.representation(using: .png, properties: [:]) else { throw ServiceError.invalidResponse }
            try png.write(to: URL(fileURLWithPath: directory).appending(path: "menu-\(field.replacingOccurrences(of: " ", with: "-" )).png"))
        }
        print("4 Dialog-Menüs: eigenes Overlay, passender Anker und Dialoggrenzen geprüft.")
    }

    @discardableResult
    private static func addBot(_ model: AppModel, name: String, shape: OrbiShape, hue: Double? = nil, job: String = "Begleiter") async throws -> Bot {
        let editor = BotEditorModel(editing: nil, others: model.botStore.orbis)
        editor.shape = shape
        editor.name = name
        if let hue { editor.setCustomHue(hue) }
        editor.selectPreset(job)
        await model.save(editor)
        guard let bot = model.botStore.bots.first(where: { $0.name == name }) else { throw SpikeError(editor.error ?? "Orbi „\(name)“ nicht angelegt") }
        return bot
    }

    private static func dialogs(_ model: AppModel, _ directory: String) async throws {
        // Dialoge öffnen im Web über einem Chat: Akzent ist die Farbe des offenen Orbis (hier „Karti“, falls vorhanden).
        if let hex = model.botStore.bots.first(where: { $0.name == "Karti" })?.color { AccentStore.shared.set(hex: hex) }
        // Zweiter Mondi in Standardfarbe: der neue Dialog schlägt dann eine freie Farbe vor.
        try await addBot(model, name: "Mondi", shape: .freddy)
        let create = BotEditorModel(editing: nil, others: model.botStore.orbis)
        create.shape = .freddy
        create.name = "Luna"
        create.selectPreset("Recherche")
        try await capture(BotEditorView(editor: create, onSave: {}, onCancel: {}, onDelete: nil), size: CGSize(width: 448, height: 700), directory, "mac4a2-anlegen-dialog", borderless: true)

        guard let nepi = model.botStore.main else { throw SpikeError("Kein Hauptorbi in der Kopie.") }
        let customize = BotEditorModel(editing: nepi, others: model.botStore.orbis, tab: .look)
        customize.accessory = .sunglasses; customize.cheeks = true; customize.eyes = .round; customize.gaze = 0.7; customize.reaction = 0.18
        try await capture(BotEditorView(editor: customize, onSave: {}, onCancel: {}, onDelete: {}), size: CGSize(width: 448, height: 700), directory, "mac4a2-anpassungsmenue", borderless: true)

        let group = GroupEditorModel(editing: nil)
        group.name = "Reisegruppe"; group.toggle(nepi.id)
        try await capture(GroupEditorView(editor: group, orbis: model.botStore.orbis, onSave: {}, onCancel: {}, onDelete: nil), size: CGSize(width: 448, height: 480), directory, "mac4a2-gruppe-dialog", borderless: true)
    }

    private static func group(_ model: AppModel, _ directory: String) async throws {
        guard let nepi = model.botStore.main else { throw SpikeError("Kein Hauptorbi in der Kopie.") }
        let database = try TestDatabase()
        let sevilla = try await addBot(model, name: "Sevi", shape: .cubee, hue: 12, job: "Recherche")
        let reise = GroupEditorModel(editing: nil)
        reise.name = "Reisegruppe"; reise.toggle(nepi.id); reise.toggle(sevilla.id)
        await model.save(reise)
        guard let group = model.botStore.groups.first(where: { $0.name == "Reisegruppe" }) else { throw SpikeError(reise.error ?? "Gruppe nicht angelegt") }
        try database.addUserMessage(chatId: group.id, text: "Wohin sollen wir im Frühling reisen?")
        try database.addAssistantMessage(chatId: group.id, botId: nepi.id, text: "Ich schlage Lissabon vor: mild, günstig und gut erreichbar.")
        try database.addAssistantMessage(chatId: group.id, botId: sevilla.id, text: "[Sevi]: Ich wäre für Sevilla. Im April blüht dort alles.")
        try database.addUserMessage(chatId: group.id, text: "@Sevi wie warm ist es dort?")
        try database.addAssistantMessage(chatId: group.id, botId: sevilla.id, text: "Im April meist um 22 Grad, nachts kühler.")
        model.selection = .group(group.id)
        let session = model.chatStore.session(for: group.id)
        await session.load(); await session.waitUntilIdle()
        try await capture(MainWindow(model: model), size: CGSize(width: 1100, height: 720), directory, "mac4a2-gruppenchat")

        // Gruppe mit einem Mitglied
        let solo = GroupEditorModel(editing: nil)
        solo.name = "Allein"; solo.toggle(nepi.id)
        await model.save(solo)
        if let soloGroup = model.botStore.groups.first(where: { $0.name == "Allein" }) {
            try database.addUserMessage(chatId: soloGroup.id, text: "Funktioniert eine Gruppe mit nur einem Orbi?")
            try database.addAssistantMessage(chatId: soloGroup.id, botId: nepi.id, text: "Ja, ich antworte hier allein.")
            model.selection = .group(soloGroup.id)
            let soloSession = model.chatStore.session(for: soloGroup.id)
            await soloSession.load(); await soloSession.waitUntilIdle()
            try await capture(MainWindow(model: model), size: CGSize(width: 1100, height: 720), directory, "mac4a2-gruppe-1-mitglied")
        }

        // Gelöschter Orbi: seine Antwort bleibt im Gruppenchat, nach dem Löschen mit Platzhalter
        let wolke = try await addBot(model, name: "Wolke", shape: .kirby, job: "Ideen")
        let edit = GroupEditorModel(editing: group)
        edit.toggle(wolke.id)
        await model.save(edit)
        try database.addAssistantMessage(chatId: group.id, botId: wolke.id, text: "Ich habe noch eine Idee: Zug statt Flug.")
        model.botStore.requestDelete(.bot(wolke))
        await model.confirmDelete(model.botStore.pendingDelete)
        model.selection = .group(group.id)
        await session.load(); await session.waitUntilIdle()
        try await capture(MainWindow(model: model), size: CGSize(width: 1100, height: 720), directory, "mac4a2-geloeschter-orbi")
    }

    // Rendert eine Ansicht hell und dunkel unsichtbar (alpha 0, kein Dock-Symbol); Figuren statisch gezeichnet.
    // borderless: Fenster höher als der Bildschirm (ein titled-Fenster wird auf den Bildschirm begrenzt).
    static func capture(_ view: some View, size: CGSize, _ directory: String, _ prefix: String, settle: Double = 1.5, borderless: Bool = false) async throws {
        var windows: [(String, NSWindow, NSHostingView<AnyView>)] = []
        for (name, appearance) in [("dark", NSAppearance.Name.darkAqua), ("light", .aqua)] {
            let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: borderless ? [.borderless] : [.titled, .closable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: appearance)
            let host = NSHostingView(rootView: AnyView(view.environment(\.figuresStatic, true)))
            window.contentView = host
            window.alphaValue = 0
            window.orderFrontRegardless()
            windows.append((name, window, host))
        }
        try await Task.sleep(for: .seconds(settle))
        for (name, window, host) in windows {
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds), host.bounds.width > 0 else { throw ServiceError.invalidResponse }
            host.cacheDisplay(in: host.bounds, to: rep)
            guard let png = rep.representation(using: .png, properties: [:]) else { throw ServiceError.invalidResponse }
            try png.write(to: URL(fileURLWithPath: directory).appending(path: "\(prefix)-\(name).png"))
            window.orderOut(nil)
        }
    }
}

final class ScreenshotOrbisDelegate: NSObject, NSApplicationDelegate {
    private let directory: String
    private let scenario: String
    init(directory: String, scenario: String) { self.directory = directory; self.scenario = scenario }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let directory = directory, scenario = scenario
        Task { @MainActor in exit(await ScreenshotOrbis.run(directory: directory, scenario: scenario)) }
    }
}
