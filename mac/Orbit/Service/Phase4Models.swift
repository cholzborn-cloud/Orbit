import Foundation

// Phase 4 (Lauf J): Gedächtnis je Orbi, Träumer, Texte im Info-Popover der Antwort (plan/API.md, „Phase 4, Lauf H/I“).
// Reine Logik ohne Netz und Oberfläche. Alle Felder werden tolerant gelesen: eine Lücke oder ein falscher Typ verwirft nie die ganze Antwort.

// MARK: Tolerantes Lesen

extension KeyedDecodingContainer {
    func lenientString(_ key: Key) -> String? {
        if let text = try? decodeIfPresent(String.self, forKey: key) { return text }
        if let number = try? decodeIfPresent(Double.self, forKey: key) { return number.formatted() }
        return nil
    }

    func lenientDouble(_ key: Key) -> Double? {
        if let number = try? decodeIfPresent(Double.self, forKey: key) { return number }
        if let text = try? decodeIfPresent(String.self, forKey: key) { return Double(text) }
        return nil
    }

    func lenientInt(_ key: Key) -> Int? { lenientDouble(key).flatMap { $0.isFinite ? Int($0) : nil } }

    func lenientBool(_ key: Key) -> Bool? {
        if let flag = try? decodeIfPresent(Bool.self, forKey: key) { return flag }
        if let number = try? decodeIfPresent(Double.self, forKey: key) { return number != 0 }
        return nil
    }

    // Zeit in Unix-Millisekunden (Sekunden-Werte unter 10^11 werden als Sekunden gelesen), auch als ISO-Text.
    func lenientDate(_ key: Key) -> Date? {
        if let value = lenientDouble(key) {
            return Date(timeIntervalSince1970: value < 100_000_000_000 ? value : value / 1000)
        }
        if let text = try? decodeIfPresent(String.self, forKey: key) {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: text) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.date(from: text)
        }
        return nil
    }
}

// Liste, in der ein kaputtes Element übersprungen wird (statt die ganze Liste zu verwerfen).
private struct Skippable<T: Decodable>: Decodable {
    let value: T?
    init(from decoder: any Decoder) throws { value = try? T(from: decoder) }
}

private extension KeyedDecodingContainer {
    func tolerantList<T: Decodable>(_ type: T.Type, _ key: Key) -> [T] {
        ((try? decodeIfPresent([Skippable<T>].self, forKey: key)) ?? nil)?.compactMap(\.value) ?? []
    }
}

// MARK: Gedächtnis (GET /v1/bots/:id/memory)

struct MemoryEntry: Decodable, Identifiable, Hashable, Sendable {
    let name: String
    let type: String
    let description: String
    let body: String
    // Consti hat es selbst gesagt.
    let stated: Bool
    let origin: String
    let source: String
    let version: Int
    let createdAt: Date?
    let updatedAt: Date?

    var id: String { name }

    init(name: String, type: String = "project", description: String = "", body: String = "", stated: Bool = false,
         origin: String = "self", source: String = "", version: Int = 1, createdAt: Date? = nil, updatedAt: Date? = nil) {
        self.name = name; self.type = type; self.description = description; self.body = body; self.stated = stated
        self.origin = origin; self.source = source; self.version = version; self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey { case name, type, description, body, stated, origin, source, version, createdAt, updatedAt }

    // Ohne Namen gibt es keinen Eintrag (der Name ist der Schlüssel zum Löschen); alles andere bekommt Standardwerte.
    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let name = c.lenientString(.name), !name.isEmpty else {
            throw DecodingError.keyNotFound(CodingKeys.name, .init(codingPath: decoder.codingPath, debugDescription: "name fehlt"))
        }
        self.name = name
        type = c.lenientString(.type) ?? ""
        description = c.lenientString(.description) ?? ""
        body = c.lenientString(.body) ?? ""
        stated = c.lenientBool(.stated) ?? false
        origin = c.lenientString(.origin) ?? ""
        source = c.lenientString(.source) ?? ""
        version = c.lenientInt(.version) ?? 1
        createdAt = c.lenientDate(.createdAt)
        updatedAt = c.lenientDate(.updatedAt)
    }

    // Art in Constis Worten.
    var typeLabel: String {
        switch type {
        case "user": "Über dich"
        case "feedback": "Rückmeldung"
        case "project": "Projekt"
        case "reference": "Nachschlagen"
        default: "Notiz"
        }
    }

    // Woher der Eintrag stammt, kurz und ohne Technikbegriffe.
    var originLabel: String {
        switch origin {
        case "consti": "Von dir"
        case "self": "Vom Orbi notiert"
        case "external": "Aus einer fremden Quelle"
        case "migration": "Aus dem alten Gedächtnis"
        default: "Herkunft unbekannt"
        }
    }

    // Letzte Änderung, sonst Anlegedatum.
    var date: Date? { updatedAt ?? createdAt }
}

struct MemoryList: Decodable, Sendable {
    let entries: [MemoryEntry]
    let index: String
    let maxEntries: Int?
    let migrated: Bool

    init(entries: [MemoryEntry] = [], index: String = "", maxEntries: Int? = nil, migrated: Bool = true) {
        self.entries = entries; self.index = index; self.maxEntries = maxEntries; self.migrated = migrated
    }

    private enum CodingKeys: String, CodingKey { case entries, index, limits, migrated }
    private enum LimitKeys: String, CodingKey { case entries }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entries = c.tolerantList(MemoryEntry.self, .entries)
        index = c.lenientString(.index) ?? ""
        migrated = c.lenientBool(.migrated) ?? true
        maxEntries = (try? c.nestedContainer(keyedBy: LimitKeys.self, forKey: .limits)).flatMap { $0.lenientInt(.entries) }
    }

    // Neueste Änderung zuerst, bei gleichem Datum nach Name.
    var sorted: [MemoryEntry] {
        entries.sorted { lhs, rhs in
            let l = lhs.date ?? .distantPast, r = rhs.date ?? .distantPast
            return l == r ? lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending : l > r
        }
    }
}

// MARK: Träumer (GET/PUT /v1/bots/:id/dreamer)

struct DreamerChange: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let action: String
    let at: Date?

    private enum CodingKeys: String, CodingKey { case id, name, action, at }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let action = c.lenientString(.action) else {
            throw DecodingError.keyNotFound(CodingKeys.action, .init(codingPath: decoder.codingPath, debugDescription: "action fehlt"))
        }
        self.action = action
        name = c.lenientString(.name) ?? ""
        at = c.lenientDate(.at)
        id = c.lenientString(.id) ?? "\(name)-\(action)-\(at?.timeIntervalSince1970 ?? 0)"
    }

    init(id: String, name: String, action: String, at: Date?) { self.id = id; self.name = name; self.action = action; self.at = at }

    // Was der Träumer getan hat (Aktionen heißen im Dienst `dream-merge|remove|rewrite|retype`).
    var actionLabel: String {
        switch action.replacingOccurrences(of: "dream-", with: "") {
        case "merge": "Zusammengeführt"
        case "remove": "Entfernt"
        case "rewrite": "Gekürzt"
        case "retype": "Neu eingeordnet"
        default: "Aufgeräumt"
        }
    }
}

struct DreamerState: Decodable, Sendable {
    let enabled: Bool
    let lastRunAt: Date?
    let nextRunAt: Date?
    let running: Bool
    let changes: [DreamerChange]

    init(enabled: Bool, lastRunAt: Date? = nil, nextRunAt: Date? = nil, running: Bool = false, changes: [DreamerChange] = []) {
        self.enabled = enabled; self.lastRunAt = lastRunAt; self.nextRunAt = nextRunAt; self.running = running; self.changes = changes
    }

    private enum CodingKeys: String, CodingKey { case enabled, lastRunAt, nextRunAt, running, changes }

    init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = c.lenientBool(.enabled) ?? true
        lastRunAt = c.lenientDate(.lastRunAt)
        nextRunAt = c.lenientDate(.nextRunAt)
        running = c.lenientBool(.running) ?? false
        changes = c.tolerantList(DreamerChange.self, .changes)
    }
}

struct DreamerSwitched: Decodable, Sendable {
    let enabled: Bool?
    private enum CodingKeys: String, CodingKey { case enabled }
    init(from decoder: any Decoder) throws { enabled = try decoder.container(keyedBy: CodingKeys.self).lenientBool(.enabled) }
}

// Pfade der Gedächtnis- und Träumer-Endpunkte; Orbi-ID und Eintragsname werden als Pfadteil kodiert (nie `/`, `?`, `#`, `%` im Rohtext).
enum MemoryPaths {
    static func segment(_ text: String) -> String {
        text.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/?#%"))) ?? ""
    }
    static func list(botId: String) -> String { "/v1/bots/\(segment(botId))/memory" }
    static func entry(botId: String, name: String) -> String { "\(list(botId: botId))/\(segment(name))" }
    static func dreamer(botId: String) -> String { "/v1/bots/\(segment(botId))/dreamer" }
}

// MARK: Info-Popover der Antwort

enum InfoText {
    static let efforts = ["low": "Low", "medium": "Mid", "high": "High", "xhigh": "XHigh", "max": "Max"]

    // Kosten in Dollar, im Info-Popover: unter 1 $ drei Nachkommastellen, sonst zwei; Komma als Trenner.
    static func cost(_ usd: Double) -> String {
        let digits = usd < 1 ? 3 : 2
        return usd.formatted(.number.locale(Locale(identifier: "de_DE")).precision(.fractionLength(digits))) + " $"
    }

    // Modellwahl in einem Satz, aus `metadata.jev.change/from`. Ohne bekannte Art: nil (der Grund steht dann allein).
    static func choice(_ jev: JevInfo, fallbackModel: String?) -> String? {
        let name = jev.modelLabel ?? jev.model ?? fallbackModel ?? "dem Modell"
        switch jev.change {
        case "start": return jev.tier == "small" ? "Start klein: \(name)" : "Start mit \(name)"
        case "upgrade": return jev.from.map { "Hochgestuft von \($0) auf \(name)" } ?? "Hochgestuft auf \(name)"
        case "keep": return "Bleibt bei \(jev.from ?? name) (Cache warm)"
        case "reset": return "Nach einer Pause neu gewählt: \(name)"
        case "pinned": return "Von dir gewählt: \(name)"
        case "fallback": return "Standardmodell (Jev nicht erreichbar)"
        default: return nil
        }
    }

    static func compactRows(_ meta: ChatMetadata) -> [(String, String)] {
        let keep = ["Modell", "Dauer", "Tokens"]
        let byName = Dictionary(uniqueKeysWithValues: rows(meta).filter { keep.contains($0.0) })
        return keep.compactMap { name in byName[name].map { (name, $0) } }
    }

    // Zeilen des Popovers: Modell, Stufe, Modellwahl, Grund, Tokens, Cache geschrieben, Schritte, Kosten, Dauer.
    static func rows(_ meta: ChatMetadata) -> [(String, String)] {
        func fmt(_ n: Int?) -> String { TokenText.number(n) }
        var list: [(String, String)] = [("Modell", meta.model ?? "–"), ("Stufe", meta.effort.map { efforts[$0] ?? $0 } ?? "–")]
        if let jev = meta.jev {
            let line = choice(jev, fallbackModel: meta.model)
            if let line { list.append(("Modellwahl", line)) }
            let reason = jev.reason.trimmingCharacters(in: .whitespacesAndNewlines)
            // Der Dienst schreibt die Wahl oft schon in den Grund; dann nicht doppelt zeigen.
            if !reason.isEmpty, reason != line { list.append(("Grund", reason)) }
        }
        list.append(("Tokens", TokenText.line(input: meta.inputTokens, cached: meta.cachedTokens, output: meta.outputTokens)))
        if let written = meta.cacheWriteTokens, written > 0 { list.append(("Cache geschrieben", fmt(written))) }
        if let reasoning = meta.reasoningTokens, reasoning > 0 { list.append(("davon Denken", fmt(reasoning))) }
        if let steps = meta.steps, steps > 0 { list.append(("Schritte", fmt(steps))) }
        if let cost = meta.costUsd, cost > 0 { list.append(("Kosten", Self.cost(cost))) }
        let secs = meta.startedAt.flatMap { start in meta.finishedAt.map { ($0 - start) / 1000 } }
        list.append(("Dauer", secs.map { String(format: "%.1f s", $0).replacingOccurrences(of: ".", with: ",") } ?? "–"))
        return list
    }
}
