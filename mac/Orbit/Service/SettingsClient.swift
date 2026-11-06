import Foundation

// Dienst-Aufrufe der Einstellungen (plan/API.md); die Modelle stehen in SettingsModels.swift.
extension ServiceClient {
    private func send(_ path: String, method: String, body: some Encodable) async throws -> Data {
        try await data(for: try request(path, method: method, body: try JSONEncoder().encode(body)))
    }

    private func call(_ path: String, method: String) async throws {
        _ = try await data(for: try request(path, method: method))
    }

    private func decode<T: Decodable>(_ data: Data) throws -> T {
        do { return try Self.decoder.decode(T.self, from: data) } catch { throw ServiceError.invalidResponse }
    }

    func usage(fresh: Bool = false) async throws -> UsageResponse { try await get(fresh ? "/v1/usage?fresh=1" : "/v1/usage") }
    func settingsFull() async throws -> SettingsFull { try await get("/v1/settings") }
    func instructionsDefault() async throws -> InstructionsDefault { try await get("/v1/settings/instructions/default") }
    func jevLog() async throws -> JevLog { try await get("/v1/jev") }
    func skills() async throws -> SkillsResponse { try await get("/v1/skills") }
    func connectors() async throws -> ConnectorsResponse { try await get("/v1/connectors") }
    func marketplace() async throws -> MarketResponse { try await get("/v1/marketplace") }
    func rules() async throws -> RulesResponse { try await get("/v1/settings/rules") }

    private struct ThemeBody: Encodable { let theme: String }
    private struct JevBody: Encodable { let auto: Bool?; let handoff: Bool? }
    private struct InstructionsBody: Encodable { let instructions: String }
    private struct EnabledBody: Encodable { let enabled: Bool }
    private struct AuthBody: Encodable { let token: String; let header: String? }

    func setTheme(_ theme: String) async throws { _ = try await send("/v1/settings/theme", method: "PUT", body: ThemeBody(theme: theme)) }
    func setJev(auto: Bool? = nil, handoff: Bool? = nil) async throws {
        _ = try await send("/v1/settings/jev", method: "PUT", body: JevBody(auto: auto, handoff: handoff))
    }
    // Leerer Text = Standard.
    func setInstructions(_ text: String) async throws { _ = try await send("/v1/settings/instructions", method: "PUT", body: InstructionsBody(instructions: text)) }
    func deleteRule(id: String) async throws { try await call("/v1/settings/rules/\(id)", method: "DELETE") }

    func createSkill(_ form: SkillForm) async throws { _ = try await send("/v1/skills", method: "POST", body: form) }
    func updateSkill(id: String, _ form: SkillForm) async throws { _ = try await send("/v1/skills/\(id)", method: "PUT", body: form) }
    func deleteSkill(id: String) async throws { try await call("/v1/skills/\(id)", method: "DELETE") }

    func addConnector(_ form: ConnectorForm) async throws -> String {
        let created: ConnectorCreated = try decode(try await send("/v1/connectors", method: "POST", body: form))
        return created.connector.id
    }
    func testConnector(id: String) async throws -> ConnectorTest {
        try decode(try await data(for: try request("/v1/connectors/\(id)/test", method: "POST")))
    }
    func setConnector(id: String, enabled: Bool) async throws { _ = try await send("/v1/connectors/\(id)/enabled", method: "PUT", body: EnabledBody(enabled: enabled)) }
    func setAllConnectors(enabled: Bool) async throws { _ = try await send("/v1/connectors/enabled", method: "PUT", body: EnabledBody(enabled: enabled)) }
    func setConnectorAuth(id: String, token: String, header: String?) async throws {
        _ = try await send("/v1/connectors/\(id)/auth", method: "PUT", body: AuthBody(token: token, header: header))
    }
    func startConnectorOAuth(id: String) async throws -> ConnectorOAuth {
        try decode(try await data(for: try request("/v1/connectors/\(id)/oauth", method: "POST")))
    }
    func disconnectConnectorOAuth(id: String) async throws { try await call("/v1/connectors/\(id)/oauth", method: "DELETE") }
    func deleteConnector(id: String) async throws { try await call("/v1/connectors/\(id)", method: "DELETE") }
}

extension ServiceClient {
    func plugins(cursor: String? = nil, search: String = "", category: String = "") async throws -> PluginsResponse {
        var query = URLComponents()
        query.queryItems = [URLQueryItem(name: "limit", value: "100"), URLQueryItem(name: "search", value: search), URLQueryItem(name: "category", value: category == "connected" ? "" : category), URLQueryItem(name: "connected", value: category == "connected" ? "true" : "false")]
        if let cursor { query.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
        return try await get("/v1/plugins?" + (query.percentEncodedQuery ?? ""))
    }

    func connectPlugin(slug: String) async throws -> PluginConnectionResponse {
        guard let slug = slug.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw ServiceError.invalidResponse }
        let response = try await data(for: try request("/v1/plugins/\(slug)/connect", method: "POST"))
        do { return try Self.decoder.decode(PluginConnectionResponse.self, from: response) }
        catch { throw ServiceError.invalidResponse }
    }
}


extension ServiceClient {
    func verifyICloud(appleId: String, appPassword: String) async throws {
        struct Body: Encodable { let appleId: String; let appPassword: String }
        let body = try JSONEncoder().encode(Body(appleId: appleId, appPassword: appPassword))
        _ = try await data(for: try request("/v1/icloud/verify", method: "POST", body: body))
    }
}


extension ServiceClient {
    func verifyComposio(key: String, user: String) async throws {
        struct Body: Encodable { let key: String; let user: String }
        let body = try JSONEncoder().encode(Body(key: key, user: user))
        _ = try await data(for: try request("/v1/plugins/verify", method: "POST", body: body))
    }
    func reloadPluginCredentials() async throws {
        _ = try await data(for: try request("/v1/plugins/reload", method: "POST"))
    }
}

extension ServiceClient {
    func pluginSetup(slug: String) async throws -> PluginSetupResponse {
        guard let slug = slug.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw ServiceError.invalidResponse }
        return try await get("/v1/plugins/\(slug)/setup")
    }
    func setupPlugin(slug: String, scheme: String, fields: [String: JSONValue]) async throws -> PluginConnectionResponse {
        struct Body: Encodable { let scheme: String; let fields: [String: JSONValue] }
        guard let slug = slug.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw ServiceError.invalidResponse }
        let body = try JSONEncoder().encode(Body(scheme: scheme, fields: fields))
        let data = try await data(for: try request("/v1/plugins/\(slug)/setup", method: "POST", body: body))
        do { return try Self.decoder.decode(PluginConnectionResponse.self, from: data) }
        catch { throw ServiceError.invalidResponse }
    }
}

struct PluginConnectionAccount: Decodable, Identifiable, Sendable {
    let id: String
    let status: String
    var statusText: String {
        switch status {
        case "ACTIVE": "Verbunden"
        case "INITIATED", "INITIALIZING": "Anmeldung offen"
        case "EXPIRED": "Abgelaufen"
        case "FAILED": "Fehlgeschlagen"
        case "INACTIVE", "DISABLED": "Inaktiv"
        default: "Status unbekannt"
        }
    }
}
struct PluginAccountsResponse: Decodable, Sendable { let accounts: [PluginConnectionAccount] }
struct PluginDisconnectResponse: Decodable, Sendable {
    let deletedIds: [String]
    let failedIds: [String]
    let notice: String
}

extension ServiceClient {
    func pluginAccounts(slug: String) async throws -> PluginAccountsResponse {
        guard let slug = slug.addingPercentEncoding(withAllowedCharacters: .alphanumerics) else { throw ServiceError.invalidResponse }
        return try await get("/v1/plugins/\(slug)/accounts")
    }
    func disconnectPlugin(slug: String, accountIds: [String]) async throws -> PluginDisconnectResponse {
        struct Body: Encodable { let accountIds: [String]; let confirmed = true }
        guard let slug = slug.addingPercentEncoding(withAllowedCharacters: .alphanumerics), !accountIds.isEmpty else { throw ServiceError.invalidResponse }
        return try decode(try await send("/v1/plugins/\(slug)/accounts", method: "DELETE", body: Body(accountIds: accountIds)))
    }
}
