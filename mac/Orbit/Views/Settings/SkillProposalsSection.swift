import SwiftUI

// Skill-Vorschläge des Träumers (GET /v1/skills/proposals, POST …/:id/accept | …/:id/reject in service/src/mac-open-api.ts).
struct SkillProposal: Decodable, Identifiable, Equatable, Sendable {
    let id: String
    let name: String
    let description: String
    let body: String
    var reason: String?
}

extension ServiceClient {
    func skillProposals() async throws -> [SkillProposal] {
        struct Body: Decodable { let proposals: [SkillProposal] }
        return try await get("/v1/skills/proposals", as: Body.self).proposals
    }
    func decideSkillProposal(id: String, accept: Bool) async throws {
        _ = try await data(for: try request("/v1/skills/proposals/\(id)/\(accept ? "accept" : "reject")", method: "POST"))
    }
}

@MainActor @Observable
final class SkillProposalsModel {
    private(set) var list: Load<[SkillProposal]> = .idle
    private(set) var busy: String?
    var error: String?

    func load(_ client: ServiceClient) async {
        do { list = .loaded(try await client.skillProposals()) } catch {
            let m = SettingsStore.message(error); list = .failed(m.text, offline: m.offline)
        }
    }

    // Annehmen legt den Skill an (danach Skills neu laden), Ablehnen verwirft ihn; beides entfernt den Vorschlag.
    func decide(_ proposal: SkillProposal, accept: Bool, store: SettingsStore) async {
        busy = proposal.id; error = nil
        defer { busy = nil }
        do {
            try await store.client.decideSkillProposal(id: proposal.id, accept: accept)
            if case .loaded(let items) = list { list = .loaded(items.filter { $0.id != proposal.id }) }
            if accept { store.onSkillsChanged?(); await store.loadSkills() }
        } catch { self.error = SettingsStore.message(error).text }
    }
}

// Abschnitt über „Skills“ auf der Orbis-Seite; erscheint nur, wenn es Vorschläge gibt (oder das Laden scheitert).
struct SkillProposalsSection: View {
    let store: SettingsStore
    let model: SkillProposalsModel
    @State private var open: String?
    @Environment(\.staticRendering) private var staticRendering

    var body: some View {
        Group {
            switch model.list {
            case .failed(let message, let offline):
                FormSection(title: "Skill-Vorschläge") { FormFailureRow(message: message, offline: offline) { Task { await model.load(store.client) } } }
            case .loaded(let items) where !items.isEmpty:
                FormSection(title: "Skill-Vorschläge", footer: "Deine Orbis schlagen Skills aus abgeschlossenen Gesprächen vor. Angenommen steht der Skill unten bei den anderen.") {
                    ForEach(items) { item in row(item) }
                }
                if let error = model.error { SettingsAlert(text: error) }
            default: EmptyView()
            }
        }
        .task { if !staticRendering, model.list.value == nil { await model.load(store.client) } }
    }

    @ViewBuilder private func row(_ item: SkillProposal) -> some View {
        let busy = model.busy == item.id
        FormRow(title: "/\(item.name)", detail: [item.description, item.reason.map { "Warum: \($0)" }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: "\n"), symbol: "sparkles") {
            HStack(spacing: Theme.Metrics.pt4) {
                Button(open == item.id ? "Zuklappen" : "Ansehen") { open = open == item.id ? nil : item.id }.buttonStyle(.card(.ghost, small: true))
                Button("Ablehnen") { Task { await model.decide(item, accept: false, store: store) } }.buttonStyle(.card(.outline, small: true)).disabled(model.busy != nil)
                Button(busy ? "Legt an …" : "Annehmen") { Task { await model.decide(item, accept: true, store: store) } }.buttonStyle(.card(.primary, small: true)).disabled(model.busy != nil)
            }
        }
        if open == item.id {
            FormBlock {
                Text(item.body).font(Theme.Fonts.mono(Theme.Fonts.size12)).foregroundStyle(Theme.Palette.foreground)
                    .textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
