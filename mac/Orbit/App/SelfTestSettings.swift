import AppKit
import Foundation

// `Orbit --selftest-einstellungen`: lädt jeden Reiter der Einstellungen gegen eine Datenbankkopie (ORBIT_DATA_DIR), schaltet Schalter,
// speichert, legt an und löscht (Skill, Regel, Konnektor, Marktplatz-Installation) und prüft die reinen Textfunktionen
// (Rücksetzzeit, Wochenprognose, „wartet bis“). JSON, Exit 0 oder 1. Der echte Anbieter-Login wird nicht durchgespielt.
@MainActor
enum SelfTestSettings {
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
            let client = model.client
            let store = model.settings

            // 1. Jeder Reiter lädt: geladen oder mit deutschem Fehlertext, nie hängen.
            for section in SettingsSection.allCases {
                await store.load(section)
                let state: String
                switch section {
                case .usage: state = describe(store.usage)
                case .setup: state = describe(store.setup.checks)
                case .orbis: state = describe(store.instructions)
                case .skills: state = describe(store.skills)
                case .connectors: state = describe(store.connectors)
                case .approvals: state = describe(store.rules)
                case .marketplace: state = describe(store.market)
                case .appearance: state = store.themeError == nil ? "geladen" : "Fehler"
                }
                // Ein Fehlertext statt Daten ist erlaubt, der Zustand muss aber gestaltet sein.
                let ok = section == .usage ? !store.usage.isLoading && store.usage.value != nil || store.usage.failure != nil : !state.contains("lädt") && !state.contains("Fehler")
                check("reiter-\(section.rawValue)", ok, state)
            }

            // 2. Nutzung: Struktur und „unbekannt“ statt „frei“.
            if let usage = store.usage.value {
                let names = usage.providers.map(\.provider).joined(separator: ",")
                check("nutzung-anbieter", !usage.providers.isEmpty, "Anbieter: \(names), Stand \(usage.fetchedAt)")
            }

            // 4. Darstellung: speichern und gegenlesen.
            let theme0 = store.theme
            await store.setTheme("dark")
            let storedDark = try await client.settingsFull().settings.theme
            await store.setTheme("light")
            let storedLight = try await client.settingsFull().settings.theme
            await store.setTheme(theme0)
            check("darstellung", storedDark == "dark" && storedLight == "light" && store.themeError == nil, "gespeichert dunkel=\(storedDark ?? "-"), hell=\(storedLight ?? "-")")

            // 5. Orbis-Anleitung: speichern, gegenlesen, auf Standard zurück.
            await store.loadInstructions()
            let marker = "Selbsttest-Anleitung \(UUID().uuidString.prefix(6))"
            await store.saveInstructions(marker)
            let saved = try await client.settingsFull().settings.baseInstructions
            await store.saveInstructions(nil)
            let reset = try await client.settingsFull().settings.baseInstructions
            check("anleitung", saved == marker && reset == nil && store.instructionsError == nil, "gespeichert \(saved == marker), Standard danach \(reset == nil)")

            // 6. Skills: Prüfung ohne Dienst, anlegen, ändern, löschen.
            let badName = await store.saveSkill(id: nil, SkillForm(name: "Falscher Name", description: "x", body: "y"))
            let skillName = "selbsttest-\(UUID().uuidString.prefix(6).lowercased())"
            let created = await store.saveSkill(id: nil, SkillForm(name: skillName, description: "Test", body: "## Wann nutzen\nTest"))
            let listed = store.skills.value?.first { $0.name == skillName }
            var changed = false
            if let listed {
                let update = await store.saveSkill(id: listed.id, SkillForm(name: skillName, description: "Geändert", body: "## Wann nutzen\nTest"))
                changed = update == nil && store.skills.value?.first { $0.id == listed.id }?.description == "Geändert"
                await store.deleteSkill(listed)
            }
            let gone = store.skills.value?.contains { $0.name == skillName } == false
            check("skills", badName != nil && created == nil && listed != nil && changed && gone, "Namensfehler: \(badName ?? "-"), angelegt \(created == nil), geändert \(changed), gelöscht \(gone)")

            // 7. Freigaben: Regel anlegen (wie „Immer erlauben“), im Reiter sehen, löschen.
            let tool = "selbsttest__lesen"
            _ = try await client.data(for: try client.request("/v1/settings/rules", method: "POST", body: try JSONSerialization.data(withJSONObject: ["tool": tool, "mode": "allow"])))
            await store.loadRules()
            let rule = store.rules.value?.first { $0.tool == tool }
            if let rule { await store.deleteRule(rule) }
            let ruleGone = store.rules.value?.contains { $0.tool == tool } == false
            check("freigaben", rule != nil && ruleGone && store.rulesError == nil, "Regel sichtbar \(rule != nil), gelöscht \(ruleGone)")

            // 8. Konnektoren: hinzufügen, aus-/einschalten, testen (Fehler gestaltet), löschen. Kein echter Anbieter-Login.
            let name = "Selbsttest-\(UUID().uuidString.prefix(4))"
            let addError = await store.addConnector(ConnectorForm(name: name, url: "https://example.com/mcp", token: "x"))
            await store.loadConnectors()
            let connector = store.connectors.value?.first { $0.name == name }
            var toggled = false, testState = "-", removed = false
            if let connector {
                await store.setEnabled(connector.id, !connector.enabled)
                toggled = store.connectors.value?.first { $0.id == connector.id }?.enabled == !connector.enabled
                switch await store.test(connector.id) { case .ok(let n, _): testState = "ok \(n) Tools"; case .error(let t): testState = "Fehler: \(t.prefix(60))"; case .testing: testState = "läuft" }
                let deleteError = await store.deleteConnector(connector.id)
                removed = deleteError == nil && store.connectors.value?.contains { $0.id == connector.id } == false
            }
            check("konnektoren", addError == nil && connector != nil && toggled && removed && testState != "-" && testState != "läuft",
                  "angelegt \(connector != nil), Schalter \(toggled), Test \(testState), gelöscht \(removed)")
            let badURL = await store.addConnector(ConnectorForm(name: "Unsinn", url: "http://127.0.0.1/mcp", token: nil))
            check("konnektor-ungueltig", badURL != nil, "Fehler: \(badURL ?? "-")")

            // 9. Marktplatz: Katalog laden, Skill installieren, wieder löschen.
            await store.loadMarket()
            let entry = store.market.value?.first { !$0.isConnector && !store.installed.contains($0.installKey) }
            var installed = false
            if let entry {
                await store.install(entry)
                installed = store.installed.contains(entry.installKey) && store.marketError == nil
                await store.loadSkills()
                if let skill = store.skills.value?.first(where: { $0.name == entry.skillName }) { await store.deleteSkill(skill) }
            }
            check("marktplatz", (store.market.value?.count ?? 0) > 0 && (entry == nil || installed), "\(store.market.value?.count ?? 0) Einträge, Installation \(entry == nil ? "übersprungen" : "\(installed)")")

            // 10. Textfunktionen: Rücksetzzeit, Wochenprognose (Schätzung), „wartet bis“, nie „frei“.
            let now = Date()
            let week = UsageWindow(name: "7d", used: 0.5, resetAt: now.addingTimeInterval(3.5 * 86400).timeIntervalSince1970 * 1000)
            let fast = UsageWindow(name: "7d", used: 0.9, resetAt: now.addingTimeInterval(5 * 86400).timeIntervalSince1970 * 1000)
            let none = UsageWindow(name: "7d", used: 0, resetAt: now.addingTimeInterval(3 * 86400).timeIntervalSince1970 * 1000)
            let texts = [UsageText.forecast(week, now: now), UsageText.forecast(fast, now: now), UsageText.forecast(none, now: now),
                         UsageText.reset(now.addingTimeInterval(7500), now: now), UsageText.waitsUntil(now.addingTimeInterval(3600), now: now) ?? "-"]
            let okTexts = texts[0].contains("Schätzung") && texts[0].contains("reicht") && texts[1].contains("erreicht") && texts[2].contains("keine Nutzung")
                && texts[3] == "Reset in 2 h 5 min" && texts[4].hasPrefix("wartet bis ") && UsageText.waitsUntil(nil, now: now) == nil
                && !texts.joined().lowercased().contains("frei")
            check("texte", okTexts, texts.joined(separator: " | "))
            await model.botStore.load()
            // 11. Limit-Zustand der Figur: Fehlertext → Zustand „Limit“, Anzeige „wartet bis …“ aus der Rücksetzzeit; ohne Zeit nur der Text.
            if let orbi = model.botStore.orbis.first {
                let session = model.chatStore.session(for: orbi.chatId)
                await session.load(); await session.waitUntilIdle(); await session.composer.loadCatalog()
                session.simulate(error: "429 rate limit")
                let limited = model.state(forBot: orbi) == .limit
                LimitStore.shared.simulate(resets: [:])
                let without = model.limitText(chatId: orbi.chatId)
                LimitStore.shared.simulate(resets: ["claude": now.addingTimeInterval(7200), "codex": now.addingTimeInterval(7200), "antigravity": now.addingTimeInterval(7200)])
                let with = model.limitText(chatId: orbi.chatId)
                session.clearError()
                check("limit-figur", limited && without == nil && with?.hasPrefix("wartet bis ") == true, "Zustand Limit \(limited), ohne Zeit \(without ?? "nil"), mit Zeit \(with ?? "nil")")
            } else { check("limit-figur", false, "kein Orbi in der Kopie") }
            // 12. OAuth-Rückkehr: /oauth/callback braucht keinen Token; ein unbekannter State landet bei einer klaren Seite, nie still.
            if let url = URL(string: "/oauth/callback?code=x&state=unbekannt", relativeTo: client.baseURL) {
                let (data, response) = try await URLSession.shared.data(from: url)
                let page = String(data: data, encoding: .utf8) ?? ""
                check("oauth-rueckkehr", (response as? HTTPURLResponse)?.statusCode == 200 && page.contains("gehört zu keinem Konnektor"), "Antwort: \(page.suffix(120))")
            }
            check("anmeldung", ConnectorRules.needsLogin("Zugriff verweigert (401)") && !ConnectorRules.needsLogin("Zeitüberschreitung"), "needsLogin erkennt „verweigert“")
        } catch {
            check("fehler", false, error.localizedDescription)
        }
        let report = Report(ok: checks.allSatisfy(\.ok), checks: checks)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(report), let text = String(data: data, encoding: .utf8) { print(text) }
        return report.ok ? 0 : 1
    }

    private static func describe<T>(_ load: Load<T>) -> String {
        switch load {
        case .idle: "idle"
        case .loading: "lädt"
        case .loaded: "geladen"
        case .failed(let message, let offline): "Fehler\(offline ? " (offline)" : ""): \(message)"
        }
    }
}

final class SelfTestSettingsDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in exit(await SelfTestSettings.run()) }
    }
}
