import Foundation

// @-Markierungen (Phase 2, Auftrag Punkt 12): gespeichert und gesendet als `@[Name](orbi:<id>)`; der Dienst löst Klartext-`@Name`
// beim Speichern auf, die App erkennt beide Formen für die Anzeige. Reine Logik, ohne Oberfläche.
struct MentionTarget: Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let avatar: String
    let color: String?
}

enum MentionSegment: Equatable, Sendable {
    case text(String)
    // `known` = der Orbi existiert noch (sonst grauer Text ohne Link).
    case mention(id: String, name: String, known: Bool)
}

enum Mentions {
    // Zeichen vor dem „@“, die es als Markierung gelten lassen (sonst E-Mail-Adresse o. Ä.).
    private static func opensMention(_ previous: Character?) -> Bool {
        guard let previous else { return true }
        return previous.isWhitespace || "([{\"„'«".contains(previous)
    }

    private static func endsName(_ next: Character?) -> Bool {
        guard let next else { return true }
        return !(next.isLetter || next.isNumber || next == "_")
    }

    private static let linkPattern = #"^@\[([^\]\n]{1,80})\]\(orbi:([A-Za-z0-9_\-]{1,80})\)"#

    // Zerlegt den Text in Klartext und Markierungen. Code (zwischen Rückwärts-Apostrophen) bleibt unberührt. Klartext-`@Name` zählt
    // nur, wenn genau ein Orbi so heißt (Groß/Klein egal); längere Namen gehen vor kürzeren.
    static func segments(in text: String, targets: [MentionTarget]) -> [MentionSegment] {
        guard text.contains("@") else { return [.text(text)] }
        let byLength = targets.sorted { $0.name.count > $1.name.count }
        var result: [MentionSegment] = []
        var plain = ""
        func flush() { if !plain.isEmpty { result.append(.text(plain)); plain = "" } }
        var inCode = false
        var index = text.startIndex
        while index < text.endIndex {
            let char = text[index]
            if char == "`" { inCode.toggle() }
            let previous: Character? = index == text.startIndex ? nil : text[text.index(before: index)]
            if !inCode, char == "@", opensMention(previous) {
                let rest = text[index...]
                if let range = rest.range(of: linkPattern, options: .regularExpression) {
                    let match = String(rest[range])
                    let name = match.dropFirst(2).prefix { $0 != "]" }
                    let id = match.dropFirst(2 + name.count + 1 + "(orbi:".count).dropLast()
                    let current = targets.first { $0.id == id }
                    flush()
                    result.append(.mention(id: String(id), name: current?.name ?? String(name), known: current != nil))
                    index = range.upperBound
                    continue
                }
                let afterAt = text.index(after: index)
                var matched = false
                for target in byLength where !target.name.isEmpty {
                    guard let end = text.index(afterAt, offsetBy: target.name.count, limitedBy: text.endIndex),
                          text[afterAt..<end].compare(target.name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame,
                          endsName(end == text.endIndex ? nil : text[end]) else { continue }
                    // Mehrdeutig (zwei Orbis mit gleichem Namen): Klartext lassen, der Dienst löst das ebenfalls nicht auf.
                    guard targets.filter({ $0.name.compare(target.name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }).count == 1 else { continue }
                    flush()
                    result.append(.mention(id: target.id, name: target.name, known: true))
                    index = end
                    matched = true
                    break
                }
                if matched { continue }
            }
            plain.append(char)
            index = text.index(after: index)
        }
        flush()
        return result
    }

    // Beim Senden: die im Eingabefeld gewählten `@Name` werden zu `@[Name](orbi:id)`. Alles andere bleibt, wie es ist.
    static func encode(_ text: String, picked: [MentionTarget]) -> String {
        guard !picked.isEmpty else { return text }
        return segments(in: text, targets: picked).map { segment in
            switch segment {
            case .text(let value): value
            case .mention(let id, let name, _): "@[\(name)](orbi:\(id))"
            }
        }.joined()
    }

    // Für Zitat und Kopieren: `@[Name](orbi:id)` wird zu `@Name`, alles andere bleibt (auch Markdown).
    static func plain(_ text: String) -> String {
        guard text.contains("](orbi:") else { return text }
        return segments(in: text, targets: []).map { segment in
            switch segment {
            case .text(let value): value
            case .mention(_, let name, _): "@\(name)"
            }
        }.joined()
    }

    // MARK: Eingabefeld

    // Offene Markierung am Ende des Entwurfs („@No“ → „No“, „@“ → „“); nil = keine. Das Feld gibt die Cursorposition nicht her,
    // deshalb gilt das Ende des Textes.
    static func activeQuery(in draft: String) -> String? {
        guard let range = draft.range(of: #"(?:^|\s)@([^\s@\[\]()]{0,40})$"#, options: .regularExpression) else { return nil }
        let match = draft[range]
        guard let at = match.firstIndex(of: "@") else { return nil }
        return String(match[match.index(after: at)...])
    }

    // Filter beim Tippen: Namensanfang zuerst, dann Treffer in der Mitte; Reihenfolge der Liste bleibt sonst.
    static func filter(_ targets: [MentionTarget], query: String) -> [MentionTarget] {
        guard !query.isEmpty else { return targets }
        let options: String.CompareOptions = [.caseInsensitive, .diacriticInsensitive]
        let prefix = targets.filter { $0.name.range(of: query, options: options.union(.anchored)) != nil }
        let inside = targets.filter { target in !prefix.contains(target) && target.name.range(of: query, options: options) != nil }
        return prefix + inside
    }

    // Ersetzt die offene Markierung am Ende durch „@Name “.
    static func complete(_ draft: String, with target: MentionTarget) -> String {
        guard let range = draft.range(of: #"@[^\s@\[\]()]{0,40}$"#, options: .regularExpression) else { return draft }
        return draft.replacingCharacters(in: range, with: "@\(target.name) ")
    }
}
