import SwiftUI

// Formular für Neu und Bearbeiten; auch der Dialog „/skill neu <name>“ im Chat nutzt es.
struct SkillFormView: View {
    let store: SettingsStore
    let initial: SkillForm?
    var skillId: String?
    let onSaved: () -> Void
    let onCancel: () -> Void
    @State private var form: SkillForm
    @State private var error: String?
    @State private var busy = false

    init(store: SettingsStore, initial: SkillForm?, skillId: String? = nil, onSaved: @escaping () -> Void, onCancel: @escaping () -> Void) {
        self.store = store; self.initial = initial; self.skillId = skillId; self.onSaved = onSaved; self.onCancel = onCancel
        _form = State(initialValue: initial ?? SkillForm(name: "", description: "", body: SkillRules.template))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt12) {
            SkillFields(form: $form, error: error)
            HStack(spacing: Theme.Metrics.pt8) {
                Spacer()
                Button("Abbrechen", action: onCancel).buttonStyle(.card(.outline)).disabled(busy)
                Button(busy ? "Speichert …" : "Speichern") { save() }.buttonStyle(.card(.primary)).disabled(busy)
            }
        }
    }

    private func save() {
        error = nil; busy = true
        Task {
            let result = await store.saveSkill(id: skillId, form)
            busy = false
            if let result { error = result } else { onSaved() }
        }
    }
}

struct SkillFields: View {
    @Binding var form: SkillForm
    let error: String?

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt20) {
            DialogField("Name (klein, mit Bindestrichen)") { TextField("", text: $form.name).webInput().accessibilityLabel("Name") }
            DialogField("Beschreibung") { SettingsTextArea(text: $form.description, minHeight: Theme.Metrics.pt48, label: "Beschreibung").skillFieldBorder() }
            DialogField("Anleitung") {
                SettingsTextArea(text: $form.body, minHeight: Theme.Metrics.pt190, label: "Anleitung").skillFieldBorder()
                Text("\(form.body.count)/\(SkillRules.bodyLimit)").font(Theme.Fonts.small)
                    .foregroundStyle(form.body.count > SkillRules.bodyLimit ? Theme.Palette.destructive : Theme.Palette.mutedForeground)
            }
            if let error { Text(error).font(Theme.Fonts.geist(Theme.Fonts.size10)).foregroundStyle(Theme.Palette.destructive).fixedSize(horizontal: false, vertical: true) }   // K37
        }
    }
}

private extension View {
    func skillFieldBorder() -> some View {
        overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
    }
}
