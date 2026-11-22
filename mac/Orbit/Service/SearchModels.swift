import Foundation

// GET /v1/search (plan/API.md). `messageId` führt zur Nachricht im Chat; ältere Dienste liefern ihn nicht.
struct SearchHit: Decodable, Identifiable, Equatable, Sendable {
    let chatId: String
    let chatName: String?
    let avatar: String?
    let color: String?
    let role: String
    let messageId: String?
    let snippet: String
    let createdAt: Date
    let rank: Double

    var id: String { "\(chatId):\(messageId ?? snippet):\(createdAt.timeIntervalSince1970)" }
}

struct SearchResponse: Decodable, Sendable {
    let results: [SearchHit]
    let indexing: Bool
}

struct SnippetPart: Equatable, Sendable {
    let text: String
    let marked: Bool
}

enum SearchSnippet {
    // Treffer stehen im Dienst als `<<Wort>>` (wie `snippetParts` im Web); ohne Markierung ein einziger Teil.
    static func parts(_ snippet: String) -> [SnippetPart] {
        var parts: [SnippetPart] = []
        var rest = Substring(snippet)
        while let open = rest.range(of: "<<"), let close = rest[open.upperBound...].range(of: ">>") {
            if open.lowerBound > rest.startIndex { parts.append(SnippetPart(text: String(rest[rest.startIndex..<open.lowerBound]), marked: false)) }
            parts.append(SnippetPart(text: String(rest[open.upperBound..<close.lowerBound]), marked: true))
            rest = rest[close.upperBound...]
        }
        if !rest.isEmpty || parts.isEmpty { parts.append(SnippetPart(text: String(rest), marked: false)) }
        return parts
    }

    // Ohne Markierungen, für Barrierefreiheit und Vergleiche.
    static func plain(_ snippet: String) -> String { parts(snippet).map(\.text).joined() }
}
