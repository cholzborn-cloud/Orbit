import Foundation
import Observation

// Eingaben des Dialogs „Neue Automation“ / „Automation bearbeiten“ (Web: automation-form.tsx).
@MainActor @Observable
final class AutomationFormModel {
    static let defaultModelId = "claude-haiku-5-5"

    let editing: AutomationItem?
    let timezone: String
    var botId: String
    var name: String
    var prompt: String
    var kind: ScheduleKind
    var at: String
    var dateText: String
    var weekday: Int
    var dayText: String
    var target: String
    var notify: Bool
    var modelId: String
    var effort: String?
    var context: Bool
    var modelsOpen: Bool
    var models: [ModelInfo] = []
    var error: String?
    var saving = false

    init(editing: AutomationItem?, firstBotId: String, now: Date = .now) {
        self.editing = editing
        let a = editing?.automation
        timezone = a?.timezone ?? TimeZone.current.identifier
        botId = editing?.bot.id ?? firstBotId
        name = a?.name ?? ""
        prompt = a?.prompt ?? ""
        let schedule = a?.schedule
        kind = schedule?.kind ?? .daily
        at = schedule?.at ?? "08:00"
        dateText = Self.shown(iso: schedule?.date) ?? Self.shown(date: now)
        weekday = schedule?.weekday ?? 1
        dayText = String(schedule?.day ?? 1)
        target = a?.target ?? "same"
        notify = (a?.notify ?? "app") == "app"
        modelId = a?.model ?? Self.defaultModelId
        effort = a?.effort
        context = a?.context ?? true
        modelsOpen = a.map { $0.model != nil || !$0.context } ?? false
    }

    // Katalog laden; das Standardmodell fällt auf Auto zurück, wenn es nicht verfügbar ist.
    func loadModels(client: ServiceClient) async {
        guard let response: ModelsResponse = try? await client.get("/v1/models") else { return }
        models = response.models
        if editing == nil, !models.contains(where: { $0.id == modelId }) { modelId = ModelInfo.autoId }
    }

    var selectedModel: ModelInfo? { models.first { $0.id == modelId } }

    // Stufe des Modells: gewählte, sonst Mid bzw. die erste (Auto hat keine).
    var effortNow: String? {
        guard let model = selectedModel else { return modelId == ModelInfo.autoId ? nil : effort }
        return effort.flatMap { model.efforts.contains($0) ? $0 : nil } ?? model.defaultEffort
    }

    var schedule: Schedule {
        Schedule(kind: kind, at: at.trimmingCharacters(in: .whitespaces),
                 date: kind == .once ? Self.iso(from: dateText) : nil,
                 weekday: kind == .weekly ? weekday : nil,
                 day: kind == .monthly ? Int(dayText.trimmingCharacters(in: .whitespaces)) ?? 0 : nil)
    }

    func form() -> AutomationForm {
        AutomationForm(botId: editing == nil ? botId : nil, name: name.trimmingCharacters(in: .whitespacesAndNewlines),
                       prompt: prompt.trimmingCharacters(in: .whitespacesAndNewlines), schedule: schedule, timezone: timezone,
                       target: target, notify: notify ? "app" : "none", model: modelId,
                       effort: modelId == ModelInfo.autoId ? nil : effortNow, context: context)
    }

    // Hinweiszeile unter dem Formular: Zusammenfassung und nächster Lauf.
    func upcomingText(now: Date = .now) -> String {
        let schedule = schedule
        guard schedule.validationMessage == nil else { return schedule.summary + "." }
        if let next = schedule.nextRun(timezone: timezone, from: now) { return "\(schedule.summary). Nächster Lauf: \(Self.dateTime(next)) (\(timezone))." }
        return "\(schedule.summary). Für diese Angabe gibt es keinen kommenden Termin."
    }

    // MARK: Datum

    private static let isoFormat: DateFormatter = format("yyyy-MM-dd")
    private static let shownFormat: DateFormatter = format("dd.MM.yyyy")
    private static func format(_ pattern: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = pattern
        return formatter
    }

    // „26.10.2026“ oder „2026-10-26“ → ISO; sonst unverändert (die Prüfung meldet „Datum ist ungültig.“).
    static func iso(from text: String) -> String {
        let t = text.trimmingCharacters(in: .whitespaces)
        if let d = shownFormat.date(from: t) ?? isoFormat.date(from: t) { return isoFormat.string(from: d) }
        return t
    }
    static func shown(iso: String?) -> String? { iso.flatMap(isoFormat.date(from:)).map(shownFormat.string(from:)) }
    private static func shown(date: Date) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%02d.%02d.%04d", c.day ?? 1, c.month ?? 1, c.year ?? 2026)
    }

    // Wie `formatDateTime` im Web: kurzes Datum und kurze Uhrzeit, deutsch.
    static func dateTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "de_DE")
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter.string(from: date)
    }
}
