import Foundation

// Dünner Client für orbitd (plan/API.md): nur 127.0.0.1, Bearer-Token aus service.token.
struct ServiceClient: Sendable {
    let baseURL: URL
    let dataDirectory: URL
    private let session: URLSession
    private let tokenOverride: (@Sendable () throws -> String)?

    init(
        baseURL: URL = URL(string: ProcessInfo.processInfo.environment["ORBITD_URL"] ?? "http://127.0.0.1:4317")!,
        dataDirectory: URL = ServiceClient.defaultDataDirectory,
        session: URLSession = ServiceClient.sharedSession,
        tokenOverride: (@Sendable () throws -> String)? = nil
    ) {
        self.baseURL = baseURL
        self.dataDirectory = dataDirectory
        self.session = session
        self.tokenOverride = tokenOverride
    }

    // Eigene Sitzung statt .shared: dort sind nur 6 Verbindungen je Host erlaubt. Offene Ströme (Ereignisse, laufende Chats)
    // belegen je eine; dann wartete `stop` hinter ihnen und der Stopp-Knopf tat scheinbar nichts.
    static let sharedSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.httpMaximumConnectionsPerHost = 64
        return URLSession(configuration: configuration)
    }()

    // ORBIT_DATA_DIR verschiebt Datenbank und Token wie im Dienst.
    static var defaultDataDirectory: URL {
        if let path = ProcessInfo.processInfo.environment["ORBIT_DATA_DIR"], !path.isEmpty {
            return URL(fileURLWithPath: path)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appending(path: "Library/Application Support/Orbit")
    }

    func token() throws -> String {
        if let tokenOverride { return try tokenOverride() }
        let url = dataDirectory.appending(path: "service.token")
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { throw ServiceError.noToken }
        let token = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !token.isEmpty else { throw ServiceError.noToken }
        return token
    }

    func request(_ path: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw ServiceError.invalidResponse }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(try token())", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }

    func data(for request: URLRequest) async throws -> Data {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code != .cancelled {
            throw ServiceError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw ServiceError.invalidResponse }
        if http.statusCode == 401 { throw ServiceError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            let message = (try? Self.decoder.decode(ServiceErrorBody.self, from: data))?.error
            throw ServiceError.server(status: http.statusCode, message: message ?? "Der Dienst antwortet mit Status \(http.statusCode).")
        }
        return data
    }

    func get<T: Decodable>(_ path: String, as type: T.Type = T.self) async throws -> T {
        let data = try await data(for: try request(path))
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw ServiceError.invalidResponse
        }
    }

    func health() async throws {
        _ = try await data(for: try request("/v1/health"))
    }

    func bots() async throws -> BotsResponse { try await get("/v1/bots") }
    func messages(chatId: String) async throws -> [ChatMessage] {
        try await get("/v1/chats/\(chatId)/messages", as: MessagesResponse.self).messages
    }
    // Verlauf mit den Reaktionen (Phase 3).
    // Mit `limit` nur die neuesten Nachrichten (vor `before`) und `hasMore`; ohne den ganzen Verlauf.
    func history(chatId: String, limit: Int? = nil, before: String? = nil) async throws -> MessagesResponse {
        var query = limit.map { "?limit=\($0)" } ?? ""
        if let before, let encoded = before.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) { query += "&before=\(encoded)" }
        return try await get("/v1/chats/\(chatId)/messages\(query)")
    }
    func reactions(chatId: String) async throws -> [Reaction] {
        struct Body: Decodable { let reactions: [Reaction] }
        return try await get("/v1/chats/\(chatId)/reactions", as: Body.self).reactions
    }
    func react(chatId: String, messageId: String, emoji: String) async throws {
        struct Body: Encodable { let emoji: String }
        _ = try await data(for: try request("/v1/chats/\(chatId)/messages/\(messageId)/reaction", method: "PUT", body: try JSONEncoder().encode(Body(emoji: emoji))))
    }
    func removeReaction(chatId: String, messageId: String) async throws {
        _ = try await data(for: try request("/v1/chats/\(chatId)/messages/\(messageId)/reaction", method: "DELETE"))
    }
    // Onboarding: Turn mit leeren Nachrichten und `onboarding: true`; Überspringen über den Orbi.
    func onboardingRequest(chatId: String, botId: String, model: String) throws -> URLRequest {
        var request = try request("/v1/chats/\(chatId)/turn", method: "POST", body: try JSONEncoder().encode(OnboardingTurnBody(model: model, botId: botId)))
        request.timeoutInterval = 3600
        return request
    }
    func skipOnboarding(botId: String) async throws {
        struct Body: Encodable { let action = "skip" }
        _ = try await data(for: try request("/v1/bots/\(botId)/onboarding", method: "POST", body: try JSONEncoder().encode(Body())))
    }
    func chats() async throws -> ChatsResponse { try await get("/v1/chats") }

    // Signierte noVNC-URL des Orbi-Computers (startet Sandbox und Desktop, kann dauern). Enthält ein Token: nie ausgeben.
    func desktopURL(botId: String) async throws -> URL {
        var request = try request("/v1/daytona/\(botId)/desktop-url")
        request.timeoutInterval = 240
        let data = try await data(for: request)
        struct Body: Decodable { let ok: Bool; let url: String?; let error: String? }
        guard let body = try? Self.decoder.decode(Body.self, from: data) else { throw ServiceError.invalidResponse }
        guard body.ok, let text = body.url, let url = URL(string: text) else {
            throw ServiceError.server(status: 200, message: body.error ?? "Computer konnte nicht gestartet werden.")
        }
        return url
    }

    // Offene Freigaben (nur kind approval) für den Neustart der App.
    func approvals() async throws -> [PendingInteraction] {
        struct Body: Decodable { let approvals: [PendingInteraction] }
        return try await get("/v1/approvals", as: Body.self).approvals
    }

    enum ApprovalDecision: String, Sendable { case once, always, deny }

    // Fehler (410 nicht mehr offen, 409 abgelaufen, 500 Speichern) kommen mit deutschem Text als ServiceError.
    func decide(approvalId: String, _ decision: ApprovalDecision) async throws {
        struct Body: Encodable { let decision: String }
        _ = try await data(for: try request("/v1/approvals/\(approvalId)/decide", method: "POST", body: try JSONEncoder().encode(Body(decision: decision.rawValue))))
    }

    // Antwort auf eine Rückfrage; `nil` = alles überspringen. Danach läuft der Turn im selben Strom weiter.
    func answer(questionId: String, answers: [QuestionAnswer]?) async throws {
        struct Answered: Encodable { let answers: [QuestionAnswer] }
        struct Skipped: Encodable { let skipped = true }
        let body = try answers.map { try JSONEncoder().encode(Answered(answers: $0)) } ?? JSONEncoder().encode(Skipped())
        _ = try await data(for: try request("/v1/questions/\(questionId)/answer", method: "POST", body: body))
    }

    // Einen Hintergrund-Helfer stoppen (POST /v1/tasks/:id/stop).
    func stopTask(id: String) async throws {
        _ = try await data(for: try request("/v1/tasks/\(id)/stop", method: "POST"))
    }
    func stop(chatId: String) async throws {
        _ = try await data(for: try request("/v1/chats/\(chatId)/stop", method: "POST"))
    }

    // Turn-Körper nach plan/API.md; `trigger` regenerate-message wiederholt die letzte Antwort.
    struct TurnBody: Encodable {
        struct Part: Encodable {
            var type = "text"
            var text: String?
            var mediaType: String?
            var url: String?
            var filename: String?
        }
        struct Message: Encodable { let id: String; let role = "user"; let parts: [Part] }
        struct Skill: Encodable { let name: String; let source: String }
        struct ClientData: Encodable { let model: String; let effort: String?; let context: Bool; let botId: String?; let skill: Skill?; let modelPinned: Bool? }
        let messages: [Message]
        let clientData: ClientData
        let trigger: String
        let replyTo: String?
    }

    func turnRequest(chatId: String, message: ChatMessage, model: String, effort: String?, botId: String?,
                     context: Bool = true, skill: SkillRef? = nil, modelPinned: Bool? = nil, regenerate: Bool) throws -> URLRequest {
        var parts: [TurnBody.Part] = []
        if !message.text.isEmpty { parts.append(.init(text: message.text)) }
        for case .file(let file) in message.parts { parts.append(.init(type: "file", mediaType: file.mediaType, url: file.url, filename: file.filename)) }
        if parts.isEmpty { parts.append(.init(text: "")) }
        let body = TurnBody(
            messages: [.init(id: message.id, parts: parts)],
            clientData: .init(model: model, effort: effort, context: context, botId: botId, skill: skill.map { .init(name: $0.name, source: $0.source) }, modelPinned: modelPinned),
            trigger: regenerate ? "regenerate-message" : "submit-message",
            replyTo: regenerate ? nil : message.metadata?.replyTo)
        var request = try request("/v1/chats/\(chatId)/turn", method: "POST", body: try JSONEncoder().encode(body))
        request.timeoutInterval = 3600
        return request
    }

    func attachRequest(chatId: String) throws -> URLRequest {
        var request = try request("/v1/chats/\(chatId)/stream")
        request.timeoutInterval = 3600
        return request
    }

    // MARK: Orbis und Gruppen verwalten (plan/API.md). Dienstfehler kommen als ServiceError mit deutschem Text.

    // Felder des Web-Dialogs plus Anpassung. `color` und `look` werden immer gesendet (null = Planetenfarbe bzw. Standard),
    // sonst ließe sich beides beim Bearbeiten nie zurücksetzen.
    struct BotForm: Encodable, Equatable, Sendable {
        var name: String
        var avatar: String
        var color: String?
        var isMain: Bool
        var job: String
        var instructions: String
        var look: BotLook?

        enum CodingKeys: String, CodingKey { case name, avatar, color, isMain, job, instructions, look }
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: CodingKeys.self)
            try c.encode(name, forKey: .name); try c.encode(avatar, forKey: .avatar); try c.encode(color, forKey: .color)
            try c.encode(isMain, forKey: .isMain); try c.encode(job, forKey: .job); try c.encode(instructions, forKey: .instructions)
            try c.encode(look, forKey: .look)
        }
    }

    struct Created: Decodable, Sendable { let id: String; let chatId: String? }

    func createBot(_ form: BotForm) async throws -> Created {
        let data = try await data(for: try request("/v1/bots", method: "POST", body: try JSONEncoder().encode(form)))
        return try decodeCreated(data)
    }

    func updateBot(id: String, _ form: BotForm) async throws {
        _ = try await data(for: try request("/v1/bots/\(id)", method: "PATCH", body: try JSONEncoder().encode(form)))
    }

    func deleteBot(id: String) async throws {
        _ = try await data(for: try request("/v1/bots/\(id)", method: "DELETE"))
    }

    // Leert Verlauf und Suchindex; 409, solange ein Turn läuft.
    func clearMessages(chatId: String) async throws {
        _ = try await data(for: try request("/v1/chats/\(chatId)/messages", method: "DELETE"))
    }

    private struct GroupForm: Encodable { let name: String; let botIds: [String] }

    func createGroup(name: String, botIds: [String]) async throws -> Created {
        let data = try await data(for: try request("/v1/chats", method: "POST", body: try JSONEncoder().encode(GroupForm(name: name, botIds: botIds))))
        return try decodeCreated(data)
    }

    func updateGroup(id: String, name: String, botIds: [String]) async throws {
        _ = try await data(for: try request("/v1/chats/\(id)", method: "PATCH", body: try JSONEncoder().encode(GroupForm(name: name, botIds: botIds))))
    }

    func deleteGroup(id: String) async throws {
        _ = try await data(for: try request("/v1/chats/\(id)", method: "DELETE"))
    }

    private func decodeCreated(_ data: Data) throws -> Created {
        do { return try Self.decoder.decode(Created.self, from: data) } catch { throw ServiceError.invalidResponse }
    }

    // Globaler Ereignisstrom (Snapshot, dann live); Keepalive alle 15 s hält die Verbindung offen.
    func eventsRequest() throws -> URLRequest {
        var request = try request("/v1/events")
        request.timeoutInterval = 120
        return request
    }

    // Liest einen SSE-Strom (Turn oder /stream) bis zum Ende und meldet jedes Ereignis. 204 = kein Turn aktiv.
    // Gibt den HTTP-Status zurück; Abbruch der Task beendet still.
    func stream(_ request: URLRequest, onEvent: @MainActor (SSEEvent) -> Void) async throws -> Int {
        try await events(request) { await onEvent($0) }
    }

    // Turn-Strom: Chunks werden im Hintergrund in `feed` dekodiert und zusammengesetzt, nicht auf dem Hauptthread.
    func stream(_ request: URLRequest, into feed: ChunkFeed) async throws -> Int {
        try await events(request) { feed.ingest($0.data) }
    }

    private func events(_ request: URLRequest, onEvent: (SSEEvent) async -> Void) async throws -> Int {
        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch let error as URLError where error.code != .cancelled {
            throw ServiceError.offline
        }
        guard let http = response as? HTTPURLResponse else { throw ServiceError.invalidResponse }
        if http.statusCode == 204 { return 204 }
        if http.statusCode == 401 { throw ServiceError.unauthorized }
        if http.statusCode == 409 { throw ServiceError.busy }
        guard (200..<300).contains(http.statusCode) else {
            var body = Data()
            for try await byte in bytes { body.append(byte) }
            let message = (try? Self.decoder.decode(ServiceErrorBody.self, from: body))?.error
            throw ServiceError.server(status: http.statusCode, message: message ?? "Der Dienst antwortet mit Status \(http.statusCode).")
        }
        var parser = SSEParser()
        var line = Data()
        do {
            for try await byte in bytes {
                line.append(byte)
                // Zeilenweise füttern: der Parser findet die Leerzeile selbst.
                guard byte == 0x0A else { continue }
                for event in parser.feed(line) {
                    if event.isDone { return http.statusCode }
                    await onEvent(event)
                }
                line.removeAll(keepingCapacity: true)
            }
        } catch let error as URLError where error.code == .networkConnectionLost || error.code == .timedOut {
            throw ServiceError.offline
        }
        return http.statusCode
    }

    static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: text) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: text) { return date }
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "Ungültiges Datum: \(text)"))
        }
        return decoder
    }()
}
