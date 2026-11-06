import Foundation
import Observation
import UserNotifications

// Dienstaufrufe der Einrichtung und des Tagesbudgets; ServiceClient setzt es um, die Tests nutzen eine Attrappe.
protocol SetupService: Sendable {
    func healthChecks() async throws -> [HealthCheck]
    func keys() async throws -> KeysResponse
    func reloadKeys(names: [String]) async throws -> KeysResponse
    func budget() async throws -> BudgetState
    func setBudget(jevDailyUsd: Double?, maxSandboxes: Int?) async throws -> BudgetState
}


// Einrichtung (Phase 5): was fehlt, ein Satz zur Abhilfe, Schlüssel nur schreiben, Tagesbudget.
// Geprüft wird beim Öffnen und auf „Erneut prüfen“, nie im Takt (die Prüfung ruft Dienste im Netz).
@MainActor @Observable
final class SetupModel {
    private(set) var checks: Load<[HealthCheck]> = .idle
    private(set) var notification: NotificationAccess = .undecided
    private(set) var keys: [KeyStatus] = []
    // Schlüssel, die in dieser Sitzung gesetzt wurden („gesetzt ✓“).
    private(set) var justSet: Set<String> = []
    private(set) var needsRestart: Set<String> = []
    private(set) var keyBusy: String?
    var keyError: String?
    private(set) var budget: Load<BudgetState> = .idle
    var budgetError: String?
    private(set) var budgetSaving = false

    @ObservationIgnored private let service: any SetupService
    @ObservationIgnored private let keyStore: any KeyStoring
    @ObservationIgnored private let notificationAccess: @Sendable () async -> NotificationAccess

    init(service: any SetupService, keyStore: any KeyStoring = SystemKeyStore(),
         notificationAccess: @escaping @Sendable () async -> NotificationAccess = SetupModel.systemNotificationAccess) {
        self.service = service
        self.keyStore = keyStore
        self.notificationAccess = notificationAccess
    }

    static let systemNotificationAccess: @Sendable () async -> NotificationAccess = {
        switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
        case .authorized, .provisional, .ephemeral: .allowed
        case .denied: .denied
        default: .undecided
        }
    }

    // Alle Prüfungen, die Mitteilungen eingeschlossen, in der Reihenfolge der Anzeige.
    var rows: [HealthCheck] { (checks.value ?? []) + [notification.check] }

    // Etwas Nötiges fehlt oder ist kaputt (optionale Dienste zählen nicht).
    var hasRequiredProblem: Bool { (checks.value ?? []).contains { !$0.optional && $0.state != .ok } }

    // Nur für Bildschirmfotos und Tests: Prüfungen vorgeben, ohne Dienst.
    func simulate(checks list: [HealthCheck]) { checks = .loaded(list) }

    func isSet(_ name: String) -> Bool { keys.first { $0.name == name }?.isSet == true || justSet.contains(name) }

    func load() async {
        checks = .loading
        keyError = nil
        notification = await notificationAccess()
        async let health = capture { try await self.service.healthChecks() }
        async let keyList = capture { try await self.service.keys() }
        switch await health {
        case .success(let list): checks = .loaded(list)
        case .failure(let error): let m = Self.message(error); checks = .failed(m.text, offline: m.offline)
        }
        if case .success(let answer) = await keyList { keys = answer.keys }
        await loadBudget()
    }

    // Schlüssel setzen: erst in den Schlüsselbund schreiben, dann den Dienst neu lesen lassen. Der Wert bleibt nie im Speicher der Ansicht.
    func setKey(_ name: String, value: String) async -> Bool {
        let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { keyError = "Füge zuerst den Schlüssel ein."; return false }
        keyBusy = name
        keyError = nil
        defer { keyBusy = nil }
        guard keyStore.save(name: name, value: value) else {
            keyError = "Der Schlüssel konnte nicht im Schlüsselbund gespeichert werden."
            return false
        }
        do {
            let answer = try await service.reloadKeys(names: [name])
            keys = answer.keys
            justSet.insert(name)
            if answer.needsRestart.contains(name) { needsRestart.insert(name) }
            if let list = try? await service.healthChecks() { checks = .loaded(list) }
            return true
        } catch {
            // Gespeichert, aber der Dienst hat ihn noch nicht gelesen: gilt nach dem nächsten Start.
            justSet.insert(name)
            needsRestart.insert(name)
            keyError = "Gespeichert. Der Dienst liest den Schlüssel beim nächsten Start."
            return true
        }
    }

    // MARK: Tagesbudget

    func loadBudget() async {
        budget = .loading
        do { budget = .loaded(try await service.budget()) } catch {
            let m = Self.message(error); budget = .failed(m.text, offline: m.offline)
        }
    }

    func saveBudget(jevDailyUsd: Double? = nil, maxSandboxes: Int? = nil) async {
        budgetSaving = true
        budgetError = nil
        defer { budgetSaving = false }
        do { budget = .loaded(try await service.setBudget(jevDailyUsd: jevDailyUsd, maxSandboxes: maxSandboxes)) } catch {
            budgetError = error.localizedDescription
        }
    }

    static func message(_ error: Error) -> (text: String, offline: Bool) {
        if case ServiceError.offline = error { return ("Der lokale Dienst ist nicht erreichbar. Starte Orbit neu oder prüfe den Dienst.", true) }
        return (error.localizedDescription, false)
    }

    private func capture<T: Sendable>(_ work: @escaping @Sendable () async throws -> T) async -> Result<T, Error> {
        do { return .success(try await work()) } catch { return .failure(error) }
    }
}
