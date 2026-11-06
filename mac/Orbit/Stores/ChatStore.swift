import Observation

// Chatliste aus GET /v1/chats und die offenen Chat-Sitzungen (je Chat eine, bleibt beim Wechseln erhalten).
@MainActor @Observable
final class ChatStore {
    private(set) var chats: [ChatSummary] = []
    private(set) var state: LoadState = .idle
    private let client: ServiceClient
    private var sessions: [String: ChatSession] = [:]
    @ObservationIgnored var onActivity: ((String) -> Void)?
    @ObservationIgnored var onResumed: ((String) -> Void)?

    init(client: ServiceClient) { self.client = client }

    func load() async {
        state = .loading
        do {
            chats = try await client.chats().chats
            state = .loaded
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func session(for chatId: String) -> ChatSession {
        if let existing = sessions[chatId] { return existing }
        let session = ChatSession(chatId: chatId, client: client)
        session.onActivity = { [weak self] in self?.onActivity?(chatId) }
        session.onResumed = { [weak self] id in self?.onResumed?(id) }
        sessions[chatId] = session
        return session
    }

    // Ohne anzulegen: Zustand für Anzeigen (Seitenleiste) darf keine Sitzungen erzeugen.
    func existingSession(for chatId: String) -> ChatSession? { sessions[chatId] }

    // Skills haben sich geändert (Einstellungen, Dialog „Neuer Skill“): das Slash-Menü jedes offenen Chats lädt neu.
    func reloadSkills() { for session in sessions.values { Task { await session.composer.reloadSkills() } } }

    // Nach dem Löschen eines Orbis oder einer Gruppe: Sitzung beenden und vergessen.
    func remove(chatId: String) {
        sessions[chatId]?.detach()
        sessions[chatId] = nil
    }

    // App schließt: Mitlesen beenden, die Turns laufen im Dienst weiter.
    func detachAll() { sessions.values.forEach { $0.detach() } }
}
