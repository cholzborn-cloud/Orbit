import Foundation

// Zustand einer Figur. Steht als Text (Seitenleiste, Tooltip am Kopf, Bedienungshilfe), nie nur als Farbe.
enum OrbiState: String, CaseIterable, Sendable {
    case calm, listening, working, waiting, done, limit, error

    var caption: String {
        switch self {
        case .calm: "ruhig"
        case .listening: "tippt"
        case .working: "arbeitet …"
        case .waiting: "wartet auf dich"
        case .done: "fertig"
        case .limit: "Pausiert, wartet"
        case .error: "Fehler"
        }
    }

    // Tooltip am Kopf wie ORBI_STATUS_DESCRIPTIONS im Web (lib/chat/orbi-status.ts); nil = ruhig, kein Tooltip.
    var statusDescription: String? {
        switch self {
        case .calm: nil
        case .listening: "Denkt nach …"
        case .working: "Arbeitet gerade"
        case .waiting: "Wartet auf deine Freigabe"
        case .done: "Fertig"
        case .limit, .error: "Kann gerade nicht weiterarbeiten"
        }
    }

    // Vorrang bei mehreren Chats desselben Orbis: Rückfrage vor Arbeit vor Fehler vor Fertig.
    var priority: Int {
        switch self {
        case .waiting: 5
        case .working: 4
        case .error, .limit: 3
        case .done: 2
        case .listening: 1
        case .calm: 0
        }
    }

    // Status aus `GET /v1/events` (plan/API.md).
    init?(service status: String) {
        switch status {
        case "arbeitet": self = .working
        case "wartet": self = .waiting
        case "fertig": self = .done
        case "fehler": self = .error
        case "ruhig": self = .calm
        default: return nil
        }
    }
}
