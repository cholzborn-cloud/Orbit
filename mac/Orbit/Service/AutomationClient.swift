import Foundation

// Dienst-Aufrufe für „Geplant“ und die Suche (plan/API.md). Dienstfehler kommen als ServiceError mit deutschem Text.
extension ServiceClient {
    func automations() async throws -> AutomationsResponse { try await get("/v1/automations") }
    func automationRuns(id: String) async throws -> [AutomationRun] { try await get("/v1/automations/\(id)/runs", as: AutomationRunsResponse.self).runs }

    func createAutomation(_ form: AutomationForm) async throws {
        _ = try await data(for: try request("/v1/automations", method: "POST", body: try JSONEncoder().encode(form)))
    }
    func updateAutomation(id: String, _ form: AutomationForm) async throws {
        _ = try await data(for: try request("/v1/automations/\(id)", method: "PATCH", body: try JSONEncoder().encode(form)))
    }
    func setAutomation(id: String, enabled: Bool) async throws {
        struct Body: Encodable { let enabled: Bool }
        _ = try await data(for: try request("/v1/automations/\(id)/enabled", method: "PUT", body: try JSONEncoder().encode(Body(enabled: enabled))))
    }
    func trashAutomation(id: String) async throws { _ = try await data(for: try request("/v1/automations/\(id)/trash", method: "POST")) }
    func restoreAutomation(id: String) async throws { _ = try await data(for: try request("/v1/automations/\(id)/restore", method: "POST")) }
    func deleteAutomationForever(id: String) async throws { _ = try await data(for: try request("/v1/automations/\(id)", method: "DELETE")) }

    // Jetzt ausführen: antwortet sofort mit der Lauf-Kennung, der Lauf selbst läuft im Hintergrund.
    func runAutomation(id: String) async throws -> String {
        struct Body: Decodable { let runId: String }
        let data = try await data(for: try request("/v1/automations/\(id)/run", method: "POST"))
        guard let body = try? Self.decoder.decode(Body.self, from: data) else { throw ServiceError.invalidResponse }
        return body.runId
    }

    // Fertige Läufe mit App-Hinweis seit `since` (ms), höchstens 24 h zurück.
    func unreadAutomationRuns(since: Double) async throws -> Int {
        struct Body: Decodable { let count: Int }
        return try await get("/v1/automations/unread?since=\(Int(since))", as: Body.self).count
    }

    // Volltextsuche; der Dienst begrenzt auf 30 Suchen je Minute.
    func search(_ query: String) async throws -> SearchResponse {
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        return try await get("/v1/search?\(components.percentEncodedQuery ?? "")")
    }
}
