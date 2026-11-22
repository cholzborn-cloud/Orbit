import Foundation

// Texte im Gruppenchat: @Name wählt den antwortenden Orbi, "[Name]: " am Antwortanfang wird nicht angezeigt.
enum GroupText {
    struct Member: Equatable, Sendable {
        let id: String
        let name: String
    }

    // Erste @Name-Erwähnung im Text. Der Name muss ganz stehen (danach Ende, Leerraum oder Satzzeichen); längere Namen gehen vor
    // kürzeren ("@Erdi2" trifft nicht "Erdi"), Groß- und Kleinschreibung egal.
    static func mentionTarget(in text: String, members: [Member]) -> String? {
        let sorted = members.sorted { $0.name.count > $1.name.count }
        var searchStart = text.startIndex
        while let at = text[searchStart...].firstIndex(of: "@") {
            let afterAt = text.index(after: at)
            // Vor dem @ Anfang oder Leerraum, sonst ist es eine Mail-Adresse.
            let beforeOK = at == text.startIndex || text[text.index(before: at)].isWhitespace || "([{\"„".contains(text[text.index(before: at)])
            if beforeOK {
                for member in sorted where !member.name.isEmpty {
                    guard let end = text.index(afterAt, offsetBy: member.name.count, limitedBy: text.endIndex),
                          text[afterAt..<end].compare(member.name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
                    else { continue }
                    if end == text.endIndex || !(text[end].isLetter || text[end].isNumber || text[end] == "_") { return member.id }
                }
            }
            searchStart = afterAt
        }
        return nil
    }

    // Marker "[Name]: " am Textanfang, wie das Modell ihn aus dem Gruppenverlauf nachahmt (wie `senderTagRe` im Web).
    static func stripSenderTag(_ text: String, names: [String]) -> String {
        guard !names.isEmpty else { return text }
        let pattern = "^\\s*\\[(?:" + names.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "|") + ")\\]:\\s*"
        guard let range = text.range(of: pattern, options: .regularExpression) else { return text }
        return String(text[range.upperBound...])
    }
}
