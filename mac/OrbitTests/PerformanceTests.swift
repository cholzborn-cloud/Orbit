import XCTest

final class PerformanceTests: XCTestCase {
    // Gebündelter Strom: Abholen liefert je Nachricht den neuesten Stand; eine im selben Bild beendete Nachricht geht nicht verloren.
    func testChunkFeedKeepsEveryMessageOfAFrame() {
        let feed = ChunkFeed()
        for line in [#"{"type":"start","messageId":"a"}"#, #"{"type":"text-start","id":"t"}"#,
                     #"{"type":"text-delta","id":"t","delta":"Hal"}"#, #"{"type":"text-delta","id":"t","delta":"lo"}"#,
                     #"{"type":"start","messageId":"b"}"#, "kein json"] {
            feed.ingest(line)
        }
        let first = feed.take()
        XCTAssertEqual(first.count, 5)
        XCTAssertEqual(first.messages.map(\.id), ["a", "b"])
        XCTAssertEqual(first.messages.first?.text, "Hallo")
        XCTAssertTrue(feed.take().messages.isEmpty)
        feed.ingest(#"{"type":"error","errorText":"kaputt"}"#)
        XCTAssertEqual(feed.result.errorText, "kaputt")
    }

    // Ein Durchlauf liefert dieselben Abstände wie früher die zwei getrennten Berechnungen.
    func testRowRunsMarksSenderChangesAndJoins() {
        func message(_ id: String, _ role: ChatRole, _ text: String) -> ChatMessage { ChatMessage(id: id, role: role, parts: text.isEmpty ? [] : [.text(text)]) }
        let messages = [message("u1", .user, "a"), message("u2", .user, "b"), message("a1", .assistant, "c"), message("a2", .assistant, ""),
                        message("a3", .assistant, "d"), message("b1", .assistant, "e")]
        let runs = RowRuns(messages) { $0.id == "b1" ? "B" : "A" }
        XCTAssertEqual(runs.senderChanges, ["a1", "b1"])
        // a2 ist still (keine Blase): weder Anschluss noch Fortsetzung über sie hinweg.
        XCTAssertEqual(runs.joins, ["u2"])
        XCTAssertEqual(runs.continued, ["u1"])
    }

    // Seitenweiser Verlauf: `hasMore` fehlt bei älteren Diensten und bei Abfragen ohne `limit` (dann false).
    func testMessagesResponseReadsHasMore() throws {
        let paged = try JSONDecoder().decode(MessagesResponse.self, from: Data(#"{"messages":[],"hasMore":true}"#.utf8))
        let plain = try JSONDecoder().decode(MessagesResponse.self, from: Data(#"{"messages":[]}"#.utf8))
        XCTAssertTrue(paged.hasMore)
        XCTAssertFalse(plain.hasMore)
    }

    // Abgleich: geladene ältere Nachrichten bleiben, die neueste Seite ersetzt den Rest; ohne Überlappung gilt nur die Seite.
    func testMergingLatestKeepsOlderPrefix() {
        func m(_ id: String) -> ChatMessage { ChatMessage(id: id, role: .user, parts: [.text(id)]) }
        let current = ["a", "b", "c", "d"].map(m)
        XCTAssertEqual(current.mergingLatest(["c", "d", "e"].map(m)).map(\.id), ["a", "b", "c", "d", "e"])
        XCTAssertEqual(current.mergingLatest(["x", "y"].map(m)).map(\.id), ["x", "y"])
        XCTAssertEqual(current.mergingLatest([]).map(\.id), [])
        // Die lokale Markierung „abgebrochen“ überlebt den Abgleich.
        var stopped = current
        stopped[3].stopped = true
        XCTAssertEqual(stopped.mergingLatest(["c", "d", "e"].map(m)).map(\.stopped), [false, false, false, true, false])
    }
}
