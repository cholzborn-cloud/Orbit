import Foundation

enum ChatTimestamp {
    static let pause: TimeInterval = 15 * 60

    static func separates(_ date: Date?, from previous: Date?) -> Bool {
        guard let date else { return false }
        guard let previous else { return true }
        return !Calendar.current.isDate(date, inSameDayAs: previous) || date.timeIntervalSince(previous) >= pause
    }

    static func separatorIndices(_ dates: [Date?]) -> Set<Int> {
        var result = Set<Int>()
        var previous: Date?
        for (index, date) in dates.enumerated() {
            if separates(date, from: previous) { result.insert(index) }
            if let date { previous = date }
        }
        return result
    }

    static func label(_ date: Date, now: Date = .now, calendar: Calendar = .current) -> String {
        let time = date.formatted(.dateTime.hour().minute().locale(Locale(identifier: "de_DE")))
        if calendar.isDate(date, inSameDayAs: now) { return "Heute \(time)" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(date, inSameDayAs: yesterday) {
            return "Gestern \(time)"
        }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "de_DE")
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        formatter.dateFormat = (2...6).contains(days) ? "EEE, d. MMM HH:mm" : "d. MMM yyyy, HH:mm"
        return formatter.string(from: date)
    }
}

// Abstände und Blasenfolgen des Verlaufs in einem Durchlauf: `senderChanges` = über der Nachricht wechselt der Absender (10 statt 2),
// `joins` = Blase setzt an die vorige an, `continued` = nach ihr kommt eine Blase desselben Absenders (kein Avatar).
struct RowRuns: Equatable {
    var senderChanges: Set<String> = []
    var joins: Set<String> = []
    var continued: Set<String> = []

    // `orbiId`: antwortender Orbi der Nachricht (nur für Antworten gefragt).
    init(_ messages: [ChatMessage], orbiId: (ChatMessage) -> String?) {
        func bubble(_ m: ChatMessage) -> Bool { !m.isLine && m.notice == nil && (m.role == .user || !m.isSilent) }
        var previous: (message: ChatMessage, sender: String, bubble: Bool)?
        for message in messages {
            let sender = message.role == .user ? "user" : "orbi-" + (orbiId(message) ?? "")
            let isBubble = bubble(message)
            if let previous {
                if previous.sender != sender { senderChanges.insert(message.id) }
                else if isBubble, previous.bubble { joins.insert(message.id); continued.insert(previous.message.id) }
            }
            previous = (message, sender, isBubble)
        }
    }
}

struct ChatLink: Equatable {
    let title: String
    let url: URL

    static func inlineLinks(in text: String) -> [ChatLink] {
        guard text.range(of: "http", options: .caseInsensitive) != nil else { return [] }
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        guard let content = try? AttributedString(markdown: text, options: options) else { return [] }
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        var links: [ChatLink] = []
        for run in content.runs {
            let segment = String(content[run.range].characters)
            if let url = run.link {
                guard let parsed = parse(url.absoluteString), !links.contains(where: { $0.url == parsed.url }) else { continue }
                links.append(ChatLink(title: segment.isEmpty || segment == url.absoluteString ? parsed.title : segment, url: parsed.url))
            } else if run.inlinePresentationIntent?.contains(.code) != true {
                for match in detector?.matches(in: segment, range: NSRange(segment.startIndex..., in: segment)) ?? [] {
                    guard let range = Range(match.range, in: segment) else { continue }
                    let raw = String(segment[range])
                    guard raw.lowercased().hasPrefix("https://") || raw.lowercased().hasPrefix("http://"),
                          let parsed = parse(raw), !links.contains(where: { $0.url == parsed.url }) else { continue }
                    links.append(parsed)
                }
            }
        }
        return links
    }

    // Eine vollständige Linkzeile kann direkt als Karte dargestellt werden.
    static func parse(_ line: String) -> ChatLink? {
        let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
        let title: String
        let destination: String
        if text.hasPrefix("["), text.hasSuffix(")"), let boundary = text.range(of: "](") {
            title = String(text[text.index(after: text.startIndex)..<boundary.lowerBound])
            destination = String(text[boundary.upperBound..<text.index(before: text.endIndex)])
        } else {
            title = ""
            destination = text
        }
        guard let url = URL(string: destination), ["https", "http"].contains(url.scheme?.lowercased() ?? ""),
              let host = url.host, !host.isEmpty, !destination.contains(where: \.isWhitespace),
              url.user == nil, url.password == nil else { return nil }
        return ChatLink(title: title.isEmpty ? host : title, url: url)
    }

    var symbol: String { url.host?.lowercased() == "github.com" ? "chevron.left.forwardslash.chevron.right" : "globe" }
}
