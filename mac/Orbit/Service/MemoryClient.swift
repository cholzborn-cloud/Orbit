import Foundation

// Dienst-Aufrufe für Gedächtnis und Träumer (plan/API.md, „Phase 4, Lauf H/I“); Modelle in Phase4Models.swift.
extension ServiceClient: MemoryService {
    private struct EnabledBody: Encodable { let enabled: Bool }

    func memory(botId: String) async throws -> MemoryList { try await get(MemoryPaths.list(botId: botId)) }

    func deleteMemory(botId: String, name: String) async throws {
        _ = try await data(for: try request(MemoryPaths.entry(botId: botId, name: name), method: "DELETE"))
    }

    func dreamer(botId: String) async throws -> DreamerState { try await get(MemoryPaths.dreamer(botId: botId)) }

    // Gibt den vom Dienst bestätigten Stand zurück (fehlt das Feld, gilt der gewünschte).
    func setDreamer(botId: String, enabled: Bool) async throws -> Bool {
        let data = try await data(for: try request(MemoryPaths.dreamer(botId: botId), method: "PUT", body: try JSONEncoder().encode(EnabledBody(enabled: enabled))))
        return (try? Self.decoder.decode(DreamerSwitched.self, from: data))?.enabled ?? enabled
    }
}
