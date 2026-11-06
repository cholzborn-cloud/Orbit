import AppKit
import SwiftUI

// Einstellungen › Allgemein › Mac-Zugriff: Orbis arbeiten lokal am Mac (Shell, Dateien, Apps, Bildschirm, Maus/Tastatur,
// Kalender, Erinnerungen, Kontakte, Notizen, Browser). Schalter plus Status der macOS-Rechte (TCC) des Dienstes,
// je Recht „Anfragen“ (löst den macOS-Dialog aus) oder „Systemeinstellungen“.
extension ServiceClient {
    func macAccess() async throws -> MacAccess { try await get("/v1/mac/access") }
    func setMacAccess(_ enabled: Bool) async throws {
        struct Body: Encodable { let enabled: Bool }
        _ = try await data(for: try request("/v1/mac/access", method: "POST", body: try JSONEncoder().encode(Body(enabled: enabled))))
    }
    func requestMacPermission(_ id: String) async throws {
        struct Body: Encodable { let id: String }
        _ = try await data(for: try request("/v1/mac/permissions/request", method: "POST", body: try JSONEncoder().encode(Body(id: id))))
    }
}

@MainActor @Observable
final class MacAccessModel {
    private(set) var access: Load<MacAccess> = .idle
    private(set) var busy: Set<String> = []

    func load(_ client: ServiceClient) async {
        if access.value == nil { access = .loading }
        do { access = .loaded(try await client.macAccess()) } catch {
            let m = SettingsStore.message(error); access = .failed(m.text, offline: m.offline)
        }
    }

    func setEnabled(_ enabled: Bool, client: ServiceClient) async {
        try? await client.setMacAccess(enabled)
        await load(client)
    }

    func request(_ id: String, client: ServiceClient) async {
        busy.insert(id)
        try? await client.requestMacPermission(id)
        busy.remove(id)
        await load(client)
    }
}

struct MacAccessSection: View {
    let store: SettingsStore
    @State private var model = MacAccessModel()
    @Environment(\.staticRendering) private var staticRendering

    var body: some View {
        FormSection(title: "Mac-Zugriff", footer: "Orbis arbeiten direkt an deinem Mac. Löschen landet immer im Papierkorb. Gefragt wird nur vor Geld ausgeben, Veröffentlichen, Nachrichten in deinem Namen und endgültigem Löschen.") {
            switch model.access {
            case .idle, .loading: FormLoadRow()
            case .failed(let message, let offline): FormFailureRow(message: message, offline: offline) { Task { await model.load(store.client) } }
            case .loaded(let access):
                FormRow(title: "Orbis dürfen am Mac arbeiten", symbol: "macbook") {
                    Toggle("Orbis dürfen am Mac arbeiten", isOn: Binding(get: { access.enabled }, set: { on in Task { await model.setEnabled(on, client: store.client) } }))
                        .toggleStyle(WebSwitchStyle()).labelsHidden()
                }
                ForEach(access.permissions) { permission in row(permission) }
                FormRow(title: "Status neu prüfen") {
                    Button("Prüfen") { Task { await model.load(store.client) } }.buttonStyle(.card(.outline, small: true))
                }
            }
        }
        .task { if !staticRendering { await model.load(store.client) } }
    }

    @ViewBuilder private func row(_ permission: MacAccess.Permission) -> some View {
        FormRow(title: permission.label, detail: permission.detail) {
            HStack(spacing: Theme.Metrics.pt8) {
                FormValue(text: MacPermissionText.value(permission.status), dot: dot(permission.status))
                if MacPermissionText.canRequest(permission) {
                    Button(model.busy.contains(permission.id) ? "Fragt …" : "Anfragen") { Task { await model.request(permission.id, client: store.client) } }
                        .buttonStyle(.card(.outline, small: true)).disabled(model.busy.contains(permission.id))
                }
                if permission.status != "granted" {
                    Button("Systemeinstellungen") { if let url = URL(string: permission.settingsUrl) { NSWorkspace.shared.open(url) } }
                        .buttonStyle(.card(.ghost, small: true))
                }
            }
        }
    }

    private func dot(_ status: String) -> Color? {
        switch status {
        case "granted": Theme.Status.success
        case "missing": Theme.Status.danger
        default: nil
        }
    }
}
