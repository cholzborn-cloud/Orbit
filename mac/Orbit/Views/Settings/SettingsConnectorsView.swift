import SwiftUI

// Reiter „Konnektoren“ (connectors-section.tsx, connector-edit-dialog.tsx): MCP-Server hinzufügen, testen, für Orbis freigeben,
// anmelden (OAuth über den Systembrowser, Rücksprung /oauth/callback) oder mit Schlüssel verbinden.
struct SettingsConnectorsView: View {
    let store: SettingsStore
    @Environment(\.settingsConfirm) private var confirm
    @State private var form = ConnectorForm(name: "", url: "", token: "")
    @State private var addError: String?
    @State private var hovered: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
                SettingsTitle(text: "Konnektoren")
                SettingsHint(text: "MCP-Server für alle Orbis. Schreibende Tools sind gekennzeichnet.")
            }
            if let error = store.connectorsError { Text(error).font(Theme.Fonts.body).foregroundStyle(Theme.Palette.destructive).fixedSize(horizontal: false, vertical: true) }
            switch store.connectors {
            case .idle, .loading:
                VStack(spacing: Theme.Metrics.pt8) { ForEach(0..<2, id: \.self) { _ in SettingsSkeleton(height: Theme.Metrics.pt56, radius: Theme.Radius.lg) } }
                    .accessibilityElement(children: .ignore).accessibilityLabel("Konnektoren werden geladen")
            case .failed(let message, let offline):
                SettingsFailure(message: message, offline: offline) { Task { await store.loadConnectors() } }
            case .loaded(let connectors):
                if !connectors.isEmpty { allRow(connectors) }
                if connectors.isEmpty { SettingsHint(text: "Noch keine Konnektoren.") }
                LazyVStack(spacing: Theme.Metrics.pt8) { ForEach(connectors) { row($0) } }
            }
            if store.connectorFormOpen { addForm } else {
                Button("Konnektor hinzufügen") { addError = nil; store.connectorFormOpen = true }.buttonStyle(.card(.outline))
            }
        }
    }

    // Box-Zeile (Figma 50:19016): 40 hoch, innen 0/12, Name 12.
    private func allRow(_ connectors: [ConnectorItem]) -> some View {
        HStack {
            Text("Alle Konnektoren").font(Theme.Fonts.small)
            Spacer()
            Toggle("Alle Konnektoren", isOn: Binding(get: { connectors.allSatisfy(\.enabled) }, set: { on in Task { await store.setAllEnabled(on) } }))
                .toggleStyle(WebSwitchStyle()).labelsHidden()
        }
        .padding(.horizontal, Theme.Metrics.pt12).frame(minHeight: Theme.Metrics.pt40)
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }

    private func row(_ connector: ConnectorItem) -> some View {
        let state = store.connectorStatus[connector.id]
        return VStack(spacing: Theme.Metrics.pt0) {
            HStack(spacing: Theme.Metrics.pt10) {
                HStack(spacing: Theme.Metrics.pt8) {
                    Text(connector.name).font(Theme.Fonts.small).lineLimit(1)
                    Text(connector.host + (connector.oauth ? " · Angemeldet" : connector.hasAuth ? " · Token hinterlegt" : ""))
                        .font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground).lineLimit(1)
                    switch state {
                    case .ok(let count, _): ConnectorTag(text: "\(count) Tools", dot: Theme.Palette.statusInfo)
                    case .error: ConnectorTag(text: "Fehler", dot: Theme.Palette.destructive)
                    case .testing: ConnectorTag(text: "Test läuft …", dot: nil)
                    case nil: EmptyView()
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                WebMenuButton(alignment: .trailing, screenName: "menu-konnektor", items: {
                    [WebMenuItem(title: "Testen", icon: "arrow.clockwise") { Task { await store.test(connector.id) } },
                     WebMenuItem(title: "Bearbeiten", icon: "pencil") { store.editingConnector = connector.id },
                     WebMenuItem(title: "Löschen", icon: "trash", destructive: true) {
                         confirm?(SettingsConfirm(title: "Konnektor löschen?", message: "Konnektor „\(connector.name)“ löschen?", action: "Löschen") {
                             if let error = await store.deleteConnector(connector.id) { store.connectorsError = error }
                         })
                     }]
                }) { open in
                    // ⋯ nur bei Hover (24), solange das Menü offen ist auch ohne.
                    Image(systemName: "ellipsis").font(.system(size: Theme.Metrics.pt14)).frame(width: Theme.Metrics.pt24, height: Theme.Metrics.pt24)
                        .background(open ? Theme.Palette.muted : .clear, in: .rect(cornerRadius: Theme.Radius.md)).contentShape(.rect)
                        .opacity(open || hovered == connector.id ? 1 : 0)
                }
                .accessibilityLabel("\(connector.name): Aktionen")
                Toggle("\(connector.name) aktiv", isOn: Binding(get: { connector.enabled }, set: { on in Task { await store.setEnabled(connector.id, on) } }))
                    .toggleStyle(WebSwitchStyle()).labelsHidden()
            }
            .padding(.horizontal, Theme.Metrics.pt12).frame(minHeight: Theme.Metrics.pt40)
            if case .error(let text) = state {
                Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt1)
                if ConnectorRules.needsLogin(text) {
                    HStack(spacing: Theme.Metrics.pt8) {
                        Text("Dieser Server verlangt eine Anmeldung.").font(Theme.Fonts.body).frame(maxWidth: .infinity, alignment: .leading)
                        Button("Anmelden") {
                            Task { if let error = await store.signIn(connector.id) { store.connectorsError = error; store.editingConnector = connector.id } }
                        }
                        .buttonStyle(.card(.primary, small: true))
                    }
                    .padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt8)
                } else {
                    Text(text).font(Theme.Fonts.body).foregroundStyle(Theme.Palette.destructive).fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, Theme.Metrics.pt12).padding(.vertical, Theme.Metrics.pt8)
                }
            }
        }
        .background(Theme.Palette.card, in: .rect(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
        .onHover { inside in hovered = inside ? connector.id : (hovered == connector.id ? nil : hovered) }
    }

    private var addForm: some View {
        SettingsBox {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt12) {
                Text("Konnektor hinzufügen").font(Theme.Fonts.bodyMedium)
                HStack(alignment: .top, spacing: Theme.Metrics.pt12) {
                    DialogField("Name") { TextField("", text: $form.name, prompt: Text(verbatim: "optional")).webInput().accessibilityLabel("Name") }
                    DialogField("HTTPS-URL") { TextField("", text: $form.url, prompt: Text(verbatim: "https://server.example/mcp")).webInput().accessibilityLabel("HTTPS-URL") }
                }
                DialogField("API-Token (optional)") {
                    SecureField("Nur nötig, wenn der Server einen Token verlangt", text: Binding(get: { form.token ?? "" }, set: { form.token = $0 })).webInput()
                        .accessibilityLabel("API-Token")
                }
                if let addError { Text(addError).font(Theme.Fonts.body).foregroundStyle(Theme.Palette.destructive).fixedSize(horizontal: false, vertical: true) }
                HStack(spacing: Theme.Metrics.pt8) {
                    Button("Hinzufügen") { add() }.buttonStyle(.card(.primary))
                    Button("Abbrechen") { store.connectorFormOpen = false }.buttonStyle(.card(.ghost))
                }
            }
        }
    }

    private func add() {
        addError = nil
        var request = form
        request.name = form.name.trimmingCharacters(in: .whitespaces)
        if request.name.isEmpty { request.name = URL(string: form.url)?.host?.replacingOccurrences(of: "www.", with: "") ?? form.url }
        if request.token?.isEmpty == true { request.token = nil }
        Task {
            if let error = await store.addConnector(request) { addError = error } else {
                form = ConnectorForm(name: "", url: "", token: ""); store.connectorFormOpen = false
            }
        }
    }
}

// Tag mit Punkt (Figma 50:19042): 20 hoch, r999, secondary, innen 0/8, Abstand 5, Punkt 6, Text 11 Regular.
private struct ConnectorTag: View {
    let text: String
    let dot: Color?
    var body: some View {
        HStack(spacing: Theme.Metrics.pt5) {
            if let dot { Circle().fill(dot).frame(width: Theme.Metrics.pt6, height: Theme.Metrics.pt6) }
            Text(text).font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.foreground).lineLimit(1)
        }
        .padding(.horizontal, Theme.Metrics.pt8).frame(height: Theme.Metrics.pt20)
        .background(Theme.Palette.secondary, in: .capsule)
    }
}

// Bearbeiten-Dialog eines Konnektors: Status, Anmelden/Abmelden, Schlüssel, Löschen.
struct ConnectorEditView: View {
    let store: SettingsStore
    let connector: ConnectorItem
    let onClose: () -> Void
    @Environment(\.settingsConfirm) private var confirm
    @State private var key = ""
    @State private var header = ""
    @State private var showKey = false
    @State private var error: String?

    var body: some View {
        let status = store.connectorStatus[connector.id]
        let login: Bool = { if case .error(let text) = status { ConnectorRules.needsLogin(text) } else { false } }()
        DialogShell(title: connector.name, description: connector.url, width: Theme.Metrics.pt448, height: Theme.Metrics.pt420, onClose: onClose, content: {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt16) {
                if case .ok(_, let tools) = status { SettingsHint(text: "Verbunden. \(tools.isEmpty ? "Keine Tools." : tools)") }
                if case .error(let text) = status, !login { Text(text).font(Theme.Fonts.body).foregroundStyle(Theme.Palette.destructive).fixedSize(horizontal: false, vertical: true) }
                if login && !connector.oauth {
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
                        Text("Dieser Server verlangt eine Anmeldung.").font(Theme.Fonts.body)
                        Button("Anmelden") {
                            Task {
                                if let message = await store.signIn(connector.id) { showKey = true; error = "\(message) Gib stattdessen einen Schlüssel ein." } else { error = nil }
                            }
                        }
                        .buttonStyle(.card(.primary))
                    }
                    .padding(Theme.Metrics.pt12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.Palette.muted.opacity(0.5), in: .rect(cornerRadius: Theme.Radius.lg))
                }
                if connector.oauth {
                    HStack {
                        Text("Angemeldet").font(Theme.Fonts.body).foregroundStyle(Theme.Palette.mutedForeground)
                        Spacer()
                        Button("Abmelden") { Task { error = await store.signOut(connector.id) } }.buttonStyle(.card(.ghost, small: true))
                    }
                }
                if let error { Text(error).font(Theme.Fonts.body).foregroundStyle(Theme.Palette.destructive).fixedSize(horizontal: false, vertical: true) }
                if showKey || connector.hasAuth {
                    VStack(alignment: .leading, spacing: Theme.Metrics.pt8) {
                        DialogField("Schlüssel") {
                            SecureField(connector.hasAuth ? "Gespeichert. Neuer Wert ersetzt, leer löscht." : "Schlüssel einfügen", text: $key).webInput()
                        }
                        DialogField("Header-Name (leer = Bearer-Token)") { TextField("", text: $header, prompt: Text(verbatim: "x-api-key")).webInput() }
                        Button("Speichern und testen") {
                            Task { error = await store.saveAuth(connector.id, token: key, header: header.isEmpty ? nil : header); if error == nil { key = "" } }
                        }
                        .buttonStyle(.card(.primary, small: true))
                    }
                }
                HStack {
                    if !showKey && !connector.hasAuth { Button("Stattdessen Schlüssel nutzen") { showKey = true }.buttonStyle(.card(.ghost, small: true)) }
                    Spacer()
                    Button("Löschen") {
                        confirm?(SettingsConfirm(title: "Konnektor löschen?", message: "Konnektor „\(connector.name)“ löschen?", action: "Löschen") {
                            if let message = await store.deleteConnector(connector.id) { error = message } else { onClose() }
                        })
                    }
                    .buttonStyle(.card(.ghost, small: true)).foregroundStyle(Theme.Palette.destructive)
                }
                .padding(.top, Theme.Metrics.pt8).overlay(alignment: .top) { Rectangle().fill(Theme.Palette.border).frame(height: Theme.Metrics.pt1) }
            }
        }, footer: { Button("Fertig", action: onClose).buttonStyle(.card(.outline)) })
        .onAppear { header = connector.authHeader ?? "" }
    }
}
