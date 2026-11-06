import AppKit
import Foundation
import SwiftUI

// `Orbit --selftest-karten <Ordner> [render|live|fehler|medien|alle]`:
//  render  rendert jede Karte in jedem Zustand (Dunkel und Hell) per ImageRenderer und prüft, dass nichts leer bleibt;
//  live    treibt gegen die Datenbankkopie eine Freigabe (Einmal/Ablehnen/Immer), zwei Rückfragen, Neustart-Wiederkehr,
//          (Übergaben laufen seit Phase 2 als Nachrichten zwischen Orbis: Zeilen, Root-Karten und @ prüfen die Unit-Tests, nicht diese Phase);
//  fehler  (Dienst ohne verfügbare Modell-CLI) prüft die Fehlerkarte;
//  medien  eine Websuche.
// `live`, `fehler`, `medien` laufen nur gegen eine Kopie (ORBIT_DATA_DIR, ORBIT_FAKE_SANDBOX=1), nutzen nur frisch angelegte Test-Orbis
// (Platzhalter-Sandbox) und kein Brain-Werkzeug. JSON, Exit 0 oder 1.
@MainActor
enum SelfTestKarten {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }

    static func run(arguments: [String]) async -> Int32 {
        let positional = arguments.drop { $0 != "--selftest-karten" }.dropFirst().filter { !$0.hasPrefix("--") }
        guard let folder = positional.first else {
            FileHandle.standardError.write(Data("Aufruf: Orbit --selftest-karten <Ordner> [render|live|fehler|medien|alle]\n".utf8))
            return 1
        }
        let phase = positional.dropFirst().first ?? "alle"
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String = "") { checks.append(Check(name: name, ok: ok, detail: detail)) }
        var images: [String] = []
        do {
            try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
            check("Unit: Fehlertexte", ErrorText.translate("Cannot connect to API: connection refused").text == "Der Dienst ist nicht erreichbar. Läuft er auf diesem Mac?")
            if ["render", "alle"].contains(phase) {
                images = try render(folder: URL(fileURLWithPath: folder), check)
                if TestDatabase.isTestCopy {
                    try await checkReply(check)
                    await checkSkillSave(check)
                    await checkDelete(check)
                    checkSettingsNavigation(check)
                    await checkPluginFilters(check)
                    try await checkNewSkillClick(check)
                    try await checkSlashScroll(check)
                    try await checkSkillDialog(folder: URL(fileURLWithPath: folder), check)
                    checkFirstOrbiTransition(check)
                    try await checkReplyRemoval(check)
                    images += try await renderSlash(folder: URL(fileURLWithPath: folder), check)
                }
            }
            if ["live", "freigabe", "fragen", "neustart", "fehler", "medien", "jev", "automation", "automation-lauf", "alle"].contains(phase) {
                guard TestDatabase.isTestCopy, ProcessInfo.processInfo.environment["ORBIT_FAKE_SANDBOX"] == "1" else {
                    throw SpikeError("Die Live-Prüfung läuft nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ORBIT_FAKE_SANDBOX=1 (keine echte Sandbox, keine echte Datenbank).")
                }
                let live = LiveDriver(check: check)
                defer { live.model.shutdown() }
                try await live.setUp()
                let all = ["live", "alle"].contains(phase)
                if all || phase == "freigabe" { await live.approvals() }
                if all || phase == "fragen" { await live.questions() }
                if all || phase == "neustart" { await live.restart() }
                if phase == "fehler" { await live.modelsUnavailable() }
                if ["medien", "alle"].contains(phase) { await live.media() }
                if all || phase == "jev" { await live.jev() }
                if all || phase == "automation" { await live.automationCreate() }
                if all || phase == "automation-lauf" { await live.automationRun() }
                await live.cleanUp()
            }
            struct Report: Encodable { let ok: Bool; let phase: String; let bilder: [String]; let checks: [Check] }
            let report = Report(ok: checks.allSatisfy(\.ok), phase: phase, bilder: images, checks: checks)
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            print(String(decoding: try encoder.encode(report), as: UTF8.self))
            return report.ok ? 0 : 1
        } catch {
            FileHandle.standardError.write(Data("{\"ok\":false,\"error\":\"\(error.localizedDescription)\"}\n".utf8))
            return 1
        }
    }

    // MARK: Rendern

    private static func clickPoint(in window: NSWindow, _ point: NSPoint) -> Bool {
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) else { return false }
            window.sendEvent(event)
        }
        return true
    }

    private static func clickLabeled(in window: NSWindow, label: String) -> Bool {
        func walk(_ element: Any) -> Bool {
            let obj = element as AnyObject
            let name = (obj.accessibilityLabel?() as String?) ?? ""
            let title = (obj.accessibilityTitle?() as String?) ?? ""
            if name == label || title == label {
                let frame = obj.accessibilityFrame?() ?? .zero
                guard frame.width > 0, frame.height > 0 else { return false }
                let local = window.convertFromScreen(frame)
                return clickPoint(in: window, NSPoint(x: local.midX, y: local.midY))
            }
            return ((obj.accessibilityChildren?() as? [Any]) ?? []).contains(where: walk)
        }
        guard let root = window.contentView else { return false }
        return walk(root)
    }

    private static func checkReplyRemoval(_ check: (String, Bool, String) -> Void) async throws {
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, tokenOverride: { "" })
        let session = ChatSession(chatId: "zitat-klick-attrappe", client: client)
        session.replyTarget = ChatMessage(id: "zitat", role: .assistant, parts: [.text("Ein alter Bezug")])
        let size = CGSize(width: 640, height: 220)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
        let host = NSHostingView(rootView: ComposerView(session: session).environment(\.staticRendering, true)
            .frame(width: 600).frame(width: size.width, height: size.height, alignment: .bottom))
        window.contentView = host; window.alphaValue = 0; window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(300))
        let clicked = clickLabeled(in: window, label: "Zitat entfernen")
            || clickPoint(in: window, NSPoint(x: 593, y: 88))
            || clickPoint(in: window, NSPoint(x: 605, y: 87))
        if clicked { try await Task.sleep(for: .milliseconds(100)) }
        check("Zitat: Entfernen angeklickt", session.replyTarget == nil, "Künstlicher Klick auf den sichtbaren Knopf")
    }

    private static func checkFirstOrbiTransition(_ check: (String, Bool, String) -> Void) {
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, tokenOverride: { "" })
        let model = AppModel(client: client)
        model.onboardingDone = false
        model.botStore.simulate(BotsResponse(main: nil, bots: [], groups: []))
        let before = model.showsOnboarding
        model.creatingFirstOrbi = true
        let bot = Bot(chatId: "attrappe-chat", id: "attrappe-orbi", name: "Orbi", avatar: "strobi", color: nil, job: "", instructions: nil, isMain: true, look: nil, lastMessageAt: .now, onboardingDone: false)
        model.botStore.simulate(BotsResponse(main: bot, bots: [], groups: []))
        let during = model.showsOnboarding
        model.selection = .bot(bot.id)
        model.onboardingDone = true
        model.creatingFirstOrbi = false
        check("Erststart: Übergang bleibt bis Abschluss sichtbar", before && during && !model.showsOnboarding && model.selection == .bot(bot.id), "Orbi kann vor dem Abschluss im Store erscheinen")
    }

    private static func checkSettingsNavigation(_ check: (String, Bool, String) -> Void) {
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, tokenOverride: { "" })
        let store = SettingsStore(client: client)
        let labels = SettingsView.pages.map(\.title)
        store.section = .connectors
        let connectors = store.section == .marketplace && store.showConnectors
        store.section = .skills
        let skills = store.section == .orbis
        store.section = .approvals
        let approvals = store.section == .setup
        check("Einstellungen: Navigation", labels == ["Allgemein", "Darstellung", "Orbis", "Marktplatz", "Nutzung"], labels.joined(separator: ", "))
        check("Einstellungen: bisherige Ziele", connectors && skills && approvals, "Konnektoren, Skills und Freigaben bleiben erreichbar")
        let frame = NSWindow.frameRect(forContentRect: NSRect(origin: .zero, size: SettingsView.size), styleMask: [.titled, .closable])
        check("Einstellungen: Fenstergröße", SettingsView.size == CGSize(width: 1120, height: 760) && frame.width == 1120, "\(Int(frame.width)) × \(Int(frame.height)) pt einschließlich Titelzeile")
    }

    private static func checkNewSkillClick(_ check: (String, Bool, String) -> Void) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SlashSkillsProtocol.self]
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:2")!, session: URLSession(configuration: config), tokenOverride: { "" })
        let session = ChatSession(chatId: "skill-klick-attrappe", client: client)
        await session.composer.loadSkills()
        session.draft = "/kein-treffer"
        var opened: String?
        let size = CGSize(width: 640, height: 300)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
        let host = NSHostingView(rootView: ComposerView(session: session)
            .environment(\.staticRendering, true)
            .environment(\.openNewSkill, NewSkillAction { opened = $0 })
            .frame(width: 600).frame(width: size.width, height: size.height, alignment: .bottom))
        window.contentView = host
        window.alphaValue = 0
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(500))
        let point = NSPoint(x: 70, y: 92)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
            guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) else { throw SpikeError("Mausereignis konnte nicht erzeugt werden.") }
            window.sendEvent(event)
        }
        try await Task.sleep(for: .milliseconds(100))
        check("Befehlsmenü: Neuer Skill anklicken", opened == "kein-treffer" && session.draft.isEmpty, "Dialogziel und geleertes Eingabefeld")
    }

    private static func checkSlashScroll(_ check: (String, Bool, String) -> Void) async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [SlashSkillsProtocol.self]
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:4")!, session: URLSession(configuration: config), tokenOverride: { "" })
        let composer = ComposerModel(chatId: "skill-scroll-attrappe", client: client)
        await composer.loadSkills()
        let size = CGSize(width: 384, height: 256)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
        let host = NSHostingView(rootView: SlashMenuView(composer: composer, draft: "/", choose: { _ in }, newSkill: {}))
        window.contentView = host
        window.alphaValue = 0
        window.orderFrontRegardless()
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(300))
        func scrollViews(_ view: NSView) -> [NSScrollView] {
            (view as? NSScrollView).map { [$0] } ?? view.subviews.flatMap(scrollViews)
        }
        guard composer.skills.count == 60,
              let scroll = scrollViews(host).first(where: { ($0.documentView?.bounds.height ?? 0) > $0.contentView.bounds.height + 1 }),
              let document = scroll.documentView else { check("Befehlsmenü: lange Liste scrollbar", false, "Scrollbereich oder Testdaten fehlen"); return }
        let end = document.bounds.height - scroll.contentView.bounds.height
        scroll.contentView.scroll(to: NSPoint(x: 0, y: end))
        scroll.reflectScrolledClipView(scroll.contentView)
        check("Befehlsmenü: lange Liste scrollbar", abs(scroll.contentView.bounds.origin.y - end) < 1, "Ende der Liste programmatisch erreicht")
    }

    private static func checkSkillDialog(folder: URL, _ check: (String, Bool, String) -> Void) async throws {
        for (tone, appearance) in [("light", NSAppearance.Name.aqua), ("dark", .darkAqua)] {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [SkillSaveProtocol.self]
            let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:2")!, session: URLSession(configuration: config), tokenOverride: { "" })
            let store = SettingsStore(client: client)
            var closed = false
            let size = CGSize(width: 448, height: 640)
            let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: .borderless, backing: .buffered, defer: false)
            window.appearance = NSAppearance(named: appearance)
            let host = NSHostingView(rootView: NewSkillDialog(store: store, name: "beispiel", onClose: { closed = true }))
            window.contentView = host; window.alphaValue = 0; window.orderFrontRegardless()
            defer { window.orderOut(nil) }
            try await Task.sleep(for: .milliseconds(300))
            func editors(_ view: NSView) -> [NSTextView] {
                (view as? NSTextView).map { [$0] } ?? view.subviews.flatMap(editors)
            }
            guard let description = editors(host).min(by: { $0.convert($0.bounds, to: host).minY < $1.convert($1.bounds, to: host).minY }) else { throw SpikeError("Beschreibung im Skill-Dialog fehlt.") }
            window.makeFirstResponder(description)
            description.insertText("Fasst Texte zusammen", replacementRange: NSRange(location: 0, length: 0))
            try await Task.sleep(for: .milliseconds(200))
            func capture(_ name: String) throws -> Data {
                guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else { throw SpikeError("Skill-Dialog konnte nicht gerendert werden.") }
                host.cacheDisplay(in: host.bounds, to: rep)
                guard let png = rep.representation(using: .png, properties: [:]) else { throw SpikeError("Skill-Dialogbild fehlt.") }
                try png.write(to: folder.appending(path: "skill-dialog-\(name)-\(tone).png"))
                return png
            }
            let before = try capture("voll")
            let point = NSPoint(x: 385, y: 28)
            for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
                guard let event = NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0) else { throw SpikeError("Mausereignis konnte nicht erzeugt werden.") }
                window.sendEvent(event)
            }
            try await Task.sleep(for: .milliseconds(300))
            let after = try capture("fehler")
            check("Skill-Dialog: ausgefüllt \(tone)", description.string == "Fasst Texte zusammen" && !closed && before != after, "Nach Anlegen verändert sich das Dialogbild; Text bleibt erhalten")
        }
    }

    private static func checkPluginFilters(_ check: (String, Bool, String) -> Void) async {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [PluginFilterProtocol.self]
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, session: URLSession(configuration: config), tokenOverride: { "" })
        let store = SettingsStore(client: client)
        store.section = .marketplace
        await store.appBecameActive()
        if case .idle = store.plugins, case .idle = store.connectors {
            check("Marktplatz: kein Laden beim Aktivieren", true, "Ohne gestartete Anmeldung bleiben beide Listen unverändert")
        } else {
            check("Marktplatz: kein Laden beim Aktivieren", false, "Eine Liste wurde ungefragt geladen")
        }
        for (filter, expected) in [("productivity", "Kalender"), ("communication", "Mail"), ("development", "Code"), ("connected", "Mail")] {
            await store.loadPlugins(search: "", category: filter)
            check("Marktplatz-Filter: \(filter)", store.plugins.value?.map(\.name) == [expected], "Katalogantwort aus HTTP-Attrappe")
        }
    }

    private static func checkDelete(_ check: (String, Bool, String) -> Void) async {
        func model(_ port: Int) -> AppModel {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [DeleteProtocol.self]
            let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:\(port)")!, session: URLSession(configuration: config), tokenOverride: { "" })
            return AppModel(client: client)
        }
        let target = PendingDelete.memory(botId: "beispiel", name: "notiz", orbi: "Orbi")
        let success = model(1)
        success.botStore.requestDelete(target)
        let first = Task { await success.confirmDelete(target) }
        for _ in 0..<100 where !success.deleteBusy { try? await Task.sleep(for: .milliseconds(5)) }
        guard success.deleteBusy else { check("Löschen: parallele Bestätigung gesperrt", false, "Testlauf startete nicht rechtzeitig"); await first.value; return }
        await success.confirmDelete(target)
        let protected = success.deleteBusy && success.botStore.pendingDelete == target
        await first.value
        check("Löschen: parallele Bestätigung gesperrt", protected && !success.deleteBusy && success.botStore.pendingDelete == nil, "Ein Lauf, danach freigegeben")
        let failure = model(2)
        failure.botStore.requestDelete(target)
        await failure.confirmDelete(target)
        check("Löschen: Fehler bleibt sichtbar", !failure.deleteBusy && failure.botStore.pendingDelete == target && failure.deleteError != nil, "Dialog bleibt offen")
    }

    private static func checkSkillSave(_ check: (String, Bool, String) -> Void) async {
        func store(_ port: Int) -> SettingsStore {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [SkillSaveProtocol.self]
            let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:\(port)")!, session: URLSession(configuration: config), tokenOverride: { "" })
            return SettingsStore(client: client)
        }
        let success = store(1), failure = store(2)
        var changes = 0
        success.onSkillsChanged = { changes += 1 }
        failure.onSkillsChanged = { changes += 10 }
        let valid = SkillForm(name: "beispiel", description: "Ein Beispiel", body: "Anleitung")
        let invalid = SkillForm(name: "ungültig", description: "Ein Beispiel", body: "Anleitung")
        let invalidError = await failure.saveSkill(id: nil, invalid)
        let saveError = await failure.saveSkill(id: nil, valid)
        let saved = await success.saveSkill(id: nil, valid)
        check("Skill-Anlage: Validierung und Fehler", invalidError == SkillRules.nameError(invalid.name) && saveError != nil && changes == 1, "Ungültige und fehlgeschlagene Anlage melden Fehler")
        check("Skill-Anlage: Erfolg", saved == nil && success.skills.value?.isEmpty == true && changes == 1, "Liste neu geladen und Änderung gemeldet")
    }

    private static func renderSlash(folder: URL, _ check: (String, Bool, String) -> Void) async throws -> [String] {
        func model(_ port: Int) -> ComposerModel {
            let config = URLSessionConfiguration.ephemeral
            config.protocolClasses = [SlashSkillsProtocol.self]
            let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:\(port)")!, session: URLSession(configuration: config), tokenOverride: { "" })
            return ComposerModel(chatId: "slash-test-\(port)", client: client)
        }
        let loading = model(1), normal = model(2), offline = model(3)
        await normal.loadSkills()
        await offline.loadSkills()
        check("Befehlsmenü: künstliche Daten geladen", normal.skillsLoaded && !normal.brainOffline && offline.brainOffline, "")
        let cases = [("laedt", loading, "/"), ("normal", normal, "/"), ("offline", offline, "/"), ("leer", normal, "/kein-treffer")]
        var written: [String] = []
        for (name, composer, draft) in cases {
            for dark in [false, true] {
                let view = SlashMenuView(composer: composer, draft: draft, choose: { _ in }, newSkill: {})
                    .padding(Theme.Spacing.lg).background(Theme.Palette.background)
                    .environment(\.colorScheme, dark ? .dark : .light)
                    .environment(\.staticRendering, true)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                guard let image = renderer.cgImage, image.width > 40, image.height > 20, colorCount(image) > (name == "laedt" ? 1 : 6),
                      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:]) else {
                    throw SpikeError("Befehlsmenü konnte nicht gerendert werden.")
                }
                let filename = "befehlsmenue-\(name)-\(dark ? "dark" : "light")"
                try png.write(to: folder.appending(path: "\(filename).png"))
                written.append(filename)
            }
        }
        return written
    }

    private static func checkReply(_ check: (String, Bool, String) -> Void) async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [EmptyTurnProtocol.self]
        let client = ServiceClient(baseURL: URL(string: "http://127.0.0.1:1")!, session: URLSession(configuration: configuration), tokenOverride: { "" })
        let session = ChatSession(chatId: "selftest-reply", client: client)
        let target = ChatMessage(id: "old", role: .assistant, parts: [.text("Ein alter Bezug")])
        session.replyTarget = target
        session.send("Antwort")
        let reply = session.messages.last
        check("Zitat beim Senden", reply?.metadata?.replyTo == "old" && reply?.metadata?.replyQuote?.text == "Ein alter Bezug" && session.replyTarget == nil, "Bezug übernommen und Chip geleert")
        await session.waitUntilIdle()

        session.replyTarget = target
        session.replyTarget = nil // Der Entfernen-Knopf setzt dasselbe Feld zurück.
        session.send("Ohne Bezug")
        let plain = session.messages.last
        let request = try plain.map { try client.turnRequest(chatId: "selftest-reply", message: $0, model: "auto", effort: nil, botId: nil, regenerate: false) }
        let body = try request?.httpBody.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        check("Entferntes Zitat nicht senden", plain?.text == "Ohne Bezug" && plain?.metadata?.replyTo == nil && plain?.metadata?.replyQuote == nil && body != nil && body?["replyTo"] == nil, "Kein Bezug in der Anfrage")
        await session.waitUntilIdle()
    }

    // Auch für `--screenshot-cards` (Präfix „karte“).
    static func render(folder: URL, prefix: String = "karten", _ check: (String, Bool, String) -> Void) throws -> [String] {
        var written: [String] = []
        var failed: [String] = []
        defer { AccentStore.shared.set(hex: nil) }
        for entry in CardGallery.entries() {
            let isExample = ["freigabe-entwurf", "freigabe-betrag", "freigabe-geheimnis"].contains(entry.name) || entry.name.hasPrefix("nachricht-aktionen-") || entry.name.hasPrefix("rueckfrage-")
            // ORBIT_SHOT_ACCENT (z. B. #8152eb): alle Karten in Orbi-Farbe wie im 1:1-Chat und in Figma, sonst Standard-Design.
            let shotAccent = ProcessInfo.processInfo.environment["ORBIT_SHOT_ACCENT"]
            AccentStore.shared.set(hex: isExample ? Theme.OrbiColor.all.first { $0.name == "violett" }?.lightHex : shotAccent)
            for dark in [true, false] {
                let name = "\(prefix)-\(entry.name)-\(dark ? "dark" : "light")"
                let view = entry.view
                    .padding(Theme.Spacing.lg)
                    .frame(width: entry.name.hasPrefix("nachricht") ? nil : 560, alignment: .leading)
                    .background(Theme.Palette.background)
                    .environment(\.colorScheme, dark ? .dark : .light)
                    .environment(\.staticRendering, true)
                    .environment(\.figuresStatic, true)
                let renderer = ImageRenderer(content: view)
                renderer.scale = 2
                guard let image = renderer.cgImage, image.width > 40, image.height > 20, colorCount(image) > 6,
                      let png = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
                else { failed.append(name); continue }
                try png.write(to: folder.appending(path: "\(name).png"))
                written.append(name)
            }
        }
        check("Karten gerendert (jede in Dunkel und Hell, nicht leer)", failed.isEmpty, failed.isEmpty ? "\(written.count) Bilder" : "fehlgeschlagen: \(failed.joined(separator: ", "))")
        return written
    }

    // Grobe Prüfung gegen leere oder einfarbige Bilder (Platzhalter von ImageRenderer): verschiedene Farben in einem 64×64-Raster.
    private static func colorCount(_ image: CGImage) -> Int {
        let side = 64
        var pixels = [UInt8](repeating: 0, count: side * side * 4)
        guard let context = CGContext(data: &pixels, width: side, height: side, bitsPerComponent: 8, bytesPerRow: side * 4,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return 0 }
        context.interpolationQuality = .none
        context.draw(image, in: CGRect(x: 0, y: 0, width: side, height: side))
        var seen = Set<UInt32>()
        for index in stride(from: 0, to: pixels.count, by: 4) {
            seen.insert(UInt32(pixels[index] >> 3) << 10 | UInt32(pixels[index + 1] >> 3) << 5 | UInt32(pixels[index + 2] >> 3))
        }
        return seen.count
    }
}

private final class EmptyTurnProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 204, httpVersion: nil, headerFields: nil)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class SlashSkillsProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let offline = request.url?.port == 3
        let skills = request.url?.port == 4
            ? (0..<60).map { #"{"name":"skill-\#($0)","description":"Beispiel","source":"orbit"}"# }.joined(separator: ",")
            : #"{"name":"zusammenfassen","description":"Fasst Texte zusammen","source":"orbit"}"#
        let body = #"{"skills":[\#(skills)],"brainOffline":\#(offline)}"#
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class SkillSaveProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let fail = request.url?.port == 2
        let response = fail ? #"{"error":"Anlage fehlgeschlagen."}"# : #"{"skills":[]}"#
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: fail ? 500 : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(response.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class PluginFilterProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let category = query.first { $0.name == "category" }?.value
        let connected = query.first { $0.name == "connected" }?.value == "true"
        let name = connected ? "Mail" : ["productivity": "Kalender", "communication": "Mail", "development": "Code"][category ?? ""] ?? "Unbekannt"
        let body = #"{"configured":true,"entries":[{"id":"fixture","slug":"fixture","name":"\#(name)","description":"","logoUrl":null,"categories":[],"authSchemes":[],"managedAuthSchemes":[],"authMode":"managed_oauth","connectionStatus":"connected","toolsEnabled":false,"source":"Test"}],"nextCursor":null,"totalItems":1}"#
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private final class DeleteProtocol: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Thread.sleep(forTimeInterval: 0.3)
        let fail = request.url?.port == 2
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: fail ? 500 : 200, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data((fail ? #"{"error":"Löschen fehlgeschlagen."}"# : "{}").utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class SelfTestKartenDelegate: NSObject, NSApplicationDelegate {
    private let arguments: [String]
    init(arguments: [String]) { self.arguments = arguments }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let arguments = arguments
        Task { @MainActor in exit(await SelfTestKarten.run(arguments: arguments)) }
    }
}
