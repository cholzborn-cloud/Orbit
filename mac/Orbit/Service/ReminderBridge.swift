import EventKit
import Foundation

struct ReminderTask: Codable, Sendable {
    let kind: String
    var title: String?
    var list: String?
    var due: String?
}

struct ReminderJob: Codable, Sendable { let id: String; let task: ReminderTask }
struct ReminderItem: Codable, Sendable { let title: String; let list: String; let due: String?; let completed: Bool }
struct ReminderResult: Codable, Sendable { let ok: Bool; var items: [ReminderItem]?; var truncated: Bool?; var error: String? }

@MainActor protocol ReminderAccess {
    func perform(_ task: ReminderTask, isActive: @escaping @MainActor () async -> Bool) async -> ReminderResult
}

@MainActor final class EventKitReminderAccess: ReminderAccess {
    private let store = EKEventStore()

    func perform(_ task: ReminderTask, isActive: @escaping @MainActor () async -> Bool) async -> ReminderResult {
        do {
            guard await isActive(), !Task.isCancelled else { return failure("Auftrag abgebrochen.") }
            guard try await store.requestFullAccessToReminders() else { return failure("Der Zugriff auf Erinnerungen ist nicht erlaubt.") }
            guard await isActive(), !Task.isCancelled else { return failure("Auftrag abgebrochen.") }
            let calendars = store.calendars(for: .reminder)
            let selected: EKCalendar?
            if let name = task.list {
                let matches = calendars.filter { $0.title == name }
                guard matches.count == 1 else { return failure("Die Erinnerungsliste ist nicht vorhanden oder nicht eindeutig.") }
                selected = matches[0]
            } else { selected = nil }
            if task.kind == "list" {
                let predicate = store.predicateForReminders(in: selected.map { [$0] })
                let result: ReminderResult? = await withCheckedContinuation { continuation in
                    store.fetchReminders(matching: predicate) { reminders in
                        guard let reminders else { continuation.resume(returning: nil); return }
                        let formatter = ISO8601DateFormatter()
                        func shorten(_ value: String, _ limit: Int) -> String { String(decoding: value.utf16.prefix(limit), as: UTF16.self) }
                        let items = reminders.prefix(100).map { item in
                            ReminderItem(title: shorten(item.title ?? "", 500), list: shorten(item.calendar.title, 200),
                                         due: item.dueDateComponents?.date.map { formatter.string(from: $0) }, completed: item.isCompleted)
                        }
                        continuation.resume(returning: ReminderResult(ok: true, items: items, truncated: reminders.count > 100))
                    }
                }
                return result ?? failure("Erinnerungen konnten nicht gelesen werden.")
            }
            guard task.kind == "create", let title = task.title?.trimmingCharacters(in: .whitespacesAndNewlines), !title.isEmpty,
                  let calendar = selected ?? store.defaultCalendarForNewReminders() else { return failure("Die Erinnerung konnte nicht angelegt werden.") }
            let reminder = EKReminder(eventStore: store)
            reminder.title = title
            reminder.calendar = calendar
            if let due = task.due {
                let formatter = ISO8601DateFormatter()
                formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                let date = formatter.date(from: due) ?? ISO8601DateFormatter().date(from: due)
                guard let date else { return failure("Die Fälligkeit ist ungültig.") }
                reminder.dueDateComponents = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second, .timeZone], from: date)
            }
            guard await isActive(), !Task.isCancelled else { return failure("Auftrag abgebrochen.") }
            try store.save(reminder, commit: true)
            return ReminderResult(ok: true)
        } catch { return failure("Erinnerungen konnten nicht verarbeitet werden. Prüfe die Berechtigung und die Erinnerungen-App.") }
    }

    private func failure(_ message: String) -> ReminderResult { ReminderResult(ok: false, error: message) }
}

protocol ReminderService: Sendable {
    func claimReminder() async throws -> ReminderJob?
    func completeReminder(id: String, result: ReminderResult) async throws
    func reminderIsActive(id: String) async throws -> Bool
}

extension ServiceClient: ReminderService {
    private struct ReminderClaim: Decodable { let task: ReminderJob? }
    func claimReminder() async throws -> ReminderJob? {
        try Self.decoder.decode(ReminderClaim.self, from: await data(for: request("/v1/reminders/claim", method: "POST"))).task
    }
    func completeReminder(id: String, result: ReminderResult) async throws {
        _ = try await data(for: request("/v1/reminders/\(id)/complete", method: "POST", body: JSONEncoder().encode(result)))
    }
    private struct ReminderActive: Decodable { let active: Bool }
    func reminderIsActive(id: String) async throws -> Bool {
        try await get("/v1/reminders/\(id)/active", as: ReminderActive.self).active
    }
}

@MainActor final class ReminderWorker {
    private let service: any ReminderService
    private let access: any ReminderAccess
    private var active = false
    private var requestedAgain = false
    private var currentId: String?
    private var currentTask: Task<ReminderResult, Never>?
    private var cancelled = Set<String>()

    func cancel(_ id: String) {
        if currentId == id { currentTask?.cancel() }
        else {
            if cancelled.count >= 128 { cancelled.removeAll() }
            cancelled.insert(id)
        }
    }

    init(service: any ReminderService, access: any ReminderAccess = EventKitReminderAccess()) {
        self.service = service; self.access = access
    }

    func drain() async {
        if active { requestedAgain = true; return }
        active = true
        defer { active = false }
        repeat {
            requestedAgain = false
            while !Task.isCancelled {
                let job: ReminderJob
                do { guard let next = try await service.claimReminder() else { break }; job = next }
                catch { return }
                if cancelled.remove(job.id) != nil { continue }
                currentId = job.id
                let task = Task { @MainActor in
                    await access.perform(job.task) { [service] in (try? await service.reminderIsActive(id: job.id)) == true }
                }
                currentTask = task
                let result = await task.value
                currentTask = nil; currentId = nil
                if task.isCancelled { continue }
                do { try await service.completeReminder(id: job.id, result: result) }
                catch { return }
            }
        } while requestedAgain && !Task.isCancelled
    }
}
