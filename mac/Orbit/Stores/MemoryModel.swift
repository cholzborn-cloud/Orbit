import Foundation
import Observation

// Dienstaufrufe für Gedächtnis und Träumer; ServiceClient setzt es um, die Tests nutzen eine Attrappe.
protocol MemoryService: Sendable {
    func memory(botId: String) async throws -> MemoryList
    func deleteMemory(botId: String, name: String) async throws
    func dreamer(botId: String) async throws -> DreamerState
    func setDreamer(botId: String, enabled: Bool) async throws -> Bool
    // Phase 5: Eintrag ändern (mit der gesehenen Version), gelöschte Einträge lesen und wiederherstellen.
    func editMemory(botId: String, name: String, description: String, body: String, ifVersion: Int) async throws -> MemoryEntry?
    func memoryTrash(botId: String) async throws -> MemoryList
    func restoreMemory(botId: String, name: String) async throws
    // Phase 5: Heartbeat des Orbis (meldet sich höchstens einmal am Tag leise von selbst).
    func heartbeat(botId: String) async throws -> HeartbeatState
    func setHeartbeat(botId: String, enabled: Bool) async throws -> HeartbeatState
}

// Zustand der Gedächtnis-Ansicht eines Orbis: Einträge lesen, einzelnen Eintrag löschen, Träumer ein-/ausschalten.
// Der Träumer ist nur eine Zugabe: fehlt der Endpunkt (älterer Dienst), bleibt die Ansicht ohne Schalter.
@MainActor @Observable
final class MemoryModel {
    private(set) var list: MemoryList?
    private(set) var dreamer: DreamerState?
    // Gelöscht, aber noch wiederherstellbar (nur der Dienst kennt sie; fehlt der Endpunkt, bleibt die Liste leer).
    private(set) var trash: [MemoryEntry] = []
    private(set) var heartbeat: HeartbeatState?
    private(set) var heartbeatSwitching = false
    private(set) var heartbeatError: String?
    private(set) var busy: String?
    private(set) var loading = false
    private(set) var switching = false
    private(set) var error: String?
    private(set) var dreamerError: String?
    private let botId: String
    private let service: any MemoryService
    private var generation = 0

    init(botId: String, service: any MemoryService) {
        self.botId = botId
        self.service = service
    }

    var entries: [MemoryEntry] { list?.sorted ?? [] }
    // Leer-Zustand erst nach dem ersten erfolgreichen Laden zeigen.
    var isEmpty: Bool { list != nil && list?.entries.isEmpty == true }

    func load() async {
        generation += 1
        let mine = generation
        loading = true
        error = nil
        do {
            let result = try await service.memory(botId: botId)
            if mine == generation { list = result }
        } catch {
            if mine == generation { self.error = error.localizedDescription }
        }
        if mine == generation {
            // Träumer separat: ein Fehler hier (ältere Dienste) stört die Einträge nicht.
            dreamer = try? await service.dreamer(botId: botId)
            trash = (try? await service.memoryTrash(botId: botId))?.entries ?? []
            heartbeat = try? await service.heartbeat(botId: botId)
            loading = false
        }
    }

    // Nach der Bestätigung: Eintrag beim Dienst löschen und aus der Liste nehmen. Fehler bleiben als Text stehen, die Liste unverändert.
    @discardableResult
    func delete(_ name: String) async -> Bool {
        do {
            try await service.deleteMemory(botId: botId, name: name)
            list = list.map { MemoryList(entries: $0.entries.filter { $0.name != name }, index: $0.index, maxEntries: $0.maxEntries, migrated: $0.migrated) }
            error = nil
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // Schalter sofort umlegen und beim Dienst bestätigen lassen; bei Fehler zurück auf den alten Stand.
    func setDreamer(_ enabled: Bool) async {
        guard let before = dreamer, before.enabled != enabled, !switching else { return }
        switching = true
        dreamerError = nil
        dreamer = DreamerState(enabled: enabled, lastRunAt: before.lastRunAt, nextRunAt: enabled ? before.nextRunAt : nil, running: before.running, changes: before.changes)
        do {
            let confirmed = try await service.setDreamer(botId: botId, enabled: enabled)
            if confirmed != enabled {
                dreamer = DreamerState(enabled: confirmed, lastRunAt: before.lastRunAt, nextRunAt: before.nextRunAt, running: before.running, changes: before.changes)
            }
        } catch {
            dreamer = before
            dreamerError = error.localizedDescription
        }
        switching = false
    }

    // Eintrag ändern: der Dienst prüft Länge, Zugangsdaten und die Version. Gibt einen Fehlertext zurück, sonst nil (danach neu laden).
    func edit(_ entry: MemoryEntry, description: String, body: String) async -> String? {
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines), body = body.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !description.isEmpty, !body.isEmpty else { return "Beschreibung und Text dürfen nicht leer sein." }
        busy = entry.name
        defer { busy = nil }
        do {
            _ = try await service.editMemory(botId: botId, name: entry.name, description: description, body: body, ifVersion: entry.version)
            await load()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // Gelöschten Eintrag zurückholen.
    func restore(_ name: String) async -> String? {
        busy = name
        defer { busy = nil }
        do {
            try await service.restoreMemory(botId: botId, name: name)
            await load()
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    // Heartbeat-Schalter: sofort umlegen, vom Dienst bestätigen lassen, bei Fehler zurück.
    func setHeartbeat(_ enabled: Bool) async {
        guard let before = heartbeat, before.enabled != enabled, !heartbeatSwitching else { return }
        heartbeatSwitching = true
        heartbeatError = nil
        heartbeat = HeartbeatState(enabled: enabled, everyMinutes: before.everyMinutes, from: before.from, to: before.to)
        do { heartbeat = try await service.setHeartbeat(botId: botId, enabled: enabled) } catch {
            heartbeat = before
            heartbeatError = error.localizedDescription
        }
        heartbeatSwitching = false
    }
}
