import XCTest

final class ChatPresentationTests: XCTestCase {
    func testTimestampAfterFifteenMinutes() {
        let first = Date(timeIntervalSince1970: 1_000)
        XCTAssertTrue(ChatTimestamp.separates(first, from: nil))
        XCTAssertFalse(ChatTimestamp.separates(first.addingTimeInterval(899), from: first))
        XCTAssertTrue(ChatTimestamp.separates(first.addingTimeInterval(900), from: first))
        XCTAssertFalse(ChatTimestamp.separates(nil, from: first))
        XCTAssertEqual(ChatTimestamp.separatorIndices([first, nil, first.addingTimeInterval(899), first.addingTimeInterval(1799)]), [0, 3])
    }

    func testMidnightSeparatesEvenWithoutFifteenMinutePause() {
        let calendar = Calendar.current
        let start = calendar.startOfDay(for: Date())
        XCTAssertTrue(ChatTimestamp.separates(start, from: start.addingTimeInterval(-60)))
    }

    func testOlderDatesShowWeekdayOrYear() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0)!
        let now = calendar.date(from: DateComponents(year: 2026, month: 11, day: 3, hour: 12))!
        let recent = calendar.date(byAdding: .day, value: -3, to: now)!
        let old = calendar.date(byAdding: .day, value: -20, to: now)!
        XCTAssertTrue(ChatTimestamp.label(recent, now: now, calendar: calendar).hasPrefix("Sa.,"))
        XCTAssertTrue(ChatTimestamp.label(old, now: now, calendar: calendar).contains("2026,"))
    }

    func testTodayAndYesterday() {
        let calendar = Calendar(identifier: .gregorian)
        let today = Date(timeIntervalSince1970: 1_800_000_000)
        XCTAssertTrue(ChatTimestamp.label(today, now: today, calendar: calendar).hasPrefix("Heute "))
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!
        XCTAssertTrue(ChatTimestamp.label(yesterday, now: today, calendar: calendar).hasPrefix("Gestern "))
    }

    func testStandaloneLinksAndUnsafeSchemes() {
        let link = ChatLink.parse("[Orbit](https://github.com/example/orbit)")
        XCTAssertEqual(link?.title, "Orbit")
        XCTAssertEqual(link?.url.host, "github.com")
        XCTAssertEqual(ChatLink.parse("https://example.org/page")?.title, "example.org")
        for text in ["[Run](javascript:alert(1))", "file:///etc/hosts", "https://", "Text https://example.org", "https://user:password@example.org"] {
            XCTAssertNil(ChatLink.parse(text))
        }
    }

    func testInlineMarkdownLinksProduceCardsWithoutChangingText() {
        let text = "Mehr steht bei [Orbit](https://github.com/example/orbit) und [hier](https://example.org)."
        let links = ChatLink.inlineLinks(in: text)
        XCTAssertEqual(links.map(\.title), ["Orbit", "hier"])
        XCTAssertEqual(links.map { $0.url.host }, ["github.com", "example.org"])
        XCTAssertTrue(ChatLink.inlineLinks(in: "`[Beispiel](https://example.org)`").isEmpty)
        XCTAssertTrue(ChatLink.inlineLinks(in: "[unsicher](javascript:alert)").isEmpty)
    }

    func testInlineURLsIgnoreCodeCredentialsAndPunctuation() {
        let text = "Siehe https://example.org/page, dann `https://code.example` und https://user:pass@unsafe.example. Noch einmal https://example.org/page."
        let links = ChatLink.inlineLinks(in: text)
        XCTAssertEqual(links.map { $0.url.absoluteString }, ["https://example.org/page"])
        XCTAssertEqual(links.first?.title, "example.org")
    }
}
