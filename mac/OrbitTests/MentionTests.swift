import XCTest

// @-Markierungen: Auflösen in Nachrichten, Eingabefeld (Auswahl, Filter, Kodieren fürs Senden).
final class MentionTests: XCTestCase {
    private let nova = MentionTarget(id: "n1", name: "Nova", avatar: "nova", color: nil)
    private let strobi = MentionTarget(id: "s1", name: "Strobi", avatar: "strobi", color: nil)
    private let nova2 = MentionTarget(id: "n2", name: "Nova2", avatar: "nova", color: nil)
    private var all: [MentionTarget] { [strobi, nova, nova2] }

    func testLinkFormIsResolved() {
        let parts = Mentions.segments(in: "Hallo @[Nova](orbi:n1), schau mal.", targets: all)
        XCTAssertEqual(parts, [.text("Hallo "), .mention(id: "n1", name: "Nova", known: true), .text(", schau mal.")])
    }

    func testLinkFormUsesCurrentName() {
        let renamed = MentionTarget(id: "n1", name: "Nova Neu", avatar: "nova", color: nil)
        XCTAssertEqual(Mentions.segments(in: "@[Nova](orbi:n1)", targets: [renamed]), [.mention(id: "n1", name: "Nova Neu", known: true)])
    }

    func testDeletedOrbiIsGrayWithoutLink() {
        XCTAssertEqual(Mentions.segments(in: "@[Weg](orbi:x9) und du", targets: all),
                       [.mention(id: "x9", name: "Weg", known: false), .text(" und du")])
    }

    func testPlainNameIsResolvedLongestFirstAndCaseInsensitive() {
        XCTAssertEqual(Mentions.segments(in: "@nova2 bitte", targets: all), [.mention(id: "n2", name: "Nova2", known: true), .text(" bitte")])
        XCTAssertEqual(Mentions.segments(in: "@NOVA.", targets: all), [.mention(id: "n1", name: "Nova", known: true), .text(".")])
    }

    func testPlainNameWithoutWordBoundaryOrUnknownStaysText() {
        XCTAssertEqual(Mentions.segments(in: "@Novas Haus", targets: [nova]), [.text("@Novas Haus")])
        XCTAssertEqual(Mentions.segments(in: "@Unbekannt hallo", targets: all), [.text("@Unbekannt hallo")])
    }

    func testEmailAndCodeAreNotMentions() {
        XCTAssertEqual(Mentions.segments(in: "mail an max@Nova.de", targets: [nova]), [.text("mail an max@Nova.de")])
        XCTAssertEqual(Mentions.segments(in: "`@Nova` ist Code", targets: [nova]), [.text("`@Nova` ist Code")])
    }

    func testAmbiguousPlainNameIsLeftAlone() {
        let twin = MentionTarget(id: "n9", name: "nova", avatar: "nova", color: nil)
        XCTAssertEqual(Mentions.segments(in: "@Nova", targets: [nova, twin]), [.text("@Nova")])
    }

    func testOnlyMentionNeverTriggersAnythingElse() {
        // Eine Markierung allein ist nur Text mit Verweis; die Anzeige kennt keine Übergabe.
        XCTAssertEqual(Mentions.segments(in: "@Nova", targets: all), [.mention(id: "n1", name: "Nova", known: true)])
    }

    func testActiveQuery() {
        XCTAssertEqual(Mentions.activeQuery(in: "@"), "")
        XCTAssertEqual(Mentions.activeQuery(in: "Frag @No"), "No")
        XCTAssertNil(Mentions.activeQuery(in: "Frag @Nova schon"))
        XCTAssertNil(Mentions.activeQuery(in: "mail max@no"))
        XCTAssertNil(Mentions.activeQuery(in: "ohne"))
    }

    func testFilterPrefixFirst() {
        let list = [strobi, nova, MentionTarget(id: "x", name: "Kino", avatar: "nova", color: nil)]
        XCTAssertEqual(Mentions.filter(list, query: "No").map(\.name), ["Nova", "Kino"])
        XCTAssertEqual(Mentions.filter([strobi, MentionTarget(id: "x", name: "Kino", avatar: "nova", color: nil), nova], query: "no").map(\.name), ["Nova", "Kino"])
        XCTAssertEqual(Mentions.filter(list, query: "").count, 3)
        XCTAssertTrue(Mentions.filter(list, query: "zzz").isEmpty)
    }

    func testCompleteReplacesOpenQuery() {
        XCTAssertEqual(Mentions.complete("Hi @No", with: nova), "Hi @Nova ")
        XCTAssertEqual(Mentions.complete("@", with: strobi), "@Strobi ")
    }

    func testEncodeOnlyPickedNames() {
        XCTAssertEqual(Mentions.encode("Hi @Nova und @Strobi", picked: [nova]), "Hi @[Nova](orbi:n1) und @Strobi")
        XCTAssertEqual(Mentions.encode("Hi @Nova", picked: []), "Hi @Nova")
        XCTAssertEqual(Mentions.encode("@Nova2 und @Nova", picked: [nova, nova2]), "@[Nova2](orbi:n2) und @[Nova](orbi:n1)")
    }
}
