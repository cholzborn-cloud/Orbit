import Foundation

// `Orbit --selftest-chat [detach|attach]`: sendet echte Testfragen an einen Orbi (nur gegen eine Kopie der Datenbank
// mit ORBIT_DATA_DIR verwenden), prüft Streaming, Speichern, Stopp und Wiederanhängen. JSON, Exit 0 oder 1.
@MainActor
enum SelfTestChat {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }
    struct Report: Encodable {
        let ok: Bool
        let chatId: String
        let model: String
        let serviceStartedByApp: Bool
        let checks: [Check]
    }

    // Für den Zwei-Prozesse-Test: lang genug, dass die Antwort beim Wiederöffnen noch läuft.
    private static let veryLongPrompt = "Schreibe eine sehr ausführliche Geschichte über einen kleinen Planeten, mindestens 2500 Wörter, in vielen Absätzen."
    private static let longPrompt = "Schreibe eine ausführliche Geschichte über einen kleinen Planeten, mindestens 800 Wörter, in Absätzen."

    static func run(arguments: [String]) async -> Int32 {
        let phase = arguments.drop { $0 != "--selftest-chat" }.dropFirst().first(where: { !$0.hasPrefix("--") }) ?? "full"
        let model = AppModel()
        defer { model.shutdown() }
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String) { checks.append(Check(name: name, ok: ok, detail: detail)) }
        do {
            try await model.service.ensureRunning()
            let bots = try await model.client.bots()
            guard let orbi = (bots.main.map { [$0] } ?? []).first ?? bots.bots.first
            else { throw ServiceError.server(status: 0, message: "Kein Orbi in der Datenbank.") }
            let session = ChatSession(chatId: orbi.chatId, client: model.client)
            session.model = ProcessInfo.processInfo.environment["ORBIT_TEST_MODEL"] ?? "claude-haiku-5-5"
            session.effort = "low"
            await session.load()
            if phase != "attach" { await session.waitUntilIdle() }
            switch phase {
            case "detach": await detach(session, check)
            case "attach": await attach(session, model.client, check)
            default: await full(session, model.client, check)
            }
            let report = Report(
                ok: checks.allSatisfy(\.ok), chatId: orbi.chatId, model: session.model,
                serviceStartedByApp: model.service.startedByApp, checks: checks)
            print(try encode(report))
            return report.ok ? 0 : 1
        } catch {
            FileHandle.standardError.write(Data("{\"ok\":false,\"error\":\"\(error.localizedDescription)\"}\n".utf8))
            return 1
        }
    }

    // Antwort des gerade laufenden Turns: die erste Assistent-Nachricht, die vorher nicht im Verlauf stand.
    private static func answer(_ session: ChatSession, known: Set<String>) -> ChatMessage? {
        session.messages.last { $0.role == .assistant && !known.contains($0.id) }
    }

    private static func full(_ session: ChatSession, _ client: ServiceClient, _ check: (String, Bool, String) -> Void) async {
        var known = Set(session.messages.map(\.id))
        let before = session.messages.count

        // 1. Senden: Antwort streamt in mehreren Chunks, danach liegt sie im Dienst.
        session.send("Antworte nur mit dem Wort OK-SELBSTTEST.")
        let started = Date()
        _ = await waitUntil(timeout: 60) { answer(session, known: known)?.text.isEmpty == false }
        let firstText = Date().timeIntervalSince(started)
        await waitIdle(session, timeout: 90)
        let reply = answer(session, known: known)?.text ?? ""
        check("senden", reply.uppercased().contains("OK") && !session.isRunning && session.error == nil,
              "Antwort: \(reply.prefix(60)), Fehler: \(session.error ?? "keiner")")
        check("streaming", session.receivedChunks > 3, "\(session.receivedChunks) Chunks, erster Text nach \(String(format: "%.1f", firstText)) s")
        let stored = (try? await client.messages(chatId: session.chatId)) ?? []
        check("speichern", stored.count == before + 2 && stored.last?.text == reply && stored.dropLast().last?.role == .user,
              "\(stored.count) Nachrichten im Dienst (vorher \(before)), Antwort gleich: \(stored.last?.text == reply)")

        // 2. Stopp mitten in einer langen Antwort.
        known = Set(session.messages.map(\.id))
        session.send(longPrompt)
        let grew = await waitUntil(timeout: 60) { (answer(session, known: known)?.text.count ?? 0) > 40 && session.isRunning }
        session.stop()
        await waitIdle(session, timeout: 30)
        let partial = answer(session, known: known)?.text.count ?? 0
        let stoppedFlag = session.messages.last?.stopped == true
        check("stopp", grew && !session.isRunning && partial < 3000 && stoppedFlag,
              "gestoppt nach \(partial) Zeichen, Markierung \"Gestoppt\": \(stoppedFlag), läuft nicht mehr: \(!session.isRunning)")

        // 3. Wiederanhängen: Mitlesen abbrechen (App schließt), neue Sitzung hängt sich an den laufenden Turn.
        known = Set(session.messages.map(\.id))
        session.send(longPrompt)
        _ = await waitUntil(timeout: 60) { (answer(session, known: known)?.text.count ?? 0) > 40 }
        let atDetach = answer(session, known: known)?.text.count ?? 0
        session.detach()
        let reopened = ChatSession(chatId: session.chatId, client: client)
        reopened.model = session.model
        await reopened.load()
        // load() hängt sich selbst an; hier zählt der Zustand danach.
        let attached = await waitUntil(timeout: 10) { reopened.isRunning || (answer(reopened, known: known)?.text.count ?? 0) > atDetach }
        await waitIdle(reopened, timeout: 120)
        let finalLength = answer(reopened, known: known)?.text.count ?? 0
        let persisted = (try? await client.messages(chatId: session.chatId))?.last?.text.count ?? 0
        check("wiederanhaengen", attached && finalLength > atDetach && finalLength == persisted && !reopened.isRunning,
              "beim Schließen \(atDetach) Zeichen, nach dem Wiederanhängen \(finalLength), gespeichert \(persisted)")
    }

    // Startet eine lange Antwort und beendet sich mitten im Lauf (App schließt); bei extern gestartetem Dienst läuft sie weiter.
    private static func detach(_ session: ChatSession, _ check: (String, Bool, String) -> Void) async {
        let known = Set(session.messages.map(\.id))
        session.send(veryLongPrompt)
        let grew = await waitUntil(timeout: 60) { (answer(session, known: known)?.text.count ?? 0) > 40 }
        check("laeuft", grew && session.isRunning, "\(answer(session, known: known)?.text.count ?? 0) Zeichen beim Schließen")
        session.detach()
    }

    // Öffnet den Chat neu und hängt sich an einen noch laufenden Turn: Chunks kommen an, solange die Antwort läuft.
    private static func attach(_ session: ChatSession, _ client: ServiceClient, _ check: (String, Bool, String) -> Void) async {
        let known = session.lastAssistant?.text.count ?? 0
        let replaying = await waitUntil(timeout: 3) { session.receivedChunks > 0 }
        let stillRunning = session.isRunning
        let early = session.lastAssistant?.text.count ?? 0
        await waitIdle(session, timeout: 180)
        let finalLength = session.lastAssistant?.text.count ?? 0
        let persisted = (try? await client.messages(chatId: session.chatId))?.last?.text.count ?? 0
        check("angehaengt", replaying && stillRunning,
              "Chunks beim Öffnen: \(session.receivedChunks > 0), Turn lief noch: \(stillRunning), geladener Verlauf \(known) Zeichen, Text beim Anhängen \(early)")
        check("fertig", finalLength > early && finalLength == persisted && !session.isRunning,
              "Antwort \(finalLength) Zeichen, gespeichert \(persisted)")
    }

    private static func waitIdle(_ session: ChatSession, timeout: TimeInterval) async {
        _ = await waitUntil(timeout: timeout) { !session.isRunning }
    }

    private static func waitUntil(timeout: TimeInterval, _ condition: () -> Bool) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            try? await Task.sleep(for: .milliseconds(50))
        }
        return condition()
    }

    private static func encode(_ value: some Encodable) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        return String(decoding: try encoder.encode(value), as: UTF8.self)
    }
}
