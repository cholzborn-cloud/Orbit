import Foundation

// Hintergrund-Helfer je Chat (Dienst: Executor, Tabelle `tasks`). Snapshot `tasks` liefert TaskRecords
// (`id`, `parentChatId`, `orbiId`), live kommt das flache Ereignis `task` (`taskId`, `chatId`, `botId`, `action`).
struct TaskBoard: Equatable, Sendable {
    struct Helper: Equatable, Sendable, Identifiable {
        let id: String
        var chatId: String
        var botId: String
        var title: String
        var progress: String?
    }

    // Reihenfolge des Starts; Ende (done, stopped, failed) entfernt nach `taskId`, denn `stopped` kommt teils ohne Chat.
    private(set) var helpers: [Helper] = []

    mutating func apply(line: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: line) as? [String: Any], let type = json["type"] as? String else { return }
        switch type {
        case "snapshot":
            helpers = (json["tasks"] as? [[String: Any]] ?? []).compactMap { item in
                guard let id = item["id"] as? String, let chatId = item["parentChatId"] as? String else { return nil }
                return Helper(id: id, chatId: chatId, botId: item["orbiId"] as? String ?? "", title: Self.title(item), progress: item["progress"] as? String)
            }
        case "task":
            guard let id = json["taskId"] as? String, let action = json["action"] as? String else { return }
            switch action {
            case "start", "progress":
                if let index = helpers.firstIndex(where: { $0.id == id }) {
                    if let progress = json["progress"] as? String, !progress.isEmpty { helpers[index].progress = progress }
                } else if let chatId = json["chatId"] as? String, !chatId.isEmpty {
                    helpers.append(Helper(id: id, chatId: chatId, botId: json["botId"] as? String ?? "", title: Self.title(json), progress: json["progress"] as? String))
                }
            default:
                helpers.removeAll { $0.id == id }
            }
        default: break
        }
    }

    // Entfernt einen Helfer sofort nach dem Stopp-Knopf (das Ereignis folgt).
    mutating func remove(id: String) { helpers.removeAll { $0.id == id } }

    func helpers(forChat chatId: String) -> [Helper] { helpers.filter { $0.chatId == chatId } }

    // Titel, sonst der Anfang des Auftrags.
    private static func title(_ item: [String: Any]) -> String {
        if let title = item["title"] as? String, !title.isEmpty { return title }
        let brief = (item["brief"] as? String ?? "").split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        return brief.isEmpty ? "Helfer" : String(brief.prefix(80))
    }
}
