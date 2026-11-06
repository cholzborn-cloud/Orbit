import Foundation

// Modelle der Einstellungen (4d) nach plan/API.md und components/settings/*.

// MARK: Nutzung (GET /v1/usage)

struct UsageWindow: Decodable, Hashable, Sendable {
    let name: String
    let used: Double
    let resetAt: Double   // ms seit Epoche

    var percent: Int { Int((min(1, max(0, used)) * 100).rounded()) }
    var resetDate: Date { Date(timeIntervalSince1970: resetAt / 1000) }
    var label: String { name == "7d" ? "7 Tage" : name == "5h" ? "5 Stunden" : name }
}

struct UsageAccount: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let label: String
    let status: String
    let note: String?
    let windows: [UsageWindow]
}

struct UsageProvider: Decodable, Hashable, Sendable, Identifiable {
    let provider: String
    let status: String
    let note: String?
    let accounts: [UsageAccount]

    var id: String { provider }
    var name: String { ["claude": "Claude", "codex": "Codex", "antigravity": "Antigravity"][provider] ?? provider }
    // Anbieter-Symbol wie im Web (usage-card: PROVIDERS).
    var iconProvider: String { ["claude": "anthropic", "codex": "openai", "antigravity": "google"][provider] ?? provider }
    // Modell-Anbieter (ModelInfo.provider) → Nutzungsanbieter.
    static func usageProvider(forModelProvider model: String) -> String {
        ["anthropic": "claude", "openai": "codex", "google": "antigravity"][model] ?? model
    }
}

struct UsageResponse: Decodable, Sendable {
    let providers: [UsageProvider]
    let fetchedAt: Double
}

// Anzeige der Rücksetzzeit und die Schätzung zum Wochenlimit: reine Funktionen, damit sie testbar bleiben.
enum UsageText {
    private static let de: Locale = Locale(identifier: "de_DE")

    // Wie lib/settings/format-reset.ts: unter einem Tag „Reset in 2 h 5 min“, sonst „Reset Mo., 13:00“.
    static func reset(_ resetAt: Date, now: Date) -> String {
        let diff = resetAt.timeIntervalSince(now)
        if diff <= 0 { return "Reset steht an" }
        if diff >= 86400 { return "Reset \(weekdayTime(resetAt))" }
        let minutes = Int((diff / 60).rounded(.up))
        let parts = [minutes / 60 > 0 ? "\(minutes / 60) h" : nil, minutes % 60 > 0 ? "\(minutes % 60) min" : nil].compactMap { $0 }
        return "Reset in \(parts.joined(separator: " "))"
    }

    // „Mo., 13:00“ wie toLocaleString("de-DE", weekday short, 2-digit h/m).
    static func weekdayTime(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = de
        f.dateFormat = "EEE, HH:mm"
        return f.string(from: date)
    }

    static func clock(_ date: Date, now: Date) -> String {
        if date.timeIntervalSince(now) >= 86400 { return weekdayTime(date) }
        let f = DateFormatter()
        f.locale = de
        f.dateFormat = "HH:mm"
        return f.string(from: date) + " Uhr"
    }

    static func resetDetail(_ window: UsageWindow, now: Date) -> String {
        guard window.resetDate > now else { return "Rücksetzung steht an." }
        let prefix = window.resetDate.timeIntervalSince(now) < 86400 ? "um " : ""
        let exhausted = window.used >= 1 ? "Aufgebraucht. " : ""
        return "\(exhausted)Setzt \(prefix)\(clock(window.resetDate, now: now)) zurück."
    }

    // „wartet bis 14:30 Uhr“ (Limit-Zustand der Figuren); nil, wenn keine Rücksetzzeit bekannt ist.
    static func waitsUntil(_ resetAt: Date?, now: Date) -> String? {
        guard let resetAt, resetAt > now else { return nil }
        return "wartet bis \(clock(resetAt, now: now))"
    }

    // Wie limitNote im Web: das späteste Reset der Fenster mit used ≥ 1 (ausgeschöpft); ohne ausgeschöpftes Fenster keine Zeit.
    static func limitResets(from usage: UsageResponse) -> [String: Date] {
        var result: [String: Date] = [:]
        for provider in usage.providers {
            let exhausted = provider.accounts.flatMap(\.windows).filter { $0.used >= 1 }.map(\.resetDate)
            if let latest = exhausted.max() { result[provider.provider] = latest }
        }
        return result
    }

    // Nutzungsanbieter eines Modells am Namen (Fallback, wenn der Katalog nicht geladen ist).
    static func provider(forModelId id: String) -> String? {
        if id.hasPrefix("claude") { return "claude" }
        if id.hasPrefix("gpt") { return "codex" }
        if id.hasPrefix("gemini") { return "antigravity" }
        return nil
    }

    // Schätzung für das 7-Tage-Fenster: gleichbleibendes Tempo seit Fensterbeginn. Immer als Schätzung benannt.
    static func forecast(_ window: UsageWindow, now: Date) -> String {
        guard window.name == "7d" else { return "" }
        let length: Double = 7 * 86400
        let remaining = window.resetDate.timeIntervalSince(now)
        let elapsed = length - remaining
        if window.used >= 1 { return "Schätzung: Wochenlimit ist erreicht." }
        if remaining <= 0 || elapsed < 6 * 3600 { return "Schätzung: noch zu wenig Verlauf in diesem Fenster." }
        if window.used <= 0 { return "Schätzung: bisher keine Nutzung, das Wochenlimit ist nicht in Sicht." }
        let rate = window.used / elapsed
        let untilFull = (1 - window.used) / rate
        if untilFull < remaining {
            let hours = Int((untilFull / 3600).rounded())
            let span = hours >= 48 ? "\(hours / 24) Tagen" : "\(max(1, hours)) Stunden"
            return "Schätzung: bei diesem Tempo ist das Wochenlimit in etwa \(span) erreicht, vor dem Reset."
        }
        let end = Int((min(1, window.used + rate * remaining) * 100).rounded())
        return "Schätzung: bei diesem Tempo reicht es bis zum Reset (etwa \(end) % am Ende)."
    }
}

// MARK: Einstellungen (GET /v1/settings)

struct SettingsValues: Decodable, Sendable {
    let theme: String?
    let jevAuto: Bool?
    let jevHandoff: Bool?
    let baseInstructions: String?
}

struct SettingsFull: Decodable, Sendable { let settings: SettingsValues }

struct InstructionsDefault: Decodable, Sendable { let text: String; let limit: Int }

// MARK: Jev-Protokoll (GET /v1/jev)

struct JevEntry: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let kind: String
    let model: String?
    let reason: String?
    let durationMs: Int?
    let createdAt: String

    var kindLabel: String {
        ["route": "Auswahl", "suggest": "Vorschlag", "handoff": "Übergabe", "summary": "Zusammenfassung", "memory": "Memory"][kind] ?? kind
    }
    var date: Date? { ServiceDates.parse(createdAt) }
}

struct JevLog: Decodable, Sendable { let entries: [JevEntry] }

enum ServiceDates {
    nonisolated(unsafe) private static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f
    }()
    nonisolated(unsafe) private static let plain = ISO8601DateFormatter()
    static func parse(_ text: String) -> Date? { withFraction.date(from: text) ?? plain.date(from: text) }
}

// MARK: Skills (GET /v1/skills)

struct SkillItem: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let description: String
    let body: String
}

struct SkillsResponse: Decodable, Sendable { let skills: [SkillItem] }

struct SkillForm: Encodable, Sendable {
    var name: String
    var description: String
    var body: String
}

enum SkillRules {
    static let template = "## Wann nutzen\n\n## Eingaben\n\n## Ablauf\n\n## Prüfung\n\n## Rückgabe\n\n## Braucht Freigabe\n"
    static let bodyLimit = 8000
    static let descriptionLimit = 300

    static func canStart(_ form: SkillForm) -> Bool {
        !form.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !form.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // kebab-case, 2–40 Zeichen (SkillForm im Web: pattern + min/max).
    static func nameError(_ name: String) -> String? {
        guard name.count >= 2, name.count <= 40, name.range(of: #"^[a-z0-9]+(-[a-z0-9]+)*$"#, options: .regularExpression) != nil else {
            return "Name mit 2 bis 40 Kleinbuchstaben oder Ziffern; Wörter mit einzelnen Bindestrichen trennen (z. B. mein-skill)."
        }
        return nil
    }

    static func error(for form: SkillForm) -> String? {
        if let error = nameError(form.name) { return error }
        if form.description.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Bitte eine Beschreibung eingeben." }
        if form.description.count > descriptionLimit { return "Die Beschreibung ist zu lang (höchstens 300 Zeichen)." }
        if form.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "Bitte eine Anleitung eingeben." }
        if form.body.count > bodyLimit { return "Die Anleitung ist zu lang (höchstens 8000 Zeichen)." }
        return nil
    }
}

// MARK: Konnektoren (GET /v1/connectors)

struct ConnectorItem: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let url: String
    let enabled: Bool
    let authHeader: String?
    let hasAuth: Bool
    let oauth: Bool

    var host: String { URL(string: url)?.host ?? url }
}

struct ConnectorsResponse: Decodable, Sendable { let connectors: [ConnectorItem] }

struct ConnectorTool: Decodable, Hashable, Sendable { let name: String; let write: Bool? }

struct ConnectorTest: Decodable, Sendable {
    let count: Int
    let tools: [ConnectorTool]
    var summary: String { tools.map { $0.name + ($0.write == true ? " (schreibend)" : "") }.joined(separator: ", ") }
}

// Die Antwort enthält die Zeile des neuen Konnektors; gebraucht wird nur die Kennung.
struct ConnectorCreated: Decodable, Sendable {
    struct Created: Decodable, Sendable { let id: String }
    let connector: Created
}

struct ConnectorOAuth: Decodable, Sendable { let authorized: Bool; let url: String? }

struct ConnectorForm: Encodable, Sendable {
    var name: String
    var url: String
    var token: String?
}

enum ConnectorRules {
    // Wie needsLogin im Web: der Fehlertext verlangt eine Anmeldung.
    static func needsLogin(_ error: String?) -> Bool { error?.contains("verweigert") == true }
}

// MARK: Marktplatz (GET /v1/marketplace)

struct MarketEntry: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let description: String
    let type: String
    let source: String
    let risk: String
    let permissions: String
    let verified: Bool
    let url: String?
    let skillName: String?
    let skillDescription: String?
    let skillBody: String?

    var isConnector: Bool { type == "mcp" }
    // Schlüssel wie im Web: `mcp:<Name>` bzw. `skill:<skillName>`.
    var installKey: String { isConnector ? "mcp:\(name)" : "skill:\(skillName ?? name)" }
}

struct MarketResponse: Decodable, Sendable { let entries: [MarketEntry] }

// MARK: Freigaben (GET /v1/settings/rules)

struct ApprovalRuleItem: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let tool: String
    let botId: String?
    let botName: String?
    let mode: String

    var modeLabel: String { ["allow": "Erlaubt", "ask": "Fragen", "deny": "Verboten"][mode] ?? mode }
    // Alte „ask“-Regeln wertet der Dienst nicht mehr aus (Phase 1): nicht anzeigen.
    var isActive: Bool { mode != "ask" }

    // `tool` ist seit Phase 1 der Schlüssel der Art (approvalKind): `bash:<reason>`, `desktop:<reason>`, `connector:<id>:<tool>` oder ein Werkzeugname.
    var kindLabel: String {
        let parts = tool.split(separator: ":", maxSplits: 2).map(String.init)
        if parts.count == 2, parts[0] == "bash" || parts[0] == "desktop", let art = ApprovalReason.label(parts[1]) {
            return "\(parts[0] == "bash" ? "Befehl" : "Desktop"): \(art)"
        }
        if parts.count == 3, parts[0] == "connector" { return "Plugin \(parts[1]): \(parts[2])" }
        return ApprovalReason.label(tool) ?? tool
    }
}

struct RulesResponse: Decodable, Sendable { let rules: [ApprovalRuleItem] }

// Plugin-Katalog: Konto-Verbindung und tatsächlich nutzbare Tools bleiben getrennte Zustände.
struct PluginCategory: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
}

struct PluginEntry: Decodable, Hashable, Sendable, Identifiable {
    let id: String
    let slug: String
    let name: String
    let description: String
    let logoUrl: String?
    let categories: [PluginCategory]
    let authSchemes: [String]
    let managedAuthSchemes: [String]
    let authMode: String
    let connectionStatus: String
    let toolsEnabled: Bool
    let toolsStatus: String?
    let source: String

    var statusText: String {
        switch connectionStatus {
        case "connected": toolsEnabled ? "Verbunden" : toolsStatus == "not_checked" ? "Konto verbunden · Aktionen werden beim Chat geprüft" : "Konto verbunden · Tools noch nicht verfügbar"
        case "pending": "Anmeldung läuft"
        case "unavailable": "Noch nicht verfügbar"
        default: authMode == "setup_required" ? "Einrichtung erforderlich" : ""
        }
    }
    func matches(search: String, category: String) -> Bool {
        let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
        return (category.isEmpty || (category == "connected" ? connectionStatus == "connected" : categories.contains { $0.id == category }))
            && (query.isEmpty || "\(name) \(description)".localizedStandardContains(query))
    }
}

struct PluginsResponse: Decodable, Sendable {
    let configured: Bool
    let entries: [PluginEntry]
    let nextCursor: String?
    let totalItems: Int?
}

struct PluginConnectionResponse: Decodable, Sendable {
    let url: String?
    let connectionStatus: String
    let toolsEnabled: Bool
}

struct PluginSetupField: Decodable, Hashable, Sendable, Identifiable {
    let name: String
    let label: String
    let type: String
    let required: Bool
    let secret: Bool
    var id: String { name }
}

struct PluginSetupScheme: Decodable, Hashable, Sendable, Identifiable {
    let scheme: String
    let supported: Bool
    let configFields: [PluginSetupField]
    let connectionFields: [PluginSetupField]
    let requiredScopes: [String]
    let reason: String?
    var id: String { scheme }

    func encodeFields(_ fields: [String: String]) -> (values: [String: JSONValue]?, error: String?) {
        var values: [String: JSONValue] = [:]
        for field in configFields {
            guard let value = fields[field.name], !value.isEmpty else {
                if field.required { return (nil, "Pflichtfeld fehlt: \(field.label)") }
                continue
            }
            switch field.type {
            case "boolean":
                guard value == "true" || value == "false" else { return (nil, "Bitte wähle Ja oder Nein für \(field.label).") }
                values[field.name] = .bool(value == "true")
            case "number", "integer":
                guard let number = Double(value), number.isFinite, field.type != "integer" || number.rounded() == number else { return (nil, "Bitte gib eine gültige Zahl für \(field.label) ein.") }
                values[field.name] = .number(number)
            default: values[field.name] = .string(value)
            }
        }
        return (values, nil)
    }
}

struct PluginSetupResponse: Decodable, Sendable {
    let slug: String
    let name: String
    let guideUrl: String?
    let schemes: [PluginSetupScheme]
    let credentialDestination: String
    let oauthRedirectUrl: String?
}
