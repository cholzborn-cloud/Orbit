import SwiftUI

extension ServiceClient {
    func promptPreview(chatId: String) async throws -> PromptPreview {
        try await get("/v1/chats/\(chatId)/prompt-preview")
    }
}

@MainActor @Observable
final class PromptPreviewModel {
    struct Target: Identifiable, Hashable { let id: String; let name: String }
    private(set) var targets: [Target] = []
    var chatId = ""
    private(set) var preview: Load<PromptPreview> = .idle

    // Chats zur Auswahl: Hauptorbi zuerst, dann die Orbis, dann Gruppen.
    func loadTargets(_ client: ServiceClient) async {
        guard let response = try? await client.bots() else { return }
        let bots = ([response.main].compactMap { $0 } + response.bots.filter { !$0.isMain })
        targets = bots.map { Target(id: $0.chatId, name: $0.name) } + response.groups.map { Target(id: $0.id, name: "Gruppe \($0.name)") }
        if chatId.isEmpty || !targets.contains(where: { $0.id == chatId }) { chatId = targets.first?.id ?? "" }
    }

    func load(_ client: ServiceClient) async {
        guard !chatId.isEmpty else { return }
        preview = .loading
        do { preview = .loaded(try await client.promptPreview(chatId: chatId)) } catch {
            let m = SettingsStore.message(error); preview = .failed(m.text, offline: m.offline)
        }
    }
}

// Abschnitt „Erweitert“ unten auf der Seite Allgemein: nur zum Nachsehen, hier wird nichts geändert.
struct PromptPreviewSection: View {
    let store: SettingsStore
    @State private var model = PromptPreviewModel()
    @State private var open: Set<String> = []
    @Environment(\.staticRendering) private var staticRendering

    var body: some View {
        FormSection(title: "Erweitert", footer: "Zeigt, was der gewählte Orbi vor jeder Antwort als Anleitung bekommt, aufgeteilt nach Abschnitten. Hier wird nichts geändert.") {
            FormRow(title: "Was sieht das Modell", symbol: "doc.text.magnifyingglass") {
                HStack(spacing: Theme.Metrics.pt8) {
                    if !model.targets.isEmpty {
                        Picker("Chat", selection: $model.chatId) {
                            ForEach(model.targets) { target in Text(target.name).tag(target.id) }
                        }
                        .labelsHidden().fixedSize()
                    }
                    Button(model.preview.isLoading ? "Lädt …" : (model.preview.value == nil ? "Anzeigen" : "Neu laden")) { Task { await model.load(store.client) } }
                        .buttonStyle(.card(.outline, small: true)).disabled(model.chatId.isEmpty || model.preview.isLoading)
                }
            }
            switch model.preview {
            case .failed(let message, let offline): FormFailureRow(message: message, offline: offline) { Task { await model.load(store.client) } }
            case .loaded(let preview): ForEach(preview.shown) { section in sectionRow(section) }
            default: EmptyView()
            }
        }
        .onChange(of: model.chatId) { old, _ in if !old.isEmpty, model.preview.value != nil { open = []; Task { await model.load(store.client) } } }
        .task { if !staticRendering, model.targets.isEmpty { await model.loadTargets(store.client) } }
    }

    // Zugeklappt nur Titel und Länge; aufgeklappt der Text in Mono, auswählbar, mit eigener Höhe (lange Texte bremsen sonst die Seite).
    @ViewBuilder private func sectionRow(_ section: PromptPreview.Section) -> some View {
        let isOpen = open.contains(section.id)
        FormRow(title: section.title, detail: "\(Self.layerName(section.layer)) · \(SettingsOrbisPage.number(section.content.count)) Zeichen") {
            Button(isOpen ? "Zuklappen" : "Ansehen") { if isOpen { open.remove(section.id) } else { open.insert(section.id) } }
                .buttonStyle(.card(.ghost, small: true)).disabled(section.content.isEmpty)
        }
        if isOpen {
            FormBlock {
                ScrollView {
                    Text(section.content).font(Theme.Fonts.mono(Theme.Fonts.size12)).foregroundStyle(Theme.Palette.foreground)
                        .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxHeight: Theme.Metrics.pt360)
            }
        }
    }

    private static func layerName(_ layer: String?) -> String {
        switch layer {
        case "stable": "Fest"
        case "tools": "Werkzeuge"
        case "volatile": "Je Antwort"
        default: "Abschnitt"
        }
    }
}
