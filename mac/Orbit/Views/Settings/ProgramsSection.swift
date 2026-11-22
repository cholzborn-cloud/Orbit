import AppKit
import SwiftUI

// Einstellungen › Allgemein › Programme: Claude Code, Codex, Cursor und Antigravity installieren und anmelden (GET /v1/clis).
// Je Zustand eine Hauptaktion. Der Dienst meldet Fortschritt als Ereignis „cli-setup“; darauf lädt die Liste frisch nach.
extension Notification.Name {
    static let orbitCliSetup = Notification.Name("de.consti.orbit2.cli-setup")
}

struct ProgramItem: Decodable, Equatable, Identifiable {
    enum State: String { case bereit, fehlt, abgemeldet, laeuft, fehler }
    let id: String
    let label: String
    let version: String?
    let installed: Bool?
    let rawState: String
    let busy: String?
    let message: String
    let loginUrl: String?
    let loginCode: String?
    // Unbekannte Werte gelten als Fehler.
    var state: State { State(rawValue: rawState) ?? .fehler }

    enum CodingKeys: String, CodingKey { case id, label, version, installed, busy, message, loginUrl, loginCode, rawState = "state" }
}

private struct ProgramList: Decodable { let clis: [ProgramItem] }
private struct LoginAnswer: Decodable { let url: String?; let code: String? }

extension ServiceClient {
    func programs(fresh: Bool = false) async throws -> [ProgramItem] { try await (get("/v1/clis" + (fresh ? "?fresh=1" : "")) as ProgramList).clis }
    func installProgram(_ id: String) async throws { _ = try await data(for: try request("/v1/clis/\(id)/install", method: "POST")) }
    func cancelProgram(_ id: String) async throws { _ = try await data(for: try request("/v1/clis/\(id)/cancel", method: "POST")) }
    func loginProgram(_ id: String) async throws -> (url: String?, code: String?) {
        let answer = try Self.decoder.decode(LoginAnswer.self, from: try await data(for: try request("/v1/clis/\(id)/login", method: "POST")))
        return (answer.url, answer.code)
    }
}

@MainActor @Observable
final class ProgramsModel {
    private(set) var items: Load<[ProgramItem]> = .idle
    private(set) var unsupported = false  // alter Dienst ohne /v1/clis
    private(set) var error: String?
    private(set) var acting: Set<String> = []

    var anyBusy: Bool { (items.value ?? []).contains { $0.state == .laeuft } }

    func load(_ client: ServiceClient, fresh: Bool = false) async {
        if items.value == nil { items = .loading }
        do { items = .loaded(try await client.programs(fresh: fresh)); unsupported = false } catch ServiceError.server(404, _) {
            unsupported = true
        } catch {
            let m = SettingsStore.message(error); items = .failed(m.text, offline: m.offline)
        }
    }

    func act(_ id: String, client: ServiceClient, _ work: @escaping (ServiceClient) async throws -> Void) async {
        acting.insert(id); error = nil
        do { try await work(client) } catch { self.error = error.localizedDescription }
        acting.remove(id)
        await load(client, fresh: true)
    }

    func login(_ id: String, client: ServiceClient) async {
        await act(id, client: client) { client in
            let answer = try await client.loginProgram(id)
            if let url = answer.url.flatMap(URL.init(string:)) { NSWorkspace.shared.open(url) }
        }
    }
}

struct ProgramsSection: View {
    let store: SettingsStore
    @State private var model = ProgramsModel()
    @Environment(\.staticRendering) private var staticRendering

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Layout.settingsGroupGap) {
            sectionBody
            if let error = model.error { SettingsAlert(text: error) }
        }
        .task {
            guard !staticRendering else { return }
            await model.load(store.client, fresh: true)
            // Reserve, falls ein Ereignis ausbleibt: solange etwas läuft, alle paar Sekunden nachladen.
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(3))
                if model.anyBusy { await model.load(store.client) }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .orbitCliSetup)) { _ in
            if !staticRendering { Task { await model.load(store.client, fresh: true) } }
        }
    }

    private var sectionBody: some View {
        FormSection(title: "Programme", footer: model.unsupported ? nil : "Orbis nutzen diese Programme für Code und Aufgaben. Anmeldungen gehören dir und bleiben auf diesem Mac.") {
            if model.unsupported {
                FormRow(title: "Diese Funktion kommt mit dem neuen Dienst.", symbol: "clock", tint: Theme.Palette.mutedForeground)
            } else {
                switch model.items {
                case .idle, .loading: FormLoadRow()
                case .failed(let message, let offline): FormFailureRow(message: message, offline: offline) { Task { await model.load(store.client) } }
                case .loaded(let items):
                    ForEach(items) { item in row(item) }
                    if items.isEmpty { FormRow(title: "Keine Programme gefunden") }
                }
            }
        }
    }

    @ViewBuilder private func row(_ item: ProgramItem) -> some View {
        let acting = model.acting.contains(item.id)
        VStack(spacing: Theme.Metrics.pt0) {
            FormRow(title: item.label, detail: detail(item), symbol: symbol(item), tint: tint(item)) {
                HStack(spacing: Theme.Metrics.pt8) {
                    switch item.state {
                    case .bereit: FormValue(text: item.version.map { "Version \($0)" } ?? "Bereit")
                    case .fehlt:
                        Button(acting ? "Startet …" : "Installieren") { Task { await model.act(item.id, client: store.client) { try await $0.installProgram(item.id) } } }
                            .buttonStyle(.card(.primary, small: true)).disabled(acting)
                    case .abgemeldet:
                        Button(acting ? "Startet …" : "Anmelden") { Task { await model.login(item.id, client: store.client) } }
                            .buttonStyle(.card(.primary, small: true)).disabled(acting)
                    case .laeuft:
                        Spinner(size: Theme.Metrics.pt14)
                        Button("Abbrechen") { Task { await model.act(item.id, client: store.client) { try await $0.cancelProgram(item.id) } } }
                            .buttonStyle(.card(.outline, small: true)).disabled(acting)
                    case .fehler:
                        Button(acting ? "Startet …" : "Erneut versuchen") {
                            // Schon installiert, nur nicht angemeldet: die Anmeldung starten, sonst die Installation.
                            if item.installed == true { Task { await model.login(item.id, client: store.client) } }
                            else { Task { await model.act(item.id, client: store.client) { try await $0.installProgram(item.id) } } }
                        }
                            .buttonStyle(.card(.outline, small: true)).disabled(acting)
                    }
                }
            }
            if item.state == .laeuft, item.loginCode != nil || item.loginUrl != nil { loginBlock(item) }
        }
        .accessibilityElement(children: .contain)
    }

    // Anmeldecode groß und kopierbar; die Adresse lässt sich erneut öffnen, falls der Browser zu war.
    private func loginBlock(_ item: ProgramItem) -> some View {
        HStack(spacing: Theme.Metrics.pt10) {
            if let code = item.loginCode {
                Text(code).font(.system(.title3, design: .monospaced).weight(.semibold)).textSelection(.enabled).accessibilityLabel("Code \(code)")
                Button("Kopieren") { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(code, forType: .string) }
                    .buttonStyle(.card(.ghost, small: true))
            }
            Spacer(minLength: Theme.Metrics.pt0)
            if let url = item.loginUrl.flatMap(URL.init(string:)) {
                Button("Seite öffnen") { NSWorkspace.shared.open(url) }.buttonStyle(.card(.ghost, small: true))
            }
        }
        .padding(.horizontal, Theme.Metrics.pt12).padding(.bottom, Theme.Metrics.pt10).padding(.leading, Theme.Metrics.pt28)
    }

    private func detail(_ item: ProgramItem) -> String? {
        switch item.state {
        case .bereit: nil
        case .fehlt: item.message.isEmpty ? "Noch nicht auf diesem Mac." : item.message
        case .abgemeldet: item.message.isEmpty ? "Noch nicht angemeldet." : item.message
        case .laeuft: item.message.isEmpty ? "Arbeitet …" : item.message
        case .fehler: item.message.isEmpty ? "Das hat nicht geklappt." : item.message
        }
    }

    private func symbol(_ item: ProgramItem) -> String {
        switch item.state {
        case .bereit: "checkmark.circle.fill"
        case .fehler: "xmark.circle.fill"
        default: "minus.circle"
        }
    }

    private func tint(_ item: ProgramItem) -> Color {
        switch item.state {
        case .bereit: Theme.Status.success
        case .fehler: Theme.Status.danger
        default: Theme.Palette.mutedForeground
        }
    }
}
