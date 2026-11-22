import Foundation
import XCTest

// Reine Logik der Einstellungen (4d): Rücksetzzeit, Wochenprognose, „wartet bis“, Skill-Prüfung, Konnektor-Fehlertext.
final class SettingsTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)
    private func ms(_ seconds: Double) -> Double { (now.timeIntervalSince1970 + seconds) * 1000 }

    func testResetUnderADayShowsHoursAndMinutes() {
        XCTAssertTrue(UsageText.reset(now.addingTimeInterval(7500), now: now) == "Reset in 2 h 5 min")
        XCTAssertTrue(UsageText.reset(now.addingTimeInterval(-5), now: now) == "Reset steht an")
        let partial = UsageWindow(name: "5h", used: 0.5, resetAt: ms(3600))
        let full = UsageWindow(name: "5h", used: 1, resetAt: ms(3600))
        XCTAssertTrue(UsageText.resetDetail(partial, now: now).hasPrefix("Setzt um "))
        XCTAssertTrue(UsageText.resetDetail(full, now: now).hasPrefix("Aufgebraucht. Setzt um "))
    }

    func testForecastIsAlwaysAnEstimateAndNeverSaysFree() {
        let half = UsageWindow(name: "7d", used: 0.5, resetAt: ms(3.5 * 86400))
        let fast = UsageWindow(name: "7d", used: 0.9, resetAt: ms(5 * 86400))
        let none = UsageWindow(name: "7d", used: 0, resetAt: ms(3 * 86400))
        let young = UsageWindow(name: "7d", used: 0.1, resetAt: ms(6.95 * 86400))
        let full = UsageWindow(name: "7d", used: 1, resetAt: ms(86400))
        for text in [half, fast, none, young, full].map({ UsageText.forecast($0, now: now) }) {
            XCTAssertTrue(text.hasPrefix("Schätzung"))
            XCTAssertTrue(!text.lowercased().contains("frei"))
        }
        XCTAssertTrue(UsageText.forecast(half, now: now).contains("reicht"))
        XCTAssertTrue(UsageText.forecast(fast, now: now).contains("erreicht"))
        XCTAssertTrue(UsageText.forecast(young, now: now).contains("zu wenig Verlauf"))
        XCTAssertTrue(UsageText.forecast(UsageWindow(name: "5h", used: 0.5, resetAt: ms(3600)), now: now).isEmpty)
    }

    func testLimitResetsUseTheLatestExhaustedWindow() throws {
        let json = """
        {"providers":[{"provider":"claude","status":"limit","accounts":[{"id":"a","label":"A","status":"limit","windows":[
        {"name":"5h","used":1,"resetAt":\(ms(3600))},{"name":"7d","used":1,"resetAt":\(ms(7200))}]}]},
        {"provider":"codex","status":"ok","accounts":[{"id":"b","label":"B","status":"ok","windows":[{"name":"5h","used":0.3,"resetAt":\(ms(100))}]}]}],"fetchedAt":\(ms(0))}
        """
        let usage = try JSONDecoder().decode(UsageResponse.self, from: Data(json.utf8))
        let resets = UsageText.limitResets(from: usage)
        XCTAssertTrue(resets["claude"] == now.addingTimeInterval(7200))
        XCTAssertTrue(resets["codex"] == nil)
        XCTAssertTrue(UsageText.waitsUntil(resets["claude"], now: now)?.hasPrefix("wartet bis ") == true)
        XCTAssertTrue(UsageText.waitsUntil(resets["codex"], now: now) == nil)
        XCTAssertTrue(UsageText.provider(forModelId: "claude-haiku-5-5") == "claude" && UsageText.provider(forModelId: "gpt-6.1") == "codex")
    }

    func testSkillRules() {
        XCTAssertFalse(SkillRules.canStart(SkillForm(name: "", description: "Beschreibung", body: "x")))
        XCTAssertFalse(SkillRules.canStart(SkillForm(name: "beispiel", description: "  \n", body: "x")))
        XCTAssertTrue(SkillRules.canStart(SkillForm(name: "beispiel", description: "Beschreibung", body: "x")))
        XCTAssertTrue(SkillRules.nameError("mein-skill") == nil)
        XCTAssertTrue(SkillRules.nameError("Mein Skill") != nil && SkillRules.nameError("a") != nil && SkillRules.nameError("zwei--bindestriche") != nil)
        XCTAssertTrue(SkillRules.error(for: SkillForm(name: "ok-name", description: "", body: "x")) != nil)
        XCTAssertEqual(SkillRules.error(for: SkillForm(name: "ok-name", description: "d", body: "  ")), "Bitte eine Anleitung eingeben.")
        XCTAssertTrue(SkillRules.error(for: SkillForm(name: "ok-name", description: "d", body: String(repeating: "x", count: 8001))) != nil)
        XCTAssertTrue(SkillRules.error(for: SkillForm(name: "ok-name", description: "d", body: "b")) == nil)
    }

    func testConnectorLoginIsDetectedFromTheErrorText() {
        XCTAssertTrue(ConnectorRules.needsLogin("Zugriff verweigert (401)"))
        XCTAssertTrue(!ConnectorRules.needsLogin("Zeitüberschreitung") && !ConnectorRules.needsLogin(nil))
    }
    func testPluginStatusDoesNotClaimToolsWorkAfterAccountLogin() throws {
        let json = #"{"id":"composio:gmail","slug":"gmail","name":"Gmail","description":"E-Mails lesen","logoUrl":null,"categories":[{"id":"communication","name":"Kommunikation"}],"authSchemes":["OAUTH2"],"managedAuthSchemes":["OAUTH2"],"authMode":"managed_oauth","connectionStatus":"connected","toolsEnabled":false,"source":"Composio"}"#
        let plugin = try JSONDecoder().decode(PluginEntry.self, from: Data(json.utf8))
        XCTAssertEqual(plugin.statusText, "Konto verbunden · Tools noch nicht verfügbar")
        let unchecked = json.replacingOccurrences(of: #""toolsEnabled":false"#, with: #""toolsEnabled":false,"toolsStatus":"not_checked""#)
        let account = try JSONDecoder().decode(PluginEntry.self, from: Data(unchecked.utf8))
        XCTAssertEqual(account.statusText, "Konto verbunden · Aktionen werden beim Chat geprüft")
        XCTAssertTrue(plugin.matches(search: " gmail ", category: "connected"))
        XCTAssertTrue(plugin.matches(search: "E-MAILS", category: "communication"))
        XCTAssertFalse(plugin.matches(search: "Kalender", category: ""))
        XCTAssertFalse(plugin.matches(search: "", category: "development"))
    }

    func testPluginSetupFieldTypesAndRequiredValues() throws {
        let json = #"{"scheme":"BASIC","supported":true,"configFields":[{"name":"enabled","label":"Aktiv","type":"boolean","required":true,"secret":false},{"name":"port","label":"Port","type":"integer","required":true,"secret":false}],"connectionFields":[],"requiredScopes":[],"reason":null}"#
        let scheme = try JSONDecoder().decode(PluginSetupScheme.self, from: Data(json.utf8))
        XCTAssertEqual(scheme.encodeFields(["enabled":"false", "port":"443"]).values, ["enabled": .bool(false), "port": .number(443)])
        XCTAssertNotNil(scheme.encodeFields(["enabled":"true", "port":"4.5"]).error)
        XCTAssertNotNil(scheme.encodeFields(["port":"443"]).error)
    }

}
