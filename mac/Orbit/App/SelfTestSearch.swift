import AppKit
import Foundation
import SwiftUI

// `Orbit --selftest-suche`: Suche gegen eine Datenbankkopie (ORBIT_DATA_DIR, ORBIT_FAKE_SANDBOX=1). Sät Nachrichten mit einem
// eindeutigen Wort samt Suchindex, sucht über das Suchfeld-Modell (entprellt), prüft Treffer, Markierung, „keine Treffer“, Fehler,
// öffnet den Treffer in einem echten Fenster (Chat an der Stelle, Hervorhebung), ⌘K und Esc als Tastenereignisse und den Treffer
// eines inzwischen gelöschten Chats. JSON, Exit 0 oder 1.
@MainActor
enum SelfTestSearch {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }
    struct Report: Encodable { let ok: Bool; let checks: [Check] }

    static func run() async -> Int32 {
        guard TestDatabase.isTestCopy, ProcessInfo.processInfo.environment["ORBIT_FAKE_SANDBOX"] == "1" else {
            FileHandle.standardError.write(Data("{\"ok\":false,\"error\":\"Nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ORBIT_FAKE_SANDBOX=1.\"}\n".utf8))
            return 1
        }
        let model = AppModel()
        defer { model.shutdown() }
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String) { checks.append(Check(name: name, ok: ok, detail: detail)) }
        var window: NSWindow?
        do {
            await model.start()
            guard let orbi = model.botStore.orbis.first else { throw SpikeError("Kein Orbi in der Kopie.") }
            let db = try TestDatabase()
            let word = "Quarkkuchen" + String(UUID().uuidString.prefix(6)).filter(\.isLetter).lowercased() + "x"
            let chatId = orbi.chatId
            // Zielnachricht, dahinter 40 Füllnachrichten: der Chat muss zur Nachricht scrollen, sie steht nicht unten.
            let target = try db.addIndexedMessage(chatId: chatId, role: "user", text: "Rezept für \(word) mit Zitrone")
            for index in 0..<40 { try db.addIndexedMessage(chatId: chatId, role: index % 2 == 0 ? "assistant" : "user", text: "Füllnachricht Nummer \(index) ohne das gesuchte Wort") }

            // 1. Suche über das Modell des Suchfelds: entprellt, Treffer mit messageId und Markierung.
            let search = model.search
            search.query = word
            let found = await waitUntil(timeout: 8) { search.results.contains { $0.messageId == target } }
            let hit = search.results.first { $0.messageId == target }
            let parts = hit.map { SearchSnippet.parts($0.snippet) } ?? []
            check("suche-treffer", found && hit?.chatId == chatId && hit?.role == "user", "Treffer \(search.results.count), messageId \(hit?.messageId == target), Chat \(hit?.chatId == chatId)")
            check("suche-markierung", parts.contains { $0.marked && $0.text.lowercased() == word.lowercased() }, "Teile: \(parts.map { ($0.marked ? "«" : "") + $0.text + ($0.marked ? "»" : "") }.joined())")

            // 2. Nichts gefunden: gestalteter Leerzustand.
            search.query = "zzqxnichtdavorhanden"
            let none = await waitUntil(timeout: 8) { search.emptyResult }
            check("suche-keine-treffer", none && search.results.isEmpty, "emptyResult \(search.emptyResult), Treffer \(search.results.count)")

            // 3. Fehler vom Dienst werden gezeigt (Anfrage über 200 Zeichen).
            search.query = String(repeating: "a", count: 201)
            let failed = await waitUntil(timeout: 8) { search.error != nil }
            check("suche-fehler", failed && search.results.isEmpty, "Fehlertext: \(search.error ?? "keiner")")

            // 4. Treffer öffnen: echtes Fenster, Chat an der Stelle, Nachricht hervorgehoben.
            let root = MainWindow(model: model)
            let host = NSHostingView(rootView: AnyView(root))
            let w = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1180, height: 780), styleMask: [.titled], backing: .buffered, defer: false)
            w.appearance = NSAppearance(named: .darkAqua)
            w.contentView = host
            w.alphaValue = 0
            NSApp.activate(ignoringOtherApps: true)
            w.makeKeyAndOrderFront(nil)
            window = w
            try await Task.sleep(for: .seconds(1.5))
            search.query = word
            _ = await waitUntil(timeout: 8) { search.results.contains { $0.messageId == target } }
            let index = search.results.firstIndex { $0.messageId == target } ?? 0
            model.openSearchHit(index)
            let session = model.chatStore.session(for: chatId)
            let highlighted = await waitUntil(timeout: 10) { session.highlighted == target }
            check("treffer-oeffnet-chat", model.selection == .bot(orbi.id) && highlighted && search.query.isEmpty && !search.paletteOpen, "Auswahl \(String(describing: model.selection)), hervorgehoben \(highlighted), Suche geleert \(search.query.isEmpty)")

            // 5. ⌘K öffnet die Palette, Esc schließt sie (echte Tastenereignisse ins Fenster).
            func key(_ characters: String, code: UInt16, modifiers: NSEvent.ModifierFlags = []) async {
                for type in [NSEvent.EventType.keyDown, .keyUp] {
                    if let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: modifiers, timestamp: ProcessInfo.processInfo.systemUptime,
                                                    windowNumber: w.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) {
                        // Kürzel mit ⌘ laufen wie im Betrieb über performKeyEquivalent des Fensters, alles andere an den ersten Empfänger.
                        if modifiers.contains(.command) { if type == .keyDown { _ = w.performKeyEquivalent(with: event) } } else { w.sendEvent(event) }
                    }
                }
                try? await Task.sleep(for: .milliseconds(200))
            }
            var opened = false
            for _ in 0..<3 where !opened { await key("k", code: 40, modifiers: .command); opened = search.paletteOpen; if !opened { try? await Task.sleep(for: .milliseconds(300)) } }
            check("kuerzel-cmd-k", opened, "Palette offen: \(search.paletteOpen)")
            search.query = word
            _ = await waitUntil(timeout: 8) { search.results.contains { $0.messageId == target } }
            try? await Task.sleep(for: .milliseconds(600))
            var closed = false
            for _ in 0..<3 where !closed { await key("\u{1b}", code: 53); closed = !search.paletteOpen; if !closed { try? await Task.sleep(for: .milliseconds(300)) } }
            check("kuerzel-esc", closed && search.query.isEmpty, "Palette offen: \(search.paletteOpen), Eingabe: „\(search.query)“")

            // 6. Treffer eines gelöschten Chats: Hinweis statt Absturz oder Stille (Gruppe anlegen, Nachricht säen, suchen, Gruppe löschen).
            let groupId = try await model.client.createGroup(name: "Suche-Test", botIds: [orbi.id]).id
            let ghostWord = "Geisterwort" + String(UUID().uuidString.prefix(6)).filter(\.isLetter).lowercased() + "x"
            try db.addIndexedMessage(chatId: groupId, text: "Hier steht \(ghostWord)")
            await model.botStore.load()
            search.query = ghostWord
            _ = await waitUntil(timeout: 8) { search.results.contains { $0.chatId == groupId } }
            try await model.client.deleteGroup(id: groupId)
            await model.botStore.load()
            let before = model.selection
            model.openSearchHit(0)
            check("treffer-chat-geloescht", search.openError == "Dieser Chat existiert nicht mehr." && model.selection == before, "Hinweis: \(search.openError ?? "keiner")")
            search.reset()
        } catch {
            check("fehler", false, error.localizedDescription)
        }
        window?.orderOut(nil)
        let report = Report(ok: checks.allSatisfy(\.ok), checks: checks)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(report), let text = String(data: data, encoding: .utf8) { print(text) }
        return report.ok ? 0 : 1
    }

    private static func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return condition()
    }
}

final class SelfTestSearchDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestSearch.run()) }
    }
}
