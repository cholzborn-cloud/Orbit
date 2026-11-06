import Foundation

// „Was sieht das Modell“: Prompt-Vorschau eines Chats (GET /v1/chats/:id/prompt-preview in service/src/mac-open-api.ts).
// `sections` (id, title, layer, content) aus lib/chat/agent.ts promptLayers; der flüchtige Teil steht nur in `layers.layer3Volatile`.
struct PromptPreview: Decodable, Equatable, Sendable {
    struct Section: Decodable, Equatable, Sendable, Identifiable {
        let id: String
        let title: String
        var layer: String?
        let content: String
    }
    struct Layers: Decodable, Equatable, Sendable {
        let layer1Stable: String
        let layer2Tools: String
        let layer3Volatile: String
    }
    let layers: Layers
    var sections: [Section]?

    // Abschnitte zum Anzeigen: die des Dienstes plus der flüchtige Kontext; ältere Dienste ohne `sections` zeigen die drei Schichten.
    var shown: [Section] {
        let volatile = Section(id: "volatile", title: "Flüchtiger Kontext (je Antwort)", layer: "volatile", content: layers.layer3Volatile)
        guard let sections, !sections.isEmpty else {
            return [Section(id: "stable", title: "Stabiler Kern", layer: "stable", content: layers.layer1Stable),
                    Section(id: "tools", title: "Werkzeugregeln", layer: "tools", content: layers.layer2Tools), volatile]
        }
        return sections.contains { $0.layer == "volatile" } ? sections : sections + [volatile]
    }
}

// Sofort wirksame Selbständerungen mit Rückgängig (Dienst: recordUndo in lib/chat/automation-tool.ts, orbi-fleet-tools.ts).
// Der Dienst sendet kein eigenes Ereignis; das Signal ist das erfolgreiche Werkzeug-Ergebnis im Verlauf.
// POST /v1/undo mit `kind` und `orbiId` (= entity_id der Aktion); nie ohne Ziel, sonst nimmt der Dienst die neueste Aktion irgendeiner Art.
struct UndoTarget: Equatable, Sendable {
    let kind: String
    let entityId: String
    let label: String
}

extension ToolPart {
    // `botId`: Orbi der Nachricht (Ziel von `propose_profile`, das sich selbst ändert).
    func undoTarget(botId: String?) -> UndoTarget? {
        // Lokale Mac-Aktionen (lib/mac): der Dienst gibt bei umkehrbaren Aktionen eine undoId zurück.
        if name.hasPrefix("mac_") {
            guard state == .outputAvailable, let undoId = output?["undoId"]?.string else { return nil }
            return UndoTarget(kind: "mac", entityId: undoId, label: Self.macUndoLabel(name: name, action: input?["action"]?.string))
        }
        guard state == .outputAvailable, output?["ok"]?.bool == true else { return nil }
        let inputId = input?["id"]?.string
        switch name {
        case "automation_create":
            return output?["id"]?.string.map { UndoTarget(kind: "routine", entityId: $0, label: "Routine angelegt") }
        case "update_routine":
            let labels = ["update": "Routine geändert", "pause": "Routine pausiert", "resume": "Routine fortgesetzt", "delete": "Routine archiviert"]
            guard let action = input?["action"]?.string, let label = labels[action], let inputId else { return nil }
            return UndoTarget(kind: "routine", entityId: inputId, label: label)
        case "update_orbi", "archive_orbi":
            return inputId.map { UndoTarget(kind: "orbi", entityId: $0, label: name == "archive_orbi" ? "Orbi archiviert" : "Orbi geändert") }
        case "propose_profile":
            return botId.map { UndoTarget(kind: "profile", entityId: $0, label: "Profil geändert") }
        default:
            return nil
        }
    }

    static func macUndoLabel(name: String, action: String?) -> String {
        switch (name, action) {
        case ("mac_shell", _), ("mac_files", "trash"): "In den Papierkorb gelegt"
        case ("mac_files", "move"): "Verschoben"
        case ("mac_files", "write"): "Datei geschrieben"
        case ("mac_calendar", _): "Termin angelegt"
        case ("mac_reminders", "complete"): "Erinnerung abgehakt"
        case ("mac_reminders", _): "Erinnerung angelegt"
        case ("mac_notes", _): "Notiz angelegt"
        default: "Am Mac geändert"
        }
    }
}

// Einstellungen › Allgemein › Mac-Zugriff (GET /v1/mac/access, lib/mac/permissions.ts).
struct MacAccess: Decodable, Equatable {
    struct Permission: Decodable, Equatable, Identifiable {
        let id: String
        let label: String
        let status: String
        let settingsUrl: String
        let detail: String
    }
    let enabled: Bool
    let permissions: [Permission]
}

// Anzeige je Status (reine Logik, geprüft in OrbitTests).
enum MacPermissionText {
    static func value(_ status: String) -> String {
        switch status {
        case "granted": "Erlaubt"
        case "missing": "Fehlt"
        default: "Noch nicht gefragt"
        }
    }
    // Festplattenvollzugriff lässt sich nicht per Dialog anfragen, nur in den Systemeinstellungen setzen.
    static func canRequest(_ permission: MacAccess.Permission) -> Bool { permission.status != "granted" && permission.id != "full_disk" }
}

