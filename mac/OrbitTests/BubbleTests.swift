import XCTest

// Aktionen und Reaktionen je Blase: Schlüssel wie im Dienst (lib/chat/reactions.ts), Zitat- und Kopiertext ohne rohe Markierung.
final class BubbleTests: XCTestCase {
    private func json(_ text: String) -> JSONValue { try! JSONDecoder().decode(JSONValue.self, from: Data(text.utf8)) }

    func testFirstBubbleKeepsMessageIdLaterOnesGetPartKeys() {
        let say = ToolPart(toolCallId: "s1", name: ToolPart.sayName, state: .outputAvailable, input: json(#"{"text":"Zwischendurch"}"#), output: json(#"{"ok":true}"#))
        let bash = ToolPart(toolCallId: "b1", name: "bash", state: .outputAvailable)
        let message = ChatMessage(id: "m", role: .assistant, parts: [.text(""), .tool(bash), .text("Erste"), .tool(say), .text("Zweite")])
        XCTAssertEqual(message.bubbleKeys, [2: "m", 3: "m~s1", 4: "m~t2"])
        XCTAssertEqual(message.bubbleParts, [2: "m~t1", 3: "m~s1", 4: "m~t2"])
    }

    func testPlainDecodesStoredMentions() {
        XCTAssertEqual(Mentions.plain("Hey @[Nova](orbi:n1), **los**"), "Hey @Nova, **los**")
        XCTAssertEqual(Mentions.plain("ohne Markierung"), "ohne Markierung")
    }
}
