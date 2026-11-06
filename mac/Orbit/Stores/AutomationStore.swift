import Foundation
import Observation

// Zustand von „Geplant“ (Web: components/automations/*): Liste, Papierkorb, Verlauf je Automation, laufende Läufe live aus
// /v1/events. Jede Aktion meldet Fehler als deutschen Text (`error`), nie still.
@MainActor @Observable
final class AutomationStore {
    private(set) var list: Load<[AutomationItem]> = .idle
    private(set) var trash: [AutomationItem] = []
    private(set) var runs: [String: Load<[AutomationRun]>] = [:]
    private(set) var starting: Set<String> = []
    private(set) var unread = 0
    // Fehler der letzten Aktion (Banner über der Liste).
    var error: String?
    // Formular „Neue Automation“ / „Bearbeiten“ offen: nil = zu, .some(nil) = neu, .some(item) = bearbeiten.
    var form: AutomationItem??
    // Löschen aus dem Papierkorb wartet auf Bestätigung.
    var deleting: AutomationItem?
    // Die Seite „Geplant“ ist offen: fertige Läufe gelten sofort als gesehen.
    var pageOpen = false

    private let client: ServiceClient
    private let events: EventsStore
    private let defaults: UserDefaults
    private static let seenKey = "automations-seen-at"

    init(client: ServiceClient, events: EventsStore, defaults: UserDefaults = ComposerModel.preferences) {
        self.client = client
        self.events = events
        self.defaults = defaults
        events.onAutomationFinished = { [weak self] event in self?.finished(event) }
    }

    var items: [AutomationItem] { list.value ?? [] }

    // Aktiver Lauf dieser Automation laut Ereignissen (Snapshot + live).
    func live(_ id: String) -> AutomationEvent? { events.automations[id] }

    func isRunning(_ id: String) -> Bool {
        starting.contains(id) || live(id) != nil || runs[id]?.value?.first?.status.isActive == true
    }

    func load() async {
        if list.value == nil { list = .loading }
        do {
            let response = try await client.automations()
            list = .loaded(response.automations)
            trash = response.trash
        } catch {
            if list.value == nil { list = .failed(error.localizedDescription, offline: Self.isOffline(error)) }
            else { self.error = error.localizedDescription }
        }
    }

    func loadRuns(_ id: String) async {
        if runs[id]?.value == nil { runs[id] = .loading }
        do { runs[id] = .loaded(try await client.automationRuns(id: id)) }
        catch { runs[id] = .failed(error.localizedDescription, offline: Self.isOffline(error)) }
    }

    // MARK: Aktionen

    private func act(_ work: () async throws -> Void) async -> Bool {
        error = nil
        do { try await work(); await load(); return true }
        catch { self.error = error.localizedDescription; return false }
    }

    func toggle(_ item: AutomationItem, enabled: Bool) async { _ = await act { try await client.setAutomation(id: item.id, enabled: enabled) } }
    func moveToTrash(_ item: AutomationItem) async { _ = await act { try await client.trashAutomation(id: item.id) } }
    func restore(_ item: AutomationItem) async { _ = await act { try await client.restoreAutomation(id: item.id) } }

    func deleteForever(_ item: AutomationItem) async {
        deleting = nil
        _ = await act { try await client.deleteAutomationForever(id: item.id) }
    }

    // Speichert das Formular; bei Fehler bleibt es offen und zeigt den Text (Rückgabe: Fehlertext).
    func save(_ form: AutomationForm, editing: AutomationItem?) async -> String? {
        if let message = form.validationMessage { return message }
        do {
            if let editing { try await client.updateAutomation(id: editing.id, form) } else { try await client.createAutomation(form) }
        } catch { return error.localizedDescription }
        await load()
        return nil
    }

    // Jetzt ausführen: der Dienst antwortet sofort, den Rest zeigen die Ereignisse; der Verlauf klappt dafür auf.
    func runNow(_ item: AutomationItem) async {
        error = nil
        starting.insert(item.id)
        defer { starting.remove(item.id) }
        do {
            _ = try await client.runAutomation(id: item.id)
            await loadRuns(item.id)
        } catch {
            self.error = error.localizedDescription
        }
    }

    // Nur Screenshot-Szenen: Zustand ohne Dienst setzen.
    func simulate(list: Load<[AutomationItem]>, trash: [AutomationItem] = [], error: String? = nil) {
        self.list = list; self.trash = trash; self.error = error
    }

    // MARK: Ereignisse und „gesehen“

    private func finished(_ event: AutomationEvent) {
        Task {
            await load()
            if runs[event.automationId] != nil { await loadRuns(event.automationId) }
            await refreshUnread()
            if pageOpen { markSeen() }
        }
    }

    private var seenAt: Double {
        get { defaults.double(forKey: Self.seenKey) }
        set { defaults.set(newValue, forKey: Self.seenKey) }
    }

    // Die Seite „Geplant“ ist offen: alles bis jetzt gilt als gesehen (Web: markRunsSeen).
    func markSeen() {
        seenAt = Date().timeIntervalSince1970 * 1000
        unread = 0
    }

    func refreshUnread() async {
        unread = (try? await client.unreadAutomationRuns(since: seenAt)) ?? 0
    }

    static func isOffline(_ error: Error) -> Bool { (error as? ServiceError).map { if case .offline = $0 { true } else { false } } ?? false }
}
