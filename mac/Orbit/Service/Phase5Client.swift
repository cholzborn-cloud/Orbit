import Foundation

// Dienst-Aufrufe der Phase 5 (plan/API.md, „Phase 5“); Modelle in Phase5Models.swift.
extension ServiceClient {
    private struct ResumeBody: Encodable { let runId: String; let dismiss: Bool }
    private struct NamesBody: Encodable { let names: [String] }
    private struct EnabledBody: Encodable { let enabled: Bool }

    func healthChecks() async throws -> [HealthCheck] { try await get(Phase5Paths.health, as: HealthResponse.self).checks }
    func chatStatus() async throws -> ChatStatusResponse { try await get(Phase5Paths.status) }
    func keys() async throws -> KeysResponse { try await get(Phase5Paths.keys) }

    func reloadKeys(names: [String]) async throws -> KeysResponse {
        let data = try await data(for: try request(Phase5Paths.keysReload, method: "POST", body: try JSONEncoder().encode(NamesBody(names: names))))
        return try Self.decoder.decode(KeysResponse.self, from: data)
    }

    func budget() async throws -> BudgetState { try await get(Phase5Paths.budget) }

    func markSeen(chatId: String) async throws { _ = try await data(for: try request(Phase5Paths.seen(chatId: chatId), method: "POST")) }

    // „Weiter“: startet den unterbrochenen Turn neu (der Dienst antwortet mit JSON, der Verlauf kommt danach über den Strom).
    func resume(chatId: String, runId: String, dismiss: Bool = false) async throws {
        _ = try await data(for: try request(Phase5Paths.resume(chatId: chatId), method: "POST", body: try JSONEncoder().encode(ResumeBody(runId: runId, dismiss: dismiss))))
    }

    func heartbeat(botId: String) async throws -> HeartbeatState { try await get(Phase5Paths.heartbeat(botId: botId)) }

    func setHeartbeat(botId: String, enabled: Bool) async throws -> HeartbeatState {
        let data = try await data(for: try request(Phase5Paths.heartbeat(botId: botId), method: "PUT", body: try JSONEncoder().encode(EnabledBody(enabled: enabled))))
        return try Self.decoder.decode(HeartbeatState.self, from: data)
    }
}

// Gedächtnis ändern und Gelöschtes wiederherstellen (Phase 5, Schritt 8).
extension ServiceClient {
    private struct EditBody: Encodable { let description: String; let body: String; let ifVersion: Int }
    private struct EntryAnswer: Decodable { let entry: MemoryEntry? }

    func editMemory(botId: String, name: String, description: String, body: String, ifVersion: Int) async throws -> MemoryEntry? {
        let payload = try JSONEncoder().encode(EditBody(description: description, body: body, ifVersion: ifVersion))
        let data = try await data(for: try request(MemoryPaths.entry(botId: botId, name: name), method: "PUT", body: payload))
        return (try? Self.decoder.decode(EntryAnswer.self, from: data))?.entry
    }

    func memoryTrash(botId: String) async throws -> MemoryList { try await get(Phase5Paths.memoryTrash(botId: botId)) }

    func restoreMemory(botId: String, name: String) async throws {
        _ = try await data(for: try request(Phase5Paths.restore(botId: botId, name: name), method: "POST"))
    }
}

extension ServiceClient: SetupService {}

extension ServiceClient {
    // Protokoll-Variante ohne Standardwerte (die Aufrufer geben beide Felder an).
    func setBudget(jevDailyUsd: Double?, maxSandboxes: Int?) async throws -> BudgetState {
        let body = try JSONEncoder().encode(BudgetBodyPublic(jevDailyUsd: jevDailyUsd, maxSandboxes: maxSandboxes))
        return try Self.decoder.decode(BudgetState.self, from: try await data(for: try request(Phase5Paths.budget, method: "PUT", body: body)))
    }
}

struct BudgetBodyPublic: Encodable { let jevDailyUsd: Double?; let maxSandboxes: Int? }
