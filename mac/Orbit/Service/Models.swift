import Foundation

// Von Hand nach plan/API.md. Zeiten kommen als ISO-8601 mit Millisekunden.

struct Bot: Codable, Identifiable, Hashable, Sendable {
    let chatId: String
    let id: String
    let name: String
    let avatar: String
    let color: String?
    let job: String
    let instructions: String?
    let isMain: Bool
    let look: BotLook?
    let lastMessageAt: Date
    // Phase 3: Onboarding schon gemacht oder übersprungen (nil bei älteren Diensten = gilt als erledigt).
    var onboardingDone: Bool? = nil
}

struct GroupMember: Codable, Hashable, Sendable {
    let id: String
    // Neuere Dienste liefern Namen und Anpassung mit; ältere nicht (dann hilft die Orbi-Liste).
    let name: String?
    let avatar: String
    let color: String?
    let look: BotLook?
}

struct OrbiGroup: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let members: [GroupMember]
}

// GET /v1/bots
struct BotsResponse: Codable, Sendable {
    let main: Bot?
    let bots: [Bot]
    let groups: [OrbiGroup]
}

struct ChatSummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let lastMessageAt: Date
    let memberCount: Int
}

// GET /v1/chats
struct ChatsResponse: Codable, Sendable {
    let chats: [ChatSummary]
}

// Fehlerform des Dienstes: { "error": "…" } bzw. { "ok": false, "error": "…" }
struct ServiceErrorBody: Codable, Sendable {
    let error: String
}

enum ServiceError: LocalizedError, Sendable {
    case noToken
    case offline
    case unauthorized
    case server(status: Int, message: String)
    case invalidResponse
    case busy

    var errorDescription: String? {
        switch self {
        case .noToken: "Orbit ist nicht mit dem Orbit-Dienst verbunden. Starte Orbit neu."
        case .offline: "Der Orbit-Dienst ist nicht erreichbar."
        case .unauthorized: "Der Orbit-Dienst hat die Verbindung abgelehnt. Starte Orbit neu."
        case .server(_, let message): message
        case .invalidResponse: "Der Orbit-Dienst hat unerwartet geantwortet. Versuch es gleich noch einmal."
        case .busy: "In diesem Chat läuft bereits eine Antwort."
        }
    }
}
