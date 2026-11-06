import SwiftUI

// Dialog „Neue Gruppe“ / „Gruppe bearbeiten“ nach components/group-dialog.tsx: Name und Teilnehmer (höchstens 6).
// Eine Gruppe mit einem Mitglied ist erlaubt.
struct GroupEditorView: View {
    @Bindable var editor: GroupEditorModel
    let orbis: [Bot]
    let onSave: () -> Void
    let onCancel: () -> Void
    let onDelete: (() -> Void)?

    var body: some View {
        DialogShell(
            title: editor.editing == nil ? "Neue Gruppe" : "Gruppe bearbeiten", description: "Gib der Gruppe einen Namen und wähle ihre Orbis.",
            height: Theme.Metrics.pt288 + listHeight, onClose: onCancel
        ) {
            VStack(alignment: .leading, spacing: Theme.Metrics.pt20) {
                DialogField("Name") {
                    TextField("Meine Gruppe", text: $editor.name, prompt: Text("Meine Gruppe").foregroundStyle(Theme.Palette.mutedForeground)).webInput()
                    // K37: Feldfehler 10 rot unter dem Feld.
                    if let error = editor.error { Text(error).font(Theme.Fonts.geist(Theme.Fonts.size10)).foregroundStyle(Theme.Palette.destructive) }
                }
                DialogField("Orbis") {
                    if orbis.isEmpty {
                        Text("Erstelle zuerst einen Orbi.").font(Theme.Fonts.small).foregroundStyle(Theme.Palette.mutedForeground)
                    } else {
                        // K39: keine feste Höhe, die Liste wächst bis zum Maximum und scrollt erst dann.
                        ScrollView { memberList }.scrollIndicators(.never).frame(height: listHeight)
                    }
                    Text("Höchstens \(GroupEditorModel.maxMembers) Orbis je Gruppe – weitere sind ausgegraut.").font(Theme.Fonts.caption).foregroundStyle(Theme.Palette.mutedForeground)
                }
            }
        } footer: {
            if let onDelete {
                Button("Löschen", action: onDelete).buttonStyle(.card(.destructive)).disabled(editor.saving)
                Spacer(minLength: Theme.Metrics.pt0)
            }
            Button("Abbrechen", action: onCancel).buttonStyle(.card(.outline)).keyboardShortcut(.cancelAction)
            Button(editor.editing == nil ? "Gruppe erstellen" : "Speichern", action: onSave)
                .buttonStyle(.card(.primary)).keyboardShortcut(.defaultAction)
                .disabled(editor.saving || editor.validationMessage != nil)
        }
    }

    // Eine Zeile 40 + Abstand 4; wächst mit der Zahl der Orbis bis 300.
    private var listHeight: CGFloat { min(CGFloat(orbis.count) * Theme.Metrics.pt44, Theme.Metrics.pt300) }

    private var memberList: some View {
        VStack(spacing: Theme.Metrics.pt4) {
            ForEach(orbis) { bot in MemberRow(bot: bot, on: editor.memberIds.contains(bot.id), disabled: !editor.memberIds.contains(bot.id) && editor.limitReached) { editor.toggle(bot.id) } }
        }
    }

    // Zeile: Kästchen, Figur 28, Name (Web: label p-1.5 rounded-lg, Hover muted).
    private struct MemberRow: View {
        let bot: Bot
        let on: Bool
        let disabled: Bool
        let toggle: () -> Void
        @State private var hover = false

        var body: some View {
            Button(action: toggle) {
                HStack(spacing: Theme.Metrics.pt8) {
                    WebCheckbox(on: on)
                    OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, size: Theme.Metrics.pt28, live: false)
                    Text(bot.name).font(Theme.Fonts.body)
                    Spacer(minLength: Theme.Metrics.pt0)
                }
                .padding(Theme.Metrics.pt6)
                .background(hover ? Theme.Palette.muted : .clear, in: .rect(cornerRadius: Theme.Radius.md))   // Figma 140:42654: r8
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .opacity(disabled ? Theme.Opacity.disabled : 1)
            .disabled(disabled)
            .onHover { hover = $0 }
            .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
        }
    }
}
