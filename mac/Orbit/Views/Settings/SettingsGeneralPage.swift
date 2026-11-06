import SwiftUI

// Bereich „Allgemein“: Orbit selbst (Mitteilungen, Dienst), Einrichtung (je Prüfung Zustand, Abhilfe und Schlüssel erst bei Bedarf)
// „Immer erlaubt“ (gespeicherte Freigaben einsehen und zurücknehmen, E18) und „Erweitert“ (Was sieht das Modell).
struct SettingsGeneralPage: View {
    let store: SettingsStore
    @Environment(\.settingsConfirm) private var confirm
    @State private var entries: [String: String] = [:]
    // Schlüsselfelder klappen nur auf, wenn etwas fehlt oder man „Schlüssel ändern“ wählt.
    @State private var openKeys: Set<String> = []

    private var setup: SetupModel { store.setup }
    private var serviceDown: Bool { if case .failed = setup.checks { true } else { false } }

    var body: some View {
        FormPage(title: "Allgemein") {
            FormSection(title: "Orbit") {
                notificationsRow
                FormRow(title: "Orbit-Dienst", detail: serviceDown ? "Ohne Dienst antworten die Orbis nicht." : nil) { serviceValue }
            }
            FormSection(title: "Einrichtung", footer: setup.needsRestart.isEmpty ? nil : "Neue Schlüssel gelten nach dem nächsten Start von Orbit.") {
                switch setup.checks {
                case .idle, .loading: FormLoadRow(text: "Prüfe die Einrichtung …")
                case .failed(let message, let offline): FormFailureRow(message: message, offline: offline) { Task { await setup.load() } }
                case .loaded:
                    ForEach(setup.rows.filter { $0.id != "notifications" }) { check in checkRow(check) }
                }
                FormRow(title: "Alles erneut prüfen") {
                    Button("Prüfen") { Task { await setup.load() } }.buttonStyle(.card(.outline, small: true)).disabled(setup.checks.isLoading)
                }
            }
            if let error = setup.keyError { SettingsAlert(text: error, symbol: "info.circle") }
            FormSection(title: "Immer erlaubt", footer: "Wählst du bei einer Freigabe „Immer für diese Art“, steht sie hier. Zurückgenommen wird wieder gefragt.") {
                switch store.rules {
                case .idle, .loading: FormLoadRow()
                case .failed(let message, let offline): FormFailureRow(message: message, offline: offline) { Task { await store.loadRules() } }
                case .loaded(let rules):
                    let active = rules.filter(\.isActive)
                    if active.isEmpty { FormRow(title: "Noch nichts immer erlaubt", symbol: "checkmark.shield", tint: Theme.Palette.mutedForeground) }
                    ForEach(active) { rule in ruleRow(rule) }
                }
            }
            if let error = store.rulesError { SettingsAlert(text: error) }
            MacAccessSection(store: store)
            PromptPreviewSection(store: store)
        }
    }

    // Mitteilungen: Zustand des Systems; ausgeschaltet mit Weg in die Systemeinstellungen (Orbit schaltet sie nicht selbst).
    @ViewBuilder private var notificationsRow: some View {
        switch setup.notification {
        case .denied:
            FormRow(title: "Mitteilungen", detail: "Im System ausgeschaltet. Hinweise erscheinen dann nur in Orbit.") {
                Button("Systemeinstellungen") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.Notifications-Settings.extension") { NSWorkspace.shared.open(url) }
                }.buttonStyle(.card(.outline, small: true))
            }
        case .allowed: FormRow(title: "Mitteilungen") { FormValue(text: "Erlaubt", dot: Theme.Status.success) }
        default: FormRow(title: "Mitteilungen") { FormValue(text: "Noch nicht gefragt") }
        }
    }

    @ViewBuilder private var serviceValue: some View {
        switch setup.checks {
        case .loaded: FormValue(text: "Läuft", dot: Theme.Status.success)
        case .failed: FormValue(text: "Nicht erreichbar", dot: Theme.Status.danger)
        default: FormValue(text: "Prüfe …")
        }
    }

    // Eine Prüfung: Zustand als Symbol und Wort (nicht nur Farbe), Abhilfe nur wenn nötig, Schlüssel aufklappbar.
    @ViewBuilder private func checkRow(_ check: HealthCheck) -> some View {
        let open = check.key != nil && (openKeys.contains(check.id) || check.state != .ok)
        VStack(spacing: Theme.Metrics.pt0) {
            FormRow(title: check.label, detail: check.state != .ok ? check.fix : nil, symbol: symbol(check), tint: tint(check)) {
                HStack(spacing: Theme.Metrics.pt8) {
                    FormValue(text: statusText(check))
                    if check.key != nil, check.state == .ok {
                        Button(open ? "Fertig" : "Schlüssel ändern") {
                            if open { openKeys.remove(check.id) } else { openKeys.insert(check.id) }
                        }.buttonStyle(.card(.ghost, small: true))
                    }
                }
            }
            if open, let key = check.key { keyField(key, label: check.label).padding(.horizontal, Theme.Metrics.pt12).padding(.bottom, Theme.Metrics.pt10).padding(.leading, Theme.Metrics.pt28) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(check.label): \(statusText(check))")
    }

    // Schlüssel werden nur geschrieben, nie angezeigt („gesetzt ✓“).
    private func keyField(_ key: String, label: String) -> some View {
        HStack(spacing: Theme.Metrics.pt8) {
            SecureField(setup.isSet(key) ? "Gesetzt. Ein neuer Schlüssel ersetzt ihn." : "Schlüssel einfügen", text: Binding(get: { entries[key] ?? "" }, set: { entries[key] = $0 }))
                .webInput().formField().accessibilityLabel("Schlüssel für \(label)")
            Button(setup.keyBusy == key ? "Setzt …" : "Setzen") {
                let value = entries[key] ?? ""
                Task { if await setup.setKey(key, value: value) { entries[key] = nil } }
            }
            .buttonStyle(.card(.primary, small: true)).disabled(setup.keyBusy != nil || (entries[key] ?? "").isEmpty)
            if setup.isSet(key) { Text("gesetzt ✓").font(Theme.Fonts.small).foregroundStyle(Theme.Status.success).fixedSize() }
        }
    }

    private func ruleRow(_ rule: ApprovalRuleItem) -> some View {
        FormRow(title: rule.kindLabel, detail: [rule.botName ?? "Alle Orbis", rule.mode == "allow" ? nil : rule.modeLabel].compactMap { $0 }.joined(separator: " · ")) {
            Button("Zurücknehmen") {
                confirm?(SettingsConfirm(title: "„\(rule.kindLabel)“ zurücknehmen?", message: "Orbit fragt dann wieder, bevor das passiert.", action: "Zurücknehmen") { await store.deleteRule(rule) })
            }.buttonStyle(.card(.outline, small: true))
        }
        .webTooltip(rule.tool)
    }

    private func statusText(_ check: HealthCheck) -> String {
        switch check.state {
        case .ok: "In Ordnung"
        case .fehlt: check.optional ? "Nicht eingerichtet" : "Fehlt"
        case .fehler: "Geht gerade nicht"
        }
    }

    private func symbol(_ check: HealthCheck) -> String {
        switch check.state {
        case .ok: "checkmark.circle.fill"
        case .fehlt: check.optional ? "minus.circle" : "xmark.circle.fill"
        case .fehler: "xmark.circle.fill"
        }
    }

    private func tint(_ check: HealthCheck) -> Color {
        switch check.state {
        case .ok: Theme.Status.success
        case .fehlt: check.optional ? Theme.Palette.mutedForeground : Theme.Status.danger
        case .fehler: Theme.Status.danger
        }
    }
}

// Tagesbudget (unter „Nutzung“): Jev pro Tag, gleichzeitige Sandboxes und Tokens je Orbi heute.
struct SettingsBudgetSection: View {
    let setup: SetupModel
    let botNames: () -> [String: String]
    @Environment(\.staticRendering) private var staticRendering
    @State private var jevBudget = ""
    @State private var sandboxes = 3

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Layout.settingsGroupGap) {
            FormSection(title: "Tagesbudget", footer: "Abos (Claude, ChatGPT, Gemini) kosten nichts extra. Jev und Daytona schon, das Budget begrenzt sie.") {
                switch setup.budget {
                case .idle, .loading: FormLoadRow()
                case .failed(let message, let offline): FormFailureRow(message: message, offline: offline) { Task { await setup.loadBudget() } }
                case .loaded(let state):
                    FormRow(title: "Jev pro Tag in Dollar", detail: "Heute \(BudgetText.dollars(state.jevSpentUsd)) von \(BudgetText.dollars(state.jevDailyUsd))" + (BudgetText.jevNotice(state).map { ". \($0)" } ?? "")) {
                        HStack(spacing: Theme.Metrics.pt8) {
                            TextField("", text: $jevBudget, prompt: Text(verbatim: "0,50")).webInput().formField().frame(width: Theme.Metrics.pt90).multilineTextAlignment(.trailing)
                                .accessibilityLabel("Jev pro Tag in Dollar")
                            Button("Setzen") {
                                if let value = Double(jevBudget.replacingOccurrences(of: ",", with: ".")) { Task { await setup.saveBudget(jevDailyUsd: value) } }
                                else { setup.budgetError = "Gib eine Zahl ein, zum Beispiel 0,50." }
                            }
                            .buttonStyle(.card(.primary, small: true)).disabled(setup.budgetSaving)
                        }
                    }
                    FormBlock { SettingsProgress(label: "Jev heute", percent: min(state.jevPercent, 100)) }
                    FormRow(title: "Sandboxes gleichzeitig", detail: "Jetzt laufen \(state.sandboxesActive). Ungenutzte stoppen nach 15 Minuten." + (BudgetText.sandboxNotice(state).map { " \($0)" } ?? "")) {
                        HStack(spacing: Theme.Metrics.pt8) {
                            Stepper(value: $sandboxes, in: 1...10) { Text("\(sandboxes)").font(Theme.Fonts.body) }.fixedSize()
                            Button("Setzen") { Task { await setup.saveBudget(maxSandboxes: sandboxes) } }.buttonStyle(.card(.primary, small: true)).disabled(setup.budgetSaving)
                        }
                    }
                }
            }
            if let state = setup.budget.value {
                FormSection(title: "Tokens heute") {
                    if state.tokens.isEmpty { FormRow(title: "Heute noch nichts verbraucht") }
                    let names = botNames()
                    ForEach(state.tokens) { item in
                        FormRow(title: names[item.botId] ?? "Gelöschter Orbi") {
                            FormValue(text: "\(BudgetText.tokens(item.totalTokens)) · \(item.turns) \(item.turns == 1 ? "Antwort" : "Antworten")")
                        }
                    }
                }
            }
            if let error = setup.budgetError { SettingsAlert(text: error) }
        }
        .onChange(of: setup.budget.value) { _, value in if let value { sync(value) } }
        .onAppear { if let value = setup.budget.value { sync(value) } }
        .task { if !staticRendering, setup.budget.value == nil { await setup.loadBudget() } }
    }

    private func sync(_ value: BudgetState) {
        jevBudget = value.jevDailyUsd.formatted(.number.locale(Locale(identifier: "de_DE")).precision(.fractionLength(2)))
        sandboxes = value.maxSandboxes
    }
}
