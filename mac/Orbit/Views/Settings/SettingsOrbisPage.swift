import SwiftUI

// Bereich „Orbis“: gemeinsame Anleitung für alle Orbis, Skill-Vorschläge und eigene Skills (anlegen, bearbeiten, löschen).
struct SettingsOrbisPage: View {
    let store: SettingsStore
    @Environment(\.settingsConfirm) private var confirm
    @State private var text = ""
    @State private var editing: SkillItem?
    @State private var proposals = SkillProposalsModel()

    var body: some View {
        FormPage(title: "Orbis") {
            FormSection(title: "Anleitung für alle Orbis", footer: "Gilt für jeden Orbi, zusätzlich zu seiner eigenen Aufgabe.") {
                switch store.instructions {
                case .idle, .loading: FormLoadRow()
                case .failed(let message, let offline): FormFailureRow(message: message, offline: offline) { Task { await store.loadInstructions() } }
                case .loaded(let state): FormBlock { instructions(state) }
                }
            }
            if let error = store.instructionsError { SettingsAlert(text: error) }
            SkillProposalsSection(store: store, model: proposals)
            FormSection(title: "Skills", footer: "Skills aus dem Brain erscheinen im Slash-Menü, sobald der Dienst läuft.") {
                switch store.skills {
                case .idle, .loading: FormLoadRow()
                case .failed(let message, let offline): FormFailureRow(message: message, offline: offline) { Task { await store.loadSkills() } }
                case .loaded(let skills):
                    let visible = skills.filter { !OrbitBuiltIns.isHiddenSkill(name: $0.name) }
                    if visible.isEmpty { FormRow(title: "Noch keine eigenen Skills", detail: "Ein Skill ist eine feste Anleitung, die jeder Orbi mit /name abrufen kann.") }
                    ForEach(visible) { skill in skillRow(skill) }
                }
                FormRow(title: "Neuer Skill", symbol: "plus") {
                    Button("Anlegen") { editing = nil; store.skillFormOpen = true }.buttonStyle(.card(.outline, small: true))
                }
            }
            if let error = store.skillsError { SettingsAlert(text: error) }
            if store.skillFormOpen || editing != nil {
                FormSection(title: editing == nil ? "Neuer Skill" : "Skill bearbeiten") {
                    FormBlock {
                        SkillFormView(store: store, initial: editing.map { SkillForm(name: $0.name, description: $0.description, body: $0.body) }, skillId: editing?.id,
                                      onSaved: { store.skillFormOpen = false; editing = nil }, onCancel: { store.skillFormOpen = false; editing = nil })
                            .id(editing?.id ?? "new")
                    }
                }
            }
        }
        .onChange(of: store.instructions.value?.saved, initial: true) { _, _ in seed() }
        .onChange(of: store.instructions.value != nil) { _, _ in seed() }
    }

    private func seed() {
        guard let state = store.instructions.value else { return }
        text = state.saved ?? state.defaultText
    }

    // Editor mit Speichern und Zurücksetzen; Zähler erst nahe der Grenze (ab 90 %).
    @ViewBuilder private func instructions(_ state: SettingsStore.InstructionsState) -> some View {
        let current = state.saved ?? state.defaultText
        let tooLong = text.count > state.limit
        let busy = store.instructionsSaving
        SettingsTextArea(text: $text, minHeight: Theme.Metrics.pt190, label: "Anleitung für alle Orbis").disabled(busy)
        HStack(spacing: Theme.Metrics.pt8) {
            if text.count * 10 >= state.limit * 9 {
                Text("\(Self.number(text.count)) / \(Self.number(state.limit)) Zeichen").font(Theme.Fonts.small)
                    .foregroundStyle(tooLong ? Theme.Palette.destructive : Theme.Palette.mutedForeground)
            }
            Spacer(minLength: Theme.Metrics.pt0)
            Button("Standard") { Task { await store.saveInstructions(nil) } }
                .buttonStyle(.card(.ghost, small: true)).disabled(busy || state.saved == nil)
                .help("Auf die mitgelieferte Anleitung zurücksetzen")
            Button(busy ? "Speichert …" : "Speichern") { Task { await store.saveInstructions(text == state.defaultText ? nil : text) } }
                .buttonStyle(.card(.primary, small: true)).disabled(busy || tooLong || text == current)
        }
        if tooLong { Text("Zu lang. Kürze die Anleitung vor dem Speichern.").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.destructive) }
    }

    private func skillRow(_ skill: SkillItem) -> some View {
        FormRow(title: "/\(skill.name)", detail: skill.description) {
            HStack(spacing: Theme.Metrics.pt4) {
                Button("Bearbeiten") { store.skillFormOpen = false; editing = skill }.buttonStyle(.card(.ghost, small: true))
                Button { confirm?(SettingsConfirm(title: "Skill „/\(skill.name)“ löschen?", message: "Er wird für alle Orbis entfernt.", action: "Löschen") { await store.deleteSkill(skill) }) } label: {
                    Image(systemName: "trash")
                }
                .buttonStyle(.card(.ghost, small: true)).accessibilityLabel("/\(skill.name) löschen")
            }
        }
    }

    static func number(_ value: Int) -> String {
        let f = NumberFormatter(); f.locale = Locale(identifier: "de_DE"); f.numberStyle = .decimal
        return f.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}
