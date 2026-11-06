import SwiftUI

// Menüeintrag für alle Popover- und Kontextmenüs (MenuPanel, Maße in Theme.Menu): Symbol + Titel, optional Beschreibung,
// grauer Wert rechts, Chevron, Haken, destruktiv (rot), deaktiviert, eigenes Bild links (Avatar), Trennlinie davor.
struct WebMenuItem: Identifiable {
    let id = UUID()
    var title: String
    var icon: String?
    var subtitle: String?
    // Farbe des Symbols (Freigabe-Modus: „Alles freigeben“ in Bernstein).
    var iconTint: Color?
    var destructive = false
    var checked = false
    // Deaktiviert (G15): 40 %, nicht klickbar.
    var disabled = false
    var separatorBefore = false
    var leading: AnyView?
    // Grauer Wert rechts (z. B. „67 % genutzt“) und Chevron ›.
    var value: String?
    var chevron = false
    var action: () -> Void
}

enum MenuRows {
    struct Row: Identifiable {
        let item: WebMenuItem
        let separator: Bool
        var id: UUID { item.id }
    }

    // Trennlinie nur zwischen zwei Gruppen: ein „Trennlinie davor“ am ersten Eintrag (z. B. gefilterte Liste) fällt weg.
    static func rows(_ items: [WebMenuItem]) -> [Row] {
        items.enumerated().map { index, item in Row(item: item, separator: index > 0 && item.separatorBefore) }
    }
}
