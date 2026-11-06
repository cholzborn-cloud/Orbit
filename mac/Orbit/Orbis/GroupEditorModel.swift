import Observation

// Zustand des Gruppen-Dialogs: Name und Teilnehmer (höchstens 6, mindestens 1; ein Mitglied ist erlaubt).
@MainActor @Observable
final class GroupEditorModel {
    static let maxMembers = 6

    let editing: OrbiGroup?
    var name: String
    var memberIds: [String]
    var error: String?
    var saving = false

    init(editing: OrbiGroup?) {
        self.editing = editing
        name = editing?.name ?? ""
        memberIds = editing?.members.map(\.id) ?? []
    }

    func toggle(_ id: String) {
        if let index = memberIds.firstIndex(of: id) { memberIds.remove(at: index) }
        else if memberIds.count < Self.maxMembers { memberIds.append(id) }
    }

    var limitReached: Bool { memberIds.count >= Self.maxMembers }

    var validationMessage: String? {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "Gib der Gruppe einen Namen." }
        if trimmed.count > 40 { return "Der Name darf höchstens 40 Zeichen haben." }
        if memberIds.isEmpty { return "Wähle mindestens einen Orbi." }
        return nil
    }

    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
}
