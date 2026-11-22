import Observation

enum LoadState: Equatable {
    case idle
    case loading
    case loaded
    case failed(String)
}

// Löschen nur nach Bestätigung: erst anfragen, dann bestätigen oder abbrechen.
// Bestätigung vor endgültigen Aktionen; Texte wie die AlertDialogs der Web-UI (bot-dialog.tsx, group-side-panel.tsx).
enum PendingDelete: Equatable {
    case bot(Bot)
    case group(OrbiGroup)
    // Verlauf leeren: Orbi bzw. Gruppe bleibt (`DELETE /v1/chats/:id/messages`).
    case clear(chatId: String, name: String, group: Bool)
    // Einen Eintrag aus dem Gedächtnis eines Orbis löschen (`DELETE /v1/bots/:id/memory/:name`).
    case memory(botId: String, name: String, orbi: String)

    var title: String {
        switch self {
        case .bot(let bot): "\(bot.name) löschen?"
        case .group(let group): "Gruppe \(group.name) löschen?"
        case .clear: "Verlauf leeren?"
        case .memory: "Eintrag vergessen?"
        }
    }

    var message: String {
        switch self {
        case .bot(let bot): "\(bot.name) und der ganze Verlauf werden gelöscht. Das lässt sich nicht rückgängig machen."
        case .group: "Die Gruppe und ihr Verlauf werden gelöscht. Die Orbis bleiben erhalten."
        case .clear(_, let name, let group): group ? "Alle Nachrichten dieser Gruppe werden gelöscht. Die Gruppe bleibt erhalten." : "Alle Nachrichten mit \(name) werden gelöscht. \(name) bleibt."
        case .memory(_, let name, let orbi): "„\(name)“ wird aus dem Gedächtnis von \(orbi) gelöscht. Das lässt sich nicht rückgängig machen."
        }
    }

    var action: String {
        switch self {
        case .bot: "Löschen"
        case .group: "Löschen"
        case .clear: "Leeren"
        case .memory: "Löschen"
        }
    }
}

// Orbis und Gruppen aus GET /v1/bots, Anlegen, Ändern, Löschen über den Dienst.
@MainActor @Observable
final class BotStore {
    private(set) var main: Bot?
    private(set) var bots: [Bot] = []
    private(set) var groups: [OrbiGroup] = []
    private(set) var state: LoadState = .idle
    private(set) var refreshError: String?
    private(set) var pendingDelete: PendingDelete?
    // Zählt gelöschte Gedächtnis-Einträge hoch; die Gedächtnis-Ansicht lädt dann neu.
    private(set) var memoryRevision = 0
    private let client: ServiceClient

    init(client: ServiceClient) { self.client = client }

    // Reine Attrappen für die unsichtbare Design-Abnahme, ohne Dienst oder Datenbank.
    func simulate(_ response: BotsResponse) {
        main = response.main
        bots = response.bots
        groups = response.groups
        state = .loaded
    }

    // Reihenfolge: Hauptorbi zuerst, danach nach letzter Nachricht (wie der Dienst sie liefert), Gruppen in Dienstreihenfolge.
    var orbis: [Bot] { (main.map { [$0] } ?? []) + bots }
    var canCreateFirstOrbi: Bool { state == .loaded && orbis.isEmpty }

    func bot(id: String?) -> Bot? { id.flatMap { id in orbis.first { $0.id == id } } }

    // silent: Liste erneuern, ohne die Seitenleiste auf „Lädt …“ zu setzen (nach Änderungen).
    func load(silent: Bool = false) async {
        if !silent || state != .loaded { state = .loading }
        do {
            let response = try await client.bots()
            main = response.main
            bots = response.bots
            groups = response.groups
            state = .loaded
            refreshError = nil
        } catch {
            finishLoadFailure(error.localizedDescription, silent: silent)
        }
    }

    func finishLoadFailure(_ message: String, silent: Bool) {
        refreshError = message
        if !silent || state != .loaded { state = .failed(message) }
    }

    // Eine bestätigte Änderung bleibt sichtbar, auch wenn das anschließende Neuladen ausfällt.
    func applySavedBot(_ bot: Bot) {
        bots.removeAll { $0.id == bot.id }
        if bot.isMain {
            if let old = main, old.id != bot.id {
                bots.insert(Bot(chatId: old.chatId, id: old.id, name: old.name, avatar: old.avatar, color: old.color,
                                job: old.job, instructions: old.instructions, isMain: false, look: old.look,
                                lastMessageAt: old.lastMessageAt, onboardingDone: old.onboardingDone), at: 0)
            }
            main = bot
        } else {
            if main?.id == bot.id { main = nil }
            bots.append(bot)
        }
        state = .loaded
    }

    // MARK: Orbis

    // Gibt die neue Orbi-ID und die Id des Direktchats zurück; Fehler als ServiceError mit deutschem Text.
    func create(_ form: ServiceClient.BotForm) async throws -> ServiceClient.Created {
        let created = try await client.createBot(form)
        if let chatId = created.chatId {
            applySavedBot(Bot(chatId: chatId, id: created.id, name: form.name, avatar: form.avatar, color: form.color,
                              job: form.job, instructions: form.instructions, isMain: form.isMain, look: form.look,
                              lastMessageAt: .now, onboardingDone: false))
        }
        await load(silent: true)
        return created
    }

    func update(id: String, _ form: ServiceClient.BotForm) async throws {
        try await client.updateBot(id: id, form)
        if let old = bot(id: id) {
            applySavedBot(Bot(chatId: old.chatId, id: id, name: form.name, avatar: form.avatar, color: form.color,
                              job: form.job, instructions: form.instructions, isMain: form.isMain, look: form.look,
                              lastMessageAt: old.lastMessageAt, onboardingDone: old.onboardingDone))
        }
        await load(silent: true)
    }

    // MARK: Gruppen

    func createGroup(name: String, botIds: [String]) async throws -> String {
        let created = try await client.createGroup(name: name, botIds: botIds)
        groups.append(OrbiGroup(id: created.id, name: name, members: groupMembers(botIds)))
        state = .loaded
        await load(silent: true)
        return created.id
    }

    func updateGroup(id: String, name: String, botIds: [String]) async throws {
        try await client.updateGroup(id: id, name: name, botIds: botIds)
        if let index = groups.firstIndex(where: { $0.id == id }) {
            groups[index] = OrbiGroup(id: id, name: name, members: groupMembers(botIds))
        }
        await load(silent: true)
    }

    private func groupMembers(_ ids: [String]) -> [GroupMember] {
        ids.compactMap { bot(id: $0) }.map { GroupMember(id: $0.id, name: $0.name, avatar: $0.avatar, color: $0.color, look: $0.look) }
    }

    // MARK: Löschen mit Bestätigung

    func requestDelete(_ target: PendingDelete) { pendingDelete = target }
    func cancelDelete() { pendingDelete = nil }

    // Führt das bestätigte Löschen aus (das Ziel wird mitgegeben, weil der Dialog beim Schließen `cancelDelete` aufruft).
    // Gibt das Gelöschte zurück (die Oberfläche räumt Auswahl und Sitzung auf) oder wirft den Dienstfehler.
    @discardableResult
    func confirmDelete(_ explicit: PendingDelete? = nil) async throws -> PendingDelete? {
        guard let target = explicit ?? pendingDelete else { return nil }
        switch target {
        case .bot(let bot): try await client.deleteBot(id: bot.id)
        case .group(let group): try await client.deleteGroup(id: group.id)
        case .clear(let chatId, _, _): try await client.clearMessages(chatId: chatId)
        case .memory(let botId, let name, _): try await client.deleteMemory(botId: botId, name: name)
        }
        pendingDelete = nil
        if case .memory = target { memoryRevision += 1; return target }
        await load(silent: true)
        return target
    }
}
