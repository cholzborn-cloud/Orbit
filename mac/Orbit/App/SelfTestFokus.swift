import AppKit
import SwiftUI

// `Orbit --selftest-fokus`: echtes (unsichtbares) Hauptfenster mit Beispieldaten, ohne Dienst. Klickt wie mit der Maus auf Chat-Zeile,
// Hauptorbi, leere Fläche der Seitenleiste und Profilknopf (Menü auf und zu) und prüft, dass das Suchfeld dabei nie den Tastaturfokus
// bekommt; ein Klick in die Suche fokussiert sie, ⌘K öffnet die Palette. JSON, Exit 0 oder 1.
@MainActor
enum SelfTestFokus {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }
    struct Report: Encodable { let ok: Bool; let checks: [Check] }

    static func run() async -> Int32 {
        let model = MenuFixtures.model()
        let frames = MenuFixtures.Frames()
        let window = MenuFixtures.window(model, frames: frames)
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        defer { window.orderOut(nil) }
        try? await Task.sleep(for: .seconds(1.5))
        var checks: [Check] = []

        // Suchfeld fokussiert: SwiftUI meldet es, oder ein Feldeditor (einzeiliges Textfeld) ist erster Empfänger, ohne dass die Palette offen
        // ist (der Composer ist ein mehrzeiliger Textbereich, kein Feldeditor).
        func searchFocused() -> Bool {
            let fieldEditor = ((window.firstResponder as? NSText)?.delegate as? NSTextField) != nil
            return model.search.fieldFocused || (fieldEditor && !model.search.paletteOpen)
        }
        func responder() -> String {
            guard let first = window.firstResponder else { return "nil" }
            let field = ((first as? NSText)?.delegate as? NSView).map { " in " + String(describing: type(of: $0)) } ?? ""
            return String(describing: type(of: first)) + field
        }
        func probe(_ name: String, _ target: String, at point: (CGRect) -> CGPoint) async {
            guard let frame = frames.frames[target] else { checks.append(Check(name: name, ok: false, detail: "\(target) nicht gefunden")); return }
            await MenuFixtures.click(window, at: point(frame))
            checks.append(Check(name: name, ok: !searchFocused(), detail: "erster Empfänger \(responder()), SwiftUI-Fokus \(model.search.fieldFocused), Auswahl \(String(describing: model.selection)), Menü \(model.overlay.menu != nil), key \(window.isKeyWindow) aktiv \(NSApp.isActive)"))
        }
        let center: (CGRect) -> CGPoint = { CGPoint(x: $0.midX, y: $0.midY) }

        checks.append(Check(name: "start-ohne-suchfokus", ok: !searchFocused(), detail: "erster Empfänger \(responder())"))
        await probe("klick-chatzeile", "chat-row-bot-ux-orbi-2", at: center)
        await probe("klick-hauptorbi", "main-card", at: center)
        await probe("klick-chatzeile-2", "chat-row-bot-ux-orbi-1", at: center)
        // Leere Fläche: unter der letzten Zeile, über dem Profilknopf.
        await probe("klick-leere-flaeche", "sidebar") { CGPoint(x: $0.midX, y: $0.maxY - Theme.Metrics.pt120) }
        await probe("klick-profil-auf", "menu-anchor-menu-account", at: center)
        await probe("klick-profil-zu", "menu-anchor-menu-account", at: center)
        await probe("klick-chatbereich", "sidebar") { CGPoint(x: $0.maxX + Theme.Metrics.pt200, y: $0.midY) }

        // Orbi arbeitet: der Composer ist gesperrt und gibt den Fokus ab; er darf nicht in der Suche landen und kommt danach zurück.
        if case .bot(let id) = model.selection, let bot = model.botStore.bot(id: id) {
            let session = model.chatStore.session(for: bot.chatId)
            let messages = session.messages
            session.simulate(messages: messages, running: true)
            try? await Task.sleep(for: .milliseconds(400))
            checks.append(Check(name: "laeuft-gesperrt", ok: !searchFocused(), detail: "erster Empfänger \(responder())"))
            await probe("laeuft-leere-flaeche", "sidebar") { CGPoint(x: $0.midX, y: $0.maxY - Theme.Metrics.pt120) }
            await probe("laeuft-profil-auf", "menu-anchor-menu-account", at: center)
            await probe("laeuft-profil-zu", "menu-anchor-menu-account", at: center)
            await probe("laeuft-chatbereich", "sidebar") { CGPoint(x: $0.maxX + Theme.Metrics.pt200, y: $0.midY) }
            session.simulate(messages: messages, running: false)
            try? await Task.sleep(for: .milliseconds(400))
            let composer = window.firstResponder is NSTextView && !(((window.firstResponder as? NSText)?.delegate as? NSTextField) != nil)
            checks.append(Check(name: "nach-lauf-composer", ok: composer && !searchFocused(), detail: "erster Empfänger \(responder())"))
        } else { checks.append(Check(name: "laeuft-gesperrt", ok: false, detail: "kein Orbi-Chat gewählt")) }

        // Fensterwechsel: ein anderes Fenster war vorn, der Klick in die Seitenleiste holt Orbit zurück (Fenster wird wieder Hauptfenster).
        let other = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
        other.alphaValue = 0
        for (name, reset) in [("fensterwechsel-composer", { () -> Void in }), ("fensterwechsel-ohne-empfaenger", { window.makeFirstResponder(nil) }),
                              ("fensterwechsel-hostview", { window.makeFirstResponder(window.contentView) })] as [(String, () -> Void)] {
            reset()
            other.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(300))
            await probe(name, "chat-row-bot-ux-orbi-2", at: center)
            other.makeKeyAndOrderFront(nil)
            try? await Task.sleep(for: .milliseconds(300))
            await probe(name + "-leer", "sidebar") { CGPoint(x: $0.midX, y: $0.maxY - Theme.Metrics.pt120) }
        }
        other.orderOut(nil)

        // Ohne Fokus im Composer (z. B. nach einem Menü oder Klick in den Verlauf): Fenster ohne ersten Empfänger, dann Klicks.
        window.makeFirstResponder(nil)
        await probe("ohne-empfaenger-chatzeile", "chat-row-bot-ux-orbi-2", at: center)
        window.makeFirstResponder(nil)
        await probe("ohne-empfaenger-leer", "sidebar") { CGPoint(x: $0.midX, y: $0.maxY - Theme.Metrics.pt120) }
        window.makeFirstResponder(window.contentView)
        await probe("hostview-leer", "sidebar") { CGPoint(x: $0.midX, y: $0.maxY - Theme.Metrics.pt120) }
        window.makeFirstResponder(window.contentView)
        await probe("hostview-hauptorbi", "main-card", at: center)

        // Gegenprobe: Klick in die Suche fokussiert sie, danach nimmt ein Klick auf eine Chat-Zeile ihr den Fokus.
        if let search = frames.frames["sidebar-search"] {
            await MenuFixtures.click(window, at: CGPoint(x: search.midX, y: search.midY))
            checks.append(Check(name: "klick-suche-fokussiert", ok: searchFocused(), detail: "erster Empfänger \(responder()), SwiftUI-Fokus \(model.search.fieldFocused), Feld \(model.search.fieldActive)"))
        } else { checks.append(Check(name: "klick-suche-fokussiert", ok: false, detail: "sidebar-search nicht gefunden")) }
        await probe("klick-chatzeile-nach-suche", "chat-row-bot-ux-orbi-3", at: center)
        // Nach benutzter Suche: Hauptorbi, Profilmenü und leere Fläche holen den Fokus nicht zurück in die Suche.
        for (name, target, point) in [("hauptorbi", "main-card", center), ("profil", "menu-anchor-menu-account", center),
                                      ("leere-flaeche", "sidebar", { CGPoint(x: $0.midX, y: $0.maxY - Theme.Metrics.pt120) })] as [(String, String, (CGRect) -> CGPoint)] {
            if let search = frames.frames["sidebar-search"] { await MenuFixtures.click(window, at: CGPoint(x: search.midX, y: search.midY)) }
            await probe("nach-suche-\(name)", target, at: point)
            if model.overlay.menu != nil { model.overlay.menu = nil; try? await Task.sleep(for: .milliseconds(300)) }
            checks.append(Check(name: "nach-suche-\(name)-danach", ok: !searchFocused(), detail: "erster Empfänger \(responder())"))
        }

        // Rechtsklick auf eine Chat-Zeile öffnet ihr Kontextmenü (Monitor der Menü-Ebene gilt nur im eigenen Fenster).
        if let row = frames.frames["chat-row-bot-ux-orbi-2"], let event = NSEvent.mouseEvent(with: .rightMouseDown, location: NSPoint(x: row.midX, y: (window.contentView?.bounds.height ?? 0) - row.midY),
                                                                                     modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window.windowNumber,
                                                                                     context: nil, eventNumber: 0, clickCount: 1, pressure: 1) {
            NSApp.postEvent(event, atStart: false)
            try? await Task.sleep(for: .milliseconds(400))
            let titles = model.overlay.menu?.items.map(\.title) ?? []
            checks.append(Check(name: "rechtsklick-kontextmenue", ok: titles.contains("Umbenennen"), detail: "Einträge \(titles)"))
            model.overlay.menu = nil
            try? await Task.sleep(for: .milliseconds(300))
        } else { checks.append(Check(name: "rechtsklick-kontextmenue", ok: false, detail: "Chat-Zeile nicht gefunden")) }

        // ⌘K: Palette öffnet sich (eigenes Feld), das Suchfeld der Seitenleiste bleibt ohne Fokus.
        if let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: ProcessInfo.processInfo.systemUptime,
                                        windowNumber: window.windowNumber, context: nil, characters: "k", charactersIgnoringModifiers: "k", isARepeat: false, keyCode: 40) {
            _ = window.performKeyEquivalent(with: event)
        }
        try? await Task.sleep(for: .milliseconds(500))
        checks.append(Check(name: "cmd-k-palette", ok: model.search.paletteOpen && !searchFocused(), detail: "Palette \(model.search.paletteOpen), erster Empfänger \(responder())"))

        let report = Report(ok: checks.allSatisfy(\.ok), checks: checks)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(report) { FileHandle.standardOutput.write(data + Data("\n".utf8)) }
        return report.ok ? 0 : 1
    }
}

final class SelfTestFokusDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestFokus.run()) }
    }
}
