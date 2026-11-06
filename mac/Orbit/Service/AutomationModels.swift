import Foundation

struct AutomationRetries {
    private(set) var ids: Set<String> = []
    mutating func begin(_ id: String) -> Bool { ids.insert(id).inserted }
    mutating func end(_ id: String) { ids.remove(id) }
}

// Von Hand nach plan/API.md (Abschnitt Automationen) und lib/automations/schedule.ts. Reine Logik ohne Netz, damit sie sich testen lässt.

enum ScheduleKind: String, CaseIterable, Codable, Sendable {
    case once, daily, weekdays, weekly, monthly

    var title: String {
        switch self {
        case .once: "Einmalig"
        case .daily: "Jeden Tag"
        case .weekdays: "Werktags"
        case .weekly: "Jede Woche"
        case .monthly: "Jeden Monat"
        }
    }
}

// Zeitplan wie `scheduleSchema`: Art, Uhrzeit „HH:MM“, je nach Art Datum, Wochentag (0 = Sonntag) oder Monatstag.
struct Schedule: Codable, Equatable, Sendable {
    var kind: ScheduleKind
    var at: String
    var date: String?
    var weekday: Int?
    var day: Int?

    static let weekdayNames = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]
    private static let weekdayShort = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]

    // Wie `describeSchedule` im Web.
    var summary: String {
        switch kind {
        case .once:
            let shown = date.flatMap(Self.dayParser.date(from:)).map { Self.dayShown.string(from: $0) } ?? date ?? ""
            return "Einmalig am \(shown) um \(at)"
        case .daily: return "Täglich um \(at)"
        case .weekdays: return "Werktags um \(at)"
        case .weekly: return "Wöchentlich, \(Self.weekdayShort[min(6, max(0, weekday ?? 0))]), um \(at)"
        case .monthly: return "Monatlich am \(day ?? 1). um \(at)"
        }
    }

    // Eingabeprüfung vor dem Senden (Texte wie `automationInput`); nil = in Ordnung.
    var validationMessage: String? {
        let parts = at.split(separator: ":").compactMap { Int($0) }
        guard at.range(of: #"^\d{2}:\d{2}$"#, options: .regularExpression) != nil, parts.count == 2, parts[0] <= 23, parts[1] <= 59 else { return "Uhrzeit ist ungültig." }
        if kind == .once, date.flatMap(Self.dayParser.date(from:)) == nil { return "Datum ist ungültig." }
        if kind == .weekly, !(0...6).contains(weekday ?? -1) { return "Wochentag ist ungültig." }
        if kind == .monthly, !(1...31).contains(day ?? 0) { return "Monatstag muss zwischen 1 und 31 liegen." }
        return nil
    }

    private static let dayParser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()
    private static let dayShown: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "de_DE")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "d.M.yyyy"
        return formatter
    }()

    // Nächster Termin nach `from` in der Zeitzone (Port von `nextRun`); nil = keiner mehr (einmalig vorbei, Zeitzone ungültig).
    func nextRun(timezone: String, from: Date) -> Date? {
        guard let zone = TimeZone(identifier: timezone) else { return nil }
        let clock = at.split(separator: ":").compactMap { Int($0) }
        guard clock.count == 2 else { return nil }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let today = calendar.startOfDay(for: from)
        let limit = kind == .once ? 800 : 367
        for offset in 0..<limit {
            guard let dayDate = calendar.date(byAdding: .day, value: offset, to: today) else { continue }
            let c = calendar.dateComponents([.year, .month, .day, .weekday], from: dayDate)
            let weekdayIndex = (c.weekday ?? 1) - 1
            if kind == .once {
                let key = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
                if key != date { continue }
            }
            if kind == .weekdays, weekdayIndex == 0 || weekdayIndex == 6 { continue }
            if kind == .weekly, weekdayIndex != weekday { continue }
            if kind == .monthly {
                let length = calendar.range(of: .day, in: .month, for: dayDate)?.count ?? 31
                if c.day != min(self.day ?? 1, length) { continue }
            }
            var target = DateComponents(year: c.year, month: c.month, day: c.day, hour: clock[0], minute: clock[1])
            target.timeZone = zone
            // Lücken der Sommerzeit: Zeit gibt es nicht (Kalender verschiebt) → der Dienst überspringt sie auch.
            guard let candidate = calendar.date(from: target), calendar.dateComponents([.hour, .minute], from: candidate).hour == clock[0] else { continue }
            if candidate > from { return candidate }
        }
        return nil
    }
}

struct AutomationBotRef: Codable, Equatable, Hashable, Sendable {
    let id: String
    let name: String
    let avatar: String
}

struct Automation: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let botId: String
    var name: String
    var prompt: String
    var schedule: Schedule
    var timezone: String
    var target: String
    var chatId: String?
    var notify: String
    var model: String?
    var effort: String?
    var context: Bool
    var enabled: Bool
    var pausedReason: String?
    var lastRunAt: Date?
    var nextRunAt: Date?
    var deletedAt: Date?

    // Einmalig und abgelaufen: ausgeschaltet ohne Pause (Web: „Beendet“).
    var ended: Bool { !enabled && pausedReason == nil && schedule.kind == .once }
}

struct AutomationItem: Codable, Identifiable, Equatable, Sendable {
    let automation: Automation
    let bot: AutomationBotRef
    var id: String { automation.id }
}

// GET /v1/automations
struct AutomationsResponse: Decodable, Sendable {
    let automations: [AutomationItem]
    let trash: [AutomationItem]
}

enum RunStatus: String, Codable, Sendable {
    case running, waiting, ok, error

    var label: String {
        switch self {
        case .ok: "Erfolgreich"
        case .error: "Fehler"
        case .running: "Läuft"
        case .waiting: "Wartet auf Freigabe"
        }
    }
    var isActive: Bool { self == .running || self == .waiting }
}

struct AutomationRun: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let automationId: String
    var chatId: String?
    var status: RunStatus
    var trigger: String?
    var error: String?
    let startedAt: Date
    var finishedAt: Date?

    // Dauer in Sekunden wie im Web (mindestens 1), nil solange der Lauf nicht fertig ist.
    var seconds: Int? {
        finishedAt.map { max(1, Int(($0.timeIntervalSince(startedAt)).rounded())) }
    }
}

struct AutomationRunsResponse: Decodable, Sendable { let runs: [AutomationRun] }

// Live-Ereignis aus /v1/events (`type: automation`).
struct AutomationEvent: Equatable, Sendable {
    let automationId: String
    let runId: String
    let chatId: String?
    let trigger: String
    let status: RunStatus
    let error: String?

    init?(json: [String: Any]) {
        guard let automationId = json["automationId"] as? String, let runId = json["runId"] as? String,
              let raw = json["status"] as? String, let status = RunStatus(rawValue: raw) else { return nil }
        self.automationId = automationId
        self.runId = runId
        chatId = json["chatId"] as? String
        trigger = json["trigger"] as? String ?? "schedule"
        self.status = status
        error = json["error"] as? String
    }
}

// Eingabe zum Anlegen und Ändern (`botId` und `chatId` nur beim Anlegen).
struct AutomationForm: Encodable, Equatable, Sendable {
    var botId: String?
    var name: String
    var prompt: String
    var schedule: Schedule
    var timezone: String
    var target: String
    var notify: String
    var model: String?
    var effort: String?
    var context: Bool

    enum CodingKeys: String, CodingKey { case botId, name, prompt, schedule, timezone, target, notify, model, effort, context }
    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encodeIfPresent(botId, forKey: .botId)
        try c.encode(name, forKey: .name); try c.encode(prompt, forKey: .prompt); try c.encode(schedule, forKey: .schedule)
        try c.encode(timezone, forKey: .timezone); try c.encode(target, forKey: .target); try c.encode(notify, forKey: .notify)
        try c.encode(model, forKey: .model); try c.encode(effort, forKey: .effort); try c.encode(context, forKey: .context)
    }

    // Prüfung wie `automationInput`; Texte deutsch. nil = in Ordnung.
    var validationMessage: String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count < 2 { return "Name muss mindestens 2 Zeichen haben." }
        if trimmed.count > 60 { return "Name darf höchstens 60 Zeichen haben." }
        let task = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if task.isEmpty { return "Prompt fehlt." }
        if task.count > 4000 { return "Prompt darf höchstens 4000 Zeichen haben." }
        return schedule.validationMessage
    }
}

// Automationen senden ihre Aufgabe mit Kennzeichen „[[automation:Name]]“ (lib/automations/tag.ts): der Chat zeigt sie als Karte.
struct AutomationMessage: Codable, Hashable, Sendable {
    let automationId: String
    let runId: String
    let name: String
    let status: String
    let startedAt: Double
    var finishedAt: Double?

    var failed: Bool { status == "error" }
    var active: Bool { status == "running" || status == "waiting" }
    var label: String {
        if failed { return "\(name) fehlgeschlagen" }
        if active { return status == "waiting" ? "\(name) wartet …" : "\(name) läuft …" }
        guard let finishedAt else { return name }
        return "\(name) · \(Date(timeIntervalSince1970: finishedAt / 1000).formatted(date: .omitted, time: .shortened))"
    }
}

enum AutomationTag {
    static func parse(_ text: String) -> (name: String, prompt: String)? {
        guard text.hasPrefix("[[automation:"), let close = text.range(of: "]]") else { return nil }
        let name = String(text[text.index(text.startIndex, offsetBy: 13)..<close.lowerBound])
        guard !name.contains("\n") else { return nil }
        var prompt = String(text[close.upperBound...])
        if prompt.hasPrefix("\n") { prompt.removeFirst() }
        return (name, prompt)
    }
}
