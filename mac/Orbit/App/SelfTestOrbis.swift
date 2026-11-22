import Foundation

// `Orbit --selftest-orbis`: legt in der Datenbankkopie (ORBIT_DATA_DIR, ORBIT_FAKE_SANDBOX=1, nie die echte Datenbank, keine Daytona-Sandbox)
// einen Orbi und eine Gruppe an, bearbeitet, löscht (mit Bestätigungspfad), prüft Persistenz, Gruppen mit einem Mitglied,
// „Gelöschter Orbi“, @Name, „[Name]:“-Präfix, Sperre der Eingabe und den Dienst-offline-Fall. JSON, Exit 0 oder 1.
@MainActor
enum SelfTestOrbis {
    struct Check: Encodable { let name: String; let ok: Bool; let detail: String }

    static func run() async -> Int32 {
        var checks: [Check] = []
        func check(_ name: String, _ ok: Bool, _ detail: String = "") { checks.append(Check(name: name, ok: ok, detail: detail)) }
        let environment = ProcessInfo.processInfo.environment
        let model = AppModel()
        defer { model.shutdown() }
        do {
            guard TestDatabase.isTestCopy, environment["ORBIT_FAKE_SANDBOX"] == "1" else {
                throw SpikeError("Nur gegen eine Datenbankkopie mit ORBIT_DATA_DIR und ORBIT_FAKE_SANDBOX=1 (keine echte Sandbox, keine echte Datenbank).")
            }
            let database = try TestDatabase()
            try await model.service.ensureRunning()
            check("Dienst aus der Testkopie gestartet", model.service.startedByApp, "ORBITD_URL \(model.client.baseURL.absoluteString)")
            await model.botStore.load()
            check("Orbis laden", model.botStore.state == .loaded && model.botStore.main != nil, "\(model.botStore.orbis.count) Orbis, \(model.botStore.groups.count) Gruppen")
            let mainId = model.botStore.main?.id ?? ""

            // 1. Anlegen mit allen Feldern und Anpassung
            let editor = BotEditorModel(editing: nil, others: model.botStore.orbis)
            editor.shape = .freddy
            check("Name folgt dem Planeten (neuer Orbi)", editor.name == "Mondi", editor.name)
            editor.name = "Probi"
            editor.selectPreset("Recherche")
            editor.setCustomHue(100); editor.setCustomSaturation(70)
            editor.eyes = .square; editor.accessory = .sunglasses; editor.cheeks = true; editor.gaze = 0.6; editor.reaction = 0.2
            await model.save(editor)
            let probi = model.botStore.bots.first { $0.name == "Probi" }
            check("Anlegen: Orbi erscheint, Dialog schließt, Auswahl springt hin", probi != nil && model.sheet == nil && model.selection == probi.map { .bot($0.id) }, editor.error ?? "")
            guard let probi else { throw SpikeError("Orbi „Probi“ wurde nicht angelegt: \(editor.error ?? "kein Fehlertext")") }
            let look = OrbiLook(avatar: probi.avatar, colorHex: probi.color, look: probi.look)
            check("Felder gespeichert (Planet, Aufgabe, Farbe)", probi.avatar == "mondi" && probi.job == "Recherche" && probi.instructions == nil
                  && abs(look.hue - 100) < 2 && abs(look.saturation - 70) < 2, "Farbe \(probi.color ?? "-"), Farbton \(Int(look.hue)), Stärke \(Int(look.saturation))")
            check("Anpassung gespeichert", look.eyes == .square && look.accessory == .sunglasses && look.cheeks && abs(look.gaze - 0.6) < 0.001 && abs(look.reaction - 0.2) < 0.001, "\(probi.look.map { "\($0)" } ?? "nil")")
            check("Sandbox ist ein Platzhalter (keine echte)", database.scalar("select sandbox_id from bots where id = '\(probi.id)'")?.hasPrefix("fake-") == true, "")

            // 2. Persistenz: frischer Store gegen den Dienst
            let fresh = BotStore(client: model.client)
            await fresh.load()
            check("Persistenz: neuer Abruf liefert dieselben Daten", fresh.bot(id: probi.id) == probi, "")

            // 3. Doppelgänger-Hinweis und freie Farbe
            let stand = Bot(chatId: "x", id: "x", name: "Standard-Mondi", avatar: "mondi", color: nil, job: "Begleiter", instructions: nil, isMain: false, look: nil, lastMessageAt: .now)
            let suggest = BotEditorModel(editing: nil, others: [stand])
            suggest.shape = .freddy
            check("Neuer Orbi: bei Doppelgänger kommt ein freier Farbton vorgeschlagen", suggest.customColor && suggest.twin == nil && suggest.suggestionNote != nil, suggest.suggestionNote ?? "kein Vorschlag")
            let twinEditor = BotEditorModel(editing: nil, others: model.botStore.orbis)
            twinEditor.shape = .freddy
            twinEditor.useOriginalColor(); twinEditor.useColor(hex: probi.color ?? "")
            let hadTwin = twinEditor.twin?.id == probi.id
            twinEditor.suggestFreeColor()
            check("Zu ähnliche Farbe: Hinweis, „Freie Farbe“ löst ihn", hadTwin && twinEditor.twin == nil, "")

            // 4. Bearbeiten
            let edit = BotEditorModel(editing: probi, others: model.botStore.orbis, tab: .look)
            edit.name = "Probi 2"; edit.useColor(hex: "#ec4899"); edit.accessory = .cap; edit.eyes = nil; edit.cheeks = false
            await model.save(edit)
            let changed = model.botStore.bot(id: probi.id)
            check("Bearbeiten speichert Name, Farbe, Zubehör", changed?.name == "Probi 2" && changed?.color == "#ec4899" && changed?.look?.accessory == "cap" && changed?.look?.eyes == nil, "")
            let reset = BotEditorModel(editing: changed, others: model.botStore.orbis)
            reset.resetLook(); reset.useOriginalColor()
            await model.save(reset)
            let plain = model.botStore.bot(id: probi.id)
            check("Zurücksetzen: Farbe und Anpassung wieder Standard", plain?.color == nil && plain?.look == nil, "")
            let invalid = BotEditorModel(editing: plain, others: model.botStore.orbis)
            invalid.name = "   "
            await model.save(invalid)
            check("Ungültige Eingabe: deutscher Fehler, nichts gespeichert", invalid.error == "Gib deinem Orbi einen Namen." && model.botStore.bot(id: probi.id)?.name == "Probi 2", invalid.error ?? "")

            // 5. Gruppe: anlegen, ändern, 1 Mitglied
            let group = GroupEditorModel(editing: nil)
            group.name = "Testgruppe"
            check("Gruppe ohne Mitglied ist ungültig", group.validationMessage == "Wähle mindestens einen Orbi.", group.validationMessage ?? "")
            group.toggle(mainId); group.toggle(probi.id)
            await model.save(group)
            let created = model.botStore.groups.first { $0.name == "Testgruppe" }
            check("Gruppe anlegen: zwei Teilnehmer, Auswahl springt hin", created?.members.count == 2 && model.selection == created.map { .group($0.id) }, "\(created?.members.compactMap(\.name) ?? [])")
            guard let created else { throw SpikeError("Gruppe wurde nicht angelegt: \(group.error ?? "kein Fehlertext")") }
            let tooMany = GroupEditorModel(editing: nil)
            for bot in model.botStore.orbis + model.botStore.orbis { tooMany.toggle(bot.id) }
            check("Höchstens 6 Teilnehmer", tooMany.memberIds.count <= 6, "\(tooMany.memberIds.count)")
            let shrink = GroupEditorModel(editing: created)
            shrink.toggle(mainId)
            await model.save(shrink)
            let single = model.botStore.groups.first { $0.id == created.id }
            check("Gruppe mit einem Mitglied funktioniert", single?.members.map(\.id) == [probi.id], "\(single?.members.count ?? -1) Mitglied")

            // 6. Gruppenverlauf: Antworten nach Orbi, @Name, Präfix
            try database.addUserMessage(chatId: created.id, text: "@Probi 2 hallo")
            try database.addAssistantMessage(chatId: created.id, botId: probi.id, text: "[Probi 2]: Hallo zurück")
            let session = model.chatStore.session(for: created.id)
            await session.load()
            await session.waitUntilIdle()
            let last = session.messages.last
            check("Antwort gehört zum Orbi (metadata.botId)", model.botStore.bot(id: last?.metadata?.botId)?.id == probi.id, last?.metadata?.botId ?? "nil")
            let members = [GroupText.Member(id: probi.id, name: "Probi 2"), GroupText.Member(id: mainId, name: model.botStore.main?.name ?? "")]
            check("@Name wählt den Orbi", GroupText.mentionTarget(in: "@Probi 2 hallo", members: members) == probi.id && GroupText.mentionTarget(in: "ohne", members: members) == nil
                  && GroupText.mentionTarget(in: "a@Probi 2", members: members) == nil, "")
            check("„[Name]:“-Präfix wird nicht angezeigt", GroupText.stripSenderTag("[Probi 2]: Hallo zurück", names: ["Probi 2"]) == "Hallo zurück"
                  && GroupText.stripSenderTag("Hallo [Probi 2]: x", names: ["Probi 2"]) == "Hallo [Probi 2]: x", "")

            // 7. Eingabe sperren, solange ein Turn läuft
            check("Eingabe frei im ruhigen Gruppenchat", !model.isLocked(chatId: created.id), "")
            model.events.apply(Data("{\"type\":\"status\",\"chatId\":\"\(created.id)\",\"botId\":\"\(probi.id)\",\"status\":\"arbeitet\"}".utf8))
            check("Eingabe gesperrt, solange im Gruppenchat ein Turn läuft", model.isLocked(chatId: created.id), "")
            model.events.apply(Data("{\"type\":\"status\",\"chatId\":\"\(created.id)\",\"botId\":\"\(probi.id)\",\"status\":\"ruhig\"}".utf8))
            check("Eingabe wieder frei nach dem Turn", !model.isLocked(chatId: created.id), "")

            // 8. Löschen nur mit Bestätigung: anfragen, abbrechen, bestätigen
            model.botStore.requestDelete(.bot(probi))
            check("Löschen anfragen löscht noch nichts", model.botStore.pendingDelete == .bot(probi) && model.botStore.bot(id: probi.id) != nil, model.botStore.pendingDelete?.title ?? "")
            model.botStore.cancelDelete()
            await model.botStore.load(silent: true)
            check("Abbrechen lässt den Orbi bestehen", model.botStore.pendingDelete == nil && model.botStore.bot(id: probi.id) != nil, "")
            let chatOfProbi = probi.chatId
            model.botStore.requestDelete(.bot(probi))
            await model.confirmDelete(model.botStore.pendingDelete)
            check("Bestätigen löscht den Orbi, Dienst und Liste stimmen überein", model.botStore.bot(id: probi.id) == nil && model.deleteError == nil
                  && database.scalar("select count(*) from bots where id = '\(probi.id)'") == "0", model.deleteError ?? "")
            check("Direktchat des Orbis ist mit gelöscht", database.scalar("select count(*) from chats where id = '\(chatOfProbi)'") == "0", "")
            await session.load()
            await session.waitUntilIdle()
            let orphan = session.messages.last
            check("Alte Antwort bleibt, Orbi unbekannt → „Gelöschter Orbi“", orphan?.role == .assistant && model.botStore.bot(id: orphan?.metadata?.botId) == nil, orphan?.metadata?.botId ?? "nil")
            let emptied = model.botStore.groups.first { $0.id == created.id }
            check("Gruppe ohne Mitglieder bleibt bestehen (Platzhalter-Avatar)", emptied != nil && emptied?.members.isEmpty == true, "")
            model.botStore.requestDelete(.group(created))
            await model.confirmDelete(model.botStore.pendingDelete)
            check("Gruppe löschen (bestätigt)", !model.botStore.groups.contains { $0.id == created.id } && model.selection != .group(created.id), model.deleteError ?? "")

            // 9. Dienst offline: Fehler als Text, nie still
            model.service.shutdown()
            await model.botStore.load(silent: true)
            let offlineEditor = BotEditorModel(editing: nil, others: [])
            await model.save(offlineEditor)
            let offline: Bool = { if case .failed(let message) = model.botStore.state { return message == ServiceError.offline.localizedDescription } else { return false } }()
            check("Dienst offline: Liste meldet es, Speichern zeigt den Fehler im Dialog", offline && offlineEditor.error == ServiceError.offline.localizedDescription, offlineEditor.error ?? "kein Fehlertext")
        } catch {
            check("Ablauf", false, error.localizedDescription)
        }
        let ok = checks.allSatisfy(\.ok)
        let report: [String: Any] = ["ok": ok, "checks": checks.map { ["name": $0.name, "ok": $0.ok, "detail": $0.detail] as [String: Any] }]
        if let data = try? JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys]) { print(String(decoding: data, as: UTF8.self)) }
        return ok ? 0 : 1
    }
}
