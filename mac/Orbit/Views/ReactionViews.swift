import AppKit
import SwiftUI

// Reaktionen nach Figma 02/teil-8 „Reaktion“ (Maße DESIGN-SYSTEM 7.1 „Chat Reaktion“ 27x22, „Chat Blase mit Reaktion“): wie bei iMessage kleine runde Pillen
// über der oberen linken Ecke der Blase, Zahl nur bei mehreren. Klick öffnet ein Menü mit den echten Orbis (Name und Emoji), die reagiert haben.
// Die Pille selbst ist immer neutral (Fläche der Seite, feiner Rand); eigene Reaktion ändert man über das Reaktionsmenü der Nachricht.
struct ReactionPills: View {
    let groups: [ReactionBoard.Group]
    let bots: [Bot]
    @Environment(\.overlay) private var overlay
    // Rahmen der Pillen im Fensterraum (Anker der Menü-Karte).
    @State private var frames: [String: CGRect] = [:]

    var body: some View {
        HStack(spacing: Theme.Spacing.xs) {
            ForEach(groups) { group in
                Button { toggle(group) } label: { pill(group) }
                    .buttonStyle(.plain)
                    .onGeometryChange(for: CGRect.self) { $0.frame(in: .named("orbit-window")) } action: { frames[group.emoji] = $0 }
                    .accessibilityLabel("\(group.emoji) von \(group.names(bots: bots))")
            }
        }
        .probe("reactions")
    }

    // Figma 26:10976 / C26: eigene Karte (r14, Rand 0,5, kein Schatten) über das Overlay statt System-Popover.
    private func toggle(_ group: ReactionBoard.Group) {
        guard let overlay else { return }
        if overlay.menu != nil { overlay.menu = nil; return }
        overlay.tooltip = nil
        overlay.menu = .init(anchor: frames[group.emoji] ?? .zero, items: [], custom: AnyView(ReactionPeople(group: group, bots: bots)), customWidth: Theme.Menu.minWidth)
    }

    private func pill(_ group: ReactionBoard.Group) -> some View {
        // Figma Reaktion (26:10971): Emoji 12, Zahl 11 Medium, Lücke 3, Fläche popover, Rand border 0,5, kein Schatten.
        HStack(spacing: Theme.Metrics.pt3) {
            Text(group.emoji).font(Theme.Fonts.small)
            if group.count > 1 { Text("\(group.count)").font(Theme.Fonts.geist(Theme.Fonts.size11, .medium)).foregroundStyle(Theme.Palette.foreground) }
        }
        .padding(.horizontal, Theme.Metrics.pt7).frame(minWidth: Theme.Metrics.pt27, minHeight: Theme.Metrics.pt22)
        .background(Theme.Palette.popover, in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.Palette.border, lineWidth: Theme.Metrics.pt0_5))
        .contentShape(Capsule())
    }
}

// Menü offen (Figma): Zeilen mit Figur, Name und rechts dem Emoji; Fläche popover, Rand 0,5, Radius 14, Innenabstand 4, Lücke 1.
struct ReactionPeople: View {
    let group: ReactionBoard.Group
    let bots: [Bot]

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Metrics.pt0) {
            ForEach(group.actors, id: \.self) { id in
                HStack(spacing: Theme.Menu.gap) {
                    figure(id).frame(width: Theme.Menu.iconFrame)
                    Text(name(id)).font(Theme.Menu.title).foregroundStyle(Theme.Palette.foreground)
                    Spacer(minLength: Theme.Menu.gap)
                    Text(group.emoji).font(Theme.Menu.title)
                }
                .padding(.horizontal, Theme.Menu.rowPaddingH).frame(height: Theme.Menu.rowHeight)
            }
        }
        // Fläche, Rand und Ecken setzt das Menü des Overlays (menuSurface), Zeilen wie Menüzeilen.
    }

    private func name(_ id: String) -> String { id == ReactionBoard.userActor ? "Du" : (bots.first { $0.id == id }?.name ?? "Orbi") }

    @ViewBuilder private func figure(_ id: String) -> some View {
        if let bot = bots.first(where: { $0.id == id }) {
            OrbiAvatar(name: bot.name, avatar: bot.avatar, colorHex: bot.color, look: bot.look, size: Theme.Metrics.pt20, follow: false).frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20)
        } else {
            // Figma 26:11019: Kreis 20, Fläche input, Buchstabe 10 Medium = erster Buchstabe des Namens.
            Text(String(NSFullUserName().first ?? "D")).font(Theme.Fonts.geist(Theme.Metrics.pt10, .medium)).foregroundStyle(Theme.Palette.foreground)
                .frame(width: Theme.Metrics.pt20, height: Theme.Metrics.pt20).background(Theme.Palette.input, in: Circle())
        }
    }
}

enum ReactionMenu {
    private static let names = ["👍": "Daumen hoch", "✅": "Erledigt", "😂": "Lustig", "❤️": "Herz", "👎": "Daumen runter", "🤔": "Hmm"]

    // Einträge für Menü am Knopf und Rechtsklick; die eigene Reaktion ist abgehakt (nochmal wählen nimmt sie zurück).
    static func items(mine: String?, onPick: @escaping (String) -> Void) -> [WebMenuItem] {
        ReactionBoard.emojis.map { emoji in
            WebMenuItem(title: "\(emoji)  \(names[emoji] ?? "")", checked: emoji == mine, action: { onPick(emoji) })
        }
    }
}
