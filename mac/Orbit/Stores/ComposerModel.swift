import AppKit
import Foundation
import Observation

// Zustand des Composers eines Chats (Web: ChatBody in chat.tsx): Modell und Stufe, Freigabemodus, Kontext, Slash-Skill, Anhänge.
// Modell, Stufen und Modus merkt sich der Chat wie im Web (`orbit-chat-prefs:<chatId>`); ein Chat gehört einem Orbi oder einer Gruppe.
@MainActor @Observable
final class ComposerModel {
    enum CatalogState: Equatable { case idle, loading, loaded, failed(String) }

    let chatId: String
    private let client: ServiceClient

    // Modelle: leere Liste, wenn keine CLI verfügbar ist. Auto (Jev) gibt es immer.
    private(set) var catalog: CatalogState = .idle
    private(set) var models: [ModelInfo] = []
    private(set) var modelsAvailable = true

    var modelId: String { didSet { if oldValue != modelId { remember() } } }
    var standardModelId: String
    // Consti hat in der Modellauswahl dieses Chats ausdrücklich ein Modell gewählt (nicht der Standard, nicht Auto): geht als `modelPinned` mit.
    private(set) var modelPinned: Bool
    var efforts: [String: String] { didSet { remember() } }
    // Kontext an: ganzer Verlauf geht mit. Aus: nur die neue Nachricht.
    var context = true

    // Slash-Menü.
    private(set) var skills: [SlashSkill] = []
    private(set) var skillsLoaded = false
    private(set) var brainOffline = false
    private(set) var skillsError: String?
    var slashIndex = 0
    var skill: SlashSkill?
    var skillError: String?

    // Anhänge.
    private(set) var attachments: [Attachment] = []
    private(set) var attachError: String?
    private var attachErrorTask: Task<Void, Never>?

    private let defaults: UserDefaults
    private var key: String { "orbit-chat-prefs:\(chatId)" }

    // Test-Kopien schreiben nie in die Einstellungen der echten App.
    static var preferences: UserDefaults {
        UserDefaults(suiteName: TestDatabase.isTestCopy ? "de.consti.orbit2.prefs.test" : "de.consti.orbit2.prefs") ?? .standard
    }

    init(chatId: String, client: ServiceClient, defaults: UserDefaults = ComposerModel.preferences) {
        self.chatId = chatId
        self.client = client
        self.defaults = defaults
        let saved = (defaults.data(forKey: "orbit-chat-prefs:\(chatId)")).flatMap { try? JSONDecoder().decode(Saved.self, from: $0) }
        modelId = saved?.modelId ?? ""
        standardModelId = saved?.standardModelId ?? saved?.modelId ?? ""
        efforts = saved?.efforts ?? [:]
        modelPinned = saved?.pinned ?? false
    }

    // Alte Einträge mit dem früheren Schlüssel approvalMode werden beim Lesen ignoriert (Decoder kennt ihn nicht) und beim nächsten Speichern weggelassen.
    private struct Saved: Codable {
        var modelId: String?
        var standardModelId: String?
        var efforts: [String: String]?
        var pinned: Bool?
    }

    private func remember() {
        let saved = Saved(modelId: modelId, standardModelId: standardModelId, efforts: efforts, pinned: modelPinned)
        if let data = try? JSONEncoder().encode(saved) { defaults.set(data, forKey: key) }
    }

    // MARK: Modell

    var isAuto: Bool { modelId == ModelInfo.autoId }
    // Ohne Katalog (Tests, bevor die Liste da ist) gilt ein gesetztes Modell, sonst der Standard der Sitzung.
    var effectiveModelId: String { modelId.isEmpty ? (standardModelId.isEmpty ? ChatSession.Defaults.model : standardModelId) : modelId }
    var selectedModel: ModelInfo? { models.first { $0.id == modelId } }
    // Gesendet wird, sobald ein Modell feststeht: gewählt (Katalog) oder Auto.
    var canSend: Bool { isAuto || selectedModel != nil || (catalog == .idle && !effectiveModelId.isEmpty) }

    // Wert für `clientData.modelPinned`; nil = nicht senden.
    var pinnedForSend: Bool? { ModelPin.clientValue(pinned: modelPinned, isAuto: isAuto) }

    // Stufe des gewählten Modells; bei Auto keine (Jev wählt).
    var effort: String? {
        get {
            if isAuto { return nil }
            guard let model = selectedModel else { return efforts[effectiveModelId] ?? ChatSession.Defaults.effort }
            return efforts[model.id].flatMap { model.efforts.contains($0) ? $0 : nil } ?? model.defaultEffort
        }
        set { if let newValue { efforts[effectiveModelId] = newValue } }
    }

    func select(model id: String) {
        modelPinned = id != ModelInfo.autoId
        modelId = id
        if models.contains(where: { $0.id == id }) { standardModelId = id; remember() }
    }

    func setEffort(_ effort: String) {
        guard let model = selectedModel, model.efforts.contains(effort) else { return }
        efforts[model.id] = effort
    }

    // Aktives Modell als Text für den Auslöser: „Jev“ oder das Modell; Stufe daneben.
    var modelTitle: String {
        if isAuto { return "Jev" }
        if let model = selectedModel { return model.label }
        switch catalog {
        case .idle, .loading: return "Modelle laden …"
        default: return "Kein Modell verfügbar"
        }
    }

    // Lädt verfügbare Modelle. Fehler bleiben als Text sichtbar, nie still.
    func loadCatalog() async {
        guard catalog != .loading, !simulated else { return }
        catalog = .loading
        do {
            let response: ModelsResponse = try await client.get("/v1/models")
            models = response.models
            modelsAvailable = response.modelsAvailable
            reconcile()
            catalog = .loaded
        } catch {
            catalog = .failed(error.localizedDescription)
        }
    }

    // Wie im Web: ein gemerktes Modell, das es nicht mehr gibt, fällt auf das Standardmodell, sonst auf das erste.
    private func reconcile() {
        guard !isAuto else { return }
        if models.contains(where: { $0.id == modelId }) { return }
        // Das gewählte Modell gibt es nicht mehr: Ersatz ist keine ausdrückliche Wahl.
        modelPinned = false
        if let standard = models.first(where: { $0.id == standardModelId }) ?? models.first { modelId = standard.id }
        else if !modelId.isEmpty { modelId = "" }
    }

    // Nur für Screenshot-Szenen: Sonderzustände ohne die Dienste anzufassen.
    private var simulated = false
    func simulate(catalog: CatalogState, models: [ModelInfo]? = nil, modelsAvailable: Bool = true) {
        simulated = true
        self.catalog = catalog
        if let models { self.models = models }
        self.modelsAvailable = modelsAvailable
        if models?.isEmpty == true, !isAuto { modelId = "" }
    }

    // MARK: Slash-Menü

    func loadSkills() async {
        guard !skillsLoaded else { return }
        do {
            let response: SlashSkillsResponse = try await client.get("/v1/skills/slash")
            skills = response.skills
            brainOffline = response.brainOffline
            skillsLoaded = true
            skillsError = nil
        } catch {
            skillsError = "Skills konnten nicht geladen werden."
        }
    }

    func reloadSkills() async { skillsLoaded = false; await loadSkills() }

    func filteredSkills(for draft: String) -> [SlashSkill] {
        guard let query = SlashMenuLogic.query(in: draft) else { return [] }
        return SlashMenuLogic.filter(skills, query: query)
    }

    // Wählt einen Skill. Brain-Skills werden vorher geprüft (Web: getBrainSkill), ein Fehler bleibt als Zeile über dem Feld stehen.
    func choose(_ skill: SlashSkill) async -> Bool {
        skillError = nil
        if skill.source == "brain" {
            do { _ = try await client.get("/v1/skills/brain/\(skill.name)", as: BrainSkillResponse.self) }
            catch {
                skillError = (error as? ServiceError).map { $0.localizedDescription } ?? "Brain-Skill konnte nicht geladen werden."
                return false
            }
        }
        self.skill = skill
        return true
    }

    // MARK: Anhänge

    func showAttachError(_ text: String) {
        attachError = text
        attachErrorTask?.cancel()
        attachErrorTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { self?.attachError = nil }
        }
    }

    func add(data: Data, filename: String, mediaType: String) {
        guard attachments.count < AttachmentRules.maxFiles else { showAttachError(AttachmentRules.Failure.tooMany.text); return }
        switch AttachmentRules.prepare(data: data, filename: filename, mediaType: mediaType) {
        case .success(let attachment): attachments.append(attachment)
        case .failure(let failure): showAttachError(failure.text)
        }
    }

    func add(urls: [URL]) {
        // Mehr als erlaubt: der Rest wird abgelehnt, die ersten passen (Web: slice auf die freie Zahl).
        let room = max(0, AttachmentRules.maxFiles - attachments.count)
        if urls.count > room { showAttachError(AttachmentRules.Failure.tooMany.text) }
        for url in urls.prefix(room) {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            if let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > AttachmentRules.maxAddBytes {
                showAttachError(AttachmentRules.Failure.tooBig(name: url.lastPathComponent).text); continue
            }
            guard let data = try? Data(contentsOf: url) else {
                showAttachError(AttachmentRules.Failure.unreadable(name: url.lastPathComponent).text); continue
            }
            add(data: data, filename: url.lastPathComponent, mediaType: AttachmentRules.mediaType(for: url))
        }
    }

    // Abgelegte Dateien (Web: globalDrop): Finder-Dateien kommen als Datei-URLs.
    func addDropped(_ providers: [NSItemProvider]) -> Bool {
        let found = providers.filter { $0.hasItemConformingToTypeIdentifier("public.file-url") }
        guard !found.isEmpty else { return false }
        Task { @MainActor in
            var urls: [URL] = []
            for provider in found {
                let url: URL? = await withCheckedContinuation { continuation in
                    _ = provider.loadObject(ofClass: URL.self) { url, _ in continuation.resume(returning: url) }
                }
                if let url { urls.append(url) }
            }
            add(urls: urls)
        }
        return true
    }

    func removeAttachment(_ id: UUID) { attachments.removeAll { $0.id == id } }

    // Nach dem Senden: Anhänge und Skill sind verbraucht; bei einem Fehler vor dem Senden bleibt alles stehen.
    func consume() { attachments = []; skill = nil; skillError = nil }
}
