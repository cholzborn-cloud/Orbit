import Foundation

// Anbieter des Marktplatzes (orbitd: /v1/marketplace/providers). Geheime Werte kommen nie zurück, nur Namen der fehlenden Felder.
struct ProviderSetupField: Decodable, Sendable, Hashable {
    let key: String
    let label: String
    let secret: Bool
}

struct ProviderItem: Decodable, Identifiable, Sendable, Hashable {
    let id: String
    let label: String
    // "direct", "nango" oder "pipedream".
    let route: String
    let services: [String]
    let setup: [ProviderSetupField]
    let cost: String
    let note: String
    let configured: Bool
    let connected: Bool
    let missing: [String]

    var routeText: String {
        switch route {
        case "direct": "Direkt"
        case "nango": "Über Nango"
        case "pipedream": "Über Pipedream"
        default: route
        }
    }

    var statusText: String { connected ? "Verbunden ✓" : configured ? "Eingerichtet" : "Einrichtung fehlt" }
}

struct ProvidersResponse: Decodable, Sendable {
    let ok: Bool
    let providers: [ProviderItem]
}

struct ProviderConnectResponse: Decodable, Sendable {
    let ok: Bool
    let url: String?
}

struct ProviderReadResponse: Decodable, Sendable {
    let ok: Bool
    let summary: String?
    let error: String?
    var text: String { ok ? (summary ?? "Gelesen.") : (error ?? "Lesen fehlgeschlagen.") }
}
