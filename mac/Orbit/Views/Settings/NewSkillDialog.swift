import SwiftUI

// Dialog „Neuer Skill“ für `/skill neu <name>` im Chat (Web: components/chat/new-skill-dialog.tsx).
struct NewSkillAction {
    let run: (String) -> Void
    func callAsFunction(_ name: String) { run(name) }
}

extension EnvironmentValues {
    @Entry var openNewSkill: NewSkillAction?
}

struct NewSkillDialog: View {
    let store: SettingsStore
    let name: String
    let onClose: () -> Void
    @State private var form: SkillForm
    @State private var error: String?
    @State private var busy = false

    init(store: SettingsStore, name: String, onClose: @escaping () -> Void) {
        self.store = store; self.name = name; self.onClose = onClose
        _form = State(initialValue: SkillForm(name: name, description: "", body: SkillRules.template))
    }

    var body: some View {
        DialogShell(title: "Neuer Skill", description: "Lege einen persönlichen Orbit-Skill an.", width: Theme.Metrics.pt448, height: Theme.Metrics.pt560, onClose: onClose, content: {
            SkillFields(form: $form, error: error)
        }, footer: {
            VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
                HStack(spacing: Theme.Spacing.sm) {
                    Spacer()
                    Button("Abbrechen", action: onClose).buttonStyle(.card(.outline)).disabled(busy)
                    Button(busy ? "Legt an …" : "Anlegen") { save() }.buttonStyle(.card(.primary))
                        .disabled(busy || !SkillRules.canStart(form))
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        })
    }

    private func save() {
        error = nil; busy = true
        Task {
            let result = await store.saveSkill(id: nil, form)
            busy = false
            if let result { error = result } else { onClose() }
        }
    }
}
