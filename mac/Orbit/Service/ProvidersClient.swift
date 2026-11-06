import Foundation

// Dienst-Aufrufe der Anbieter im Marktplatz.
extension ServiceClient {
    private func providerPath(_ id: String, _ tail: String = "") throws -> String {
        guard let id = id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw ServiceError.invalidResponse }
        return "/v1/marketplace/providers/\(id)\(tail)"
    }

    func providers() async throws -> ProvidersResponse { try await get("/v1/marketplace/providers") }

    // Der Wert geht nur an den Dienst und wird hier nirgends gehalten.
    func setProviderConfig(id: String, key: String, value: String) async throws {
        struct Body: Encodable { let key: String; let value: String }
        let body = try JSONEncoder().encode(Body(key: key, value: value))
        _ = try await data(for: try request(try providerPath(id, "/config"), method: "PUT", body: body))
    }

    func connectProvider(id: String) async throws -> ProviderConnectResponse {
        let data = try await data(for: try request(try providerPath(id, "/connect"), method: "POST"))
        do { return try Self.decoder.decode(ProviderConnectResponse.self, from: data) } catch { throw ServiceError.invalidResponse }
    }

    func readProvider(id: String) async throws -> ProviderReadResponse {
        let data = try await data(for: try request(try providerPath(id, "/read"), method: "POST"))
        do { return try Self.decoder.decode(ProviderReadResponse.self, from: data) } catch { throw ServiceError.invalidResponse }
    }

    func deleteProvider(id: String) async throws {
        _ = try await data(for: try request(try providerPath(id), method: "DELETE"))
    }
}
