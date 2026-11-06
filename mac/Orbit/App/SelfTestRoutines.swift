import AppKit
import Foundation

// `Orbit --selftest-routinen`: Routinen gegen eine Datenbankkopie (ORBIT_DATA_DIR, ORBIT_FAKE_SANDBOX=1): Eingabeprüfung, anlegen,
// Termin gegen den Dienst gerechnet, bearbeiten, pausieren, Papierkorb, „Jetzt ausführen“ mit Live-Status über /v1/events,
// Verlauf, Chat des Laufs öffnen, Zähler. Der Lauf ist ein echter Turn (Haiku, ein Wort); ohne verfügbare CLI endet er mit Fehler, auch das
// zählt als Ende. JSON, Exit 0 oder 1.
@MainActor
enum SelfTestRoutines {
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
        do {
            try await model.service.ensureRunning()
            await model.botStore.load()
            model.events.start()
            guard let orbi = model.botStore.orbis.first else { throw SpikeError("Kein Orbi in der Kopie.") }
            let store = model.automations
            let marker = "Selbsttest Geplant \(UUID().uuidString.prefix(4))"

            // 1. Liste lädt (leer oder gefüllt), Ereignisstrom steht.
            await store.load()
            _ = await waitUntil(timeout: 10) { model.events.connected }
            check("liste-laedt", store.list.value != nil && model.events.connected, "Einträge \(store.items.count), Papierkorb \(store.trash.count), Ereignisse \(model.events.connected)")

            // 2. Eingabeprüfung ohne Dienst, Texte wie im Web.
            let blank = AutomationFormModel(editing: nil, firstBotId: orbi.id)
            blank.name = "x"; blank.prompt = "Aufgabe"
            let shortName = blank.form().validationMessage
            blank.name = "Gut"; blank.prompt = "  "
            let noPrompt = blank.form().validationMessage
            blank.prompt = "Aufgabe"; blank.at = "25:00"
            let badTime = blank.form().validationMessage
            blank.at = "08:00"; blank.kind = .once; blank.dateText = "31.02.2026"
            let badDate = blank.form().validationMessage
            blank.kind = .monthly; blank.dayText = "40"
            let badDay = blank.form().validationMessage
            check("eingabe-pruefung", shortName == "Name muss mindestens 2 Zeichen haben." && noPrompt == "Prompt fehlt." && badTime == "Uhrzeit ist ungültig." && badDate == "Datum ist ungültig." && badDay == "Monatstag muss zwischen 1 und 31 liegen.",
                  "\(shortName ?? "-") | \(noPrompt ?? "-") | \(badTime ?? "-") | \(badDate ?? "-") | \(badDay ?? "-")")

            // 3. Anlegen über das Formular: Eingaben werden gespeichert.
            let form = AutomationFormModel(editing: nil, firstBotId: orbi.id)
            form.name = marker; form.prompt = "Antworte nur mit dem Wort ok."; form.kind = .weekdays; form.at = "08:30"
            form.target = "new"; form.notify = true; form.modelId = "claude-haiku-5-5"; form.effort = "low"; form.context = false
            let createError = await store.save(form.form(), editing: nil)
            guard var item = store.items.first(where: { $0.automation.name == marker }) else { throw SpikeError("Angelegte Automation fehlt in der Liste (\(createError ?? "kein Fehler")).") }
            let a = item.automation
            check("anlegen", createError == nil && a.schedule.kind == .weekdays && a.schedule.at == "08:30" && a.target == "new" && a.model == "claude-haiku-5-5" && a.effort == "low" && !a.context && item.bot.id == orbi.id,
                  "Fehler \(createError ?? "keiner"), \(a.schedule.summary), Ziel \(a.target), Modell \(a.model ?? "-")/\(a.effort ?? "-"), Kontext \(a.context)")

            // 4. Nächster Termin: die Rechnung der App stimmt mit dem Dienst überein.
            let mine = a.schedule.nextRun(timezone: a.timezone, from: .now)
            let delta = mine.flatMap { m in a.nextRunAt.map { abs(m.timeIntervalSince($0)) } }
            check("naechster-termin", delta != nil && delta! < 60, "App \(mine.map(AutomationFormModel.dateTime) ?? "-"), Dienst \(a.nextRunAt.map(AutomationFormModel.dateTime) ?? "-")")
            var termine: [String] = []
            let probe = Date(timeIntervalSince1970: 1_767_312_000)   // 02.01.2026 00:00 UTC
            for (schedule, zone) in [
                (Schedule(kind: .daily, at: "08:00"), "Europe/Berlin"),
                (Schedule(kind: .weekly, at: "09:15", weekday: 3), "Europe/Berlin"),
                (Schedule(kind: .monthly, at: "07:00", day: 31), "Europe/Berlin"),
                (Schedule(kind: .once, at: "10:00", date: "2026-03-29"), "Europe/Berlin"),
            ] { termine.append(schedule.nextRun(timezone: zone, from: probe).map { ISO8601DateFormatter().string(from: $0) } ?? "nil") }
            // 02.01.2026 ist Freitag. Täglich 08:00 MEZ = 07:00 Z (am 02.01.), Mi 09:15 = 08:15 Z am 07.01., Monatstag 31 → 31.01. 06:00 Z, einmalig 29.03. 10:00 MESZ = 08:00 Z.
            check("termin-rechnung", termine == ["2026-01-02T07:00:00Z", "2026-01-07T08:15:00Z", "2026-01-31T06:00:00Z", "2026-03-29T08:00:00Z"], termine.joined(separator: ", "))

            // 5. Bearbeiten: Name und Zeit ändern, Orbi bleibt.
            let edit = AutomationFormModel(editing: item, firstBotId: orbi.id)
            edit.name = marker + " (neu)"; edit.at = "09:45"
            let editError = await store.save(edit.form(), editing: item)
            item = store.items.first { $0.id == item.id } ?? item
            check("bearbeiten", editError == nil && item.automation.name == marker + " (neu)" && item.automation.schedule.at == "09:45" && item.bot.id == orbi.id, "Fehler \(editError ?? "keiner"), Name \(item.automation.name), Zeit \(item.automation.schedule.at)")

            // 6. Pausieren und wieder aktivieren (vom Dienst gegengelesen).
            await store.toggle(item, enabled: false)
            let paused = store.items.first { $0.id == item.id }?.automation.enabled
            await store.toggle(item, enabled: true)
            let resumed = store.items.first { $0.id == item.id }?.automation.enabled
            check("pausieren", paused == false && resumed == true && store.error == nil, "pausiert aktiv=\(String(describing: paused)), danach aktiv=\(String(describing: resumed))")

            // 7. Papierkorb: hinein, zurück, hinein, endgültig löschen (nur dort).
            await store.moveToTrash(item)
            let inTrash = store.trash.contains { $0.id == item.id } && !store.items.contains { $0.id == item.id }
            let trashedItem = store.trash.first { $0.id == item.id } ?? item
            await store.restore(trashedItem)
            let back = store.items.contains { $0.id == item.id } && !store.trash.contains { $0.id == item.id }
            check("papierkorb", inTrash && back && store.error == nil, "im Papierkorb \(inTrash), zurück \(back)")

            // 8. Jetzt ausführen: Status live über /v1/events, Verlauf, zweiter Start abgelehnt.
            let unread0 = store.unread
            await store.runNow(item)
            let sawRunning = await waitUntil(timeout: 20) { model.events.automations[item.id]?.status.isActive == true || store.runs[item.id]?.value?.first?.status.isActive == true }
            let activeNow = store.isRunning(item.id)
            let secondStart = await model.client.runAutomationError(id: item.id)
            let ended = await waitUntil(timeout: 150) { model.events.automations[item.id] == nil && store.runs[item.id]?.value?.first?.status.isActive != true && store.items.first { $0.id == item.id }?.automation.lastRunAt != nil }
            await store.loadRuns(item.id)
            let run = store.runs[item.id]?.value?.first
            check("jetzt-ausfuehren", sawRunning && activeNow && ended, "Lauf gesehen \(sawRunning), aktiv \(activeNow), beendet \(ended), Status \(run?.status.rawValue ?? "-")\(run?.error.map { ": \($0)" } ?? "")")
            check("zweiter-start-abgelehnt", secondStart == "Ein Lauf läuft noch oder wartet auf Freigabe.", "Antwort: \(secondStart ?? "angenommen")")
            check("verlauf", run != nil && run?.status.isActive == false && run?.finishedAt != nil && run?.seconds != nil && run?.chatId != nil, "Status \(run?.status.rawValue ?? "-"), Dauer \(run?.seconds.map(String.init) ?? "-") s, Chat \(run?.chatId != nil)")

            // 9. Chat des Laufs öffnet an der Stelle (neuer Chat je Lauf gehört zum Orbi, steht in keiner Liste).
            if let chatId = run?.chatId {
                let opened = model.openChat(chatId, botId: item.bot.id)
                check("lauf-chat-oeffnen", opened && model.selection == .run(chatId: chatId, botId: item.bot.id), "geöffnet \(opened), Auswahl \(String(describing: model.selection))")
                let missing = model.openChat("gibt-es-nicht", botId: "auch-nicht")
                check("lauf-chat-fehlt", !missing, "unbekannter Chat liefert \(missing)")
            } else { check("lauf-chat-oeffnen", false, "Lauf ohne Chat") }

            // 10. Zähler: fertiger Lauf mit App-Hinweis zählt, „gesehen“ setzt auf null.
            await store.refreshUnread()
            let unread1 = store.unread
            store.markSeen()
            await store.refreshUnread()
            check("zaehler", unread1 > unread0 && store.unread == 0, "vorher \(unread0), nach dem Lauf \(unread1), nach „gesehen“ \(store.unread)")

            // 11. Endgültig löschen nur aus dem Papierkorb: erst hinein, dann weg.
            await store.moveToTrash(item)
            let victim = store.trash.first { $0.id == item.id } ?? item
            await store.deleteForever(victim)
            check("endgueltig-loeschen", !store.items.contains { $0.id == item.id } && !store.trash.contains { $0.id == item.id } && store.error == nil, "Liste \(store.items.count), Papierkorb \(store.trash.count), Fehler \(store.error ?? "keiner")")

            // 12. Fehler sind sichtbar: unbekannte Automation ändern liefert einen deutschen Text.
            await store.toggle(victim, enabled: true)
            check("fehler-sichtbar", store.error != nil, "Fehlertext: \(store.error ?? "keiner")")
        } catch {
            check("fehler", false, error.localizedDescription)
        }
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

extension ServiceClient {
    // Für den Test: Fehlertext, wenn der Start abgelehnt wird, sonst nil.
    func runAutomationError(id: String) async -> String? {
        do { _ = try await runAutomation(id: id); return nil } catch { return error.localizedDescription }
    }
}

final class SelfTestRoutinesDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestRoutines.run()) }
    }
}
