import Foundation
import XCTest

// Reine Logik von „Geplant“ und der Suche (4e): Zeitplan-Text und nächster Termin, Eingabeprüfung, Lauf-Ereignis, Treffer-Markierung.
final class PlannedTests: XCTestCase {
    func testRetryReservationIsPerAutomationAndCanBeReleased() {
        var retries = AutomationRetries()
        XCTAssertTrue(retries.begin("a"))
        XCTAssertFalse(retries.begin("a"))
        XCTAssertTrue(retries.begin("b"))
        retries.end("a")
        XCTAssertTrue(retries.begin("a"))
        XCTAssertEqual(retries.ids, ["a", "b"])
    }
    private let berlin = "Europe/Berlin"
    // Freitag, 02.01.2026 00:00 UTC (01:00 in Berlin).
    private let friday = Date(timeIntervalSince1970: 1_767_312_000)

    private func iso(_ date: Date?) -> String { date.map { ISO8601DateFormatter().string(from: $0) } ?? "nil" }

    func testNextRunForEveryKind() {
        XCTAssertTrue(iso(Schedule(kind: .daily, at: "08:00").nextRun(timezone: berlin, from: friday)) == "2026-01-02T07:00:00Z")
        XCTAssertTrue(iso(Schedule(kind: .weekdays, at: "08:00").nextRun(timezone: berlin, from: friday.addingTimeInterval(8 * 3600))) == "2026-01-05T07:00:00Z", "Freitag nach acht: Montag")
        XCTAssertTrue(iso(Schedule(kind: .weekly, at: "09:15", weekday: 3).nextRun(timezone: berlin, from: friday)) == "2026-01-07T08:15:00Z")
        XCTAssertTrue(iso(Schedule(kind: .monthly, at: "07:00", day: 31).nextRun(timezone: berlin, from: friday)) == "2026-01-31T06:00:00Z")
        XCTAssertTrue(iso(Schedule(kind: .monthly, at: "07:00", day: 31).nextRun(timezone: berlin, from: friday.addingTimeInterval(30 * 86400))) == "2026-02-28T06:00:00Z", "Februar hat keinen 31.: letzter Tag")
    }

    func testOnceIsOverAfterItsDateAndHandlesDaylightSaving() {
        let once = Schedule(kind: .once, at: "10:00", date: "2026-03-29")
        XCTAssertTrue(iso(once.nextRun(timezone: berlin, from: friday)) == "2026-03-29T08:00:00Z", "Sommerzeit: 10:00 ist 08:00 UTC")
        XCTAssertTrue(once.nextRun(timezone: berlin, from: Date(timeIntervalSince1970: 1_775_000_000)) == nil, "nach dem Termin kein weiterer")
        XCTAssertTrue(Schedule(kind: .daily, at: "08:00").nextRun(timezone: "Keine/Zone", from: friday) == nil)
    }

    func testSummaryTextsMatchTheWeb() {
        XCTAssertTrue(Schedule(kind: .daily, at: "08:00").summary == "Täglich um 08:00")
        XCTAssertTrue(Schedule(kind: .weekdays, at: "08:00").summary == "Werktags um 08:00")
        XCTAssertTrue(Schedule(kind: .weekly, at: "09:15", weekday: 3).summary == "Wöchentlich, Mi, um 09:15")
        XCTAssertTrue(Schedule(kind: .monthly, at: "07:00", day: 5).summary == "Monatlich am 5. um 07:00")
        XCTAssertTrue(Schedule(kind: .once, at: "10:00", date: "2026-03-29").summary == "Einmalig am 29.3.2026 um 10:00")
    }

    func testValidationMessages() {
        XCTAssertTrue(Schedule(kind: .daily, at: "25:00").validationMessage == "Uhrzeit ist ungültig.")
        XCTAssertTrue(Schedule(kind: .daily, at: "8:00").validationMessage == "Uhrzeit ist ungültig.")
        XCTAssertTrue(Schedule(kind: .once, at: "08:00", date: "2026-02-31").validationMessage == "Datum ist ungültig.")
        XCTAssertTrue(Schedule(kind: .monthly, at: "08:00", day: 0).validationMessage == "Monatstag muss zwischen 1 und 31 liegen.")
        XCTAssertTrue(Schedule(kind: .weekly, at: "08:00", weekday: 3).validationMessage == nil)
        var form = AutomationForm(botId: nil, name: "x", prompt: "Aufgabe", schedule: Schedule(kind: .daily, at: "08:00"), timezone: berlin, target: "same", notify: "app", model: nil, effort: nil, context: true)
        XCTAssertTrue(form.validationMessage == "Name muss mindestens 2 Zeichen haben.")
        form.name = "Briefing"; form.prompt = " "
        XCTAssertTrue(form.validationMessage == "Prompt fehlt.")
        form.prompt = String(repeating: "a", count: 4001)
        XCTAssertTrue(form.validationMessage == "Prompt darf höchstens 4000 Zeichen haben.")
        form.prompt = "ok"
        XCTAssertTrue(form.validationMessage == nil)
    }

    func testRunEventAndDuration() {
        let event = AutomationEvent(json: ["automationId": "a", "runId": "r", "chatId": NSNull(), "trigger": "manual", "status": "running"])
        XCTAssertTrue(event?.status.isActive == true && event?.chatId == nil && event?.trigger == "manual")
        XCTAssertTrue(AutomationEvent(json: ["automationId": "a", "runId": "r", "status": "unbekannt"]) == nil)
        let start = Date(timeIntervalSince1970: 1000)
        let run = AutomationRun(id: "r", automationId: "a", chatId: nil, status: .ok, trigger: "manual", error: nil, startedAt: start, finishedAt: start.addingTimeInterval(0.2))
        XCTAssertTrue(run.seconds == 1, "mindestens eine Sekunde")
        XCTAssertTrue(AutomationRun(id: "r", automationId: "a", chatId: nil, status: .running, trigger: nil, error: nil, startedAt: start, finishedAt: nil).seconds == nil)
    }

    func testSnippetMarks() {
        let parts = SearchSnippet.parts("… Rezept für <<Quarkkuchen>> mit <<Zitrone>> …")
        XCTAssertTrue(parts.map(\.marked) == [false, true, false, true, false])
        XCTAssertTrue(SearchSnippet.plain("a <<b>> c") == "a b c")
        XCTAssertTrue(SearchSnippet.parts("ohne Markierung") == [SnippetPart(text: "ohne Markierung", marked: false)])
        XCTAssertTrue(SearchSnippet.parts("offen <<ohne Ende").map(\.marked) == [false], "unvollständige Markierung bleibt Text")
    }

    func testAutomationTag() {
        let parsed = AutomationTag.parse("[[automation:Morgens Hallo]]\nSag Hallo.\nZeile 2")
        XCTAssertEqual(parsed?.name, "Morgens Hallo")
        XCTAssertEqual(parsed?.prompt, "Sag Hallo.\nZeile 2")
        XCTAssertNil(AutomationTag.parse("Hallo [[automation:x]]"))
        XCTAssertEqual(AutomationTag.parse("[[automation:A]]")?.prompt, "")
    }
}
