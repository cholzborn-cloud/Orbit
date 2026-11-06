import Foundation

// Welche Ereignisse eine Mitteilung auslösen (Freigaben, Rückfragen, fertige Automationen). Reine Logik ohne Mitteilungszentrale.
// Inhalte nennen nie Eingaben eines Werkzeugs (sie können Schlüssel oder Pfade enthalten), nur Orbi und Werkzeugname.
struct Notice: Equatable, Sendable {
    enum Kind: Equatable, Sendable { case approval, question, automation }
    let id: String
    let kind: Kind
    let title: String
    let body: String
    let chatId: String?
    let botId: String?
}

struct NoticePlanner: Sendable {
    private(set) var seen: Set<String> = []

    // Neue offene Freigaben und Rückfragen (je ID einmal). `botName` löst die Orbi-ID auf.
    mutating func notices(for board: InteractionBoard, botName: (String) -> String?) -> [Notice] {
        var result: [Notice] = []
        for item in board.pending.values.sorted(by: { ($0.requestedAt, $0.id) < ($1.requestedAt, $1.id) }) where !seen.contains(item.id) {
            seen.insert(item.id)
            let name = item.from?.name ?? botName(item.botId) ?? "Ein Orbi"
            // Fragt ein Orbi aus dem Auftrag eines anderen Chats, öffnet die Mitteilung den Root-Chat (dort steht die Karte).
            let chatId = item.displayChatId
            switch item.kind {
            case .approval:
                result.append(Notice(id: item.id, kind: .approval, title: "\(name) braucht deine Freigabe", body: "Werkzeug: \(item.tool)", chatId: chatId, botId: item.botId))
            case .ask:
                result.append(Notice(id: item.id, kind: .question, title: "\(name) hat eine Frage", body: "Antworte in Orbit.", chatId: chatId, botId: item.botId))
            }
        }
        // Erledigte verschwinden aus dem Gedächtnis, damit es nicht ewig wächst.
        let open = Set(board.pending.keys)
        if seen.count > 400 { seen = seen.intersection(open) }
        return result
    }

    // Fertiger Lauf einer Automation: nur wenn sie „Mitteilung“ eingestellt hat (notify == app).
    static func finished(_ event: AutomationEvent, automation: Automation?) -> Notice? {
        guard let automation, automation.notify == "app", event.status == .ok || event.status == .error else { return nil }
        let ok = event.status == .ok
        return Notice(id: "run-\(event.runId)", kind: .automation, title: ok ? "„\(automation.name)“ ist fertig" : "„\(automation.name)“ ist fehlgeschlagen",
                      body: ok ? "Die Automation ist gelaufen." : (event.error ?? "Der Lauf endete mit einem Fehler."), chatId: event.chatId, botId: automation.botId)
    }
}
