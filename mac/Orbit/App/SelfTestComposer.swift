import AppKit
import SwiftUI
import Foundation

// `Orbit --selftest-composer`: prüft den Composer gegen eine Datenbankkopie (ORBIT_DATA_DIR): Katalog, Slash-Auswahl mit Skill,
// Modell- und Moduswechsel samt Merken, Anhänge (Verkleinern, Grenzen, Einfügen, echtes Senden). JSON, Exit 0 oder 1.
// Sendet zwei echte kurze Fragen an ein kleines Modell (Haiku, niedrig). Tastatur und Ablegen sind Fensterereignisse und stehen
// in den Screenshot-Szenen, nicht hier.
@MainActor
enum SelfTestComposer {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }
    struct Report: Encodable { let ok: Bool; let chatId: String; let checks: [Check] }

    private static var secondSkillId: String?

    static func run() async -> Int32 {
        guard TestDatabase.isTestCopy, ProcessInfo.processInfo.environment["ORBIT_FAKE_SANDBOX"] == "1" else {
            FileHandle.standardError.write(Data("{\"ok\":false,\"error\":\"Nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ORBIT_FAKE_SANDBOX=1.\"}\n".utf8))
            return 1
        }
        let model = AppModel()
        defer { model.shutdown() }
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String) { checks.append(Check(name: name, ok: ok, detail: detail)) }
        var skillId: String?
        secondSkillId = nil
        do {
            try await model.service.ensureRunning()
            let client = model.client
            let bots = try await client.bots()
            guard let orbi = bots.main ?? bots.bots.first else { throw ServiceError.server(status: 0, message: "Kein Orbi in der Datenbank.") }
            // Frische Einstellungen: nichts aus früheren Läufen.
            ComposerModel.preferences.removeObject(forKey: "orbit-chat-prefs:\(orbi.chatId)")
            let session = ChatSession(chatId: orbi.chatId, client: client)
            await session.load()
            await session.waitUntilIdle()
            let composer = session.composer

            // 1. Katalog: Modelle und Jev-Einstellung; Standard ist das erste Modell, wie im Web.
            await composer.loadCatalog()
            check("katalog", composer.catalog == .loaded && composer.selectedModel != nil && composer.canSend,
                  "\(composer.models.count) Modelle, verfügbar \(composer.modelsAvailable), gewählt \(composer.modelId)")

            // 2. Modell, Stufe, Auto, Kontext: wechseln, in die Anfrage übernehmen, merken.
            if let small = composer.models.first(where: { $0.id == "claude-haiku-5-5" }) ?? composer.models.first {
                composer.select(model: small.id)
                composer.setEffort("low")
            }
            composer.context = false
            let request = try client.turnRequest(chatId: session.chatId, message: .user("x"), model: composer.effectiveModelId, effort: composer.effort,
                                                 botId: nil, context: composer.context, regenerate: false)
            let body = (try? JSONSerialization.jsonObject(with: request.httpBody ?? Data())) as? [String: Any]
            let data = body?["clientData"] as? [String: Any]
            check("modell-und-kontext", data?["model"] as? String == composer.modelId && data?["effort"] as? String == "low"
                  && data?["approvalMode"] == nil && data?["context"] as? Bool == false,
                  "clientData: \(data ?? [:])")
            composer.select(model: ModelInfo.autoId)
            check("auto", composer.isAuto && composer.effort == nil && composer.modelTitle == "Jev", "Auto: Stufe \(composer.effort ?? "keine"), Titel \(composer.modelTitle)")
            let reopened = ComposerModel(chatId: session.chatId, client: client)
            check("merken", reopened.modelId == ModelInfo.autoId && reopened.efforts.values.contains("low"),
                  "frisch geöffnet: Modell \(reopened.modelId)")
            // Alter Eintrag mit approvalMode lädt ohne Absturz; beim Speichern fehlt der Schlüssel.
            let legacyKey = "orbit-chat-prefs:selftest-legacy"
            ComposerModel.preferences.set(Data(#"{"modelId":"x","approvalMode":"allow_all","efforts":{}}"#.utf8), forKey: legacyKey)
            let legacy = ComposerModel(chatId: "selftest-legacy", client: client)
            legacy.context = true; legacy.select(model: "y")
            let rewritten = ComposerModel.preferences.data(forKey: legacyKey).map { String(decoding: $0, as: UTF8.self) } ?? ""
            ComposerModel.preferences.removeObject(forKey: legacyKey)
            check("alter-modus", legacy.modelId == "y" && !rewritten.contains("approvalMode"), "gespeichert: \(rewritten.prefix(80))")
            composer.select(model: composer.models.first(where: { $0.id == "claude-haiku-5-5" })?.id ?? composer.models.first?.id ?? "")
            composer.setEffort("low")
            composer.context = true

            // 3. Slash: Skill anlegen, filtern, wählen, mit Skill senden.
            let create = try client.request("/v1/skills", method: "POST", body: try JSONSerialization.data(withJSONObject: [
                "name": "composer-test", "description": "Testskill des Composer-Selbsttests", "body": "Antworte kurz und beginne mit dem Wort SKILLTEST."]))
            if let object = try? JSONSerialization.jsonObject(with: try await client.data(for: create)) as? [String: Any], let skill = object["skill"] as? [String: Any] { skillId = skill["id"] as? String }
            let second = try client.request("/v1/skills", method: "POST", body: try JSONSerialization.data(withJSONObject: [
                "name": "composer-test-2", "description": "Zweiter Testskill", "body": "Antworte kurz."]))
            if let object = try? JSONSerialization.jsonObject(with: try await client.data(for: second)) as? [String: Any], let skill = object["skill"] as? [String: Any] { secondSkillId = skill["id"] as? String }
            await composer.reloadSkills()
            let hits = composer.filteredSkills(for: "/composer")
            let none = composer.filteredSkills(for: "/zzzzzz-kein-treffer")
            check("slash-filter", SlashMenuLogic.query(in: "/comp") == "comp" && SlashMenuLogic.query(in: "/comp x") == nil && SlashMenuLogic.query(in: "text") == nil
                  && hits.contains { $0.name == "composer-test" } && none.isEmpty,
                  "\(composer.skills.count) Skills, Treffer für „/composer“: \(hits.map(\.name)), ohne Treffer: \(none.count)")
            let chosen = hits.first { $0.name == "composer-test" }
            check("slash-auswahl", chosen != nil, "Skill gefunden")
            if let chosen { _ = await composer.choose(chosen) }
            check("slash-chip", composer.skill?.name == "composer-test", "Chip: /\(composer.skill?.name ?? "–")")

            // 4. Anhänge: Verkleinern, Grenzen, Einfügen.
            let big = makePNG(width: 3200, height: 2000)
            composer.add(data: big, filename: "gross.png", mediaType: "image/png")
            let shrunk = composer.attachments.last
            let side = shrunk?.thumbnail.map { max($0.representations.first?.pixelsWide ?? 0, $0.representations.first?.pixelsHigh ?? 0) } ?? 0
            // Inhalt erhalten: die Mitte des Bilds ist nicht weiß (Verlauf, nicht der weiße Untergrund).
            var notBlank = false
            if let shrunk, let rep = NSBitmapImageRep(data: shrunk.data), let color = rep.colorAt(x: rep.pixelsWide / 2, y: rep.pixelsHigh / 2)?.usingColorSpace(.deviceRGB) {
                notBlank = color.redComponent + color.greenComponent < 1.7
            }
            check("anhang-verkleinern", notBlank && shrunk?.mediaType == "image/jpeg" && shrunk?.filename == "gross.jpg" && side > 0 && side <= 1600 && (shrunk?.data.count ?? .max) <= AttachmentRules.maxSendBytes,
                  "\(big.count) B → \(shrunk?.data.count ?? 0) B, längste Seite \(side) px, \(shrunk?.filename ?? "–")")
            composer.add(data: Data("Das Codewort ist ZITRONE.".utf8), filename: "notiz.txt", mediaType: "text/plain")
            let tooBigBefore = composer.attachments.count
            composer.add(data: Data(count: AttachmentRules.maxAddBytes + 1), filename: "riesig.bin", mediaType: "application/octet-stream")
            check("anhang-zu-gross", composer.attachments.count == tooBigBefore && composer.attachError == AttachmentRules.Failure.tooBig(name: "riesig.bin").text,
                  "Fehler: \(composer.attachError ?? "keiner")")
            // 2-MB-Grenze erst beim Senden (wie im Web): der Anhang lässt sich hinzufügen, das Senden lehnt ab, Eingabe und Anhang bleiben.
            composer.add(data: Data(count: AttachmentRules.maxSendBytes + 1), filename: "unkomprimiert.bin", mediaType: "application/octet-stream")
            let addedBig = composer.attachments.count == tooBigBefore + 1
            let messagesBefore = session.messages.count
            session.draft = "Prüftext"
            session.send(session.draft)
            let blocked = session.messages.count == messagesBefore && session.draft == "Prüftext" && composer.attachments.count == tooBigBefore + 1
            check("anhang-sendegrenze", addedBig && blocked && composer.attachError == AttachmentRules.Failure.tooBigToSend(name: "unkomprimiert.bin").text,
                  "hinzugefügt \(addedBig), Senden abgelehnt \(blocked), Fehler: \(composer.attachError ?? "keiner")")
            if let big = composer.attachments.last, big.filename == "unkomprimiert.bin" { composer.removeAttachment(big.id) }
            session.draft = ""
            let keep = composer.attachments
            while composer.attachments.count < AttachmentRules.maxFiles { composer.add(data: Data("x".utf8), filename: "f\(composer.attachments.count).txt", mediaType: "text/plain") }
            composer.add(data: Data("x".utf8), filename: "elf.txt", mediaType: "text/plain")
            check("anhang-zu-viele", composer.attachments.count == AttachmentRules.maxFiles && composer.attachError == AttachmentRules.Failure.tooMany.text, "Fehler: \(composer.attachError ?? "keiner")")
            while composer.attachments.count > keep.count { composer.removeAttachment(composer.attachments.last!.id) }
            check("anhang-entfernen", composer.attachments.count == keep.count, "\(composer.attachments.count) Anhänge")
            let board = NSPasteboard(name: NSPasteboard.Name("de.consti.orbit2.selftest.\(UUID().uuidString)"))
            board.clearContents()
            board.setData(makePNG(width: 40, height: 40), forType: .png)
            let pastedImage = ComposerView.paste(into: composer, from: board)
            board.clearContents()
            board.setString("nur Text", forType: .string)
            let pastedText = ComposerView.paste(into: composer, from: board)
            check("einfuegen", pastedImage && composer.attachments.last?.filename == "einfügung.png" && !pastedText, "Bild eingefügt: \(pastedImage), Text bleibt beim Feld: \(!pastedText)")
            composer.removeAttachment(composer.attachments.last!.id)
            // Dateien aus Finder/Ablegen/Büroklammer kommen als URLs: gleicher Weg wie Cmd+V.
            let fileURL = FileManager.default.temporaryDirectory.appending(path: "orbit-composer-\(UUID().uuidString).txt")
            try Data("aus Datei".utf8).write(to: fileURL)
            let beforeURLs = composer.attachments.count
            composer.add(urls: [fileURL, fileURL.deletingLastPathComponent().appending(path: "gibt-es-nicht.txt")])
            try? FileManager.default.removeItem(at: fileURL)
            check("anhang-datei", composer.attachments.count == beforeURLs + 1 && composer.attachments.last?.mediaType == "text/plain" && composer.attachError?.hasSuffix("konnte nicht gelesen werden.") == true,
                  "Anhang: \(composer.attachments.last?.filename ?? "–"), Fehler für fehlende Datei: \(composer.attachError ?? "keiner")")
            composer.removeAttachment(composer.attachments.last!.id)

            // 5. Tastatur: echte Tastenereignisse in ein unsichtbares Fenster mit dem Composer.
            await keyboard(session: session, client: client, check: check)

            // 6. Echtes Senden mit Skill, Bild und Textdatei gegen die Kopie.
            let before = session.messages.count
            session.send("Wie lautet das Codewort in der Textdatei? Antworte in einem Satz.")
            let finished = await waitUntil(timeout: 120) { !session.isRunning && session.messages.count >= before + 2 }
            let stored = (try? await client.messages(chatId: session.chatId)) ?? []
            let sent = stored.last { $0.role == .user }
            let fileCount = sent?.parts.filter { if case .file = $0 { true } else { false } }.count ?? 0
            let reply = stored.last { $0.role == .assistant }?.text ?? ""
            check("senden-mit-anhang", finished && session.error == nil && fileCount == 2 && sent?.metadata?.skill?.name == "composer-test",
                  "Dateien in der gespeicherten Nachricht: \(fileCount), Skill: \(sent?.metadata?.skill?.name ?? "–"), Fehler: \(session.error ?? "keiner")")
            check("antwort-kennt-datei", reply.uppercased().contains("ZITRONE"), "Antwort: \(reply.prefix(120))")
            check("verbraucht", composer.attachments.isEmpty && composer.skill == nil, "Anhänge \(composer.attachments.count), Skill \(composer.skill?.name ?? "–")")
        } catch {
            check("fehler", false, error.localizedDescription)
        }
        if let second = secondSkillId, let request = try? model.client.request("/v1/skills/\(second)", method: "DELETE") { _ = try? await model.client.data(for: request) }
        if let skillId, let request = try? model.client.request("/v1/skills/\(skillId)", method: "DELETE") { _ = try? await model.client.data(for: request) }
        let report = Report(ok: checks.allSatisfy(\.ok), chatId: "", checks: checks)
        if let data = try? { () throws -> Data in let e = JSONEncoder(); e.outputFormatting = [.prettyPrinted, .sortedKeys]; return try e.encode(report) }() { print(String(decoding: data, as: UTF8.self)) }
        return report.ok ? 0 : 1
    }

    // Farbverlauf mit Rauschen als PNG: groß und nicht trivial komprimierbar, damit das Verkleinern greift.
    static func makePNG(width: Int, height: Int) -> Data {
        var pixels = [UInt8](repeating: 255, count: width * height * 4)
        var seed: UInt32 = 12345
        for y in 0..<height { for x in 0..<width {
            seed = seed &* 1664525 &+ 1013904223
            let i = (y * width + x) * 4
            pixels[i] = UInt8(x * 255 / width); pixels[i + 1] = UInt8(y * 255 / height); pixels[i + 2] = UInt8(seed >> 24)
        } }
        let image = pixels.withUnsafeMutableBytes { raw -> CGImage? in
            CGContext(data: raw.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)?.makeImage()
        }
        return image.flatMap { NSBitmapImageRep(cgImage: $0).representation(using: .png, properties: [:]) } ?? Data()
    }

    private static func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }
}

extension SelfTestComposer {
    // Tippt, bricht um, sendet, wählt im Slash-Menü und stoppt: alles über NSEvent im Fenster, nicht über die Modelle.
    static func keyboard(session: ChatSession, client: ServiceClient, check: (String, Bool, String) -> Void) async {
        let composer = session.composer
        let saved = (composer.skill, composer.attachments)
        composer.consume()
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 900, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = NSHostingView(rootView: ComposerView(session: session, members: []).frame(width: 900, height: 300).background(Theme.Palette.background))
        window.alphaValue = 0
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
        // Fokus ins Eingabefeld: abwarten, sonst das Textfeld selbst zum ersten Empfänger machen.
        func textView(in view: NSView?) -> NSTextView? {
            guard let view else { return nil }
            if let found = view as? NSTextView { return found }
            for sub in view.subviews { if let found = textView(in: sub) { return found } }
            return nil
        }
        for _ in 0..<40 {
            try? await Task.sleep(for: .milliseconds(100))
            if let field = textView(in: window.contentView) { window.makeFirstResponder(field); if window.firstResponder === field && window.isKeyWindow { break } }
        }
        try? await Task.sleep(for: .milliseconds(300))
        func key(_ characters: String, code: UInt16, modifiers: NSEvent.ModifierFlags = []) async {
            for type in [NSEvent.EventType.keyDown, .keyUp] {
                if let event = NSEvent.keyEvent(with: type, location: .zero, modifierFlags: modifiers, timestamp: ProcessInfo.processInfo.systemUptime,
                                                windowNumber: window.windowNumber, context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code) {
                    window.sendEvent(event)
                }
            }
            try? await Task.sleep(for: .milliseconds(120))
        }
        // Tippen mit Bestätigung: ein Zeichen gilt erst, wenn der Entwurf gewachsen ist; ein verschlucktes wird einmal wiederholt.
        func type(_ text: String) async {
            for character in text {
                for _ in 0..<3 {
                    let before = session.draft.count
                    await key(String(character), code: 0)
                    if await waitUntil(timeout: 1, { session.draft.count > before }) { break }
                }
            }
        }

        session.draft = ""
        await type("Hallo")
        check("tastatur-tippen", session.draft == "Hallo", "Entwurf nach Tippen: „\(session.draft)“")
        for _ in 0..<3 {
            await key("\r", code: 36, modifiers: .shift)
            if await waitUntil(timeout: 1, { session.draft.contains("\n") }) { break }
        }
        await type("Welt")
        check("tastatur-shift-enter", session.draft.contains("\n") && session.draft.hasSuffix("Welt") && !session.isRunning, "Entwurf: \(session.draft.debugDescription), läuft: \(session.isRunning)")
        session.draft = ""
        // Slash: Pfeile wählen, Esc schließt und leert.
        await composer.reloadSkills()
        await type("/composer")
        let count = composer.filteredSkills(for: session.draft).count
        await key("\u{F701}", code: 125)
        let down = composer.slashIndex
        await key("\u{F700}", code: 126)
        let up = composer.slashIndex
        check("tastatur-slash-pfeile", count >= 2 && down == 1 && up == 0, "Treffer \(count), nach unten \(down), nach oben \(up)")
        await key("\u{F701}", code: 125)
        await key("\r", code: 36)
        check("tastatur-slash-enter", composer.skill?.name == "composer-test-2" && session.draft.isEmpty, "Skill: \(composer.skill?.name ?? "–"), Entwurf: „\(session.draft)“")
        composer.consume()
        await type("/composer")
        await key("\u{1b}", code: 53)
        check("tastatur-slash-esc", session.draft.isEmpty && composer.skill == nil, "Entwurf nach Esc: „\(session.draft)“")
        // Enter sendet, Esc stoppt den Lauf.
        await type("Schreibe eine lange Geschichte über einen Planeten, mindestens 600 Wörter.")
        await key("\r", code: 36)
        let started = await waitUntil(timeout: 20) { session.isRunning }
        check("tastatur-enter-sendet", started && session.draft.isEmpty, "läuft: \(session.isRunning), Entwurf leer: \(session.draft.isEmpty)")
        _ = await waitUntil(timeout: 30) { (session.lastAssistant?.text.count ?? 0) > 20 }
        await key("\u{1b}", code: 53)
        let stopped = await waitUntil(timeout: 30) { !session.isRunning }
        check("tastatur-esc-stoppt", stopped, "läuft nach Esc: \(session.isRunning)")
        await session.waitUntilIdle()
        try? await Task.sleep(for: .seconds(1))
        window.orderOut(nil)
        if let skill = saved.0 { _ = await composer.choose(skill) }
        for attachment in saved.1 { composer.add(data: attachment.data, filename: attachment.filename, mediaType: attachment.mediaType) }
    }
}

final class SelfTestComposerDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestComposer.run()) }
    }
}
